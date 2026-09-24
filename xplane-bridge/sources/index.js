'use strict';

/*
 * The list of data sources the bridge can switch between.
 *
 * The id (left side) is what Open MCT sends to select a source and what goes
 * in the history URL (/history/<id>/<key>). `name` is what the Source
 * dropdown in Open MCT shows.
 *
 * To add another platform, write sources/<name>.js with the
 * same shape as sources/xplane.js - a create() function returning
 * { start(), stop() } - then add a line for it below.
 */

module.exports = {
  xplane: { name: 'X-Plane', create: require('./xplane.js') },
  bom: { name: 'Levil BOM', create: require('./bom.js') }
};
