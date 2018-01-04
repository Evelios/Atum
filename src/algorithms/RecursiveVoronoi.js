import Diagram from "../graph/Diagram";
import { poisson, jitteredGrid } from "../utilities/PointDistribution";

export default function recursiveVoronoi(bbox, depth, density) {
    "use strict";

    let diagram = new Diagram(poisson(bbox, density), bbox);

    for (let tile of diagram.tiles) {
        tile.depth = 0;

        generateInPolygon(tile, 0, density / 6);
    }

    return diagram;
}

function generateInPolygon(poly, currentDepth, density) {
    "use strict";

    let subdiagram = new Diagram(poisson(poly.bbox(), density), poly.bbox());
    let subTiles = clipToRegion(subdiagram, poly);
    // let subTiles = subdiagram.tiles;
    subTiles.forEach(tile => tile.depth = currentDepth + 1);
    poly.children = subTiles;
}

// Return just the tiles that remain in that region
function clipToRegion(diagram, poly) {
    "use strict";

    let internalPolys = [];
    let contains;
    for (let tile of diagram.tiles) {
        // contains = tile.corners.reduce((isTrue, corner) => {
        //     console.log(isTrue);
        //     return isTrue || poly.contains(corner);
        // }, false);

        contains = poly.contains(tile.center);

        if (contains) {
            internalPolys.push(tile);
        }
    }

    return internalPolys;
}