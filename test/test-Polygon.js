"use strict";

const test = require("tape");
const almostEqual = require("almost-equal");
const Atum = require("../build/Atum").default;

const Vector = Atum.Geometry.Vector;
const Polygon = Atum.Geometry.Polygon;

test("Polygon Super Constructor", function(t) {
    const v1 = new Vector(3, 7);
    const v2 = new Vector(6, 3);
    const v3 = new Vector(2, 2);
    const points = [v1, v2, v3];

    const triangle = new Polygon(points);

    t.deepEqual(triangle.verticies, points);
    t.end();
});

test("Polygon Centroid Averaging", function(t) {
    const v1 = new Vector(8, 7);
    const v2 = new Vector(7, 4);
    const v3 = new Vector(3, 1);
    const points = [v1, v2, v3];

    const centroid = new Vector(6, 4);
    const poly = new Polygon(points);

    t.deepEqual(poly.centroid, centroid, "Polygon centroid is correct");
    t.deepEqual(poly.center, poly.centroid, "Center is centroid");
    t.end();
});

test("Polygon Center Specification", function(t) {
    const v1 = new Vector(8, 7);
    const v2 = new Vector(7, 4);
    const v3 = new Vector(3, 1);
    const points = [v1, v2, v3];
    const center = new Vector(5, 3);
    const centroid = new Vector(6, 4);

    const poly = new Polygon(points, center);

    t.deepEqual(poly.center, center);
    t.notDeepEqual(poly.center, centroid);
    t.end();
});