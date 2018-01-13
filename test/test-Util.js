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