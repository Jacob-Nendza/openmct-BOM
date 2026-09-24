/*
 * Realtime telemetry provider for X-Plane data.
 *
 * Live samples arrive over the app-wide bridge connection
 * (../dataSource/bridgeClient.js). This provider just hands the X-Plane ones
 * to whichever measurement objects are open (a plot, a LAD table, ...).
 *
 * Opening a plot does NOT start X-Plane - only the Source dropdown does. If
 * the source is Off (or set to another platform), X-Plane plots simply wait.
 */

import bridgeClient from '../dataSource/bridgeClient.js';

export default function XPlaneRealtimeTelemetryPlugin() {
  return function install(openmct) {
    openmct.telemetry.addProvider({
      supportsSubscribe: function (domainObject) {
        return domainObject.type === 'xplane.telemetry';
      },
      subscribe: function (domainObject, callback) {
        return bridgeClient.subscribe('xplane', domainObject.identifier.key, callback);
      }
    });
  };
}
