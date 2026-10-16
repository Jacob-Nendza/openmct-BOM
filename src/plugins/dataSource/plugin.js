/*
 * Data Source plugin: the "Source" dropdown in Open MCT's top bar.
 *
 * The telemetry bridge starts idle and runs at most one data source at a
 * time. This dropdown is the only thing that switches it, so clicking around
 * the object tree (X-Plane folder, BOM folder, ...) never changes where data
 * comes from. That protects a recording from being cut off by a misclick.
 *
 * Options come from the bridge itself (xplane-bridge/sources/index.js), so
 * adding a source there makes it appear here automatically.
 *
 * Also adds the "Rate" indicator next to it: how many updates per second are
 * arriving from the selected source (./dataRateIndicator.js).
 *
 * Install this BEFORE the platform plugins (XPlane, BOMData) in index.html.
 */

import bridgeClient from './bridgeClient.js';
import dataClock from './dataClock.js';
import installDataRateIndicator from './dataRateIndicator.js';

const STATUS_CLASSES = ['s-status-on', 's-status-off', 's-status-disabled'];

export default function DataSourcePlugin() {
  return function install(openmct) {
    const element = document.createElement('div');
    element.className = 'c-indicator icon-connectivity s-status-off';
    element.style.gap = '6px';

    const label = document.createElement('span');
    label.className = 'c-indicator__label';
    label.style.display = 'inline';
    label.textContent = 'Source';

    const select = document.createElement('select');
    select.style.fontSize = 'inherit';
    select.style.padding = '1px 4px';
    select.setAttribute('aria-label', 'Telemetry data source');

    element.append(label, select);

    select.addEventListener('change', function () {
      bridgeClient.select(select.value || null);
    });

    function render(state) {
      select.replaceChildren();

      if (!state.connected) {
        select.append(new Option('Bridge offline', ''));
        select.disabled = true;
        element.title = 'Cannot reach the telemetry bridge. Is "npm start" running?';
      } else {
        select.append(new Option('Off', ''));
        state.available.forEach((source) => select.append(new Option(source.name, source.id)));
        select.value = state.active || '';
        select.disabled = false;

        const activeName = (state.available.find((s) => s.id === state.active) || {}).name;
        element.title = activeName
          ? `Streaming from ${activeName}. Choose Off to stop.`
          : 'Bridge idle. Choose a source to start streaming.';
      }

      element.classList.remove(...STATUS_CLASSES);
      element.classList.add(
        !state.connected ? 's-status-disabled' : state.active ? 's-status-on' : 's-status-off'
      );
    }

    openmct.indicators.add({
      key: 'data-source-selector',
      element,
      priority: openmct.priority.HIGH
    });

    // "Rate: 15.2 Hz" next to the Source dropdown.
    installDataRateIndicator(openmct);

    // Time since data flow began, on every chart; resets with Clear Data.
    dataClock.install(openmct);

    bridgeClient.onChange(render);
    bridgeClient.connect();
  };
}
