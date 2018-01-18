// Find a way to implement kdtrees to speed up tile selection from a point
// import KDTree from "static-kdtree";

import Graph from "./Graph";
import Tile from "./Tile";
import Vector from "../geometry/Vector";

class Diagram extends Graph {

    /**
     * Creates an instance of Diagram.
     * 
     * @param {any} points 
     * @param {any} bbox 
     * @param {number} [relaxations=0] 
     * @param {boolean} [improveCorners=false] 
     * 
     * @class Diagram
     * @extends Graph
     */
    constructor(points, bbox, relaxations = 0, improveCorners = false) {
        super(points, bbox, relaxations, improveCorners);

        this.tiles = [];
        this._createTiles();
    }

    /**
     * 
     * 
     * @memberof Diagram
     */
    _createTiles() {
        for (let center of this.centers) {
            const tile = new Tile(center, center.corners, center.borders);
            center.tile = tile;
            this.tiles.push(tile);
        }

        // Connect together the tile objects as neighbors
        for (let tile of this.tiles) {
            tile.neighbors = tile.center.neighbors.map(
                center => center.tile
            );
        }
    }

    /**
     * This function is used to call cellular automita on the graph object.
     * The ruleset function should follow the following properties so that
     * the automation can run properly. See the example for the details
     * 
     * @summary Run a generation of cellular automation according to a user
     *  specified rule set
     * 
     * @param {function} ruleset The
     * 
     * @example
     * 
     * var gameOfLife = function(center) {
     *   var n = center.neighbors.length;
     *   return { 
     *     alive: center.data.alive && (n === 2 || n === 3) ||
     *           !center.data.alive && n === 3
     *   };
     * }
     * 
     * @todo Find a New Name
     * @memberof Diagram
     */
    _generate(ruleset) {
        // Run cellular automita
        for (let center of this.centers) {
            center._data = ruleset(center);
        }

        // Update automita actions
        for (let center of this.centers) {
            // Update only the new data that has changed
            for (let key in center._data) {
                if (center._data.hasOwnProperty(key)) {
                    center.data[key] = center._data[key];
                }
            }
            delete center._data;
        }
    }

    initialize(ruleset) {
        this._generate(ruleset);
    }

    iterate(ruleset) {
        this._generate(ruleset);
    }

    /**
     * Get the tile that contains the specific location
     * 
     * @param {Vector} position The position which contains the desired tile 
     * 
     * @return {Tile} The tile at the position
     * 
     * @memberof Diagram
     */
    getTile(position) {
        if (!this.bbox.contains(position)) {
            return null;
        }

        let minDist = Infinity;
        let closest = this.tiles[0];
        let dist;

        for (const tile of this.tiles) {
            dist = Vector.dist2(tile.center, position);

            if (dist < minDist) {
                minDist = dist;
                closest = tile;
            }
        }

        return closest;
    }


    /**
     * Get the path between two tiles on the diagram. This path includes both
     * the start tile and the end tile on the graph.
     * 
     * @param {Tile} start The starting tile to search from
     * @param {Tile} end The ending tile to search to
     * @param {Number} [Iterations=0]
     * @return {Tile[]} A resulting path between two tiles
     *  Returned of the form [start, ..., end]
     * 
     * @memberof Diagram
     */
    getPath(start, end, iterations = 100) {
        let curTile = start;
        let path = [start];
        let direction;

        while (!Vector.equals(curTile.center, end.center)) {
            direction = Vector.subtract(end.center, curTile.center);
            curTile = curTile.getNeighbor(direction);
            path.push(curTile);

            if (iterations < 0) {
                break;
            }
            iterations--;
        }

        return path;
    }
}

export default Diagram;