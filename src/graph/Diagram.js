import Vector from "../geometry/Vector";
import Center from "./Center";
import Corner from "./Corner";
import Edge from "./Edge";
import { has } from "../utilities/Util";
import Voronoi from "Voronoi";

"use strict";

// Need to ES6ify
class Diagram {
    /**
     * The Diagram class is an extenstion of the voronoi Diagram. It turns the
     * diagram into a more useable format where centers, edges, and corners are
     * better connected. This allows for many different types of traversal over
     * the graph. This class uses the rhill-voronoi library for building the
     * voronoi graph. This is termed a PAN connected graph. This class can also be
     * relaxed more by using lloyd relaxation which reruns the graph simulation
     * process with a less packed point set to gradually create a more "blue" noise
     * effect.
     *
     * @summary Creates a voronoi diagram of a given point set that is created
     *  inside a partiuclar bounding box. The set of points can also be relaxed
     *  creating a more "blue" noise effect using loyd relaxation.
     * 
     * @property {Rectangle} bbox The input bounding box
     * @property {Center[]} centers All the center objects of the diagram
     * @property {Corner[]} corners All the corner objects of the diagram
     * @property {Edges[]} edges All the edge objects of the diagram
     * 
     * @param {Vector[]} points The vector location to create the voronoi diagram with
     * @param {Rectangle} bbox The bounding box for the creation of the voronoi diagram
     * @param {integer} [relaxations=0] The number of lloyd relaxations to do.
     *  This turns a noisy diagram into a more uniform diagram iteration by iteration.
     *  This helps to improve the spacing between points in the diagram.
     * @param {bool} [improveCorners=false] This improves uniformity among the
     *  corners by setting them to the average of their neighbors. This breaks
     *  the voronoi properties of the diagram.
     * 
     * @memberOf Diagram
     */
    constructor(points, bbox, relaxations = 0, improveCorners = false) {
        this.bbox = bbox;
        this._rhillbbox = {
            xl: this.bbox.x,
            xr: this.bbox.x + this.bbox.width,
            yt: this.bbox.y,
            yb: this.bbox.y + this.bbox.height
        };

        // Compute Voronoi from initial points
        const rhillVoronoi = new Voronoi();
        this._voronoi = rhillVoronoi.compute(points, this._rhillbbox);

        // Lloyds Relaxations
        while (relaxations--) {
            const sites = this.relaxSites(this._voronoi);
            rhillVoronoi.recycle(this._voronoi);
            this._voronoi = rhillVoronoi.compute(sites, this._rhillbbox);
        }

        this.convertDiagram(this._voronoi);

        if (improveCorners) {
            this.improveCorners();
        }
        this.sortCorners();

    }

    relaxSites(voronoi) {
        const cells = voronoi.cells;
        let iCell = cells.length;
        let cell;
        let site;
        const sites = [];

        while (iCell--) {
            cell = cells[iCell];
            site = this.cellCentroid(cell);
            sites.push(new Vector(site.x, site.y));
        }
        return sites;
    }

    cellArea(cell) {
        let area = 0;
        const halfedges = cell.halfedges;
        let iHalfedge = halfedges.length;
        let halfedge, p1, p2;
        while (iHalfedge--) {
            halfedge = halfedges[iHalfedge];
            p1 = halfedge.getStartpoint();
            p2 = halfedge.getEndpoint();
            area += p1.x * p2.y;
            area -= p1.y * p2.x;
        }
        area /= 2;
        return area;
    }

    cellCentroid(cell) {
        let x = 0,
            y = 0;
        const halfedges = cell.halfedges;
        let iHalfedge = halfedges.length;
        let halfedge;
        let v, p1, p2;

        while (iHalfedge--) {
            halfedge = halfedges[iHalfedge];

            p1 = halfedge.getStartpoint();
            p2 = halfedge.getEndpoint();

            v = p1.x * p2.y - p2.x * p1.y;

            x += (p1.x + p2.x) * v;
            y += (p1.y + p2.y) * v;
        }

        v = this.cellArea(cell) * 6;

        return { x: x / v, y: y / v };
    }

