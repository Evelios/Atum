import Vector from "../geometry/Vector";
import Polygon from "../geometry/Polygon";
import Center from "../graph/Center";
import Corner from "../graph/Corner";
import Edge from "../graph/Edge";

class Tile extends Polygon {
    constructor(center, corners, edges) {
        
        super(corners, center);
        this.edges = edges;
        this.neighbors = [];

        this.data = {};

        this.parent = null;
        this.children = null;

        // Recursive Parameters
        // this.parent = parent;
        // this.children = children ? children : [];
    }

    /**
     * Get a tile object from a polygon object
     * 
     * @static
     * @param {Polygon} poly The input polygon
     * @returns {Tile} The tile converted from the polygon
     * 
     * @memberOf Tile
     */
    static fromPolygon(poly) {
        const center = new Center(poly.center);
        const corners = poly.corners.map(c => new Corner(c));
        let edges = [];
        const len = poly.corners.length;
        for (let i = 0; i < len; i++) {
            const next = i + 1 === len ? 0 : i + 1;
            let edge = new Edge(poly.corners[i], poly.corners[next])
            edge.v0 = poly.corners[i];
            edge.v1 = poly.corners[next];
            edges.push(edge);
        }
        return new Tile(center, corners, edges);
    }

    /**
     * Get the neighboring tile closest to a particular direction
     * 
     * @param {Vector} direction The direction from the current tile to the
     *  neighboring tile. (Directions are assumed to start from the origin)
     * 
     * @return {Tile} The neighboring tile which is closest to the input
     *  direction.
     * 
     * @memberof Tile
     */
    getNeighbor(direction) {
        let minAngle = Math.PI;
        let closest = this.neighbors[0];

        for (const neighbor of this.neighbors) {
            let ang = Vector.angle(
                Vector.subtract(neighbor.center, this.center), direction);
            
            if (ang < minAngle) {
                minAngle = ang;
                closest = neighbor;
            }
        }

        return closest;
    }
}

export default Tile;