/*
 * Levil BOM log format for "Export Raw Data".
 *
 * Writes the recording in the same layout as the CSV logs the BOM itself
 * saves (e.g. ___BOM1028-20200228T204030.csv, firmware 6.2):
 *
 *   SOURCE,<text>                      header lines, each padded with commas
 *   TAIL,<8 spaces>                    to the full 42-field width
 *   DATE,2/28/2020                     (M/D/YYYY, UTC, first sample)
 *   TIME,20:40:30                      (HH:MM:SS, UTC, first sample)
 *   UNITS,(ms),dd-mm-yy,hh:mm:ss,...   units for each column
 *   LEGEND,TIMER(ms),DATE,UTC_TIME,... column names
 *   DATA,21,28-02-2020,20:40:30,...    one row per sample
 *
 * CRLF line endings, like the BOM. Because the layout is identical, an export
 * can be dropped into the BOM Emulator's data/ folder and replayed, or read by
 * any script already written for BOM logs.
 *
 * What goes in each column:
 *   - TIMER(ms) is milliseconds since the first exported row (the BOM counts
 *     from when it started logging).
 *   - DATE / UTC_TIME come from the time the bridge received the packet (this
 *     computer's clock, in UTC), not from the BOM's GPS clock.
 *   - Only columns Open MCT actually receives are filled (see COLUMN_KEYS).
 *     The rest - GPS_FIX, SATELLITES, ACC_X, AOA, BAT_LEVEL, ... - aren't in
 *     the BOM's GDL90 broadcast, so they are left blank rather than invented.
 *
 * Extra columns: a source can add columns AFTER the BOM's 41 (EXTRA_COLUMNS),
 * so every standard column keeps its position. BOM exports add KCAS
 * (calibrated airspeed, worked out in Open MCT from AIRSPEED with the
 * Inputs-panel correction table).
 *
 * Rows: the BOM sends each update as a burst of GDL90 messages (Ownship,
 * Geometric Altitude, AHRS), which the recorder stores as separate rows a few
 * ms apart. A burst becomes ONE DATA row here: a new DATA row starts when a
 * value repeats or BURST_MS has passed. Each row also carries forward the
 * latest value of anything not in its burst (e.g. GPS between 1 Hz fixes),
 * so every row is complete, as in the BOM's own logs. Columns stay blank
 * until their first value arrives.
 */

// The BOM-1028 log layout, in order: [LEGEND name, UNITS].
export const BOM_LOG_COLUMNS = [
  ['TIMER(ms)', '(ms)'],
  ['DATE', 'dd-mm-yy'],
  ['UTC_TIME', 'hh:mm:ss'],
  ['LATITUDE', 'deg'],
  ['LONGITUDE', 'deg'],
  ['GNDSPD', 'kts'],
  ['COURSE', 'deg'],
  ['MAG_DECLINATION', 'deg'],
  ['GPS_CLIMBRATE', 'ft/min'],
  ['ALTGPS', 'ft'],
  ['PALT', 'ft'],
  ['AIRSPEED', 'kts'],
  ['PRESSURE_CLIMBRATE', 'ft/min'],
  ['ROLL', 'deg'],
  ['PITCH', 'deg'],
  ['YAW', 'deg'],
  ['HEADING', 'deg'],
  ['SLIP', 'deg'],
  ['YAWRATE', 'deg/sec'],
  ['Gs', 'g'],
  ['GPS_FIX', '1-valid'],
  ['SATELLITES', '---'],
  ['AHRS_STATUS', '---'],
  ['EVENT', '---'],
  ['NIC', '---'],
  ['Horizontal_rc', '---'],
  ['ACC_X', 'g'],
  ['ACC_Y', 'g'],
  ['ACC_Z', 'g'],
  ['RATE_U', 'deg/sec'],
  ['RATE_V', 'deg/sec'],
  ['RATE_W', 'deg/sec'],
  ['POSITION_X', 'meters'],
  ['POSITION_Y', 'meters'],
  ['POSITION_Z', 'meters'],
  ['VELOCITY_X', 'm/sec'],
  ['VELOCITY_Y', 'm/sec'],
  ['VELOCITY_Z', 'm/sec'],
  ['TEMPERATURE', 'C'],
  ['AOA', '---'],
  ['BAT_LEVEL', '']
];

// Columns added after the standard ones, per source: [LEGEND name, UNITS].
export const EXTRA_COLUMNS = {
  bom: [['KCAS', 'kts']]
};

function columnsFor(sourceId) {
  return [...BOM_LOG_COLUMNS, ...(EXTRA_COLUMNS[sourceId] || [])];
}

