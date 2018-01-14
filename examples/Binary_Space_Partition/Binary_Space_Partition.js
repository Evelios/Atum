"use strict";

var Vector = Atum.Geometry.Vector;
var Rectangle = Atum.Geometry.Rectangle;
var binarySpacePartition = Atum.Algorithm.binarySpacePartition;
var Rand = Atum.Utility.Rand;

var bgColor;
var rectColor;
var width;
var height;
var bbox;
var bspTree;
var rectList;

var params = {
    seed : 1,
    depth : 3,
    splitRange: 0.5,
    dropoutRate: 0.0
};

//---- Main Setup Functions ----
function setup() {
    width = document.body.clientWidth || window.innerWidth;
    height = document.body.clientHeight || window.innerHeight;
    bbox = new Rectangle(Vector.zero(), width, height);
    

    bgColor = color("#303030");
    // bgAccent = color("#393939");
    rectColor = color("#AA7539");
    // color("#27566B");

    createCanvas(width, height);

    setUpGui();

    createAndRender();
}

//---- Secondary Setup Functions ----

function setUpGui() {
    var gui = new dat.GUI();

    gui.add(params, "seed", 1, 5, 1).name("Seed").onChange(createAndRender);
    gui.add(params, "depth", 1, 10, 1).name("Depth").onChange(createAndRender);
    gui.add(params, "splitRange", 0, 1, 0.01).name("Split Range").onChange(createAndRender);
    gui.add(params, "dropoutRate", 0, 0.25, 0.01).name("Dropout Rate").onChange(createAndRender);
}

//---- Other Functions

function createAndRender() {
    createGraph();
    drawGraph();
}

function createGraph() {
    Rand.setSeed(params.seed);
    bspTree = binarySpacePartition(bbox, {
        depth: params.depth,
        splitRange: params.splitRange,
        dropoutRate: params.dropoutRate
    });// params.depth, params.splitRange, params.dropoutRate);
    rectList = treeToList(bspTree);
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

function drawGraph() {
    background(bgColor);

    strokeWeight(4);
    stroke(rectColor);
    noFill();
    for (var r of rectList) {
        rect(r.x, r.y, r.width, r.height);
    }
}