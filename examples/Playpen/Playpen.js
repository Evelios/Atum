"use strict";

// Atum Globals
var PointDistribution = Atum.Utility.PointDistribution;
var Rectangle = Atum.Geometry.Rectangle;
var Vector = Atum.Geometry.Vector;
var Diagram = Atum.Graph.Diagram;
var Rand = Atum.Utility.Rand;

// Colors
var bgColor;
var bgAccent;
var centerColor;
var voronoiColor;
var cornerColor;
var delaunayColor;
var centroidColor;

var width;
var height;
var diagram;

// Play Variables
var hoverTile;
var selectedTile;
var selectedTile2;
var tilePath = [];

var params = {
    // Parameters
    pointFunctions: {
        "Square": PointDistribution.square,
        "Hexagon": PointDistribution.hexagon,
        "Random": PointDistribution.random,
        "Jittered Grid": PointDistribution.jitteredGrid,
        "Poisson": PointDistribution.poisson
    },
    distributionOptions: [
        "Square",
        "Hexagon",
        "Random",
        "Jittered Grid",
        "Poisson"
    ],
    pointDistribution: "Poisson",
    seed: 0,
    density: 50,
    relaxations: 0,
    improvedCorners: false,

    // Rendering
    centers: false,
    corners: false,
    voronoi: true,
    delaunay: false,
    centroids: false
};

//---- Main Setup Function ----

function setup() {
    width = document.body.clientWidth || window.innerWidth;
    height = document.body.clientHeight || window.innerHeight;

    bgColor = color("#303030");
    bgAccent = color("#393939");
    centerColor = color("#AA7539");
    centroidColor = color("#804E16");
    delaunayColor = color("#A23645");
    cornerColor = color("#479030");
    voronoiColor = color("#27566B");

    createCanvas(width, height);

    setUpGui();

    createAndRender();
}

//---- Secondary Setup Functions ----

function setUpGui() {
    var gui = new dat.GUI();

    var paramsFolder = gui.addFolder("Parameters");

    paramsFolder.add(params, "pointDistribution", params.distributionOptions).name("Point Distribution").onChange(createAndRender);
    paramsFolder.add(params, "seed", 0, 100).name("Seed").onChange(createAndRender);
    paramsFolder.add(params, "density", 25, 100).step(5).name("Point Density").onChange(createAndRender);
    paramsFolder.add(params, "relaxations", 0, 10).step(1).name("Lloyd Relaxations").onChange(createAndRender);
    paramsFolder.add(params, "improvedCorners").name("Improve Corners").onChange(createAndRender);

    var renderFolder = gui.addFolder("Rendering");

    renderFolder.add(params, "centers").name("Centers").onChange(createAndRender);
    renderFolder.add(params, "corners").name("Corners").onChange(createAndRender);
    renderFolder.add(params, "voronoi").name("Voronoi").onChange(createAndRender);
    renderFolder.add(params, "delaunay").name("Delauanay").onChange(createAndRender);
    renderFolder.add(params, "centroids").name("Centroids").onChange(createAndRender);
}

//---- Experimental Functions

function mousePressed() {
    if (!selectedTile) {
        selectedTile = hoverTile;
    } else if (!selectedTile2) {
        selectedTile2 = hoverTile;
        tilePath = diagram.getPath(selectedTile, selectedTile2);
    } else {
        selectedTile = null;
        selectedTile2 = null;
    }
}

function draw() {
    var mousePos = new Vector(mouseX, mouseY);

    drawGrid(params.density);

    // Hover Tile
    hoverTile = diagram.getTile(mousePos);
    if (hoverTile) {
        fill(bgAccent);
        polygon(hoverTile.center);
    }

    if (selectedTile) {
        if (selectedTile2) {

            for (let tile of tilePath) {
                fill(voronoiColor);
                polygon(tile.center);    
            }

            fill(cornerColor);
            polygon(selectedTile2.center);
        }

        fill(centerColor);
        polygon(selectedTile.center);
    }

    drawGraph();
}

//---- Other Functions
function createAndRender() {
    // Create
    Rand.setSeed(params.seed);
    createGraph();

    // Render
    drawGrid(params.density);
    drawGraph();
}

function createGraph() {
    var bbox = new Rectangle(Vector.zero(), width, height);
    var pointFunction = params.pointFunctions[params.pointDistribution];
    var points = pointFunction(bbox, params.density, 25);
    diagram = new Diagram(points, bbox, params.relaxations, params.improvedCorners);
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
        for (var edge of diagram.edges) {
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
        for (var corner of diagram.corners) {
            if (params.corners) {
                ellipse(corner.x, corner.y, 6);
            }
        }
    }

    if (params.centers || params.centroids) {
        for (var center of diagram.centers) {
            if (params.centroids) {
                var centroid = center.corners.centroid();
                fill(centroidColor);
                ellipse(centroid.x, centroid.y, 6);
            }

            if (params.centers) {
                fill(centerColor);
                ellipse(center.x, center.y, 6);
            }
        }
    }
}

//---- Helper Functions ----

// Draw polygon from triangles
function polygon(center) {
    noStroke();
    var corners = center.corners;
    for (var i = 0; i < corners.length; i++) {
        var c1 = corners[i];
        var c2 = corners[(i + 1) % corners.length];
        triangle(c1.x, c1.y, c2.x, c2.y, center.x, center.y);
    }
}