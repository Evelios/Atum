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

var seedRandom = require("seedRandom");

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
    seedRandom(seed);
}

export function rand() {

}

export function randRange() {

}

export function randHex() {

}

export function randHexColor() {

}

// //------------------------------------------------------------------------------
// // Returns a random number between 0 (inclusive) and 1 (exclusive
// Util.rand = function() {
//     return Math.random();
// }

//   //------------------------------------------------------------------------------
//   // Returns a random number between min (included) and max(excluded)
//   Util.randRange = function(min, max) {
//     return Math.random() * (max - min) + min;
//   }

//   //------------------------------------------------------------------------------
//   // Returns a random integer from min (included) to max (excluded)
//   Util.randInt = function(min, max) {
//     return Math.floor(Math.random() * (max - min)) + min;
//   }

//   //------------------------------------------------------------------------------
//   // Returns a random integer from min (included) to max (included)
//   Util.randIntInclusive = function(min, max) {
//     return Math.floor(Math.random() * (max - min + 1)) + min;
//   }

//   //------------------------------------------------------------------------------
//   // Generates a random hexidecimal color
//   // http://www.paulirish.com/2009/random-hex-color-code-snippets/
//   Util.randHexColor = function() {
//     return '#' + Math.floor(Math.random() * 16777215).toString(16);
//   }