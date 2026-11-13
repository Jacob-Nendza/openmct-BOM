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
 *             vertically. New data enters at the top and scrolls down at the
 *             same pace as the readout rows (one row = one second), with the
 *             same empty top row. The degree scale is labeled along the bottom
 *             and never changes.
 *   readout - column of recent values, newest at the top, one new row every
 *             READOUT_INTERVAL_MS. The top row is always left empty, so the
 *             row just below it is the most recent value.
 *
 *   Test-point displays (./testPointCells.js), each showing a "param" from
 *   the platform's testPoint.params (e.g. KCAS, NZ, Pressure Altitude):
 *   limitBox  - big current-value box, red/green against MAX/MIN you type in
 *   trace     - vertical time history with red aircraft-limit lines
 *   tolerance - test-point tolerance bar with high/low lights
 *
 * A platform that sets `testPoint` also gets the "Inputs" side panel on the
 * right (./sidePanel.js): the IAS -> KCAS correction table, and room for
 * future inputs.
 *
 * Screens: a layout entry with `screen: 'Name'` starts a new screen (one
 * window tall). Each screen gets a tab in the bar at the top that jumps to it,
 * the tab of the screen you're on is highlighted, and scrolling settles on
 * screen boundaries so a screen is never left half in view.
 *
 * Clear Data empties strips and readouts, like it does Open MCT's plots.
 *
 * Plots show a moving 2-minute window (see ./timeWindows.js); a plot entry
 * can set windowSeconds to use a different length. Clicking a plot's title
 * opens it expanded, showing the full duration of the data.
 *
 * Data markers (./dataMarkers.js): double-click any chart (plot, strip, time
 * history) to drop a green dashed marker line at that time; it shows on every
 * chart. Double-click a marker to remove it; "Clear markers" in the top bar
 * removes them all.
 *
 * Scrolling back: the mouse wheel over a chart moves it back / forward in time
 * without changing its scale (./timeScroll.js for strips and time histories,
 * ../plot/MctPlot.vue for plots; Ctrl + wheel still zooms a plot). A
 * scrolled-back chart stops following live data until you scroll forward past
 * "now" or click its Live / reset button.
 *
 * Every cell's title opens that measurement expanded: plots open the
 * full-duration plot, strips open the horizontal strip chart of the whole
 * session (./horizontalStripView.js).
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
 *     layout,                   // [{ key, kind, span, windowSeconds? }], span = grid columns
 *     columns: 12,              // optional: grid columns (default 8)
 *                               // readouts can add label: 'P-Alt' (short title)
 *                               // any cell can add rows: 2 (that many rows tall)
 *                               // test-point cells use { param, kind, span } instead of key
 *     decimals: { altitude: 0 }, // optional: readout decimal places by key
 *     testPoint: {              // optional (see ../bomData/dashboardView.js)
 *       settingsId: 'bom',      //   where typed-in values are saved
 *       params,                 //   { kcas: { label, units, source, ... }, ... }
 *       defaults,               //   { limits, tolerances } used until you change them
 *       kcasCorrection: { iasKey: 'airspeed' } // optional: Inputs-panel IAS -> KCAS table
 *       inputSections: [{ title, intro, fields, status }] // optional: more Inputs-panel
 *                               //   numbers (see inputFieldsSection in ./sidePanel.js)
 *     }
 *
 *   Strip entries can also set scale: [min, max], gridStep, and
 *   limit: () => value + onLimitChange(cb) for a red dashed limit line.
 *   })
 */

import { objectPathToUrl } from '../../tools/url.js';
import { HORIZONTAL_STRIP_VIEW_KEY } from './horizontalStripView.js';
import { DASHBOARD_WINDOW_S, getTimeWindows } from './timeWindows.js';
import VisibilityObserver from '../../utils/visibility/VisibilityObserver.js';
import {
  createSidePanel,
  inputFieldsSection,
  kcasCorrectionSection,
  testPointResetSection
} from './sidePanel.js';
import dataMarkers, {
  CANVAS_HELP,
  drawMarkerLine,
  MARKER_COLOR,
  MARKER_HIT_PX
} from './dataMarkers.js';
import { buildLimitBox, buildToleranceBar, buildTrace, createParamFeed } from './testPointCells.js';
import { getTestPointSettings } from './testPointSettings.js';
import { createTimeScroll } from './timeScroll.js';

const TEST_POINT_KINDS = new Set(['limitBox', 'trace', 'tolerance']);

