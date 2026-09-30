/*
 * "Export Raw Data as ..." entries in the ⋯ menu (top-right of the Raw Data
 * view, and the right-click menu on "Raw Data" in the tree).
 *
 * The final file type is still TBD, so each format is one entry in FORMATS
 * below. To add a format (JSON, MATLAB .mat, Excel, ...), add an entry with a
 * name, a file extension, a MIME type and a build() that turns the recording
 * into the file's text. A menu item appears for every entry automatically.
 *
 * Exports ALWAYS write full precision (the table on screen rounds for
 * readability) and oldest-first, the order analysis tools expect.
 */

import { getRecorder } from './recorder.js';
import { RAW_DATA_TYPE } from './rawDataView.js';

function csvField(text) {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const FORMATS = [
  {
    key: 'csv',
    name: 'CSV',
    extension: 'csv',
    mimeType: 'text/csv',
    // Opens in Excel, MATLAB (readtable), Python (pandas.read_csv), ...
    // Columns: timestamp_utc, unix_time_ms, then one per measurement.
    build(recorder) {
      const header = ['timestamp_utc', 'unix_time_ms'].concat(
        recorder.measurements.map((m) => (m.units ? `${m.name} (${m.units})` : m.name))
      );
      const lines = [header.map(csvField).join(',')];
      recorder.rows.forEach((row) => {
        const fields = [new Date(row.timestamp).toISOString(), String(row.timestamp)];
        recorder.measurements.forEach((m) => {
          const value = row.values[m.key];
          fields.push(value === undefined ? '' : String(value));
        });
        lines.push(fields.join(','));
      });
      return lines.join('\r\n') + '\r\n';
    }
  }
];

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
      return objectPath && objectPath[0] && objectPath[0].type === RAW_DATA_TYPE;
    },

    invoke(objectPath) {
      const recorder = getRecorder(objectPath[0].rawData.source);
      if (!recorder.rows.length) {
        openmct.notifications.alert('No raw data recorded yet - nothing to export.');
        return;
      }
      // e.g. bom-raw-data_2026-09-29T21-40-05Z.csv
      const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
      const filename = `${recorder.sourceId}-raw-data_${stamp}.${format.extension}`;
      download(format.build(recorder), filename, format.mimeType);
      openmct.notifications.info(
        `Exported ${recorder.rows.length.toLocaleString()} rows to ${filename}`
      );
    }
  }));
}
