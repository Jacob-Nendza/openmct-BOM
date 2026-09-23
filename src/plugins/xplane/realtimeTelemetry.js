/*
 * Realtime telemetry provider for X-Plane data.
 *
 * Opens a single shared WebSocket to the bridge server's /realtime endpoint
 * and fans incoming {key, value, timestamp} messages out to whichever
 * measurement objects are currently subscribed (e.g. an open plot or LAD
 * table). Reconnects automatically if the bridge server restarts.
 */

function getBridgeWsUrl() {
  const httpUrl = window.XPLANE_BRIDGE_URL || 'http://localhost:8081';
  return httpUrl.replace(/^http/, 'ws') + '/realtime';
}

export default function XPlaneRealtimeTelemetryPlugin(options = {}) {
  // options.onStatus(status) is called with {paused: true|false} whenever the
  // bridge reports a change in X-Plane's pause state (see plugin.js).
  const onStatus = options.onStatus || function () {};

  return function install(openmct) {
    const listenersByKey = {};
    let socket = null;

    function ensureSocket() {
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
      }

      socket = new WebSocket(getBridgeWsUrl());

      socket.onmessage = function (event) {
        let datum;
        try {
          datum = JSON.parse(event.data);
        } catch (error) {
          return;
        }

        if (datum.type === 'status') {
          onStatus(datum);
          return;
        }

        const listeners = listenersByKey[datum.key];
        if (listeners) {
          listeners.forEach((callback) => callback(datum));
        }
      };

      socket.onclose = function () {
        onStatus({ paused: false }); // bridge gone: don't leave a stale "paused" badge up
        setTimeout(ensureSocket, 2000);
      };

      socket.onerror = function () {
        socket.close();
      };
    }

    // Connect right away (not only when a plot opens) so the pause indicator
    // is accurate on every screen.
    ensureSocket();

    openmct.telemetry.addProvider({
      supportsSubscribe: function (domainObject) {
        return domainObject.type === 'xplane.telemetry';
      },
      subscribe: function (domainObject, callback) {
        const key = domainObject.identifier.key;
        listenersByKey[key] = listenersByKey[key] || [];
        listenersByKey[key].push(callback);
        ensureSocket();

        return function unsubscribe() {
          listenersByKey[key] = listenersByKey[key].filter((cb) => cb !== callback);
        };
      }
    });
  };
}
