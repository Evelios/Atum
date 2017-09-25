import Vector from "../geometry/Vector";
import Polygon from "../geometry/Polygon";

class Center extends Vector {
    constructor(position) {
        super(position);
        this.id = -1;
        // Set of adjacent polygons
        this.neighbors = new Polygon();
        // Set of bordering edges
        this.borders = [];
        // Set of polygon corners
        this.corners = new Polygon();
        this.border = false;
    }
}

export default Center;