/**
 * Point Generator Class
 */

import * as Rand from "util/Rand";

// Depends on the Rectangle Class & the Vector CLass

/**
 * Creates a random distribution of points in a particular bounding box
 * with a particular average d of points.
 * 
 * @export
 * @param {Rectangle} bbox 
 * @param {Number} d 
 */
export function random(bbox, d) {
    let points = [];

    const nPoints = bbox.area / d;
    for (let i = 0; i < nPoints; i++) {
        points.push(Rand.vector(bbox));
    }
}

export function blueNoise(bbox, d) {
    throw "Error: Not Implemented"
}

export function poisson(bbox, d) {
    throw "Error: Not Implemented"
}

export function recursiveWang(bbox, d) {
    throw "Error: Not Implemented"
}

export function square(bbox, d) {
    const dx = dy = d / 2;
    let points = [];

    for (let y = 0; y < bbox.height / d; y++) {
        for (let x = 0; x < bbox.width / d; x++) {
            points.push(new Vector(dx + x*d, dy + y*d));
        }
    }

    return points;
}

export function hexagons(bbox, d, flatTop = true, w, h) {
    // Temporary, Need to allow for the change of height and width
    w, h = d;

    const dx = dy = d / 2;
    let points = [];

    for (let y = 0; y < bbox.height / d; y++) {
        for (let x = 0; x < bbox.width / d; x++) {
            points.push(new Vector((x % 1)*dx + x*d,
                                   (y % 1)*dy + y*d));
        }
    }

    return points;
}

export function circular(bbox, d) {
    throw "Error: Not Implemented"
}