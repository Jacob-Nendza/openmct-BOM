'use strict';

/*
 * Standalone smoke test: confirms X-Plane is actually reachable over UDP
 * before you bother starting the full bridge server. Run this first.
 *
 *   cd xplane-bridge
 *   npm install
 *   node test-connection.js
 */

const XPlaneUDP = require('./xplane-udp.js');
const datarefs = require('./datarefs.js');

console.log('[test-connection] Listening for X-Plane telemetry for 10 seconds...');
console.log('[test-connection] Make sure X-Plane 11 is running with a flight loaded');
console.log('[test-connection] (not just sitting at the main menu).\n');

const xplane = new XPlaneUDP({ datarefs, frequencyHz: 2 });
let sampleCount = 0;

xplane.on('data', (sample) => {
  sampleCount += 1;
  console.log(`  ${sample.key.padEnd(16)} = ${sample.rawValue.toFixed(3)}`);
});

xplane.on('error', (error) => {
  console.error('[test-connection] error:', error.message);
});

xplane.start().then(() => {
  setTimeout(() => {
    xplane.stop();
    console.log(`\n[test-connection] done — received ${sampleCount} samples.`);

    if (sampleCount === 0) {
      console.log('[test-connection] No data received. Check that:');
      console.log('  1. X-Plane 11 is running with a flight loaded');
      console.log('  2. Settings > Network in X-Plane has "Accept incoming connections" on,');
      console.log('     and this machine is the one X-Plane is running on (127.0.0.1) —');
      console.log('     edit xplaneHost in bridge-server.js if X-Plane runs elsewhere');
      console.log('  3. No firewall is blocking UDP ports 49000/49001');
    }

    process.exit(0);
  }, 10000);
});
