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
}

export default Tile;