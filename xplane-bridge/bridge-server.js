'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const XPlaneUDP = require('./xplane-udp.js');
const datarefs = require('./datarefs.js');

const PORT = process.env.XPLANE_BRIDGE_PORT || 8081;
const HISTORY_LIMIT = 500; // samples kept per measurement, for the /history endpoint

const datarefByKey = new Map(datarefs.map((d) => [d.key, d]));
const history = new Map(datarefs.filter((d) => !d.internal).map((d) => [d.key, []]));

// Tracks X-Plane's pause state (from the internal 'paused' dataref). While
// paused, X-Plane keeps sending the same frozen values; we drop them so the
// plots show a gap instead of a flat line.
let simPaused = false;
const wsClients = new Set();

function toDatum(sample) {
  const dataref = datarefByKey.get(sample.key);
  const value = dataref.convert ? dataref.convert(sample.rawValue) : sample.rawValue;
  return { key: sample.key, value, timestamp: sample.timestamp };
}

const xplane = new XPlaneUDP({ datarefs, frequencyHz: 10 });

xplane.on('data', (sample) => {
  if (sample.key === 'paused') {
    const nowPaused = sample.rawValue >= 0.5;
    if (nowPaused !== simPaused) {
      simPaused = nowPaused;
      console.log(simPaused ? '[xplane-bridge] X-Plane paused, holding data' : '[xplane-bridge] X-Plane resumed');
      broadcast(statusMessage());
    }
    return;
  }

  if (simPaused) {
    return;
  }

  const datum = toDatum(sample);

  const buffer = history.get(datum.key);
  buffer.push(datum);
  if (buffer.length > HISTORY_LIMIT) {
    buffer.shift();
  }

  broadcast(JSON.stringify(datum));
});

// Status messages look like {type: 'status', paused: true}. They carry no
// telemetry `key`, so the Open MCT realtime provider handles them separately
// (it drives the "X-Plane paused" indicator in the top bar).
function statusMessage() {
  return JSON.stringify({ type: 'status', paused: simPaused });
}

function broadcast(payload) {
  wsClients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
}

xplane.on('connected', () => {
  console.log('[xplane-bridge] receiving data from X-Plane');
});

xplane.on('disconnected', () => {
  console.log('[xplane-bridge] X-Plane went quiet, re-subscribing every few seconds...');
});

xplane.on('error', (error) => {
  console.error('[xplane-udp]', error.message);
});

const server = http.createServer((request, response) => {
  // CORS: Open MCT (served by webpack-dev-server, a different port) fetches
  // this cross-origin.
  response.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(request.url, `http://${request.headers.host}`);
  const match = url.pathname.match(/^\/history\/([\w.-]+)$/);

  if (match) {
    const buffer = history.get(match[1]) || [];
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(buffer));
    return;
  }

  response.statusCode = 404;
  response.end('Not found');
});

const wss = new WebSocketServer({ server, path: '/realtime' });
wss.on('connection', (socket) => {
  wsClients.add(socket);
  socket.send(statusMessage()); // tell a newly opened Open MCT the current pause state
  socket.on('close', () => wsClients.delete(socket));
});

xplane
  .start()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[xplane-bridge] listening on http://localhost:${PORT}`);
      console.log(`[xplane-bridge] realtime WebSocket at ws://localhost:${PORT}/realtime`);
      console.log(`[xplane-bridge] requesting ${datarefs.length} datarefs from X-Plane at ${xplane.xplaneHost}:${xplane.xplanePort}, waiting for data...`);
    });
  })
  .catch((error) => {
    console.error('[xplane-bridge] failed to start UDP listener:', error.message);
    process.exit(1);
  });

process.on('SIGINT', () => {
  console.log('\n[xplane-bridge] shutting down...');
  xplane.stop();
  server.close(() => process.exit(0));
});
