import Diagram from "../graph/Diagram";
import Tile from "../graph/Tile";
import Polygon from "../geometry/Polygon";
import { poisson, jitteredGrid } from "../utilities/PointDistribution";

export default function recursiveVoronoi(bbox, depth, density) {
    "use strict";

    let diagram = new Diagram(poisson(bbox, density), bbox);

    if (depth > 0) {
        for (let tile of diagram.tiles) {
            tile.depth = 0;

            generateInPolygon(tile, density / 3, 1, depth);
        }
    }

    return diagram;
}

function generateInPolygon(poly, density, currentDepth, maxDepth) {
    "use strict";

    let subdiagram = new Diagram(poisson(poly.bbox(), density), poly.bbox());
    let subTiles = clipToRegion(subdiagram, poly);
    subTiles = subTiles.map(tile => Tile.fromPolygon(Polygon.intersection(poly, tile)));
    subTiles.forEach(tile => tile.depth = currentDepth + 1);
    poly.children = subTiles;

    if (currentDepth !== maxDepth) {
        for (let tile of subTiles) {
            generateInPolygon(tile, density / 3, currentDepth + 1, maxDepth);
        }
    }
}

// Return just the tiles that remain in that region
function clipToRegion(diagram, poly) {
    "use strict";

    let internalPolys = [];
    let contains;
    for (let tile of diagram.tiles) {
        contains = tile.corners.reduce((p, c) => {
            return p || poly.contains(c);
        }, false);

        // contains = contains || poly.contains(poly.center);

        if (contains) {
            internalPolys.push(tile);
        }
    }

    return internalPolys;
}