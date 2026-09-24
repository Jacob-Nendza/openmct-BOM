'use strict';

/*
 * X-Plane source.
 *
 * Every source file exports a create() function that returns an object with
 * start() and stop(). The bridge only ever runs ONE source at a time, so a
 * source should do nothing (open no sockets, poll nothing) until start() is
 * called, and fully shut down in stop().
 *
 * While running, a source reports what it receives through two callbacks:
 *   onData({ key, value, timestamp })  - one telemetry sample, already in
 *                                        display units
 *   onStatus({ paused })               - source-specific status (optional)
 *
 * This one talks to X-Plane 11 over its native RREF UDP protocol, using
 * ../xplane-udp.js (the UDP client) and ../datarefs.js (what to ask for).
 */

const XPlaneUDP = require('../xplane-udp.js');
const datarefs = require('../datarefs.js');

const datarefByKey = new Map(datarefs.map((d) => [d.key, d]));

module.exports = function createXPlaneSource({ onData, onStatus, log }) {
  let client = null;
  let simPaused = false;

  function handleSample(sample) {
    // X-Plane's pause flag. While paused, X-Plane keeps sending the same
    // frozen values; we drop them so plots show a gap, not a flat line.
    if (sample.key === 'paused') {
      const nowPaused = sample.rawValue >= 0.5;
      if (nowPaused !== simPaused) {
        simPaused = nowPaused;
        log(simPaused ? 'X-Plane paused, holding data' : 'X-Plane resumed');
        onStatus({ paused: simPaused });
      }
      return;
    }

    if (simPaused) {
      return;
    }

    const dataref = datarefByKey.get(sample.key);
    const value = dataref.convert ? dataref.convert(sample.rawValue) : sample.rawValue;
    onData({ key: sample.key, value, timestamp: sample.timestamp });
  }

  return {
    start() {
      client = new XPlaneUDP({ datarefs, frequencyHz: 10 });
      client.on('data', handleSample);
      client.on('connected', () => log('receiving data from X-Plane'));
      client.on('disconnected', () => log('X-Plane went quiet, re-subscribing every few seconds...'));
      client.on('error', (error) => log(`error: ${error.message}`));

      return client.start().then(() => {
        log(`requesting ${datarefs.length} datarefs from X-Plane at ${client.xplaneHost}:${client.xplanePort}`);
      });
    },

    stop() {
      const stopping = client ? client.stop() : Promise.resolve();
      client = null;
      if (simPaused) {
        simPaused = false;
        onStatus({ paused: false });
      }
      return stopping;
    }
  };
};
