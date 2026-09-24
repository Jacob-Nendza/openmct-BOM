/*
 * Levil BOM telemetry plugin - entry point (registered in src/plugins/plugins.js
 * as plugins.BOMData, installed in index.html).
 *
 *   dictionary.js          - the "BOM Data" folder and its measurements
 *   historicalTelemetry.js - recent samples from the bridge (/history/bom/<key>)
 *   realtimeTelemetry.js   - live samples over the bridge WebSocket
 *   dashboardView.js       - the plot dashboard shown for the folder
 *
 * Data only flows when "Levil BOM" is picked in the Source dropdown. The UDP
 * listening and GDL90 decoding happen in the bridge (xplane-bridge/sources/bom.js).
 * For testing without hardware, run the BOM Emulator (C:\Projects\BOM-Emulator).
 */

import BOMDashboardViewProvider from './dashboardView.js';
import BOMDictionaryPlugin from './dictionary.js';
import BOMHistoricalTelemetryPlugin from './historicalTelemetry.js';
import BOMRealtimeTelemetryPlugin from './realtimeTelemetry.js';

export default function BOMDataPlugin() {
  return function install(openmct) {
    openmct.install(BOMDictionaryPlugin());
    openmct.install(BOMHistoricalTelemetryPlugin());
    openmct.install(BOMRealtimeTelemetryPlugin());

    // Clicking the "BOM Data" folder opens the plot dashboard.
    openmct.objectViews.addProvider(BOMDashboardViewProvider(openmct));
  };
}
