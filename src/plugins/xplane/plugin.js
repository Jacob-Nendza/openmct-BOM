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
 *   dashboardView.js       - the 2x2 plot dashboard shown for the folder
 *
 * Which platform is streaming is chosen with the Source dropdown
 * (../dataSource/plugin.js), not by opening this folder.
 *
 * The actual UDP connection to X-Plane lives outside the browser bundle,
 * in /xplane-bridge/bridge-server.js — a separate Node process, because
 * a browser can't open raw UDP sockets.
 */

import XPlaneDashboardViewProvider from './dashboardView.js';
import XPlaneDictionaryPlugin from './dictionary.js';
import XPlaneHistoricalTelemetryPlugin from './historicalTelemetry.js';
import XPlaneRealtimeTelemetryPlugin from './realtimeTelemetry.js';
import bridgeClient from '../dataSource/bridgeClient.js';

export default function XPlanePlugin() {
  return function install(openmct) {
    openmct.install(XPlaneDictionaryPlugin());
    openmct.install(XPlaneHistoricalTelemetryPlugin());
    openmct.install(XPlaneRealtimeTelemetryPlugin());

    // Clicking the "X-Plane Aircraft" folder opens a 2x2 plot dashboard.
    openmct.objectViews.addProvider(XPlaneDashboardViewProvider(openmct));

    // "X-Plane paused" badge in Open MCT's top bar. Hidden while the sim is
    // running; shown while X-Plane is the active source and is paused.
    const pauseIndicator = openmct.indicators.simpleIndicator();
    pauseIndicator.iconClass('icon-pause');
    pauseIndicator.statusClass('s-status-warning');
    pauseIndicator.description(
      'X-Plane is paused. Telemetry recording is on hold until the sim resumes.'
    );
    pauseIndicator.text(''); // empty text = hidden
    openmct.indicators.add(pauseIndicator);

    bridgeClient.onStatus(function (status) {
      if (status.source === 'xplane' || status.source === null) {
        pauseIndicator.text(status.paused ? 'X-Plane paused' : '');
      }
    });
  };
}
