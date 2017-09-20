import Vector from "./Vector";
import Polygon from "./Polygon";

class Rectangle extends Polygon {
    /** 
     * @class Rectangle
     * @extends Polygon
     * 
     * Class to store array information about a rectangle
     * 
     * @param {Vector} position
     * @param {number} width
     * @param {number} height
     */

    constructor(position, width, height) {
        const points = [position,
            position.add(new Vector(width)),
            position.add(new Vector(width, height)),
            position.add(new Vector(height))
        ];
        super(points);

        this.position = positions;
        this.width = width;
        this.height = height;
        this.area = width * height;
    }
}

export default Rectangle;