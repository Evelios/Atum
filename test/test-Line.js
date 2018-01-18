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

test("Line Intersection Point", function(t) {
    const line1 = new Line(new Vector(1, 0), new Vector(1, 4));
    const line2 = new Line(new Vector(0, 2), new Vector(3, 2));
    const line3 = new Line(new Vector(0, 0), new Vector(2, 3));
    const line4 = new Line(new Vector(3, 5), new Vector(5, 2));

    const intersect1 = new Vector(1, 2);

    t.deepEqual(Line.intersection(line1, line2), intersect1, "Euclidean intersection");
    t.notEqual(Line.intersection(line1, line3), null, "Diagonal Intersection 1");
    t.notEqual(Line.intersection(line2, line3), null, "Diagonal Intersection 2");
    t.equal(Line.intersection(line1, line4), null, "Off The Line 1");
    t.equal(Line.intersection(line2, line4), null, "Off The Line 2");
    t.equal(Line.intersection(line3, line4), null, "Off The Line 3");
    t.end();
});