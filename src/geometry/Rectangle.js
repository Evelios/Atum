/**
 * Class to store array information about a rectangle
 * 
 * @class Rectangle
 * @extends {Polygon}
 */
class Rectangle extends Polygon {
    constructor(position, width, height) {
        const points = [position, 
            position.add(new Vector(width)),
            position.add(new Vector(width, height)), 
            position.add(new Vector(height))];
        super(points);

        this.position = positions;
        this.width = width;
        this.height = height;
        this.area = width * height;
    }
}