/*
 * BOM dashboard settings: the view you see when you click the "BOM Data"
 * folder. The dashboard itself is shared with the other platforms and lives
 * in ../flightDashboard/dashboardView.js; this file only says what goes where.
 *
 * LAYOUT is the dashboard cell by cell, left-to-right then top-to-bottom, on
 * an 8-column grid. kind: 'plot' | 'strip' | 'readout'; span: columns wide.
 *
 * Track, Yaw Rate and GPS Vertical Speed aren't on the dashboard; they're in
 * the folder's List/Grid views (view switcher) and can be added to LAYOUT.
 */

import createDashboardViewProvider from '../flightDashboard/dashboardView.js';
import { BOM_FOLDER_KEY, measurements, NAMESPACE } from './dictionary.js';

const LAYOUT = [
  { key: 'pressure_altitude', kind: 'plot', span: 4 },
  { key: 'airspeed', kind: 'plot', span: 4 },

  { key: 'pitch', kind: 'strip', span: 2 },
  { key: 'roll', kind: 'strip', span: 2 },
  { key: 'pressure_altitude', kind: 'readout', span: 1 },
  { key: 'airspeed', kind: 'readout', span: 1 },
  { key: 'pitch', kind: 'readout', span: 1 },
  { key: 'roll', kind: 'readout', span: 1 },

  { key: 'heading', kind: 'plot', span: 4 },
  { key: 'vertical_speed', kind: 'plot', span: 4 },
  { key: 'ground_speed', kind: 'plot', span: 4 },
  { key: 'g_load', kind: 'plot', span: 4 },
  { key: 'gps_altitude', kind: 'plot', span: 4 },
  { key: 'slip', kind: 'plot', span: 4 },
  { key: 'latitude', kind: 'plot', span: 4 },
  { key: 'longitude', kind: 'plot', span: 4 }
];

export default function BOMDashboardViewProvider(openmct) {
  return createDashboardViewProvider(openmct, {
    key: 'bom.dashboard',
    namespace: NAMESPACE,
    folderKey: BOM_FOLDER_KEY,
    measurements,
    layout: LAYOUT
  });
}
