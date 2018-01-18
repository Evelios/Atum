class Node {
    /**
     * A node in the search tree containing all the information about that node
     * and state that that node is in
     * @param {any} state The current state of the node
     * @param {any} [parent=null] The parent node
     * @param {any} [action=null] The action taken to get to this state
     * @param {number} [pathCost=0] The total path cost to reach this state
     * 
     * @class Node
     */
    constructor(state, parent=null, action=null, pathCost=0) {
        this.state = state;
        this.parent = parent;
        this.action = action;
        this.pathCost = pathCost;
        this.depth = parent ? parent.depth : 0;
    }

    /**
     * List the nodes that are reachable in one step from this node
     * 
     * @param {any} problem 
     * @returns {Array<Node>} The nodes reachable from this node
     * 
     * @memberof Node
     */
    expand(problem) {
        return problem.actions(this.state).map(
            node => node.childNode(problem, action)
        );
    }

    /**
     * The resulting node from taking a current action given the current node
     * 
     * @param {any} problem 
     * @param {any} action 
     * @returns {Node} The resulting node
     * 
     * @memberof Node
     */
    childNode(problem, action) {
        const next = problem.result(this.state, action);
        return new Node(
            next,   // The node state
            this,   // The parent node
            action, // Action from this to next state
            problem.pathCost(this.pathCost, this.state, action, next)
        ) ;
    }

    /**
     * Get the list of actions that it took to get from the root node to the
     * current node in the tree
     * 
     * @returns {Array<Node>}
     * 
     * @memberof Node
     */
    solution() {
        return this.path().slice(1).map(node => node.action);
    }

    /**
     * Get the list of nodes that form a path from the root node in the tree
     * to the current node in the tree
     * 
     * 
     * @memberof Node
     */
    path() {
        let node = this;
        let path = [];

        while (node) {
            path.push(node);
            node = node.parent;
        }
        return path.reverse();
    }


}