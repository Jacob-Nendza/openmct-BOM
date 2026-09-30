/*
 * Horizontal strip chart: the expanded view of a strip measurement (Pitch,
 * Roll). Opens when you click a dashboard strip chart's title, or the
 * measurement in the tree. The regular plot is still in the view switcher.
 *
 * Shows ALL the testing data from this session - everything recorded since
 * Open MCT loaded (../rawData/recorder.js), back to the last Clear Data - with
 * time running left to right and squeezed to fit the width, so the whole
 * session is always on screen. Updates live.
 *
 *   - fixed -90..+90 degree scale (same as the dashboard strips)
 *   - UTC time across the top, time since data start along the bottom
 *   - hover for the exact value and time at any point
 *
 * Long sessions stay fast: each pixel column draws the min..max of the
 * samples that fall in it, so no spike is ever hidden.
 *
 * A platform turns this on for its strip measurements with
 * registerHorizontalStrips(openmct, 'bom.telemetry', 'bom', ['pitch', 'roll']).
 */

import dataClock, { formatElapsed } from '../dataSource/dataClock.js';
import { getRecorder } from '../rawData/recorder.js';

export const HORIZONTAL_STRIP_VIEW_KEY = 'flight.horizontalStrip';

const RANGE_DEG = 90;
const GRID_DEG = 30;
const TRACE_COLOR = '#43b0ff'; // same blue as the dashboard strips
const MARGIN = { left: 40, right: 12, top: 22, bottom: 22 };
const MIN_SPAN_MS = 10000; // never squeeze less than 10 s across the width
const MIN_TICK_SPACING_PX = 90;
const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];

const registry = new Map(); // telemetry type -> { sourceId, keys: Set }
let providerAdded = false;

function utcText(timestamp) {
  return new Date(timestamp).toISOString().slice(11, 19); // HH:MM:SS
}

function sourceFor(domainObject) {
  const entry = registry.get(domainObject.type);
  return entry && entry.keys.has(domainObject.identifier.key) ? entry.sourceId : null;
}

