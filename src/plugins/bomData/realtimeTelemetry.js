/*
 * Realtime telemetry provider for BOM data.
 *
 * Live samples arrive over the app-wide bridge connection
 * (../dataSource/bridgeClient.js); this hands the BOM ones to whatever is
 * open. Opening a plot doesn't start the BOM - only the Source dropdown does.
 */

import bridgeClient from '../dataSource/bridgeClient.js';
import { measurements } from './dictionary.js';

export default function BOMRealtimeTelemetryPlugin() {
  return function install(openmct) {
    openmct.telemetry.addProvider({
      supportsSubscribe: function (domainObject) {
        return domainObject.type === 'bom.telemetry';
      },
      subscribe: function (domainObject, callback) {
        const key = domainObject.identifier.key;
        const measurement = measurements.find((m) => m.key === key);
        if (measurement && measurement.derive) {
          // Worked-out value (e.g. KCAS): listen to its input and convert.
          const { from, compute } = measurement.derive;
          return bridgeClient.subscribe('bom', from, (datum) =>
            callback({ ...datum, key, value: compute(datum.value) })
          );
        }
        return bridgeClient.subscribe('bom', key, callback);
      }
    });
  };
}
