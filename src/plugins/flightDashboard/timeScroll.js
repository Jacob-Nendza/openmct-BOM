/*
 * Scroll back in time on the dashboard's vertical-time charts (strip charts
 * and test-point time histories), where "now" is at the top and older data
 * runs down.
 *
 *   - Mouse wheel / two-finger scroll DOWN over the chart moves back in time
 *     (older data comes up from below); scroll UP moves forward again. The
 *     scale (pixels per second) never changes - only where you're looking.
 *   - While scrolled back the chart stays put (it stops following live data)
 *     and a "▶ Live" button shows how far back you are. Click it, or scroll
 *     forward past "now", to follow live data again.
 *   - Data older than the chart's own buffer is fetched from history
 *     (bridge buffer + the Raw Data recorder), back to the start of the data.
 *
 *   const scroll = createTimeScroll({
 *     body, canvas,             // the chart's cell body and its canvas
 *     samples,                  // the chart's live [{ timestamp, value }], oldest first
 *     pxPerSecond,              // the chart's time scale
 *     request: (start, end) => Promise<[{ timestamp, value }]>,
 *     redraw                    // schedule a redraw
 *   });
 *   // in draw():
 *   const viewNow = scroll.frame(newest);          // time at the top ("now" when live)
 *   const visible = scroll.samplesBetween(t0, t1); // oldest first, history + live
 *   scroll.isLive();
 *   scroll.reset();    // Clear Data
 *   scroll.destroy();
 */

import dataClock, { formatElapsed } from '../dataSource/dataClock.js';

const LINE_PX = 16; // wheel events counted in lines
const MIN_FETCH_PAD_MS = 60 * 1000; // fetch at least this much extra history each time

function lowerBound(samples, timestamp) {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].timestamp < timestamp) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// Samples between start and end, plus one either side so lines reach the edges.
function sliceBetween(samples, start, end) {
  const from = Math.max(0, lowerBound(samples, start) - 1);
  const to = Math.min(samples.length, lowerBound(samples, end) + 1);
  return samples.slice(from, to);
}

// Wheel distance in pixels; positive = scrolled down / toward older data.
// Shift + wheel (which some browsers send as sideways scrolling) counts too.
export function wheelPixels(event, pageSize) {
  const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? pageSize : 1;
  const delta = event.deltaY || (event.shiftKey ? event.deltaX : 0);
  return delta * scale;
}

export function createTimeScroll({ body, canvas, samples, pxPerSecond, request, redraw }) {
  let anchor = null; // time shown at "now" while scrolled back; null = live
  let cache = null; // { from, to, samples }: history fetched for [from, to]
  let fetching = false;
  let generation = 0; // bumps on Clear Data so late fetches are dropped
  let destroyed = false;

  // "▶ Live" button, only shown while scrolled back.
  const liveButton = document.createElement('button');
  liveButton.type = 'button';
  liveButton.className = 'c-button';
  liveButton.title = 'Scrolled back in time. Click to follow live data again.';
  liveButton.style.cssText =
    'position:absolute; top:2px; right:2px; z-index:2; display:none; white-space:nowrap;' +
    'padding:1px 5px; font-size:11px; line-height:16px; min-height:0;';
  liveButton.addEventListener('click', (event) => {
    event.stopPropagation();
    anchor = null;
    redraw();
  });
  body.append(liveButton);

  function newestTimestamp() {
    return samples.length ? samples[samples.length - 1].timestamp : null;
  }

  function earliestTimestamp() {
    const candidates = [];
    if (dataClock.start !== null) {
      candidates.push(dataClock.start);
    }
    if (samples.length) {
      candidates.push(samples[0].timestamp);
    }
    if (cache && cache.samples.length) {
      candidates.push(cache.samples[0].timestamp);
    }
    return candidates.length ? Math.min(...candidates) : null;
  }

  function onWheel(event) {
    const newest = newestTimestamp();
    if (newest === null) {
      return; // nothing to scroll yet; let the page scroll
    }
    event.preventDefault();
    const px = wheelPixels(event, body.clientHeight || 400);
    if (!px) {
      return;
    }
    const next = (anchor === null ? newest : anchor) - (px / pxPerSecond) * 1000;
    // Stop when the first sample reaches the bottom of the chart.
    const earliest = earliestTimestamp();
    const visibleMs = ((canvas.clientHeight || body.clientHeight || 0) / pxPerSecond) * 1000;
    const lowest = earliest === null ? -Infinity : earliest + visibleMs;
    const clamped = Math.max(next, lowest);
    anchor = clamped >= newest ? null : clamped; // forward past "now" = live again
    redraw();
  }
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function fetchHistory(from, to) {
    if (fetching || destroyed) {
      return;
    }
    fetching = true;
    const fetchGeneration = generation;
    Promise.resolve()
      .then(() => request(from, to))
      .then(
        (history) =>
          (Array.isArray(history) ? history : [])
            .map((datum) => ({ timestamp: datum.timestamp, value: Number(datum.value) }))
            .filter((datum) => Number.isFinite(datum.value) && Number.isFinite(datum.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp),
        () => [] // failed: remember the range anyway so we don't retry every frame
      )
      .then((history) => {
        fetching = false;
        if (destroyed || fetchGeneration !== generation) {
          return;
        }
        cache = { from, to, samples: history };
        redraw();
      });
  }

  return {
    // Call at the start of each draw with the newest sample's time. Returns
    // the time to show at the chart's "now" line, and updates the Live button.
    frame(newest) {
      if (anchor !== null && newest !== null && anchor >= newest) {
        anchor = null;
      }
      if (anchor === null || newest === null) {
        liveButton.style.display = 'none';
        return newest;
      }
      liveButton.style.display = '';
      liveButton.textContent = `▶ Live −${formatElapsed(newest - anchor)}`;
      return anchor;
    },

    isLive() {
      return anchor === null;
    },

    // Time at a pixel row, for double-click markers.
    timeAtY(y, nowY, viewNow) {
      return viewNow - ((y - nowY) / pxPerSecond) * 1000;
    },

    // Samples between start and end (oldest first): fetched history for the
    // part older than the live buffer, then the live buffer.
    samplesBetween(start, end) {
      const liveStart = samples.length ? samples[0].timestamp : Infinity;
      let older = [];
      if (start < liveStart) {
        const neededTo = Math.min(end, liveStart);
        const covered = cache && cache.from <= start && cache.to >= neededTo;
        if (!covered) {
          const pad = Math.max(MIN_FETCH_PAD_MS, 2 * (end - start));
          const newest = newestTimestamp();
          fetchHistory(start - pad, newest === null ? Date.now() : newest);
        }
        if (cache) {
          older = sliceBetween(cache.samples, start, Math.min(end, liveStart)).filter(
            (sample) => sample.timestamp < liveStart
          );
        }
      }
      return older.concat(end >= liveStart ? sliceBetween(samples, start, end) : []);
    },

    // Clear Data: back to live, forget fetched history.
    reset() {
      anchor = null;
      cache = null;
      generation++;
      liveButton.style.display = 'none';
    },

    destroy() {
      destroyed = true;
      canvas.removeEventListener('wheel', onWheel);
      liveButton.remove();
    }
  };
}
