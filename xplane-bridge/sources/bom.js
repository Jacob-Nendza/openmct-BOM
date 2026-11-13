'use strict';

/*
 * Levil BOM source.
 *
 * Same shape as sources/xplane.js: create() returns { start(), stop() }, and
 * nothing happens until the Source dropdown in Open MCT selects "Levil BOM".
 *
 * The BOM broadcasts GDL90 packets over UDP to port 43211 (confirmed with a
 * packet capture of the real BOM, 2026-09-24 - NOT the usual GDL90 port 4000). This
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
 *   from the Heartbeat (0x00):       gps_fix (1 = BOM reports a valid GPS fix, 0 = no fix)
 *   from the Ownship Report (0x0A):  latitude, longitude, ground_speed, track,
 *                                    gps_vertical_speed, nic, nacp, horizontal_rc,
 *                                    pressure_altitude (FALLBACK only, 25 ft steps)
 *   from Geometric Altitude (0x0B):  gps_altitude
 *   from the Levil AHRS msg (0x4C):  pitch, roll, heading, slip, yaw_rate,
 *                                    g_load, airspeed, vertical_speed,
 *                                    pressure_altitude (1 ft steps - preferred)
 *
 * Resolution: pressure altitude comes from the Levil AHRS message, which carries
 * it to 1 ft (the same as the BOM's SD-card log). The Ownship Report only has
 * 25 ft steps, so it is used only if the AHRS message stops carrying altitude.
 * Track (~1.4 deg steps), GPS climb rate (64 ft/min steps) and lat/lon (~2 m)
 * are limited by the GDL90 format itself - there is no finer copy in the stream.
 *
 * Packet capture: every message this file does NOT decode (other Levil
 * sub-messages, traffic, weather, ForeFlight ID, ...) is written as hex to
 * xplane-bridge/captures/bom-capture-<UTC time>.csv. Record a session here
 * while the BOM writes its own SD log, and the two can be lined up to find
 * where values like battery, temperature, AOA or satellites live (if the BOM
 * broadcasts them at all). Set BOM_CAPTURE=all to capture every message,
 * BOM_CAPTURE=off to turn it off.
 */

const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const gdl90 = require('../gdl90.js');

const PORT = Number(process.env.BOM_PORT) || 43211;
const QUIET_AFTER_MS = 3000; // no packets for this long = "BOM went quiet"
const AHRS_PALT_STALE_MS = 2000; // use the Ownship altitude if the AHRS altitude stops for this long
const CAPTURE_MODE = (process.env.BOM_CAPTURE || 'unknown').toLowerCase(); // unknown | all | off
const CAPTURE_DIR = path.join(__dirname, '..', 'captures');
const CAPTURE_MAX_LINES = 200000; // safety cap per session

// NIC (Navigation Integrity Category, 0-11) -> horizontal containment radius
// in meters (DO-260B). 37041 = "unknown / more than 20 NM" - the value the
// BOM's own SD log writes when NIC is 0.
const NIC_TO_RC_M = [37041, 37040, 14816, 7408, 3704, 1852, 1111.2, 370.4, 185.2, 75, 25, 7.5];

// Which decoded field becomes which Open MCT key.
const FIELDS = {
  ownship: {
    lat: 'latitude',
    lon: 'longitude',
    groundSpeedKt: 'ground_speed',
    trackDeg: 'track',
    verticalSpeedFpm: 'gps_vertical_speed',
    nic: 'nic',
    nacp: 'nacp'
    // pressureAltFt is handled separately (fallback only - see handleMessage)
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
    verticalSpeedFpm: 'vertical_speed',
    pressureAltFt: 'pressure_altitude'
  }
};

const toHex = (bytes) => Buffer.from(bytes).toString('hex').toUpperCase();

// A short name for a message type: "0x0A", or "0x4C/45/01" for a Levil sub-message.
function signature(bytes) {
  const id = `0x${toHex([bytes[0]])}`;
  if (bytes[0] === gdl90.ID.LEVIL && bytes.length >= 3) {
    return `${id}/${toHex([bytes[1]])}/${toHex([bytes[2]])}`;
  }
  return id;
}

