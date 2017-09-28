import Vector from "../geometry/Vector";
import Line from "../geometry/Line";

class Edge extends Line {
    constructor(v1, v2) {
        super(v1, v2);
        this.id = -1;
        // Polygon center objects connected by Delaunay edges
        this.d0 = null;
        this.d1 = null;
        // Corner objects connected by Voronoi edges
        this.v0 = null;
        this.v1 = null;
        this.border = false;
    }
}

export default Edge;