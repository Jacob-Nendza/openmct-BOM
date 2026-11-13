/*
 * BOM dashboard settings: the view you see when you click the "BOM Data"
 * folder. The dashboard itself is shared with the other platforms and lives
 * in ../flightDashboard/dashboardView.js; this file only says what goes where.
 *
 * LAYOUT is the dashboard cell by cell, left-to-right then top-to-bottom, on
 * a 36-column grid (COLUMNS). kind: 'plot' | 'strip' | 'readout'; span:
 * columns wide; rows: rows tall (default 1). Plots show the last 2 minutes;
 * add windowSeconds: N to a plot entry to use a different length. Expanded
 * (click the title) = full duration.
 *
 * It is organized in SCREENS: each screen is one window tall (two rows).
 * `screen: 'Name'` on a screen's first cell adds it to the tab bar at the top,
 * and scrolling settles on screen boundaries.
 *
 * The Test Point screen has the Pitch, Roll and AoA strip charts as three
 * tall columns on its right edge (4 columns wide, both rows tall, latest value
 * in the title). AoA is the True AoA worked out in Open MCT (./trueAoa.js), on
 * a -10..+30 deg scale with the critical AoA as a red line; its inputs (chord
 * offset, OAT, ...) are typed into the Inputs panel. The screens below are plots only, four across:
 *
 *   1. Test Point     - one row per parameter: KCAS limit box, time
 *                       history, tolerance bar; NZ the same below. Altitude
 *                       bar / trace in the 4th column, then pitch / roll / AoA.
 *                       (SampleScreen.pptx displays, 6 columns each.)
 *                       Uses { param, kind, span }; see PARAMS in ./testPoint.js.
 *   2. Flight         - P-Alt, VS, KCAS, G load / heading, slip, KIAS, yaw rate
 *   3. GPS            - GPS altitude, ground speed, track, GPS VS / lat, lon
 *
 * Plots are 9 columns wide (four across); hover a plot for exact values.
 * (Readout columns are still available: { key, kind: 'readout', span: 2 }.)
 */

import createDashboardViewProvider from '../flightDashboard/dashboardView.js';
import { BOM_FOLDER_KEY, measurements, NAMESPACE } from './dictionary.js';
import { bomTestPointSettings, PARAMS, SETTINGS_ID, TEST_POINT_DEFAULTS } from './testPoint.js';
import { AOA_INPUT_FIELDS, aoaStatus } from './trueAoa.js';

// True AoA strip: -10..+30 deg (a +/-90 scale would flatten it), with the
// critical AoA from the Inputs panel as a red dashed line. Also used by the
// expanded horizontal strip chart (./plugin.js).
export const AOA_STRIP = {
  scale: [-10, 30],
  gridStep: 10,
  limit: () => bomTestPointSettings().get().inputs.criticalAoaDeg,
  onLimitChange: (callback) => bomTestPointSettings().onChange(callback)
};

// Inputs-panel section for the True AoA numbers (./trueAoa.js), with a live
// line showing the current value or why it isn't being computed.
const AOA_INPUT_SECTION = {
  title: 'True AoA inputs',
  intro:
    'AoA = pitch - flight path angle (VS / TAS), bank-corrected. Uses the ' +
    'KCAS table above. Assumes no sideslip and no vertical wind.',
  fields: AOA_INPUT_FIELDS,
  status: {
    text() {
      const status = aoaStatus.get();
      if (!status) {
        return 'Now: no BOM data yet';
      }
      if (!Number.isFinite(status.aoa)) {
        return `Now: not computed - ${status.reason}`;
      }
      return (
        `Now: ${status.aoa.toFixed(1)}° AoA  ` +
        `(γ ${status.gammaDeg.toFixed(1)}°, ${status.ktas.toFixed(0)} KTAS)`
      );
    },
    onChange: (callback) => aoaStatus.onChange(callback)
  }
};

// 36 = 4 test-point columns x 6 + 3 strips x 4, and 4 plots x 9 across.
const COLUMNS = 36;

// Pitch, roll and AoA strips: three tall columns on the right of the Test Point
// screen. They go after the screen's first row in LAYOUT so the grid puts
// them at the right edge of that row, two rows tall.
const ATTITUDE_COLUMNS = [
  { key: 'pitch', kind: 'strip', span: 4, rows: 2 },
  { key: 'roll', kind: 'strip', span: 4, rows: 2 },
  { key: 'aoa', kind: 'strip', span: 4, rows: 2, ...AOA_STRIP }
];

// A screen of plots, filled left to right, `span` columns each (9 = four across).
function plotScreen(screen, keys, span = 9) {
  return keys.map((key, i) => ({ key, kind: 'plot', span, ...(i === 0 ? { screen } : {}) }));
}

const LAYOUT = [
  // 1. Test Point: one row per parameter - limit box, time history,
  //    tolerance bar - KCAS on top, NZ below. Altitude (no limit box) gets
  //    the fourth column: its tolerance bar on top, time history below.
  { param: 'kcas', kind: 'limitBox', span: 6, screen: 'Test Point' },
  { param: 'kcas', kind: 'trace', span: 6 },
  { param: 'kcas', kind: 'tolerance', span: 6 },
  { param: 'pressure_altitude', kind: 'tolerance', span: 6 },
  ...ATTITUDE_COLUMNS,
  { param: 'nz', kind: 'limitBox', span: 6 },
  { param: 'nz', kind: 'trace', span: 6 },
  { param: 'nz', kind: 'tolerance', span: 6 },
  { param: 'pressure_altitude', kind: 'trace', span: 6 },

  ...plotScreen('Flight', [
    'pressure_altitude',
    'vertical_speed',
    'kcas',
    'g_load',
    'heading',
    'slip',
    'airspeed',
    'yaw_rate'
  ]),
  ...plotScreen('GPS', ['gps_altitude', 'ground_speed', 'track', 'gps_vertical_speed']),
  { key: 'latitude', kind: 'plot', span: 18 },
  { key: 'longitude', kind: 'plot', span: 18 }
];

// Readout decimal places (anything not listed uses the shared defaults).
const DECIMALS = {
  heading: 0,
  slip: 1,
  vertical_speed: 0,
  kcas: 1,
  g_load: 2,
  gps_altitude: 0,
  ground_speed: 0,
  track: 0,
  gps_vertical_speed: 0,
  yaw_rate: 1
};

// Measurements drawn as strips here; clicking them opens the horizontal strip chart.
export const STRIP_KEYS = [
  ...new Set(LAYOUT.filter((item) => item.kind === 'strip').map((item) => item.key))
];

export default function BOMDashboardViewProvider(openmct) {
  return createDashboardViewProvider(openmct, {
    key: 'bom.dashboard',
    namespace: NAMESPACE,
    folderKey: BOM_FOLDER_KEY,
    measurements,
    layout: LAYOUT,
    columns: COLUMNS,
    decimals: DECIMALS,
    testPoint: {
      settingsId: SETTINGS_ID,
      params: PARAMS,
      defaults: TEST_POINT_DEFAULTS,
      // Inputs panel: IAS -> KCAS table; shows the live IAS from this measurement.
      kcasCorrection: { iasKey: 'airspeed' },
      // Inputs panel: chord offset, OAT, critical AoA, ... for True AoA.
      inputSections: [AOA_INPUT_SECTION]
    }
  });
}
