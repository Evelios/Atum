import Vector from "../geometry/Vector";
import Polygon from "../geometry/Polygon";

class Corner extends Vector {
    constructor(position) {
        super(position);
        this.id = -1;
        // Set of polygons touching this edge
        this.touches = new Polygon();
        // Set of edges touching this corner
        this.protrudes = [];
        // Set of corners connected to this one
        this.adjacent = new Polygon();
    }
}

export default Corner;