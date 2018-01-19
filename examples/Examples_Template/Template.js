"use strict";

// Atum Library Variables
var Vector = Atum.Geometry.Vector;
var Rectangle = Atum.Geometry.Rectangle;
var Rand = Atum.Utility.Rand;
var Diagram = Atum.Graph.Diagram;
var poisson = Atum.Utility.PointDistribution.poisson;

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

var params = {
    // Parameters
    density: 50
};

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

    gui.add(params, "density", 25, 100, 1).name("Point Density").onChange(createAndRender);
}

function createAndRender() {
    create();
    render();
}

function create() {
    var points = poisson(bbox, params.density);
    diagram = new Diagram(points, bbox);
}

function render() {
    background(bgColor.toHexString());

    strokeWeight(2);
    stroke(primaryColor.toHexString());
    for (var edge of diagram.edges) {
        line(edge.v0.x, edge.v0.y, edge.v1.x, edge.v1.y);
    }
}