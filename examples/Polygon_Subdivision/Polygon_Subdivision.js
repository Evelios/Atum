"use strict";

// Atum Library Variables
var Vector = Atum.Geometry.Vector;
var Rectangle = Atum.Geometry.Rectangle;
var Rand = Atum.Utility.Rand;
var Diagram = Atum.Graph.Diagram;
var poisson = Atum.Utility.PointDistribution.poisson;
var polygonSubdivide = Atum.Algorithm.polygonSubdivide;

// Colors
var bgColor = tinycolor("#303030");
var bgAccent = tinycolor("#393939");
var primaryColor = tinycolor("#AA7539");
var secondaryColor = tinycolor("#A23645");
var tertiaryColor = tinycolor("#27566B");
var quaternaryColor = tinycolor("#479030");

// Globals
var width;
var height;
var bbox;
var diagram;
var polyList;

var params = {
    // Functions
    createAndRender: createAndRender,

    // Parameters
    density: 50,
    depth: 2,
    dropoutRate: 0
};

//---- Setup Functions --------------------------------------------------------

function setup() {
    width = document.body.clientWidth || window.innerWidth;
    height = document.body.clientHeight || window.innerHeight;
    bbox = new Rectangle(Vector.zero(), width, height);

    createCanvas(width, height);

    setUpGui();
    createAndRender();
}

function setUpGui() {
    var gui = new dat.GUI();

    gui.add(params, "createAndRender").name("Create New Graph");
    gui.add(params, "density", 25, 100, 1).name("Point Density");
    gui.add(params, "depth", 0, 5, 1).name("Depth");
    gui.add(params, "dropoutRate", 0, 0.25, 0.01).name("Dropout Rate");
}

//---- Other Functions --------------------------------------------------------

function createAndRender() {
    create();
    render();
}

function create() {
    polyList = [];
    var points = poisson(bbox, params.density);
    diagram = new Diagram(points, bbox);

    for (var tile of diagram.tiles) {
        var rootTile = polygonSubdivide(tile, {
            depth: params.depth,
            dropoutRate: params.dropoutRate
        });

        polyList.push(...treeToList(rootTile));
    }
}

function render() {
    background(bgColor.toHexString());

    strokeWeight(2);
    stroke(primaryColor.toHexString());
    for (var tile of polyList) {
        var weight = 1 + 1.5 * (1 - Math.sqrt(tile.depth / params.depth));
        strokeWeight(weight);
        for (var edge of tile.edges) {
            line(edge.p1.x, edge.p1.y, edge.p2.x, edge.p2.y);
        }
    }
}

function treeToList(root) {
    var frontier = [root];
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

