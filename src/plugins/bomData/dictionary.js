/*
 * Levil BOM telemetry dictionary.
 *
 * Defines what Open MCT shows under the "BOM Data" root folder: one
 * measurement object per value the bridge decodes from the BOM's GDL90
 * packets. Same pattern as ../xplane/dictionary.js.
 *
 * The bridge (xplane-bridge/sources/bom.js) does the UDP listening and GDL90
 * decoding. This file only describes the telemetry to Open MCT.
 */

export const NAMESPACE = 'bom.taxonomy';
export const BOM_FOLDER_KEY = 'bomData';

// Keep these `key` values in sync with FIELDS in xplane-bridge/sources/bom.js.
// `source` = which GDL90 message the value comes from (shown in the description).
export const measurements = [
  { key: 'pressure_altitude', name: 'Pressure Altitude', units: 'ft', source: 'Ownship Report' },
  { key: 'gps_altitude', name: 'GPS Altitude', units: 'ft', source: 'Ownship Geometric Altitude' },
  { key: 'airspeed', name: 'Indicated Airspeed', units: 'kt', source: 'Levil AHRS' },
  { key: 'ground_speed', name: 'Ground Speed', units: 'kt', source: 'Ownship Report' },
  { key: 'pitch', name: 'Pitch', units: 'deg', source: 'Levil AHRS' },
  { key: 'roll', name: 'Roll', units: 'deg', source: 'Levil AHRS' },
  { key: 'heading', name: 'Heading (Magnetic)', units: 'deg', source: 'Levil AHRS' },
  { key: 'track', name: 'GPS Track (True)', units: 'deg', source: 'Ownship Report' },
  { key: 'vertical_speed', name: 'Vertical Speed', units: 'ft/min', source: 'Levil AHRS' },
  { key: 'gps_vertical_speed', name: 'GPS Vertical Speed', units: 'ft/min', source: 'Ownship Report' },
  { key: 'slip', name: 'Slip / Skid', units: 'deg', source: 'Levil AHRS' },
  { key: 'yaw_rate', name: 'Yaw Rate', units: 'deg/s', source: 'Levil AHRS' },
  { key: 'g_load', name: 'G Load', units: 'g', source: 'Levil AHRS' },
  { key: 'latitude', name: 'Latitude', units: 'deg', source: 'Ownship Report' },
  { key: 'longitude', name: 'Longitude', units: 'deg', source: 'Ownship Report' }
];

function getBOMFolder(identifier) {
  return {
    identifier: identifier,
    name: 'BOM Data',
    type: 'folder',
    location: 'ROOT'
  };
}

function getMeasurementObject(identifier, measurement) {
  return {
    identifier: identifier,
    name: measurement.name,
    type: 'bom.telemetry',
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
    location: `${NAMESPACE}:${BOM_FOLDER_KEY}`
  };
}

export default function BOMDictionaryPlugin() {
  return function install(openmct) {
    openmct.objects.addRoot({
      namespace: NAMESPACE,
      key: BOM_FOLDER_KEY
    });

    openmct.objects.addProvider(NAMESPACE, {
      get: function (identifier) {
        if (identifier.key === BOM_FOLDER_KEY) {
          return Promise.resolve(getBOMFolder(identifier));
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
          domainObject.identifier.key === BOM_FOLDER_KEY
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

    openmct.types.addType('bom.telemetry', {
      name: 'BOM Telemetry Point',
      description: 'A telemetry point from the Levil BOM (GDL90 over UDP) via the bridge.',
      cssClass: 'icon-telemetry'
    });
  };
}
