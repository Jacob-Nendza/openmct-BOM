/*
 * "Inputs" side panel on the right of the flight dashboard: the place for
 * settings you type in that aren't tied to one display.
 *
 * It can be collapsed with the tab on its left edge (remembered per browser).
 * Each block in it is a "section":
 *
 *   const panel = createSidePanel('bom');
 *   panel.addSection('IAS -> KCAS correction', (body) => { ...build inputs in body... });
 *
 * TO ADD A NEW INPUT LATER: write a function like kcasCorrectionSection()
 * below, then call panel.addSection(...) with it in ./dashboardView.js (look
 * for "Side panel sections"). Save the values in ./testPointSettings.js so
 * they survive a reload.
 */

import { numberInput } from './testPointCells.js';

const PANEL_WIDTH_PX = 270;
const COLLAPSED_KEY_PREFIX = 'flightDashboard.sidePanelCollapsed.';

function readCollapsed(id) {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY_PREFIX + id) === 'true';
  } catch (error) {
    return false;
  }
}

function writeCollapsed(id, collapsed) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY_PREFIX + id, String(collapsed));
  } catch (error) {
    // storage blocked: the panel just won't remember being collapsed
  }
}

function smallButton(text, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.title = title || '';
  button.className = 'c-button';
  button.style.cssText = 'padding:2px 8px; font-size:0.95em;';
  return button;
}

export function createSidePanel(id) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'flex:none; display:flex; height:100%; min-height:0;';

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.style.cssText =
    'flex:none; width:22px; padding:0; border:none; cursor:pointer; color:inherit;' +
    'background:rgba(127,127,127,0.15); border-radius:3px 0 0 3px; writing-mode:vertical-rl;' +
    'font-weight:bold; letter-spacing:1px;';

  const panel = document.createElement('div');
  panel.style.cssText =
    `flex:none; width:${PANEL_WIDTH_PX}px; height:100%; overflow-y:auto; box-sizing:border-box;` +
    'padding:6px 8px; border-left:1px solid rgba(127,127,127,0.3);' +
    'display:flex; flex-direction:column; gap:10px;';

  const heading = document.createElement('div');
  heading.textContent = 'Inputs';
  heading.style.cssText = 'font-weight:bold; font-size:1.15em;';
  panel.append(heading);

  wrapper.append(tab, panel);

  let collapsed = readCollapsed(id);
  function applyCollapsed() {
    panel.style.display = collapsed ? 'none' : 'flex';
    tab.textContent = collapsed ? '◀ Inputs' : '▶';
    tab.title = collapsed ? 'Show the Inputs panel' : 'Hide the Inputs panel';
  }
  tab.addEventListener('click', () => {
    collapsed = !collapsed;
    writeCollapsed(id, collapsed);
    applyCollapsed();
  });
  applyCollapsed();

  return {
    element: wrapper,

    addSection(title, build) {
      const section = document.createElement('section');
      section.style.cssText =
        'display:flex; flex-direction:column; gap:6px; padding:6px;' +
        'border:1px solid rgba(127,127,127,0.25); border-radius:3px;';
      const sectionTitle = document.createElement('div');
      sectionTitle.textContent = title;
      sectionTitle.style.cssText = 'font-weight:bold;';
      const body = document.createElement('div');
      body.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
      section.append(sectionTitle, body);
      panel.append(section);
      build(body);
    }
  };
}

function note(text) {
  const div = document.createElement('div');
  div.textContent = text;
  div.style.cssText = 'opacity:0.7; font-size:0.9em; line-height:1.3;';
  return div;
}

/*
 * IAS -> KCAS correction table. Each row is one calibration point (e.g. from
 * the POH's airspeed calibration table): at this KIAS, the airplane is
 * really doing this KCAS. See kcasFromKias() in ./testPointSettings.js.
 * `iasFeed` (optional, indicated airspeed) shows the live conversion under the table.
 */
export function kcasCorrectionSection(settings, iasFeed, cleanups) {
  return (body) => {
    body.append(
      note(
        'Calibration points (KIAS → KCAS). Values between points are ' +
          'interpolated; past the ends the end correction is held. ' +
          'One point = a fixed offset. No points = KCAS equals KIAS.'
      )
    );

    const table = document.createElement('div');
    table.style.cssText =
      'display:grid; grid-template-columns:1fr 1fr auto; gap:4px 6px; align-items:center;';
    const addButton = smallButton('+ Add point', 'Add a calibration point');
    const live = document.createElement('div');
    live.style.cssText = 'font-variant-numeric:tabular-nums;';
    body.append(table, addButton, live);

    const rows = () => settings.get().kcasTable;

    function updateRow(index, field, value) {
      const next = rows().map((row) => ({ ...row }));
      next[index][field] = value;
      settings.setKcasTable(next);
    }

    function renderTable() {
      const header = ['KIAS', 'KCAS', ''].map((text) => {
        const div = document.createElement('div');
        div.textContent = text;
        div.style.cssText = 'font-weight:bold; text-align:center;';
        return div;
      });
      const cells = [];
      rows().forEach((row, index) => {
        const kias = numberInput(
          () => rows()[index] && rows()[index].kias,
          (v) => updateRow(index, 'kias', v),
          { width: 90, allowBlank: true }
        );
        const kcas = numberInput(
          () => rows()[index] && rows()[index].kcas,
          (v) => updateRow(index, 'kcas', v),
          { width: 90, allowBlank: true }
        );
        const remove = smallButton('✕', 'Remove this point');
        remove.addEventListener('click', () => {
          settings.setKcasTable(rows().filter((_, i) => i !== index));
        });
        cells.push(kias.element, kcas.element, remove);
      });
      table.replaceChildren(...header, ...cells);
      if (!rows().length) {
        const empty = note('No points: KCAS = KIAS.');
        empty.style.gridColumn = '1 / -1';
        table.append(empty);
      }
    }

    function renderLive() {
      if (!iasFeed) {
        live.textContent = '';
        return;
      }
      const kias = iasFeed.latest();
      live.textContent = Number.isFinite(kias)
        ? `Now: ${kias.toFixed(1)} KIAS → ${settings.kcasFromKias(kias).toFixed(1)} KCAS`
        : 'Now: no airspeed data';
    }

    addButton.addEventListener('click', () => {
      settings.setKcasTable([...rows(), { kias: null, kcas: null }]);
    });

    // Rebuild the table only when its rows change, so typing isn't interrupted.
    let lastTable = '';
    function onSettings() {
      const text = JSON.stringify(rows());
      if (text !== lastTable) {
        lastTable = text;
        renderTable();
      }
      renderLive();
    }
    cleanups.push(settings.onChange(onSettings));
    if (iasFeed) {
      cleanups.push(iasFeed.onUpdate(renderLive));
    }
    onSettings();
  };
}

// "Reset" button for the MAX/MIN and center/+/- boxes on the dashboard.
export function testPointResetSection(settings) {
  return (body) => {
    body.append(
      note(
        'MAX/MIN limits and test-point center/± are typed on the dashboard and saved in this browser.'
      )
    );
    const reset = smallButton(
      'Reset to defaults',
      'Put every MAX/MIN and center/± back to its default'
    );
    reset.addEventListener('click', () => settings.resetTestPoint());
    body.append(reset);
  };
}
