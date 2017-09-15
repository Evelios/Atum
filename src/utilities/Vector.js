/**
 * @author Thomas Waters
 * 
 * This is a basic vector class that is used for geometry, position inforamtion,
 * movement infomation, and more complex structures.
 * The vector class follows a immutable paradigm where changes are not made to the
 * vectors themselves. Any change to a vector is returned as a new vector that
 * must be captured.
 * 
 * @summary 2D Vector Library
 * @class Vector
 */
class Vector {
    /**
     * Creates an instance of Vector.
     * @param {Number} x The x component
     * @param {Number} y The y component
     * @memberof Vector
     */
    constructor(x, y) {
        this.x = x;
        this.y = y;

        this.asKey = function() {
            return [this.x, this.y];
        };
    }

    //---- Basic Math Functions ----

    /**
     * Add two vectors element wise
     * 
     * @static
     * @param {Vector} a The first vector
     * @param {Vector} b The second vector
     * @returns {Vector} The vector result of adding the two vectors
     * @memberof Vector
     */
    static add(a, b) {
        return new Vector(a.x + b.x, a.y + b.y);
    }

    /**
     * Add this vector with another vector element wise
     * 
     * @param {Vector} other The other vector
     * @returns {Vector} The vector result of adding the two vectors
     * @memberof Vector
     */
    add(other) {
        return this.add(this, other);
    }

    /**
     * Subtract two vectors element wise
     * 
     * @static
     * @param {Vector} a The first vector
     * @param {Vector} b The second Vector
     * @returns {Vector} The vector result of subtracting the two vectors
     * @memberof Vector
     */
    static subtract(a, b) {
        return new Vector(a.x - b.x, a.y - b.y);
    }

    /**
     * Subtract this vector with another vector element wise
     * 
     * @param {Vector} other The other vector
     * @returns {Vector} The vector result of subtracting the two vectors
     * @memberof Vector
     */
    subtract(other) {
        return this.subtract(this, other);
    }

    /**
     * Multiply the vector by a scalar value
     * 
     * @param {Number} scalar The number to multiply the vector by
     * @returns {Vector} The result of multiplying the vector by a scalar
     *  element wise
     * @memberof Vector
     */
    multiply(scalar) {
        return new Vector(this.x * scalar, this.y * scalar);
    }

    /**
     * Divide the vector by a scalar value
     * 
     * @param {Number} scalar 
     * @returns {Vector} The result of multiplying the vector by a scalar
     * @memberof Vector
     */
    divide(scalar) {
        return new Vector(this.x / scalar, this.y / scalar);
    }

    //---- Advanced Vector Functions ----

    /**
     * Get the magnitude of the vector
     * 
     * @returns {Number} The magniture of the vector
     * @memberof Vector
     */
    magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    // Get the unit vector
    /**
     * Get the normal vector of the current vector.
     * 
     * @returns {Vector} A vector that is the normal compenent of the vector
     * @memberof Vector
     */
    normalize() {
        return this.divide(this.magnitude());
    }

    /**
     * Get the get the current vector rotated by a certain ammount
     * 
     * @param {Number} radians 
     * @returns {Vector} The vector that results from rotating the current
     *  vector by a particular ammount
     * @memberof Vector
     */
    rotate(radians) {
        const c = Math.cos(radians);
        const s = Math.cos(radians);
        return new Vector(c * this.x - s * this.y, s * this.x + c * this.y);
    }

    /**
     * Get the dot product of two vectors
     * 
     * @static
     * @param {Vector} a The first vector
     * @param {Vector} b The second vector
     * @returns {Number} The dot product of the two vectors
     * @memberof Vector
     */
    static dot(a, b) {
        return a.x * b.x + a.y * b.y;
    }

    /**
     * Get the dot product of this vector and another vector
     * 
     * @param {Vector} other The other vector
     * @returns {Number} The dot product of this and the other vector
     * @memberof Vector
     */
    dot(other) {
        return this.dot(this, other);
    }

    /**
     * Get the cross product of two vectors
     * 
     * @static
     * @param {Vector} a The first vector
     * @param {Vector} b The second vector
     * @returns {Number} The cross product of the two vectors
     * @memberof Vector
     */
    static cross(a, b) {
        return a.x * b.y - a.y * b.x;
    }

