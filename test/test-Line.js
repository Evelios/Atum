"use strict";

const test = require("tape");
const Atum = require('../build/Atum');

const Line = Atum.Geometry.Line;
const Vector = Atum.Geometry.Vector;

//---- Testing Line Intersection -----------------------------------------------
// Code and examples reference
// http://www.geeksforgeeks.org/check-if-two-given-line-segments-intersect/
test("Line Intersection: Example 1", function(t) {
    const line1 = new Line(new Vector(1, 3), new Vector(3, 4));
    const line2 = new Line(new Vector(3, 2), new Vector(2, 4));

    t.ok(Line.intersects(line1, line2));
    t.end();
});

test("Line Intersection: Example 2", function (t) {
    const line1 = new Line(new Vector(1, 1), new Vector(3, 3));
    const line2 = new Line(new Vector(2, 2), new Vector(4, 2));

    t.ok(Line.intersects(line1, line2));
    t.end();
});

test("Line Intersection: Example 3", function (t) {
    const line1 = new Line(new Vector(1, 3), new Vector(4, 4));
    const line2 = new Line(new Vector(2, 1), new Vector(3, 3));

    t.notok(Line.intersects(line1, line2));
    t.end();
});

test("Line Intersection: Example 4", function (t) {
    const line1 = new Line(new Vector(1, 3), new Vector(4, 4));
    const line2 = new Line(new Vector(4, 0), new Vector(2, 2));

    t.notok(Line.intersects(line1, line2));
    t.end();
});

test("Line Intersection: Collinear Intersecting", function (t) {
    const line1 = new Line(new Vector(1, 1), new Vector(3, 3));
    const line2 = new Line(new Vector(2, 2), new Vector(4, 4));

    t.ok(Line.intersects(line1, line2));
    t.end();
});

test("Line Intersection: Collinear Non-Intersecting", function (t) {
    const line1 = new Line(new Vector(1, 1), new Vector(2, 2));
    const line2 = new Line(new Vector(3, 3), new Vector(4, 4));

    t.notok(Line.intersects(line1, line2));
    t.end();
});