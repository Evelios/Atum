"use strict";

const test = require("tape");
const Atum = require("../build/Atum").default;

const Rand = Atum.Utility.Rand.default;

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

test("rand stays in 0-1 boundary", function(t) {
    Rand.setSeed();

    const n = 3;
    t.plan(n);

    let x;
    for (let i = 0; i < n; i++) {
        x = Rand.rand();
        inBounds(t, x, 0, 1);
    }
});

test("randRange stays in boundary", function(t) {
    Rand.setSeed();
    const n = 5;
    t.plan(n);

    let x;
    for (let i = 0; i < n; i++) {
        x = Rand.randRange(5, 10);
        inBounds(t, x, 5, 10);
    }
});

test("randInt stays in boundary", function(t) {
    Rand.setSeed();
    const n = 5;
    t.plan(n);

    let x;
    for (let i = 0; i < n; i++) {
        x = Rand.randInt(5, 10);
        inBounds(t, x, 5, 10);
    }
});

test("randInt returns an int", function(t) {
    Rand.setSeed();
    const x = Rand.randInt(0, 100);

    t.equals(x, Math.round(x));
    t.end();
});