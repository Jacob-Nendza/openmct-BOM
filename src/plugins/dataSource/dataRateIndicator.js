/*
 * Data Rate indicator: shows how fast data is arriving (e.g. "15.2 Hz") in
 * Open MCT's top bar, next to the Source dropdown.
 *
 * What it counts: updates (packets) per second from the source picked in the
 * Source dropdown. The bridge stamps every value it decodes from one UDP
 * packet with the same timestamp, so one distinct timestamp = one update.
 * That's the same thing as one row in the Raw Data table / CSV export, so the
 * number here matches the rate you'd measure from an export (~15 Hz for the BOM).
 *
 * How it's measured: over the last WINDOW_MS of data, (updates - 1) divided
 * by the time between the first and last of them, using the bridge's own
 * timestamps. That keeps Wi-Fi "bunching" (packets arriving in bursts) from
 * making the number jump around.
 *
 * If nothing arrives for WINDOW_MS, it shows "No data". Hover for details.
 *
 * Installed by ./plugin.js (the Data Source plugin), so nothing to add in index.html.
 */

import bridgeClient from './bridgeClient.js';

const WINDOW_MS = 3000; // how much recent data the rate is averaged over
const REFRESH_MS = 500; // how often the number on screen updates

const STATUS_CLASSES = ['s-status-on', 's-status-off', 's-status-disabled'];

export default function installDataRateIndicator(openmct) {
  const element = document.createElement('div');
  element.className = 'c-indicator icon-telemetry s-status-off';
  element.style.gap = '6px';

  const label = document.createElement('span');
  label.className = 'c-indicator__label';
  label.style.display = 'inline';
  label.textContent = 'Rate';

  const value = document.createElement('span');
  value.style.fontVariantNumeric = 'tabular-nums';
  value.style.minWidth = '5.5em';
  value.textContent = '--';

  element.append(label, value);

  // Recent updates from the active source: [{ timestamp (bridge clock), arrivedAt (browser clock) }]
  let updates = [];
  let lastTimestamp = null;
  let activeSource = null;

  function sourceName() {
    const source = bridgeClient.state.available.find((s) => s.id === activeSource);
    return source ? source.name : activeSource;
  }

  bridgeClient.onChange((state) => {
    if (state.active !== activeSource) {
      activeSource = state.active;
      updates = [];
      lastTimestamp = null;
    }
  });

  bridgeClient.onSample((sample) => {
    if (sample.source !== activeSource || sample.timestamp === lastTimestamp) {
      return; // another source, or another value from the same packet
    }
    lastTimestamp = sample.timestamp;
    updates.push({ timestamp: sample.timestamp, arrivedAt: performance.now() });
  });

  function setStatus(statusClass, text, title) {
    element.classList.remove(...STATUS_CLASSES);
    element.classList.add(statusClass);
    value.textContent = text;
    element.title = title;
  }

  function render() {
    const cutoff = performance.now() - WINDOW_MS;
    while (updates.length && updates[0].arrivedAt < cutoff) {
      updates.shift();
    }

    if (!bridgeClient.state.connected) {
      setStatus('s-status-disabled', '--', 'Bridge offline - no data rate to show.');
      return;
    }
    if (!activeSource) {
      setStatus('s-status-off', '--', 'No source selected. Pick one from the Source dropdown.');
      return;
    }
    if (updates.length < 2) {
      setStatus(
        's-status-off',
        'No data',
        `${sourceName()} selected, but no data in the last ${WINDOW_MS / 1000} s.`
      );
      return;
    }

    const first = updates[0];
    const last = updates[updates.length - 1];
    const spanMs = last.timestamp - first.timestamp;
    if (spanMs <= 0) {
      return; // not enough spread yet to measure
    }

    const hz = ((updates.length - 1) * 1000) / spanMs;
    const avgGapMs = spanMs / (updates.length - 1);
    setStatus(
      's-status-on',
      `${hz.toFixed(1)} Hz`,
      `${sourceName()}: ${hz.toFixed(1)} updates/s (one every ${avgGapMs.toFixed(0)} ms), ` +
        `averaged over the last ${WINDOW_MS / 1000} s.`
    );
  }

  openmct.indicators.add({
    key: 'data-rate',
    element,
    priority: openmct.priority.HIGH
  });

  render();
  setInterval(render, REFRESH_MS);
}
