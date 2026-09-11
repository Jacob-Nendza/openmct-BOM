'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const XPlaneUDP = require('./xplane-udp.js');
const datarefs = require('./datarefs.js');

const PORT = process.env.XPLANE_BRIDGE_PORT || 8081;
const HISTORY_LIMIT = 500; // samples kept per measurement, for the /history endpoint

const datarefByKey = new Map(datarefs.map((d) => [d.key, d]));
const history = new Map(datarefs.map((d) => [d.key, []]));
const wsClients = new Set();

function toDatum(sample) {
  const dataref = datarefByKey.get(sample.key);
  const value = dataref.convert ? dataref.convert(sample.rawValue) : sample.rawValue;
  return { key: sample.key, value, timestamp: sample.timestamp };
}

const xplane = new XPlaneUDP({ datarefs, frequencyHz: 10 });

xplane.on('data', (sample) => {
  const datum = toDatum(sample);

  const buffer = history.get(datum.key);
  buffer.push(datum);
  if (buffer.length > HISTORY_LIMIT) {
    buffer.shift();
  }

  const payload = JSON.stringify(datum);
  wsClients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
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
  socket.on('close', () => wsClients.delete(socket));
});

xplane
  .start()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[xplane-bridge] listening on http://localhost:${PORT}`);
      console.log(`[xplane-bridge] realtime WebSocket at ws://localhost:${PORT}/realtime`);
      console.log(`[xplane-bridge] subscribed to ${datarefs.length} datarefs, waiting for X-Plane...`);
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
