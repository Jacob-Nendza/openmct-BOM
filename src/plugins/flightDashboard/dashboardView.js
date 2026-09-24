/*
 * Shared flight-data dashboard, used by every platform folder (X-Plane
 * Aircraft, BOM Data, ...). There is ONE copy of the dashboard code: this
 * file. Each platform only supplies its settings, mainly its layout, in its
 * own small dashboardView.js (e.g. ../xplane/dashboardView.js).
 *
 * The display area is an 8-column grid. Each row is half the height of the
 * display area, so the first two rows fill the screen, e.g.:
 *
 *   ┌──────────── Altitude ────────────┬────────── Indicated Airspeed ──────────┐
 *   ├── Pitch strip ─┬── Roll strip ───┼─ Alt ─┬─ IAS ─┬─ Pitch ─┬─ Roll ──────┤  <- readout columns
 *   └────────────────┴─────────────────┴───────┴───────┴─────────┴─────────────┘
 *   (scroll down)  the rest of the platform's plots
 *
 * Cell kinds (the `kind` in a layout entry):
 *
 *   plot    - Open MCT's own plot view (zoom, pan, hover values, legend all
 *             work). Plots scrolled out of sight pause drawing until visible.
 *   strip   - strip chart: fixed -90..+90 degree scale across, time running
 *             vertically. New data enters at the bottom and scrolls up at the
 *             same pace as the readout rows (one row = one second), with the
 *             same empty bottom row. The scale never changes.
 *   readout - column of recent values, newest at the bottom, one new row every
 *             READOUT_INTERVAL_MS. The bottom row is always left empty, so the
 *             row just above it is the most recent value.
 *
 * Every cell's title links to Open MCT's full-size plot of that measurement.
 * Strips and readouts freeze while no data is arriving (source Off, or sim
 * paused). The folder's usual Grid and List views stay in the view switcher.
 *
 * Usage (see ../xplane/dashboardView.js):
 *
 *   createDashboardViewProvider(openmct, {
 *     key: 'xplane.dashboard',  // unique view key
 *     namespace,                // the platform's object namespace
 *     folderKey,                // the folder that gets this dashboard
 *     measurements,             // from the platform's dictionary.js
 *     layout,                   // [{ key, kind, span }], span = grid columns (of 8)
 *     decimals: { altitude: 0 } // optional: readout decimal places by key
 *   })
 */

import { objectPathToUrl } from '../../tools/url.js';
import VisibilityObserver from '../../utils/visibility/VisibilityObserver.js';

const GRID_COLUMNS = 8;
const GAP_PX = 6;
const MIN_ROW_PX = 200; // on very short windows, rows stop shrinking and you scroll instead

const READOUT_INTERVAL_MS = 1000; // one new readout row per second
const READOUT_ROW_PX = 22;
const READOUT_HISTORY = 300; // rows kept per column (older ones drop off the top)
const STRIP_RANGE_DEG = 90; // strip charts run from -90 to +90
const STRIP_GRID_DEG = 30; // vertical gridline every 30 degrees
const STRIP_TRACE_COLOR = '#43b0ff'; // same blue as Open MCT's first plot series
const STRIP_AXIS_PX = 16; // space at the top for the -90 ... +90 labels

// Readout decimal places by measurement key (a platform can override these).
const DEFAULT_DECIMALS = {
  altitude: 0,
  pressure_altitude: 0,
  gps_altitude: 0,
  airspeed: 1,
  ground_speed: 1,
  pitch: 1,
  roll: 1,
  latitude: 5,
  longitude: 5
};

const CELL_STYLE =
  'display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden;' +
  'border:1px solid rgba(127,127,127,0.25); border-radius:3px; padding:4px;';
const TITLE_STYLE =
  'flex:none; font-weight:bold; padding:0 2px 4px; white-space:nowrap; overflow:hidden;' +
  'text-overflow:ellipsis; text-decoration:none;';

function formatTime(timestamp) {
  return new Date(timestamp).toISOString().slice(11, 19); // HH:MM:SS UTC, like the time axis
}

