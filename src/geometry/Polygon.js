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
     * @property {Vector} center The center of the polygon. If not otherwise
     *  stated, the center defaults to the centriod. Any transformations on
     *  the polygon are done about the center of the polygon.
     * @property {Vector} centroid The centriod or average location of the
     *  verticies in the polygon
     * 
     * @param {Vector} [center=average(verticies)] The center of the polygon
     */
    constructor(verticies, center) {
        super(verticies);
        if (center) {
            this.center = center;
        } else {
            this.centroid = Vector.avg(this);
            this.center = this.centroid;
        }
    }

    /**
     * Get the polygon inset of the current polygon by the input ammount
     * 
     * @param ammount
     * @returns {Polygon} The inset of the current polygon by
     * @memberOf Polygon
     */
    inset(ammount) {
        return ammount;
    }

    /**
     * Returns wheither or not this polygon is a convex polygon. If this is
     * not true then the polygon is convace or more complex.
     * 
     * @returns {boolean} If the polygon is convex
     * @memberOf Polygon
     */
    isConvex() {

    }

    rotate() {

    }
}

export default Polygon;