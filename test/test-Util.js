"use strict";

const test = require("tape");
const Atum = require("../build/Atum");

const Util = Atum.Utility.Helpers;

test("Options Setting With Defaults", function(t) {
    const userOptions = {
        eggs: 24,
        bread: "white"
    };

    const defaults = {
        eggs: 12,
        milk: "raw",
        bread: "wheat",
        cheese: "cheddar",
    };

    const expected = {
        eggs: 24,
        milk: "raw",
        bread: "white",
        cheese: "cheddar",
    };

    const options = Util.setOptions(userOptions, defaults);

    t.deepEqual(options, expected);
    t.end();
});

test("Floating point equality", function(t) {
    const x = 0.1;
    const y = 0.1;
    const z = 0.100000000001;

    t.ok(Util.fequals(0.1, 0.1), "Two Literals")
    t.ok(Util.fequals(x, 0.1), "Variable and Literal");
    t.ok(Util.fequals(x, y), "Two Variables");
    t.notok(Util.fequals(x, z), "Close But Not Close Enough");
    t.end();

});