const GRID_COLUMNS = 8; // default; a platform can pass columns: N
const READOUT_TIME_MIN_PX = 112; // narrower readouts show only the value, not the time
const GAP_PX = 6;
const MIN_ROW_PX = 200; // on very short windows, rows stop shrinking and you scroll instead

const READOUT_INTERVAL_MS = 1000; // one new readout row per second
const READOUT_ROW_PX = 22;
const READOUT_HISTORY = 300; // rows kept per column (older ones drop off the top)
const STRIP_RANGE_DEG = 90; // strip charts run from -90 to +90
const STRIP_GRID_DEG = 30; // vertical gridline every 30 degrees
const STRIP_TRACE_COLOR = '#43b0ff'; // same blue as Open MCT's first plot series
const STRIP_LIMIT_COLOR = '#ff4d4d'; // optional limit line (e.g. critical AoA)
const STRIP_AXIS_PX = 16; // space at the bottom for the -90 ... +90 labels

// Readout decimal places by measurement key (a platform can override these).
export const DEFAULT_DECIMALS = {
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
  const gridColumns = options.columns || GRID_COLUMNS;
  const testPoint = options.testPoint || null;
  const params = (testPoint && testPoint.params) || {};

  // Which measurement a layout entry reads: its own key, or its param's source.
  function sourceKeyOf(item) {
    return TEST_POINT_KINDS.has(item.kind) ? params[item.param].source : item.key;
  }

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

      // Clear Data (global, or for this folder / this measurement) applies here.
      function onClearData(child, callback) {
        const handler = (target) => {
          if (
            !target ||
            openmct.objects.areIdsEqual(target.identifier, child.identifier) ||
            openmct.objects.areIdsEqual(target.identifier, domainObject.identifier)
          ) {
            callback();
          }
        };
        openmct.objectViews.on('clearData', handler);
        cleanups.push(() => openmct.objectViews.off('clearData', handler));
      }

      function makeCell(grid, span, titleText, titleHref) {
        const cell = document.createElement('div');
        cell.style.cssText = CELL_STYLE + `grid-column: span ${span};`;

        const body = document.createElement('div');
        body.style.cssText =
          'flex:1 1 auto; min-height:0; position:relative; display:flex; flex-direction:column;';

        if (titleText) {
          const title = document.createElement(titleHref ? 'a' : 'div');
          title.textContent = titleText;
          title.style.cssText = TITLE_STYLE;
          if (titleHref) {
            title.href = titleHref;
            title.title = `Open ${titleText} full size`;
          }
          cell.append(title);
        }
        cell.append(body);
        grid.append(cell);

        return body;
      }

      function buildPlot(grid, scroller, child, measurement, span, windowSeconds) {
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

        // Moving 2-minute window (or the layout's windowSeconds) while on the dashboard.
        cleanups.push(
          getTimeWindows(openmct).holdDashboardWindow(
            child,
            childPath,
            windowSeconds || DASHBOARD_WINDOW_S
          )
        );
      }

      function buildStrip(grid, child, measurement, item) {
        const span = item.span;
        // Scale across: layout `scale: [min, max]` and `gridStep` (default -90..+90 by 30).
        const [scaleMin, scaleMax] = item.scale || [-STRIP_RANGE_DEG, STRIP_RANGE_DEG];
        const gridStep = item.gridStep || STRIP_GRID_DEG;
        const childPath = [child, ...objectPath];
        const body = makeCell(
          grid,
          span,
          `${measurement.name} (${measurement.units})`,
          objectPathToUrl(openmct, childPath, { view: HORIZONTAL_STRIP_VIEW_KEY })
        );

        // Latest value shown in the title, e.g. "Pitch (deg)  4.8".
        const titleValue = document.createElement('span');
        titleValue.style.cssText =
          'float:right; padding-left:6px; font-variant-numeric:tabular-nums;';
        if (body.previousElementSibling) {
          body.previousElementSibling.prepend(titleValue);
        }

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
          // Degree labels sit along the bottom, so the rows start at the very
          // top and line up with the readout columns' rows.
          const plotBottom = height - STRIP_AXIS_PX;
          // "Now" sits one row below the top, leaving the same empty top row
          // as the readout columns.
          const nowY = READOUT_ROW_PX;
          const xFor = (value) => {
            const clamped = Math.max(scaleMin, Math.min(scaleMax, value));
            return plotLeft + ((clamped - scaleMin) / (scaleMax - scaleMin)) * (plotRight - plotLeft);
          };

          // Row lines, top-aligned like the readout rows.
          ctx.strokeStyle = 'rgba(127,127,127,0.18)';
          ctx.lineWidth = 1;
          for (let y = 0; y < plotBottom; y += READOUT_ROW_PX) {
            ctx.beginPath();
            ctx.moveTo(plotLeft, Math.round(y) + 0.5);
            ctx.lineTo(plotRight, Math.round(y) + 0.5);
            ctx.stroke();
          }

          // Degree gridlines and labels (fixed scale).
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          // Narrow strips label every other gridline (-90, -30, 30, 90) so labels don't collide.
          const labelEvery =
            (plotRight - plotLeft) / ((scaleMax - scaleMin) / gridStep) < 24 ? 2 : 1;
          for (let deg = scaleMin; deg <= scaleMax; deg += gridStep) {
            const labelled = Math.round((deg - scaleMin) / gridStep) % labelEvery === 0;
            const x = Math.round(xFor(deg)) + 0.5;
            ctx.strokeStyle = deg === 0 ? 'rgba(127,127,127,0.7)' : 'rgba(127,127,127,0.28)';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, plotBottom);
            ctx.stroke();
            if (!labelled) {
              continue;
            }
            ctx.fillStyle = textColor;
            ctx.globalAlpha = 0.6;
            ctx.textAlign = deg === scaleMin ? 'left' : deg === scaleMax ? 'right' : 'center';
            ctx.fillText(
              String(deg),
              deg === scaleMin ? plotLeft : deg === scaleMax ? plotRight : x,
              height - 2
            );
            ctx.globalAlpha = 1;
          }

          // Optional limit line (layout `limit: () => value`, e.g. critical AoA).
          const limit = item.limit ? item.limit() : null;
          if (Number.isFinite(limit) && limit >= scaleMin && limit <= scaleMax) {
            const x = Math.round(xFor(limit)) + 0.5;
            ctx.save();
            ctx.strokeStyle = STRIP_LIMIT_COLOR;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, plotBottom);
            ctx.stroke();
            ctx.restore();
          }

          if (!samples.length) {
            titleValue.textContent = '';
            scroll.frame(null);
            view = null;
            return;
          }
          titleValue.textContent = samples[samples.length - 1].value.toFixed(1);

          // Time runs downward: pixels per second = one readout row. The newest
          // sample is "now", so the strip freezes when data stops arriving.
          // Scrolled back (mouse wheel), the top row shows that earlier time.
          const newest = samples[samples.length - 1].timestamp;
          const viewNow = scroll.frame(newest);
          const yFor = (timestamp) => nowY + ((viewNow - timestamp) / 1000) * READOUT_ROW_PX;
          const oldestShown = viewNow - ((plotBottom - nowY) / READOUT_ROW_PX) * 1000;
          view = { newest, viewNow, nowY, plotBottom };

          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, width, plotBottom);
          ctx.clip();
          ctx.strokeStyle = STRIP_TRACE_COLOR;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const shown = scroll.samplesBetween(oldestShown, viewNow + 1000);
          for (let i = shown.length - 1; i >= 0; i--) {
            const y = yFor(shown[i].timestamp);
            const x = xFor(shown[i].value);
            if (i === shown.length - 1) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();

          // Data markers: green dashed lines across the strip.
          dataMarkers.list().forEach((marker) => {
            const y = Math.round(yFor(marker.timestamp)) + 0.5;
            if (y >= 0 && y <= plotBottom) {
              drawMarkerLine(ctx, plotLeft, y, plotRight, y, marker.number);
            }
          });

          // Marker on the most recent value (only while following live data).
          if (scroll.isLive()) {
            const last = samples[samples.length - 1];
            ctx.fillStyle = STRIP_TRACE_COLOR;
            ctx.beginPath();
            ctx.arc(xFor(last.value), nowY, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        // Scroll back in time with the mouse wheel (./timeScroll.js).
        let view = null; // what the last draw showed, for double-click markers
        const scroll = createTimeScroll({
          body,
          canvas,
          samples,
          pxPerSecond: READOUT_ROW_PX,
          request: (start, end) => openmct.telemetry.request(child, { start, end }),
          redraw: scheduleDraw
        });
        cleanups.push(() => scroll.destroy());

        // Double-click: add a data marker at that time (or remove the one there).
        canvas.title = CANVAS_HELP;
        canvas.addEventListener('dblclick', (event) => {
          if (!view) {
            return;
          }
          const y = event.clientY - canvas.getBoundingClientRect().top;
          if (y > view.plotBottom) {
            return; // the degree labels
          }
          const timestamp = Math.min(view.newest, scroll.timeAtY(y, view.nowY, view.viewNow));
          dataMarkers.toggle(timestamp, (MARKER_HIT_PX / READOUT_ROW_PX) * 1000);
        });
        cleanups.push(dataMarkers.onChange(scheduleDraw));

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
        onClearData(child, () => {
          samples.length = 0;
          scroll.reset();
          scheduleDraw();
        });
        if (item.onLimitChange) {
          cleanups.push(item.onLimitChange(scheduleDraw));
        }
        scheduleDraw();

        cleanups.push(() => {
          unsubscribe();
          resizeObserver.disconnect();
        });
      }

      // label (optional): a short title for narrow columns, e.g. 'P-Alt'.
      function buildReadout(grid, child, measurement, span, label) {
        const body = makeCell(grid, span, `${label || measurement.name} (${measurement.units})`);
        body.parentElement.title = `${measurement.name} (${measurement.units})`;
        body.style.justifyContent = 'flex-start'; // rows stack down from the top
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
            // Narrow column: drop the time so the value stays readable.
            if (body.clientWidth && body.clientWidth < READOUT_TIME_MIN_PX) {
              row.style.justifyContent = 'flex-end';
              row.append(value);
            } else {
              row.append(time, value);
            }
          }
          return row;
        }

        function render() {
          const fits = Math.max(1, Math.floor(body.clientHeight / READOUT_ROW_PX));
          const shown = rows.slice(-(fits - 1)).reverse(); // newest first; leave room for the empty top row
          const elements = shown.map((sample, i) => makeRow(sample, i === 0));
          elements.unshift(makeRow(null)); // empty row: everything below is older than "now"
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
        onClearData(child, () => {
          rows.length = 0;
          latest = null;
          render();
        });
        render();

        cleanups.push(() => {
          unsubscribe();
          clearInterval(timer);
          resizeObserver.disconnect();
        });
      }

      function buildTestPointCell(grid, item, feed, settings) {
        const param = params[item.param];
        let title = null;
        let href = null;
        if (item.kind === 'trace') {
          title = `${param.label} (${param.units})`;
          // Title opens the source measurement's full-duration plot.
          href = objectPathToUrl(openmct, [feed.child, ...objectPath], { view: 'plot-single' });
        } else if (item.kind === 'tolerance') {
          title = `${param.label} test point`;
        }
        const body = makeCell(grid, item.span, title, href);
        if (item.kind === 'limitBox') {
          buildLimitBox(body, item.param, feed, settings, cleanups);
        } else if (item.kind === 'trace') {
          buildTrace(body, item.param, feed, settings, cleanups);
        } else {
          buildToleranceBar(body, item.param, feed, settings, cleanups);
        }
      }

      return {
        async show(element) {
          // Dashboard on the left, "Inputs" side panel (if any) on the right.
          const frame = document.createElement('div');
          frame.style.cssText = 'height:100%; width:100%; display:flex; min-height:0;';
          element.append(frame);

          // Left side: screen tabs (if the layout has screens) above the grid.
          const main = document.createElement('div');
          main.style.cssText =
            'flex:1 1 auto; min-width:0; height:100%; display:flex; flex-direction:column;';
          const hasScreens = layout.some((item) => item.screen);
          const tabBar = document.createElement('div');
          tabBar.style.cssText =
            'flex:none; display:flex; align-items:center; gap:4px; padding:0 0 6px; flex-wrap:wrap;';

          const scroller = document.createElement('div');
          scroller.style.cssText =
            'position:relative; flex:1 1 auto; min-height:0; min-width:0; overflow-y:auto; overflow-x:hidden;' +
            (hasScreens ? 'scroll-snap-type:y proximity;' : '');

          const grid = document.createElement('div');
          grid.style.cssText =
            `display:grid; grid-template-columns:repeat(${gridColumns}, minmax(0, 1fr));` +
            `gap:${GAP_PX}px;`;

          scroller.append(grid);
          main.append(tabBar); // screen tabs (if any) and the data-marker controls
          main.append(scroller);

          // Data markers (./dataMarkers.js): count, hint and Clear, on the right of the bar.
          const markerBar = document.createElement('div');
          markerBar.style.cssText =
            'order:1; margin-left:auto; display:flex; align-items:center; gap:8px; white-space:nowrap;';
          const markerHint = document.createElement('span');
          markerHint.textContent =
            'Double-click a chart to mark a time · scroll a chart to look back';
          markerHint.style.cssText = 'opacity:0.6; font-size:0.9em;';
          const markerCount = document.createElement('span');
          markerCount.style.cssText = 'font-weight:bold;';
          const clearMarkers = document.createElement('button');
          clearMarkers.type = 'button';
          clearMarkers.className = 'c-button';
          clearMarkers.textContent = 'Clear markers';
          clearMarkers.title = 'Remove every data marker from every chart';
          clearMarkers.addEventListener('click', () => dataMarkers.clear());
          markerBar.append(markerHint, markerCount, clearMarkers);
          tabBar.append(markerBar);
          function showMarkerCount(list = dataMarkers.list()) {
            markerCount.textContent = `${list.length} marker${list.length === 1 ? '' : 's'}`;
            markerCount.style.color = list.length ? MARKER_COLOR : '';
            markerCount.title = list.length
              ? list.map((m) => `M${m.number}  ${formatTime(m.timestamp)} UTC`).join('\n')
              : 'No data markers yet';
            clearMarkers.disabled = !list.length;
          }
          showMarkerCount();
          cleanups.push(dataMarkers.onChange(showMarkerCount));
          frame.append(main);

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

          const iasKey = testPoint && testPoint.kcasCorrection && testPoint.kcasCorrection.iasKey;
          const keys = [...new Set([...layout.map(sourceKeyOf), ...(iasKey ? [iasKey] : [])])];
          const objects = await Promise.all(
            keys.map((measurementKey) => openmct.objects.get({ namespace, key: measurementKey }))
          );
          if (destroyed) {
            return;
          }
          const objectByKey = new Map(
            keys.map((measurementKey, i) => [measurementKey, objects[i]])
          );

          // Test-point params: one live feed each, shared by all their cells.
          const settings = testPoint
            ? getTestPointSettings(testPoint.settingsId, testPoint.defaults)
            : null;
          const feeds = new Map();
          function feedFor(paramKey, param = params[paramKey]) {
            if (!feeds.has(paramKey)) {
              const child = objectByKey.get(param.source);
              const feed = createParamFeed(openmct, child, param, settings, (callback) =>
                onClearData(child, callback)
              );
              cleanups.push(() => feed.destroy());
              feeds.set(paramKey, feed);
            }
            return feeds.get(paramKey);
          }

          // Side panel sections. To add a future input, add a section here
          // (see ./sidePanel.js).
          if (testPoint) {
            const panel = createSidePanel(testPoint.settingsId);
            if (iasKey) {
              const iasFeed = feedFor(`ias:${iasKey}`, { source: iasKey });
              panel.addSection(
                'IAS → KCAS correction',
                kcasCorrectionSection(settings, iasFeed, cleanups)
              );
            }
            (testPoint.inputSections || []).forEach((section) => {
              panel.addSection(section.title, inputFieldsSection(settings, section, cleanups));
            });
            panel.addSection('Test point limits', testPointResetSection(settings));
            frame.append(panel.element);
          }

          const screens = []; // [{ cell, tab }]
          layout.forEach((item) => {
            if (TEST_POINT_KINDS.has(item.kind)) {
              buildTestPointCell(grid, item, feedFor(item.param), settings);
            } else {
              const child = objectByKey.get(item.key);
              const measurement = measurements.find((m) => m.key === item.key);
              if (item.kind === 'readout') {
                buildReadout(grid, child, measurement, item.span, item.label);
              } else if (item.kind === 'strip') {
                buildStrip(grid, child, measurement, item);
              } else {
                buildPlot(grid, scroller, child, measurement, item.span, item.windowSeconds);
              }
            }
            if (item.rows) {
              grid.lastElementChild.style.gridRow = `span ${item.rows}`;
            }
            if (item.screen) {
              const cell = grid.lastElementChild;
              cell.style.scrollSnapAlign = 'start';
              const tab = document.createElement('button');
              tab.type = 'button';
              tab.className = 'c-button';
              tab.textContent = item.screen;
              tab.title = `Go to the ${item.screen} screen`;
              tab.addEventListener('click', () =>
                scroller.scrollTo({ top: cell.offsetTop - grid.offsetTop, behavior: 'smooth' })
              );
              tabBar.append(tab);
              screens.push({ cell, tab });
            }
          });

          // Highlight the tab of the screen at the top of the view.
          function markActiveTab() {
            const top = scroller.scrollTop + grid.offsetTop + 20;
            let active = screens[0];
            screens.forEach((screen) => {
              if (screen.cell.offsetTop <= top) {
                active = screen;
              }
            });
            screens.forEach((screen) => {
              const on = screen === active;
              screen.tab.style.fontWeight = on ? 'bold' : 'normal';
              screen.tab.style.outline = on ? '2px solid #43b0ff' : 'none';
            });
          }
          if (screens.length) {
            scroller.addEventListener('scroll', markActiveTab, { passive: true });
            markActiveTab();
          }
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
