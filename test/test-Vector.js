"use strict";

const test = require("tape");
const almostEqual = require("almost-equal");
const Atum = require("../build/Atum");

const Vector = Atum.default.Geometry.Vector;

// ---- Helper Function ----

/**
 * A wrapper for Tape for testing floating point numbers and keeping the
 * functionality of the tape library for recording and printing messages.
 * 
 * @param {Tape} t The tape function variable
 * @param {float} actual The actual input value
 * @param {float} expected The expected value
 * @param {string} msg The message to be printed to the Tape log
 */
function almost(t, actual, expected, msg) {
    if (almostEqual(actual, expected)) {
        t.ok(true, msg);
    } else {
        t.equal(actual, expected, msg);
    }
}

// ---- Basic Math Functions ----

test("Vector addition two positive", function(t) {
    const v1 = new Vector(1, 5);
    const v2 = new Vector(4, 3);

    const eq = new Vector(5, 8);

    t.deepEqual(Vector.add(v1, v2), eq);
    t.deepEqual(v1.add(v2), eq);
    t.end();
});

test("Vector addition two negative", function(t) {
    const v1 = new Vector(-2, -7);
    const v2 = new Vector(-4, -3);

    const eq = new Vector(-6, -10);

    t.deepEqual(Vector.add(v1, v2), eq);
    t.deepEqual(v1.add(v2), eq);
    t.end();
});

test("Vector subtraction two positive", function(t) {
    const v1 = new Vector(1, 5);
    const v2 = new Vector(4, 3);

    const eq = new Vector(-3, 2);

    t.deepEqual(Vector.subtract(v1, v2), eq);
    t.deepEqual(v1.subtract(v2), eq);
    t.end();
});

test("Vector subtraction two negative", function(t) {
    const v1 = new Vector(-2, -7);
    const v2 = new Vector(-4, -3);

    const eq = new Vector(2, -4);

    t.deepEqual(Vector.subtract(v1, v2), eq);
    t.deepEqual(v1.subtract(v2), eq);
    t.end();
});

test("Vector multiplication", function(t) {
    const v = new Vector(2, 5);
    const eq = new Vector(6, 15);

    t.deepEqual(v.multiply(3), eq);
    t.end();
});

test("Vector Division", function(t) {
    const v = new Vector(6, 15);
    const eq = new Vector(2, 5);

    t.deepEqual(v.divide(3), eq);
    t.end();
});

// ---- Advanced Vector Functions ----

test("Vector magnitude", function(t) {
    const v = new Vector(3, 4);
    almost(t, v.magnitude(), 5);
    t.end();
});

test("Vector rotation", function(t) {
    const v = new Vector(3, 4);
    const eq = new Vector(-3, -4);

    // t.deepEqual(v.rotate(Math.PI), eq);
    t.end();
});

test("Vector Dot Product", function(t) {
    const v1 = new Vector(5, 6);
    const v2 = new Vector(3, 4);

    const eq = 5 * 3 + 6 * 4;

    t.equal(Vector.dot(v1, v2), eq);
    t.equal(v1.dot(v2), eq);
    t.end();
});

test("Vector Cross Product", function(t) {
    const v1 = new Vector(5, 6);
    const v2 = new Vector(3, 4);

    const eq = 4 * 5 - 6 * 3;

    t.equal(Vector.cross(v1, v2), eq);
    t.equal(v1.cross(v2), eq);
    t.end();
});

//---- Static Vector Functions ----

test("Vector Midpoint", function(t) {
    const v1 = new Vector(2, 4);
    const v2 = new Vector(4, 8);

    const eq = new Vector(3, 6);

    t.deepEqual(Vector.midpoint(v1, v2), eq);
    t.end();
});

test("Vector Projection", function(t) {
    const v1 = new Vector(1, 2);
    const v2 = new Vector(3, 4);

    const eq = (new Vector(3, 4)).multiply(11 / 25);
    t.deepEqual(Vector.proj(v1, v2), eq);
    t.end();
});

test("Vector Angle Between Vectors", function(t) {
    const v1 = new Vector(5, 5);
    const v2 = new Vector(0, 7);

    const eq = Math.PI / 4;

    almost(t, Vector.angle(v1, v2), eq);
    t.end();
});