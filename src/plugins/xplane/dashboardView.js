/*
 * X-Plane dashboard: the view you see when you click the "X-Plane Aircraft"
 * folder.
 *
 * The display area is an 8-column grid. Each row is half the height of the
 * display area, so the first two rows fill the screen:
 *
 *   ┌──────────── Altitude ────────────┬────────── Indicated Airspeed ──────────┐
 *   ├──── Pitch ─────┬───── Roll ──────┼─ Alt ─┬─ IAS ─┬─ Pitch ─┬─ Roll ──────┤  <- readout columns
 *   └────────────────┴─────────────────┴───────┴───────┴─────────┴─────────────┘
 *   (scroll down)  Heading | Vertical Speed | Latitude | Longitude
 *
 * Plots are Open MCT's own plot views (zoom, pan, hover values, legend all
 * work). Click a plot's title to open it full size. Plots scrolled out of
 * sight pause drawing until they're visible again.
 *
 * Readout columns list recent values, newest at the bottom, one new row every
 * READOUT_INTERVAL_MS. The bottom row is always left empty, so the row just
 * above it is the most recent value. No new rows are added while no data is
 * arriving (source Off, or X-Plane paused).
 *
 * The folder's usual Grid and List views are still in the view switcher.
 */

import { objectPathToUrl } from '../../tools/url.js';
import VisibilityObserver from '../../utils/visibility/VisibilityObserver.js';
import { AIRCRAFT_FOLDER_KEY, measurements, NAMESPACE } from './dictionary.js';

// The dashboard, cell by cell, left-to-right then top-to-bottom.
// span = how many of the 8 grid columns the cell is wide.
const LAYOUT = [
  { key: 'altitude', kind: 'plot', span: 4 },
  { key: 'airspeed', kind: 'plot', span: 4 },

  { key: 'pitch', kind: 'plot', span: 2 },
  { key: 'roll', kind: 'plot', span: 2 },
  { key: 'altitude', kind: 'readout', span: 1 },
  { key: 'airspeed', kind: 'readout', span: 1 },
  { key: 'pitch', kind: 'readout', span: 1 },
  { key: 'roll', kind: 'readout', span: 1 },

  { key: 'heading', kind: 'plot', span: 4 },
  { key: 'vertical_speed', kind: 'plot', span: 4 },
  { key: 'latitude', kind: 'plot', span: 4 },
  { key: 'longitude', kind: 'plot', span: 4 }
];

const GRID_COLUMNS = 8;
const GAP_PX = 6;
const MIN_ROW_PX = 200; // on very short windows, rows stop shrinking and you scroll instead

const READOUT_INTERVAL_MS = 1000; // one new readout row per second
const READOUT_ROW_PX = 22;
const READOUT_HISTORY = 300; // rows kept per column (older ones drop off the top)
const DECIMALS = { altitude: 0, airspeed: 1, pitch: 1, roll: 1, latitude: 5, longitude: 5 };

const CELL_STYLE =
  'display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden;' +
  'border:1px solid rgba(127,127,127,0.25); border-radius:3px; padding:4px;';
const TITLE_STYLE =
  'flex:none; font-weight:bold; padding:0 2px 4px; white-space:nowrap; overflow:hidden;' +
  'text-overflow:ellipsis; text-decoration:none;';

function formatTime(timestamp) {
  return new Date(timestamp).toISOString().slice(11, 19); // HH:MM:SS UTC, like the time axis
}

export default function XPlaneDashboardViewProvider(openmct) {
  return {
    key: 'xplane.dashboard',
    name: 'Dashboard',
    cssClass: 'icon-layout',

    canView(domainObject) {
      return (
        domainObject.identifier.namespace === NAMESPACE &&
        domainObject.identifier.key === AIRCRAFT_FOLDER_KEY
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

      function buildReadout(grid, child, measurement, span) {
        const body = makeCell(grid, span, `${measurement.name} (${measurement.units})`);
        body.style.justifyContent = 'flex-end'; // rows stack up from the bottom
        body.style.overflow = 'hidden';
        body.style.fontVariantNumeric = 'tabular-nums';

        const decimals = DECIMALS[measurement.key] ?? 2;
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

          const keys = [...new Set(LAYOUT.map((item) => item.key))];
          const objects = await Promise.all(
            keys.map((key) => openmct.objects.get({ namespace: NAMESPACE, key }))
          );
          if (destroyed) {
            return;
          }
          const objectByKey = new Map(keys.map((key, i) => [key, objects[i]]));

          LAYOUT.forEach((item) => {
            const child = objectByKey.get(item.key);
            const measurement = measurements.find((m) => m.key === item.key);
            if (item.kind === 'readout') {
              buildReadout(grid, child, measurement, item.span);
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
