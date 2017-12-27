/**
 * Module containing all the graph search algorithms
 */

import { Queue, Stack, PriorityQueue } from "./GraphStructures";
import Node from "Node";

// ---- Uninformed Search Algorithms ----

export function* floodFill(node, evaluationFn, Frontier) {
    "use strict";

    if (evaluationFn(node)) {
        return;
    }
    let queue = new Frontier();
    let out = [];
    queue.push(node);
    out.push(node);

    while (queue) {
        const currentNode = queue.pop();
        for (const neighbor of currentNode.neighbors) {
            if (evaluationFn(neighbor) && !out.contains(neighbor)) {
                yield neighbor;
                queue.push(neighbor);
                out.push(node);
            }
        }
    }

    return out;
}

export function breadthFloodFill(node, evaluationFn) {
    "use strict";

    return floodFill(node, evaluationFn, Queue);
}

export function depthFloodFill(node, evaluationFn) {
    "use strict";

    return floodFill(node, evaluationFn, Stack);
}

/**
 * Search through the successors of a problem to find a goal
 *
 *
 * @private
 * @param {any} problem 
 * @param {Queue} frontier 
 * 
 
 */
export function graphSearch(problem, frontier) {
    "use strict";

    frontier.push(new Node(problem.initial));

    let node;
    let explored = [];
    while (frontier) {
        node = frontier.pop();
        if (problem.goalTest(node)) {
            return node;
        }
        explored.push(node.state);
        frontier.push(...node.expand(problem).filter(child => {
            // There might be a scoping problem
            // This also might not behave the way I hope because of child
            // object's equality check
            return !explored.includes(child.state) && !frontier.includes(child);
        }));
    }

    return null;
}

export function breadthFirstSearch(problem) {
    return graphSearch(problem, Queue);
}

export function depthFirstSearch(problem) {
    return graphSearch(problem, Stack);
}