"use strict";

const test = require("tape");
const almostEqual = require("almost-equal");
const Atum = require("../build/Atum").default;

const Vector = Atum.Geometry.Vector;
const Rectangle = Atum.Geometry.Rectangle;

test("Rectangle Super Constructor", function(t) {
    const pos = new Vector(3, 7);
    const width = 10;
    const height = 20;

    const xl = pos;
    const xr = new Vector(13, 7);
    const yt = new Vector(13, 27);
    const yb = new Vector(3, 27);
    const points = [xl, xr, yt, yb];

    const rect = new Rectangle(pos, width, height);

    t.deepEqual(rect.verticies, points);
    t.end();
});