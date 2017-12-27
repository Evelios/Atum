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
     * @property {object} data The data stored by the center object. This is the
     *  data that is to be changed by the user
     * @property {Center} parent The parent object to the current object. The
     *  default is null, there is no parent.
     * @property {Center[]} children The children objects to the current object.
     *  The default is an empty list
     * 
     * @param {Vector} position The location of the Center object
     * 
     * @class Center
     * @extends {Vector}
     */
    constructor(position, parent = null, children = null) {
        super(position);

        // Diagram Properties
        this.id = -1;
        this.neighbors = []; // Centers
        this.borders = []; // Edges
        this.corners = [];
        this.border = false;
        this.tile = null;

        // Higher Level Properties
        this.data = {};
    }
}

export default Center;