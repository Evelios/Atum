// Tuneable Parameters
// 1.25 guarentee split horiz or vert
// Range to split on
// Redistribute the range to split

import Vector from "../geometry/Vector";
import Rectangle from "../geometry/Rectangle";
import Rand from "../utilities/Rand";

/**
 * Create a Binary Space Partition Tree of a particular depth
 * 
 * @export
 * @param {Rectangle} bbox The rectangle that the BSP tree is created within
 * @param {number} depth The depth that the BSP tree is created down to
 * @returns 
 */
export default function binarySpacePartition(bbox, depth) {
    "use strict";
    // Move back to bbox.copy()
    let root = bbox;
    root.depth = 0;
    let frontier = [root];

    while (frontier.length > 0) {
        let node = frontier.pop();
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
                Rand.randRange(-node.height / 4, node.height / 4);

            leftNode = new Rectangle(new Vector(node.x, node.y),
                node.width, splitY);
            rightNode = new Rectangle(new Vector(node.x, node.y + splitY),
                node.width, node.height - splitY);

        } else { // Split Horizontal

            const splitX = node.width / 2 +
                Rand.randRange(-node.width / 4, node.width / 4);

            leftNode = new Rectangle(new Vector(node.x, node.y),
                splitX, node.height);
            rightNode = new Rectangle(new Vector(node.x + splitX, node.y),
                node.width - splitX, node.height);
        }

        leftNode.depth = node.depth + 1;
        rightNode.depth = node.depth + 1;

        node.leftNode = leftNode;
        node.rightNode = rightNode;

        if (node.depth !== depth) {
            frontier.push(leftNode);
            frontier.push(rightNode);
        }
    }

    return root;
}