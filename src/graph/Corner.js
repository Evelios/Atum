import Vector from "../geometry/Vector";
import Polygon from "../geometry/Polygon";

class Corner extends Vector {
    /**
     * A corner connection and location in a graph object
     * 
     * @property {number} id The id of the corner in the graph object
     * @property {Polygon} touches Set of polygon centers touching this objecyt
     * @property {Line[]} protrudes Set of edges that are connected to this corner
     * @property {Polygon} adjacent Set of corners that connected to this corner
     * 
     * @class Corner
     * @extends {Vector}
     */
    constructor(position) {
        super(position);
        this.id = -1;
        this.touches = new Polygon();
        this.protrudes = [];
        this.adjacent = new Polygon();
    }
}

export default Corner;