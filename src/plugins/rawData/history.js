/*
 * History for plots: answers Open MCT's "what happened in this time range?"
 * for BOM / X-Plane measurements.
 *
 * The bridge only keeps its last 500 samples per value (a minute or two at
 * BOM rates), which isn't enough for an expanded plot showing the whole
 * flight. So this merges the bridge's buffer with the Raw Data recorder
 * (./recorder.js), which keeps every sample since Open MCT loaded.
 *
 * Data from before the last Clear Data is left out, so cleared plots stay
 * cleared.
 */

import bridgeClient from '../dataSource/bridgeClient.js';
import dataClock from '../dataSource/dataClock.js';
import { getRecorder } from './recorder.js';

export default async function requestHistory(sourceId, key, options = {}) {
  const from = Math.max(
    typeof options.start === 'number' ? options.start : -Infinity,
    dataClock.lastClearAt === null ? -Infinity : dataClock.lastClearAt + 1
  );
  const to = typeof options.end === 'number' ? options.end : Infinity;
  const byTime = new Map(); // timestamp -> sample

  try {
    const response = await fetch(bridgeClient.historyUrl(sourceId, key));
    if (!response.ok) {
      throw new Error(`bridge returned ${response.status}`);
    }
    const samples = await response.json();
    if (Array.isArray(samples)) {
      samples.forEach((sample) => byTime.set(sample.timestamp, sample));
    }
  } catch (error) {
    console.error(`[${sourceId}] historical request failed for "${key}":`, error.message);
  }

  // Recorder rows are oldest-first; walk back from the newest until out of range.
  const rows = getRecorder(sourceId).rows;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.timestamp < from) {
      break;
    }
    if (key in row.values && !byTime.has(row.timestamp)) {
      byTime.set(row.timestamp, {
        source: sourceId,
        key,
        value: row.values[key],
        timestamp: row.timestamp
      });
    }
  }

  return [...byTime.values()]
    .filter((sample) => sample.timestamp >= from && sample.timestamp <= to)
    .sort((a, b) => a.timestamp - b.timestamp);
}
