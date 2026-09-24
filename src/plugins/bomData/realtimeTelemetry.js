/*
 * Realtime telemetry provider for BOM data.
 *
 * Live samples arrive over the app-wide bridge connection
 * (../dataSource/bridgeClient.js); this hands the BOM ones to whatever is
 * open. Opening a plot doesn't start the BOM - only the Source dropdown does.
 */

import bridgeClient from '../dataSource/bridgeClient.js';

export default function BOMRealtimeTelemetryPlugin() {
  return function install(openmct) {
    openmct.telemetry.addProvider({
      supportsSubscribe: function (domainObject) {
        return domainObject.type === 'bom.telemetry';
      },
      subscribe: function (domainObject, callback) {
        return bridgeClient.subscribe('bom', domainObject.identifier.key, callback);
      }
    });
  };
}
