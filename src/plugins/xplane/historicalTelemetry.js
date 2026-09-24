/*
 * Historical telemetry provider for X-Plane data.
 *
 * When Open MCT needs data for a time range (e.g. drawing a plot on load,
 * or panning the time conductor), it calls `request()`. This asks the
 * bridge server for whatever samples it currently has buffered for that
 * measurement.
 *
 * The bridge address comes from ../dataSource/bridgeClient.js.
 */

import bridgeClient from '../dataSource/bridgeClient.js';

export default function XPlaneHistoricalTelemetryPlugin() {
  return function install(openmct) {
    openmct.telemetry.addProvider({
      supportsRequest: function (domainObject) {
        return domainObject.type === 'xplane.telemetry';
      },
      request: function (domainObject) {
        const key = domainObject.identifier.key;

        return fetch(bridgeClient.historyUrl('xplane', key))
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
