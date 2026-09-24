/*
 * Shared connection from Open MCT to the telemetry bridge
 * (xplane-bridge/bridge-server.js).
 *
 * There is ONE WebSocket for the whole app, used by every platform plugin
 * (X-Plane now, the BOM later) and by the Source dropdown. Import it where
 * you need it:
 *
 *   import bridgeClient from '../dataSource/bridgeClient.js';
 *
 *   bridgeClient.subscribe('xplane', 'altitude', callback)  // live samples; returns unsubscribe()
 *   bridgeClient.select('xplane')                           // switch source (null = Off)
 *   bridgeClient.onChange(callback)                         // connection / active-source changes
 *   bridgeClient.onStatus(callback)                         // source status, e.g. {source, paused}
 *   bridgeClient.historyUrl('xplane', 'altitude')           // URL for recent samples
 *
 * Set window.BRIDGE_URL in index.html to point somewhere other than
 * http://localhost:8081 (window.XPLANE_BRIDGE_URL still works too).
 */

const RECONNECT_MS = 2000;

const listeners = {}; // "<source>.<key>" -> [callback]
const changeCallbacks = [];
const statusCallbacks = [];

const state = {
  connected: false,
  active: null, // id of the running source, or null when the bridge is idle
  available: [] // [{ id, name }]
};

let socket = null;

function baseUrl() {
  return window.BRIDGE_URL || window.XPLANE_BRIDGE_URL || 'http://localhost:8081';
}

function notifyChange() {
  changeCallbacks.forEach((callback) => callback(state));
}

function handleMessage(event) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch (error) {
    return;
  }

  if (message.type === 'sources') {
    state.active = message.active;
    state.available = message.available;
    notifyChange();
  } else if (message.type === 'status') {
    statusCallbacks.forEach((callback) => callback(message));
  } else if (message.key) {
    (listeners[`${message.source}.${message.key}`] || []).forEach((callback) => callback(message));
  }
}

function connect() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  socket = new WebSocket(baseUrl().replace(/^http/, 'ws') + '/realtime');
  socket.onmessage = handleMessage;

  socket.onopen = function () {
    state.connected = true;
    notifyChange();
  };

  socket.onclose = function () {
    const wasConnected = state.connected;
    state.connected = false;
    state.active = null;
    if (wasConnected) {
      notifyChange();
      statusCallbacks.forEach((callback) =>
        callback({ type: 'status', source: null, paused: false })
      );
    }
    setTimeout(connect, RECONNECT_MS);
  };

  socket.onerror = function () {
    socket.close();
  };
}

const bridgeClient = {
  state,

  connect,

  select(sourceId) {
    connect();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'select', source: sourceId || null }));
    }
  },

  subscribe(sourceId, key, callback) {
    connect();
    const id = `${sourceId}.${key}`;
    listeners[id] = listeners[id] || [];
    listeners[id].push(callback);

    return function unsubscribe() {
      listeners[id] = listeners[id].filter((cb) => cb !== callback);
    };
  },

  onChange(callback) {
    changeCallbacks.push(callback);
    callback(state);
  },

  onStatus(callback) {
    statusCallbacks.push(callback);
  },

  historyUrl(sourceId, key) {
    return `${baseUrl()}/history/${sourceId}/${key}`;
  }
};

export default bridgeClient;
