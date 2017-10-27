import Vector from "./geometry/Vector";
import Shape from "./geometry/Shape";
import Line from "./geometry/Line";
import Polygon from "./geometry/Polygon";
import Rectangle from "./geometry/Rectangle";
import Triangle from "./geometry/Triangle";
import Center from "./graph/Center";
import Corner from "./graph/Corner";
import Edge from "./graph/Edge";
import Diagram from "./graph/Diagram";
import Map from "./graph/Map";
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
        Shape,
        Line,
        Polygon,
        Rectangle,
        Triangle
    },
    Graph: {
        Center,
        Corner,
        Edge,
        Diagram,
        Map
    },
    Utility: {
        PointDistribution,
        Redist,
        Rand
    }
};

export default Atum;