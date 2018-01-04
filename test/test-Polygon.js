"use strict";

const test = require("tape");
const almostEqual = require("almost-equal");
const Atum = require("../build/Atum");

const Vector = Atum.Geometry.Vector;
const Polygon = Atum.Geometry.Polygon;
const Rectangle = Atum.Geometry.Rectangle;

test("Polygon Super Constructor", function(t) {
    const v1 = new Vector(3, 7);
    const v2 = new Vector(6, 3);
    const v3 = new Vector(2, 2);
    const points = [v1, v2, v3];

    const triangle = new Polygon(points);

    // t.deepEqual(triangle, points);
    t.end();
});

test("Polygon Centroid Averaging", function(t) {
    const v1 = new Vector(8, 7);
    const v2 = new Vector(7, 4);
    const v3 = new Vector(3, 1);
    const points = [v1, v2, v3];

    const centroid = new Vector(6, 4);
    const poly = new Polygon(points);

    t.deepEqual(poly.centroid(), centroid, "Polygon centroid is correct");
    t.deepEqual(poly.center, poly.centroid(), "Center is centroid");
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

test("Polygon Bounding Box", function(t) {
    const v1 = new Vector(8, 7);
    const v2 = new Vector(7, 4);
    const v3 = new Vector(3, 1);
    const v4 = new Vector(2, 8);
    const points = [v1, v2, v3, v4];

    const poly = new Polygon(points);

    const bbox = new Rectangle(new Vector(2, 1), 6, 7);

    t.deepEqual(poly.bbox(), bbox);
    t.end();
});

test("Rectangle Polygon Contains Point", function(t) {
    const v1 = new Vector(1, 1);
    const v2 = new Vector(1, 7);
    const v3 = new Vector(7, 1);
    const v4 = new Vector(7, 7);
    const points = [v1, v2, v3, v4];

    const poly = new Polygon(points);

    const inside = new Vector(5, 5);
    const outside = new Vector(5, 10);

    t.ok(poly.contains(inside));
    t.notok(poly.contains(outside));
    t.end();
});

test("Polygon Contains Point", function(t) {
    const v1 = new Vector(8, 7);
    const v2 = new Vector(7, 4);
    const v3 = new Vector(3, 1);
    const v4 = new Vector(2, 8);
    const points = [v1, v2, v3, v4];

    const poly = new Polygon(points);

    const inside = new Vector(5, 5);
    const outside = new Vector(5, 1);

    t.ok(poly.contains(inside));
    t.notok(poly.contains(outside));
    t.end();
});