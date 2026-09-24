'use strict';

/*
 * Levil BOM source.
 *
 * Same shape as sources/xplane.js: create() returns { start(), stop() }, and
 * nothing happens until the Source dropdown in Open MCT selects "Levil BOM".
 *
 * The BOM broadcasts GDL90 packets over UDP (port 4000 by default). This
 * source listens on that port, decodes each packet with ../gdl90.js and
 * reports every value through onData({ key, value, timestamp }).
 *
 * Where the packets come from doesn't matter to this file:
 *   - the BOM Emulator (C:\Projects\BOM-Emulator) replaying a recorded flight, or
 *   - the real BOM, once this laptop is joined to its BOM-xxxx Wi-Fi network.
 *
 * Set BOM_PORT to listen on a different port.
 *
 * Keys reported (must match src/plugins/bomData/dictionary.js):
 *   from the Ownship Report (0x0A):  latitude, longitude, pressure_altitude,
 *                                    ground_speed, track, gps_vertical_speed
 *   from Geometric Altitude (0x0B):  gps_altitude
 *   from the Levil AHRS msg (0x4C):  pitch, roll, heading, slip, yaw_rate,
 *                                    g_load, airspeed, vertical_speed
 */

const dgram = require('dgram');
const gdl90 = require('../gdl90.js');

const PORT = Number(process.env.BOM_PORT) || 4000;
const QUIET_AFTER_MS = 3000; // no packets for this long = "BOM went quiet"

// Which decoded field becomes which Open MCT key.
const FIELDS = {
  ownship: {
    lat: 'latitude',
    lon: 'longitude',
    pressureAltFt: 'pressure_altitude',
    groundSpeedKt: 'ground_speed',
    trackDeg: 'track',
    verticalSpeedFpm: 'gps_vertical_speed'
  },
  geoAlt: {
    gpsAltFt: 'gps_altitude'
  },
  ahrs: {
    pitchDeg: 'pitch',
    rollDeg: 'roll',
    headingDeg: 'heading',
    slipDeg: 'slip',
    yawRateDps: 'yaw_rate',
    gLoad: 'g_load',
    iasKt: 'airspeed',
    verticalSpeedFpm: 'vertical_speed'
  }
};

module.exports = function createBOMSource({ onData, log }) {
  let socket = null;
  let receiving = false;
  let lastPacketAt = 0;
  let gpsValid = false;
  let watchdog = null;
  let badPackets = 0;

  function handleMessage(message) {
    const timestamp = Date.now();

    for (const frame of gdl90.unframe(message)) {
      if (!frame.ok) {
        badPackets++;
        continue;
      }

      const decoded = gdl90.decode(frame);

      if (decoded.type === 'heartbeat') {
        gpsValid = decoded.gpsValid;
        continue;
      }

      const fields = FIELDS[decoded.type];
      if (!fields) {
        continue; // message types we don't use yet (traffic, weather, ...)
      }

      // Without a GPS fix, position is meaningless - skip it rather than plot 0,0.
      if (decoded.type === 'ownship' && !gpsValid) {
        continue;
      }

      for (const [field, key] of Object.entries(fields)) {
        const value = decoded[field];
        if (typeof value === 'number' && Number.isFinite(value)) {
          onData({ key, value, timestamp });
        }
      }
    }
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        socket = dgram.createSocket({ type: 'udp4', reuseAddr: false }); // exclusive: a port clash gives a clear error instead of lost data

        socket.on('message', (message) => {
          lastPacketAt = Date.now();
          if (!receiving) {
            receiving = true;
            log('receiving GDL90 data');
          }
          handleMessage(message);
        });

        socket.once('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            error.message = `UDP port ${PORT} is already in use - is listen.js from the BOM Emulator still running? Stop it and select the BOM again.`;
          }
          reject(error);
        });

        socket.bind(PORT, () => {
          socket.on('error', (error) => log(`error: ${error.message}`));
          log(`listening for GDL90 on UDP port ${PORT} (start the BOM Emulator, or join the BOM's Wi-Fi)`);

          watchdog = setInterval(() => {
            if (receiving && Date.now() - lastPacketAt > QUIET_AFTER_MS) {
              receiving = false;
              log('BOM went quiet - waiting for data...');
            }
          }, 1000);

          resolve();
        });
      });
    },

    stop() {
      clearInterval(watchdog);
      watchdog = null;
      receiving = false;
      if (badPackets) {
        log(`${badPackets} packets failed the GDL90 checksum and were dropped`);
        badPackets = 0;
      }

      if (!socket) {
        return Promise.resolve();
      }
      const closing = socket;
      socket = null;
      return new Promise((resolve) => {
        try {
          closing.close(resolve);
        } catch (error) {
          resolve(); // already closed (e.g. bind failed)
        }
      });
    }
  };
};
