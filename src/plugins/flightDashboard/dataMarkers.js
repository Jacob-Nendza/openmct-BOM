/*
 * Data markers: green dashed lines that mark a moment in time, shared by
 * every chart.
 *
 *   - Double-click any chart to drop a marker at that time.
 *   - Double-click on (or right next to) a marker to remove it.
 *   - "Clear markers" in the dashboard's top bar removes them all.
 *
 * A marker is just a timestamp, so it shows on EVERY chart that has that time
 * on screen: the dashboard plots, strip charts and test-point time histories,
 * and the expanded plots and horizontal strip charts. The line is drawn
 * perpendicular to the time axis: vertical on charts where time runs across,
 * horizontal on charts where time runs down. Markers are numbered M1, M2, ...
 * in time order.
 *
 * Markers are kept in this browser (localStorage), so reloading the page
 * keeps them. Clear Data removes markers older than the clear, like the data.
 *
 *   import dataMarkers, { MARKER_COLOR } from '../flightDashboard/dataMarkers.js';
 *   dataMarkers.list()                       // [{ id, timestamp, number }], oldest first
 *   dataMarkers.toggle(timestamp, toleranceMs)
 *   dataMarkers.clear()
 *   dataMarkers.onChange(callback)           // returns unsubscribe()
 *   drawMarkerLine(ctx, x1, y1, x2, y2)      // canvas charts: one green dashed line
 */

import dataClock from '../dataSource/dataClock.js';

export const MARKER_COLOR = '#22c55e';
export const MARKER_DASH = [6, 4];
export const MARKER_HIT_PX = 6; // double-click this close to a marker removes it
const STORAGE_KEY = 'flightDashboard.dataMarkers';

// Hover help on the dashboard's canvas charts.
export const CANVAS_HELP =
  'Scroll: move back / forward in time\nDouble-click: add or remove a data marker';

const listeners = new Set();
let markers = load(); // [{ id, timestamp }], oldest first
let nextId = markers.reduce((max, marker) => Math.max(max, marker.id), 0) + 1;

function load() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) {
      return saved
        .filter((marker) => marker && Number.isFinite(marker.timestamp))
        .map((marker, i) => ({ id: Number(marker.id) || i + 1, timestamp: marker.timestamp }))
        .sort((a, b) => a.timestamp - b.timestamp);
    }
  } catch (error) {
    // No storage (private window, blocked site data): markers just won't survive a reload.
  }
  return [];
}

function save() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(markers));
  } catch (error) {
    // See load().
  }
}

function changed() {
  markers.sort((a, b) => a.timestamp - b.timestamp);
  save();
  const snapshot = dataMarkers.list();
  listeners.forEach((listener) => listener(snapshot));
}

// Clear Data: drop markers from before the clear.
dataClock.onChange(() => {
  const clearedAt = dataClock.lastClearAt;
  if (clearedAt !== null && markers.some((marker) => marker.timestamp <= clearedAt)) {
    markers = markers.filter((marker) => marker.timestamp > clearedAt);
    changed();
  }
});

const dataMarkers = {
  list() {
    return markers.map((marker, i) => ({ ...marker, number: i + 1 }));
  },

  add(timestamp) {
    if (!Number.isFinite(timestamp)) {
      return null;
    }
    const marker = { id: nextId++, timestamp: Math.round(timestamp) };
    markers.push(marker);
    changed();
    return marker;
  },

  remove(id) {
    const before = markers.length;
    markers = markers.filter((marker) => marker.id !== id);
    if (markers.length !== before) {
      changed();
    }
  },

  // Remove the nearest marker within toleranceMs of timestamp, or add one there.
  toggle(timestamp, toleranceMs = 0) {
    let nearest = null;
    markers.forEach((marker) => {
      const distance = Math.abs(marker.timestamp - timestamp);
      if (distance <= toleranceMs && (!nearest || distance < nearest.distance)) {
        nearest = { marker, distance };
      }
    });
    if (nearest) {
      this.remove(nearest.marker.id);
      return null;
    }
    return this.add(timestamp);
  },

  clear() {
    if (markers.length) {
      markers = [];
      changed();
    }
  },

  onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};

/**
 * Canvas charts: draw one marker as a green dashed line from (x1, y1) to
 * (x2, y2), with its "M1" label at the start of the line.
 */
export function drawMarkerLine(ctx, x1, y1, x2, y2, number) {
  ctx.save();
  ctx.strokeStyle = MARKER_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash(MARKER_DASH);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  if (number) {
    const vertical = x1 === x2;
    ctx.setLineDash([]);
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = MARKER_COLOR;
    ctx.textAlign = 'left';
    ctx.textBaseline = vertical ? 'top' : 'bottom';
    ctx.fillText(`M${number}`, x1 + 3, vertical ? y1 + 2 : y1 - 1);
  }
  ctx.restore();
}

export default dataMarkers;
