"use strict";

import seedRandom from "seedRandom";

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
class Rand {
    constructor(seed) {
        this.rng = seedRandom(seed);
    }

    /**
     * Set the seed for the seeded random number generator. After the seed has been
     * set. The random numbers will be predictable and repeatable given the same
     * input seed. If no seed is specified, then a random seed will be assigned to
     * the random number generator using added system entropy.
     * 
     * @export
     * @param {Number | String} [seed=0] The seed to be applied to the RNG
     * @memberof Rand
     */
    static setSeed(seed = 0) {
        const options = {
            global: true,
            entropy: seed === undefined
        };
        seedRandom(seed, options);
    }

    setSeed(seed) {
        const options = {
            entropy: seed === undefined
        };
        this.rng = seedRandom(seed, options);
    }

    static rand() {
        return Math.random();
    }

    rand() {
        return this.rng();
    }

    static randRange(min, max) {
        return Rand.rand() * (max - min) + min;
    }

    static randInt(min, max) {
        return Math.floor(Rand.rand() * (max - min + 1)) + min;
    }

    static randHex() {
        return Rand.randInt(0, 16777215);
    }

    static randHexColor() {
        return '#' + Rand.randHex().toString(16);
    }
}

export default Rand;