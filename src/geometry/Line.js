import Shape from "./Shape";

class Line extends Shape {
    /**
     * @class Line
     * @extends Shape
     * 
     * A simple line object that is an array of two vector points.
     * 
     * @summary Creates an instance of Polygon.
     * @param {Vector|Vector[]} args
    */
    constructor(p1, p2) {
        super(p1, p2);
    }
}

export default Line;