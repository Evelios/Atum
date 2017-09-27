/**
 * This module is used to create different point distributions that can be
 * turned into different tile sets when made into a graph format. There are
 * various different distributions that can be used to create interesting
 * tile patterns when turned into a voronoi diagram. 
 * 
 * @author Thomas Waters
 * @class PointDistribution
 */

"use strict";

import Vector from "../geometry/Vector";
import Rand from "./Rand";

// Depends on the Rectangle Class & the Vector CLass

/**
 * Creates a random distribution of points in a particular bounding box
 * with a particular average distance of between points.
 * 
 * @export
 * @param {Rectangle} bbox The bounding box to create the points in
 * @param {Number} d Average distance between points
 * 
 * @returns {Vector[]} The list of randomly distributed points
 */
export function random(bbox, d) {
    let points = [];

    const nPoints = bbox.area / d;
    for (let i = 0; i < nPoints; i++) {
        points.push(Rand.vector(bbox));
    }

    return points;
}

export function blueNoise(bbox, d) {
    throw "Error: Not Implemented";
}

export function poisson(bbox, d) {
    throw "Error: Not Implemented";
}

export function recursiveWang(bbox, d) {
    throw "Error: Not Implemented";
}

export function square(bbox, d) {
    const dx = dy = d / 2;
    let points = [];

    for (let y = 0; y < bbox.height / d; y++) {
        for (let x = 0; x < bbox.width / d; x++) {
            points.push(new Vector(dx + x * d, dy + y * d));
        }
    }

    return points;
}

export function hexagons(bbox, d, flatTop = true, w, h) {
    // Temporary, Need to allow for the change of height and width
    w,
    h = d;

    const dx = dy = d / 2;
    let points = [];

    for (let y = 0; y < bbox.height / d; y++) {
        for (let x = 0; x < bbox.width / d; x++) {
            points.push(new Vector((x % 1) * dx + x * d,
                (y % 1) * dy + y * d));
        }
    }

    return points;
}

export function circular(bbox, d) {
    throw "Error: Not Implemented";
}