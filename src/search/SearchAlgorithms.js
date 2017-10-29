import Node from "Node";

/**
 * Module containing all the graph search algorithms
 */

 // ---- Uninformed Search Algorithms ----


 /**
  * Search through the successors of a problem to find a goal
  *
  *
  * @private
  * @param {any} problem 
  * @param {Queue} frontier 
  * 
  
  */
 function graphSearch(problem, frontier) {
    frontier.push(Node(problem.initial));

    let node;
    let explored = [];
    while (frontier) {
        node = frontier.pop();
        if (problem.goalTest(node)) {
            return node;
        }
        explored.push(node.state);
        // ?
    }

    return null;
 }