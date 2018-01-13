// Geometry
import Vector from "./geometry/Vector";
import Line from "./geometry/Line";
import Polygon from "./geometry/Polygon";
import Rectangle from "./geometry/Rectangle";
import Triangle from "./geometry/Triangle";

// Graph
import Center from "./graph/Center";
import Corner from "./graph/Corner";
import Edge from "./graph/Edge";
import Graph from "./graph/Graph";
import Diagram from "./graph/Diagram";

// Utilities
import * as PointDistribution from "./Utilities/PointDistribution";
import * as Redist from "./utilities/Redist";
import Rand from "./utilities/Rand";
import * as Helpers from "./utilities/Util";

// Algorithms
import binarySpacePartition from "./algorithms/BinarySpacePartition";
import recursiveVoronoi from "./algorithms/RecursiveVoronoi";

/**
 * The Atum procedural graph based library
 * 
 * @export
 * @module Atum
 * @see {@link https://github.com/Evelios/Atum}
 */
const Atum = {
    Geometry: {
        Vector,
        Line,
        Polygon,
        Rectangle,
        Triangle
    },
    Graph: {
        Center,
        Corner,
        Edge,
        Graph,
        Diagram
    },
    Utility: {
        PointDistribution,
        Redist,
        Rand,
        Helpers
    },
    Algorithm: {
        binarySpacePartition,
        recursiveVoronoi
    }
};

export default Atum;