/*
 * Historical telemetry provider for X-Plane data.
 *
 * When Open MCT needs data for a time range (e.g. drawing a plot on load,
 * or panning the time conductor), it calls `request()`. This asks the
 * bridge server for whatever samples it currently has buffered for that
 * measurement.
 *
 * Set window.XPLANE_BRIDGE_URL in index.html to point at wherever
 * xplane-bridge/bridge-server.js is running (default http://localhost:8081).
 */

function getBridgeUrl() {
  return window.XPLANE_BRIDGE_URL || 'http://localhost:8081';
}

export default function XPlaneHistoricalTelemetryPlugin() {
  return function install(openmct) {
    openmct.telemetry.addProvider({
      supportsRequest: function (domainObject) {
        return domainObject.type === 'xplane.telemetry';
      },
      request: function (domainObject) {
        const key = domainObject.identifier.key;

        return fetch(`${getBridgeUrl()}/history/${key}`)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`bridge returned ${response.status}`);
            }
            return response.json();
          })
          .catch((error) => {
            console.error(`[xplane] historical request failed for "${key}":`, error.message);
            return [];
          });
      }
    });
  };
}
