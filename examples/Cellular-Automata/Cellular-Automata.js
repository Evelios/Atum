// To Do:
// Create parameter values specific to the different CA functions
// tail for GOL
// age of tile?
// what parameters are there for Bacteria Growth?

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
        "Game Of Life": {
            init: initGameOfLife,
            clear: clearGameOfLife,
            rules: gameOfLifeRules,
            draw: drawGameOfLife
        },
        "Bacteria Growth": {
            init: initBacteriaGrowth,
            clear: clearBacteriaGrowth,
            rules: bacteriaGrowthRules,
            draw: drawBacteriaGrowth
        }
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
    pointDensity: 40,
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
    gui.add(params, "pointDensity", 10, 100).name("Point Density").step(5).onChange(createAndRender);
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
        params.automataRules[params.automataChoice].draw();
    }
}

//---- Iterate the Cellular Automata
function step() {
    graph.iterate(params.automataRules[params.automataChoice].rules);
}

//---- Clear the Graph ----
function clear() {
    graph.initialize(params.automataRules[params.automataChoice].clear);
}

//---- Create and Initilize the Graph ----
function createAndRender() {
    // Create
    var bbox = new Rectangle(Vector.zero(), width, height);
    var points = params.pointFunctions[params.pointDistribution](bbox, params.pointDensity);
    graph = new Map(points, bbox);

    clear();
    graph.initialize(params.automataRules[params.automataChoice].init);

    // Render
    background("#303030");
    params.automataRules[params.automataChoice].draw();

}

//---- Creation Functions ----

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

function clearGameOfLife() {
    return {
        alive: false,
        trail1: false,
        trail2: false,
        isOld: false
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
    var density = 0.025;

    if (Rand.chance(density)) {
        return {
            colony: Rand.randInt(0, 3)
        };
    } else {
        return {
            colony: -1
        };
    }
}

function clearBacteriaGrowth() {
    return {
        colony: -1
    };
}

function bacteriaGrowthRules(center) {
    var allies = [];
    if (center.data.colony !== -1) {
        allies = center.neighbors.filter(
            el => el.data.colony === center.data.colony
        );
    }

    const competitors = center.neighbors.filter(
        neighbor => neighbor.data.colony >= 0 &&
        neighbor.data.colony !== center.data.colony
    );

    if (competitors.length !== 0 &&
        (Rand.chance(0.1) || competitors.length > allies.length)) {

        const victor = competitors[Rand.randInt(0, competitors.length - 1)];
        return {
            colony: victor.data.colony,
        };
    }

    return {};
}

function drawBacteriaGrowth() {

    noStroke();
    for (var center of graph.centers) {

        if (center.data.colony === 0) {
            fill("#AA7539");
        } else if (center.data.colony === 1) {
            fill("#A23645");
        } else if (center.data.colony === 2) {
            fill("#27566B");
        } else if (center.data.colony === 3) {
            fill("#479030");
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