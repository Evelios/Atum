import Vector from "../geometry/Vector";
import Rectangle from "../geometry/Rectangle";
import Rand from "../utilities/Rand";
import { exp } from "../utilities/Redist";
import { setOptions } from "../utilities/Util";

/**
 * Create a Binary Space Partition Tree of a particular depth
 * 
 * @export
 * @param {Rectangle} bbox The rectangle that the BSP tree is created within
 * @param {object} options The options that can be set to change the properties
 *  of the Binsary Space Partition generation
 * 
 *  options = {
 *    depth {number} : The depth that the BSP tree is created down to,
 *    splitRange {number} : 0-1 The ammount of deviation from the center
 *      that the binary split is allowed to take. 0 Means that the split always,
 *      happens in the middle and 1 means that the split can happen at the edge of
 *      the rectangle.
 *    dropoutRate {number} : 0-1, the percent chance that when dividing a
 *      cell that it will not divide anymore
 *    minArea {number} : the minimum area that a rectangle can become. If the rect is
 *      not at the max depth the subdivision will still stop
 *    minSideLength {number}
 *  }
 * 
 *  defaults = {
 *      depth: 3,
 *      splitRange: 0.5,
 *      dropoutRate: 0.0,
 *      minArea: 0.0,
 *      minSideLength: 0.0,
 *  }
 * @returns {Rect} The root node of the BSP Tree. The node has the properties
 *  {  
 *      leftNode: the left rect node in the tree
 *      rightNode: the right rect node in the tree
 *  }
 */
export default function binarySpacePartition(bbox, options) {
    "use strict";

    const defaults = {
        depth: 3,
        splitRange: 0.5,
        dropoutRate: 0.0,
        minArea: 0.0,
        minSideLength: 0.0,
    };

    const params = setOptions(options, defaults);

    // Move back to bbox.copy()
    let root = bbox;
    root.depth = 0;
    let frontier =  [root];
    // This is a way of redistributing 2 > 100 (aka infinity) where the useable
    // range stays together. Most of the interesting behavior is near 2 - 4
    const splitDenom = exp(params.splitRange, 7, false).map(0, 1, 2, 100);

    while (frontier.length > 0) {
        let node = frontier.pop();

        if (node !== root && Rand.chance(params.dropoutRate)) {
            continue;
        }

        let leftNode;
        let rightNode;

        const isWide = node.width / node.height > 1.25;
        const isTall = node.height / node.width > 1.25;
        const splitRand = !isWide && !isTall;

        let splitVertical;
        if (splitRand) {
            splitVertical = Rand.chance(0.5);
        } else {
            splitVertical = isTall;
        }

        if (splitVertical) { // Split vertical

            const splitY = node.height / 2 +
                Rand.randRange(-node.height / splitDenom, node.height / splitDenom);

            leftNode = new Rectangle(new Vector(node.x, node.y),
                node.width, splitY);
            rightNode = new Rectangle(new Vector(node.x, node.y + splitY),
                node.width, node.height - splitY);

        } else { // Split Horizontal

            const splitX = node.width / 2 +
                Rand.randRange(-node.width / splitDenom, node.width / splitDenom);

            leftNode = new Rectangle(new Vector(node.x, node.y),
                splitX, node.height);
            rightNode = new Rectangle(new Vector(node.x + splitX, node.y),
                node.width - splitX, node.height);
        }

        leftNode.depth = node.depth + 1;
        rightNode.depth = node.depth + 1;

        node.leftNode = leftNode;
        node.rightNode = rightNode;

        if (node.depth < params.depth) {
            frontier.push(leftNode);
            frontier.push(rightNode);
        }
    }

    return root;
}