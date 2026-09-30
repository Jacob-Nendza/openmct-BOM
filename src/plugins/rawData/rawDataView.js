/*
 * The view you see when you click "Raw Data" in a platform folder: every
 * recorded sample in columns, one column per measurement, newest row at the
 * TOP (same direction as the dashboard readouts).
 *
 * Only the rows that fit on screen are actually drawn, so this stays fast
 * even with hours of data. While you're scrolled to the top it follows live
 * data; scroll down to read older rows and the view holds still (new rows
 * are added above without pushing what you're reading). Scroll back to the
 * top to follow live again.
 */

import { DEFAULT_DECIMALS } from '../flightDashboard/dashboardView.js';
import { getRecorder } from './recorder.js';

export const RAW_DATA_TYPE = 'flight.rawData';

const ROW_PX = 22;
const TIME_COL_PX = 110;
const VALUE_COL_PX = 110;
const OVERSCAN_ROWS = 10; // extra rows drawn above/below the visible area

function formatTime(timestamp) {
  return new Date(timestamp).toISOString().slice(11, 23); // HH:MM:SS.mmm UTC
}

// The sticky header needs a solid background; borrow the nearest one.
function solidBackground(element) {
  for (let el = element; el; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) {
      return color;
    }
  }
  return '#393939';
}

export default function RawDataViewProvider() {
  return {
    key: 'flight.rawData.view',
    name: 'Raw Data',
    cssClass: 'icon-tabular',

    canView(domainObject) {
      return domainObject.type === RAW_DATA_TYPE;
    },

    view(domainObject) {
      const recorder = getRecorder(domainObject.rawData.source);
      const measurements = recorder.measurements;
      const gridColumns = `${TIME_COL_PX}px repeat(${measurements.length}, ${VALUE_COL_PX}px)`;
      const totalWidth = TIME_COL_PX + measurements.length * VALUE_COL_PX;

      let scroller;
      let header;
      let status;
      let body;
      let rendered = { first: -1, last: -1, count: -1 };
      let lastCount = 0;
      let unsubscribe = () => {};
      let resizeObserver;

      function cellStyle(align) {
        return (
          `padding:0 6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:${align};` +
          'border-right:1px solid rgba(127,127,127,0.15);'
        );
      }

      function buildHeader() {
        header = document.createElement('div');
        header.style.cssText =
          `position:sticky; top:0; z-index:1; display:grid; grid-template-columns:${gridColumns};` +
          `width:${totalWidth}px; font-weight:bold; line-height:1.3;` +
          'border-bottom:1px solid rgba(127,127,127,0.5);';

        const cells = [['Time (UTC)', '']].concat(
          measurements.map((m) => [m.name, m.units ? `(${m.units})` : ''])
        );
        cells.forEach(([name, units], i) => {
          const cell = document.createElement('div');
          cell.style.cssText = cellStyle(i === 0 ? 'left' : 'right') + 'padding:4px 6px; white-space:normal;';
          cell.title = `${name} ${units}`.trim();
          cell.textContent = name;
          if (units) {
            const u = document.createElement('div');
            u.textContent = units;
            u.style.cssText = 'font-weight:normal; opacity:0.6;';
            cell.append(u);
          }
          header.append(cell);
        });
      }

      function makeRow(row, isNewest) {
        const el = document.createElement('div');
        el.style.cssText =
          `display:grid; grid-template-columns:${gridColumns}; height:${ROW_PX}px; line-height:${ROW_PX}px;` +
          'border-bottom:1px solid rgba(127,127,127,0.12); font-variant-numeric:tabular-nums;' +
          (isNewest ? 'font-weight:bold;' : '');

        const time = document.createElement('div');
        time.style.cssText = cellStyle('left') + 'opacity:0.6;';
        time.textContent = formatTime(row.timestamp);
        el.append(time);

        measurements.forEach((m) => {
          const cell = document.createElement('div');
          cell.style.cssText = cellStyle('right');
          const value = row.values[m.key];
          if (value !== undefined) {
            cell.textContent = value.toFixed(DEFAULT_DECIMALS[m.key] ?? 2);
          }
          el.append(cell);
        });
        return el;
      }

      function render(force) {
        const rows = recorder.rows;
        const count = rows.length;

        // New rows go on top. If you've scrolled down to read, shift the
        // scroll position by the same amount so your rows don't move.
        const added = count - lastCount;
        if (added > 0 && lastCount > 0 && scroller.scrollTop > 0) {
          scroller.scrollTop += added * ROW_PX;
        }
        lastCount = count;

        body.style.height = `${count * ROW_PX}px`;
        status.textContent = count
          ? `${count.toLocaleString()} rows recorded` +
            (recorder.droppedRows ? ` (oldest ${recorder.droppedRows.toLocaleString()} dropped)` : '') +
            ' - newest at top. Export from the ⋯ menu.'
          : 'No data recorded yet. Pick a source in the Source dropdown to start streaming.';

        const viewTop = Math.max(0, scroller.scrollTop - header.offsetHeight - status.offsetHeight);
        const first = Math.max(0, Math.floor(viewTop / ROW_PX) - OVERSCAN_ROWS);
        const last = Math.min(
          count,
          Math.ceil((viewTop + scroller.clientHeight) / ROW_PX) + OVERSCAN_ROWS
        );
        if (!force && first === rendered.first && last === rendered.last && count === rendered.count) {
          return;
        }
        rendered = { first, last, count };

        // Display position i shows rows[count - 1 - i] (newest first).
        const fragment = document.createDocumentFragment();
        for (let i = first; i < last; i++) {
          const el = makeRow(rows[count - 1 - i], i === 0);
          el.style.position = 'absolute';
          el.style.top = `${i * ROW_PX}px`;
          el.style.left = '0';
          fragment.append(el);
        }
        body.replaceChildren(fragment);
      }

      return {
        show(element) {
          scroller = document.createElement('div');
          // overflow-anchor:none - we keep your place ourselves (see render()).
          scroller.style.cssText = 'height:100%; width:100%; overflow:auto; overflow-anchor:none;';

          status = document.createElement('div');
          status.style.cssText = 'padding:2px 6px 6px; opacity:0.7; white-space:nowrap;';

          buildHeader();

          body = document.createElement('div');
          body.style.cssText = `position:relative; width:${totalWidth}px;`;

          scroller.append(status, header, body);
          element.append(scroller);
          header.style.background = solidBackground(element);

          scroller.addEventListener('scroll', () => render(false));
          resizeObserver = new ResizeObserver(() => render(false));
          resizeObserver.observe(scroller);
          unsubscribe = recorder.onChange(() => render(true));
          render(true);
        },

        destroy() {
          unsubscribe();
          if (resizeObserver) {
            resizeObserver.disconnect();
          }
        }
      };
    }
  };
}
