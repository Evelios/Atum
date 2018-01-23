"use strict";

var Vector = Atum.Geometry.Vector;
var Rectangle = Atum.Geometry.Rectangle;
var recursiveVoronoi = Atum.Algorithm.recursiveVoronoi;
var Rand = Atum.Utility.Rand;

var bgColor;
var rectColor;
var width;
var height;
var bbox;
var recursiveDiagram;
var polyList;

var params = {
    createAndRender: createAndRender,
    seed : 1,
    depth : 2,
    density: 150
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

    gui.add(params, "createAndRender").name("Create New Graph");
    gui.add(params, "seed", 0, 5).step(1).name("Seed");
    gui.add(params, "density", 100, 250, 10).name("Point Density");
    gui.add(params, "depth", 0, 2).step(1).name("Depth");
}

//---- Other Functions

function createAndRender() {
    createGraph();
    drawGraph();
}

function createGraph() {
    Rand.setSeed(params.seed);
    recursiveDiagram = recursiveVoronoi(bbox, params.depth, params.density);
    polyList = treeToList(recursiveDiagram);
}

function treeToList(vorDiagram) {
    var frontier = [...vorDiagram.tiles];
    var explored = [];

    while (frontier.length > 0) {
        var tile = frontier.pop();

        if (tile.children !== null && typeof tile.children !== "undefined") {
            for (var subtile of tile.children) {
                frontier.push(subtile);
            }
        }

        explored.push(tile);
    }

    return explored;
}

function drawGraph() {
    background(bgColor);

    strokeWeight(3);
    stroke(rectColor);
    noFill();
    for (var tile of polyList) {
        var weight = 1 + 2 * (1 - Math.sqrt(tile.depth / params.depth));
        strokeWeight(weight);
        for (var e of tile.edges) {
            line(e.v0.x, e.v0.y, e.v1.x, e.v1.y);
        }
    }
}