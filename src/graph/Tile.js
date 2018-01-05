import Vector from "../geometry/Vector";
import Polygon from "../geometry/Polygon";

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
     * Get the neighboring tile closest to a particular direction
     * 
     * @param {Vector} direction The direction from the current tile to the
     *  neighboring tile. (Directions are assumed to start from the origin)
     * 
     * @return {Tile} The neighboring tile which is closest to the input
     *  direction.
     * 
     * @memberOf Tile
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