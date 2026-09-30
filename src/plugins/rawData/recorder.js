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
 * Everything lives in browser memory: refreshing the page starts a new
 * recording. Export before you refresh.
 */

import bridgeClient from '../dataSource/bridgeClient.js';

const MAX_ROWS = 2000000; // safety cap (~several hours at BOM rates); oldest rows drop first

const recorders = new Map(); // sourceId -> recorder

function createRecorder(sourceId, measurements) {
  const rows = []; // [{ timestamp, values: { key: number } }], oldest first
  const listeners = new Set();
  let droppedRows = 0;
  let notifyQueued = false;

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
    notify();
  }

  function loadBridgeHistory() {
    measurements.forEach((measurement) => {
      fetch(bridgeClient.historyUrl(sourceId, measurement.key))
        .then((response) => (response.ok ? response.json() : []))
        .then((samples) => {
          if (Array.isArray(samples)) {
            samples.forEach((s) => add(measurement.key, s.value, s.timestamp));
          }
        })
        .catch(() => {}); // bridge not running yet - live data will still be recorded
    });
  }

  // Record live samples for every measurement, from now on.
  measurements.forEach((measurement) => {
    bridgeClient.subscribe(sourceId, measurement.key, (datum) =>
      add(measurement.key, datum.value, datum.timestamp)
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
