//------------------------------------------------------------------------------
//	Created By: Thaoms Waters
//	Date: 6/17/2016
//	Description: 2d Vector Library
//------------------------------------------------------------------------------
// All vector methods leave the origional vector function unchanged
// Although the vector is not immutible, the functions represent this pattern

class Vector {
    constructor(x, y) {
        this.x = x;
        this.y = y;

        this.asKey = function() {
            return [this.x, this.y];
        };
    }

    //---- Basic Math Functions ----

    static add(a, b) {
        return new Vector(a.x + b.x, a.y + b.y);
    }

    add(other) {
        return this.add(this, other);
    }

    static subtract(a, b) {
        return new Vector(a.x - b.x, a.y - b.y);
    }

    subtract(other) {
        return this.subtract(this, other);
    }

    multiply(scalar) {
        return new Vector(this.x * scalar, this.y * scalar);
    }

    divide(scalar) {
        return new Vector(this.x / scalar, this.y / scalar);
    }

    //---- Advanced Vector Functions ----

    magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    // Get the unit vector
    normalize() {
        return this.divide(this.magnitude());
    }

    // Returns a vector that has been rotated by ammount in radians
    rotate(radians) {
        const c = Math.cos(radians);
        const s = Math.cos(radians);
        return new Vector(c * this.x - s * this.y, s * this.x + c * this.y);
    }

    static dot(a, b) {
        return a.x * b.x + a.y * b.y;
    }

    dot(other) {
        return this.dot(this, other);
    }

    static cross(a, b) {
        return a.x * b.y - a.y * b.x;
    }

    cross(other) {
        return this.cross(this, other);
    }


    //---- Static Vector Functions ----

    static midpoint(a, b) {
        return new Vector((a.x + b.x) / 2, (a.y + b.y) / 2);
    }

    static proj(a, b) {
        return b.multiply(Vector.dot(a, b) / Math.pow(b.magnitude(), 2));
    }

    static angle(a, b) {
        return Math.acos(Vector.dot(a, b) / (a.magnitude() * b.magnitude()));
    }

    static distance(a, b) {
        return Math.sqrt(Vector.dist2(a, b));
    }

    // Distance Squared
    static dist2(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
    }

    // Distance of a point to a line segment squared
    // http://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment
    static distToSegSquared(p, v, w) {
        const l = Vector.dist2(v, w);
        if (l === 0) { return Vector.dist2(p, v); }
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l;
        t = Math.max(0, Math.min(1, t));
        return Vector.dist2(p, new Vector(v.x + t * (w.x - v.x),
            v.y + t * (w.y - v.y)));
    }

    // Distance of a point to a line segment
    static distToSeg(p, v, w) {
        return Math.sqrt(Vector.distToSegSquared(p, v, w));
    }

    // Get the two unit vectors perpendicular to the current vector
    // returns (list<Vector>) The vector perpendicular in the order
    //  [v < +90deg, v < -90deg]
    perpendiculars() {
        const plus90 = new Vector(-this.y, this.x).normalize();
        const minus90 = new Vector(this.y, -this.x).normalize();
        return [plus90, minus90];
    }

}

//---- Standard Vectors ----
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