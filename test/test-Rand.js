"use strict";

const test = require("tape");
const Atum = require("../build/Atum");

const Rand = Atum.Utility.Rand;

// ---- Helper Function ----
function inBounds(t, x, low, high) {
    const msg = `Value ${x} should be in bouds between ${low} and ${high}`;
    t.ok(x >= low && x <= high, msg);
}

test("Seeded random number generation", function(t) {
    Rand.setSeed(15);
    const x1 = Math.random();
    const x2 = Math.random();

    Rand.setSeed(15);
    const z1 = Math.random();
    const z2 = Math.random();

    t.equal(x1, z1);
    t.equal(x2, z2);
    t.end();
});

test("Global rng, rand stays in 0-1 boundary", function(t) {
    Rand.setSeed();

    const n = 3;
    t.plan(n);

    let x;
    for (let i = 0; i < n; i++) {
        x = Rand.rand();
        inBounds(t, x, 0, 1);
    }
});

test("Local rng, rand stays in 0-1 boundary", function(t) {
    var rng = new Rand();

    const n = 3;
    t.plan(n);

    let x;
    for (let i = 0; i < n; i++) {
        x = rng.rand();
        inBounds(t, x, 0, 1);
    }
});

test("Global rng, randRange stays in boundary", function(t) {
    Rand.setSeed();
    const n = 5;
    t.plan(n);

    let x;
    for (let i = 0; i < n; i++) {
        x = Rand.randRange(5, 10);
        inBounds(t, x, 5, 10);
    }
});

test("Local rng, randRange stays in boundary", function(t) {
    var rng = new Rand();
    const n = 5;
    t.plan(n);

    let x;
    for (let i = 0; i < n; i++) {
        x = rng.randRange(5, 10);
        inBounds(t, x, 5, 10);
    }
});

test("Global rng, randInt stays in boundary", function(t) {
    Rand.setSeed();
    const n = 5;
    t.plan(n);

    let x;
    for (let i = 0; i < n; i++) {
        x = Rand.randInt(5, 10);
        inBounds(t, x, 5, 10);
    }
});

test("Local rng, randInt stays in boundary", function(t) {
    var rng = new Rand();
    const n = 5;
    t.plan(n);

    let x;
    for (let i = 0; i < n; i++) {
        x = rng.randInt(5, 10);
        inBounds(t, x, 5, 10);
    }
});

test("Global rng, randInt returns an int", function(t) {
    Rand.setSeed();
    const x = Rand.randInt(0, 100);

    t.equals(x, Math.round(x));
    t.end();
});

test("Local rng, randInt returns an int", function(t) {
    var rng = new Rand();
    const x = rng.randInt(0, 100);

    t.equals(x, Math.round(x));
    t.end();
});

test("Global rng, randHexColor is string", function(t) {
    Rand.setSeed();
    const x = Rand.randHexColor();

    t.equals(typeof x, "string");
    t.end();
});

test("Local rng, randHexColor is string", function(t) {
    var rng = new Rand();
    const x = rng.randHexColor();

    console.log(typeof x);
    t.equals(typeof x, "string");
    t.end();
});