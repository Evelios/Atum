import Vector from "./Vector";
import Rectangle from "./Rectangle";

class Polygon {
    /**
     * @class Polygon
     * 
     * Class to store polygon information in an array format that also gives it
     * extra functionality on top of it. This can also server as a base class
     * for more specific geometric shapes. At the moment this class assumes only
     * convex polygons for simplicity.
     * 
     * @summary Creates an instance of Polygon.
     * 
     * @property {Vector} center The center of the polygon. If not otherwise
     *  stated, the center defaults to the centriod. Any transformations on
     *  the polygon are done about the center of the polygon.
     * @property {Vector[]} corners The corner vectors of the polygon
     * 
     * @param {Vector[]} [corners=[]] The corner verticies of the polygon
     * @param {Vector} [center=average(verticies)] The center of the polygon.
     *  If a value is not provided the default value becomes the centroid of
     *  the verticies.
     */
    constructor(corners = null, center = null) {
        this.corners = corners ? corners : [];
        this.center = center ? center : this.centroid();
        this._bbox = null;
    }

    /**
     * Get the centroid of the polygon. This is the vector average of all the
     * points that make up the polygon.
     * 
     * @returns {Vector} The centroid of the polygon
     * 
     * @memberOf Polygon
     */
    centroid() {
        return Vector.avg(this.corners);
    }

    /**
     * Get the bounding box of the polygon. That is the rectangle that will
     * minimally enclose the polygon.
     * 
     * @returns {Rectangle} The bounding box of the polygon
     * @memberof Polygon
     */
    bbox() {
        if (this._bbox) {
            return this._bbox;
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        for (const corner of this.corners) {
            minX = Math.min(corner.x, minX);
            maxX = Math.max(corner.x, maxX);
            minY = Math.min(corner.y, minY);
            maxY = Math.max(corner.y, maxY);
        }

        this._bbox = new Rectangle(new Vector(minX, minY), maxX - minX, maxY - minY);

        return this._bbox;
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

    /**
     * Determine if the point is contained within the polygon
     * 
     * @param {Vector} vector
     * 
     * @see {@link https://github.com/substack/point-in-polygon/blob/master/index.js}
     * @memberOf Polygon
     */
    contains(vector) {
        if (!this.bbox().contains(vector)) {
            return false;
        }

        const len = this.corners.length;
        const x = vector.x;
        const y = vector.y;
        let inside = false;
        for (let i = 0, j = len - 1; i < len; j = i++) {
            let xi = this.corners[i].x, yi = this.corners[i].y;
            let xj = this.corners[j].x, yj = this.corners[j].y;
            
            let intersect = ((yi > y) !== (yj > y)) &&
             (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect)  {
                inside = !inside;
            }
        }
        
        return inside;
    }
}

export default Polygon;