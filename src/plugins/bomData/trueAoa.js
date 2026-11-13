/*
 * True angle of attack (degrees), worked out in Open MCT from BOM data.
 *
 * The BOM itself does NOT send an angle: its own AoA is a 0..1 stall ratio
 * (Pilot's Guide D-0005, section 7.1). This file computes a real angle with
 * the "kinematic" (flight-path) method:
 *
 *   flight path angle   gamma = asin( vertical speed / true airspeed )
 *   wings level:        alpha = theta - gamma
 *   in a bank (phi):    sin(gamma) = cos(alpha) sin(theta) - sin(alpha) cos(phi) cos(theta)
 *                       solved for alpha (reduces to theta - gamma at phi = 0)
 *
 * where theta is the WING CHORD pitch = BOM pitch + chord offset.
 *
 * Inputs from the BOM (all from the same Levil AHRS packet):
 *   pitch, roll, airspeed (KIAS), vertical_speed (ft/min), pressure_altitude
 *
 * Inputs YOU type into the dashboard's Inputs panel (saved per browser):
 *   chordOffsetDeg - wing chord angle relative to the BOM's 0 deg pitch.
 *                    Measure on the ground: level the BOM (CAGE), then
 *                    chord angle (inclinometer on the wing) - BOM pitch.
 *   oatC           - outside air temperature. Blank = standard atmosphere.
 *   criticalAoaDeg - stall AoA for the wing; drawn as a red line on the strip.
 *   minKias        - below this, AoA is not computed (taxi, takeoff roll).
 *   maxBankDeg     - above this bank, AoA is not computed.
 *
 * IAS is first corrected to KCAS with the Inputs-panel table, then to TAS.
 *
 * Assumptions (state these in the report):
 *   - no sideslip (ball centered)
 *   - steady air: no vertical wind / updrafts (they show up as AoA error)
 *   - quasi-steady flight: fast pitch changes lead the real AoA slightly
 *     because the BOM's vertical speed lags.
 */

const KT_TO_FTPS = 1.6878099;
const DEG = Math.PI / 180;

// Fields shown in the Inputs panel, in order. `default` is used until you type a value.
export const AOA_INPUT_FIELDS = [
  {
    key: 'chordOffsetDeg',
    label: 'Chord offset',
    units: 'deg',
    default: 0,
    help: 'Wing chord angle minus BOM pitch, measured on the ground (+ = chord nose-up from BOM level).'
  },
  {
    key: 'oatC',
    label: 'OAT',
    units: '°C',
    default: null,
    allowBlank: true,
    help: 'Outside air temperature. Leave blank to use the standard atmosphere.'
  },
  {
    key: 'criticalAoaDeg',
    label: 'Critical AoA',
    units: 'deg',
    default: 16,
    help: 'Stall angle of attack for the wing (red line on the strip). 16 is typical for a light GA airfoil - replace with your aircraft\'s value.'
  },
  {
    key: 'minKias',
    label: 'Min airspeed',
    units: 'KIAS',
    default: 40,
    help: 'Below this airspeed AoA is not computed.'
  },
  {
    key: 'maxBankDeg',
    label: 'Max bank',
    units: 'deg',
    default: 30,
    help: 'Beyond this bank angle AoA is not computed.'
  }
];

export const AOA_INPUT_DEFAULTS = Object.fromEntries(
  AOA_INPUT_FIELDS.map((field) => [field.key, field.default])
);

// BOM measurements the computation needs (keys from dictionary.js).
export const AOA_INPUTS = ['pitch', 'roll', 'airspeed', 'vertical_speed'];
export const AOA_OPTIONAL_INPUTS = ['pressure_altitude'];

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/*
 * KCAS -> KTAS. Pressure ratio from the standard atmosphere at pressure
 * altitude; temperature from OAT if given, otherwise standard. Below ~200 kt
 * compressibility is negligible, so TAS = CAS / sqrt(density ratio).
 */
export function trueAirspeed(kcas, pressureAltFt, oatC) {
  const delta = Math.pow(1 - 6.8755856e-6 * pressureAltFt, 5.2558797);
  const tempK = Number.isFinite(oatC) ? oatC + 273.15 : 288.15 - 0.0019812 * pressureAltFt;
  const sigma = delta / (tempK / 288.15);
  return kcas / Math.sqrt(sigma);
}

/*
 * One sample. `values` = { pitch, roll, airspeed, vertical_speed, pressure_altitude }
 * from one BOM packet; `inputs` = the Inputs-panel values; `kcasFromKias` =
 * the Inputs-panel correction. Returns { aoa, reason, ... }: aoa is NaN (and
 * reason says why) when the point is outside the valid conditions.
 */
export function computeTrueAoa(values, inputs, kcasFromKias = (kias) => kias) {
  const settings = { ...AOA_INPUT_DEFAULTS, ...inputs };
  const chordOffset = num(settings.chordOffsetDeg, 0);
  const minKias = num(settings.minKias, AOA_INPUT_DEFAULTS.minKias);
  const maxBank = num(settings.maxBankDeg, AOA_INPUT_DEFAULTS.maxBankDeg);
  const { pitch, roll, airspeed, vertical_speed: vs, pressure_altitude: palt } = values;

  if (![pitch, roll, airspeed, vs].every(Number.isFinite)) {
    return { aoa: NaN, reason: 'waiting for pitch / roll / airspeed / vertical speed' };
  }
  if (!Number.isFinite(palt)) {
    return { aoa: NaN, reason: 'no pressure altitude (needed for true airspeed)' };
  }
  if (airspeed < minKias) {
    return { aoa: NaN, reason: `airspeed ${airspeed.toFixed(0)} KIAS < ${minKias} minimum` };
  }
  if (Math.abs(roll) > maxBank) {
    return { aoa: NaN, reason: `bank ${Math.abs(roll).toFixed(0)}° > ${maxBank}° limit` };
  }

  const kcas = num(kcasFromKias(airspeed), airspeed);
  const ktas = trueAirspeed(kcas, palt, settings.oatC);
  const sinGamma = Math.max(-1, Math.min(1, vs / 60 / (ktas * KT_TO_FTPS)));
  const gammaDeg = Math.asin(sinGamma) / DEG;

  // Solve sin(gamma) = A cos(alpha) - B sin(alpha) for alpha:
  //   R cos(alpha + d) = sin(gamma), R = hypot(A, B), d = atan2(B, A)
  const theta = (pitch + chordOffset) * DEG;
  const phi = roll * DEG;
  const A = Math.sin(theta);
  const B = Math.cos(phi) * Math.cos(theta);
  const R = Math.hypot(A, B);
  const d = Math.atan2(B, A);
  const aoa = (Math.acos(Math.max(-1, Math.min(1, sinGamma / R))) - d) / DEG;

  return { aoa, reason: '', ktas, gammaDeg };
}

// Latest result, so the Inputs panel can show the live value or why it's blank.
const statusListeners = new Set();
let lastStatus = null;

export const aoaStatus = {
  get() {
    return lastStatus;
  },
  set(status) {
    lastStatus = status;
    statusListeners.forEach((listener) => listener(status));
  },
  onChange(listener) {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  }
};
