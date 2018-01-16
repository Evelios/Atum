import Vector from "./Vector";

class Rectangle {
    /** 
     * @class Rectangle
     * @extends Polygon
     * 
     * Class to store array information about a rectangle
     * 
     * @property {Vector} position
     * @property {Vector} center
     * @property {number} x
     * @property {number} y
     * @property {number} width
     * @property {number} height
     * 
     * @param {Vector} position
     * @param {number} width
     * @param {number} height
     */

    constructor(position, width, height) {

        this.position = position;
        this.x = position.x;
        this.y = position.y;
        this.br = position;
        this.bl = Vector.add(position, new Vector(width, 0));
        this.tr = Vector.add(position, new Vector(width, height));
        this.tl = Vector.add(position, new Vector(0, height));
        this.width = width;
        this.height = height;
        this.area = width * height;
        this.center = Vector.add(position, new Vector(width / 2, height / 2));
    }

    copy() {
        return Rectangle.copy(this);
    }

    static copy() {
        return new Rectangle(this.position, this.width, this.height);
    }

    /**
     * Determine if the two rectangles are intersecting, if the segments overlap
     * eachother.
     * 
     * @static
     * @param {any} rect1 The first rectangle
     * @param {any} rect2 The second rectangle
     * @returns {boolean} True if the two rectangles intersect
     * @memberof Rectangle
     */
    static intersects(rect1, rect2) {
        return rect1.x <= rect2.x + rect2.width &&
            rect2.x <= rect1.x + rect1.width &&
            rect1.y <= rect2.y + rect2.height &&
            rect2.y <= rect1.y + rect1.height;
    }

    /**
     * Determine if this rectangle is intersecting the other rectangle.
     * Determines if the rectangles segments overlap eachother.
     * 
     * @param {Rectangle} other The other rectangle
     * @returns {boolean} True if the rectangles are intersecting
     * @memberof Rectangle
     */
    intersects(other) {
        return Rectangle.intersects(this, other);
    }

    /**
     * Determine if two rectangles collide with eachother. This is true when two
     * rectangles intersect eachother or one of the rectangles is contained
     * witin another rectangle.
     * 
     * @static
     * @param {Rectangle} rect1 The first rectangle
     * @param {Rectangle} rect2 The second rectangle
     * @returns {boolean} True if the two rectangles collide with eachother
     * @memberof Rectangle
     */
    static collides(rect1, rect2) {
        return rect1.x < rect2.x + rect2.width &&
            rect1.x + rect1.width > rect2.x &&
            rect1.y < rect2.y + rect2.height &&
            rect1.height + rect1.y > rect2.y
    }

    /**
     * Determine if this rectangle collides with another rectangle. This is true
     * when two rectangles intersect eachother or one of the rectangles is 
     * contained witin another rectangle.
     * 
     * @param {Rectangle} other The other rectangle
     * @returns {boolean} True if the two rectangles collide with eachother
     * @memberof Rectangle
     */
    collides(other) {
        return Rectangle.collides(this, other);
    }

    /**
     * Determine if a point is contained within the rectangle.
     * 
     * @param {Vector} vector The point to be tested
     * 
     * @returns {boolean} True if the point is contained within the rectangle
     * @memberof Rectangle
     */
    contains(vector) {
        return vector.x > this.position.x &&
            vector.x < this.position.x + this.width &&
            vector.y > this.position.y &&
            vector.y < this.position.y + this.height;
    }
}

export default Rectangle;