export default function createDashboardViewProvider(openmct, options) {
  const { key, namespace, folderKey, measurements, layout } = options;
  const decimalsByKey = { ...DEFAULT_DECIMALS, ...(options.decimals || {}) };

  return {
    key,
    name: 'Dashboard',
    cssClass: 'icon-layout',

    canView(domainObject) {
      return (
        domainObject.identifier.namespace === namespace && domainObject.identifier.key === folderKey
      );
    },

    // Higher than the folder's Grid/List views, so the dashboard is the default.
    priority() {
      return openmct.priority.HIGH;
    },

    view(domainObject, objectPath) {
      const cleanups = [];
      let destroyed = false;

      function makeCell(grid, span, titleText, titleHref) {
        const cell = document.createElement('div');
        cell.style.cssText = CELL_STYLE + `grid-column: span ${span};`;

        const title = document.createElement(titleHref ? 'a' : 'div');
        title.textContent = titleText;
        title.style.cssText = TITLE_STYLE;
        if (titleHref) {
          title.href = titleHref;
          title.title = `Open ${titleText} full size`;
        }

        const body = document.createElement('div');
        body.style.cssText =
          'flex:1 1 auto; min-height:0; position:relative; display:flex; flex-direction:column;';

        cell.append(title, body);
        grid.append(cell);

        return body;
      }

      function buildPlot(grid, scroller, child, measurement, span) {
        const childPath = [child, ...objectPath];
        const body = makeCell(
          grid,
          span,
          `${measurement.name} (${measurement.units})`,
          objectPathToUrl(openmct, childPath, { view: 'plot-single' })
        );

        const plotProvider = openmct.objectViews
          .get(child, childPath)
          .find((provider) => provider.key === 'plot-single');
        if (!plotProvider) {
          body.textContent = 'No plot available';
          return;
        }

        const view = plotProvider.view(child, childPath);
        const visibility = new VisibilityObserver(body, scroller);
        view.show(body, false, { renderWhenVisible: visibility.renderWhenVisible });
        cleanups.push(() => {
          view.destroy();
          visibility.destroy();
        });
      }

      function buildStrip(grid, child, measurement, span) {
        const childPath = [child, ...objectPath];
        const body = makeCell(
          grid,
          span,
          `${measurement.name} (${measurement.units})`,
          objectPathToUrl(openmct, childPath, { view: 'plot-single' })
        );

        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';
        body.append(canvas);
        const ctx = canvas.getContext('2d');

        const samples = []; // [{ value, timestamp }], oldest first
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

        function draw() {
          const width = body.clientWidth;
          const height = body.clientHeight;
          if (!width || !height) {
            return;
          }
          const ratio = window.devicePixelRatio || 1;
          if (
            canvas.width !== Math.round(width * ratio) ||
            canvas.height !== Math.round(height * ratio)
          ) {
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
          }
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          ctx.clearRect(0, 0, width, height);

          const textColor = getComputedStyle(body).color;
          const pad = 8;
          const plotLeft = pad;
          const plotRight = width - pad;
          const plotTop = STRIP_AXIS_PX;
          // "Now" sits one row above the bottom, leaving the same empty bottom
          // row as the readout columns.
          const nowY = height - READOUT_ROW_PX;
          const xFor = (value) => {
            const clamped = Math.max(-STRIP_RANGE_DEG, Math.min(STRIP_RANGE_DEG, value));
            return (
              plotLeft +
              ((clamped + STRIP_RANGE_DEG) / (2 * STRIP_RANGE_DEG)) * (plotRight - plotLeft)
            );
          };

          // Row lines, bottom-aligned like the readout rows.
          ctx.strokeStyle = 'rgba(127,127,127,0.18)';
          ctx.lineWidth = 1;
          for (let y = height - READOUT_ROW_PX; y > plotTop; y -= READOUT_ROW_PX) {
            ctx.beginPath();
            ctx.moveTo(plotLeft, Math.round(y) + 0.5);
            ctx.lineTo(plotRight, Math.round(y) + 0.5);
            ctx.stroke();
          }

          // Degree gridlines and labels (fixed scale).
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          for (let deg = -STRIP_RANGE_DEG; deg <= STRIP_RANGE_DEG; deg += STRIP_GRID_DEG) {
            const x = Math.round(xFor(deg)) + 0.5;
            ctx.strokeStyle = deg === 0 ? 'rgba(127,127,127,0.7)' : 'rgba(127,127,127,0.28)';
            ctx.beginPath();
            ctx.moveTo(x, plotTop);
            ctx.lineTo(x, height);
            ctx.stroke();
            ctx.fillStyle = textColor;
            ctx.globalAlpha = 0.6;
            ctx.textAlign =
              deg === -STRIP_RANGE_DEG ? 'left' : deg === STRIP_RANGE_DEG ? 'right' : 'center';
            ctx.fillText(
              String(deg),
              deg === -STRIP_RANGE_DEG ? plotLeft : deg === STRIP_RANGE_DEG ? plotRight : x,
              2
            );
            ctx.globalAlpha = 1;
          }

          if (!samples.length) {
            return;
          }

          // Time runs upward: pixels per second = one readout row. The newest
          // sample is "now", so the strip freezes when data stops arriving.
          const newest = samples[samples.length - 1].timestamp;
          const yFor = (timestamp) => nowY - ((newest - timestamp) / 1000) * READOUT_ROW_PX;

          ctx.save();
          ctx.beginPath();
          ctx.rect(0, plotTop, width, height - plotTop);
          ctx.clip();
          ctx.strokeStyle = STRIP_TRACE_COLOR;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          let started = false;
          for (let i = samples.length - 1; i >= 0; i--) {
            const y = yFor(samples[i].timestamp);
            const x = xFor(samples[i].value);
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
            if (y < plotTop) {
              break; // older samples are off the top
            }
          }
          ctx.stroke();

          // Marker on the most recent value.
          const last = samples[samples.length - 1];
          ctx.fillStyle = STRIP_TRACE_COLOR;
          ctx.beginPath();
          ctx.arc(xFor(last.value), nowY, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        function addSample(sample) {
          if (samples.length && sample.timestamp <= samples[samples.length - 1].timestamp) {
            return;
          }
          samples.push({ value: Number(sample.value), timestamp: sample.timestamp });
          // Keep only what can be on screen (plus a margin).
          const keepMs = ((body.clientHeight || 1000) / READOUT_ROW_PX + 5) * 1000;
          const cutoff = sample.timestamp - keepMs;
          while (samples.length && samples[0].timestamp < cutoff) {
            samples.shift();
          }
        }

        openmct.telemetry.request(child).then((history) => {
          if (destroyed || !Array.isArray(history)) {
            return;
          }
          history.forEach(addSample);
          scheduleDraw();
        });

        const unsubscribe = openmct.telemetry.subscribe(child, (datum) => {
          addSample(datum);
          scheduleDraw();
        });

        const resizeObserver = new ResizeObserver(scheduleDraw);
        resizeObserver.observe(body);
        scheduleDraw();

        cleanups.push(() => {
          unsubscribe();
          resizeObserver.disconnect();
        });
      }

      function buildReadout(grid, child, measurement, span) {
        const body = makeCell(grid, span, `${measurement.name} (${measurement.units})`);
        body.style.justifyContent = 'flex-end'; // rows stack up from the bottom
        body.style.overflow = 'hidden';
        body.style.fontVariantNumeric = 'tabular-nums';

        const decimals = decimalsByKey[measurement.key] ?? 2;
        const rows = []; // [{ value, timestamp }], oldest first
        let latest = null;
        let lastAddedTimestamp = null;

        function makeRow(sample, isNewest) {
          const row = document.createElement('div');
          row.style.cssText =
            `flex:none; height:${READOUT_ROW_PX}px; line-height:${READOUT_ROW_PX}px;` +
            'display:flex; justify-content:space-between; gap:6px; padding:0 4px;' +
            'border-top:1px solid rgba(127,127,127,0.18); white-space:nowrap; overflow:hidden;';
          if (sample) {
            const time = document.createElement('span');
            time.textContent = formatTime(sample.timestamp);
            time.style.opacity = '0.55';
            const value = document.createElement('span');
            value.textContent = Number(sample.value).toFixed(decimals);
            if (isNewest) {
              value.style.fontWeight = 'bold';
            }
            row.append(time, value);
          }
          return row;
        }

        function render() {
          const fits = Math.max(1, Math.floor(body.clientHeight / READOUT_ROW_PX));
          const shown = rows.slice(-(fits - 1)); // leave room for the empty bottom row
          const elements = shown.map((sample, i) => makeRow(sample, i === shown.length - 1));
          elements.push(makeRow(null)); // empty row: everything above is older than "now"
          body.replaceChildren(...elements);
        }

        function addRow(sample) {
          rows.push(sample);
          if (rows.length > READOUT_HISTORY) {
            rows.shift();
          }
        }

        // Seed with what the bridge already has, thinned to one row per interval.
        openmct.telemetry.request(child).then((history) => {
          if (destroyed || !Array.isArray(history)) {
            return;
          }
          let lastBucket = null;
          history.forEach((sample) => {
            const bucket = Math.floor(sample.timestamp / READOUT_INTERVAL_MS);
            if (bucket !== lastBucket) {
              addRow(sample);
              lastBucket = bucket;
            }
          });
          if (history.length) {
            lastAddedTimestamp = history[history.length - 1].timestamp;
          }
          render();
        });

        const unsubscribe = openmct.telemetry.subscribe(child, (datum) => {
          latest = datum;
        });

        const timer = setInterval(() => {
          if (latest && latest.timestamp !== lastAddedTimestamp) {
            addRow(latest);
            lastAddedTimestamp = latest.timestamp;
            render();
          }
        }, READOUT_INTERVAL_MS);

        const resizeObserver = new ResizeObserver(render);
        resizeObserver.observe(body);
        render();

        cleanups.push(() => {
          unsubscribe();
          clearInterval(timer);
          resizeObserver.disconnect();
        });
      }

      return {
        async show(element) {
          const scroller = document.createElement('div');
          scroller.style.cssText = 'height:100%; width:100%; overflow-y:auto; overflow-x:hidden;';

          const grid = document.createElement('div');
          grid.style.cssText =
            `display:grid; grid-template-columns:repeat(${GRID_COLUMNS}, minmax(0, 1fr));` +
            `gap:${GAP_PX}px;`;

          scroller.append(grid);
          element.append(scroller);

          // Two rows per screen: each row is half the visible height.
          function sizeRows() {
            const rowHeight = Math.max(
              MIN_ROW_PX,
              Math.floor((scroller.clientHeight - GAP_PX) / 2)
            );
            grid.style.gridAutoRows = `${rowHeight}px`;
          }
          const resizeObserver = new ResizeObserver(sizeRows);
          resizeObserver.observe(scroller);
          cleanups.push(() => resizeObserver.disconnect());
          sizeRows();

          const keys = [...new Set(layout.map((item) => item.key))];
          const objects = await Promise.all(
            keys.map((measurementKey) => openmct.objects.get({ namespace, key: measurementKey }))
          );
          if (destroyed) {
            return;
          }
          const objectByKey = new Map(
            keys.map((measurementKey, i) => [measurementKey, objects[i]])
          );

          layout.forEach((item) => {
            const child = objectByKey.get(item.key);
            const measurement = measurements.find((m) => m.key === item.key);
            if (item.kind === 'readout') {
              buildReadout(grid, child, measurement, item.span);
            } else if (item.kind === 'strip') {
              buildStrip(grid, child, measurement, item.span);
            } else {
              buildPlot(grid, scroller, child, measurement, item.span);
            }
          });
        },

        destroy() {
          destroyed = true;
          cleanups.forEach((cleanup) => cleanup());
          cleanups.length = 0;
        }
      };
    }
  };
}
