/**
 * Class to store polygon information in an array format that also gives it
 * extra functionality on top of it. This can also server as a base class
 * for more specific geometric shapes.
 * 
 * @class Polygon
 */
class Polygon extends Shape {
    /**
     * Creates an instance of Polygon.
     * @param {any} x The first input. This can be a polygon, an array of
     *  Vectors, or the first argument in a list of points.
     * @param {Vectors} args The other vector inputs
     * @memberof Polygon
     */
    constructor(x, ...args) {
        if (x instanceof Polygon) {

        } else if (x instanceof Array) {

        } else if (x instanceof Vector) {
            this = args.unshift(x);
        } else {
            throw `Object is of type "${typeof x}" and must be of type Polygon, Vector or Vector Array`;
        }
    }
}