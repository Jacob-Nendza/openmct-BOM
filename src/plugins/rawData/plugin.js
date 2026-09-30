/*
 * Raw Data - shared by every platform folder (BOM Data, X-Plane Aircraft, ...).
 *
 *   recorder.js      - records every sample from the moment Open MCT loads
 *   rawDataView.js   - the "Raw Data" table (columns, newest row on top)
 *   exportActions.js - "Export Raw Data as ..." in the ⋯ menu (file formats)
 *
 * A platform adds a "Raw Data" item to its folder by:
 *   1. calling installRawData(openmct, sourceId, measurements) in its plugin.js
 *   2. listing RAW_DATA_KEY in its folder's composition (dictionary.js)
 *   3. returning rawDataObject(...) from its object provider for RAW_DATA_KEY
 */

import createExportActions from './exportActions.js';
import { getRecorder } from './recorder.js';
import RawDataViewProvider, { RAW_DATA_TYPE } from './rawDataView.js';

export { RAW_DATA_TYPE };
export const RAW_DATA_KEY = 'raw_data';
export const RAW_DATA_NAME = 'Raw Data';

const installedIn = new WeakSet(); // the shared view/actions are registered once per app

export function rawDataObject(identifier, sourceId, location) {
  return {
    identifier,
    name: RAW_DATA_NAME,
    type: RAW_DATA_TYPE,
    rawData: { source: sourceId },
    location
  };
}

export function installRawData(openmct, sourceId, measurements) {
  getRecorder(sourceId, measurements); // start recording now, not when the view opens

  if (installedIn.has(openmct)) {
    return;
  }
  installedIn.add(openmct);

  openmct.types.addType(RAW_DATA_TYPE, {
    name: 'Raw Data',
    description: 'Every recorded sample for a platform, in columns, newest first. Exportable.',
    cssClass: 'icon-tabular'
  });
  openmct.objectViews.addProvider(RawDataViewProvider());
  createExportActions(openmct).forEach((action) => openmct.actions.register(action));
}
