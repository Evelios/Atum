"use strict";

// Atum Library Variables
var poisson = Atum.Utility.PointDistribution.poisson;
var hexagon = Atum.Utility.PointDistribution.hexagon;
var Rectangle = Atum.Geometry.Rectangle;
var Vector = Atum.Geometry.Vector;
var Diagram = Atum.Graph.Diagram;
var Rand = Atum.Utility.Rand;

// Global Variables
var width;
var height;
var diagram;

// Colors
var bgColor = tinycolor("#303030");
var accentColor = tinycolor("#393939");
var c1Color = tinycolor("#AA7539");
var c2Color = tinycolor("#A23645");
var c3Color = tinycolor("#27566B");
var c4Color = tinycolor("#479030");

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
        "Preditor Prey": {
            init: initPreditorPrey,
            clear: clearPreditorPrey,
            rules: preditorPreyRules,
            draw: drawPreditorPrey,
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
        "Preditor Prey",
        "Bacteria Growth"
    ],
    automataChoice: "Game Of Life",
    initChoice: "Random",
    pointFunctions: {
        "Hexagon": hexagon,
        "Poisson": poisson
    },
    distributionOptions: [
        "Hexagon",
        "Poisson"
    ],
    pointDistribution: "Poisson",
    pointDensity: 40,
    fps: 5
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
    gui.add(params, "clear").name("Clear").onChange(clearAndRender);
    gui.add(params, "step").name("Step");
    playGui = gui.add(params, "playFunction").name("Pause");

    // Creation Parameters
    gui.add(params, "initChoice", params.initOptions).name("Initilize Function").onChange(createAndRender);
    gui.add(params, "automataChoice", params.automataOptions).name("Automata Rule").onChange(createAndRender);
    // point distribution choice
    gui.add(params, "pointDistribution", params.distributionOptions).name("Point Distribution").onChange(createAndRender);
    gui.add(params, "pointDensity", 25, 50).name("Point Density").step(5).onChange(createAndRender);
    gui.add(params, "fps", 1, 20).name("Frames Per Sec").step(1).onChange(setFrameRate);
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

//---- Iterate the Cellular Automata
function step() {
    diagram.iterate(params.automataRules[params.automataChoice].rules);
    params.automataRules[params.automataChoice].draw();
}

//---- Clear the Graph ----
function clearAndRender() {
    diagram.initialize(params.automataRules[params.automataChoice].clear);
    render();
}

//---- Create and Initilize the Graph ----
function createAndRender() {
    // Create
    var bbox = new Rectangle(Vector.zero(), width, height);
    var points = params.pointFunctions[params.pointDistribution](bbox, params.pointDensity);
    diagram = new Diagram(points, bbox);

    clear();
    diagram.initialize(params.automataRules[params.automataChoice].init);

    render();
}

function render() {
    background("#303030");
    params.automataRules[params.automataChoice].draw();
}

function clear() {
    for (var center of diagram.centers) {
        center.data.alive = false;
        center.data.trail1 = false;
        center.data.trail2 = false;
        center.data.isOld = false;
        center.data.colony = false;
    }
}

//---- Creation Functions ----

function isRandomAlive(center) {
    // Change this density to a parameter
    var density = 0.6;
    return Rand.rand() < density;
}

//---- Game Of Life Module ----------------------------------------------------

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
    var n = center.neighbors.map(el => el.data.alive).reduce((n, val) => n + val, 0);

    return {
        trail2: center.data.trail1 && !center.data.trail2,
        trail1: center.data.alive && !center.data.trail1,
        isOld: center.data.alive,
        alive: center.data.alive && (n === 2 || n === 3) ||
            !center.data.alive && n === 3
    };
}

function drawGameOfLife() {

    strokeWeight(2);
    stroke(accentColor.toHexString());
    for (var center of diagram.centers) {
        if (center.data.alive) {
            fill(c1Color.toHexString());
        } else if (center.data.trail1) {
            fill(tinycolor.mix(c1Color, bgColor, 50).toHexString());
        } else if (center.data.trail2) {
            fill(tinycolor.mix(c1Color, bgColor, 80).toHexString());
        } else {
            fill(bgColor.toHexString());
        }

        polygon(center);
    }
}

