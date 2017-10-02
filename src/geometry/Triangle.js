import Vector from "./Vector";
import Polygon from "./Polygon";

class Triangle extends Polygon {
    /** 
     * @class Triangle
     * @extends Polygon
     * 
     * Class to store array information about a rectangle
     * 
     * @property {Vector} verticies The three verticies
     * 
     * @param {Vector} v1 The first position
     * @param {Vector} v2 The second position
     * @param {Vector} v3 The third position
     */

    constructor(v1, v2, v3) {
        var verticies = [v1, v2, v3];
        super(verticies);
        this.v1 = v1;
        this.v2 = v2;
        this.v3 = v3;
    }
}

export default Triangle;