"use strict";

const test = require("tape");
const almostEqual = require("almost-equal");
const Atum = require("../build/Atum");

const Vector = Atum.Geometry.Vector;
const Shape = Atum.Geometry.Shape;

test("Shape Array Super Constructor", function(t) {
    const v1 = new Vector(3, 7);
    const v2 = new Vector(6, 3);
    const v3 = new Vector(2, 2);
    const points = [v1, v2, v3];

    const triangle = new Shape(points);

    // t.looseEqual(triangle, points);
    t.end();
});

test("Shape Constructor", function(t) {
    const v1 = new Vector(3, 7);
    const v2 = new Vector(6, 3);
    const v3 = new Vector(2, 2);
    const points = [v1, v2, v3];

    const triangle = new Shape(points);

    t.deepEqual(triangle, points);
    t.end();
});