    /**
     * Get the cross product of this and the other vector
     * 
     * @param {Vector} other The other vector
     * @returns {Number} The cross product of this and the other vector
     * @memberof Vector
     */
    cross(other) {
        return this.cross(this, other);
    }


    //---- Purely Static Vector Functions ----

    /**
     * Get the midpoint between two vectors
     * 
     * @static
     * @param {Vector} a The first vector
     * @param {Vector} b The second vector
     * @returns The midpoint of two vectors
     * @memberof Vector
     */
    static midpoint(a, b) {
        return new Vector((a.x + b.x) / 2, (a.y + b.y) / 2);
    }

    /**
     * Get the projection of vector a onto vector b
     * 
     * @static
     * @param {Vector} a The first vector
     * @param {Vector} b The second vector
     * @returns The projection vector of a onto b
     * @memberof Vector
     * 
     * @todo Add assertion for non-zero length b vector
     */
    static proj(a, b) {

        return b.multiply(Vector.dot(a, b) / Math.pow(b.magnitude(), 2));
    }

    /**
     * Get the angle between two vectors
     * 
     * @static
     * @param {Vector} a The frist vector 
     * @param {Vector} b The second vector 
     * @returns The angle between vector a and vector b
     * @memberof Vector
     */
    static angle(a, b) {
        return Math.acos(Vector.dot(a, b) / (a.magnitude() * b.magnitude()));
    }

    /**
     * Get the euclidean distance between two vectors
     * 
     * @static
     * @param {Vector} a The first vector
     * @param {Vector} b The second vector
     * @returns The euclidean distance between a and b
     * @see {@link dist2}
     * @memberof Vector
     */
    static distance(a, b) {
        return Math.sqrt(Vector.dist2(a, b));
    }

    /**
     * Get the euclidean distnace squared between two vectors.
     * This is used as a helper for the distnace function but can be used
     * to save on speed by not doing the square root operation.
     * 
     * @static
     * @param {Vector} a The first vector
     * @param {Vector} b The second vector
     * @returns The euclidean distance squared between vector a and vector b
     * @see {@link distnace}
     * @memberof Vector
     */
    static dist2(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
    }

    /**
     * Get the shortest distance between the point p and the line
     * segment v to w.
     * 
     * @static
     * @param {Vector} p The vector point
     * @param {Vector} v The first line segment endpoint
     * @param {Vector} w The second line segment endpoint
     * @returns The shortest euclidean distance between point
     * @see {@link distToSeg2}
     * @see {@link http://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment}
     * @memberof Vector
     */
    static distToSeg(p, v, w) {
        return Math.sqrt(Vector.distToSeg2(p, v, w));
    }

    /**
     * Get the shortest distance squared between the point p and the line
     * segment v to w.
     * 
     * @static
     * @param {Vector} p The vector point
     * @param {Vector} v The first line segment endpoint
     * @param {Vector} w The second line segment endpoint
     * @returns The shortest euclidean distance squared between point
     * @see {@link distToSeg}
     * @see {@link http://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment}
     * @memberof Vector
     */
    static distToSegSquared(p, v, w) {
        const l = Vector.dist2(v, w);
        if (l === 0) { return Vector.dist2(p, v); }
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l;
        t = Math.max(0, Math.min(1, t));
        return Vector.dist2(p, new Vector(v.x + t * (w.x - v.x),
            v.y + t * (w.y - v.y)));
    }

    /**
     * Get the two normal vectors that are perpendicular to the current vector
     * 
     * @returns {[Vector, Vector]} The two normal vectors that are perpendicular
     *  to the vector. The first vector is the normal vector that is +90 deg or
     *  +PI/2 rad. The second vector is the noraml vector that is -90 deg or
     *  -PI/2 rad.
     * @memberof Vector
     */
    perpendiculars() {
        const plus90 = new Vector(-this.y, this.x).normalize();
        const minus90 = new Vector(this.y, -this.x).normalize();
        return [plus90, minus90];
    }

}

//---- Standard Static Vector Objects ----

Vector.zero = function() {
    "use strict";
    return new Vector(0, 0);
};

Vector.up = function() {
    "use strict";
    return new Vector(0, 1);
};

Vector.down = function() {
    "use strict";
    return new Vector(0, -1);
};

Vector.left = function() {
    "use strict";
    return new Vector(-1, 0);
};

Vector.right = function() {
    "use strict";
    return new Vector(1, 0);
};