// ---- Preditor Prey Module --------------------------------------------------
// Cell type:
//  0 is a dead cell
//  1 is a prey cell
//  2 is a preditor cell

function initPreditorPrey() {
    if (Rand.chance(0.25)) {
        return {
            type: Rand.chance(0.5) ? 1 : 2
        };
    }
    return {
        type: 0
    };
}

function clearPreditorPrey() {
    return { 
        type: 0,
        age: 0,
    };
}

function preditorPreyRules(center) {
    if (Rand.chance(0.1)) { // Random Chance To Die
        return { type: 0, age: 10 };
    }

    var hasPreyNeighbor = center.neighbors.reduce(
        (p, c) => p || c.data.type === 1, false);
    var hasPreditorNeighbor = center.neighbors.reduce(
        (p, c) => p || c.data.type === 2, false);

    if (center.data.type === 0) { // Empty
        if (hasPreyNeighbor && !hasPreditorNeighbor) {
            return { type: 1 }; // Become Prey
        } else {
            return { age: center.data.age + 1 };
        }
    } else if (center.data.type === 1) { // Prey
        if(hasPreditorNeighbor) {
            return { type: 2 }; // Become Preditor
        }
    } else if (center.data.type === 2) { // Preditor
        if (!hasPreyNeighbor) {
            return { type: 0, age: 1 }; // Preditor Die
        }
    }
    return {};
}

function drawPreditorPrey() {
    strokeWeight(2);
    for (var center of diagram.centers) {
        var color;
        if (center.data.type === 1) {
            color = c4Color;
        } else if (center.data.type === 2) {
            color = c2Color;
        } else { 
            var mixAmount = center.data.age * 40;
            if (mixAmount > 100) { mixAmount = 100; }
            color = tinycolor.mix(c2Color, bgColor, mixAmount);
        }
        fill(color.toHexString());
        stroke(accentColor.toHexString());
        polygon(center);
    }
}

//---- Bacterial Growth Module ------------------------------------------------

function initBacteriaGrowth() {
    var density = 0.025;

    if (Rand.chance(density)) {
        return {
            colony: Rand.randInt(0, 3),
            age: 0
        };
    } else {
        return {
            age: 0,
            colony: -1
        };
    }
}

function clearBacteriaGrowth() {
    return {
        colony: -1,
        age: 0
    };
}

function bacteriaGrowthRules(center) {
    // If tile is old then spawn a new bacteria
    if (center.data.age > 5 && Rand.chance(0.01)) {
        return {
            colony: Rand.randInt(0, 3),
            age: 0
        }
    }

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

    const compAges = competitors.map(x => x.data.age);
    let compAveAge = 0;
    if (compAges.length > 0) {
        compAveAge = compAges.reduce((p, c) => p + c, 0) / competitors.length;
    }

    if (competitors.length !== 0 &&
        (compAveAge + 5 < center.data.age ||
         competitors.length > allies.length ||
         Rand.chance(0.01))) {

        const victor = competitors[Rand.randInt(0, competitors.length - 1)];
        return {
            colony: victor.data.colony,
            age: center.data.colony === victor.data.colony ? center.data.age + 1: 0
        };
    }

    return { age: center.data.age + 1 };
}

function drawBacteriaGrowth() {

    strokeWeight(2);
    stroke(accentColor.toHexString());
    for (var center of diagram.centers) {
        var color;
        if (center.data.colony === 0) {
            color = c1Color;
        } else if (center.data.colony === 1) {
            color = c2Color;
        } else if (center.data.colony === 2) {
            color = c3Color;
        } else if (center.data.colony === 3) {
            color = c4Color;
        } else {
            color = bgColor;
        }
        var mixAmount = center.data.age * 10 < 100 ? center.data.age * 10 : 100;
        color = tinycolor.mix(color, bgColor, mixAmount);
        fill(color.toHexString());
        polygon(center);
    }
}

//---- Helper Functions ----

// Draw polygon from triangles
function polygon(tile) {
    beginShape();
    for (var corner of tile.corners) {
        vertex(corner.x, corner.y);
    }
    endShape();
}