import Queue from "tinyqueue";

//------------------------------------------------------------------------------

export class Heap extends Array {
    /**
     * Creates an instance of Heap.
     * 
     * @class Heap
     * @extends Array
     */
    constructor() {
        super();
    }

    peek() {
        return this[this.length - 1];
    }

    isEmpty() {
        return this.length === 0;
    }

}

//------------------------------------------------------------------------------

/*

Queue.js

A function to represent a queue

Created by Stephen Morley - http://code.stephenmorley.org/ - and released under
the terms of the CC0 1.0 Universal legal code:

http://creativecommons.org/publicdomain/zero/1.0/legalcode

*/

/* Creates a new queue. A queue is a first-in-first-out (FIFO) data structure -
 * items are added to the end of the queue and removed from the front.
 */
export class Stack {    
      // initialise the queue and offset
    constructor() {
        var queue  = [];
        var offset = 0;
    }

    // Returns the length of the queue.
    getLength() {
        return (queue.length - offset);
    }

    // Returns true if the queue is empty, and false otherwise.
    isEmpty() {
        return (queue.length == 0);
    }

    /* Enqueues the specified item. The parameter is:
    *
    * item - the item to enqueue
    */
    enqueue(item) {
        queue.push(item);
    }

    /* Dequeues an item and returns it. If the queue is empty, the value
    * 'undefined' is returned.
    */
    dequeue() {
        // if the queue is empty, return immediately
        if (queue.length == 0) return undefined;

        // store the item at the front of the queue
        var item = queue[offset];

        // increment the offset and remove the free space if necessary
        if (++ offset * 2 >= queue.length){
            queue  = queue.slice(offset);
            offset = 0;
        }

        // return the dequeued item
        return item;
    }

    /* Returns the item at the front of the queue (without dequeuing it). If the
    * queue is empty then undefined is returned.
    */
    peek() {
        return (queue.length > 0 ? queue[offset] : undefined);
    }
    
}