    convertDiagram(voronoi) {
        const centerLookup = {};
        const cornerLookup = {};
        this.centers = [];
        this.corners = [];
        this.edges = [];

        let cornerId = 0;
        let edgeId = 0;

        // Copy over all the center nodes
        for (const cell of voronoi.cells) {
            const site = cell.site;
            const pos = new Vector(site.x, site.y);
            const center = new Center(pos);
            center.id = site.voronoiId;
            centerLookup[pos.key()] = center;
            this.centers.push(center);
        }

        // Create and copy over the edges and corners
        // This portion also creates the connections between all the nodes
        for (let edge of voronoi.edges) {

            // Convert voronoi edge to a useable form
            // Corner positions
            const va = new Vector(Math.round(edge.va.x), Math.round(edge.va.y));
            const vb = new Vector(Math.round(edge.vb.x), Math.round(edge.vb.y));
            // Center positions
            const site1 = new Vector(edge.lSite.x, edge.lSite.y);
            const site2 = edge.rSite ? new Vector(edge.rSite.x, edge.rSite.y) : null;

            // Lookup the two center objects
            const center1 = centerLookup[site1.key()];
            const center2 = site2 ? centerLookup[site2.key()] : null;

            // Lookup the corner objects and if one isn't created
            // create one and add it to corners set
            let corner1;
            let corner2;

            const isBorder = (point, bbox) => point.x <= bbox.xl || point.x >= bbox.xr ||
                point.y <= bbox.yt || point.y >= bbox.yb;

            if (!has(cornerLookup, va.key())) {
                corner1 = new Corner(va);
                corner1.id = cornerId++;
                corner1.border = isBorder(va, this.bbox);
                cornerLookup[va.key()] = corner1;
                this.corners.push(corner1);
            } else {
                corner1 = cornerLookup[va.key()];
            }
            if (!has(cornerLookup, vb.key())) {
                corner2 = new Corner(vb);
                corner2.id = cornerId++;
                corner2.border = isBorder(vb, this.bbox);
                cornerLookup[vb.key()] = corner2;
                this.corners.push(corner2);
            } else {
                corner2 = cornerLookup[vb.key()];
            }

            // Update the edge objects
            const newEdge = new Edge();
            newEdge.id = edgeId++;
            newEdge.d0 = center1;
            newEdge.d1 = center2;
            newEdge.v0 = corner1;
            newEdge.v1 = corner2;
            newEdge.midpoint = Vector.midpoint(corner1, corner2);

            // Update the corner objects
            corner1.protrudes.push(newEdge);
            corner2.protrudes.push(newEdge);

            if (!corner1.touches.includes(center1)) {
                corner1.touches.push(center1);
            }
            if (center2 && !corner1.touches.includes(center2)) {
                corner1.touches.push(center2);
            }
            if (!corner2.touches.includes(center1)) {
                corner2.touches.push(center1);
            }
            if (center2 && !corner2.touches.includes(center2)) {
                corner2.touches.push(center2);
            }

            corner1.adjacent.push(corner2);
            corner2.adjacent.push(corner1);

            // Update the center objects
            center1.borders.push(newEdge);
            if (center2) {
                center2.borders.push(newEdge);
            }

            if (!center1.corners.includes(corner1)) {
                center1.corners.push(corner1);
            }
            if (!center1.corners.includes(corner2)) {
                center1.corners.push(corner2);
            }
            if (center2 && !center2.corners.includes(corner1)) {
                center2.corners.push(corner1);
            }
            if (center2 && !center2.corners.includes(corner2)) {
                center2.corners.push(corner2);
            }

            if (center2) {
                center1.neighbors.push(center2);
                center2.neighbors.push(center1);
            }

            // If either corner is a border, both centers are borders
            center1.border = center1.border || corner1.border || corner2.border;
            if (center2) {
                center2.border = center2.border || corner1.border || corner2.border;
            }

            this.edges.push(newEdge);
        }
    }

    //------------------------------------------------------------------------------
    // Helper function to create diagram
    //
    // Lloyd relaxation helped to create uniformity among polygon corners,
    // This function creates uniformity among polygon corners by setting the corners
    // to the average of their neighbors
    // This breakes the voronoi diagram properties
    improveCorners() {
        const newCorners = [];

        // Calculate new corner positions
        for (let i = 0; i < this.corners.length; i++) {
            let corner = this.corners[i];

            if (corner.border) {
                newCorners[i] = corner;
            } else {
                let newPos = Vector.zero();

                for (const neighbor of corner.touches) {
                    newPos = Vector.add(newPos, neighbor);
                }

                newPos = newPos.divide(corner.touches.length);
                newCorners[i] = newPos;
            }
        }

        // Assign new corner positions
        for (let i = 0; i < this.corners.length; i++) {
            let corner = this.corners[i];
            corner = newCorners[i];
        }

        // Recompute edge midpoints
        for (const edge of this.edges) {
            if (edge.v0 && edge.v1) {
                edge.midpoint = Vector.midpoint(edge.v0, edge.v1);
            }
        }
    }

    //------------------------------------------------------------------------------
    // Sorts the corners in clockwise order so that they can be printed properly
    // using a standard polygon drawing method

    sortCorners() {
        for (const center of this.centers) {
            const comp = this.comparePolyPoints(center);
            center.corners.sort(comp);
        }
    }

    //------------------------------------------------------------------------------
    // Comparison function for sorting polygon points in clockwise order
    // assuming a convex polygon
    // http://stackoverflow.com/questions/6989100/sort-points-in-clockwise-order
    comparePolyPoints(c) {
        const center = c;
        return (p1, p2) => {
            const a = p1,
                b = p2;

            if (a.x - center.x >= 0 && b.x - center.x < 0) {
                return -1;
            }
            if (a.x - center.x < 0 && b.x - center.x >= 0) {
                return 1;
            }
            if (a.x - center.x === 0 && b.x - center.x === 0) {
                if (a.y - center.y >= 0 || b.y - center.y >= 0) {
                    if (a.y > b.y) {
                        return -1;
                    } else {
                        return 1;
                    }
                }
                if (b.y > a.y) {
                    return -1;
                } else {
                    return 1;
                }
            }

            // compute the cross product of vectors (center -> a) x (center -> b)
            const det = (a.x - center.x) * (b.y - center.y) - (b.x - center.x) * (a.y - center.y);
            if (det < 0) {
                return -1;
            }
            if (det > 0) {
                return 1;
            }

            // points a and b are on the same line from the center
            // check which point is closer to the center
            const d1 = (a.x - center.x) * (a.x - center.x) + (a.y - center.y) * (a.y - center.y);
            const d2 = (b.x - center.x) * (b.x - center.x) + (b.y - center.y) * (b.y - center.y);
            if (d1 > d2) {
                return -1;
            } else {
                return 1;
            }

        };
    }

}

export default Diagram;