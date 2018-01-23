"use strict";

// Atum Library Variables
var Vector = Atum.Geometry.Vector;
var Rectangle = Atum.Geometry.Rectangle;
var binarySpacePartition = Atum.Algorithm.binarySpacePartition;
var Rand = Atum.Utility.Rand;
var Diagram = Atum.Graph.Diagram;

// Colors
var bgColor;
var bgAccent;
var rectColor;
var diagramColor;

// Globals
var width;
var height;
var bbox;
var bspTree;
var rectList;
var diagram;

var params = {
    // Parameters
    seed : 1,
    depth : 4,
    splitRange: 0.5,
    dropoutRate: 0.0,

    // Render Options
    rectGrid: true,
    delaunay: false,
    bspTree: false
};

//---- Main Setup Functions ----
function setup() {
    width = document.body.clientWidth || window.innerWidth;
    height = document.body.clientHeight || window.innerHeight;
    bbox = new Rectangle(Vector.zero(), width, height);
    

    bgColor = color("#303030");
    bgAccent = color("#828282");
    rectColor = color("#AA7539");
    diagramColor = color("#27566B");

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

    var rendering = gui.addFolder("Rendering");

    rendering.add(params, "rectGrid").name("Rectangle Grid").onChange(render);
    rendering.add(params, "delaunay").name("Delaunay Connections").onChange(render);
    rendering.add(params, "bspTree").name("Show BSP Tree").onChange(render);
}

//---- Other Functions

function createAndRender() {
    createGraph();
    render();
}

function render() {
    background(bgColor);

    if (params.rectGrid) {
        drawWightedGraph(bspTree);
    }
    if (params.delaunay) {
        drawDiagram();
    }
    if (params.bspTree) {
        drawGraphConnections(bspTree);
    }
}

function createGraph() {
    Rand.setSeed(params.seed);
    bspTree = binarySpacePartition(bbox, {
        depth: params.depth,
        splitRange: params.splitRange,
        dropoutRate: params.dropoutRate
    });
    rectList = treeToList(bspTree);
    var points = rectList.map(x => x.center);
    diagram = new Diagram(points, bbox);
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

function drawWightedGraph(bspTree) {
    var left = bspTree.leftNode;
    var right = bspTree.rightNode;
    if (left && right) {
        var weight = 1 + 6 * (1 - Math.sqrt(left.depth / params.depth));
        strokeWeight(weight);
        stroke(rectColor);
        noFill();
        rect(left.x, left.y, left.width, left.height);
        rect(right.x, right.y, right.width, right.height);
        drawWightedGraph(left);
        drawWightedGraph(right);
    }
}

function drawGraphConnections(bspTree) {
    var left = bspTree.leftNode;
    var right = bspTree.rightNode;
    if (left && right) {
        var p1 = left.center;
        var p2 = right.center;
        var weight = 1 + 4 * (1 - sqrt(left.depth / params.depth));
        strokeWeight(weight);
        stroke(bgAccent);
        line(p1.x, p1.y, p2.x, p2.y);
        drawGraphConnections(left);
        drawGraphConnections(right);
    }
}

function drawDiagram() {
    for (var edge of diagram.edges) {
        var d0 = edge.d0;
        var d1 = edge.d1;
        if (d0 && d1) {
            strokeWeight(1.5);
            stroke(diagramColor);
            line(d0.x, d0.y, d1.x, d1.y);
        }
    }
} 