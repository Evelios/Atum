import Vector from "../geometry/Vector";
import Polygon from "../geometry/Polygon";

class Center extends Vector {
    /**
     * A center connection and location in a graph object
     * 
     * @property {number} id The id of the center in the graph object
     * @property {Polygon} neighbors Set of adjacent polygon centers
     * @property {Line[]} borders Set of bordering edges
     * @property {Polygon} corners Set of polygon corners
     * @property {boolean} border Is this polygon touching the border edge
     * 
     * 
     * @class Center
     * @extends {Vector}
     */
    constructor(position) {
        super(position);
        this.id = -1;
        // this.neighbors = [];
        this.neighbors = new Polygon();
        this.borders = [];
        // this.corners = [];
        this.corners = new Polygon();
        this.border = false;
    }
}

export default Center;