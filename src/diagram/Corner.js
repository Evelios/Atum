import Vector from "../geometry/Vector";

class Corner extends Vector {
    constructor(position) {
        super(position);
        this.id = -1;
        // Set of polygons touching this edge
        this.touches = [];
        // Set of edges touching this corner
        this.protrudes = [];
        // Set of corners connected to this one
        this.adjacent = [];
    }
}

export default Corner;