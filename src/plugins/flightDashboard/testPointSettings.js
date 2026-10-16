/*
 * Test-point settings: the numbers YOU type into the dashboard.
 *
 *   limits      - aircraft limits (MAX / MIN) next to the KCAS and NZ boxes.
 *                 They color the boxes red/green and draw the red lines on
 *                 the vertical time-history charts.
 *   tolerances  - test-point center value and +/- for the tolerance bars.
 *   kcasTable   - the IAS -> KCAS correction table from the side panel.
 *
 * Everything is saved in the browser (localStorage), so it survives a page
 * reload. The first time, the platform's defaults are used (for the BOM:
 * ../bomData/dashboardView.js).
 *
 *   const settings = getTestPointSettings('bom', DEFAULTS);
 *   settings.get().limits.kcas.max          // 600
 *   settings.setLimit('kcas', 'max', 550);
 *   const stop = settings.onChange(redraw); // call stop() when done
 *   settings.kcasFromKias(152);             // corrected airspeed
 */

const STORAGE_PREFIX = 'flightDashboard.testPoint.';

const stores = new Map(); // id -> store (one per platform, shared by every cell)

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function load(id) {
  try {
    const text = window.localStorage.getItem(STORAGE_PREFIX + id);
    return text ? JSON.parse(text) : null;
  } catch (error) {
    return null; // storage blocked or corrupt: just use the defaults
  }
}

function save(id, state) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(state));
  } catch (error) {
    // storage blocked: the values still work, they just won't survive a reload
  }
}

// Saved values win, but anything missing (e.g. a parameter added later) falls
// back to the defaults.
function merge(defaults, saved) {
  const state = clone(defaults);
  if (!saved || typeof saved !== 'object') {
    return state;
  }
  ['limits', 'tolerances'].forEach((group) => {
    Object.keys(state[group] || {}).forEach((param) => {
      const savedParam = saved[group] && saved[group][param];
      if (savedParam && typeof savedParam === 'object') {
        Object.keys(state[group][param]).forEach((field) => {
          if (Number.isFinite(savedParam[field])) {
            state[group][param][field] = savedParam[field];
          }
        });
      }
    });
  });
  if (Array.isArray(saved.kcasTable)) {
    state.kcasTable = saved.kcasTable.map((row) => ({
      kias: Number.isFinite(row && row.kias) ? row.kias : null,
      kcas: Number.isFinite(row && row.kcas) ? row.kcas : null
    }));
  }
  return state;
}

/*
 * IAS -> KCAS from a table of calibration points (e.g. the POH airspeed
 * calibration table, or your own flight-test results).
 *   - no points:        KCAS = KIAS
 *   - between points:   straight-line interpolation
 *   - beyond the ends:  the end point's correction (KCAS - KIAS) is held
 *   - one point:        that correction applies everywhere (a fixed offset)
 * Rows with a blank KIAS or KCAS are ignored.
 */
export function kcasFromKias(kias, table) {
  const points = (table || [])
    .filter((row) => Number.isFinite(row.kias) && Number.isFinite(row.kcas))
    .sort((a, b) => a.kias - b.kias);
  if (!Number.isFinite(kias) || !points.length) {
    return kias;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (kias <= first.kias) {
    return kias + (first.kcas - first.kias);
  }
  if (kias >= last.kias) {
    return kias + (last.kcas - last.kias);
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (kias <= b.kias) {
      const fraction = b.kias === a.kias ? 0 : (kias - a.kias) / (b.kias - a.kias);
      return a.kcas + fraction * (b.kcas - a.kcas);
    }
  }
  return kias;
}

function createStore(id, defaults) {
  let state = merge(defaults, load(id));
  const listeners = new Set();

  function changed() {
    save(id, state);
    listeners.forEach((listener) => listener(state));
  }

  return {
    get() {
      return state;
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setLimit(param, field, value) {
      state.limits[param][field] = value;
      changed();
    },

    setTolerance(param, field, value) {
      state.tolerances[param][field] = value;
      changed();
    },

    setKcasTable(rows) {
      state.kcasTable = rows.map((row) => ({ kias: row.kias, kcas: row.kcas }));
      changed();
    },

    // Limits and tolerances back to the platform defaults (the KCAS table is kept).
    resetTestPoint() {
      const fresh = clone(defaults);
      state.limits = fresh.limits;
      state.tolerances = fresh.tolerances;
      changed();
    },

    kcasFromKias(kias) {
      return kcasFromKias(kias, state.kcasTable);
    }
  };
}

export function getTestPointSettings(id, defaults) {
  if (!stores.has(id)) {
    stores.set(id, createStore(id, { kcasTable: [], ...defaults }));
  }
  return stores.get(id);
}
