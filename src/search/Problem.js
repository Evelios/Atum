class Problem {
    /**
     * An abstract problem class for a graph search problem. This class is
     * meant to be subclassed and used to create a search problem to be used
     * with a graph search algorithm in order to come up with a solution to
     * that problem.
     * 
     * @param {any} initial 
     * @param {any} [goal=null] 
     * 
     * @abstract
     * @class Problem
     */
    constructor(initial, goal=null) {
        this.initial = initial;
        this.goal = goal;
    }

    /**
     * Return the actions that can be executed from a given state. The result
     * should be a list. However if there are many actions than you should
     * consider using a generator and yeild results one at a time.
     * 
     * @param {any} state
     * @returns {List} 
     * @memberof Problem
     */
    actions(state) {
        throw "Not Implemented Error";
    }

    /**
     * Get the state that results from executing an action on a given state.
     * The action must be one that is returned from actions(state)
     * 
     * @param {any} state 
     * @param {any} action 
     * 
     * @memberof Problem
     */
    result(state, action) {
        throw "Not Implemented Error";
    }

    /**
     * Return True if the input state is the goal state.
     * The default behavior is to check equality of the input state and the
     * goal state. If this behavior is not good enough then override this
     * method.
     * 
     * @param {any} state 
     * 
     * @memberof Problem
     */
    goalTest(state) {
        return state == this.goal;
    }

    /**
     * The cost that it would take to go to the new state from the old state
     * by taking a particular action. It would return the cost that it would
     * take to get to the new state.
     * The default cost is that traversing between states costs 1. This means
     * that it returns the previous cost + 1
     * @param {any} prevCost The cost it took to get to the oldState
     * @param {any} oldState The previous state that is being traversed from
     * @param {any} action The action taken to get to the new state
     * @param {any} newState The new state that is to be arrived at
     * 
     * @memberof Problem
     */
    pathCost(prevCost, oldState, action, newState) {
        return prevCost + 1;
    }
}