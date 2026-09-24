// GDL90 encoder/decoder (copied from BOM Emulator, C:\Projects\BOM-Emulator\lib\gdl90.js - keep the two in sync)
//
// GDL90 is the binary message format the Levil BOM broadcasts over UDP by default.
// Every message on the wire looks like this:
//
//   0x7E | message ID | payload ... | CRC (2 bytes, low byte first) | 0x7E
//
//   * 0x7E is the "flag" byte that marks the start and end of each message.
//   * The CRC is a checksum so the receiver can tell if bytes were damaged.
//   * If a 0x7E or 0x7D byte appears INSIDE the message, it is "escaped":
//     replaced by 0x7D followed by (byte XOR 0x20). This is called byte stuffing.
//
// Reference: Garmin "GDL 90 Data Interface Specification" (560-1058-00 Rev A).
// The AHRS message (ID 0x4C) is Levil's own extension to GDL90; its layout here
// follows the publicly implemented version of that message (used by Stratux and
// read by EFB apps). Verify it against real BOM packet captures.

'use strict';

// ---------------------------------------------------------------- CRC ------
// CRC-16-CCITT, polynomial 0x1021, initial value 0, as given in the GDL90 spec.
const CRC_TABLE = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
    let crc = (i << 8) & 0xffff;
    for (let bit = 0; bit < 8; bit++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    CRC_TABLE[i] = crc;
}

function crc16(bytes) {
    let crc = 0;
    for (const b of bytes) {
        crc = (CRC_TABLE[crc >> 8] ^ ((crc << 8) & 0xffff) ^ b) & 0xffff;
    }
    return crc;
}

// ------------------------------------------------------------ framing ------
const FLAG = 0x7e;
const ESC = 0x7d;

/** Wrap a raw message (ID + payload) into a transmittable GDL90 frame. */
function frame(message) {
    const crc = crc16(message);
    const withCrc = [...message, crc & 0xff, crc >> 8];
    const out = [FLAG];
    for (const b of withCrc) {
        if (b === FLAG || b === ESC) out.push(ESC, b ^ 0x20);
        else out.push(b);
    }
    out.push(FLAG);
    return Buffer.from(out);
}

/**
 * Split a received UDP datagram into messages. One datagram can hold several
 * frames. Returns [{ ok, id, bytes }] where bytes = ID + payload (no CRC).
 */
function unframe(datagram) {
    const results = [];
    let current = null;
    let escaping = false;
    for (const b of datagram) {
        if (b === FLAG) {
            if (current && current.length >= 3) {
                const body = current.slice(0, -2);
                const rxCrc = current[current.length - 2] | (current[current.length - 1] << 8);
                results.push({ ok: crc16(body) === rxCrc, id: body[0], bytes: Buffer.from(body) });
            }
            current = [];
            escaping = false;
        } else if (current) {
            if (escaping) { current.push(b ^ 0x20); escaping = false; }
            else if (b === ESC) escaping = true;
            else current.push(b);
        }
    }
    return results;
}

