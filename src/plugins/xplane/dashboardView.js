/*
 * X-Plane dashboard settings: the view you see when you click the
 * "X-Plane Aircraft" folder. The dashboard itself is shared with the other
 * platforms and lives in ../flightDashboard/dashboardView.js; this file only
 * says what goes where.
 *
 * LAYOUT is the dashboard cell by cell, left-to-right then top-to-bottom, on
 * an 8-column grid. kind: 'plot' | 'strip' | 'readout'; span: columns wide.
 */

import createDashboardViewProvider from '../flightDashboard/dashboardView.js';
import { AIRCRAFT_FOLDER_KEY, measurements, NAMESPACE } from './dictionary.js';

const LAYOUT = [
  { key: 'altitude', kind: 'plot', span: 4 },
  { key: 'airspeed', kind: 'plot', span: 4 },

  { key: 'pitch', kind: 'strip', span: 2 },
  { key: 'roll', kind: 'strip', span: 2 },
  { key: 'altitude', kind: 'readout', span: 1 },
  { key: 'airspeed', kind: 'readout', span: 1 },
  { key: 'pitch', kind: 'readout', span: 1 },
  { key: 'roll', kind: 'readout', span: 1 },

  { key: 'heading', kind: 'plot', span: 4 },
  { key: 'vertical_speed', kind: 'plot', span: 4 },
  { key: 'latitude', kind: 'plot', span: 4 },
  { key: 'longitude', kind: 'plot', span: 4 }
];

export default function XPlaneDashboardViewProvider(openmct) {
  return createDashboardViewProvider(openmct, {
    key: 'xplane.dashboard',
    namespace: NAMESPACE,
    folderKey: AIRCRAFT_FOLDER_KEY,
    measurements,
    layout: LAYOUT
  });
}
