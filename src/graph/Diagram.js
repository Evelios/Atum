import Graph from "./Graph";
import Tile from "./Tile";

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
        super(points, bbox, relaxations = 0, improveCorners = false);

        this.tiles = [];
        // this._createTiles();
    }

    /**
     * 
     * 
     * @memberof Diagram
     */
    _createTiles() {
        for (const center of this.centers) {
            const tile = new Tile(center, center.corners, center.borders);
            this.centers.tile = tile;
            this.tiles.push(tile);
        }

        // Connect together the tile objects as neighbors
        for (const tile of this.tiles) {
            this.tile.neighbors = tile.center.neighbors.map(
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
     * @memberOf Diagram
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
}

export default Diagram;