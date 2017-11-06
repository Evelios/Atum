// To Do:
// Break into GOL / Bacteria Modules for Gui and Calling Code
// For Type Selection Have
// initFn, rulesetFn, drawingFn
// This can all be stored in the same object
// This should then be good to push

"use strict";

// Atum Library Variables
var poisson = Atum.Utility.PointDistribution.poisson;
var square = Atum.Utility.PointDistribution.square;
var Rectangle = Atum.Geometry.Rectangle;
var Vector = Atum.Geometry.Vector;
var Map = Atum.Graph.Map;
var Rand = Atum.Utility.Rand;

// Global Variables
var width;
var height;
var graph;

var pointDensity = 40;

// Dat Gui Parameters
var playGui;
var params = {
    random: createAndRender,
    clear: clear,
    step: step,
    play: true,
    playFunction: playPause,
    initFunctions: {
        "Random": isRandomAlive
    },
    initOptions: [
        "Random"
    ],
    automataRules: {
        "Game Of Life": gameOfLifeRules,
        "Bacteria Growth": bacteriaGrowthRules
    },
    automataOptions: [
        "Game Of Life",
        "Bacteria Growth"
    ],
    automataChoice: "Game Of Life",
    initChoice: "Random",
    pointFunctions: {
        "Square": square,
        "Poisson": poisson
    },
    distributionOptions: [
        "Square",
        "Poisson"
    ],
    pointDistribution: "Poisson",
    fps: 2,
    isOld: false,
    tail1: true,
    tail2: true,
};

//---- Main Set Up Function ----

function setup() {
    Rand.setSeed(10);

    width = document.body.clientWidth || window.innerWidth;
    height = document.body.clientHeight || window.innerHeight;

    createCanvas(width, height);
    frameRate(params.fps);

    setUpGui();

    createAndRender();
}

//---- Other Setup Functions

function setUpGui() {
    var gui = new dat.GUI();

    // Function Calls
    gui.add(params, "random").name("Randomize");
    gui.add(params, "clear").name("Clear").onChange(draw);
    gui.add(params, "step").name("Step");
    playGui = gui.add(params, "playFunction").name("Pause");

    // Creation Parameters
    gui.add(params, "initChoice", params.initOptions).name("Initilize Function").onChange(createAndRender);
    gui.add(params, "automataChoice", params.automataOptions).name("Automata Rule").onChange(createAndRender);
    // point distribution choice
    gui.add(params, "pointDistribution", params.distributionOptions).name("Point Distribution").onChange(createAndRender);
    gui.add(params, "fps", 1, 10).name("Frames Per Sec").step(1).onChange(setFrameRate);

    // Rendering Choices
    gui.add(params, "isOld").name("Highlight New").onChange(draw);
    gui.add(params, "tail1").name("Draw Tail 1").onChange(draw);
    gui.add(params, "tail2").name("Draw Tail 2").onChange(draw);
}

//---- Dat Gui Helper Functions ----
function setFrameRate() {
    frameRate(params.fps);
}

function playPause() {
    params.play = !params.play;
    if (params.play) {
        playGui.name("Pause");
    } else {
        playGui.name("Play");
    }
}

//---- The Main Draw Function ----

function draw() {
    if (params.play) {
        step();
    }
}

function step() {
    graph.iterate(gameOfLifeRules);
    drawGameOfLife();
}

//---- Create and Initilize the Graph ----
function createAndRender() {
    // Create
    var bbox = new Rectangle(Vector.zero(), width, height);
    var points = params.pointFunctions[params.pointDistribution](bbox, pointDensity);
    graph = new Map(points, bbox);

    clear();
    graph.initialize(initGameOfLife);

    // Render
    background("#303030");
    if (params.automataChoice === "Game Of Life") {
        drawGameOfLife();
    } else if (params.automataChoice === "Bacteria Growth") {
        drawBacteriaGrowth();
    }

}

function clear() {
    for (var center of graph.centers) {
        center.data.alive = false;
        center.data.trail1 = false;
        center.data.trail2 = false;
        center.data.isOld = false;
        center.data.colony = false;
    }
}

//---- Creation Functions

function isRandomAlive(center) {
    // Change this density to a parameter
    var density = 0.4;
    return Rand.rand() < density;
}

//---- Game Of Life Module ----

function initGameOfLife(center) {
    return {
        alive: params.initFunctions[params.initChoice](center)
    };
}

function gameOfLifeRules(center) {

    // Get the number of neighbors
    var n = center.neighbors.map(el => el.data.alive).reduce((n, val) => n + val);

    return {
        trail2: center.data.trail1 && !center.data.trail2,
        trail1: center.data.alive && !center.data.trail1,
        isOld: center.data.alive,
        alive: center.data.alive && (n === 2 || n === 3) ||
            !center.data.alive && n === 3
    };
}

function drawGameOfLife() {

    noStroke();
    for (var center of graph.centers) {
        if (center.data.alive) {
            if (!center.data.isOld && params.isOld) {
                fill("#D4A26A");
            } else {
                fill("#AA7539");
            }
        } else if (center.data.trail1 && params.tail1) {
            fill("#6D5335");
        } else if (center.data.trail2 && params.tail2) {
            fill("#4F4132");
        } else {
            fill("#303030");
        }

        polygon(center);
    }

    stroke("#393939");
    strokeWeight(2);
    for (var edge of graph.edges) {
        line(edge.v0.x, edge.v0.y, edge.v1.x, edge.v1.y);
    }
    strokeWeight(1);
}

//---- Bacterial Growth Module ----

function initBacteriaGrowth() {
    return {

    };
}

function bacteriaGrowthRules(center) {

    return {

    };
}

function drawBacteriaGrowth() {

    noStroke();
    for (var center of graph.centers) {

        fill("#303030");
        polygon(center);
    }

    stroke("#393939");
    strokeWeight(2);
    for (var edge of graph.edges) {
        line(edge.v0.x, edge.v0.y, edge.v1.x, edge.v1.y);
    }
    strokeWeight(1);
}

//---- Helper Functions ----

// Draw polygon from triangles
function polygon(center) {
    // noSmooth();
    var corners = center.corners;
    for (var i = 0; i < corners.length; i++) {
        var c1 = corners[i];
        var c2 = corners[(i + 1) % corners.length];
        triangle(c1.x, c1.y, c2.x, c2.y, center.x, center.y);
    }
    // smooth();
}