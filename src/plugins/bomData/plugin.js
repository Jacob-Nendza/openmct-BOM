/*
 * Levil BOM telemetry plugin - entry point (registered in src/plugins/plugins.js
 * as plugins.BOMData, installed in index.html).
 *
 *   dictionary.js          - the "BOM Data" folder and its measurements
 *   historicalTelemetry.js - recent samples from the bridge (/history/bom/<key>)
 *   realtimeTelemetry.js   - live samples over the bridge WebSocket
 *   dashboardView.js       - the plot dashboard shown for the folder
 *   ../rawData/            - the folder's "Raw Data" table + export
 *
 * Data only flows when "Levil BOM" is picked in the Source dropdown. The UDP
 * listening and GDL90 decoding happen in the bridge (xplane-bridge/sources/bom.js).
 * For testing without hardware, run the BOM Emulator (C:\Projects\BOM-Emulator).
 */

import BOMDashboardViewProvider, { STRIP_KEYS } from './dashboardView.js';
import BOMDictionaryPlugin, { measurements } from './dictionary.js';
import BOMHistoricalTelemetryPlugin from './historicalTelemetry.js';
import BOMRealtimeTelemetryPlugin from './realtimeTelemetry.js';
import { installRawData } from '../rawData/plugin.js';
import { registerHorizontalStrips } from '../flightDashboard/horizontalStripView.js';
import { getTimeWindows } from '../flightDashboard/timeWindows.js';

export default function BOMDataPlugin() {
  return function install(openmct) {
    openmct.install(BOMDictionaryPlugin());
    openmct.install(BOMHistoricalTelemetryPlugin());
    openmct.install(BOMRealtimeTelemetryPlugin());

    // Clicking the "BOM Data" folder opens the plot dashboard.
    openmct.objectViews.addProvider(BOMDashboardViewProvider(openmct));

    // "Raw Data" in the folder: every sample since Open MCT loaded, exportable.
    installRawData(openmct, 'bom', measurements);

    // Opened on its own (e.g. clicking a dashboard plot's title), a measurement
    // plot shows the full duration of the data (../flightDashboard/timeWindows.js).
    getTimeWindows(openmct).expandToFullDuration('bom.telemetry');

    // Pitch / Roll (the dashboard's strips) open as a horizontal strip chart
    // of the whole session instead (../flightDashboard/horizontalStripView.js).
    registerHorizontalStrips(openmct, 'bom.telemetry', 'bom', STRIP_KEYS);
  };
}
