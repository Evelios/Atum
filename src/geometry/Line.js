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
     * @param {Line} line1 
     * @param {Line} line2 
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
        if (o1 == "Collinear" && Line._onSegment(line1.p1, line2.p1, line1.p2)) {
            return true;
        }

        // line1.x, line1.y and line2.x are colinear and
        // line2.y lies on segment line1.xline1.y
        if (o2 == "Collinear" && Line._onSegment(line1.p1, line2.p2, line1.p2)) {
            return true;
        }

        // line2.x, line2.y and line1.x are colinear and
        // line1.x lies on segment line2.xline2.y
        if (o3 == "Collinear" && Line._onSegment(line2.p1, line1.p1, line2.p2)) {
            return true;
        }

        // line2.x, line2.y and line1.y are colinear and
        // line1.y lies on segment line2.xline2.y
        if (o4 == "Collinear" && Line._onSegment(line2.p1, line1.p2, line2.p2)) {
            return true;
        }

        return false; // Doesn't fall in any of the above cases

    }

    intersects(line1, line2) {
        return Line.intersects(line1, line2);
    }
}

export default Line;