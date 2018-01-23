"use strict";

import seedRandom from "seedRandom";
import Vector from "../geometry/Vector";

class Rand {
    /**
     * Wrapper library for David Bau's seeded random number generator which is a
     * wrapper for the Math.rand() functionality. This library is implemented to
     * fill out the functionality of the random capabilities as well as build
     * on the capabilities existing in the framework currently. This class can
     * be used on a global or local scale.
     * 
     * @example
     * Rand.seedRandom(0);      // Set the global seed
     * Rand.rand();             // Predictable based off seed
     * 
     * @example 
     * var rng = new Rand(0);   // Set the local rng seed
     * rng.rand();              // Predictable based off seed
     * 
     * Rand.rand();             // Unpredictable since global seed is not set
     * 
     * @see {@link https://github.com/davidbau/seedrandom}
     * @param {number|string} [seed=0] The seed to be applied to the local
     *  random number generator
     * @class Rand
     */
    constructor(seed = 0) {
        this.rng = seedRandom(seed);
    }

    /**
     * Set the global seed for the seeded random number generator. After the seed has been
     * set. The random numbers will be predictable and repeatable given the same
     * input seed. If no seed is specified, then a random seed will be assigned to
     * the random number generator using added system entropy.
     * 
     * @export
     * @param {number|string} [seed=0] The seed to be applied to the global
     *  random number generator
     * @memberof Rand
     */
    static setSeed(seed = 0) {
        const options = {
            global: true,
            entropy: seed === undefined
        };
        seedRandom(seed, options);
    }

    /**
     * Set the seed for the seeded random number generator. After the seed has been
     * set. The random numbers will be predictable and repeatable given the same
     * input seed. If no seed is specified, then a random seed will be assigned to
     * the random number generator using added system entropy.
     * 
     * @export
     * @param {number|string} [seed=0] The seed to be applied to the RNG
     * 
     * @memberof Rand
     */
    setSeed(seed) {
        const options = {
            entropy: seed === undefined
        };
        this.rng = seedRandom(seed, options);
    }

    /**
     * Get a random number from 0 to 1. 
     * 
     * @static
     * @returns {number} random number from 0 to 1
     * 
     * @memberof Rand
     */
    static rand() {
        return Math.random();
    }

    /**
     * Get a random number from 0 to 1.
     * 
     * @returns {number} random number from 0 to 1
     * 
     * @memberof Rand
     */
    rand() {
        return this.rng();
    }

    /**
     * Private helper function:
     * 
     * Roll for a boolean value that is true @percent ammount of the time.
     * If the roll fails then return false. For example calling chance(0.3)
     * will return true 30% of the time. The input range
     * 
     * @private
     * @static
     * @param {number} percent Percent chance to get True. Value is in the range
     *  from 0 - 1. With 1 returning always true.
     * @memberof Rand
     */
    static _chance(rng, percent) {
        if (percent === 0) {
            return false;
        } else {
            return rng.rand() < percent;
        }
    }

    /**
     * Roll for a boolean value that is true @percent ammount of the time.
     * If the roll fails then return false. For example calling chance(0.3)
     * will return true 30% of the time. The input range
     * 
     * @static
     * @param {number} percent Percent chance to get True. Value is in the range
     *  from 0 - 1. With 1 returning always true.
     * @memberof Rand
     */
    static chance(percent) {
        return Rand._chance(this, percent);
    }

    /**
     * Roll for a boolean value that is true @percent ammount of the time.
     * If the roll fails then return false. For example calling chance(0.3)
     * will return true 30% of the time. The input range
     * 
     * @param {number} percent Percent chance to get True. Value is in the range
     *  from 0 - 1. With 1 returning always true.
     * @memberof Rand
     */
    chance(percent) {
        return Rand._chance(Rand, percent);
    }

    /**
     * Private Helper Function:
     * Get a random float value in a particular range
     * 
     * @private
     * @static
     * @param {any} rng The local or global rng to use (Rand or this)
     * @param {number} min 
     * @param {number} max 
     * 
     * @memberof Rand
     */
    static _randRange(rng, min, max) {
        return rng.rand() * (max - min) + min;
    }

    /**
     * Get a random float value in a particular range
     * 
     * @static
     * @param {number} min 
     * @param {number} max 
     * @returns {number} Random float number from min (inclusive) 
     *  to max (exclusive)
     * 
     * @memberof Rand
     */
    static randRange(min, max) {
        return Rand._randRange(Rand, min, max);
    }

