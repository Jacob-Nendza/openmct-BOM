/*
 * Test-point displays for the flight dashboard (./dashboardView.js):
 *
 *   limitBox  - big box with the current value (e.g. "KCAS 309"). Green while
 *               the value is between the MIN and MAX typed beside it, red
 *               outside them, grey until data arrives.
 *   trace     - vertical time history: value across, time running DOWN (the
 *               newest value is at the top, older values scroll down), one
 *               gridline every 2 seconds. Red lines mark the aircraft limits
 *               from the limit box, and the scale is set from those limits.
 *               A parameter with a fixed `scale` (Pressure Altitude: 0-20k)
 *               uses that instead and has no red lines.
 *   tolerance - test-point tolerance bar. You type the center value and the
 *               +/-; the bar is green inside center +/- tolerance and red
 *               above/below it, the scale runs center +/- 2x tolerance, and a
 *               white pointer marks the current value. The top light turns
 *               red when the value is HIGH (above tolerance), the bottom light
 *               when it is LOW; both green when it is inside.
 *
 * A "param" is what these displays show (see PARAMS in ../bomData/dashboardView.js):
 *
 *   { label: 'KCAS', units: 'kt', source: 'kcas',
 *     decimals: 1, boxDecimals: 0, scale: [0, 20000] (optional) }
 *
 * `source` is the measurement key the value comes from, so the displays show
 * exactly what is recorded (e.g. KCAS, ../bomData/dictionary.js).
 */

const GREEN = '#15803d';
const RED = '#c62828';
const NO_DATA = '#4b5563';
const TRACE_BLUE = '#43b0ff';
const LIMIT_RED = '#ff3030';
const INPUT_BORDER = '#4a7bd6';

const TRACE_PX_PER_S = 20; // vertical trace: pixels per second of time
const TRACE_GRID_S = 2; // horizontal gridline every 2 seconds
const TRACE_COLUMNS = 10; // vertical gridlines across the scale
const TRACE_HEADER_PX = 18;
const LIMIT_SCALE_PAD = 0.1; // scale = limits plus 10% of their span each side
const FEED_KEEP_MS = 3 * 60 * 1000; // samples each feed keeps in memory

function format(value, decimals) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '---';
}

function setupCanvas(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

// Calls draw() at most once per animation frame.
function frameScheduler(draw) {
  let queued = false;
  return () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        draw();
      });
    }
  };
}

/*
 * A number box that saves on Enter / leaving the box. Bad input (blank,
 * letters) snaps back to the saved value.
 *   const box = numberInput(() => current, (v) => save(v));
 *   box.refresh(); // show the saved value again (after a reset)
 */
export function numberInput(getValue, onCommit, { width = 64, allowBlank = false } = {}) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.style.cssText =
    `width:${width}px; box-sizing:border-box; padding:2px 4px; text-align:center;` +
    `font:inherit; font-size:1.05em; color:inherit; background:rgba(127,127,127,0.12);` +
    `border:1px solid ${INPUT_BORDER}; border-radius:2px;`;

  function refresh() {
    if (document.activeElement !== input) {
      const value = getValue();
      input.value = Number.isFinite(value) ? String(value) : '';
    }
  }

  input.addEventListener('change', () => {
    const text = input.value.trim();
    const value = Number(text);
    if (text === '' && allowBlank) {
      onCommit(null);
    } else if (text !== '' && Number.isFinite(value)) {
      onCommit(value);
    }
    input.blur();
    refresh();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      input.blur();
    }
  });
  input.addEventListener('blur', refresh);

  refresh();
  return { element: input, refresh };
}

function label(text, extraStyle = '') {
  const span = document.createElement('span');
  span.textContent = text;
  span.style.cssText = 'font-weight:bold; white-space:nowrap;' + extraStyle;
  return span;
}

/*
 * One live data feed per param, shared by every display of it.
 *   feed.samples      - [{ timestamp, value }], oldest first
 *   feed.latest()     - newest value, or NaN before any data
 *   feed.onUpdate(cb) - called on new data, Clear Data, or a settings change
 */
