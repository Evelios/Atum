import Vector from "./Vector";
import { fequals } from "../utilities/Util";

class Line  {
    /**
     * @class Line
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

    /**
     * Returns the intersection of two line segments. If there is no
     * intersection, then the function returns null
     * 
     * @static
     * @param {any} line1 The first line
     * @param {any} line2 The second line
     * @return {Vector | null} The vector intersection point or null if there
     *   is no intersection point
     * @memberof Line
     * @see {@link https://www.swtestacademy.com/intersection-convex-polygons-algorithm/}
     */
    static intersection(line1, line2) {
        const A1 = line1.p2.y - line1.p1.y;
        const B1 = line1.p1.x - line1.p2.x;
        const C1 = A1 * line1.p1.x + B1 * line1.p1.y;

        const A2 = line2.p2.y - line2.p1.y;
        const B2 = line2.p1.x - line2.p2.x;
        const C2 = A2 * line2.p1.x + B2 * line2.p1.y;

        const det = A1 * B2 - A2 * B1;
        if (fequals(det, 0)) {
            return null;
        } else {
            const x = (B2 * C1 - B1 * C2) / det;
            const y = (A1 * C2 - A2 * C1) / det;

            const onLine1 = (Math.min(line1.p1.x, line1.p2.x) < x || fequals(Math.min(line1.p1.x, line1.p2.x), x)) &&
                (Math.max(line1.p1.x, line1.p2.x) > x || fequals(Math.max(line1.p1.x, line1.p2.x), x)) &&
                (Math.min(line1.p1.y, line1.p2.y) < y || fequals(Math.min(line1.p1.y, line1.p2.y), y)) &&
                (Math.max(line1.p1.y, line1.p2.y) > y || fequals(Math.max(line1.p1.y, line1.p2.y), y));

            const onLine2 = (Math.min(line2.p1.x, line2.p2.x) < x || fequals(Math.min(line2.p1.x, line2.p2.x), x)) &&
                (Math.max(line2.p1.x, line2.p2.x) > x || fequals(Math.max(line2.p1.x, line2.p2.x), x)) &&
                (Math.min(line2.p1.y, line2.p2.y) < y || fequals(Math.min(line2.p1.y, line2.p2.y), y)) &&
                (Math.max(line2.p1.y, line2.p2.y) > y || fequals(Math.max(line2.p1.y, line2.p2.y), y));

            if (onLine1 && onLine2) {
                return new Vector(x, y);
            }
        }
        return null;
    }

    /**
     * Returns the intersection of this and the other segment. If there is no
     * intersection, then the function returns null
     * 
     * @param {Line} other The other line
     * @return {Vector | null} The vector intersection point or null if there
     *   is no intersection point
     * @memberof Line
     * @see {@link https://www.swtestacademy.com/intersection-convex-polygons-algorithm/}
     */
    intersection(other) {
        return Line.intersection(this, other);
    }
       
    /**
     * Determine the orientation of the three input vectors. The output will be
     * one of the following:
     * counterclockwise, clockwise, or collinear
     * 
     * @private
     * @static
     * @param {Vector} v1 The first vector
     * @param {Vecotr} v2 The second vector
     * @param {Vector} v3 The third vector
     * @return {string} The orientation of the three points
     *  "counterclockwise", "clockwise", "collinear" 
     * @memberof Line
     * @see {@link http://www.geeksforgeeks.org/check-if-two-given-line-segments-intersect/}
     */
    static _orientation(v1, v2, v3) {
        const val = (v2.y - v1.y) * (v3.x - v2.x) -
            (v2.x - v1.x) * (v3.y - v2.y);

        if (val === 0) {
            return "Collinear"
        }
        return val > 0 ? "clockwise" : "counterclockwise";
    }

    /**
     * Private helper function to intersects function.
     * 
     * Given three colinear points this function checks if v2 is on the line segment
     * v1-v3.
     * 
     * @private
     * @static
     * @param {Vector} v1 The first point in the line segment
     * @param {Vector} v2 The point to test if it is in the middle
     * @param {Vector} v3 The second point in the line segment
     * @return {boolean} True if v2 lies on the segment created by v1 & v3
     * @memberof Line
     */
    static _onSegment(v1, v2, v3) {
        return v2.x <= Math.max(v1.x, v3.x) && v2.x >= Math.min(v1.x, v3.x) &&
            v2.y <= Math.max(v1.y, v3.y) && v2.y >= Math.min(v1.y, v3.y)
    }

    /**
     * Determine if two line segments intersec
     * 
     * @static
     * @param {Line} line1 The first line to test
     * @param {Line} line2 The second line to test
     * @return {boolean} True if the lines intersect
     * @memberof Line
     * @see {@link http://www.geeksforgeeks.org/check-if-two-given-line-segments-intersect/}
     */
    static intersects(line1, line2) {
        // Find the four orientations that are needed for general and
        // special cases
        const o1 = Line._orientation(line1.p1, line1.p2, line2.p1);
        const o2 = Line._orientation(line1.p1, line1.p2, line2.p2);
        const o3 = Line._orientation(line2.p1, line2.p2, line1.p1);
        const o4 = Line._orientation(line2.p1, line2.p2, line1.p2);

        // General Case
        if (o1 != o2 && o3 != o4) {
            return true;
        }

        // Special Cases
        // line1.x, line1.y and line2.x are colinear and
        // line2.x lies on segment line1.xline1.y
        if (o1 === "Collinear" && Line._onSegment(line1.p1, line2.p1, line1.p2)) {
            return true;
        }

        // line1.x, line1.y and line2.x are colinear and
        // line2.y lies on segment line1.xline1.y
        if (o2 === "Collinear" && Line._onSegment(line1.p1, line2.p2, line1.p2)) {
            return true;
        }

        // line2.x, line2.y and line1.x are colinear and
        // line1.x lies on segment line2.xline2.y
        if (o3 === "Collinear" && Line._onSegment(line2.p1, line1.p1, line2.p2)) {
            return true;
        }

        // line2.x, line2.y and line1.y are colinear and
        // line1.y lies on segment line2.xline2.y
        if (o4 === "Collinear" && Line._onSegment(line2.p1, line1.p2, line2.p2)) {
            return true;
        }

        return false; // Doesn't fall in any of the above cases

    }

    /**
     * Determine this line segment intersects with the other line segment
     * 
     * @param {Line} other The other line segment
     * @return {boolean} True if the lines intersect
     * @memberof Line
     * @see {@link http://www.geeksforgeeks.org/check-if-two-given-line-segments-intersect/}
     */
    intersects(other) {
        return Line.intersects(this, other);
    }
}

export default Line;