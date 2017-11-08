class Vector {
    /**
     * @class Vector
     * 
     * This is a basic vector class that is used for geometry, position inforamtion,
     * movement infomation, and more complex structures.
     * The vector class follows a immutable paradigm where changes are not made to the
     * vectors themselves. Any change to a vector is returned as a new vector that
     * must be captured. 
     * 
     * @description This vector class was constructed so that it can mirror two types of common
     * point/vector type objects. This is having object properties stored as object
     * properties (eg. vector.x, vector.y) or as list properties, [x, y] which can
     * be accessed by vector[0], or vector[1].
     * 
     * @summary Create a 2D Vector object
     * 
     * @property {number} x The x vector component
     * @property {number} y The y vector component
     * @property {number} 0 The x vector component
     * @property {number} 1 The y vector component
     * 
     * @param {number|Vector} x The x component or another vector
     * @param {number} [y] The y component
     */
    constructor(x, y) {
        if (x instanceof Vector || (x.x && x.y) && !y) {
            this._set(x.x, x.y);
        } else {
            this._set(x, y);
        }
    }

    //---- Helper Functions ----

    /**
     * Internal Helper Function for setting variable properties
     * 
     * @private
     * @param {number} x The x component
     * @param {number} y The y component
     * @memberof Vector
     */
    _set(x, y) {
        this.__proto__[0] = x;
        this.__proto__[1] = y;
        this.x = x;
        this.y = y;
    }

    /**
     * Get the vector key:Symbol representation
     * 
     * @returns {Symbol} The vector key element
     * @memberof Vector
     */
    key() {
        return this.list();
        // return Symbol(this.list()); // Not currently working as a key symbol
    }

    /**
     * Get the vector in list form
     * 
     * @returns {number[]} List representation of the vector of length 2
     * @memberof Vector
     */
    list() {
        return [this.x, this.y];
    }

    /**
     * Returns the vector as a string of (x, y)
     * 
     * @returns {string} The string representation of a vector in (x, y) form
     * @memberof Vector
     */
    toString() {
        return `(${this.x}, ${this.y})`;
    }

    /**
     * Get a copy of the input vector
     * 
     * @param {Vector} v the vector to be coppied
     * @returns {Vector} The vector copy
     * @memberof Vector
     */
    static copy(v) {
        return new Vector(v.x, v.y);
    }

    /**
     * Returns true if the two vector positions are equal
     * 
     * @static
     * @param {Vector} v1 The first vector
     * @param {Vector} v2 The second vector
     * @returns {boolean} True if the vector positions are equal
     * @memberOf Vector
     */
    static equals(v1, v2) {
        return v1.x === v2.x && v1.y === v2.y;
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
        return Vector.add(this, other);
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
        return Vector.subtract(this, other);
    }

    /**
     * Multiply the vector by a scalar value
     * 
     * @param {number} scalar The number to multiply the vector by
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
     * @param {number} scalar 
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
     * @returns {number} The magniture of the vector
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
        return Vector.divide(this.magnitude());
    }

    /**
     * Get the get the current vector rotated by a certain ammount
     * 
     * @param {number} radians 
     * @returns {Vector} The vector that results from rotating the current
     *  vector by a particular ammount
     * @memberof Vector
     */
    rotate(radians) {
        const c = Math.cos(radians);
        const s = Math.sin(radians);
        return new Vector(c * this.x - s * this.y, s * this.x + c * this.y);
    }

    /**
     * Get the dot product of two vectors
     * 
     * @static
     * @param {Vector} a The first vector
     * @param {Vector} b The second vector
     * @returns {number} The dot product of the two vectors
     * @memberof Vector
     */
    static dot(a, b) {
        return a.x * b.x + a.y * b.y;
    }

    /**
     * Get the average location between several vectors
     * 
     * @param {Vector[]} vectors The list of vectors to average
     * @memberof Vector
     */
    static avg(vectors) {
        let average = Vector.zero();

        for (const vector of vectors) {
            average = Vector.add(average, vector);
        }
        return average.divide(vectors.length);
    }

    /**
     * Get the dot product of this vector and another vector
     * 
     * @param {Vector} other The other vector
     * @returns {number} The dot product of this and the other vector
     * @memberof Vector
     */
    dot(other) {
        return Vector.dot(this, other);
    }

    /**
     * Get the cross product of two vectors
     * 
     * @static
     * @param {Vector} a The first vector
     * @param {Vector} b The second vector
     * @returns {number} The cross product of the two vectors
     * @memberof Vector
     */
    static cross(a, b) {
        return a.x * b.y - a.y * b.x;
    }

    /**
     * Get the cross product of this and the other vector
     * 
     * @param {Vector} other The other vector
     * @returns {number} The cross product of this and the other vector
     * @memberof Vector
     */
    cross(other) {
        return Vector.cross(this, other);
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
     * @returns {Vector[]} The two normal vectors that are perpendicular
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

    //---- Standard Static Vector Objects ----

    /**
     * Get a vector of no magnitude and no direction
     * 
     * @static
     * @function
     * @returns {Vector} Vector of magnitude zero
     * @memberof Vector
     */
    static zero() {
        "use strict";
        return new Vector(0, 0);
    }

    /**
     * Get the unit vector pointing in the positive y direction
     * 
     * @static
     * @function
     * @returns {Vector} Unit vector pointing up
     * @memberof Vector
     */
    static up() {
        "use strict";
        return new Vector(0, 1);
    }

    /**
     * Get the unit vector pointing in the negative y direction
     * 
     * @static
     * @function
     * @returns {Vector} Unit vector pointing down
     * @memberof Vector
     */
    static down() {
        "use strict";
        return new Vector(0, -1);
    }

    /**
     * Get the unit vector pointing in the negative x direction
     * 
     * @static
     * @function
     * @returns {Vector} Unit vector pointing right
     * @memberof Vector
     */
    static left() {
        "use strict";
        return new Vector(-1, 0);
    }

    /**
     * Get the unit vector pointing in the positive x direction
     * 
     * @static
     * @function
     * @returns {Vector} Unit vector pointing right
     * @memberof Vector
     */
    static right() {
        "use strict";
        return new Vector(1, 0);
    }
}

export default Vector;