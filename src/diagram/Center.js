import Vector from "../geometry/Vector";

class Center extends Vector {
    constructor(position) {
        super(position);
        // Set of adjacent polygons
        this.id = -1;
        this.neighbors = [];
        // Set of bordering edges
        this.borders = [];
        // Set of polygon corners
        this.corners = [];
        this.border = false;
    }
}

export default Center;