// ----------------------------------------------------------- helpers ------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Latitude/longitude -> 24-bit two's complement, resolution 180 / 2^23 deg. */
function encodeSemicircle(deg) {
    let v = Math.round(deg * (0x800000 / 180));
    if (v < 0) v += 0x1000000;
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
function decodeSemicircle(b0, b1, b2) {
    let v = (b0 << 16) | (b1 << 8) | b2;
    if (v & 0x800000) v -= 0x1000000;
    return v * (180 / 0x800000);
}

function int16be(v) {
    const x = clamp(Math.round(v), -32768, 32767) & 0xffff;
    return [x >> 8, x & 0xff];
}
function uint16be(v) {
    const x = clamp(Math.round(v), 0, 0xffff);
    return [x >> 8, x & 0xff];
}
const readInt16be = (b, i) => { const v = (b[i] << 8) | b[i + 1]; return v & 0x8000 ? v - 0x10000 : v; };
const readUint16be = (b, i) => (b[i] << 8) | b[i + 1];

// ------------------------------------------------------ message IDs ------
const ID = {
    HEARTBEAT: 0x00,
    OWNSHIP: 0x0a,
    OWNSHIP_GEO_ALT: 0x0b,
    LEVIL: 0x4c,
};

// --------------------------------------------------------- encoders ------

/**
 * Heartbeat (ID 0x00): sent once per second. Tells the receiver the device is
 * alive, whether GPS is valid, and the UTC time as seconds since midnight.
 */
function heartbeat({ gpsValid, secondsSinceMidnight }) {
    const ts = clamp(Math.floor(secondsSinceMidnight), 0, 86399);
    const status1 = (gpsValid ? 0x80 : 0) | 0x01;          // GPS pos valid, UAT initialized
    const status2 = ((ts >> 16) & 1) << 7 | (gpsValid ? 0x01 : 0); // timestamp bit 16, UTC OK
    return frame([ID.HEARTBEAT, status1, status2, ts & 0xff, (ts >> 8) & 0xff, 0x00, 0x00]);
}

/**
 * Ownship Report (ID 0x0A): the aircraft's own GPS position and motion.
 * Pressure altitude goes here (25 ft steps); GPS altitude has its own message.
 */
function ownship({ lat, lon, pressureAltFt, groundSpeedKt, verticalSpeedFpm, trackDeg,
    airborne, gpsValid, icaoAddress = 0xb0b301, callsign = 'BOM1301' }) {
    const m = new Array(28).fill(0);
    m[0] = ID.OWNSHIP;
    m[1] = 0x00; // no traffic alert, address type 0 = ADS-B with ICAO address
    m[2] = (icaoAddress >> 16) & 0xff; m[3] = (icaoAddress >> 8) & 0xff; m[4] = icaoAddress & 0xff;

    const [la0, la1, la2] = gpsValid ? encodeSemicircle(lat) : [0, 0, 0];
    const [lo0, lo1, lo2] = gpsValid ? encodeSemicircle(lon) : [0, 0, 0];
    m[5] = la0; m[6] = la1; m[7] = la2;
    m[8] = lo0; m[9] = lo1; m[10] = lo2;

    // 12-bit altitude: (feet + 1000) / 25, 0xFFF = invalid. Then 4 misc bits.
    const alt = isNum(pressureAltFt) ? clamp(Math.round((pressureAltFt + 1000) / 25), 0, 0xffe) : 0xfff;
    const misc = (airborne ? 0x08 : 0) | 0x01; // bit3 airborne, bits1-0 = 01 true track
    m[11] = (alt >> 4) & 0xff;
    m[12] = ((alt & 0x0f) << 4) | misc;

    m[13] = gpsValid ? 0x89 : 0x00; // NIC=8 (<185 m), NACp=9 (<30 m) - typical WAAS GPS

    const hvel = isNum(groundSpeedKt) ? clamp(Math.round(groundSpeedKt), 0, 0xffe) : 0xfff;
    let vvel = 0x800; // "unknown"
    if (isNum(verticalSpeedFpm)) {
        vvel = clamp(Math.round(verticalSpeedFpm / 64), -510, 510);
        if (vvel < 0) vvel += 0x1000;
    }
    m[14] = (hvel >> 4) & 0xff;
    m[15] = ((hvel & 0x0f) << 4) | ((vvel >> 8) & 0x0f);
    m[16] = vvel & 0xff;

    m[17] = isNum(trackDeg) ? Math.round((((trackDeg % 360) + 360) % 360) * 256 / 360) & 0xff : 0;
    m[18] = 0x01; // emitter category: light aircraft
    const cs = (callsign + '        ').slice(0, 8);
    for (let i = 0; i < 8; i++) m[19 + i] = cs.charCodeAt(i);
    m[27] = 0x00; // no emergency
    return frame(m);
}

/** Ownship Geometric Altitude (ID 0x0B): GPS altitude in 5 ft steps. */
function ownshipGeoAlt({ gpsAltFt }) {
    const alt = isNum(gpsAltFt) ? clamp(Math.round(gpsAltFt / 5), -32768, 32767) : 0;
    const [a0, a1] = int16be(alt);
    // Vertical Figure Of Merit = 10 m, no warning
    return frame([ID.OWNSHIP_GEO_ALT, a0, a1, 0x00, 0x0a]);
}

/**
 * Levil AHRS (ID 0x4C, sub-ID 0x45, type 0x01, version 0x01). Big-endian int16s.
 * 0x7FFF means "not available".
 */
function levilAhrs({ rollDeg, pitchDeg, headingDeg, slipDeg, yawRateDps, gLoad,
    iasKt, pressureAltFt, verticalSpeedFpm }) {
    const t = (v, scale) => (isNum(v) ? int16be(v * scale) : [0x7f, 0xff]);
    const palt = isNum(pressureAltFt) ? uint16be(Math.floor(pressureAltFt + 5000.5)) : [0xff, 0xff]; // feet + 5000, rounded
    return frame([
        ID.LEVIL, 0x45, 0x01, 0x01,
        ...t(rollDeg, 10),
        ...t(pitchDeg, 10),
        ...t(headingDeg, 10),
        ...t(slipDeg, 10),
        ...t(yawRateDps, 10),
        ...t(gLoad, 10),
        ...t(iasKt, 10),
        ...palt,
        ...t(verticalSpeedFpm, 1),
        0x7f, 0xff, // reserved
    ]);
}

// --------------------------------------------------------- decoders ------
/** Turn one unframed message into a plain object. Unknown IDs return {type:'unknown'}. */
function decode(msg) {
    const b = msg.bytes;
    switch (msg.id) {
        case ID.HEARTBEAT: {
            const ts = ((b[2] >> 7) << 16) | (b[4] << 8) | b[3];
            return { type: 'heartbeat', gpsValid: !!(b[1] & 0x80), secondsSinceMidnight: ts };
        }
        case ID.OWNSHIP: {
            const alt = (b[11] << 4) | (b[12] >> 4);
            const hvel = (b[14] << 4) | (b[15] >> 4);
            let vvel = ((b[15] & 0x0f) << 8) | b[16];
            if (vvel === 0x800) vvel = null;
            else if (vvel & 0x800) vvel -= 0x1000;
            return {
                type: 'ownship',
                lat: decodeSemicircle(b[5], b[6], b[7]),
                lon: decodeSemicircle(b[8], b[9], b[10]),
                pressureAltFt: alt === 0xfff ? null : alt * 25 - 1000,
                airborne: !!(b[12] & 0x08),
                nic: b[13] >> 4,
                nacp: b[13] & 0x0f,
                groundSpeedKt: hvel === 0xfff ? null : hvel,
                verticalSpeedFpm: vvel === null ? null : vvel * 64,
                trackDeg: b[17] * 360 / 256,
                callsign: String.fromCharCode(...b.slice(19, 27)).trim(),
            };
        }
        case ID.OWNSHIP_GEO_ALT:
            return { type: 'geoAlt', gpsAltFt: readInt16be(b, 1) * 5 };
        case ID.LEVIL: {
            if (b[1] === 0x45 && b[2] === 0x01) {
                const f = (i, scale) => { const v = readInt16be(b, i); return v === 0x7fff ? null : v / scale; };
                const palt = readUint16be(b, 18);
                return {
                    type: 'ahrs',
                    rollDeg: f(4, 10), pitchDeg: f(6, 10), headingDeg: f(8, 10),
                    slipDeg: f(10, 10), yawRateDps: f(12, 10), gLoad: f(14, 10),
                    iasKt: f(16, 10),
                    pressureAltFt: palt === 0xffff ? null : palt - 5000,
                    verticalSpeedFpm: f(20, 1),
                };
            }
            return { type: 'levil-other', subId: b[1] };
        }
        default:
            return { type: 'unknown', id: msg.id };
    }
}

module.exports = {
    crc16, frame, unframe, decode, ID,
    heartbeat, ownship, ownshipGeoAlt, levilAhrs,
};
