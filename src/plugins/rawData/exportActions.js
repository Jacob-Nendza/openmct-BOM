/*
 * "Export Raw Data as ..." entries in the ⋯ menu (top-right of the Raw Data
 * view, and the right-click menu on "Raw Data" in the tree). A platform's
 * main folder (e.g. "BOM Data") gets the same entries once its plugin calls
 * addExportFolder() - see installRawData() in ./plugin.js.
 *
 * Each format is one entry in FORMATS below. To add a format (JSON, MATLAB
 * .mat, Excel, ...), add an entry with a name, a file extension, a MIME type,
 * a build() that turns the recording into the file's text and, optionally, a
 * fileName(). A menu item appears for every entry automatically.
 *
 * Exports are written oldest-first, the order analysis tools expect.
 */

import { bomLogFileName, buildBOMLog } from './bomLogFormat.js';
import { getRecorder } from './recorder.js';
import { RAW_DATA_TYPE } from './rawDataView.js';

const FORMATS = [
  {
    key: 'csv',
    name: 'CSV (BOM log format)',
    extension: 'csv',
    mimeType: 'text/csv',
    // Same layout as the Levil BOM's own CSV logs (SOURCE/TAIL/DATE/TIME
    // header, UNITS, LEGEND, DATA rows) - see ./bomLogFormat.js. Opens in
    // Excel, MATLAB and Python, and the BOM Emulator can replay it.
    build: buildBOMLog,
    fileName: bomLogFileName
  }
];

// Main platform folders that also show the export entries:
// "namespace:key" of the folder -> recorder source id (e.g. 'bom').
const exportFolders = new Map();

function folderKeyString(identifier) {
  return `${identifier.namespace}:${identifier.key}`;
}

export function addExportFolder(folderIdentifier, sourceId) {
  exportFolders.set(folderKeyString(folderIdentifier), sourceId);
}

// Which recording does this object export? undefined = no export entries.
function sourceIdFor(domainObject) {
  if (!domainObject) {
    return undefined;
  }
  if (domainObject.type === RAW_DATA_TYPE) {
    return domainObject.rawData.source;
  }
  if (domainObject.identifier) {
    return exportFolders.get(folderKeyString(domainObject.identifier));
  }
  return undefined;
}

function download(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function createExportActions(openmct) {
  return FORMATS.map((format) => ({
    key: `flight.rawData.export.${format.key}`,
    name: `Export Raw Data as ${format.name}`,
    description: `Download every recorded sample as a .${format.extension} file`,
    cssClass: 'icon-download',
    group: 'view',
    priority: 1,

    appliesTo(objectPath) {
      return Boolean(objectPath && sourceIdFor(objectPath[0]));
    },

    invoke(objectPath) {
      const recorder = getRecorder(sourceIdFor(objectPath[0]));
      if (!recorder.rows.length) {
        openmct.notifications.alert('No raw data recorded yet - nothing to export.');
        return;
      }
      let filename;
      if (format.fileName) {
        filename = format.fileName(recorder); // e.g. OpenMCT_BOM-20261006T171300.csv
      } else {
        // e.g. bom-raw-data_2026-09-29T21-40-05Z.csv
        const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
        filename = `${recorder.sourceId}-raw-data_${stamp}.${format.extension}`;
      }
      download(format.build(recorder), filename, format.mimeType);
      openmct.notifications.info(
        `Exported ${recorder.rows.length.toLocaleString()} rows to ${filename}`
      );
    }
  }));
}
