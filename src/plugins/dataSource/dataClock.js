/*
 * Data clock: "time since data flow began", shared by every chart.
 *
 * Zero (0:00) is the timestamp of the EARLIEST telemetry sample Open MCT has
 * (any source - BOM, X-Plane, ...), including what the bridge had buffered
 * when the page loaded. Pressing Clear Data (the top-bar button, or "Clear
 * Data for Object") resets it: the clock goes blank and zero becomes the next
 * sample that arrives; anything older than the clear is ignored.
 *
 * Used by:
 *   - Open MCT's plots: elapsed-time axis along the bottom (plot/axis/ElapsedAxis.vue)
 *   - the Raw Data table and its export (rawData/)
 *
 *   import dataClock, { formatElapsed } from '../dataSource/dataClock.js';
 *   dataClock.start              // ms timestamp of zero, or null before any data
 *   dataClock.lastClearAt        // ms time of the last Clear Data, or null
 *   dataClock.noteSample(ts)     // tell the clock a sample exists (recorder does this)
 *   dataClock.onChange(callback) // called with the new start; returns unsubscribe()
 *   formatElapsed(ms)            // 65000 -> '1:05'
 */

import bridgeClient from './bridgeClient.js';

let start = null;
let lastClearAt = null;
let installed = false;
const listeners = new Set();

function setStart(value) {
  start = value;
  listeners.forEach((listener) => listener(start));
}

function noteSample(timestamp) {
  if (typeof timestamp !== 'number' || (lastClearAt !== null && timestamp <= lastClearAt)) {
    return;
  }
  if (start === null || timestamp < start) {
    setStart(timestamp);
  }
}

bridgeClient.onSample((datum) => noteSample(datum.timestamp));

const dataClock = {
  get start() {
    return start;
  },

  get lastClearAt() {
    return lastClearAt;
  },

  noteSample,

  onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  reset() {
    lastClearAt = Date.now();
    setStart(null);
  },

  // Called once by the Data Source plugin: reset whenever Clear Data is used.
  install(openmct) {
    if (installed) {
      return;
    }
    installed = true;
    openmct.objectViews.on('clearData', () => dataClock.reset());
  }
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Elapsed time as h:mm:ss (or m:ss under an hour). Negative values (data
 * from before the last Clear Data) get a minus sign.
 * @param {number} ms elapsed milliseconds
 * @param {boolean} [withMillis] add .mmm
 */
export function formatElapsed(ms, withMillis = false) {
  const sign = ms < 0 ? '−' : '';
  const totalMs = Math.round(Math.abs(ms));
  const totalS = Math.floor(totalMs / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  let text = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  if (withMillis) {
    text += '.' + String(totalMs % 1000).padStart(3, '0');
  }
  return `${sign}${text}`;
}

export default dataClock;
