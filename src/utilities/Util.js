/**
 * A utility file with helper functions that can be used to aid in the
 * development of the package.
 */
"use strict";

// Used for testing if an object contains a particular property
// http://stackoverflow.com/questions/7174748/javascript-object-detection-dot-syntax-versus-in-keyword/7174775#7174775
export function has(obj, prop) { return Object.prototype.hasOwnProperty.call(obj, prop); };

export function setOptions(options, defaults) {
    let out = {};
    for (const v in defaults) {
        out[v] = options[v] !== undefined ? options[v] : defaults[v];
    }
    return out;
}

/**
 * Compare two floating point numbers for equality
 * 
 * @export
 * @param {numeric} float1 First floating point number
 * @param {numeric} float2 Second floating point number
 * @return {bool} True if the two points are (almost) equal
 */
export function fequals(float1, float2) {
    return Math.abs(float1 - float2) < Number.EPSILON;
}

// Number map from one range to another range
// https://gist.github.com/xposedbones/75ebaef3c10060a3ee3b246166caab56
Number.prototype.map = function (in_min, in_max, out_min, out_max) {
    return (this - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
};