'use strict';

/*
 * The X-Plane datarefs this bridge subscribes to, and how to convert each
 * raw value into the units Open MCT should display.
 *
 * IMPORTANT: the `key` values here must match the measurement keys in
 * ../src/plugins/xplane/dictionary.js exactly — that's how the browser
 * plugin and this server agree on what each sample is.
 */

const METERS_TO_FEET = 3.28084;

module.exports = [
  { key: 'latitude', path: 'sim/flightmodel/position/latitude', name: 'Latitude' },
  { key: 'longitude', path: 'sim/flightmodel/position/longitude', name: 'Longitude' },
  {
    key: 'altitude',
    path: 'sim/flightmodel/position/elevation',
    name: 'Altitude (MSL)',
    convert: (metersValue) => metersValue * METERS_TO_FEET
  },
  { key: 'heading', path: 'sim/flightmodel/position/psi', name: 'Heading (True)' },
  { key: 'pitch', path: 'sim/flightmodel/position/theta', name: 'Pitch' },
  { key: 'roll', path: 'sim/flightmodel/position/phi', name: 'Roll' },
  { key: 'airspeed', path: 'sim/flightmodel/position/indicated_airspeed', name: 'Indicated Airspeed' },
  { key: 'vertical_speed', path: 'sim/flightmodel/position/vh_ind', name: 'Vertical Speed' }
];
