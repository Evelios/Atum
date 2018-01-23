import Polygon from "../geometry/Polygon";
import Line from "../geometry/Line";
import Rand from "../utilities/Rand";
import { setOptions } from "../utilities/Util";

/**
 * Subdivide a polygon up into smaller polygons. The general principal of this
 * subdivision works by splitting up the polygon on its minor axis similar to
 * how a binary space partition would work.
 * 
 * @export
 * @param {Polygon} polygon 
 * @param {object} options The options that can be changed to control how the
 *  polygon subdivision works
 * 
 *  options = {
 *      depth {number}: The depth to which the subdivision occurs
 *      dropoutRate {number}: 0-1 The change a tile won't be subdivided
 *  }
 * 
 *  defaults = {
 *      depth: 3,
 *      dropoutRate: 0
 *  }
 * 
 *  @return {Polygon} The root note of the polygon subdivision tree
 */
export default function polygonSubdivide(polygon, options) {
    "use strict";
    const defaults = {
        depth: 3,
        dropoutRate: 0,
    };

    const params = setOptions(options, defaults);

    let root = polygon;
    root.depth = 0;

    let frontier = [root];

    while (frontier.length > 0) {
        const tile = frontier.pop();
        const minorAxis = tile.minorAxis();

        if (minorAxis === null || Rand.chance(params.dropoutRate)) {
            continue;
        }

        let corners1 = tile.corners.filter(corner =>
            minorAxis.pointAboveLine(corner));

        let corners2 = tile.corners.filter(corner => 
            !minorAxis.pointAboveLine(corner));
            
        corners1.push(minorAxis.p1, minorAxis.p2, minorAxis.midpoint());
        corners2.push(minorAxis.p1, minorAxis.p2, minorAxis.midpoint());

        let subpoly1 = new Polygon(corners1);
        let subpoly2 = new Polygon(corners2);

        subpoly1.depth = tile.depth + 1;
        subpoly2.depth = tile.depth + 1;

        tile.children = [subpoly1, subpoly2];

        if (subpoly1.depth <= params.depth) {
            frontier.push(subpoly1, subpoly2);
        }
    }

    return root;
}