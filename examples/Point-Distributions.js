"use strict";

var PointDistribution = Atum.Utility.PointDistribution;
var Rectangle = Atum.Geometry.Rectangle;
var Vector = Atum.Geometry.Vector;
var Diagram = Atum.Graph.Diagram;
var Rand = Atum.Utility.Rand;

var bgColor;
var bgAccent;
var centerColor;
var voronoiColor;
var cornerColor;
var delauanyColor;


var width;
var height;
var graph;


function setup() {
    Rand.setSeed(0);
    width = document.body.clientWidth || window.innerWidth;
    height = document.body.clientHeight || window.innerHeight;

    bgColor = color("#303030");
    bgAccent = color("#393939");
    centerColor = color("#AA7539");
    delauanyColor = color("#A23645");
    cornerColor = color("#479030");
    voronoiColor = color("#27566B");

    createCanvas(width, height);

    createGraph();

    drawGrid(50);
    drawGraph();
}

function draw() {

}

function createGraph() {
    var bbox = new Rectangle(Vector.zero(), width, height);
    var points = PointDistribution.random(bbox, 50);
    graph = new Diagram(points, bbox, 2);
}

function drawGrid(d) {
    background(bgColor);
    stroke(bgAccent);
    for (var y = d; y < height; y += d) {
        line(0, y, width, y);
    }
    for (var x = d; x < width; x += d) {
        line(x, 0, x, height);
    }
}

function drawGraph() {
    for (var edge of graph.edges) {
        stroke(voronoiColor);
        // line(edge.v0.x, edge.v0.y, edge.v1.x, edge.v1.y);
        if (edge.d0 && edge.d1) {
            stroke(delauanyColor);
            line(edge.d0.x, edge.d0.y, edge.d1.x, edge.d1.y);
        }
    }

    noStroke();
    fill(cornerColor);
    for (var corner of graph.corners) {
        ellipse(corner.x, corner.y, 6);
    }

    fill(centerColor);
    for (var center of graph.centers) {
        ellipse(center.x, center.y, 6);
    }
}