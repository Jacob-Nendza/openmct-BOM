/*
 * Theme Selector plugin: the "Theme" dropdown in Open MCT's top bar.
 *
 * Replaces the fixed openmct.plugins.Espresso() line in index.html. On startup
 * it loads the theme you picked last time (saved in this browser), or Default
 * if you never picked one. Choosing a new option switches the colors right away,
 * no reload needed.
 *
 * To add or rename a scheme, edit the THEMES list below. Each `id` must match:
 *   - a webpack entry named `<id>Theme` in .webpack/webpack.common.mjs
 *   - a stylesheet src/plugins/themes/<id>-theme.scss
 * (Default uses the built-in Espresso theme, so it needs no new files.)
 */

import { installTheme } from '../themes/installTheme.js';

const THEMES = [
  { id: 'espresso', label: 'Default' },
  { id: 'daylight', label: 'Daylight' },
  { id: 'lowlight', label: 'Lowlight' }
];

const STORAGE_KEY = 'openmct-bom-theme';

function loadSavedTheme() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.some((theme) => theme.id === saved) ? saved : THEMES[0].id;
  } catch (e) {
    return THEMES[0].id;
  }
}

function saveTheme(id) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch (e) {
    // Storage blocked (e.g. private window): the choice just won't be remembered.
  }
}

export default function ThemeSelectorPlugin() {
  return function install(openmct) {
    let current = loadSavedTheme();
    installTheme(openmct, current);

    const element = document.createElement('div');
    element.className = 'c-indicator icon-brightness s-status-on';
    element.style.gap = '6px';
    element.title = 'Color theme';

    const label = document.createElement('span');
    label.className = 'c-indicator__label';
    label.style.display = 'inline';
    label.textContent = 'Theme';

    const select = document.createElement('select');
    select.style.fontSize = 'inherit';
    select.style.padding = '1px 4px';
    select.setAttribute('aria-label', 'Color theme');
    THEMES.forEach((theme) => select.append(new Option(theme.label, theme.id)));
    select.value = current;

    select.addEventListener('change', function () {
      if (select.value === current) {
        return;
      }

      current = select.value;
      saveTheme(current);
      installTheme(openmct, current);
    });

    element.append(label, select);

    openmct.indicators.add({
      key: 'theme-selector',
      element,
      priority: openmct.priority.HIGH
    });
  };
}
