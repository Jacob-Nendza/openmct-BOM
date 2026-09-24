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
- `sources/bom.js` — the Levil BOM source: UDP listener on port 4000, GDL90 decoding.
- `gdl90.js` — GDL90 decoder (copy of the BOM Emulator's `lib/gdl90.js`).

## The Levil BOM source

`sources/bom.js` listens for GDL90 on **UDP port 4000** (set `BOM_PORT` to
change it) and decodes it with `gdl90.js`. It reports 15 values: latitude,
longitude, pressure and GPS altitude, ground speed, track, both vertical
speeds (from the Ownship Report / Geometric Altitude messages), and pitch,
roll, heading, slip, yaw rate, G and indicated airspeed (from Levil's AHRS
message). Keys must match `../src/plugins/bomData/dictionary.js`.

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
of step 2. Only one program can listen on port 4000 at a time, so close the
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
