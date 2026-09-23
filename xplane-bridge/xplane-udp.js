'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');

// X-Plane's RREF subscribe-request packet layout:
//   "RREF\0"  (5 bytes)
//   int32 freq         - samples per second X-Plane should send, 0 = unsubscribe
//   int32 index        - a number WE choose to identify this dataref in responses
//   char[400] dataref  - the dataref path, null-terminated/padded
const RREF_HEADER = 'RREF\0';
const DATAREF_FIELD_LENGTH = 400;
const PACKET_LENGTH = RREF_HEADER.length + 4 + 4 + DATAREF_FIELD_LENGTH;

// X-Plane's RREF response packet layout:
//   "RREF,"           (5 bytes)
//   repeated: int32 index + float32 value   (8 bytes per dataref, per packet)

class XPlaneUDP extends EventEmitter {
  constructor(options = {}) {
    super();
    this.xplaneHost = options.xplaneHost || process.env.XPLANE_HOST || '127.0.0.1';
    this.xplanePort = options.xplanePort || Number(process.env.XPLANE_PORT) || 49000;
    // Port 0 = let the OS pick a free port. X-Plane replies to whatever port
    // the request came from, and X-Plane 11 itself uses 49001 as its own
    // sending port, so binding 49001 here can collide with it on the same PC.
    this.localPort = options.localPort || 0;
    // If no data has arrived for this long, re-send the subscriptions. This
    // covers starting the bridge before X-Plane, or loading a new flight.
    this.resubscribeMs = options.resubscribeMs || 3000;
    this.lastDataAt = 0;
    this.connected = false;
    this.watchdog = null;
    this.frequencyHz = options.frequencyHz || 10;
    this.datarefs = options.datarefs || [];
    this.indexToKey = new Map();
    this.socket = dgram.createSocket('udp4');
  }

  start() {
    this.socket.on('message', (message) => this._handleMessage(message));
    this.socket.on('error', (error) => this.emit('error', error));

    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.localPort, () => {
        this._subscribeAll();
        this.watchdog = setInterval(() => this._checkConnection(), this.resubscribeMs);
        resolve();
      });
    });
  }

  stop() {
    clearInterval(this.watchdog);
    this._unsubscribeAll();
    this.socket.close();
  }

  _checkConnection() {
    const silentFor = Date.now() - this.lastDataAt;
    if (silentFor > this.resubscribeMs) {
      if (this.connected) {
        this.connected = false;
        this.emit('disconnected');
      }
      this._subscribeAll();
    }
  }

  _subscribeAll() {
    this.datarefs.forEach((dataref, index) => {
      this.indexToKey.set(index, dataref.key);
      this._sendSubscribe(dataref.path, index, this.frequencyHz);
    });
  }

  _unsubscribeAll() {
    this.datarefs.forEach((dataref, index) => {
      this._sendSubscribe(dataref.path, index, 0);
    });
  }

  _sendSubscribe(datarefPath, index, freq) {
    const packet = Buffer.alloc(PACKET_LENGTH);
    packet.write(RREF_HEADER, 0, 'ascii');
    packet.writeInt32LE(freq, 5);
    packet.writeInt32LE(index, 9);
    packet.write(datarefPath, 13, 'ascii');

    this.socket.send(packet, this.xplanePort, this.xplaneHost, (error) => {
      if (error) {
        this.emit('error', error);
      }
    });
  }

  _handleMessage(message) {
    if (message.length < 5 || message.toString('ascii', 0, 4) !== 'RREF') {
      return;
    }

    const recordStart = 5;
    const recordLength = 8;
    const recordCount = Math.floor((message.length - recordStart) / recordLength);

    for (let i = 0; i < recordCount; i++) {
      const offset = recordStart + i * recordLength;
      const index = message.readInt32LE(offset);
      const rawValue = message.readFloatLE(offset + 4);
      const key = this.indexToKey.get(index);

      if (key) {
        this.lastDataAt = Date.now();
        if (!this.connected) {
          this.connected = true;
          this.emit('connected');
        }
        this.emit('data', { key, rawValue, timestamp: Date.now() });
      }
    }
  }
}

module.exports = XPlaneUDP;
