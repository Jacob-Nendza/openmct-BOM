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
    // "X-Plane paused" badge in Open MCT's top bar (upper right, above the
    // chart). Hidden while the sim is running; shown while X-Plane is paused.
    const pauseIndicator = openmct.indicators.simpleIndicator();
    pauseIndicator.iconClass('icon-pause');
    pauseIndicator.statusClass('s-status-warning');
    pauseIndicator.description('X-Plane is paused. Telemetry recording is on hold until the sim resumes.');
    pauseIndicator.text(''); // empty text = hidden
    openmct.indicators.add(pauseIndicator);

    openmct.install(
      XPlaneRealtimeTelemetryPlugin({
        onStatus: function (status) {
          pauseIndicator.text(status.paused ? 'X-Plane paused' : '');
        }
      })
    );
  };
}
