"use strict";

const test = require("tape");
const Atum = require('../build/Atum');

const PointDistribution = Atum.Utility.PointDistribution;
const Vector = Atum.Geometry.Vector;
const Rectangle = Atum.Geometry.Rectangle;
const Diagram = Atum.Graph.Diagram;

const bbox = new Rectangle(Vector.zero(), 10, 10);
const randPoints = PointDistribution.random(bbox, 5);

const graph = new Diagram(randPoints, bbox);

test("Centers Exist", function(t) {
    for (let center of graph.centers) {
        t.notEqual(center, undefined);
    }
    t.end();
});

test("Corners Exist", function(t) {
    for (let corner of graph.corners) {
        t.notEqual(corner, undefined);
    }
    t.end();
});

test("Edges Exist", function(t) {
    for (let edge of graph.edges) {
        t.notEqual(edge, undefined);
    }
    t.end();
});

test("Tiles Exist", function(t) {
    for (let tile of graph.tiles) {
        t.notEqual(tile, undefined);
    }
    t.end();
});