import Vector from "./Vector";

class Shape extends Array {
    /**
     * @class Shape
     * 
     * This is an abstract base class for shapes. The shapes are stored in an array
     * format as a list of Vectors. This allows for easy manipulation and access to
     * the points that make up the shape.
     * 
     * @summary Creates an instance of Shape.
     * 
     * @param {Vector[]} [verticies] The shapes vector verticies
     */
    constructor(verticies) {
        if (verticies) {
            super(...verticies);
        } else {
            super();
        }
    }
}

export default Shape;