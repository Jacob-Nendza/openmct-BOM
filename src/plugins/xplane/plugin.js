/*
 * X-Plane telemetry plugin — entry point.
 *
 * This is the file that gets imported and registered in
 * src/plugins/plugins.js, the same way BOMData (./bomData/plugin.js) is.
 * It just installs the three sub-plugins below, each responsible for one
 * concern:
 *
 *   dictionary.js          - what the objects/measurements look like
 *   historicalTelemetry.js - answers "what happened in this time range"
 *   realtimeTelemetry.js   - streams live samples over WebSocket
 *
 * The actual UDP connection to X-Plane lives outside the browser bundle,
 * in /xplane-bridge/bridge-server.js — a separate Node process, because
 * a browser can't open raw UDP sockets.
 */

import XPlaneDictionaryPlugin from './dictionary.js';
import XPlaneHistoricalTelemetryPlugin from './historicalTelemetry.js';
import XPlaneRealtimeTelemetryPlugin from './realtimeTelemetry.js';

export default function XPlanePlugin() {
  return function install(openmct) {
    openmct.install(XPlaneDictionaryPlugin());
    openmct.install(XPlaneHistoricalTelemetryPlugin());
    openmct.install(XPlaneRealtimeTelemetryPlugin());
  };
}
