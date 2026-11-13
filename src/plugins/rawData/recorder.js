/*
 * Raw data recorder: keeps EVERY sample a platform (BOM, X-Plane, ...) sends
 * while Open MCT is open, so the "Raw Data" view and its export have the
 * whole session, not just what's on screen.
 *
 * Recording starts as soon as Open MCT loads (the platform plugin calls
 * getRecorder() at install time), whether or not the Raw Data view is open.
 * When the bridge connects, the recorder also pulls whatever the bridge still
 * has buffered (/history/<source>/<key>, the last 500 samples per value), so
 * a few moments from before the page loaded are included too.
 *
 * Data is grouped into rows by timestamp: every value the bridge stamped with
 * the same time lands in the same row. (The BOM stamps all values decoded
 * from one UDP packet with one time, so e.g. an AHRS row has pitch, roll,
 * airspeed, ... and an Ownship row has latitude, longitude, ...). A value
 * that wasn't in that packet is left blank - nothing is filled in or guessed.
 *
 * Worked-out measurements (a `derive: { from, compute }` in the platform's
 * dictionary, e.g. the BOM's KCAS from indicated airspeed) are recorded in the
 * same row as the value they come from, computed when the sample arrives.
 *
 * Worked out from SEVERAL values (`derive: { inputs, optional, compute }`,
 * e.g. the BOM's True AoA): computed as soon as a row has every key in
 * `inputs` (all from the same packet). `optional` keys come from the same row
 * if present, otherwise the latest value within OPTIONAL_MAX_AGE_MS. NaN
 * results are not recorded. Live results are passed to onDerived() listeners
 * (the realtime telemetry provider) - see subscribeDerived().
 *
 * Everything lives in browser memory: refreshing the page starts a new
 * recording. Export before you refresh.
 */

import bridgeClient from '../dataSource/bridgeClient.js';
import dataClock from '../dataSource/dataClock.js';

const OPTIONAL_MAX_AGE_MS = 5000; // how old an `optional` derive input may be
const MAX_ROWS = 2000000; // safety cap (~several hours at BOM rates); oldest rows drop first

const recorders = new Map(); // sourceId -> recorder

function createRecorder(sourceId, measurements) {
  const rows = []; // [{ timestamp, values: { key: number } }], oldest first
  const listeners = new Set();
  let droppedRows = 0;
  let notifyQueued = false;
  const latest = {}; // key -> { value, timestamp }, for optional derive inputs
  const derivedListeners = new Map(); // derived key -> Set(callback)

  function notify() {
    if (notifyQueued) {
      return;
    }
    notifyQueued = true;
    // Batch: at 10+ samples per packet, redraw at most once per frame.
    requestAnimationFrame(() => {
      notifyQueued = false;
      listeners.forEach((listener) => listener());
    });
  }

  // Index of the first row with timestamp >= t (binary search).
  function lowerBound(t) {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].timestamp < t) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  function add(key, value, timestamp) {
    if (typeof timestamp !== 'number' || !Number.isFinite(Number(value))) {
      return;
    }
    value = Number(value);

    const last = rows[rows.length - 1];
    let row;
    if (!last || timestamp > last.timestamp) {
      // Normal live case: a newer packet.
      row = { timestamp, values: {} };
      rows.push(row);
      if (rows.length > MAX_ROWS) {
        rows.shift();
        droppedRows++;
      }
    } else {
      // Same packet as the last row, or older data (bridge history on connect).
      const index = lowerBound(timestamp);
      if (index < rows.length && rows[index].timestamp === timestamp) {
        row = rows[index];
        if (key in row.values) {
          return; // already have this exact sample
        }
      } else {
        row = { timestamp, values: {} };
        rows.splice(index, 0, row);
      }
    }
    row.values[key] = value;
    if (!latest[key] || timestamp >= latest[key].timestamp) {
      latest[key] = { value, timestamp };
    }
    dataClock.noteSample(timestamp);
    notify();
    return row;
  }

  // Multi-input worked-out values (e.g. True AoA) for this row, once complete.
  const multiDerived = measurements.filter((m) => m.derive && Array.isArray(m.derive.inputs));
  function deriveFromRow(row, key, live) {
    multiDerived.forEach((m) => {
      const { inputs, optional = [], compute } = m.derive;
      if (!inputs.includes(key) || m.key in row.values) {
        return;
      }
      if (!inputs.every((input) => input in row.values)) {
        return; // rest of the packet hasn't arrived yet
      }
      const values = {};
      inputs.forEach((input) => (values[input] = row.values[input]));
      optional.forEach((input) => {
        if (input in row.values) {
          values[input] = row.values[input];
        } else if (
          latest[input] &&
          Math.abs(row.timestamp - latest[input].timestamp) <= OPTIONAL_MAX_AGE_MS
        ) {
          values[input] = latest[input].value;
        }
      });
      const result = Number(compute(values));
      if (!Number.isFinite(result)) {
        return;
      }
      add(m.key, result, row.timestamp);
      if (live) {
        const datum = { source: sourceId, key: m.key, value: result, timestamp: row.timestamp };
        (derivedListeners.get(m.key) || []).forEach((callback) => callback(datum));
      }
    });
  }

  // Bridge measurements, and the worked-out ones that come from each.
  const direct = measurements.filter((m) => !m.derive);
  const derivedFrom = (key) => measurements.filter((m) => m.derive && m.derive.from === key);

  // Record one bridge sample, plus anything worked out from it.
  // live = true for samples arriving now (false for bridge history on connect).
  function addSample(key, value, timestamp, live = false) {
    const row = add(key, value, timestamp);
    derivedFrom(key).forEach((m) => {
      if (Number.isFinite(Number(value))) {
        add(m.key, m.derive.compute(Number(value)), timestamp);
      }
    });
    if (row) {
      deriveFromRow(row, key, live);
    }
  }

  function loadBridgeHistory() {
    direct.forEach((measurement) => {
      fetch(bridgeClient.historyUrl(sourceId, measurement.key))
        .then((response) => (response.ok ? response.json() : []))
        .then((samples) => {
          if (Array.isArray(samples)) {
            samples.forEach((s) => addSample(measurement.key, s.value, s.timestamp));
          }
        })
        .catch(() => {}); // bridge not running yet - live data will still be recorded
    });
  }

  // Record live samples for every measurement, from now on.
  direct.forEach((measurement) => {
    bridgeClient.subscribe(sourceId, measurement.key, (datum) =>
      addSample(measurement.key, datum.value, datum.timestamp, true)
    );
  });

  // Pull the bridge's buffer each time we (re)connect to it.
  let wasConnected = false;
  bridgeClient.onChange((state) => {
    if (state.connected && !wasConnected) {
      loadBridgeHistory();
    }
    wasConnected = state.connected;
  });

  return {
    sourceId,
    measurements,
    rows,
    get droppedRows() {
      return droppedRows;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Live results of a multi-input worked-out measurement (e.g. 'aoa').
    subscribeDerived(key, callback) {
      if (!derivedListeners.has(key)) {
        derivedListeners.set(key, new Set());
      }
      derivedListeners.get(key).add(callback);
      return () => derivedListeners.get(key).delete(callback);
    }
  };
}

// One recorder per platform, created the first time it's asked for.
export function getRecorder(sourceId, measurements) {
  if (!recorders.has(sourceId)) {
    if (!measurements) {
      throw new Error(`No raw data recorder for "${sourceId}"`);
    }
    recorders.set(sourceId, createRecorder(sourceId, measurements));
  }
  return recorders.get(sourceId);
}
