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
    this.socket = null; // created in start(), closed in stop(), so the client can be restarted
  }

  // Opens a UDP socket and asks X-Plane to start streaming the datarefs.
  start() {
    if (this.socket) {
      return Promise.resolve(); // already running
    }

    this.lastDataAt = 0;
    this.connected = false;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (message) => this._handleMessage(message));

    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.localPort, () => {
        this.socket.removeListener('error', reject);
        this.socket.on('error', (error) => this.emit('error', error));
        this._subscribeAll();
        this.watchdog = setInterval(() => this._checkConnection(), this.resubscribeMs);
        resolve();
      });
    });
  }

  // Tells X-Plane to stop streaming (RREF with frequency 0), then closes the
  // socket. After this X-Plane sends nothing to the bridge.
  stop() {
    clearInterval(this.watchdog);
    this.watchdog = null;

    const socket = this.socket;
    if (!socket) {
      return Promise.resolve();
    }
    this.socket = null;

    return Promise.all(
      this.datarefs.map((dataref, index) => this._sendSubscribe(dataref.path, index, 0, socket))
    ).then(() => {
      socket.close();
      this.connected = false;
    });
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

  _sendSubscribe(datarefPath, index, freq, socket = this.socket) {
    const packet = Buffer.alloc(PACKET_LENGTH);
    packet.write(RREF_HEADER, 0, 'ascii');
    packet.writeInt32LE(freq, 5);
    packet.writeInt32LE(index, 9);
    packet.write(datarefPath, 13, 'ascii');

    return new Promise((resolve) => {
      socket.send(packet, this.xplanePort, this.xplaneHost, (error) => {
        if (error) {
          this.emit('error', error);
        }
        resolve();
      });
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
