import Vector from "./geometry/Vector";
import Line from "./geometry/Line";
import Polygon from "./geometry/Polygon";
import Rectangle from "./geometry/Rectangle";
import Triangle from "./geometry/Triangle";
import Center from "./graph/Center";
import Corner from "./graph/Corner";
import Edge from "./graph/Edge";
import Graph from "./graph/Graph";
import Diagram from "./graph/Diagram";
import * as PointDistribution from "./Utilities/PointDistribution";
import * as Redist from "./utilities/Redist";
import Rand from "./utilities/Rand";

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
        Rand
    }
};

export default Atum;