/*
 * X-Plane telemetry dictionary.
 *
 * Defines the object tree Open MCT shows for X-Plane data: one "X-Plane
 * Aircraft" folder containing 8 measurement objects. This mirrors the
 * dictionary/composition pattern from NASA's own openmct-tutorial, and the
 * same namespace/object-provider shape as the BOM data plugin
 * (src/plugins/bomData/plugin.js) in this repo.
 *
 * The bridge server (see /xplane-bridge at the repo root) is the one place
 * that talks to X-Plane over UDP. This file only describes what the
 * telemetry looks like to Open MCT; it never touches the network itself.
 */

export const NAMESPACE = 'xplane.taxonomy';
export const AIRCRAFT_FOLDER_KEY = 'xplaneAircraft';

// Keep this list's `key` values in sync with xplane-bridge/datarefs.js —
// the bridge server uses the same keys when it broadcasts samples.
export const measurements = [
  { key: 'latitude', name: 'Latitude', units: 'deg' },
  { key: 'longitude', name: 'Longitude', units: 'deg' },
  { key: 'altitude', name: 'Altitude (MSL)', units: 'ft' },
  { key: 'heading', name: 'Heading (True)', units: 'deg' },
  { key: 'pitch', name: 'Pitch', units: 'deg' },
  { key: 'roll', name: 'Roll', units: 'deg' },
  { key: 'airspeed', name: 'Indicated Airspeed', units: 'kt' },
  { key: 'vertical_speed', name: 'Vertical Speed', units: 'ft/min' }
];

function getAircraftFolder(identifier) {
  return {
    identifier: identifier,
    name: 'X-Plane Aircraft',
    type: 'folder',
    location: 'ROOT'
  };
}

function getMeasurementObject(identifier, measurement) {
  return {
    identifier: identifier,
    name: measurement.name,
    type: 'xplane.telemetry',
    telemetry: {
      values: [
        {
          key: 'value',
          name: measurement.name,
          units: measurement.units,
          format: 'float',
          hints: { range: 1 }
        },
        {
          key: 'utc',
          source: 'timestamp',
          name: 'Timestamp',
          format: 'utc',
          hints: { domain: 1 }
        }
      ]
    },
    location: `${NAMESPACE}:${AIRCRAFT_FOLDER_KEY}`
  };
}

export default function XPlaneDictionaryPlugin() {
  return function install(openmct) {
    openmct.objects.addRoot({
      namespace: NAMESPACE,
      key: AIRCRAFT_FOLDER_KEY
    });

    openmct.objects.addProvider(NAMESPACE, {
      get: function (identifier) {
        if (identifier.key === AIRCRAFT_FOLDER_KEY) {
          return Promise.resolve(getAircraftFolder(identifier));
        }

        const measurement = measurements.find((m) => m.key === identifier.key);
        if (measurement) {
          return Promise.resolve(getMeasurementObject(identifier, measurement));
        }

        return undefined;
      }
    });

    openmct.composition.addProvider({
      appliesTo: function (domainObject) {
        return (
          domainObject.identifier.namespace === NAMESPACE &&
          domainObject.identifier.key === AIRCRAFT_FOLDER_KEY
        );
      },
      load: function () {
        return Promise.resolve(
          measurements.map((m) => ({
            namespace: NAMESPACE,
            key: m.key
          }))
        );
      }
    });

    openmct.types.addType('xplane.telemetry', {
      name: 'X-Plane Telemetry Point',
      description: 'A telemetry point streamed live from X-Plane 11 via the UDP bridge.',
      cssClass: 'icon-telemetry'
    });
  };
}
