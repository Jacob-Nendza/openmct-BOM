# Telemetry bridge → Open MCT

A small Node process that sits between a data source (X-Plane 11 or the
Levil BOM) and Open MCT:

```
X-Plane 11  --UDP (RREF)--┐
Levil BOM   --GDL90/UDP--─┼-->  bridge-server.js  --WebSocket-->  Open MCT (browser)
                          │           |
          only ONE source │           +--> in-memory history --> HTTP /history/<source>/<key>
          runs at a time  ┘
```

The bridge **starts idle**. It opens port 8081 for Open MCT but talks to no
data source until you pick one from the **Source** dropdown in Open MCT's top
bar. Picking a different source stops the old one first; picking **Off**
stops everything (for X-Plane that means sending RREF unsubscribes, so
X-Plane stops streaming).

## Setup

```
cd xplane-bridge
npm install
```

## Run it

From the repo root, `npm start` runs Open MCT and this bridge together.
Then in Open MCT choose **Source → X-Plane** or **Source → Levil BOM**.

To run the bridge alone: `npm start` inside `xplane-bridge/`. To have it
start with a source already selected (no dropdown needed):

```
BRIDGE_SOURCE=xplane npm start
```

## Test the X-Plane connection alone

Start X-Plane 11 and load any flight, then:

```
node test-connection.js
```

You should see measurements printing for 10 seconds. If you see nothing,
the script prints a checklist of likely causes.

## Files

- `bridge-server.js` — the source switcher, history buffers, HTTP `/history/<source>/<key>` endpoint and `/realtime` WebSocket.
- `sources/index.js` — the list of sources the dropdown offers.
- `sources/xplane.js` — the X-Plane source: start/stop, pause handling, unit conversion.
- `xplane-udp.js` — the RREF protocol client (subscribe/unsubscribe, parse UDP packets).
- `datarefs.js` — which X-Plane datarefs to pull and how to convert their units. Keys must match `../src/plugins/xplane/dictionary.js`.
- `test-connection.js` — standalone X-Plane smoke test, no HTTP/WebSocket server involved.
- `sources/bom.js` — the Levil BOM source: UDP listener on port 43211, GDL90 decoding, capture of undecoded messages.
- `captures/` — created on first use; raw hex of GDL90 messages the bridge doesn't decode yet (see below).
- `gdl90.js` — GDL90 decoder (copy of the BOM Emulator's `lib/gdl90.js`).

## The Levil BOM source

`sources/bom.js` listens for GDL90 on **UDP port 43211** (the port the real
BOM uses, confirmed by packet capture; set `BOM_PORT` to change it) and
decodes it with `gdl90.js`. It reports:

| From | Values |
|---|---|
| Heartbeat (0x00) | GPS fix (1/0) |
| Ownship Report (0x0A) | latitude, longitude, ground speed, track, GPS vertical speed, NIC, NACp, horizontal containment radius (from NIC) |
| Geometric Altitude (0x0B) | GPS altitude |
| Levil AHRS (0x4C 45 01) | pitch, roll, heading, slip, yaw rate, G, indicated airspeed, vertical speed, **pressure altitude (1 ft)** |

Pressure altitude comes from the AHRS message at 1 ft resolution, the same as
the BOM's SD-card log. The Ownship Report's 25 ft value is used only if the
AHRS message stops carrying altitude. Track (~1.4°), GPS climb rate
(64 ft/min) and lat/lon (~2 m) are limited by the GDL90 format itself.
Keys must match `../src/plugins/bomData/dictionary.js`.

### Finding the rest of the SD-card columns

The BOM's SD log also has satellites, accelerations, rates, temperature, AOA
and battery. If the BOM broadcasts any of those, they're in messages the
bridge doesn't decode yet. Those messages are saved automatically:

- The bridge log prints `new message type: ...` the first time it sees each kind.
- Undecoded messages go to `captures/bom-capture-<UTC time>.csv` (time, message type, raw hex).
- On stop, the log lists every message type received and how many.
- `BOM_CAPTURE=all npm start` captures every message; `BOM_CAPTURE=off` turns it off.

Record a session with the real BOM while it also logs to its SD card, then
line the capture up against the SD log to work out each field's layout.

Test it without the hardware using the **BOM Emulator**
(`C:\Projects\BOM-Emulator`), which replays recorded BOM logs as GDL90:

1. `npm start` at the repo root (Open MCT + bridge).
2. In a second Git Bash window:
   ```
   cd /c/Projects/BOM-Emulator
   node bom-emulator.js --file 1 --start 1200 --loop
   ```
3. In Open MCT: **Source → Levil BOM**, then click **BOM Data**.

With the real BOM, join the laptop to the `BOM-xxxx` Wi-Fi network instead
of step 2. Only one program can listen on port 43211 at a time, so close the
emulator's `listen.js` first (the bridge log says so if you forget).

`gdl90.js` is a copy of the BOM Emulator's `lib/gdl90.js`; if you change the
decoder in one, copy it to the other.

## Adding another platform

1. Write `sources/<name>.js` with the same shape as `sources/xplane.js`: a
   function that returns `{ start(), stop() }` and reports samples through
   `onData({ key, value, timestamp })`.
2. Add a line for it in `sources/index.js`. It then appears in the
   Source dropdown automatically.
3. On the Open MCT side, give it a folder with a realtime provider that calls
   `bridgeClient.subscribe('<name>', key, callback)` (see
   `../src/plugins/bomData/`).
