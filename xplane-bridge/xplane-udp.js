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
    this.xplaneHost = options.xplaneHost || '127.0.0.1';
    this.xplanePort = options.xplanePort || 49000;
    this.localPort = options.localPort || 49001;
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
        resolve();
      });
    });
  }

  stop() {
    this._unsubscribeAll();
    this.socket.close();
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
        this.emit('data', { key, rawValue, timestamp: Date.now() });
      }
    }
  }
}

module.exports = XPlaneUDP;