// Which Open MCT measurement fills each BOM column, per source. Columns not
// listed stay blank. The BOM writes HEADING into both YAW and HEADING.
export const COLUMN_KEYS = {
  bom: {
    LATITUDE: 'latitude',
    LONGITUDE: 'longitude',
    GNDSPD: 'ground_speed',
    COURSE: 'track',
    GPS_CLIMBRATE: 'gps_vertical_speed',
    ALTGPS: 'gps_altitude',
    PALT: 'pressure_altitude',
    AIRSPEED: 'airspeed',
    PRESSURE_CLIMBRATE: 'vertical_speed',
    ROLL: 'roll',
    PITCH: 'pitch',
    YAW: 'heading',
    HEADING: 'heading',
    SLIP: 'slip',
    YAWRATE: 'yaw_rate',
    Gs: 'g_load',
    KCAS: 'kcas'
  },
  // X-Plane in the same layout, so sim runs and flights can be compared with
  // the same scripts. Note: X-Plane's heading is TRUE (the BOM's is magnetic)
  // and its altitude is MSL elevation, written to ALTGPS.
  xplane: {
    LATITUDE: 'latitude',
    LONGITUDE: 'longitude',
    ALTGPS: 'altitude',
    AIRSPEED: 'airspeed',
    PRESSURE_CLIMBRATE: 'vertical_speed',
    ROLL: 'roll',
    PITCH: 'pitch',
    YAW: 'heading',
    HEADING: 'heading'
  }
};

// Decimal places per column, as the BOM writes them (trailing zeros dropped,
// so 2.0 -> "2"). Matches the resolution GDL90 actually delivers.
const DECIMALS = {
  LATITUDE: 6,
  LONGITUDE: 6,
  GNDSPD: 0,
  COURSE: 1,
  GPS_CLIMBRATE: 1,
  ALTGPS: 0,
  PALT: 0,
  AIRSPEED: 1,
  PRESSURE_CLIMBRATE: 0,
  ROLL: 1,
  PITCH: 1,
  YAW: 1,
  HEADING: 1,
  SLIP: 1,
  YAWRATE: 1,
  Gs: 1,
  KCAS: 1
};

// Samples closer together than this (and with no repeated value) are one burst.
const BURST_MS = 500;

const SOURCE_TEXT = {
  bom: 'Open MCT BOM Data export (Levil BOM via GDL90)',
  xplane: 'Open MCT X-Plane export (X-Plane 11 via RREF)'
};

const pad2 = (n) => String(n).padStart(2, '0');

function utcParts(timestamp) {
  const d = new Date(timestamp);
  return {
    day: d.getUTCDate(),
    month: d.getUTCMonth() + 1,
    year: d.getUTCFullYear(),
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  };
}

function formatValue(column, value) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '';
  }
  const decimals = DECIMALS[column];
  const text = decimals === undefined ? String(value) : String(Number(value.toFixed(decimals)));
  return text === '-0' ? '0' : text;
}

// A header/units/legend line, padded with empty fields to the full width
// (one field per column, plus the leading tag: DATA, UNITS, ...).
function paddedLine(fields, lineWidth) {
  const out = fields.slice();
  while (out.length < lineWidth) {
    out.push('');
  }
  return out.join(',');
}

// Group the recorder's rows (one per packet) into bursts: [{ timestamp, values }].
function groupIntoBursts(rows) {
  const bursts = [];
  let current = null;
  rows.forEach((row) => {
    const keys = Object.keys(row.values);
    const repeats = current && keys.some((key) => key in current.values);
    if (!current || repeats || row.timestamp - current.timestamp >= BURST_MS) {
      current = { timestamp: row.timestamp, values: {} };
      bursts.push(current);
    }
    Object.assign(current.values, row.values);
  });
  return bursts;
}

/**
 * Build the BOM-format log text.
 * @param {{ sourceId: string, rows: Array<{ timestamp: number, values: Object }> }} recorder
 */
export function buildBOMLog(recorder) {
  const columnKeys = COLUMN_KEYS[recorder.sourceId] || {};
  const columns = columnsFor(recorder.sourceId);
  const lineWidth = columns.length + 1;
  const bursts = groupIntoBursts(recorder.rows);
  const first = bursts.length ? bursts[0].timestamp : Date.now();
  const start = utcParts(first);

  const lines = [
    paddedLine(
      ['SOURCE', SOURCE_TEXT[recorder.sourceId] || `Open MCT ${recorder.sourceId} export`],
      lineWidth
    ),
    paddedLine(['TAIL', '        '], lineWidth),
    paddedLine(['DATE', `${start.month}/${start.day}/${start.year}`], lineWidth),
    paddedLine(['TIME', start.time], lineWidth),
    paddedLine(['UNITS', ...columns.map(([, units]) => units)], lineWidth),
    paddedLine(['LEGEND', ...columns.map(([name]) => name)], lineWidth)
  ];

  const latest = {}; // carry-forward: measurement key -> most recent value
  bursts.forEach((burst) => {
    Object.assign(latest, burst.values);
    const t = utcParts(burst.timestamp);
    const fields = [
      'DATA',
      String(Math.round(burst.timestamp - first)),
      `${pad2(t.day)}-${pad2(t.month)}-${t.year}`,
      t.time
    ];
    columns.slice(3).forEach(([column]) => {
      const key = columnKeys[column];
      fields.push(key ? formatValue(column, latest[key]) : '');
    });
    lines.push(fields.join(','));
  });

  return lines.join('\r\n') + '\r\n';
}

/** File name in the BOM's pattern: <device>-<YYYYMMDD>T<HHMMSS>.csv (UTC, first sample). */
export function bomLogFileName(recorder) {
  const first = recorder.rows.length ? recorder.rows[0].timestamp : Date.now();
  const stamp = new Date(first).toISOString().slice(0, 19).replace(/[-:]/g, '');
  const device = recorder.sourceId === 'bom' ? 'OpenMCT_BOM' : `OpenMCT_${recorder.sourceId}`;
  return `${device}-${stamp}.csv`;
}
