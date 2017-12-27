import Polygon from "../geometry/Polygon"
import Graph from "./Graph";

class Tile extends Polygon {
    constructor(center, corners, edges) {
        
        super(corners, center);;
        this.edges = edges;
        this.neighbors = [];

        // Recursive Parameters
        this.parent = parent;
        this.children = children ? children : [];
    }
}