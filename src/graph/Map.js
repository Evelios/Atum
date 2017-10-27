import Diagram from "./Diagram";

class Map extends Diagram {

    /**
     * Creates an instance of Map.
     * 
     * @param {any} points 
     * @param {any} bbox 
     * @param {number} [relaxations=0] 
     * @param {boolean} [improveCorners=false] 
     * 
     * @class Map
     * @extends Diagram
     */
    constructor(points, bbox, relaxations = 0, improveCorners = false) {
        super(points, bbox, relaxations = 0, improveCorners = false);
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
     * @memberOf Map
     */
    generate(ruleset) {
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
}

export default Map;