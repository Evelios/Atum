import Shape from "./Shape";

class Line  {
    /**
     * @class Line
     * @extends Shape
     * 
     * A simple line object that is an array of two vector points.
     * 
     * @property {Vector} p1
     * @property {vector} p2
     * 
     * @summary Creates an instance of Polygon.
     * @param {Vector} p1 The first point
     * @param {Vector} p2 The second point
     */
    constructor(p1, p2) {
        this.p1 = p1;
        this.p2 = p2;
    }
}

export default Line;