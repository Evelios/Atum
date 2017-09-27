import Vector from "./Vector";
import Polygon from "./Polygon";

class Rectangle extends Polygon {
    /** 
     * @class Rectangle
     * @extends Polygon
     * 
     * Class to store array information about a rectangle
     * 
     * @property {Vector} position
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
        const points = [position,
            position.add(new Vector(width, 0)),
            position.add(new Vector(width, height)),
            position.add(new Vector(0, height))
        ];
        super(points);

        this.position = position;
        this.x = position.x;
        this.y = position.y;
        this.width = width;
        this.height = height;
        this.area = width * height;
    }

    contains(vector) {
        return vector.x > this.position.x &&
            vector.x < this.position.x + this.width &&
            vector.y > this.position.y &&
            vector.y < this.positoin.y + this.height;
    }
}

export default Rectangle;