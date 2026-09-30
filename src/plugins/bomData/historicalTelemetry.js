/*
 * Historical telemetry provider for BOM data. When Open MCT needs data for a
 * time range (a plot opening, the window moving, an expanded plot showing the
 * whole flight), request() answers from the bridge's buffer plus everything
 * recorded since Open MCT loaded - see ../rawData/history.js.
 */

import requestHistory from '../rawData/history.js';

export default function BOMHistoricalTelemetryPlugin() {
  return function install(openmct) {
    openmct.telemetry.addProvider({
      supportsRequest: function (domainObject) {
        return domainObject.type === 'bom.telemetry';
      },
      // Bridge buffer + everything recorded since Open MCT loaded (../rawData/history.js).
      request: function (domainObject, options) {
        return requestHistory('bom', domainObject.identifier.key, options);
      }
    });
  };
}
