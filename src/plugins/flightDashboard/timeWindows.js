/*
 * Plot time windows for the flight-data measurements (BOM, X-Plane, ...).
 *
 *   - On a dashboard, every plot shows a moving 2-minute window
 *     (DASHBOARD_WINDOW_S), so data scrolls by at a readable pace instead of
 *     bunching up in the Time Conductor's 15-minute window.
 *   - Opened on its own ("expanded": click a dashboard plot's title, or the
 *     measurement in the tree), the plot shows the FULL duration of the data:
 *     from when data flow began (../dataSource/dataClock.js) up to now. The
 *     window grows as the flight goes on, and shrinks back after Clear Data.
 *
 * Open MCT keys a plot's own time window by the measurement object, so the
 * dashboard and the expanded view would fight over the same setting. This
 * controller is the one place that decides which applies: expanded wins while
 * it's open, then the dashboard window, otherwise the Time Conductor.
 *
 *   const windows = getTimeWindows(openmct);
 *   windows.expandToFullDuration('bom.telemetry');                  // at plugin install
 *   const release = windows.holdDashboardWindow(child, childPath);  // dashboard plot
 */

import dataClock from '../dataSource/dataClock.js';

export const DASHBOARD_WINDOW_S = 120; // dashboard plots: last 2 minutes
const LEAD_MS = 1000; // empty space right of "now"
const MIN_FULL_WINDOW_MS = DASHBOARD_WINDOW_S * 1000; // expanded view is never shorter than this
const FULL_GROWTH = 1.5; // when the data outgrows the window, make it this much bigger
const CHECK_EVERY_MS = 1000;

const controllers = new WeakMap(); // openmct -> controller

function createController(openmct) {
  const entries = new Map(); // keyString -> state
  const fullDurationTypes = new Set();
  let expandedKey = null;
  let timer = null;

  function entryFor(keyString, objectPath) {
    if (!entries.has(keyString)) {
      entries.set(keyString, {
        dashboardHolds: 0,
        dashboardSeconds: DASHBOARD_WINDOW_S,
        objectPath,
        applied: null, // JSON of the offsets currently applied, or null = following the Time Conductor
        release: null,
        fullWindowMs: 0
      });
    }
    const entry = entries.get(keyString);
    entry.objectPath = objectPath || entry.objectPath;
    return entry;
  }

  function fullDurationOffsets(entry, fromScratch) {
    const now = Date.now();
    const neededMs = (dataClock.start === null ? 0 : now - dataClock.start) + 5000;
    if (fromScratch || entry.fullWindowMs < neededMs) {
      entry.fullWindowMs = Math.max(MIN_FULL_WINDOW_MS, Math.round(neededMs * FULL_GROWTH));
    }
    return { start: -entry.fullWindowMs, end: LEAD_MS };
  }

  function apply(keyString, fromScratch = false) {
    const entry = entries.get(keyString);
    if (!entry) {
      return;
    }

    let offsets = null;
    if (expandedKey === keyString) {
      offsets = fullDurationOffsets(entry, fromScratch);
    } else if (entry.dashboardHolds > 0) {
      offsets = { start: -entry.dashboardSeconds * 1000, end: LEAD_MS };
    }

    const wanted = offsets && JSON.stringify(offsets);
    if (wanted === entry.applied) {
      return;
    }

    if (!offsets) {
      if (entry.release) {
        entry.release(); // back to following the Time Conductor
      }
      entry.release = null;
      entry.applied = null;
      return;
    }

    openmct.time.getContextForView(entry.objectPath); // make sure the view's context exists
    entry.release = openmct.time.addIndependentContext(keyString, offsets, 'local');
    entry.applied = wanted;
  }

  // Expanded view: keep the window wide enough to hold all the data.
  function tick() {
    if (expandedKey) {
      apply(expandedKey);
    }
  }

  // Clear Data (or first data): recompute the expanded window from scratch.
  dataClock.onChange(() => {
    if (expandedKey) {
      apply(expandedKey, true);
    }
  });

  openmct.router.on('afterNavigation', () => {
    const path = openmct.router.path || [];
    const navigated = path[0];
    const previous = expandedKey;

    expandedKey =
      navigated && fullDurationTypes.has(navigated.type)
        ? openmct.objects.makeKeyString(navigated.identifier)
        : null;

    if (previous && previous !== expandedKey) {
      apply(previous);
    }
    if (expandedKey) {
      entryFor(expandedKey, path);
      apply(expandedKey, true);
      if (!timer) {
        timer = setInterval(tick, CHECK_EVERY_MS);
      }
    } else if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  return {
    // Measurements of this type show their full duration when opened on their own.
    expandToFullDuration(type) {
      fullDurationTypes.add(type);
    },

    // A dashboard plot is showing this measurement: use the short moving
    // window (unless it's also open expanded). Returns release().
    holdDashboardWindow(domainObject, objectPath, seconds = DASHBOARD_WINDOW_S) {
      const keyString = openmct.objects.makeKeyString(domainObject.identifier);
      const entry = entryFor(keyString, objectPath);
      entry.dashboardHolds++;
      entry.dashboardSeconds = seconds;
      apply(keyString);

      let released = false;
      return () => {
        if (!released) {
          released = true;
          entry.dashboardHolds--;
          apply(keyString);
        }
      };
    }
  };
}

export function getTimeWindows(openmct) {
  if (!controllers.has(openmct)) {
    controllers.set(openmct, createController(openmct));
  }
  return controllers.get(openmct);
}
