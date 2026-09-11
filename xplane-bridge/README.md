# X-Plane → Open MCT bridge

A small Node process that sits between X-Plane 11 and Open MCT:

```
X-Plane 11  --UDP (RREF)-->  bridge-server.js  --WebSocket-->  Open MCT (browser)
                                    |
                                    +--> in-memory history --> HTTP /history/:key
```

X-Plane needs no plugin — its UDP networking is on by default. This server
sends X-Plane `RREF` subscribe packets for 8 datarefs (see `datarefs.js`),
and X-Plane streams values back at 10Hz.

## Setup

```
cd xplane-bridge
npm install
```

## 1. Test the X-Plane connection alone

Start X-Plane 11 and load any flight, then:

```
node test-connection.js
```

You should see ~8 measurements printing for 10 seconds. If you see nothing,
the script prints a checklist of likely causes (X-Plane network settings,
firewall, wrong host).

## 2. Run the full bridge

```
npm start
```

This starts an HTTP + WebSocket server on **port 8081** — the same port
`index.html` expects via `window.XPLANE_BRIDGE_URL`. Leave it running
alongside `npm start` in the main Open MCT repo.

## Files

- `xplane-udp.js` — the RREF protocol client (subscribe/parse UDP packets). No knowledge of Open MCT.
- `datarefs.js` — which X-Plane datarefs to pull and how to convert their units. Keys here must match `../src/plugins/xplane/dictionary.js`.
- `bridge-server.js` — wires the UDP client to an in-memory history buffer, an HTTP `/history/:key` endpoint, and a `/realtime` WebSocket.
- `test-connection.js` — standalone smoke test, no HTTP/WebSocket server involved.

## Path to the real hardware

When swapping in the real Levil BOM avionics pod, only `xplane-udp.js` +
`datarefs.js` need to change (parse the BOM's GDL90/NMEA broadcast instead
of X-Plane's RREF protocol) — `bridge-server.js` and everything on the Open
MCT side already just expect `{key, value, timestamp}` samples.
