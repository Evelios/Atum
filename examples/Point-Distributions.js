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
var delaunayColor;

var width;
var height;
var graph;

var params = {
    // Parameters
    pointFunctions: {
        "Square": PointDistribution.square,
        "Hexagon": PointDistribution.hexagon,
        "Random": PointDistribution.random,
        "Poisson": PointDistribution.poisson
    },
    distributionOptions: [
        "Square",
        "Hexagon",
        "Random",
        "Poisson"
    ],
    pointDistribution: "Random",
    density: 50,
    relaxations: 0,

    // Rendering
    centers: true,
    corners: true,
    voronoi: true,
    delaunay: false,
};

//---- Main Setup Function ----
function setup() {

    Rand.setSeed(0);

    width = document.body.clientWidth || window.innerWidth;
    height = document.body.clientHeight || window.innerHeight;

    bgColor = color("#303030");
    bgAccent = color("#393939");
    centerColor = color("#AA7539");
    delaunayColor = color("#A23645");
    cornerColor = color("#479030");
    voronoiColor = color("#27566B");

    setUpGui();

    createCanvas(width, height);

    createAndRender();
}

//---- Main Draw Function ----

function draw() {

}

//---- Secondary Setup Functions ----

function setUpGui() {
    var gui = new dat.GUI();

    var paramsFolder = gui.addFolder("Parameters");

    paramsFolder.add(params, "pointDistribution", params.distributionOptions).name("Point Distribution").onChange(createAndRender);
    paramsFolder.add(params, "density", 25, 100).step(5).name("Point Density").onChange(createAndRender);
    paramsFolder.add(params, "relaxations", 0, 10).name("Lloyd Relaxations").onChange(createAndRender);

    var renderFolder = gui.addFolder("Rendering");

    renderFolder.add(params, "centers").name("Centers").onChange(createAndRender);
    renderFolder.add(params, "corners").name("Corners").onChange(createAndRender);
    renderFolder.add(params, "voronoi").name("Voronoi").onChange(createAndRender);
    renderFolder.add(params, "delaunay").name("Delauanay").onChange(createAndRender);
}

//---- Other Functions

function createAndRender() {
    createGraph();
    drawGrid(50);
    drawGraph();
}

function createGraph() {
    var bbox = new Rectangle(Vector.zero(), width, height);
    var pointFunction = params.pointFunctions[params.pointDistribution];
    console.log(pointFunction)
    var points = pointFunction(bbox, params.density);
    graph = new Diagram(points, bbox, params.relaxations);
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
    if (params.voronoi || params.delaunay) {
        for (var edge of graph.edges) {
            if (params.voronoi) {
                stroke(voronoiColor);
                line(edge.v0.x, edge.v0.y, edge.v1.x, edge.v1.y);
            }
            if (params.delaunay && edge.d0 && edge.d1) {
                stroke(delaunayColor);
                line(edge.d0.x, edge.d0.y, edge.d1.x, edge.d1.y);
            }
        }
    }

    noStroke();
    if (params.corners) {
        fill(cornerColor);
        for (var corner of graph.corners) {
            ellipse(corner.x, corner.y, 6);
        }
    }

    if (params.centers) {
        fill(centerColor);
        for (var center of graph.centers) {
            ellipse(center.x, center.y, 6);
        }
    }
}