export function createParamFeed(openmct, child, param, settings, onClearData) {
  const samples = [];
  const listeners = new Set();
  let destroyed = false;

  function notify() {
    listeners.forEach((listener) => listener());
  }

  function add(datum) {
    const value = Number(datum.value);
    if (!Number.isFinite(value)) {
      return;
    }
    if (samples.length && datum.timestamp <= samples[samples.length - 1].timestamp) {
      return;
    }
    samples.push({ timestamp: datum.timestamp, value });
    const cutoff = datum.timestamp - FEED_KEEP_MS;
    while (samples.length && samples[0].timestamp < cutoff) {
      samples.shift();
    }
  }

  openmct.telemetry.request(child).then((history) => {
    if (!destroyed && Array.isArray(history)) {
      history.forEach(add);
      notify();
    }
  });
  const unsubscribe = openmct.telemetry.subscribe(child, (datum) => {
    add(datum);
    notify();
  });
  const stopSettings = settings.onChange(notify);
  onClearData(() => {
    samples.length = 0;
    notify();
  });

  return {
    param,
    child,
    samples,
    latest() {
      return samples.length ? samples[samples.length - 1].value : NaN;
    },
    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      destroyed = true;
      unsubscribe();
      stopSettings();
      listeners.clear();
    }
  };
}

// The scale a trace uses: a fixed param.scale, or the limits plus padding.
function traceRange(param, limits) {
  if (param.scale) {
    return { lo: param.scale[0], hi: param.scale[1] };
  }
  if (
    limits &&
    Number.isFinite(limits.min) &&
    Number.isFinite(limits.max) &&
    limits.max > limits.min
  ) {
    const pad = (limits.max - limits.min) * LIMIT_SCALE_PAD;
    return { lo: limits.min - pad, hi: limits.max + pad };
  }
  const center = limits && Number.isFinite(limits.min) ? limits.min : 0;
  return { lo: center - 1, hi: center + 1 };
}

/* ------------------------------------------------------------------ limitBox */

export function buildLimitBox(body, paramKey, feed, settings, cleanups) {
  const param = feed.param;
  body.style.flexDirection = 'row';
  body.style.alignItems = 'center';
  body.style.gap = '10px';
  body.style.padding = '4px';

  const box = document.createElement('div');
  box.style.cssText =
    'flex:1 1 auto; align-self:stretch; min-width:0; container-type:size;' +
    'display:flex; flex-direction:column; align-items:center; justify-content:center;' +
    `border:4px solid #111; border-radius:2px; color:#fff; background:${NO_DATA};` +
    'font-weight:bold; line-height:1.05; text-align:center; overflow:hidden;';
  const name = document.createElement('div');
  name.textContent = param.label;
  name.style.fontSize = 'min(26cqh, 22cqw)';
  const value = document.createElement('div');
  value.style.fontSize = 'min(26cqh, 22cqw)';
  value.style.fontVariantNumeric = 'tabular-nums';
  box.append(name, value);

  const limits = () => settings.get().limits[paramKey];
  const maxInput = numberInput(
    () => limits().max,
    (v) => settings.setLimit(paramKey, 'max', v)
  );
  const minInput = numberInput(
    () => limits().min,
    (v) => settings.setLimit(paramKey, 'min', v)
  );
  const inputs = document.createElement('div');
  inputs.style.cssText =
    'flex:none; display:grid; grid-template-columns:auto auto; gap:8px 6px; align-items:center;';
  inputs.append(label('MAX:'), maxInput.element, label('MIN:'), minInput.element);
  inputs.title = `Aircraft limits for ${param.label}. The box turns red outside them.`;

  body.append(box, inputs);

  function render() {
    const current = feed.latest();
    const { min, max } = limits();
    value.textContent = format(current, param.boxDecimals ?? param.decimals);
    let color = NO_DATA;
    if (Number.isFinite(current)) {
      color = current > max || current < min ? RED : GREEN;
    }
    box.style.background = color;
    maxInput.refresh();
    minInput.refresh();
  }

  cleanups.push(feed.onUpdate(render));
  render();
}

/* --------------------------------------------------------------------- trace */

