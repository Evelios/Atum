"use strict";

const test = require("tape");
const Atum = require('../build/Atum').default;

const PointDistribution = Atum.Utility.PointDistribution;
const Vector = Atum.Geometry.Vector;
const Rectangle = Atum.Geometry.Rectangle;

// ---- Helper Function ----
function inBounds(t, x, low, high) {
    const msg = `Value ${x} should be in bouds between ${low} and ${high}`;
    t.ok(x >= low && x <= high, msg);
}

test("Random points are in bounds", function(t) {
    const bbox = new Rectangle(Vector.zero(), 10, 10);
    const randPoints = PointDistribution.random(bbox, 10);

    for (let point of randPoints) {
        inBounds(t, point.x, bbox.x, bbox.x + bbox.width);
        inBounds(t, point.y, bbox.y, bbox.y + bbox.height);
    }

    t.end();
});