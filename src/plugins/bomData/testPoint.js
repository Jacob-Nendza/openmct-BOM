/*
 * BOM test-point settings, shared by the dashboard (./dashboardView.js) and
 * the KCAS measurement (./dictionary.js).
 *
 *   PARAMS                - what the test-point displays show
 *   TEST_POINT_DEFAULTS   - starting MAX/MIN and center/+/- values
 *   bomTestPointSettings  - the saved values you type in, including the
 *                           IAS -> KCAS correction table and the True AoA
 *                           inputs (Inputs panel)
 *   bomTrueAoa            - True AoA from one BOM packet (./trueAoa.js)
 */

import { getTestPointSettings } from '../flightDashboard/testPointSettings.js';
import { AOA_INPUT_DEFAULTS, aoaStatus, computeTrueAoa } from './trueAoa.js';

/*
 * What the test-point displays show.
 *   source      - BOM measurement the value comes from (dictionary.js). KCAS
 *                 is its own recorded measurement, worked out from indicated
 *                 airspeed with the correction table (see dictionary.js).
 *   decimals    - for the traces and tolerance bars; boxDecimals for the limit box
 *   scale       - fixed trace scale; without one the scale follows MAX/MIN
 */
export const PARAMS = {
  kcas: { label: 'KCAS', units: 'kt', source: 'kcas', decimals: 1, boxDecimals: 0 },
  nz: { label: 'NZ', units: 'g', source: 'g_load', decimals: 2, boxDecimals: 1 },
  pressure_altitude: {
    label: 'Altitude',
    units: 'ft',
    source: 'pressure_altitude',
    decimals: 0,
    scale: [0, 20000]
  }
};

// Starting values (from the slide) until you type your own; saved per browser.
export const TEST_POINT_DEFAULTS = {
  limits: {
    kcas: { min: 200, max: 600 },
    nz: { min: -2, max: 7 }
  },
  tolerances: {
    nz: { center: 2.5, plusMinus: 2.5 },
    kcas: { center: 375, plusMinus: 20 },
    pressure_altitude: { center: 10000, plusMinus: 1000 }
  },
  // True AoA inputs (Inputs panel), see ./trueAoa.js.
  inputs: { ...AOA_INPUT_DEFAULTS }
};

export const SETTINGS_ID = 'bom';

export function bomTestPointSettings() {
  return getTestPointSettings(SETTINGS_ID, TEST_POINT_DEFAULTS);
}

// True AoA (deg) for one BOM packet, using the Inputs-panel values as they are
// right now (like KCAS). Returns NaN outside the valid conditions, so no
// sample is recorded; the reason is shown in the Inputs panel.
export function bomTrueAoa(values) {
  const settings = bomTestPointSettings();
  const result = computeTrueAoa(values, settings.get().inputs, (kias) =>
    settings.kcasFromKias(kias)
  );
  aoaStatus.set(result);
  return result.aoa;
}