export function buildTrace(body, paramKey, feed, settings, cleanups) {
  const param = feed.param;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';
  body.append(canvas);

  function draw() {
    const width = body.clientWidth;
    const height = body.clientHeight;
    if (!width || !height) {
      return;
    }
    const ctx = setupCanvas(canvas, width, height);
    const textColor = getComputedStyle(body).color;
    const limits = param.scale ? null : settings.get().limits[paramKey];
    const { lo, hi } = traceRange(param, limits);

    const left = 4;
    const right = width - 4;
    const top = TRACE_HEADER_PX;
    const bottom = height - 1;
    const xFor = (v) => left + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (right - left);
    const current = feed.latest();

    // Header: scale minimum, (current value), scale maximum.
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.fillText(format(lo, param.decimals), left, top / 2);
    ctx.textAlign = 'right';
    ctx.fillText(format(hi, param.decimals), right, top / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = TRACE_BLUE;
    ctx.fillText(`(${format(current, param.decimals)})`, (left + right) / 2, top / 2);

    // Vertical gridlines across the scale.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(127,127,127,0.35)';
    for (let i = 0; i <= TRACE_COLUMNS; i++) {
      const x = Math.round(left + (i / TRACE_COLUMNS) * (right - left)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    // Red aircraft-limit lines.
    if (limits) {
      ctx.strokeStyle = LIMIT_RED;
      ctx.lineWidth = 2;
      [limits.min, limits.max].forEach((limit) => {
        if (Number.isFinite(limit) && limit >= lo && limit <= hi) {
          const x = Math.round(xFor(limit));
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
        }
      });
    }

    const samples = feed.samples;
    const nowY = top + 4;
    if (!samples.length) {
      // No data yet: still show the 2 s grid, fixed.
      ctx.strokeStyle = 'rgba(127,127,127,0.35)';
      ctx.lineWidth = 1;
      for (let y = nowY; y < bottom; y += TRACE_GRID_S * TRACE_PX_PER_S) {
        ctx.beginPath();
        ctx.moveTo(left, Math.round(y) + 0.5);
        ctx.lineTo(right, Math.round(y) + 0.5);
        ctx.stroke();
      }
      return;
    }

    // Time runs down from "now" (the newest sample, so the chart freezes when
    // data stops). The 2 s gridlines are tied to the clock, so they scroll
    // with the data like chart paper.
    const newest = samples[samples.length - 1].timestamp;
    const yFor = (t) => nowY + ((newest - t) / 1000) * TRACE_PX_PER_S;
    const gridMs = TRACE_GRID_S * 1000;
    ctx.strokeStyle = 'rgba(127,127,127,0.35)';
    ctx.lineWidth = 1;
    for (let t = Math.floor(newest / gridMs) * gridMs; yFor(t) < bottom; t -= gridMs) {
      const y = Math.round(yFor(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    ctx.strokeStyle = TRACE_BLUE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = samples.length - 1; i >= 0; i--) {
      const y = yFor(samples[i].timestamp);
      const x = xFor(samples[i].value);
      if (i === samples.length - 1) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      if (y > bottom) {
        break;
      }
    }
    ctx.stroke();
    ctx.fillStyle = TRACE_BLUE;
    ctx.fillRect(xFor(current) - 3, nowY - 3, 6, 6); // square marker on "now", like the slide
    ctx.restore();
  }

  const scheduleDraw = frameScheduler(draw);
  const resizeObserver = new ResizeObserver(scheduleDraw);
  resizeObserver.observe(body);
  cleanups.push(feed.onUpdate(scheduleDraw));
  cleanups.push(() => resizeObserver.disconnect());
  scheduleDraw();
}

/* ----------------------------------------------------------------- tolerance */

function light() {
  const div = document.createElement('div');
  div.style.cssText =
    'width:34px; height:34px; border-radius:50%; flex:none;' +
    'box-shadow:0 1px 3px rgba(0,0,0,0.5), inset 0 -2px 3px rgba(0,0,0,0.35);';
  return div;
}

const LIGHT_BACKGROUND = {
  green: 'radial-gradient(circle at 38% 32%, #d6ffd6 0, #39d353 30%, #12802a 100%)',
  red: 'radial-gradient(circle at 38% 32%, #ffd6d6 0, #ff3b3b 30%, #9b1010 100%)',
  off: 'radial-gradient(circle at 38% 32%, #e5e7eb 0, #6b7280 35%, #374151 100%)'
};

export function buildToleranceBar(body, paramKey, feed, settings, cleanups) {
  const param = feed.param;
  body.style.alignItems = 'center';
  body.style.gap = '6px';

  const tolerance = () => settings.get().tolerances[paramKey];
  const centerInput = numberInput(
    () => tolerance().center,
    (v) => settings.setTolerance(paramKey, 'center', v),
    { width: 84 }
  );
  const plusMinusInput = numberInput(
    () => tolerance().plusMinus,
    (v) => settings.setTolerance(paramKey, 'plusMinus', Math.abs(v)),
    { width: 84 }
  );
  const inputs = document.createElement('div');
  inputs.style.cssText =
    'flex:none; display:grid; grid-template-columns:auto auto; gap:4px 6px; align-items:center;';
  inputs.append(
    label(param.label, 'text-align:right;'),
    centerInput.element,
    label('±', 'text-align:right;'),
    plusMinusInput.element
  );
  inputs.title = `Test point for ${param.label}: center value and +/- tolerance.`;

  const row = document.createElement('div');
  row.style.cssText =
    'flex:1 1 auto; min-height:0; width:100%; display:flex; justify-content:center; gap:10px;';
  const tape = document.createElement('div');
  tape.style.cssText = 'position:relative; flex:0 1 150px; min-width:110px; background:#000;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';
  tape.append(canvas);

  const lights = document.createElement('div');
  lights.style.cssText =
    'flex:none; display:flex; flex-direction:column; justify-content:center; gap:14px;';
  const highLight = light();
  const lowLight = light();
  highLight.title = 'Red: above tolerance (high)';
  lowLight.title = 'Red: below tolerance (low)';
  lights.append(highLight, lowLight);

  row.append(tape, lights);
  body.append(inputs, row);

  function draw() {
    const width = tape.clientWidth;
    const height = tape.clientHeight;
    if (!width || !height) {
      return;
    }
    const ctx = setupCanvas(canvas, width, height);
    const { center, plusMinus } = tolerance();
    const tol = plusMinus > 0 ? plusMinus : 0;
    const halfRange = tol > 0 ? 2 * tol : Math.max(1, Math.abs(center) * 0.1);
    const lo = center - halfRange;
    const hi = center + halfRange;
    const current = feed.latest();

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Current value across the top.
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(format(current, param.decimals), width / 2, 15);

    const top = 36;
    const bottom = height - 10;
    if (bottom - top < 20) {
      return;
    }
    const yFor = (v) => top + ((hi - Math.max(lo, Math.min(hi, v))) / (hi - lo)) * (bottom - top);

    // Scale: 9 labelled ticks (center +/- 2x tolerance), 4 small ticks between.
    ctx.font = '11px serif';
    const labelWidth = Math.max(
      ctx.measureText(format(hi, param.decimals)).width,
      ctx.measureText(format(lo, param.decimals)).width
    );
    const spineX = Math.round(labelWidth + 14) + 0.5;
    const barLeft = spineX + 4;
    const barRight = Math.min(width - 16, barLeft + 48);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.beginPath();
    ctx.moveTo(spineX, top);
    ctx.lineTo(spineX, bottom);
    ctx.stroke();
    const majors = 8;
    for (let i = 0; i <= majors * 5; i++) {
      const v = lo + (i / (majors * 5)) * (hi - lo);
      const y = Math.round(yFor(v)) + 0.5;
      const major = i % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(spineX - (major ? 7 : 4), y);
      ctx.lineTo(spineX, y);
      ctx.stroke();
      if (major) {
        ctx.fillText(format(v, param.decimals), spineX - 9, y);
      }
    }

    // Bar: red above and below, green inside the tolerance.
    const yHi = yFor(center + tol);
    const yLo = yFor(center - tol);
    ctx.fillStyle = '#ff1f1f';
    ctx.fillRect(barLeft, top, barRight - barLeft, yHi - top);
    ctx.fillRect(barLeft, yLo, barRight - barLeft, bottom - yLo);
    ctx.fillStyle = '#1fe51f';
    ctx.fillRect(barLeft, yHi, barRight - barLeft, yLo - yHi);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(barLeft + 0.5, top + 0.5, barRight - barLeft - 1, bottom - top - 1);

    // White pointer on the current value (pinned to the end if off-scale).
    if (Number.isFinite(current)) {
      const y = yFor(current);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(barRight + 1, y);
      ctx.lineTo(barRight + 11, y - 6);
      ctx.lineTo(barRight + 11, y + 6);
      ctx.closePath();
      ctx.fill();
    }
  }

  function render() {
    const { center, plusMinus } = tolerance();
    const current = feed.latest();
    let high = 'off';
    let low = 'off';
    if (Number.isFinite(current)) {
      high = current > center + plusMinus ? 'red' : 'green';
      low = current < center - plusMinus ? 'red' : 'green';
    }
    highLight.style.background = LIGHT_BACKGROUND[high];
    lowLight.style.background = LIGHT_BACKGROUND[low];
    centerInput.refresh();
    plusMinusInput.refresh();
    scheduleDraw();
  }

  const scheduleDraw = frameScheduler(draw);
  const resizeObserver = new ResizeObserver(scheduleDraw);
  resizeObserver.observe(tape);
  cleanups.push(feed.onUpdate(render));
  cleanups.push(() => resizeObserver.disconnect());
  render();
}
