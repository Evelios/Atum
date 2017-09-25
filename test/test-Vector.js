const test = require("tape");
const Atum = require("../build/Atum");

const Vector = Atum.Geometry.Vector;

// ---- Basic Math Functions ----

test("Vector addition two positive", function(t) {
    const v1 = new Vector(1, 5);
    const v2 = new Vector(4, 3);

    const eq = new Vector(5, 8);

    t.equal(Vector.add(v1, v2), eq);
    t.equal(v1.add(v2), eq);
    t.end();
});

test("Vector addition two negative", function(t) {
    const v1 = new Vector(-2, -7);
    const v2 = new Vector(-4, -3);

    const eq = new Vector(-6, -10);

    t.equal(Vector.add(v1, v2), eq);
    t.equal(v1.add(v2), eq);
    t.end();
});

test("Vector subtraction two positive", function(t) {
    const v1 = new Vector(1, 5);
    const v2 = new Vector(4, 3);

    const eq = new Vector(-3, 2);

    t.equal(Vector.subtract(v1, v2), eq);
    t.equal(v1.subtract(v2), eq);
    t.end();
});

test("Vector subtraction two negative", function(t) {
    const v1 = new Vector(-2, -7);
    const v2 = new Vector(-4, -3);

    const eq = new Vector(2, -4);

    t.equal(Vector.subtract(v1, v2), eq);
    t.equal(v1.subtract(v2), eq);
    t.end();
});

test("Vector multiplication", function(t) {
    const v = new Vector(2, 5);
    const eq = new Vector(6, 15);

    t.equalv(v.multiply(3), eq);
    t.end();
});

test("Vector Division", function(t) {
    const v = new Vector(6, 15);
    const eq = new Vector(2, 5);

    t.equals(v.divide(3), eq);
    t.end();
});

// ---- Advanced Vector Functions ----

test("Vector magnitude", function(t) {
    const v = new Vector(3, 4);
    t.equals(v.magnitude(), 5);
    t.end();
});

test("Vector rotation", function(t) {
    const v = new Vector(3, 4);
    const eq = new Vector(-3, -4);

    t.equals(v.rotate(Math.PI), eq);
    t.end();
});

test("Vector Dot Product", function(t) {
    const v1 = new Vector(5, 6);
    const v2 = new Vector(3, 4);

    const eq = new Vector(15, 24);
    
    t.equals(Vector.dot(v1, v2), eq);
    t.equals(v1.dot(v2), eq);
    t.end();
});

test("Vector Cross Product", function(t) {
    const v1 = new Vector(5, 6);
    const v2 = new Vector(3, 4);

    const eq = 4*5 - 6*3;

    t.equals(Vector.cross(v1, v2), eq);
    t.equals(v1.cross(v2), eq);
    t.end();
});

//---- Static Vector Functions ----

test("Vector Midpoint", function(t) {
    const v1 = new Vector(2, 4);
    const v2 = new Vector(4, 8);

    const eq = new Vector(3, 6);

    t.equals(Vector.midpoint(v1, v2));
    t.end();
});

test("Vector Projection", function(t) {
    const v1 = new Vector(1, 2);
    const v2 = new Vector(3, 4);

    const eq = (new Vector(3, 4)).multiply(11/25);
    t.equal(Vector.proj(v1, v2));
    t.end();
});

test("Vector Angle Between Vectors", function(t) {
    const v1 = new Vector(5, 5);
    const v2 = new Vecotr(0, 7);

    const eq = Math.PI/4;

    t.equals(Vector.angle(v1, v2));
    t.end();
});