    /**
     * Get a random float value in a particular range
     * 
     * @param {number} min 
     * @param {number} max 
     * @returns {number} Random float number from min (inclusive) 
     *  to max (exclusive)
     * 
     * @memberof Rand
     */
    randRange(min, max) {
        return Rand._randRange(this, min, max);
    }

    /**
     * Private Helper Function:
     * Get a random int in a particular range (min and max inclusive)
     * 
     * @private
     * @static
     * @param {any} rng The local or global rng to use (Rand or this)
     * @param {number} min 
     * @param {number} max 
     * @returns {number} Random float number from min (inclusive) 
     *  to max (exclusive)
     * 
     * @memberof Rand
     */
    static _randInt(rng, min, max) {
        return Math.floor(rng.rand() * (max - min + 1)) + min;
    }

    /**
     * Get a random int in a particular range (min and max inclusive)
     * 
     * @static
     * @param {number} min 
     * @param {number} max 
     * @returns {number} Random float number from min (inclusive) 
     *  to max (exclusive)
     * 
     * @memberof Rand
     */
    static randInt(min, max) {
        return Rand._randInt(Rand, min, max);
    }

    /**
     * Get a random int in a particular range (min and max inclusive)
     * 
     * @param {number} min 
     * @param {number} max 
     * @returns {number} Random float number from min (inclusive) 
     *  to max (exclusive)
     * 
     * @memberof Rand
     */
    randInt(min, max) {
        return Rand._randInt(this, min, max);
    }

    /**
     * Private Helper Function:
     * Get the random hex value of a color represented in the hexidecimal format
     * 
     * @private
     * @static
     * @param {any} rng The local or global rng to use (Rand or this)
     * @returns {hex} The random hex value in the color spectrum
     * 
     * @memberof Rand
     */
    static _randHex(rng) {
        return rng.randInt(0, 16777215);
    }

    /**
     * Get the random hex value of a color represented in the hexidecimal format
     * 
     * @static
     * @returns {hex} 
     * 
     * @memberof Rand
     */
    static randHex() {
        return Rand._randHex(Rand);
    }

    /**
     * Get the random hex value of a color represented in the hexidecimal format
     * 
     * @returns {hex} 
     * 
     * @memberof Rand
     */
    randHex() {
        return Rand._randHex(this);
    }

    /**
     * Private Helper Function:
     * Get a random hex color string represented in "#HEXSTR" format
     * 
     * @private
     * @static
     * @param {any} rng The local or global rng to use (Rand or this)
     * @returns {string}
     * 
     * @memberof Rand
     */
    static _randHexColor(rng) {
        return "#" + rng.randHex().toString(16);
    }

    /**
     * Get a random hex color string represented in "#HEXSTR" format
     * 
     * @static
     * @returns {string}
     * 
     * @memberof Rand
     */
    static randHexColor() {
        return Rand._randHexColor(Rand);
    }

    /**
     * Get a random hex color string represented in "#HEXSTR" format
     * 
     * @static
     * @returns {string}
     * 
     * @memberof Rand
     */
    randHexColor() {
        return Rand._randHexColor(this);
    }

    //---- Random Geometry ----

    /**
     * Get a random vector in a bounding box
     * 
     * @private
     * @static
     * @param {any} rng The local or global rng to use (Rand or this)
     * @param {Rectangle} bbox The bounding box of the random vector
     * @returns {Vector} A random vector
     * 
     * @memberof Rand
     */
    static _vector(rng, bbox) {
        return new Vector(
            Rand.randRange(bbox.x, bbox.x + bbox.width),
            Rand.randRange(bbox.y, bbox.y + bbox.height)
        );
    }

    /**
     * Get a random vector in a bounding box
     * 
     * @static
     * @param {Rectangle} bbox The bounding box of the random vector
     * @returns {Vector} A random vector
     * 
     * @memberof Rand
     */
    static vector(bbox) {
        return Rand._vector(Rand, bbox);
    }

    /**
     * Get a random vector in a bounding box
     * 
     * @param {Rectangle} bbox The bounding box of the random vector
     * @returns {Vector} A random vector
     * 
     * @memberof Rand
     */
    vector(bbox) {
        return Rand._vector(this, bbox);
    }

    static _jitter(rng, v, max) {
        return Vector.add(v, Vector.Polar(max, rng.randRange(0, 2 * Math.PI)));
    }

    static jitter(v, max) {
        return Rand._jitter(Rand, v, max);
    }

    jitter(v, max) {
        return Rand._jitter(this, v, max);
    }
}

export default Rand;