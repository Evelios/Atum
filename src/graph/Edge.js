import Vector from "../geometry/Vector";
import Line from "../geometry/Line";

class Edge extends Line {
    /**
     * Edge connections between centers and corners in the Voronoi/Delaunay
     * graph.
     * 
     * @property {number} id The id of the edge in the graph object
     * @property {Vector} d0 The first polygon center of the delaunay graph
     * @property {Vector} d1 The second polygon center of the delaunay graph
     * @property {Vector} v0 The first corner object of the voronoi graph
     * @property {Vector} v1 The second corner object of the voronoi graph
     * 
     * @class Edge
     * @extends {Line}
     */
    constructor(v0, v1) {
        super(v0, v1);
        this.id = -1;
        // Polygon center objects connected by Delaunay edges
        this.d0 = null;
        this.d1 = null;
        // Corner objects connected by Voronoi edges
        this._v0 = null;
        this._v1 = null;
        this.midpoint = null;
        this.border = false;
    }

    get v0() {
        return this._v0;
    }

    set v0(corner) {
        this.p1 = corner;
        this._v0 = corner;
    }

    get v1() {
        return this._v1;
    }

    set v1(corner) {
        this.p2 = corner;
        this._v1 = corner;
    }
}

export default Edge;