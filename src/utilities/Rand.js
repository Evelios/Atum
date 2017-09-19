/**
 * Wrapper library for David Bau's seeded random number generator which is a
 * wrapper for the Math.rand() functionality. This library is implemented to
 * fill out the functionality of the random capabilities as well as build
 * on the capabilities existing in the framework currently. 
 * 
 * @author Thomas Waters
 * @see {@link https://github.com/davidbau/seedrandom}
 * @class Rand
 */

"use strict";

// var seedRand = require('seedrandom');

/**
 * Set the seed for the seeded random number generator. After the seed has been
 * set. The random numbers will be predictable and repeatable given the same
 * input seed.
 * 
 * @export
 * @param {Number | String} seed
 * @memberof Rand
 */
export function setSeed(seed) {
    seedRand(seed);
}