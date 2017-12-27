"use strict";

var Vector = Atum.Geometry.Vector;
var Rectangle = Atum.Geometry.Rectangle;
var binarySpacePartition = Atum.Algorithm.binarySpacePartition;

var bgColor;
var rectColor;
var depth = 2;
var width;
var height;
var bbox;
var bspTree;
var rectList;

function setup() {
    width = document.body.clientWidth || window.innerWidth;
    height = document.body.clientHeight || window.innerHeight;
    bbox = new Rectangle(Vector.zero(), width, height);
    bspTree = binarySpacePartition(bbox, 3);
    rectList = treeToList(bspTree);

    bgColor = color("#303030");
    // bgAccent = color("#393939");
    rectColor = color("#AA7539");
    // color("#27566B");

    createCanvas(width, height);
}

function draw() {
    background(bgColor);

    strokeWeight(4);
    stroke(rectColor);
    noFill();
    for (var r of rectList) {
        rect(r.x, r.y, r.width, r.height);
    }
}


function treeToList(bspTree) {
    var frontier = [bspTree];
    var leafs = [];

    while (frontier.length > 0) {
        var node = frontier.pop();

        if (node.leftNode && node.rightNode) {
            frontier.push(node.leftNode);
            frontier.push(node.rightNode);
        } else {
            leafs.push(node);
        }
    }

    return leafs;
}