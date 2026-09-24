'use strict';

/*
 * Telemetry bridge between data sources (X-Plane, later the Levil BOM) and
 * Open MCT.
 *
 * The bridge starts IDLE: it opens its HTTP/WebSocket port for Open MCT but
 * talks to no data source. Open MCT's "Source" dropdown picks one, and the
 * bridge runs exactly one source at a time. Choosing a new source stops the
 * old one first; choosing "Off" stops everything.
 *
 * WebSocket messages (ws://localhost:8081/realtime):
 *   Open MCT -> bridge   { type: 'select', source: 'xplane' }   (or source: null for Off)
 *   bridge -> Open MCT   { type: 'sources', active: 'xplane' | null, available: [{ id, name }] }
 *                        { type: 'status', source, paused }
 *                        { source, key, value, timestamp }       (a telemetry sample)
 *
 * HTTP:  GET /history/<source>/<key>  -> recent samples, for plots opened mid-flight
 *
 * Optional: set BRIDGE_SOURCE=xplane to start with a source already selected.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const sourceRegistry = require('./sources');

const PORT = process.env.XPLANE_BRIDGE_PORT || 8081;
const HISTORY_LIMIT = 500; // samples kept per measurement, for the /history endpoint

const wsClients = new Set();
const history = new Map(); // "<source>.<key>" -> array of samples

let active = null; // { id, source } of the running source, or null when idle
let switching = Promise.resolve(); // serializes select requests so two can't overlap

function log(message) {
  console.log(`[xplane-bridge] ${message}`);
}

function broadcast(payload) {
  const text = JSON.stringify(payload);
  wsClients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(text);
    }
  });
}

function sourcesMessage() {
  return {
    type: 'sources',
    active: active ? active.id : null,
    available: Object.entries(sourceRegistry).map(([id, entry]) => ({ id, name: entry.name }))
  };
}

function record(sourceId, sample) {
  const datum = { source: sourceId, key: sample.key, value: sample.value, timestamp: sample.timestamp };
  const historyKey = `${sourceId}.${sample.key}`;

  if (!history.has(historyKey)) {
    history.set(historyKey, []);
  }
  const buffer = history.get(historyKey);
  buffer.push(datum);
  if (buffer.length > HISTORY_LIMIT) {
    buffer.shift();
  }

  broadcast(datum);
}

// Stop whatever is running, then start `sourceId` (or stay idle if null).
function selectSource(sourceId) {
  switching = switching.then(async () => {
    const wanted = sourceId && sourceRegistry[sourceId] ? sourceId : null;
    if ((active ? active.id : null) === wanted) {
      broadcast(sourcesMessage());
      return;
    }

    if (active) {
      const old = active;
      active = null;
      await old.source.stop();
      log(`stopped ${sourceRegistry[old.id].name}`);
    }

    if (wanted) {
      const entry = sourceRegistry[wanted];
      const source = entry.create({
        onData: (sample) => record(wanted, sample),
        onStatus: (status) => broadcast({ type: 'status', source: wanted, ...status }),
        log: (message) => log(`${entry.name}: ${message}`)
      });

      try {
        await source.start();
        active = { id: wanted, source };
        log(`source selected: ${entry.name}`);
      } catch (error) {
        log(`could not start ${entry.name}: ${error.message}`);
        await source.stop();
      }
    } else {
      log('source selected: Off (idle)');
    }

    broadcast(sourcesMessage());
  });

  return switching;
}

const server = http.createServer((request, response) => {
  // CORS: Open MCT (served by webpack-dev-server, a different port) fetches
  // this cross-origin.
  response.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(request.url, `http://${request.headers.host}`);
  const match = url.pathname.match(/^\/history\/([\w-]+)\/([\w.-]+)$/);

  if (match) {
    const buffer = history.get(`${match[1]}.${match[2]}`) || [];
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
  socket.send(JSON.stringify(sourcesMessage()));

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      return;
    }

    if (message.type === 'select') {
      selectSource(message.source || null);
    }
  });

  socket.on('close', () => wsClients.delete(socket));
});

server.listen(PORT, () => {
  log(`listening on http://localhost:${PORT} (realtime WebSocket at ws://localhost:${PORT}/realtime)`);
  log(`idle - pick a source from the Source dropdown in Open MCT (available: ${Object.keys(sourceRegistry).join(', ')})`);

  if (process.env.BRIDGE_SOURCE) {
    selectSource(process.env.BRIDGE_SOURCE);
  }
});

process.on('SIGINT', () => {
  log('shutting down...');
  selectSource(null).then(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 1000); // don't hang if a client keeps the server open
});
