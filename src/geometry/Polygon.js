import Vector from "./Vector";
import Shape from "./Shape";

class Polygon extends Shape {
    /**
     * @class Polygon
     * @extends Shape
     * 
     * Class to store polygon information in an array format that also gives it
     * extra functionality on top of it. This can also server as a base class
     * for more specific geometric shapes.
     * 
     * @summary Creates an instance of Polygon.
     * 
     * @property {Vector[]} verticies The polygon position verticies 
     * @property {Vector} center The center of the polygon
     * 
     * @param {Vector[]} verticies The vector verticies
     * @param {Vector} [center=average(verticies)] The center of the polygon
     */
    constructor(verticies, center) {
        this.verticies = verticies;
        if (center) {
            this.center = center;
        } else {
            center = Vector.avg(verticies);
        }
    }
}

export default Polygon;