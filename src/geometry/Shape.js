import Vector from "./Vector";

class Shape {
    /**
     * @class Shape
     * 
     * This is an abstract base class for shapes. The shapes are stored in an array
     * format as a list of Vectors. This allows for easy manipulation and access to
     * the points that make up the shape.
     * 
     * @summary Creates an instance of Shape.
     * 
     * @property {Vector[]} verticies
     * 
     * @param {Vector[]} verticies
     */
    constructor(verticies) {
        this.verticies = verticies;
    }
}

export default Shape;