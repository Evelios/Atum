const Atum = require('../build/Atum').default;
const PointDistribution = Atum.Utility.PointDistribution;
const Vector = Atum.Geometry.Vector;
const Rectangle = Atum.Geometry.Rectangle;

const bbox = new Rectangle(Vector.zero(), 800, 1000);
const rand = PointDistribution.random(bbox, 100);