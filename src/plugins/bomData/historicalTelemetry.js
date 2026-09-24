/*
 * Historical telemetry provider for BOM data - same as the X-Plane one, but
 * asks the bridge for /history/bom/<key>.
 */

import bridgeClient from '../dataSource/bridgeClient.js';

export default function BOMHistoricalTelemetryPlugin() {
  return function install(openmct) {
    openmct.telemetry.addProvider({
      supportsRequest: function (domainObject) {
        return domainObject.type === 'bom.telemetry';
      },
      request: function (domainObject) {
        const key = domainObject.identifier.key;

        return fetch(bridgeClient.historyUrl('bom', key))
          .then((response) => {
            if (!response.ok) {
              throw new Error(`bridge returned ${response.status}`);
            }
            return response.json();
          })
          .catch((error) => {
            console.error(`[bom] historical request failed for "${key}":`, error.message);
            return [];
          });
      }
    });
  };
}
