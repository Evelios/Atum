import Vector from "./Vector";
import Line from "./Line";
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
        this.corners = corners ? Polygon._orderClockwise(corners) : [];
        this.center = center ? center : this.centroid();
        this._bbox = null;
    }

    //---- Private Polygon Helper Functions -----------------------------------

    /**
     * Private Polygon Helper Funciton:
     *   Order a list of points in clockwise order for proper polygon rendering
     * 
     * @private
     * @static
     * @param {Vector[]} points The list of points to sort clockwise
     * @return {Vector[]} The ordered list of points
     * @memberof Polygon
     */
    static _orderClockwise(points) {
        const center = Vector.avg(points);
        points.sort((a, b) => {
            return Math.atan2(b.y - center.y, b.x - center.x) -
                   Math.atan2(a.y - center.y, a.x - center.x);
        });

        return points;
    }

    //---- Polygon Property Functions -----------------------------------------

    /**
     * Get the centroid of the polygon. This is the vector average of all the
     * points that make up the polygon.
     * 
     * @returns {Vector} The centroid of the polygon
     * 
     * @memberof Polygon
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
     * Get the edge lines of the polygon
     * 
     * @return {Line[]} The edges of the polygon
     * @memberof Polygon
     */
    get edges() {
        if (this._edges) {
            return this._edges;
        }

        let edges = [];
        const len = this.corners.length;
        for (let i = 0; i < len; i++) {
            const c1 = this.corners[i];
            const c2 = this.corners[(i + 1) % len];
            edges.push(new Line(c1, c2));
        }
        this._edges = edges;
        return this._edges;
    }

    /**
     * Set the edge lines of a polygon.
     * Note: This does not change the corners of the polygons,
     *   only use this if you know what you are doing
     * 
     * @memberof Polygon
     */
    set edges(edges) {
        this._edges = edges;
    }

    /**
     * Get the polygon inset of the current polygon by the input ammount
     * 
     * @param ammount
     * @returns {Polygon} The inset of the current polygon by
     * @memberof Polygon
     */
    inset(ammount) {
        return ammount;
    }

    /**
     * Returns wheither or not this polygon is a convex polygon. If this is
     * not true then the polygon is convace or more complex.
     * 
     * @return {boolean} If the polygon is convex
     * @memberof Polygon
     */
    isConvex() {

    }

    /**
     * Get the major axis of this polygon. The major axis is the two verticies
     * of the polygon that are the furthest appart from eachother
     * 
     * @return {Line} The major axis of the polygon
     * @memberof Polygon
     */
    majorAxis() {
        let v1 = null;
        let v2 = null;
        let maxDist = 0;
        let dist;

        for (const c1 of this.corners) {
            for (const c2 of this.corners) {
                if (!Vector.equals(c1, c2)) {
                    dist = Vector.dist2(c1, c2);
                    if (dist > maxDist) {
                        maxDist = dist;
                        v1 = c1;
                        v2 = c2;
                    }
                }
            }
        }

        return new Line(v1, v2);
    }

    /**
     * Get the minor axis of the polygon. The minor axis is considered to be
     * the perpendicular to the major axis. This is not the two verticies
     * that are closest to eachother. This insures that the polygon is more
     * evenly divided in half along what should be the shorter portion of the
     * polygon.
     * 
     * @return {Line | null} The minor axis of the polygon, if there was a
     *  problem null is returned
     * @memberof Polygon
     * @todo Fix line intersection bug. Line intersection should always return 2
     *  segments but is sometimes returning 1 or 0.
     */
    minorAxis() {
        const majorAxis = this.majorAxis();
        const minorSegment = Line.perpendicular(majorAxis, majorAxis.length() * 2);
        const clippedList = this.lineIntersection(minorSegment);

        // Temporary
        if (clippedList.length < 2) {
            return null;
        }

        return new Line(clippedList[0], clippedList[1]);
    }

    //---- Member Functions ---------------------------------------------------

    rotate() {

    }

    /**
     * Determine if the point is contained within the polygon
     * 
     * @param {Vector} vector The position to check containment within
     *   the polygon
     * 
     * @return {bool} True if the vector is contained within the polygon
     * 
     * @see {@link https://github.com/substack/point-in-polygon/blob/master/index.js}
     * @memberof Polygon
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

    /**
     * Get all the intersection points between this polygon and a line segment
     * 
     * @param {Line} line The line to check for intersection points
     * 
     * @returns {Vector[]} The list of all the intersection points between this
     *   polygon and the line segment
     * @memberof Polygon
     */
    lineIntersection(line) {
        let intersectPoints = [];
        const len = this.corners.length;
        for (let i = 0; i < len; i++) {
            const edge = new Line(this.corners[i], this.corners[(i + 1) % len]);
            const intersect = Line.intersection(edge, line);

            if (intersect !== null) {
                Polygon._addPoint(intersectPoints, intersect);
            }
        }
        return intersectPoints;
    }

    /**
     * Private Helper Function For intersection:
     *   This function adds a point to the list if the point is not already
     * contained within that list.
     * 
     * @static
     * @private
     * @param {Vector[]} list List of vector points
     * @param {Vector} vector The Vector to try to add to the list
     * 
     * @memberof Polygon
     */
    static _addPoint(list, vector) {
        let contains = false;
        for (const v of list) {
            if (v.equals(vector)) {
                contains = true;
                break;
            }
        }
        if (!contains) {
            list.push(vector);
        }
    }

    /**
     * Get the intersection between this and another polygon. The result is
     * a new polygon that represents the geometric boolean AND operation on
     * the two polygons. The result is a new polygon of this intersection. 
     * 
     * @static
     * @param {Polygon} other The other polygon to intersect with
     * 
     * @return {Polygon} The intersection between the two polygons
     * @memberof Polygon
     */
    static intersection(poly1, poly2) {
        let clippedCorners = [];

        // Iterage through poly1 for collisions
        for (const corner of poly1.corners) {
            if (poly2.contains(corner)) {
                Polygon._addPoint(clippedCorners, corner);
            }
        }

        // Iterate through poly2 polygon for collisions
        for (const corner of poly2.corners) {
            if (poly1.contains(corner)) {
                Polygon._addPoint(clippedCorners, corner);
            }
        }

        const len = poly1.corners.length;
        for (let i = 0; i < len; i++) {
            const next = i + 1 === len ? 0 : i + 1;
            const edge = new Line(poly1.corners[i], poly1.corners[next]);
            const intersectPts = poly2.lineIntersection(edge);

            for (const v of intersectPts) {
                Polygon._addPoint(clippedCorners, v);
            }
        }

        return new Polygon(clippedCorners);
    }

    /**
     * Get the intersection between this and another polygon. The result is
     * a new polygon that represents the geometric boolean AND operation on
     * the two polygons. The result is a new polygon of this intersection. 
     * 
     * @param {Polygon} other The other polygon to intersect with
     * 
     * @return {Polygon} The intersection between the two polygons
     * @memberof Polygon
     */
    intersection(other) {
        return Polygon.intersection(this, other);
    }
}

export default Polygon;