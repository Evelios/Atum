import Vector from "./geometry/Vector";
import Shape from "./geometry/Shape";
import Line from "./geometry/Line";
import Polygon from "./geometry/Polygon";
import Rectangle from "./geometry/Rectangle";
import Triangle from "./geometry/Triangle";
import Center from "./diagram/Center";
import Corner from "./diagram/Corner";
import Edge from "./diagram/Edge";
import Diagram from "./diagram/Diagram";
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
    Diagram: {
        Center,
        Corner,
        Edge,
        Diagram
    },
    Utility: {
        PointDistribution,
        Redist,
        Rand
    }
};

export default Atum;