function HorizontalStripViewProvider(openmct) {
  return {
    key: HORIZONTAL_STRIP_VIEW_KEY,
    name: 'Strip Chart',
    cssClass: 'icon-plot-resource',

    canView(domainObject) {
      return sourceFor(domainObject) !== null;
    },

    // Above the plot view, so clicking Pitch / Roll opens the strip chart.
    priority() {
      return openmct.priority.HIGH;
    },

    view(domainObject) {
      const sourceId = sourceFor(domainObject);
      const key = domainObject.identifier.key;
      const cleanups = [];
      let canvas;
      let ctx;
      let container;
      let hoverX = null;
      let drawQueued = false;

      function scheduleDraw() {
        if (!drawQueued) {
          drawQueued = true;
          requestAnimationFrame(() => {
            drawQueued = false;
            draw();
          });
        }
      }

      // This measurement's samples since the last Clear Data, oldest first.
      function series() {
        const rows = getRecorder(sourceId).rows;
        const after = dataClock.lastClearAt === null ? -Infinity : dataClock.lastClearAt;
        const times = [];
        const values = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row.timestamp > after && key in row.values) {
            times.push(row.timestamp);
            values.push(row.values[key]);
          }
        }
        return { times, values };
      }

      function nearestIndex(times, t) {
        let lo = 0;
        let hi = times.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (times[mid] < t) {
            lo = mid + 1;
          } else {
            hi = mid;
          }
        }
        if (lo > 0 && Math.abs(times[lo - 1] - t) < Math.abs(times[lo] - t)) {
          return lo - 1;
        }
        return lo;
      }

      function draw() {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (!width || !height) {
          return;
        }
        const ratio = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const textColor = getComputedStyle(container).color;
        const left = MARGIN.left;
        const right = width - MARGIN.right;
        const top = MARGIN.top;
        const bottom = height - MARGIN.bottom;
        const yFor = (value) => {
          const v = Math.max(-RANGE_DEG, Math.min(RANGE_DEG, value));
          return top + ((RANGE_DEG - v) / (2 * RANGE_DEG)) * (bottom - top);
        };

        ctx.font = '11px sans-serif';
        ctx.lineWidth = 1;

        // Degree gridlines and labels.
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let deg = -RANGE_DEG; deg <= RANGE_DEG; deg += GRID_DEG) {
          const y = Math.round(yFor(deg)) + 0.5;
          ctx.strokeStyle = deg === 0 ? 'rgba(127,127,127,0.7)' : 'rgba(127,127,127,0.25)';
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.fillStyle = textColor;
          ctx.globalAlpha = 0.7;
          ctx.fillText(`${deg > 0 ? '+' : ''}${deg}°`, left - 6, y);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = 'rgba(127,127,127,0.4)';
        ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);

        const { times, values } = series();
        if (!times.length) {
          ctx.fillStyle = textColor;
          ctx.globalAlpha = 0.6;
          ctx.textAlign = 'center';
          ctx.fillText('No data yet - pick a source in the Source dropdown', (left + right) / 2, (top + bottom) / 2 - 14);
          ctx.globalAlpha = 1;
          return;
        }

        // The whole session, squeezed to fit the width.
        const tStart = times[0];
        const tEnd = Math.max(times[times.length - 1], tStart + MIN_SPAN_MS);
        const xFor = (t) => left + ((t - tStart) / (tEnd - tStart)) * (right - left);
        const tFor = (x) => tStart + ((x - left) / (right - left)) * (tEnd - tStart);

        // Time gridlines: UTC above, time since data start below.
        const zero = dataClock.start === null ? tStart : dataClock.start;
        const spanS = (tEnd - tStart) / 1000;
        const maxTicks = Math.max(1, Math.floor((right - left) / MIN_TICK_SPACING_PX));
        const step =
          STEPS_S.find((s) => spanS / s <= maxTicks) || Math.ceil(spanS / maxTicks / 3600) * 3600;
        ctx.textAlign = 'center';
        for (
          let e = Math.ceil((tStart - zero) / 1000 / step) * step;
          zero + e * 1000 <= tEnd;
          e += step
        ) {
          const t = zero + e * 1000;
          const x = Math.round(xFor(t)) + 0.5;
          ctx.strokeStyle = 'rgba(127,127,127,0.25)';
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
          ctx.fillStyle = textColor;
          ctx.globalAlpha = 0.7;
          ctx.textBaseline = 'bottom';
          ctx.fillText(utcText(t), x, top - 4);
          ctx.textBaseline = 'top';
          ctx.fillText(formatElapsed(t - zero), x, bottom + 4);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = textColor;
        ctx.globalAlpha = 0.5;
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'right';
        ctx.fillText('UTC', left - 6, top - 4);
        ctx.textBaseline = 'top';
        ctx.fillText('Elapsed', left - 6, bottom + 4);
        ctx.globalAlpha = 1;

        // Trace: per pixel column, first -> min -> max -> last.
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, right - left, bottom - top);
        ctx.clip();
        ctx.strokeStyle = TRACE_COLOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let column = null;
        let first;
        let min;
        let max;
        let last;
        let started = false;
        const flush = () => {
          const pts = [first, min, max, last];
          pts.forEach((v) => {
            const y = yFor(v);
            if (!started) {
              ctx.moveTo(column + 0.5, y);
              started = true;
            } else {
              ctx.lineTo(column + 0.5, y);
            }
          });
        };
        for (let i = 0; i < times.length; i++) {
          const col = Math.floor(xFor(times[i]));
          const v = values[i];
          if (col !== column) {
            if (column !== null) {
              flush();
            }
            column = col;
            first = min = max = last = v;
          } else {
            min = Math.min(min, v);
            max = Math.max(max, v);
            last = v;
          }
        }
        flush();
        ctx.stroke();

        // Newest value marker.
        ctx.fillStyle = TRACE_COLOR;
        ctx.beginPath();
        ctx.arc(xFor(times[times.length - 1]), yFor(values[values.length - 1]), 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Hover readout.
        if (hoverX !== null && hoverX >= left && hoverX <= right) {
          const i = nearestIndex(times, tFor(hoverX));
          const x = xFor(times[i]);
          const y = yFor(values[i]);
          ctx.strokeStyle = textColor;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, top);
          ctx.lineTo(Math.round(x) + 0.5, bottom);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = TRACE_COLOR;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();

          const label =
            `${values[i].toFixed(1)}°   ${utcText(times[i])} UTC   ` +
            formatElapsed(times[i] - zero, true);
          const boxW = ctx.measureText(label).width + 12;
          const boxX = Math.min(Math.max(x + 8, left), right - boxW);
          const boxY = y < top + 30 ? y + 10 : y - 28;
          ctx.fillStyle = 'rgba(0,0,0,0.75)';
          ctx.fillRect(boxX, boxY, boxW, 20);
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, boxX + 6, boxY + 10);
        }
      }

      return {
        show(element) {
          container = document.createElement('div');
          container.style.cssText = 'position:relative; width:100%; height:100%; min-height:200px;';
          canvas = document.createElement('canvas');
          canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; cursor:crosshair;';
          container.append(canvas);
          element.append(container);
          ctx = canvas.getContext('2d');

          canvas.addEventListener('mousemove', (event) => {
            hoverX = event.clientX - canvas.getBoundingClientRect().left;
            scheduleDraw();
          });
          canvas.addEventListener('mouseleave', () => {
            hoverX = null;
            scheduleDraw();
          });

          const resizeObserver = new ResizeObserver(scheduleDraw);
          resizeObserver.observe(container);
          cleanups.push(() => resizeObserver.disconnect());
          cleanups.push(getRecorder(sourceId).onChange(scheduleDraw));
          cleanups.push(dataClock.onChange(scheduleDraw));
          scheduleDraw();
        },

        destroy() {
          cleanups.forEach((cleanup) => cleanup());
          cleanups.length = 0;
        }
      };
    }
  };
}

export function registerHorizontalStrips(openmct, type, sourceId, keys) {
  registry.set(type, { sourceId, keys: new Set(keys) });
  if (!providerAdded) {
    providerAdded = true;
    openmct.objectViews.addProvider(HorizontalStripViewProvider(openmct));
  }
}