// Writes raw messages (undecoded ones, or all of them) to a CSV for analysis,
// and keeps a count of every message type seen.
function createCapture(log) {
  let stream = null;
  let file = null;
  let lines = 0;
  const seen = new Map(); // signature -> count

  return {
    write(timestamp, decodedType, bytes) {
      const sig = signature(bytes);
      const count = (seen.get(sig) || 0) + 1;
      seen.set(sig, count);
      if (count === 1) {
        log(`new message type: ${sig} (${bytes.length} bytes, decoded as ${decodedType})`);
      }

      const undecoded = decodedType === 'unknown' || decodedType === 'levil-other';
      const wanted = CAPTURE_MODE === 'all' || (CAPTURE_MODE !== 'off' && undecoded);
      if (!wanted || lines >= CAPTURE_MAX_LINES) {
        return;
      }

      if (!stream) {
        fs.mkdirSync(CAPTURE_DIR, { recursive: true });
        const stamp = new Date(timestamp).toISOString().slice(0, 19).replace(/[-:]/g, '');
        file = path.join(CAPTURE_DIR, `bom-capture-${stamp}.csv`);
        stream = fs.createWriteStream(file);
        stream.write('utc_time,epoch_ms,message,decoded_as,length,hex\r\n');
        log(`capturing ${CAPTURE_MODE === 'all' ? 'all' : 'undecoded'} messages to ${file}`);
      }

      const iso = new Date(timestamp).toISOString();
      stream.write(`${iso},${timestamp},${sig},${decodedType},${bytes.length},${toHex(bytes)}\r\n`);
      lines++;
      if (lines === CAPTURE_MAX_LINES) {
        log(`capture reached ${CAPTURE_MAX_LINES} lines - nothing more will be written this session`);
      }
    },

    close() {
      if (seen.size) {
        log(`message types received: ${[...seen].map(([sig, n]) => `${sig} x${n}`).join(', ')}`);
      }
      if (stream) {
        stream.end();
        log(`capture saved: ${file} (${lines} lines)`);
      }
      stream = null;
      file = null;
      lines = 0;
      seen.clear();
    }
  };
}

module.exports = function createBOMSource({ onData, log }) {
  let socket = null;
  let receiving = false;
  let lastPacketAt = 0;
  let gpsValid = false;
  let watchdog = null;
  let badPackets = 0;
  let lastAhrsPaltAt = 0;
  const capture = createCapture(log);

  function handleMessage(message) {
    const timestamp = Date.now();
    const emit = (key, value) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        onData({ key, value, timestamp });
      }
    };

    for (const frame of gdl90.unframe(message)) {
      if (!frame.ok) {
        badPackets++;
        continue;
      }

      const decoded = gdl90.decode(frame);
      capture.write(timestamp, decoded.type, frame.bytes);

      if (decoded.type === 'heartbeat') {
        gpsValid = decoded.gpsValid;
        emit('gps_fix', gpsValid ? 1 : 0);
        continue;
      }

      const fields = FIELDS[decoded.type];
      if (!fields) {
        continue; // message types we don't decode yet (traffic, weather, ...) - captured above
      }

      if (decoded.type === 'ownship') {
        // Without a GPS fix, position is meaningless - skip it rather than plot 0,0.
        // (Right after it wakes up, the BOM can also send 0,0 for a few seconds.)
        if (!gpsValid || (decoded.lat === 0 && decoded.lon === 0)) {
          continue;
        }
        // 25 ft Ownship altitude only if the 1 ft AHRS altitude isn't arriving.
        if (timestamp - lastAhrsPaltAt > AHRS_PALT_STALE_MS) {
          emit('pressure_altitude', decoded.pressureAltFt);
        }
        if (Number.isInteger(decoded.nic) && decoded.nic < NIC_TO_RC_M.length) {
          emit('horizontal_rc', NIC_TO_RC_M[decoded.nic]);
        }
      }

      if (decoded.type === 'ahrs' && typeof decoded.pressureAltFt === 'number') {
        lastAhrsPaltAt = timestamp;
      }

      for (const [field, key] of Object.entries(fields)) {
        emit(key, decoded[field]);
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
      capture.close();
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
