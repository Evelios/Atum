(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Atum = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
Copyright (C) 2010-2013 Raymond Hill: https://github.com/gorhill/Javascript-Voronoi
MIT License: See https://github.com/gorhill/Javascript-Voronoi/LICENSE.md
*/
/*
Author: Raymond Hill (rhill@raymondhill.net)
Contributor: Jesse Morgan (morgajel@gmail.com)
File: rhill-voronoi-core.js
Version: 0.98
Date: January 21, 2013
Description: This is my personal Javascript implementation of
Steven Fortune's algorithm to compute Voronoi diagrams.

License: See https://github.com/gorhill/Javascript-Voronoi/LICENSE.md
Credits: See https://github.com/gorhill/Javascript-Voronoi/CREDITS.md
History: See https://github.com/gorhill/Javascript-Voronoi/CHANGELOG.md

## Usage:

  var sites = [{x:300,y:300}, {x:100,y:100}, {x:200,y:500}, {x:250,y:450}, {x:600,y:150}];
  // xl, xr means x left, x right
  // yt, yb means y top, y bottom
  var bbox = {xl:0, xr:800, yt:0, yb:600};
  var voronoi = new Voronoi();
  // pass an object which exhibits xl, xr, yt, yb properties. The bounding
  // box will be used to connect unbound edges, and to close open cells
  result = voronoi.compute(sites, bbox);
  // render, further analyze, etc.

Return value:
  An object with the following properties:

  result.vertices = an array of unordered, unique Voronoi.Vertex objects making
    up the Voronoi diagram.
  result.edges = an array of unordered, unique Voronoi.Edge objects making up
    the Voronoi diagram.
  result.cells = an array of Voronoi.Cell object making up the Voronoi diagram.
    A Cell object might have an empty array of halfedges, meaning no Voronoi
    cell could be computed for a particular cell.
  result.execTime = the time it took to compute the Voronoi diagram, in
    milliseconds.

Voronoi.Vertex object:
  x: The x position of the vertex.
  y: The y position of the vertex.

Voronoi.Edge object:
  lSite: the Voronoi site object at the left of this Voronoi.Edge object.
  rSite: the Voronoi site object at the right of this Voronoi.Edge object (can
    be null).
  va: an object with an 'x' and a 'y' property defining the start point
    (relative to the Voronoi site on the left) of this Voronoi.Edge object.
  vb: an object with an 'x' and a 'y' property defining the end point
    (relative to Voronoi site on the left) of this Voronoi.Edge object.

  For edges which are used to close open cells (using the supplied bounding
  box), the rSite property will be null.

Voronoi.Cell object:
  site: the Voronoi site object associated with the Voronoi cell.
  halfedges: an array of Voronoi.Halfedge objects, ordered counterclockwise,
    defining the polygon for this Voronoi cell.

Voronoi.Halfedge object:
  site: the Voronoi site object owning this Voronoi.Halfedge object.
  edge: a reference to the unique Voronoi.Edge object underlying this
    Voronoi.Halfedge object.
  getStartpoint(): a method returning an object with an 'x' and a 'y' property
    for the start point of this halfedge. Keep in mind halfedges are always
    countercockwise.
  getEndpoint(): a method returning an object with an 'x' and a 'y' property
    for the end point of this halfedge. Keep in mind halfedges are always
    countercockwise.

TODO: Identify opportunities for performance improvement.

TODO: Let the user close the Voronoi cells, do not do it automatically. Not only let
      him close the cells, but also allow him to close more than once using a different
      bounding box for the same Voronoi diagram.
*/

/*global Math */

// ---------------------------------------------------------------------------

function Voronoi() {
    this.vertices = null;
    this.edges = null;
    this.cells = null;
    this.toRecycle = null;
    this.beachsectionJunkyard = [];
    this.circleEventJunkyard = [];
    this.vertexJunkyard = [];
    this.edgeJunkyard = [];
    this.cellJunkyard = [];
    }

// ---------------------------------------------------------------------------

Voronoi.prototype.reset = function() {
    if (!this.beachline) {
        this.beachline = new this.RBTree();
        }
    // Move leftover beachsections to the beachsection junkyard.
    if (this.beachline.root) {
        var beachsection = this.beachline.getFirst(this.beachline.root);
        while (beachsection) {
            this.beachsectionJunkyard.push(beachsection); // mark for reuse
            beachsection = beachsection.rbNext;
            }
        }
    this.beachline.root = null;
    if (!this.circleEvents) {
        this.circleEvents = new this.RBTree();
        }
    this.circleEvents.root = this.firstCircleEvent = null;
    this.vertices = [];
    this.edges = [];
    this.cells = [];
    };

Voronoi.prototype.sqrt = Math.sqrt;
Voronoi.prototype.abs = Math.abs;
Voronoi.prototype.ε = Voronoi.ε = 1e-9;
Voronoi.prototype.invε = Voronoi.invε = 1.0 / Voronoi.ε;
Voronoi.prototype.equalWithEpsilon = function(a,b){return this.abs(a-b)<1e-9;};
Voronoi.prototype.greaterThanWithEpsilon = function(a,b){return a-b>1e-9;};
Voronoi.prototype.greaterThanOrEqualWithEpsilon = function(a,b){return b-a<1e-9;};
Voronoi.prototype.lessThanWithEpsilon = function(a,b){return b-a>1e-9;};
Voronoi.prototype.lessThanOrEqualWithEpsilon = function(a,b){return a-b<1e-9;};

// ---------------------------------------------------------------------------
// Red-Black tree code (based on C version of "rbtree" by Franck Bui-Huu
// https://github.com/fbuihuu/libtree/blob/master/rb.c

Voronoi.prototype.RBTree = function() {
    this.root = null;
    };

Voronoi.prototype.RBTree.prototype.rbInsertSuccessor = function(node, successor) {
    var parent;
    if (node) {
        // >>> rhill 2011-05-27: Performance: cache previous/next nodes
        successor.rbPrevious = node;
        successor.rbNext = node.rbNext;
        if (node.rbNext) {
            node.rbNext.rbPrevious = successor;
            }
        node.rbNext = successor;
        // <<<
        if (node.rbRight) {
            // in-place expansion of node.rbRight.getFirst();
            node = node.rbRight;
            while (node.rbLeft) {node = node.rbLeft;}
            node.rbLeft = successor;
            }
        else {
            node.rbRight = successor;
            }
        parent = node;
        }
    // rhill 2011-06-07: if node is null, successor must be inserted
    // to the left-most part of the tree
    else if (this.root) {
        node = this.getFirst(this.root);
        // >>> Performance: cache previous/next nodes
        successor.rbPrevious = null;
        successor.rbNext = node;
        node.rbPrevious = successor;
        // <<<
        node.rbLeft = successor;
        parent = node;
        }
    else {
        // >>> Performance: cache previous/next nodes
        successor.rbPrevious = successor.rbNext = null;
        // <<<
        this.root = successor;
        parent = null;
        }
    successor.rbLeft = successor.rbRight = null;
    successor.rbParent = parent;
    successor.rbRed = true;
    // Fixup the modified tree by recoloring nodes and performing
    // rotations (2 at most) hence the red-black tree properties are
    // preserved.
    var grandpa, uncle;
    node = successor;
    while (parent && parent.rbRed) {
        grandpa = parent.rbParent;
        if (parent === grandpa.rbLeft) {
            uncle = grandpa.rbRight;
            if (uncle && uncle.rbRed) {
                parent.rbRed = uncle.rbRed = false;
                grandpa.rbRed = true;
                node = grandpa;
                }
            else {
                if (node === parent.rbRight) {
                    this.rbRotateLeft(parent);
                    node = parent;
                    parent = node.rbParent;
                    }
                parent.rbRed = false;
                grandpa.rbRed = true;
                this.rbRotateRight(grandpa);
                }
            }
        else {
            uncle = grandpa.rbLeft;
            if (uncle && uncle.rbRed) {
                parent.rbRed = uncle.rbRed = false;
                grandpa.rbRed = true;
                node = grandpa;
                }
            else {
                if (node === parent.rbLeft) {
                    this.rbRotateRight(parent);
                    node = parent;
                    parent = node.rbParent;
                    }
                parent.rbRed = false;
                grandpa.rbRed = true;
                this.rbRotateLeft(grandpa);
                }
            }
        parent = node.rbParent;
        }
    this.root.rbRed = false;
    };

Voronoi.prototype.RBTree.prototype.rbRemoveNode = function(node) {
    // >>> rhill 2011-05-27: Performance: cache previous/next nodes
    if (node.rbNext) {
        node.rbNext.rbPrevious = node.rbPrevious;
        }
    if (node.rbPrevious) {
        node.rbPrevious.rbNext = node.rbNext;
        }
    node.rbNext = node.rbPrevious = null;
    // <<<
    var parent = node.rbParent,
        left = node.rbLeft,
        right = node.rbRight,
        next;
    if (!left) {
        next = right;
        }
    else if (!right) {
        next = left;
        }
    else {
        next = this.getFirst(right);
        }
    if (parent) {
        if (parent.rbLeft === node) {
            parent.rbLeft = next;
            }
        else {
            parent.rbRight = next;
            }
        }
    else {
        this.root = next;
        }
    // enforce red-black rules
    var isRed;
    if (left && right) {
        isRed = next.rbRed;
        next.rbRed = node.rbRed;
        next.rbLeft = left;
        left.rbParent = next;
        if (next !== right) {
            parent = next.rbParent;
            next.rbParent = node.rbParent;
            node = next.rbRight;
            parent.rbLeft = node;
            next.rbRight = right;
            right.rbParent = next;
            }
        else {
            next.rbParent = parent;
            parent = next;
            node = next.rbRight;
            }
        }
    else {
        isRed = node.rbRed;
        node = next;
        }
    // 'node' is now the sole successor's child and 'parent' its
    // new parent (since the successor can have been moved)
    if (node) {
        node.rbParent = parent;
        }
    // the 'easy' cases
    if (isRed) {return;}
    if (node && node.rbRed) {
        node.rbRed = false;
        return;
        }
    // the other cases
    var sibling;
    do {
        if (node === this.root) {
            break;
            }
        if (node === parent.rbLeft) {
            sibling = parent.rbRight;
            if (sibling.rbRed) {
                sibling.rbRed = false;
                parent.rbRed = true;
                this.rbRotateLeft(parent);
                sibling = parent.rbRight;
                }
            if ((sibling.rbLeft && sibling.rbLeft.rbRed) || (sibling.rbRight && sibling.rbRight.rbRed)) {
                if (!sibling.rbRight || !sibling.rbRight.rbRed) {
                    sibling.rbLeft.rbRed = false;
                    sibling.rbRed = true;
                    this.rbRotateRight(sibling);
                    sibling = parent.rbRight;
                    }
                sibling.rbRed = parent.rbRed;
                parent.rbRed = sibling.rbRight.rbRed = false;
                this.rbRotateLeft(parent);
                node = this.root;
                break;
                }
            }
        else {
            sibling = parent.rbLeft;
            if (sibling.rbRed) {
                sibling.rbRed = false;
                parent.rbRed = true;
                this.rbRotateRight(parent);
                sibling = parent.rbLeft;
                }
            if ((sibling.rbLeft && sibling.rbLeft.rbRed) || (sibling.rbRight && sibling.rbRight.rbRed)) {
                if (!sibling.rbLeft || !sibling.rbLeft.rbRed) {
                    sibling.rbRight.rbRed = false;
                    sibling.rbRed = true;
                    this.rbRotateLeft(sibling);
                    sibling = parent.rbLeft;
                    }
                sibling.rbRed = parent.rbRed;
                parent.rbRed = sibling.rbLeft.rbRed = false;
                this.rbRotateRight(parent);
                node = this.root;
                break;
                }
            }
        sibling.rbRed = true;
        node = parent;
        parent = parent.rbParent;
    } while (!node.rbRed);
    if (node) {node.rbRed = false;}
    };

Voronoi.prototype.RBTree.prototype.rbRotateLeft = function(node) {
    var p = node,
        q = node.rbRight, // can't be null
        parent = p.rbParent;
    if (parent) {
        if (parent.rbLeft === p) {
            parent.rbLeft = q;
            }
        else {
            parent.rbRight = q;
            }
        }
    else {
        this.root = q;
        }
    q.rbParent = parent;
    p.rbParent = q;
    p.rbRight = q.rbLeft;
    if (p.rbRight) {
        p.rbRight.rbParent = p;
        }
    q.rbLeft = p;
    };

Voronoi.prototype.RBTree.prototype.rbRotateRight = function(node) {
    var p = node,
        q = node.rbLeft, // can't be null
        parent = p.rbParent;
    if (parent) {
        if (parent.rbLeft === p) {
            parent.rbLeft = q;
            }
        else {
            parent.rbRight = q;
            }
        }
    else {
        this.root = q;
        }
    q.rbParent = parent;
    p.rbParent = q;
    p.rbLeft = q.rbRight;
    if (p.rbLeft) {
        p.rbLeft.rbParent = p;
        }
    q.rbRight = p;
    };

Voronoi.prototype.RBTree.prototype.getFirst = function(node) {
    while (node.rbLeft) {
        node = node.rbLeft;
        }
    return node;
    };

Voronoi.prototype.RBTree.prototype.getLast = function(node) {
    while (node.rbRight) {
        node = node.rbRight;
        }
    return node;
    };

// ---------------------------------------------------------------------------
// Diagram methods

Voronoi.prototype.Diagram = function(site) {
    this.site = site;
    };

// ---------------------------------------------------------------------------
// Cell methods

Voronoi.prototype.Cell = function(site) {
    this.site = site;
    this.halfedges = [];
    this.closeMe = false;
    };

Voronoi.prototype.Cell.prototype.init = function(site) {
    this.site = site;
    this.halfedges = [];
    this.closeMe = false;
    return this;
    };

Voronoi.prototype.createCell = function(site) {
    var cell = this.cellJunkyard.pop();
    if ( cell ) {
        return cell.init(site);
        }
    return new this.Cell(site);
    };

Voronoi.prototype.Cell.prototype.prepareHalfedges = function() {
    var halfedges = this.halfedges,
        iHalfedge = halfedges.length,
        edge;
    // get rid of unused halfedges
    // rhill 2011-05-27: Keep it simple, no point here in trying
    // to be fancy: dangling edges are a typically a minority.
    while (iHalfedge--) {
        edge = halfedges[iHalfedge].edge;
        if (!edge.vb || !edge.va) {
            halfedges.splice(iHalfedge,1);
            }
        }

    // rhill 2011-05-26: I tried to use a binary search at insertion
    // time to keep the array sorted on-the-fly (in Cell.addHalfedge()).
    // There was no real benefits in doing so, performance on
    // Firefox 3.6 was improved marginally, while performance on
    // Opera 11 was penalized marginally.
    halfedges.sort(function(a,b){return b.angle-a.angle;});
    return halfedges.length;
    };

// Return a list of the neighbor Ids
Voronoi.prototype.Cell.prototype.getNeighborIds = function() {
    var neighbors = [],
        iHalfedge = this.halfedges.length,
        edge;
    while (iHalfedge--){
        edge = this.halfedges[iHalfedge].edge;
        if (edge.lSite !== null && edge.lSite.voronoiId != this.site.voronoiId) {
            neighbors.push(edge.lSite.voronoiId);
            }
        else if (edge.rSite !== null && edge.rSite.voronoiId != this.site.voronoiId){
            neighbors.push(edge.rSite.voronoiId);
            }
        }
    return neighbors;
    };

// Compute bounding box
//
Voronoi.prototype.Cell.prototype.getBbox = function() {
    var halfedges = this.halfedges,
        iHalfedge = halfedges.length,
        xmin = Infinity,
        ymin = Infinity,
        xmax = -Infinity,
        ymax = -Infinity,
        v, vx, vy;
    while (iHalfedge--) {
        v = halfedges[iHalfedge].getStartpoint();
        vx = v.x;
        vy = v.y;
        if (vx < xmin) {xmin = vx;}
        if (vy < ymin) {ymin = vy;}
        if (vx > xmax) {xmax = vx;}
        if (vy > ymax) {ymax = vy;}
        // we dont need to take into account end point,
        // since each end point matches a start point
        }
    return {
        x: xmin,
        y: ymin,
        width: xmax-xmin,
        height: ymax-ymin
        };
    };

// Return whether a point is inside, on, or outside the cell:
//   -1: point is outside the perimeter of the cell
//    0: point is on the perimeter of the cell
//    1: point is inside the perimeter of the cell
//
Voronoi.prototype.Cell.prototype.pointIntersection = function(x, y) {
    // Check if point in polygon. Since all polygons of a Voronoi
    // diagram are convex, then:
    // http://paulbourke.net/geometry/polygonmesh/
    // Solution 3 (2D):
    //   "If the polygon is convex then one can consider the polygon
    //   "as a 'path' from the first vertex. A point is on the interior
    //   "of this polygons if it is always on the same side of all the
    //   "line segments making up the path. ...
    //   "(y - y0) (x1 - x0) - (x - x0) (y1 - y0)
    //   "if it is less than 0 then P is to the right of the line segment,
    //   "if greater than 0 it is to the left, if equal to 0 then it lies
    //   "on the line segment"
    var halfedges = this.halfedges,
        iHalfedge = halfedges.length,
        halfedge,
        p0, p1, r;
    while (iHalfedge--) {
        halfedge = halfedges[iHalfedge];
        p0 = halfedge.getStartpoint();
        p1 = halfedge.getEndpoint();
        r = (y-p0.y)*(p1.x-p0.x)-(x-p0.x)*(p1.y-p0.y);
        if (!r) {
            return 0;
            }
        if (r > 0) {
            return -1;
            }
        }
    return 1;
    };

// ---------------------------------------------------------------------------
// Edge methods
//

Voronoi.prototype.Vertex = function(x, y) {
    this.x = x;
    this.y = y;
    };

Voronoi.prototype.Edge = function(lSite, rSite) {
    this.lSite = lSite;
    this.rSite = rSite;
    this.va = this.vb = null;
    };

Voronoi.prototype.Halfedge = function(edge, lSite, rSite) {
    this.site = lSite;
    this.edge = edge;
    // 'angle' is a value to be used for properly sorting the
    // halfsegments counterclockwise. By convention, we will
    // use the angle of the line defined by the 'site to the left'
    // to the 'site to the right'.
    // However, border edges have no 'site to the right': thus we
    // use the angle of line perpendicular to the halfsegment (the
    // edge should have both end points defined in such case.)
    if (rSite) {
        this.angle = Math.atan2(rSite.y-lSite.y, rSite.x-lSite.x);
        }
    else {
        var va = edge.va,
            vb = edge.vb;
        // rhill 2011-05-31: used to call getStartpoint()/getEndpoint(),
        // but for performance purpose, these are expanded in place here.
        this.angle = edge.lSite === lSite ?
            Math.atan2(vb.x-va.x, va.y-vb.y) :
            Math.atan2(va.x-vb.x, vb.y-va.y);
        }
    };

Voronoi.prototype.createHalfedge = function(edge, lSite, rSite) {
    return new this.Halfedge(edge, lSite, rSite);
    };

Voronoi.prototype.Halfedge.prototype.getStartpoint = function() {
    return this.edge.lSite === this.site ? this.edge.va : this.edge.vb;
    };

Voronoi.prototype.Halfedge.prototype.getEndpoint = function() {
    return this.edge.lSite === this.site ? this.edge.vb : this.edge.va;
    };



// this create and add a vertex to the internal collection

Voronoi.prototype.createVertex = function(x, y) {
    var v = this.vertexJunkyard.pop();
    if ( !v ) {
        v = new this.Vertex(x, y);
        }
    else {
        v.x = x;
        v.y = y;
        }
    this.vertices.push(v);
    return v;
    };

// this create and add an edge to internal collection, and also create
// two halfedges which are added to each site's counterclockwise array
// of halfedges.

Voronoi.prototype.createEdge = function(lSite, rSite, va, vb) {
    var edge = this.edgeJunkyard.pop();
    if ( !edge ) {
        edge = new this.Edge(lSite, rSite);
        }
    else {
        edge.lSite = lSite;
        edge.rSite = rSite;
        edge.va = edge.vb = null;
        }

    this.edges.push(edge);
    if (va) {
        this.setEdgeStartpoint(edge, lSite, rSite, va);
        }
    if (vb) {
        this.setEdgeEndpoint(edge, lSite, rSite, vb);
        }
    this.cells[lSite.voronoiId].halfedges.push(this.createHalfedge(edge, lSite, rSite));
    this.cells[rSite.voronoiId].halfedges.push(this.createHalfedge(edge, rSite, lSite));
    return edge;
    };

Voronoi.prototype.createBorderEdge = function(lSite, va, vb) {
    var edge = this.edgeJunkyard.pop();
    if ( !edge ) {
        edge = new this.Edge(lSite, null);
        }
    else {
        edge.lSite = lSite;
        edge.rSite = null;
        }
    edge.va = va;
    edge.vb = vb;
    this.edges.push(edge);
    return edge;
    };

Voronoi.prototype.setEdgeStartpoint = function(edge, lSite, rSite, vertex) {
    if (!edge.va && !edge.vb) {
        edge.va = vertex;
        edge.lSite = lSite;
        edge.rSite = rSite;
        }
    else if (edge.lSite === rSite) {
        edge.vb = vertex;
        }
    else {
        edge.va = vertex;
        }
    };

Voronoi.prototype.setEdgeEndpoint = function(edge, lSite, rSite, vertex) {
    this.setEdgeStartpoint(edge, rSite, lSite, vertex);
    };

// ---------------------------------------------------------------------------
// Beachline methods

// rhill 2011-06-07: For some reasons, performance suffers significantly
// when instanciating a literal object instead of an empty ctor
Voronoi.prototype.Beachsection = function() {
    };

// rhill 2011-06-02: A lot of Beachsection instanciations
// occur during the computation of the Voronoi diagram,
// somewhere between the number of sites and twice the
// number of sites, while the number of Beachsections on the
// beachline at any given time is comparatively low. For this
// reason, we reuse already created Beachsections, in order
// to avoid new memory allocation. This resulted in a measurable
// performance gain.

Voronoi.prototype.createBeachsection = function(site) {
    var beachsection = this.beachsectionJunkyard.pop();
    if (!beachsection) {
        beachsection = new this.Beachsection();
        }
    beachsection.site = site;
    return beachsection;
    };

// calculate the left break point of a particular beach section,
// given a particular sweep line
Voronoi.prototype.leftBreakPoint = function(arc, directrix) {
    // http://en.wikipedia.org/wiki/Parabola
    // http://en.wikipedia.org/wiki/Quadratic_equation
    // h1 = x1,
    // k1 = (y1+directrix)/2,
    // h2 = x2,
    // k2 = (y2+directrix)/2,
    // p1 = k1-directrix,
    // a1 = 1/(4*p1),
    // b1 = -h1/(2*p1),
    // c1 = h1*h1/(4*p1)+k1,
    // p2 = k2-directrix,
    // a2 = 1/(4*p2),
    // b2 = -h2/(2*p2),
    // c2 = h2*h2/(4*p2)+k2,
    // x = (-(b2-b1) + Math.sqrt((b2-b1)*(b2-b1) - 4*(a2-a1)*(c2-c1))) / (2*(a2-a1))
    // When x1 become the x-origin:
    // h1 = 0,
    // k1 = (y1+directrix)/2,
    // h2 = x2-x1,
    // k2 = (y2+directrix)/2,
    // p1 = k1-directrix,
    // a1 = 1/(4*p1),
    // b1 = 0,
    // c1 = k1,
    // p2 = k2-directrix,
    // a2 = 1/(4*p2),
    // b2 = -h2/(2*p2),
    // c2 = h2*h2/(4*p2)+k2,
    // x = (-b2 + Math.sqrt(b2*b2 - 4*(a2-a1)*(c2-k1))) / (2*(a2-a1)) + x1

    // change code below at your own risk: care has been taken to
    // reduce errors due to computers' finite arithmetic precision.
    // Maybe can still be improved, will see if any more of this
    // kind of errors pop up again.
    var site = arc.site,
        rfocx = site.x,
        rfocy = site.y,
        pby2 = rfocy-directrix;
    // parabola in degenerate case where focus is on directrix
    if (!pby2) {
        return rfocx;
        }
    var lArc = arc.rbPrevious;
    if (!lArc) {
        return -Infinity;
        }
    site = lArc.site;
    var lfocx = site.x,
        lfocy = site.y,
        plby2 = lfocy-directrix;
    // parabola in degenerate case where focus is on directrix
    if (!plby2) {
        return lfocx;
        }
    var hl = lfocx-rfocx,
        aby2 = 1/pby2-1/plby2,
        b = hl/plby2;
    if (aby2) {
        return (-b+this.sqrt(b*b-2*aby2*(hl*hl/(-2*plby2)-lfocy+plby2/2+rfocy-pby2/2)))/aby2+rfocx;
        }
    // both parabolas have same distance to directrix, thus break point is midway
    return (rfocx+lfocx)/2;
    };

// calculate the right break point of a particular beach section,
// given a particular directrix
Voronoi.prototype.rightBreakPoint = function(arc, directrix) {
    var rArc = arc.rbNext;
    if (rArc) {
        return this.leftBreakPoint(rArc, directrix);
        }
    var site = arc.site;
    return site.y === directrix ? site.x : Infinity;
    };

Voronoi.prototype.detachBeachsection = function(beachsection) {
    this.detachCircleEvent(beachsection); // detach potentially attached circle event
    this.beachline.rbRemoveNode(beachsection); // remove from RB-tree
    this.beachsectionJunkyard.push(beachsection); // mark for reuse
    };

Voronoi.prototype.removeBeachsection = function(beachsection) {
    var circle = beachsection.circleEvent,
        x = circle.x,
        y = circle.ycenter,
        vertex = this.createVertex(x, y),
        previous = beachsection.rbPrevious,
        next = beachsection.rbNext,
        disappearingTransitions = [beachsection],
        abs_fn = Math.abs;

    // remove collapsed beachsection from beachline
    this.detachBeachsection(beachsection);

    // there could be more than one empty arc at the deletion point, this
    // happens when more than two edges are linked by the same vertex,
    // so we will collect all those edges by looking up both sides of
    // the deletion point.
    // by the way, there is *always* a predecessor/successor to any collapsed
    // beach section, it's just impossible to have a collapsing first/last
    // beach sections on the beachline, since they obviously are unconstrained
    // on their left/right side.

    // look left
    var lArc = previous;
    while (lArc.circleEvent && abs_fn(x-lArc.circleEvent.x)<1e-9 && abs_fn(y-lArc.circleEvent.ycenter)<1e-9) {
        previous = lArc.rbPrevious;
        disappearingTransitions.unshift(lArc);
        this.detachBeachsection(lArc); // mark for reuse
        lArc = previous;
        }
    // even though it is not disappearing, I will also add the beach section
    // immediately to the left of the left-most collapsed beach section, for
    // convenience, since we need to refer to it later as this beach section
    // is the 'left' site of an edge for which a start point is set.
    disappearingTransitions.unshift(lArc);
    this.detachCircleEvent(lArc);

    // look right
    var rArc = next;
    while (rArc.circleEvent && abs_fn(x-rArc.circleEvent.x)<1e-9 && abs_fn(y-rArc.circleEvent.ycenter)<1e-9) {
        next = rArc.rbNext;
        disappearingTransitions.push(rArc);
        this.detachBeachsection(rArc); // mark for reuse
        rArc = next;
        }
    // we also have to add the beach section immediately to the right of the
    // right-most collapsed beach section, since there is also a disappearing
    // transition representing an edge's start point on its left.
    disappearingTransitions.push(rArc);
    this.detachCircleEvent(rArc);

    // walk through all the disappearing transitions between beach sections and
    // set the start point of their (implied) edge.
    var nArcs = disappearingTransitions.length,
        iArc;
    for (iArc=1; iArc<nArcs; iArc++) {
        rArc = disappearingTransitions[iArc];
        lArc = disappearingTransitions[iArc-1];
        this.setEdgeStartpoint(rArc.edge, lArc.site, rArc.site, vertex);
        }

    // create a new edge as we have now a new transition between
    // two beach sections which were previously not adjacent.
    // since this edge appears as a new vertex is defined, the vertex
    // actually define an end point of the edge (relative to the site
    // on the left)
    lArc = disappearingTransitions[0];
    rArc = disappearingTransitions[nArcs-1];
    rArc.edge = this.createEdge(lArc.site, rArc.site, undefined, vertex);

    // create circle events if any for beach sections left in the beachline
    // adjacent to collapsed sections
    this.attachCircleEvent(lArc);
    this.attachCircleEvent(rArc);
    };

Voronoi.prototype.addBeachsection = function(site) {
    var x = site.x,
        directrix = site.y;

    // find the left and right beach sections which will surround the newly
    // created beach section.
    // rhill 2011-06-01: This loop is one of the most often executed,
    // hence we expand in-place the comparison-against-epsilon calls.
    var lArc, rArc,
        dxl, dxr,
        node = this.beachline.root;

    while (node) {
        dxl = this.leftBreakPoint(node,directrix)-x;
        // x lessThanWithEpsilon xl => falls somewhere before the left edge of the beachsection
        if (dxl > 1e-9) {
            // this case should never happen
            // if (!node.rbLeft) {
            //    rArc = node.rbLeft;
            //    break;
            //    }
            node = node.rbLeft;
            }
        else {
            dxr = x-this.rightBreakPoint(node,directrix);
            // x greaterThanWithEpsilon xr => falls somewhere after the right edge of the beachsection
            if (dxr > 1e-9) {
                if (!node.rbRight) {
                    lArc = node;
                    break;
                    }
                node = node.rbRight;
                }
            else {
                // x equalWithEpsilon xl => falls exactly on the left edge of the beachsection
                if (dxl > -1e-9) {
                    lArc = node.rbPrevious;
                    rArc = node;
                    }
                // x equalWithEpsilon xr => falls exactly on the right edge of the beachsection
                else if (dxr > -1e-9) {
                    lArc = node;
                    rArc = node.rbNext;
                    }
                // falls exactly somewhere in the middle of the beachsection
                else {
                    lArc = rArc = node;
                    }
                break;
                }
            }
        }
    // at this point, keep in mind that lArc and/or rArc could be
    // undefined or null.

    // create a new beach section object for the site and add it to RB-tree
    var newArc = this.createBeachsection(site);
    this.beachline.rbInsertSuccessor(lArc, newArc);

    // cases:
    //

    // [null,null]
    // least likely case: new beach section is the first beach section on the
    // beachline.
    // This case means:
    //   no new transition appears
    //   no collapsing beach section
    //   new beachsection become root of the RB-tree
    if (!lArc && !rArc) {
        return;
        }

    // [lArc,rArc] where lArc == rArc
    // most likely case: new beach section split an existing beach
    // section.
    // This case means:
    //   one new transition appears
    //   the left and right beach section might be collapsing as a result
    //   two new nodes added to the RB-tree
    if (lArc === rArc) {
        // invalidate circle event of split beach section
        this.detachCircleEvent(lArc);

        // split the beach section into two separate beach sections
        rArc = this.createBeachsection(lArc.site);
        this.beachline.rbInsertSuccessor(newArc, rArc);

        // since we have a new transition between two beach sections,
        // a new edge is born
        newArc.edge = rArc.edge = this.createEdge(lArc.site, newArc.site);

        // check whether the left and right beach sections are collapsing
        // and if so create circle events, to be notified when the point of
        // collapse is reached.
        this.attachCircleEvent(lArc);
        this.attachCircleEvent(rArc);
        return;
        }

    // [lArc,null]
    // even less likely case: new beach section is the *last* beach section
    // on the beachline -- this can happen *only* if *all* the previous beach
    // sections currently on the beachline share the same y value as
    // the new beach section.
    // This case means:
    //   one new transition appears
    //   no collapsing beach section as a result
    //   new beach section become right-most node of the RB-tree
    if (lArc && !rArc) {
        newArc.edge = this.createEdge(lArc.site,newArc.site);
        return;
        }

    // [null,rArc]
    // impossible case: because sites are strictly processed from top to bottom,
    // and left to right, which guarantees that there will always be a beach section
    // on the left -- except of course when there are no beach section at all on
    // the beach line, which case was handled above.
    // rhill 2011-06-02: No point testing in non-debug version
    //if (!lArc && rArc) {
    //    throw "Voronoi.addBeachsection(): What is this I don't even";
    //    }

    // [lArc,rArc] where lArc != rArc
    // somewhat less likely case: new beach section falls *exactly* in between two
    // existing beach sections
    // This case means:
    //   one transition disappears
    //   two new transitions appear
    //   the left and right beach section might be collapsing as a result
    //   only one new node added to the RB-tree
    if (lArc !== rArc) {
        // invalidate circle events of left and right sites
        this.detachCircleEvent(lArc);
        this.detachCircleEvent(rArc);

        // an existing transition disappears, meaning a vertex is defined at
        // the disappearance point.
        // since the disappearance is caused by the new beachsection, the
        // vertex is at the center of the circumscribed circle of the left,
        // new and right beachsections.
        // http://mathforum.org/library/drmath/view/55002.html
        // Except that I bring the origin at A to simplify
        // calculation
        var lSite = lArc.site,
            ax = lSite.x,
            ay = lSite.y,
            bx=site.x-ax,
            by=site.y-ay,
            rSite = rArc.site,
            cx=rSite.x-ax,
            cy=rSite.y-ay,
            d=2*(bx*cy-by*cx),
            hb=bx*bx+by*by,
            hc=cx*cx+cy*cy,
            vertex = this.createVertex((cy*hb-by*hc)/d+ax, (bx*hc-cx*hb)/d+ay);

        // one transition disappear
        this.setEdgeStartpoint(rArc.edge, lSite, rSite, vertex);

        // two new transitions appear at the new vertex location
        newArc.edge = this.createEdge(lSite, site, undefined, vertex);
        rArc.edge = this.createEdge(site, rSite, undefined, vertex);

        // check whether the left and right beach sections are collapsing
        // and if so create circle events, to handle the point of collapse.
        this.attachCircleEvent(lArc);
        this.attachCircleEvent(rArc);
        return;
        }
    };

// ---------------------------------------------------------------------------
// Circle event methods

// rhill 2011-06-07: For some reasons, performance suffers significantly
// when instanciating a literal object instead of an empty ctor
Voronoi.prototype.CircleEvent = function() {
    // rhill 2013-10-12: it helps to state exactly what we are at ctor time.
    this.arc = null;
    this.rbLeft = null;
    this.rbNext = null;
    this.rbParent = null;
    this.rbPrevious = null;
    this.rbRed = false;
    this.rbRight = null;
    this.site = null;
    this.x = this.y = this.ycenter = 0;
    };

Voronoi.prototype.attachCircleEvent = function(arc) {
    var lArc = arc.rbPrevious,
        rArc = arc.rbNext;
    if (!lArc || !rArc) {return;} // does that ever happen?
    var lSite = lArc.site,
        cSite = arc.site,
        rSite = rArc.site;

    // If site of left beachsection is same as site of
    // right beachsection, there can't be convergence
    if (lSite===rSite) {return;}

    // Find the circumscribed circle for the three sites associated
    // with the beachsection triplet.
    // rhill 2011-05-26: It is more efficient to calculate in-place
    // rather than getting the resulting circumscribed circle from an
    // object returned by calling Voronoi.circumcircle()
    // http://mathforum.org/library/drmath/view/55002.html
    // Except that I bring the origin at cSite to simplify calculations.
    // The bottom-most part of the circumcircle is our Fortune 'circle
    // event', and its center is a vertex potentially part of the final
    // Voronoi diagram.
    var bx = cSite.x,
        by = cSite.y,
        ax = lSite.x-bx,
        ay = lSite.y-by,
        cx = rSite.x-bx,
        cy = rSite.y-by;

    // If points l->c->r are clockwise, then center beach section does not
    // collapse, hence it can't end up as a vertex (we reuse 'd' here, which
    // sign is reverse of the orientation, hence we reverse the test.
    // http://en.wikipedia.org/wiki/Curve_orientation#Orientation_of_a_simple_polygon
    // rhill 2011-05-21: Nasty finite precision error which caused circumcircle() to
    // return infinites: 1e-12 seems to fix the problem.
    var d = 2*(ax*cy-ay*cx);
    if (d >= -2e-12){return;}

    var ha = ax*ax+ay*ay,
        hc = cx*cx+cy*cy,
        x = (cy*ha-ay*hc)/d,
        y = (ax*hc-cx*ha)/d,
        ycenter = y+by;

    // Important: ybottom should always be under or at sweep, so no need
    // to waste CPU cycles by checking

    // recycle circle event object if possible
    var circleEvent = this.circleEventJunkyard.pop();
    if (!circleEvent) {
        circleEvent = new this.CircleEvent();
        }
    circleEvent.arc = arc;
    circleEvent.site = cSite;
    circleEvent.x = x+bx;
    circleEvent.y = ycenter+this.sqrt(x*x+y*y); // y bottom
    circleEvent.ycenter = ycenter;
    arc.circleEvent = circleEvent;

    // find insertion point in RB-tree: circle events are ordered from
    // smallest to largest
    var predecessor = null,
        node = this.circleEvents.root;
    while (node) {
        if (circleEvent.y < node.y || (circleEvent.y === node.y && circleEvent.x <= node.x)) {
            if (node.rbLeft) {
                node = node.rbLeft;
                }
            else {
                predecessor = node.rbPrevious;
                break;
                }
            }
        else {
            if (node.rbRight) {
                node = node.rbRight;
                }
            else {
                predecessor = node;
                break;
                }
            }
        }
    this.circleEvents.rbInsertSuccessor(predecessor, circleEvent);
    if (!predecessor) {
        this.firstCircleEvent = circleEvent;
        }
    };

Voronoi.prototype.detachCircleEvent = function(arc) {
    var circleEvent = arc.circleEvent;
    if (circleEvent) {
        if (!circleEvent.rbPrevious) {
            this.firstCircleEvent = circleEvent.rbNext;
            }
        this.circleEvents.rbRemoveNode(circleEvent); // remove from RB-tree
        this.circleEventJunkyard.push(circleEvent);
        arc.circleEvent = null;
        }
    };

// ---------------------------------------------------------------------------
// Diagram completion methods

// connect dangling edges (not if a cursory test tells us
// it is not going to be visible.
// return value:
//   false: the dangling endpoint couldn't be connected
//   true: the dangling endpoint could be connected
Voronoi.prototype.connectEdge = function(edge, bbox) {
    // skip if end point already connected
    var vb = edge.vb;
    if (!!vb) {return true;}

    // make local copy for performance purpose
    var va = edge.va,
        xl = bbox.xl,
        xr = bbox.xr,
        yt = bbox.yt,
        yb = bbox.yb,
        lSite = edge.lSite,
        rSite = edge.rSite,
        lx = lSite.x,
        ly = lSite.y,
        rx = rSite.x,
        ry = rSite.y,
        fx = (lx+rx)/2,
        fy = (ly+ry)/2,
        fm, fb;

    // if we reach here, this means cells which use this edge will need
    // to be closed, whether because the edge was removed, or because it
    // was connected to the bounding box.
    this.cells[lSite.voronoiId].closeMe = true;
    this.cells[rSite.voronoiId].closeMe = true;

    // get the line equation of the bisector if line is not vertical
    if (ry !== ly) {
        fm = (lx-rx)/(ry-ly);
        fb = fy-fm*fx;
        }

    // remember, direction of line (relative to left site):
    // upward: left.x < right.x
    // downward: left.x > right.x
    // horizontal: left.x == right.x
    // upward: left.x < right.x
    // rightward: left.y < right.y
    // leftward: left.y > right.y
    // vertical: left.y == right.y

    // depending on the direction, find the best side of the
    // bounding box to use to determine a reasonable start point

    // rhill 2013-12-02:
    // While at it, since we have the values which define the line,
    // clip the end of va if it is outside the bbox.
    // https://github.com/gorhill/Javascript-Voronoi/issues/15
    // TODO: Do all the clipping here rather than rely on Liang-Barsky
    // which does not do well sometimes due to loss of arithmetic
    // precision. The code here doesn't degrade if one of the vertex is
    // at a huge distance.

    // special case: vertical line
    if (fm === undefined) {
        // doesn't intersect with viewport
        if (fx < xl || fx >= xr) {return false;}
        // downward
        if (lx > rx) {
            if (!va || va.y < yt) {
                va = this.createVertex(fx, yt);
                }
            else if (va.y >= yb) {
                return false;
                }
            vb = this.createVertex(fx, yb);
            }
        // upward
        else {
            if (!va || va.y > yb) {
                va = this.createVertex(fx, yb);
                }
            else if (va.y < yt) {
                return false;
                }
            vb = this.createVertex(fx, yt);
            }
        }
    // closer to vertical than horizontal, connect start point to the
    // top or bottom side of the bounding box
    else if (fm < -1 || fm > 1) {
        // downward
        if (lx > rx) {
            if (!va || va.y < yt) {
                va = this.createVertex((yt-fb)/fm, yt);
                }
            else if (va.y >= yb) {
                return false;
                }
            vb = this.createVertex((yb-fb)/fm, yb);
            }
        // upward
        else {
            if (!va || va.y > yb) {
                va = this.createVertex((yb-fb)/fm, yb);
                }
            else if (va.y < yt) {
                return false;
                }
            vb = this.createVertex((yt-fb)/fm, yt);
            }
        }
    // closer to horizontal than vertical, connect start point to the
    // left or right side of the bounding box
    else {
        // rightward
        if (ly < ry) {
            if (!va || va.x < xl) {
                va = this.createVertex(xl, fm*xl+fb);
                }
            else if (va.x >= xr) {
                return false;
                }
            vb = this.createVertex(xr, fm*xr+fb);
            }
        // leftward
        else {
            if (!va || va.x > xr) {
                va = this.createVertex(xr, fm*xr+fb);
                }
            else if (va.x < xl) {
                return false;
                }
            vb = this.createVertex(xl, fm*xl+fb);
            }
        }
    edge.va = va;
    edge.vb = vb;

    return true;
    };

// line-clipping code taken from:
//   Liang-Barsky function by Daniel White
//   http://www.skytopia.com/project/articles/compsci/clipping.html
// Thanks!
// A bit modified to minimize code paths
Voronoi.prototype.clipEdge = function(edge, bbox) {
    var ax = edge.va.x,
        ay = edge.va.y,
        bx = edge.vb.x,
        by = edge.vb.y,
        t0 = 0,
        t1 = 1,
        dx = bx-ax,
        dy = by-ay;
    // left
    var q = ax-bbox.xl;
    if (dx===0 && q<0) {return false;}
    var r = -q/dx;
    if (dx<0) {
        if (r<t0) {return false;}
        if (r<t1) {t1=r;}
        }
    else if (dx>0) {
        if (r>t1) {return false;}
        if (r>t0) {t0=r;}
        }
    // right
    q = bbox.xr-ax;
    if (dx===0 && q<0) {return false;}
    r = q/dx;
    if (dx<0) {
        if (r>t1) {return false;}
        if (r>t0) {t0=r;}
        }
    else if (dx>0) {
        if (r<t0) {return false;}
        if (r<t1) {t1=r;}
        }
    // top
    q = ay-bbox.yt;
    if (dy===0 && q<0) {return false;}
    r = -q/dy;
    if (dy<0) {
        if (r<t0) {return false;}
        if (r<t1) {t1=r;}
        }
    else if (dy>0) {
        if (r>t1) {return false;}
        if (r>t0) {t0=r;}
        }
    // bottom        
    q = bbox.yb-ay;
    if (dy===0 && q<0) {return false;}
    r = q/dy;
    if (dy<0) {
        if (r>t1) {return false;}
        if (r>t0) {t0=r;}
        }
    else if (dy>0) {
        if (r<t0) {return false;}
        if (r<t1) {t1=r;}
        }

    // if we reach this point, Voronoi edge is within bbox

    // if t0 > 0, va needs to change
    // rhill 2011-06-03: we need to create a new vertex rather
    // than modifying the existing one, since the existing
    // one is likely shared with at least another edge
    if (t0 > 0) {
        edge.va = this.createVertex(ax+t0*dx, ay+t0*dy);
        }

    // if t1 < 1, vb needs to change
    // rhill 2011-06-03: we need to create a new vertex rather
    // than modifying the existing one, since the existing
    // one is likely shared with at least another edge
    if (t1 < 1) {
        edge.vb = this.createVertex(ax+t1*dx, ay+t1*dy);
        }

    // va and/or vb were clipped, thus we will need to close
    // cells which use this edge.
    if ( t0 > 0 || t1 < 1 ) {
        this.cells[edge.lSite.voronoiId].closeMe = true;
        this.cells[edge.rSite.voronoiId].closeMe = true;
    }

    return true;
    };

// Connect/cut edges at bounding box
Voronoi.prototype.clipEdges = function(bbox) {
    // connect all dangling edges to bounding box
    // or get rid of them if it can't be done
    var edges = this.edges,
        iEdge = edges.length,
        edge,
        abs_fn = Math.abs;

    // iterate backward so we can splice safely
    while (iEdge--) {
        edge = edges[iEdge];
        // edge is removed if:
        //   it is wholly outside the bounding box
        //   it is looking more like a point than a line
        if (!this.connectEdge(edge, bbox) ||
            !this.clipEdge(edge, bbox) ||
            (abs_fn(edge.va.x-edge.vb.x)<1e-9 && abs_fn(edge.va.y-edge.vb.y)<1e-9)) {
            edge.va = edge.vb = null;
            edges.splice(iEdge,1);
            }
        }
    };

// Close the cells.
// The cells are bound by the supplied bounding box.
// Each cell refers to its associated site, and a list
// of halfedges ordered counterclockwise.
Voronoi.prototype.closeCells = function(bbox) {
    var xl = bbox.xl,
        xr = bbox.xr,
        yt = bbox.yt,
        yb = bbox.yb,
        cells = this.cells,
        iCell = cells.length,
        cell,
        iLeft,
        halfedges, nHalfedges,
        edge,
        va, vb, vz,
        lastBorderSegment,
        abs_fn = Math.abs;

    while (iCell--) {
        cell = cells[iCell];
        // prune, order halfedges counterclockwise, then add missing ones
        // required to close cells
        if (!cell.prepareHalfedges()) {
            continue;
            }
        if (!cell.closeMe) {
            continue;
            }
        // find first 'unclosed' point.
        // an 'unclosed' point will be the end point of a halfedge which
        // does not match the start point of the following halfedge
        halfedges = cell.halfedges;
        nHalfedges = halfedges.length;
        // special case: only one site, in which case, the viewport is the cell
        // ...

        // all other cases
        iLeft = 0;
        while (iLeft < nHalfedges) {
            va = halfedges[iLeft].getEndpoint();
            vz = halfedges[(iLeft+1) % nHalfedges].getStartpoint();
            // if end point is not equal to start point, we need to add the missing
            // halfedge(s) up to vz
            if (abs_fn(va.x-vz.x)>=1e-9 || abs_fn(va.y-vz.y)>=1e-9) {

                // rhill 2013-12-02:
                // "Holes" in the halfedges are not necessarily always adjacent.
                // https://github.com/gorhill/Javascript-Voronoi/issues/16

                // find entry point:
                switch (true) {

                    // walk downward along left side
                    case this.equalWithEpsilon(va.x,xl) && this.lessThanWithEpsilon(va.y,yb):
                        lastBorderSegment = this.equalWithEpsilon(vz.x,xl);
                        vb = this.createVertex(xl, lastBorderSegment ? vz.y : yb);
                        edge = this.createBorderEdge(cell.site, va, vb);
                        iLeft++;
                        halfedges.splice(iLeft, 0, this.createHalfedge(edge, cell.site, null));
                        nHalfedges++;
                        if ( lastBorderSegment ) { break; }
                        va = vb;
                        // fall through

                    // walk rightward along bottom side
                    case this.equalWithEpsilon(va.y,yb) && this.lessThanWithEpsilon(va.x,xr):
                        lastBorderSegment = this.equalWithEpsilon(vz.y,yb);
                        vb = this.createVertex(lastBorderSegment ? vz.x : xr, yb);
                        edge = this.createBorderEdge(cell.site, va, vb);
                        iLeft++;
                        halfedges.splice(iLeft, 0, this.createHalfedge(edge, cell.site, null));
                        nHalfedges++;
                        if ( lastBorderSegment ) { break; }
                        va = vb;
                        // fall through

                    // walk upward along right side
                    case this.equalWithEpsilon(va.x,xr) && this.greaterThanWithEpsilon(va.y,yt):
                        lastBorderSegment = this.equalWithEpsilon(vz.x,xr);
                        vb = this.createVertex(xr, lastBorderSegment ? vz.y : yt);
                        edge = this.createBorderEdge(cell.site, va, vb);
                        iLeft++;
                        halfedges.splice(iLeft, 0, this.createHalfedge(edge, cell.site, null));
                        nHalfedges++;
                        if ( lastBorderSegment ) { break; }
                        va = vb;
                        // fall through

                    // walk leftward along top side
                    case this.equalWithEpsilon(va.y,yt) && this.greaterThanWithEpsilon(va.x,xl):
                        lastBorderSegment = this.equalWithEpsilon(vz.y,yt);
                        vb = this.createVertex(lastBorderSegment ? vz.x : xl, yt);
                        edge = this.createBorderEdge(cell.site, va, vb);
                        iLeft++;
                        halfedges.splice(iLeft, 0, this.createHalfedge(edge, cell.site, null));
                        nHalfedges++;
                        if ( lastBorderSegment ) { break; }
                        va = vb;
                        // fall through

                        // walk downward along left side
                        lastBorderSegment = this.equalWithEpsilon(vz.x,xl);
                        vb = this.createVertex(xl, lastBorderSegment ? vz.y : yb);
                        edge = this.createBorderEdge(cell.site, va, vb);
                        iLeft++;
                        halfedges.splice(iLeft, 0, this.createHalfedge(edge, cell.site, null));
                        nHalfedges++;
                        if ( lastBorderSegment ) { break; }
                        va = vb;
                        // fall through

                        // walk rightward along bottom side
                        lastBorderSegment = this.equalWithEpsilon(vz.y,yb);
                        vb = this.createVertex(lastBorderSegment ? vz.x : xr, yb);
                        edge = this.createBorderEdge(cell.site, va, vb);
                        iLeft++;
                        halfedges.splice(iLeft, 0, this.createHalfedge(edge, cell.site, null));
                        nHalfedges++;
                        if ( lastBorderSegment ) { break; }
                        va = vb;
                        // fall through

                        // walk upward along right side
                        lastBorderSegment = this.equalWithEpsilon(vz.x,xr);
                        vb = this.createVertex(xr, lastBorderSegment ? vz.y : yt);
                        edge = this.createBorderEdge(cell.site, va, vb);
                        iLeft++;
                        halfedges.splice(iLeft, 0, this.createHalfedge(edge, cell.site, null));
                        nHalfedges++;
                        if ( lastBorderSegment ) { break; }
                        // fall through

                    default:
                        throw "Voronoi.closeCells() > this makes no sense!";
                    }
                }
            iLeft++;
            }
        cell.closeMe = false;
        }
    };

// ---------------------------------------------------------------------------
// Debugging helper
/*
Voronoi.prototype.dumpBeachline = function(y) {
    console.log('Voronoi.dumpBeachline(%f) > Beachsections, from left to right:', y);
    if ( !this.beachline ) {
        console.log('  None');
        }
    else {
        var bs = this.beachline.getFirst(this.beachline.root);
        while ( bs ) {
            console.log('  site %d: xl: %f, xr: %f', bs.site.voronoiId, this.leftBreakPoint(bs, y), this.rightBreakPoint(bs, y));
            bs = bs.rbNext;
            }
        }
    };
*/

// ---------------------------------------------------------------------------
// Helper: Quantize sites

// rhill 2013-10-12:
// This is to solve https://github.com/gorhill/Javascript-Voronoi/issues/15
// Since not all users will end up using the kind of coord values which would
// cause the issue to arise, I chose to let the user decide whether or not
// he should sanitize his coord values through this helper. This way, for
// those users who uses coord values which are known to be fine, no overhead is
// added.

Voronoi.prototype.quantizeSites = function(sites) {
    var ε = this.ε,
        n = sites.length,
        site;
    while ( n-- ) {
        site = sites[n];
        site.x = Math.floor(site.x / ε) * ε;
        site.y = Math.floor(site.y / ε) * ε;
        }
    };

// ---------------------------------------------------------------------------
// Helper: Recycle diagram: all vertex, edge and cell objects are
// "surrendered" to the Voronoi object for reuse.
// TODO: rhill-voronoi-core v2: more performance to be gained
// when I change the semantic of what is returned.

Voronoi.prototype.recycle = function(diagram) {
    if ( diagram ) {
        if ( diagram instanceof this.Diagram ) {
            this.toRecycle = diagram;
            }
        else {
            throw 'Voronoi.recycleDiagram() > Need a Diagram object.';
            }
        }
    };

// ---------------------------------------------------------------------------
// Top-level Fortune loop

// rhill 2011-05-19:
//   Voronoi sites are kept client-side now, to allow
//   user to freely modify content. At compute time,
//   *references* to sites are copied locally.

Voronoi.prototype.compute = function(sites, bbox) {
    // to measure execution time
    var startTime = new Date();

    // init internal state
    this.reset();

    // any diagram data available for recycling?
    // I do that here so that this is included in execution time
    if ( this.toRecycle ) {
        this.vertexJunkyard = this.vertexJunkyard.concat(this.toRecycle.vertices);
        this.edgeJunkyard = this.edgeJunkyard.concat(this.toRecycle.edges);
        this.cellJunkyard = this.cellJunkyard.concat(this.toRecycle.cells);
        this.toRecycle = null;
        }

    // Initialize site event queue
    var siteEvents = sites.slice(0);
    siteEvents.sort(function(a,b){
        var r = b.y - a.y;
        if (r) {return r;}
        return b.x - a.x;
        });

    // process queue
    var site = siteEvents.pop(),
        siteid = 0,
        xsitex, // to avoid duplicate sites
        xsitey,
        cells = this.cells,
        circle;

    // main loop
    for (;;) {
        // we need to figure whether we handle a site or circle event
        // for this we find out if there is a site event and it is
        // 'earlier' than the circle event
        circle = this.firstCircleEvent;

        // add beach section
        if (site && (!circle || site.y < circle.y || (site.y === circle.y && site.x < circle.x))) {
            // only if site is not a duplicate
            if (site.x !== xsitex || site.y !== xsitey) {
                // first create cell for new site
                cells[siteid] = this.createCell(site);
                site.voronoiId = siteid++;
                // then create a beachsection for that site
                this.addBeachsection(site);
                // remember last site coords to detect duplicate
                xsitey = site.y;
                xsitex = site.x;
                }
            site = siteEvents.pop();
            }

        // remove beach section
        else if (circle) {
            this.removeBeachsection(circle.arc);
            }

        // all done, quit
        else {
            break;
            }
        }

    // wrapping-up:
    //   connect dangling edges to bounding box
    //   cut edges as per bounding box
    //   discard edges completely outside bounding box
    //   discard edges which are point-like
    this.clipEdges(bbox);

    //   add missing edges in order to close opened cells
    this.closeCells(bbox);

    // to measure execution time
    var stopTime = new Date();

    // prepare return values
    var diagram = new this.Diagram();
    diagram.cells = this.cells;
    diagram.edges = this.edges;
    diagram.vertices = this.vertices;
    diagram.execTime = stopTime.getTime()-startTime.getTime();

    // clean up
    this.reset();

    return diagram;
    };

/******************************************************************************/

if ( typeof module !== 'undefined' ) {
    module.exports = Voronoi;
}

},{}],2:[function(require,module,exports){

},{}],3:[function(require,module,exports){
/*
poisson-disk-sample

https://github.com/jeffrey-hearn/poisson-disk-sample

MIT License
*/

function PoissonDiskSampler(width, height, minDistance, sampleFrequency) {
    this.width = width;
    this.height = height;
    this.minDistance = minDistance;
    this.sampleFrequency = sampleFrequency;
    this.reset();
}

PoissonDiskSampler.prototype.reset = function() {
    this.grid = new Grid(this.width, this.height, this.minDistance);
    this.outputList = new Array();
    this.processingQueue = new RandomQueue();
}

PoissonDiskSampler.prototype.sampleUntilSolution = function() {
    while (this.sample()) {};
    return this.outputList;
}

PoissonDiskSampler.prototype.sample = function() {

    // If this is the first sample
    if (0 == this.outputList.length) {
        // Generate first point
        this.queueToAll(this.grid.randomPoint());
        return true;
    }

    var processPoint = this.processingQueue.pop();

    // Processing queue is empty, return failure
    if (processPoint == null)
        return false;

    // Generate sample points around the processing point
    // And check if they have any neighbors on the grid
    // If not, add them to the queues
    for (var i = 0; i < this.sampleFrequency; i++) {
        samplePoint = this.grid.randomPointAround(processPoint);
        if (!this.grid.inNeighborhood(samplePoint)) {
            // No on in neighborhood, welcome to the club
            this.queueToAll(samplePoint);
        }
    }
    // Sample successful since the processing queue isn't empty
    return true;
}

PoissonDiskSampler.prototype.queueToAll = function(point) {
    var valid = this.grid.addPointToGrid(point, this.grid.pixelsToGridCoords(point));
    if (!valid)
        return;
    this.processingQueue.push(point);
    this.outputList.push(point);
}



function Grid(width, height, minDistance) {
    this.width = width;
    this.height = height;
    this.minDistance = minDistance;
    this.cellSize = this.minDistance / Math.SQRT2;
    //console.log( this.cellSize );
    this.pointSize = 2;

    this.cellsWide = Math.ceil(this.width / this.cellSize);
    this.cellsHigh = Math.ceil(this.height / this.cellSize);

    // Initialize grid
    this.grid = [];
    for (var x = 0; x < this.cellsWide; x++) {
        this.grid[x] = [];
        for (var y = 0; y < this.cellsHigh; y++) {
            this.grid[x][y] = null;
        }
    }
}

Grid.prototype.pixelsToGridCoords = function(point) {
    var gridX = Math.floor(point.x / this.cellSize);
    var gridY = Math.floor(point.y / this.cellSize);
    return { x: gridX, y: gridY };
}

Grid.prototype.addPointToGrid = function(pointCoords, gridCoords) {
    // Check that the coordinate makes sense
    if (gridCoords.x < 0 || gridCoords.x > this.grid.length - 1)
        return false;
    if (gridCoords.y < 0 || gridCoords.y > this.grid[gridCoords.x].length - 1)
        return false;
    this.grid[gridCoords.x][gridCoords.y] = pointCoords;
    //console.log( "Adding ("+pointCoords.x+","+pointCoords.y+" to grid ["+gridCoords.x+","+gridCoords.y+"]" );
    return true;
}

Grid.prototype.randomPoint = function() {
    return { x: getRandomArbitrary(0, this.width), y: getRandomArbitrary(0, this.height) };
}

Grid.prototype.randomPointAround = function(point) {
    var r1 = Math.random();
    var r2 = Math.random();
    // get a random radius between the min distance and 2 X mindist
    var radius = this.minDistance * (r1 + 1);
    // get random angle around the circle
    var angle = 2 * Math.PI * r2;
    // get x and y coords based on angle and radius
    var x = point.x + radius * Math.cos(angle);
    var y = point.y + radius * Math.sin(angle);
    return { x: x, y: y };
}

Grid.prototype.inNeighborhood = function(point) {
    var gridPoint = this.pixelsToGridCoords(point);

    var cellsAroundPoint = this.cellsAroundPoint(point);

    for (var i = 0; i < cellsAroundPoint.length; i++) {
        if (cellsAroundPoint[i] != null) {
            if (this.calcDistance(cellsAroundPoint[i], point) < this.minDistance) {
                return true;
            }
        }
    }
    return false;
}

Grid.prototype.cellsAroundPoint = function(point) {
    var gridCoords = this.pixelsToGridCoords(point);
    var neighbors = new Array();

    for (var x = -2; x < 3; x++) {
        var targetX = gridCoords.x + x;
        // make sure lowerbound and upperbound make sense
        if (targetX < 0)
            targetX = 0;
        if (targetX > this.grid.length - 1)
            targetX = this.grid.length - 1;

        for (var y = -2; y < 3; y++) {
            var targetY = gridCoords.y + y;
            // make sure lowerbound and upperbound make sense
            if (targetY < 0)
                targetY = 0;
            if (targetY > this.grid[targetX].length - 1)
                targetY = this.grid[targetX].length - 1;
            neighbors.push(this.grid[targetX][targetY])
        }
    }
    return neighbors;
}

Grid.prototype.calcDistance = function(pointInCell, point) {
    return Math.sqrt((point.x - pointInCell.x) * (point.x - pointInCell.x) +
        (point.y - pointInCell.y) * (point.y - pointInCell.y));
}


function RandomQueue(a) {
    this.queue = a || new Array();
}

RandomQueue.prototype.push = function(element) {
    this.queue.push(element);
}

RandomQueue.prototype.pop = function() {

    randomIndex = getRandomInt(0, this.queue.length);
    while (this.queue[randomIndex] === undefined) {

        // Check if the queue is empty
        var empty = true;
        for (var i = 0; i < this.queue.length; i++) {
            if (this.queue[i] !== undefined)
                empty = false;
        }
        if (empty)
            return null;

        randomIndex = getRandomInt(0, this.queue.length);
    }

    element = this.queue[randomIndex];
    this.queue.remove(randomIndex);
    return element;
}

// Array Remove - By John Resig (MIT Licensed)
Array.prototype.remove = function(from, to) {
    var rest = this.slice((to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

// MDN Random Number Functions
// https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/Math/random
function getRandomArbitrary(min, max) {
    return Math.random() * (max - min) + min;
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = PoissonDiskSampler;
},{}],4:[function(require,module,exports){
// A library of seedable RNGs implemented in Javascript.
//
// Usage:
//
// var seedrandom = require('seedrandom');
// var random = seedrandom(1); // or any seed.
// var x = random();       // 0 <= x < 1.  Every bit is random.
// var x = random.quick(); // 0 <= x < 1.  32 bits of randomness.

// alea, a 53-bit multiply-with-carry generator by Johannes Baagøe.
// Period: ~2^116
// Reported to pass all BigCrush tests.
var alea = require('./lib/alea');

// xor128, a pure xor-shift generator by George Marsaglia.
// Period: 2^128-1.
// Reported to fail: MatrixRank and LinearComp.
var xor128 = require('./lib/xor128');

// xorwow, George Marsaglia's 160-bit xor-shift combined plus weyl.
// Period: 2^192-2^32
// Reported to fail: CollisionOver, SimpPoker, and LinearComp.
var xorwow = require('./lib/xorwow');

// xorshift7, by François Panneton and Pierre L'ecuyer, takes
// a different approach: it adds robustness by allowing more shifts
// than Marsaglia's original three.  It is a 7-shift generator
// with 256 bits, that passes BigCrush with no systmatic failures.
// Period 2^256-1.
// No systematic BigCrush failures reported.
var xorshift7 = require('./lib/xorshift7');

// xor4096, by Richard Brent, is a 4096-bit xor-shift with a
// very long period that also adds a Weyl generator. It also passes
// BigCrush with no systematic failures.  Its long period may
// be useful if you have many generators and need to avoid
// collisions.
// Period: 2^4128-2^32.
// No systematic BigCrush failures reported.
var xor4096 = require('./lib/xor4096');

// Tyche-i, by Samuel Neves and Filipe Araujo, is a bit-shifting random
// number generator derived from ChaCha, a modern stream cipher.
// https://eden.dei.uc.pt/~sneves/pubs/2011-snfa2.pdf
// Period: ~2^127
// No systematic BigCrush failures reported.
var tychei = require('./lib/tychei');

// The original ARC4-based prng included in this library.
// Period: ~2^1600
var sr = require('./seedrandom');

sr.alea = alea;
sr.xor128 = xor128;
sr.xorwow = xorwow;
sr.xorshift7 = xorshift7;
sr.xor4096 = xor4096;
sr.tychei = tychei;

module.exports = sr;

},{"./lib/alea":5,"./lib/tychei":6,"./lib/xor128":7,"./lib/xor4096":8,"./lib/xorshift7":9,"./lib/xorwow":10,"./seedrandom":11}],5:[function(require,module,exports){
// A port of an algorithm by Johannes Baagøe <baagoe@baagoe.com>, 2010
// http://baagoe.com/en/RandomMusings/javascript/
// https://github.com/nquinlan/better-random-numbers-for-javascript-mirror
// Original work is under MIT license -

// Copyright (C) 2010 by Johannes Baagøe <baagoe@baagoe.org>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.



(function(global, module, define) {

function Alea(seed) {
  var me = this, mash = Mash();

  me.next = function() {
    var t = 2091639 * me.s0 + me.c * 2.3283064365386963e-10; // 2^-32
    me.s0 = me.s1;
    me.s1 = me.s2;
    return me.s2 = t - (me.c = t | 0);
  };

  // Apply the seeding algorithm from Baagoe.
  me.c = 1;
  me.s0 = mash(' ');
  me.s1 = mash(' ');
  me.s2 = mash(' ');
  me.s0 -= mash(seed);
  if (me.s0 < 0) { me.s0 += 1; }
  me.s1 -= mash(seed);
  if (me.s1 < 0) { me.s1 += 1; }
  me.s2 -= mash(seed);
  if (me.s2 < 0) { me.s2 += 1; }
  mash = null;
}

function copy(f, t) {
  t.c = f.c;
  t.s0 = f.s0;
  t.s1 = f.s1;
  t.s2 = f.s2;
  return t;
}

function impl(seed, opts) {
  var xg = new Alea(seed),
      state = opts && opts.state,
      prng = xg.next;
  prng.int32 = function() { return (xg.next() * 0x100000000) | 0; }
  prng.double = function() {
    return prng() + (prng() * 0x200000 | 0) * 1.1102230246251565e-16; // 2^-53
  };
  prng.quick = prng;
  if (state) {
    if (typeof(state) == 'object') copy(state, xg);
    prng.state = function() { return copy(xg, {}); }
  }
  return prng;
}

function Mash() {
  var n = 0xefc8249d;

  var mash = function(data) {
    data = data.toString();
    for (var i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      var h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000; // 2^32
    }
    return (n >>> 0) * 2.3283064365386963e-10; // 2^-32
  };

  return mash;
}


if (module && module.exports) {
  module.exports = impl;
} else if (define && define.amd) {
  define(function() { return impl; });
} else {
  this.alea = impl;
}

})(
  this,
  (typeof module) == 'object' && module,    // present in node.js
  (typeof define) == 'function' && define   // present with an AMD loader
);



},{}],6:[function(require,module,exports){
// A Javascript implementaion of the "Tyche-i" prng algorithm by
// Samuel Neves and Filipe Araujo.
// See https://eden.dei.uc.pt/~sneves/pubs/2011-snfa2.pdf

(function(global, module, define) {

function XorGen(seed) {
  var me = this, strseed = '';

  // Set up generator function.
  me.next = function() {
    var b = me.b, c = me.c, d = me.d, a = me.a;
    b = (b << 25) ^ (b >>> 7) ^ c;
    c = (c - d) | 0;
    d = (d << 24) ^ (d >>> 8) ^ a;
    a = (a - b) | 0;
    me.b = b = (b << 20) ^ (b >>> 12) ^ c;
    me.c = c = (c - d) | 0;
    me.d = (d << 16) ^ (c >>> 16) ^ a;
    return me.a = (a - b) | 0;
  };

  /* The following is non-inverted tyche, which has better internal
   * bit diffusion, but which is about 25% slower than tyche-i in JS.
  me.next = function() {
    var a = me.a, b = me.b, c = me.c, d = me.d;
    a = (me.a + me.b | 0) >>> 0;
    d = me.d ^ a; d = d << 16 ^ d >>> 16;
    c = me.c + d | 0;
    b = me.b ^ c; b = b << 12 ^ d >>> 20;
    me.a = a = a + b | 0;
    d = d ^ a; me.d = d = d << 8 ^ d >>> 24;
    me.c = c = c + d | 0;
    b = b ^ c;
    return me.b = (b << 7 ^ b >>> 25);
  }
  */

  me.a = 0;
  me.b = 0;
  me.c = 2654435769 | 0;
  me.d = 1367130551;

  if (seed === Math.floor(seed)) {
    // Integer seed.
    me.a = (seed / 0x100000000) | 0;
    me.b = seed | 0;
  } else {
    // String seed.
    strseed += seed;
  }

  // Mix in string seed, then discard an initial batch of 64 values.
  for (var k = 0; k < strseed.length + 20; k++) {
    me.b ^= strseed.charCodeAt(k) | 0;
    me.next();
  }
}

function copy(f, t) {
  t.a = f.a;
  t.b = f.b;
  t.c = f.c;
  t.d = f.d;
  return t;
};

function impl(seed, opts) {
  var xg = new XorGen(seed),
      state = opts && opts.state,
      prng = function() { return (xg.next() >>> 0) / 0x100000000; };
  prng.double = function() {
    do {
      var top = xg.next() >>> 11,
          bot = (xg.next() >>> 0) / 0x100000000,
          result = (top + bot) / (1 << 21);
    } while (result === 0);
    return result;
  };
  prng.int32 = xg.next;
  prng.quick = prng;
  if (state) {
    if (typeof(state) == 'object') copy(state, xg);
    prng.state = function() { return copy(xg, {}); }
  }
  return prng;
}

if (module && module.exports) {
  module.exports = impl;
} else if (define && define.amd) {
  define(function() { return impl; });
} else {
  this.tychei = impl;
}

})(
  this,
  (typeof module) == 'object' && module,    // present in node.js
  (typeof define) == 'function' && define   // present with an AMD loader
);



},{}],7:[function(require,module,exports){
// A Javascript implementaion of the "xor128" prng algorithm by
// George Marsaglia.  See http://www.jstatsoft.org/v08/i14/paper

(function(global, module, define) {

function XorGen(seed) {
  var me = this, strseed = '';

  me.x = 0;
  me.y = 0;
  me.z = 0;
  me.w = 0;

  // Set up generator function.
  me.next = function() {
    var t = me.x ^ (me.x << 11);
    me.x = me.y;
    me.y = me.z;
    me.z = me.w;
    return me.w ^= (me.w >>> 19) ^ t ^ (t >>> 8);
  };

  if (seed === (seed | 0)) {
    // Integer seed.
    me.x = seed;
  } else {
    // String seed.
    strseed += seed;
  }

  // Mix in string seed, then discard an initial batch of 64 values.
  for (var k = 0; k < strseed.length + 64; k++) {
    me.x ^= strseed.charCodeAt(k) | 0;
    me.next();
  }
}

function copy(f, t) {
  t.x = f.x;
  t.y = f.y;
  t.z = f.z;
  t.w = f.w;
  return t;
}

function impl(seed, opts) {
  var xg = new XorGen(seed),
      state = opts && opts.state,
      prng = function() { return (xg.next() >>> 0) / 0x100000000; };
  prng.double = function() {
    do {
      var top = xg.next() >>> 11,
          bot = (xg.next() >>> 0) / 0x100000000,
          result = (top + bot) / (1 << 21);
    } while (result === 0);
    return result;
  };
  prng.int32 = xg.next;
  prng.quick = prng;
  if (state) {
    if (typeof(state) == 'object') copy(state, xg);
    prng.state = function() { return copy(xg, {}); }
  }
  return prng;
}

if (module && module.exports) {
  module.exports = impl;
} else if (define && define.amd) {
  define(function() { return impl; });
} else {
  this.xor128 = impl;
}

})(
  this,
  (typeof module) == 'object' && module,    // present in node.js
  (typeof define) == 'function' && define   // present with an AMD loader
);



},{}],8:[function(require,module,exports){
// A Javascript implementaion of Richard Brent's Xorgens xor4096 algorithm.
//
// This fast non-cryptographic random number generator is designed for
// use in Monte-Carlo algorithms. It combines a long-period xorshift
// generator with a Weyl generator, and it passes all common batteries
// of stasticial tests for randomness while consuming only a few nanoseconds
// for each prng generated.  For background on the generator, see Brent's
// paper: "Some long-period random number generators using shifts and xors."
// http://arxiv.org/pdf/1004.3115v1.pdf
//
// Usage:
//
// var xor4096 = require('xor4096');
// random = xor4096(1);                        // Seed with int32 or string.
// assert.equal(random(), 0.1520436450538547); // (0, 1) range, 53 bits.
// assert.equal(random.int32(), 1806534897);   // signed int32, 32 bits.
//
// For nonzero numeric keys, this impelementation provides a sequence
// identical to that by Brent's xorgens 3 implementaion in C.  This
// implementation also provides for initalizing the generator with
// string seeds, or for saving and restoring the state of the generator.
//
// On Chrome, this prng benchmarks about 2.1 times slower than
// Javascript's built-in Math.random().

(function(global, module, define) {

function XorGen(seed) {
  var me = this;

  // Set up generator function.
  me.next = function() {
    var w = me.w,
        X = me.X, i = me.i, t, v;
    // Update Weyl generator.
    me.w = w = (w + 0x61c88647) | 0;
    // Update xor generator.
    v = X[(i + 34) & 127];
    t = X[i = ((i + 1) & 127)];
    v ^= v << 13;
    t ^= t << 17;
    v ^= v >>> 15;
    t ^= t >>> 12;
    // Update Xor generator array state.
    v = X[i] = v ^ t;
    me.i = i;
    // Result is the combination.
    return (v + (w ^ (w >>> 16))) | 0;
  };

  function init(me, seed) {
    var t, v, i, j, w, X = [], limit = 128;
    if (seed === (seed | 0)) {
      // Numeric seeds initialize v, which is used to generates X.
      v = seed;
      seed = null;
    } else {
      // String seeds are mixed into v and X one character at a time.
      seed = seed + '\0';
      v = 0;
      limit = Math.max(limit, seed.length);
    }
    // Initialize circular array and weyl value.
    for (i = 0, j = -32; j < limit; ++j) {
      // Put the unicode characters into the array, and shuffle them.
      if (seed) v ^= seed.charCodeAt((j + 32) % seed.length);
      // After 32 shuffles, take v as the starting w value.
      if (j === 0) w = v;
      v ^= v << 10;
      v ^= v >>> 15;
      v ^= v << 4;
      v ^= v >>> 13;
      if (j >= 0) {
        w = (w + 0x61c88647) | 0;     // Weyl.
        t = (X[j & 127] ^= (v + w));  // Combine xor and weyl to init array.
        i = (0 == t) ? i + 1 : 0;     // Count zeroes.
      }
    }
    // We have detected all zeroes; make the key nonzero.
    if (i >= 128) {
      X[(seed && seed.length || 0) & 127] = -1;
    }
    // Run the generator 512 times to further mix the state before using it.
    // Factoring this as a function slows the main generator, so it is just
    // unrolled here.  The weyl generator is not advanced while warming up.
    i = 127;
    for (j = 4 * 128; j > 0; --j) {
      v = X[(i + 34) & 127];
      t = X[i = ((i + 1) & 127)];
      v ^= v << 13;
      t ^= t << 17;
      v ^= v >>> 15;
      t ^= t >>> 12;
      X[i] = v ^ t;
    }
    // Storing state as object members is faster than using closure variables.
    me.w = w;
    me.X = X;
    me.i = i;
  }

  init(me, seed);
}

function copy(f, t) {
  t.i = f.i;
  t.w = f.w;
  t.X = f.X.slice();
  return t;
};

function impl(seed, opts) {
  if (seed == null) seed = +(new Date);
  var xg = new XorGen(seed),
      state = opts && opts.state,
      prng = function() { return (xg.next() >>> 0) / 0x100000000; };
  prng.double = function() {
    do {
      var top = xg.next() >>> 11,
          bot = (xg.next() >>> 0) / 0x100000000,
          result = (top + bot) / (1 << 21);
    } while (result === 0);
    return result;
  };
  prng.int32 = xg.next;
  prng.quick = prng;
  if (state) {
    if (state.X) copy(state, xg);
    prng.state = function() { return copy(xg, {}); }
  }
  return prng;
}

if (module && module.exports) {
  module.exports = impl;
} else if (define && define.amd) {
  define(function() { return impl; });
} else {
  this.xor4096 = impl;
}

})(
  this,                                     // window object or global
  (typeof module) == 'object' && module,    // present in node.js
  (typeof define) == 'function' && define   // present with an AMD loader
);

},{}],9:[function(require,module,exports){
// A Javascript implementaion of the "xorshift7" algorithm by
// François Panneton and Pierre L'ecuyer:
// "On the Xorgshift Random Number Generators"
// http://saluc.engr.uconn.edu/refs/crypto/rng/panneton05onthexorshift.pdf

(function(global, module, define) {

function XorGen(seed) {
  var me = this;

  // Set up generator function.
  me.next = function() {
    // Update xor generator.
    var X = me.x, i = me.i, t, v, w;
    t = X[i]; t ^= (t >>> 7); v = t ^ (t << 24);
    t = X[(i + 1) & 7]; v ^= t ^ (t >>> 10);
    t = X[(i + 3) & 7]; v ^= t ^ (t >>> 3);
    t = X[(i + 4) & 7]; v ^= t ^ (t << 7);
    t = X[(i + 7) & 7]; t = t ^ (t << 13); v ^= t ^ (t << 9);
    X[i] = v;
    me.i = (i + 1) & 7;
    return v;
  };

  function init(me, seed) {
    var j, w, X = [];

    if (seed === (seed | 0)) {
      // Seed state array using a 32-bit integer.
      w = X[0] = seed;
    } else {
      // Seed state using a string.
      seed = '' + seed;
      for (j = 0; j < seed.length; ++j) {
        X[j & 7] = (X[j & 7] << 15) ^
            (seed.charCodeAt(j) + X[(j + 1) & 7] << 13);
      }
    }
    // Enforce an array length of 8, not all zeroes.
    while (X.length < 8) X.push(0);
    for (j = 0; j < 8 && X[j] === 0; ++j);
    if (j == 8) w = X[7] = -1; else w = X[j];

    me.x = X;
    me.i = 0;

    // Discard an initial 256 values.
    for (j = 256; j > 0; --j) {
      me.next();
    }
  }

  init(me, seed);
}

function copy(f, t) {
  t.x = f.x.slice();
  t.i = f.i;
  return t;
}

function impl(seed, opts) {
  if (seed == null) seed = +(new Date);
  var xg = new XorGen(seed),
      state = opts && opts.state,
      prng = function() { return (xg.next() >>> 0) / 0x100000000; };
  prng.double = function() {
    do {
      var top = xg.next() >>> 11,
          bot = (xg.next() >>> 0) / 0x100000000,
          result = (top + bot) / (1 << 21);
    } while (result === 0);
    return result;
  };
  prng.int32 = xg.next;
  prng.quick = prng;
  if (state) {
    if (state.x) copy(state, xg);
    prng.state = function() { return copy(xg, {}); }
  }
  return prng;
}

if (module && module.exports) {
  module.exports = impl;
} else if (define && define.amd) {
  define(function() { return impl; });
} else {
  this.xorshift7 = impl;
}

})(
  this,
  (typeof module) == 'object' && module,    // present in node.js
  (typeof define) == 'function' && define   // present with an AMD loader
);


},{}],10:[function(require,module,exports){
// A Javascript implementaion of the "xorwow" prng algorithm by
// George Marsaglia.  See http://www.jstatsoft.org/v08/i14/paper

(function(global, module, define) {

function XorGen(seed) {
  var me = this, strseed = '';

  // Set up generator function.
  me.next = function() {
    var t = (me.x ^ (me.x >>> 2));
    me.x = me.y; me.y = me.z; me.z = me.w; me.w = me.v;
    return (me.d = (me.d + 362437 | 0)) +
       (me.v = (me.v ^ (me.v << 4)) ^ (t ^ (t << 1))) | 0;
  };

  me.x = 0;
  me.y = 0;
  me.z = 0;
  me.w = 0;
  me.v = 0;

  if (seed === (seed | 0)) {
    // Integer seed.
    me.x = seed;
  } else {
    // String seed.
    strseed += seed;
  }

  // Mix in string seed, then discard an initial batch of 64 values.
  for (var k = 0; k < strseed.length + 64; k++) {
    me.x ^= strseed.charCodeAt(k) | 0;
    if (k == strseed.length) {
      me.d = me.x << 10 ^ me.x >>> 4;
    }
    me.next();
  }
}

function copy(f, t) {
  t.x = f.x;
  t.y = f.y;
  t.z = f.z;
  t.w = f.w;
  t.v = f.v;
  t.d = f.d;
  return t;
}

function impl(seed, opts) {
  var xg = new XorGen(seed),
      state = opts && opts.state,
      prng = function() { return (xg.next() >>> 0) / 0x100000000; };
  prng.double = function() {
    do {
      var top = xg.next() >>> 11,
          bot = (xg.next() >>> 0) / 0x100000000,
          result = (top + bot) / (1 << 21);
    } while (result === 0);
    return result;
  };
  prng.int32 = xg.next;
  prng.quick = prng;
  if (state) {
    if (typeof(state) == 'object') copy(state, xg);
    prng.state = function() { return copy(xg, {}); }
  }
  return prng;
}

if (module && module.exports) {
  module.exports = impl;
} else if (define && define.amd) {
  define(function() { return impl; });
} else {
  this.xorwow = impl;
}

})(
  this,
  (typeof module) == 'object' && module,    // present in node.js
  (typeof define) == 'function' && define   // present with an AMD loader
);



},{}],11:[function(require,module,exports){
/*
Copyright 2014 David Bau.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

(function (pool, math) {
//
// The following constants are related to IEEE 754 limits.
//
var global = this,
    width = 256,        // each RC4 output is 0 <= x < 256
    chunks = 6,         // at least six RC4 outputs for each double
    digits = 52,        // there are 52 significant digits in a double
    rngname = 'random', // rngname: name for Math.random and Math.seedrandom
    startdenom = math.pow(width, chunks),
    significance = math.pow(2, digits),
    overflow = significance * 2,
    mask = width - 1,
    nodecrypto;         // node.js crypto module, initialized at the bottom.

//
// seedrandom()
// This is the seedrandom function described above.
//
function seedrandom(seed, options, callback) {
  var key = [];
  options = (options == true) ? { entropy: true } : (options || {});

  // Flatten the seed string or build one from local entropy if needed.
  var shortseed = mixkey(flatten(
    options.entropy ? [seed, tostring(pool)] :
    (seed == null) ? autoseed() : seed, 3), key);

  // Use the seed to initialize an ARC4 generator.
  var arc4 = new ARC4(key);

  // This function returns a random double in [0, 1) that contains
  // randomness in every bit of the mantissa of the IEEE 754 value.
  var prng = function() {
    var n = arc4.g(chunks),             // Start with a numerator n < 2 ^ 48
        d = startdenom,                 //   and denominator d = 2 ^ 48.
        x = 0;                          //   and no 'extra last byte'.
    while (n < significance) {          // Fill up all significant digits by
      n = (n + x) * width;              //   shifting numerator and
      d *= width;                       //   denominator and generating a
      x = arc4.g(1);                    //   new least-significant-byte.
    }
    while (n >= overflow) {             // To avoid rounding up, before adding
      n /= 2;                           //   last byte, shift everything
      d /= 2;                           //   right using integer math until
      x >>>= 1;                         //   we have exactly the desired bits.
    }
    return (n + x) / d;                 // Form the number within [0, 1).
  };

  prng.int32 = function() { return arc4.g(4) | 0; }
  prng.quick = function() { return arc4.g(4) / 0x100000000; }
  prng.double = prng;

  // Mix the randomness into accumulated entropy.
  mixkey(tostring(arc4.S), pool);

  // Calling convention: what to return as a function of prng, seed, is_math.
  return (options.pass || callback ||
      function(prng, seed, is_math_call, state) {
        if (state) {
          // Load the arc4 state from the given state if it has an S array.
          if (state.S) { copy(state, arc4); }
          // Only provide the .state method if requested via options.state.
          prng.state = function() { return copy(arc4, {}); }
        }

        // If called as a method of Math (Math.seedrandom()), mutate
        // Math.random because that is how seedrandom.js has worked since v1.0.
        if (is_math_call) { math[rngname] = prng; return seed; }

        // Otherwise, it is a newer calling convention, so return the
        // prng directly.
        else return prng;
      })(
  prng,
  shortseed,
  'global' in options ? options.global : (this == math),
  options.state);
}
math['seed' + rngname] = seedrandom;

//
// ARC4
//
// An ARC4 implementation.  The constructor takes a key in the form of
// an array of at most (width) integers that should be 0 <= x < (width).
//
// The g(count) method returns a pseudorandom integer that concatenates
// the next (count) outputs from ARC4.  Its return value is a number x
// that is in the range 0 <= x < (width ^ count).
//
function ARC4(key) {
  var t, keylen = key.length,
      me = this, i = 0, j = me.i = me.j = 0, s = me.S = [];

  // The empty key [] is treated as [0].
  if (!keylen) { key = [keylen++]; }

  // Set up S using the standard key scheduling algorithm.
  while (i < width) {
    s[i] = i++;
  }
  for (i = 0; i < width; i++) {
    s[i] = s[j = mask & (j + key[i % keylen] + (t = s[i]))];
    s[j] = t;
  }

  // The "g" method returns the next (count) outputs as one number.
  (me.g = function(count) {
    // Using instance members instead of closure state nearly doubles speed.
    var t, r = 0,
        i = me.i, j = me.j, s = me.S;
    while (count--) {
      t = s[i = mask & (i + 1)];
      r = r * width + s[mask & ((s[i] = s[j = mask & (j + t)]) + (s[j] = t))];
    }
    me.i = i; me.j = j;
    return r;
    // For robust unpredictability, the function call below automatically
    // discards an initial batch of values.  This is called RC4-drop[256].
    // See http://google.com/search?q=rsa+fluhrer+response&btnI
  })(width);
}

//
// copy()
// Copies internal state of ARC4 to or from a plain object.
//
function copy(f, t) {
  t.i = f.i;
  t.j = f.j;
  t.S = f.S.slice();
  return t;
};

//
// flatten()
// Converts an object tree to nested arrays of strings.
//
function flatten(obj, depth) {
  var result = [], typ = (typeof obj), prop;
  if (depth && typ == 'object') {
    for (prop in obj) {
      try { result.push(flatten(obj[prop], depth - 1)); } catch (e) {}
    }
  }
  return (result.length ? result : typ == 'string' ? obj : obj + '\0');
}

//
// mixkey()
// Mixes a string seed into a key that is an array of integers, and
// returns a shortened string seed that is equivalent to the result key.
//
function mixkey(seed, key) {
  var stringseed = seed + '', smear, j = 0;
  while (j < stringseed.length) {
    key[mask & j] =
      mask & ((smear ^= key[mask & j] * 19) + stringseed.charCodeAt(j++));
  }
  return tostring(key);
}

//
// autoseed()
// Returns an object for autoseeding, using window.crypto and Node crypto
// module if available.
//
function autoseed() {
  try {
    var out;
    if (nodecrypto && (out = nodecrypto.randomBytes)) {
      // The use of 'out' to remember randomBytes makes tight minified code.
      out = out(width);
    } else {
      out = new Uint8Array(width);
      (global.crypto || global.msCrypto).getRandomValues(out);
    }
    return tostring(out);
  } catch (e) {
    var browser = global.navigator,
        plugins = browser && browser.plugins;
    return [+new Date, global, plugins, global.screen, tostring(pool)];
  }
}

//
// tostring()
// Converts an array of charcodes to a string
//
function tostring(a) {
  return String.fromCharCode.apply(0, a);
}

//
// When seedrandom.js is loaded, we immediately mix a few bits
// from the built-in RNG into the entropy pool.  Because we do
// not want to interfere with deterministic PRNG state later,
// seedrandom will not call math.random on its own again after
// initialization.
//
mixkey(math.random(), pool);

//
// Nodejs and AMD support: export the implementation as a module using
// either convention.
//
if ((typeof module) == 'object' && module.exports) {
  module.exports = seedrandom;
  // When in node.js, try using crypto package for autoseeding.
  try {
    nodecrypto = require('crypto');
  } catch (ex) {}
} else if ((typeof define) == 'function' && define.amd) {
  define(function() { return seedrandom; });
}

// End anonymous scope, and pass initial values.
})(
  [],     // pool: entropy pool starts empty
  Math    // math: package containing random, pow, and seedrandom
);

},{"crypto":2}],12:[function(require,module,exports){
/**
 * This module is used to create different point distributions that can be
 * turned into different tile sets when made into a graph format. There are
 * various different distributions that can be used to create interesting
 * tile patterns when turned into a voronoi diagram. 
 * 
 * @class PointDistribution
 */

"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.random = random;
exports.square = square;
exports.squareJitter = squareJitter;
exports.hexagon = hexagon;
exports.jitteredGrid = jitteredGrid;
exports.poisson = poisson;
exports.recursiveWang = recursiveWang;
exports.circular = circular;

var _poissonDiskSample = require("poisson-disk-sample");

var _poissonDiskSample2 = _interopRequireDefault(_poissonDiskSample);

var _Vector = require("../geometry/Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Rectangle = require("../geometry/Rectangle");

var _Rectangle2 = _interopRequireDefault(_Rectangle);

var _Rand = require("./Rand");

var _Rand2 = _interopRequireDefault(_Rand);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Creates a random distribution of points in a particular bounding box
 * with a particular average distance between points.
 * 
 * @export
 * @param {Rectangle} bbox The bounding box to create the points in
 * @param {number} d Average distance between points
 * @param {number} [seed=null] If specified use a local seed for creating the point
 *  distribution. Otherwise, use the current global seed for generation
 * @returns {Vector[]} The list of randomly distributed points
 * @memberof PointDistribution
 */
function random(bbox, d) {
    var seed = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;

    var rng = seed ? new _Rand2.default(seed) : _Rand2.default;
    var nPoints = bbox.area / (d * d);

    var points = [];
    for (var i = 0; i < nPoints; i++) {
        points.push(rng.vector(bbox));
    }

    return points;
}

/**
 * Creates a square grid like distribution of points in a particular bounding
 * box with a particular distance between points.
 * 
 * @export
 * @param {Rectangle} bbox The bounding box to create the points in
 * @param {number} d Average distance between points
 * @returns {Vector[]} The list of randomly distributed points
 * @memberof PointDistribution
 */
function square(bbox, d) {
    var dx = d / 2;
    var dy = dx;
    var points = [];

    for (var y = 0; y < bbox.height; y += d) {
        for (var x = 0; x < bbox.width; x += d) {
            points.push(new _Vector2.default(dx + x, dy + y));
        }
    }

    return points;
}

/**
 * Creates a square grid like distribution of points in a particular bounding
 * box with a particular distance between points. The grid has also been
 * slightly purturbed or jittered so that the distribution is not completely
 * even.
 * 
 * @export
 * @param {Rectangle} bbox The bounding box to create the points in
 * @param {number} d Average distance between points
 * @param {number} amm The ammount of jitter that has been applied to the grid
 * @returns {Vector[]} The list of randomly distributed points
 * @memberof PointDistribution
 */
function squareJitter(bbox, d, amm) {
    return square(bbox, d).map(function (v) {
        return _Rand2.default.jitter(v, amm);
    });
}

/**
 * Creates a uniform hexagonal distribution of points in a particular bounding
 * box with a particular distance between points. The hexagons can also be
 * specified to have a particular width or height as well as creating hexagons
 * that have "pointy" tops or "flat" tops. By default it makes flat tops.
 * 
 * @export
 * @param {Rectangle} bbox The bounding box to create the points in
 * @param {number} d Average distance between points
 * @param {boolean} [flatTop=true] Create hecagons with flat tops by default.
 *  Otherwise go with the pointy top hexagons.
 * @param {number} w The width of the hexagon tiles
 * @param {number} h The height of the hexagon tiles
 * @returns {Vector[]} The list of randomly distributed points
 * @memberof PointDistribution
 */
function hexagon(bbox, d) {
    var flatTop = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;
    var w = arguments[3];
    var h = arguments[4];

    // Need to allow for the change of height and width
    // Running into "Uncaught Voronoi.closeCells() > this makes no sense!"

    var dx = d / 2;
    var dy = dx;
    var points = [];
    var altitude = Math.sqrt(3) / 2 * d;
    var N = Math.sqrt(bbox.area / (d * d));
    for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
            points.push(new _Vector2.default((0.5 + x) / N * bbox.width, (0.25 + 0.5 * x % 2 + y) / N * bbox.height));
            // points.push(new Vector((y % 2) * dx + x * d + dx, y * d + dy)); // Pointy Top
            // points.push(new Vector(x * d, (x % 2) * dx + y * d)); // Flat Top
        }
    }

    return points;
}

/**
 * Creates a blue noise distribution of points in a particular bounding box
 * with a particular average distance between points. This is done by
 * creating a grid system and picking a random point in each grid. This has
 * the effect of creating a less random distribution of points. The second
 * parameter m determins the spacing between points in the grid. This ensures
 * that no two points are in the same grid.
 * 
 * @summary Create a jittered grid based random blue noise point distribution.
 * 
 * @export
 * @param {Rectangle} bbox The bounding box to create the points in
 * @param {number} d Average distance between points
 * @param {number} [seed=null] If specified use a local seed for creating the point
 *  distribution. Otherwise, use the current global seed for generation
 * @param {number} [m=0] Maximum distance away from the edge of the grid that a
 *  point can be placed. This acts to increase the padding between points. 
 *  This makes the noise less random. This number must be smaller than d.
 * @returns {Vector[]} The list of randomly distributed points
 * @memberof PointDistribution
 */
function jitteredGrid(bbox, d) {
    var seed = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;
    var m = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;

    var rng = seed ? new _Rand2.default(seed) : _Rand2.default;

    var points = [];
    var pointBox = void 0;
    for (var y = 0; y < bbox.height - d; y += d) {
        for (var x = 0; x < bbox.width - d; x += d) {
            // Local bbox for the point to generate in
            var boxPos = new _Vector2.default(x - d + m, y - d + m);
            pointBox = new _Rectangle2.default(boxPos, x - m, y - m);
            points.push(rng.vector(pointBox));
        }
    }

    return points;
}

/**
 * Creates a poisson, or blue noise distribution of points in a particular
 * bounding box with a particular average distance between points. This is
 * done by using poisson disk sampling which tries to create points so that the
 * distance between neighbors is as close to a fixed number (the distance d)
 * as possible. This algorithm is implemented using the poisson dart throwing
 * algorithm.
 *  
 * @summary Create a blue noise distribution of points using poisson disk
 *  sampling.
 * 
 * @export
 * @param {Rectangle} bbox The bounding box to create the points in
 * @param {number} d Average distance between points
 * @returns {Vector[]} The list of randomly distributed points
 * 
 * @see {@link https://www.jasondavies.com/poisson-disc/}
 * @see {@link https://github.com/jeffrey-hearn/poisson-disk-sample}
 * @memberof PointDistribution
 */
function poisson(bbox, d) {
    var sampler = new _poissonDiskSample2.default(bbox.width, bbox.height, d, d);
    var solution = sampler.sampleUntilSolution();
    var points = solution.map(function (point) {
        return _Vector2.default.add(new _Vector2.default(point), bbox.position);
    });

    return points;
}

/**
 * Creates a blue noise distribution of points in a particular bounding box
 * with a particular average distance between points. This is done by using
 * recursive wang tiles to create this distribution of points.
 * 
 * @summary Not Implemented Yet
 * 
 * @export
 * @param {Rectangle} bbox The bounding box to create the points in
 * @param {number} d Average distance between points
 * @returns {Vector[]} The list of randomly distributed points
 * @memberof PointDistribution
 */
function recursiveWang(bbox, d) {
    throw "Error: Not Implemented";
}

/**
 * Creates a circular distribution of points in a particular bounding box
 * with a particular average distance between points.
 * 
 * @summary Not Implemented Yet
 * 
 * @export
 * @param {Rectangle} bbox The bounding box to create the points in
 * @param {number} d Average distance between points
 * @returns {Vector[]} The list of randomly distributed points
 * @memberof PointDistribution
 */
function circular(bbox, d) {
    throw "Error: Not Implemented";
}

},{"../geometry/Rectangle":18,"../geometry/Vector":20,"./Rand":13,"poisson-disk-sample":3}],13:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _seedRandom = require("seedRandom");

var _seedRandom2 = _interopRequireDefault(_seedRandom);

var _Vector = require("../geometry/Vector");

var _Vector2 = _interopRequireDefault(_Vector);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Rand = function () {
    /**
     * Wrapper library for David Bau's seeded random number generator which is a
     * wrapper for the Math.rand() functionality. This library is implemented to
     * fill out the functionality of the random capabilities as well as build
     * on the capabilities existing in the framework currently. This class can
     * be used on a global or local scale.
     * 
     * @example
     * Rand.seedRandom(0);      // Set the global seed
     * Rand.rand();             // Predictable based off seed
     * 
     * @example 
     * var rng = new Rand(0);   // Set the local rng seed
     * rng.rand();              // Predictable based off seed
     * 
     * Rand.rand();             // Unpredictable since global seed is not set
     * 
     * @see {@link https://github.com/davidbau/seedrandom}
     * @param {number|string} [seed=0] The seed to be applied to the local
     *  random number generator
     * @class Rand
     */
    function Rand() {
        var seed = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;

        _classCallCheck(this, Rand);

        this.rng = (0, _seedRandom2.default)(seed);
    }

    /**
     * Set the global seed for the seeded random number generator. After the seed has been
     * set. The random numbers will be predictable and repeatable given the same
     * input seed. If no seed is specified, then a random seed will be assigned to
     * the random number generator using added system entropy.
     * 
     * @export
     * @param {number|string} [seed=0] The seed to be applied to the global
     *  random number generator
     * @memberof Rand
     */


    _createClass(Rand, [{
        key: "setSeed",


        /**
         * Set the seed for the seeded random number generator. After the seed has been
         * set. The random numbers will be predictable and repeatable given the same
         * input seed. If no seed is specified, then a random seed will be assigned to
         * the random number generator using added system entropy.
         * 
         * @export
         * @param {number|string} [seed=0] The seed to be applied to the RNG
         * 
         * @memberof Rand
         */
        value: function setSeed(seed) {
            var options = {
                entropy: seed === undefined
            };
            this.rng = (0, _seedRandom2.default)(seed, options);
        }

        /**
         * Get a random number from 0 to 1. 
         * 
         * @static
         * @returns {number} random number from 0 to 1
         * 
         * @memberof Rand
         */

    }, {
        key: "rand",


        /**
         * Get a random number from 0 to 1.
         * 
         * @returns {number} random number from 0 to 1
         * 
         * @memberof Rand
         */
        value: function rand() {
            return this.rng();
        }

        /**
         * Private helper function:
         * 
         * Roll for a boolean value that is true @percent ammount of the time.
         * If the roll fails then return false. For example calling chance(0.3)
         * will return true 30% of the time. The input range
         * 
         * @private
         * @static
         * @param {number} percent Percent chance to get True. Value is in the range
         *  from 0 - 1. With 1 returning always true.
         * @memberOf Rand
         */

    }, {
        key: "chance",


        /**
         * Roll for a boolean value that is true @percent ammount of the time.
         * If the roll fails then return false. For example calling chance(0.3)
         * will return true 30% of the time. The input range
         * 
         * @param {number} percent Percent chance to get True. Value is in the range
         *  from 0 - 1. With 1 returning always true.
         * @memberOf Rand
         */
        value: function chance(percent) {
            return Rand._chance(Rand, percent);
        }

        /**
         * Private Helper Function:
         * Get a random float value in a particular range
         * 
         * @private
         * @static
         * @param {any} rng The local or global rng to use (Rand or this)
         * @param {number} min 
         * @param {number} max 
         * 
         * @memberof Rand
         */

    }, {
        key: "randRange",


        /**
         * Get a random float value in a particular range
         * 
         * @param {number} min 
         * @param {number} max 
         * @returns {number} Random float number from min (inclusive) 
         *  to max (exclusive)
         * 
         * @memberof Rand
         */
        value: function randRange(min, max) {
            return Rand._randRange(this, min, max);
        }

        /**
         * Private Helper Function:
         * Get a random int in a particular range (min and max inclusive)
         * 
         * @private
         * @static
         * @param {any} rng The local or global rng to use (Rand or this)
         * @param {number} min 
         * @param {number} max 
         * @returns {number} Random float number from min (inclusive) 
         *  to max (exclusive)
         * 
         * @memberOf Rand
         */

    }, {
        key: "randInt",


        /**
         * Get a random int in a particular range (min and max inclusive)
         * 
         * @param {number} min 
         * @param {number} max 
         * @returns {number} Random float number from min (inclusive) 
         *  to max (exclusive)
         * 
         * @memberOf Rand
         */
        value: function randInt(min, max) {
            return Rand._randInt(this, min, max);
        }

        /**
         * Private Helper Function:
         * Get the random hex value of a color represented in the hexidecimal format
         * 
         * @private
         * @static
         * @param {any} rng The local or global rng to use (Rand or this)
         * @returns {hex} The random hex value in the color spectrum
         * 
         * @memberOf Rand
         */

    }, {
        key: "randHex",


        /**
         * Get the random hex value of a color represented in the hexidecimal format
         * 
         * @returns {hex} 
         * 
         * @memberOf Rand
         */
        value: function randHex() {
            return Rand._randHex(this);
        }

        /**
         * Private Helper Function:
         * Get a random hex color string represented in "#HEXSTR" format
         * 
         * @private
         * @static
         * @param {any} rng The local or global rng to use (Rand or this)
         * @returns {string}
         * 
         * @memberOf Rand
         */

    }, {
        key: "randHexColor",


        /**
         * Get a random hex color string represented in "#HEXSTR" format
         * 
         * @static
         * @returns {string}
         * 
         * @memberOf Rand
         */
        value: function randHexColor() {
            return Rand._randHexColor(this);
        }

        //---- Random Geometry ----

        /**
         * Get a random vector in a bounding box
         * 
         * @private
         * @static
         * @param {any} rng The local or global rng to use (Rand or this)
         * @param {Rectangle} bbox The bounding box of the random vector
         * @returns {Vector} A random vector
         * 
         * @memberOf Rand
         */

    }, {
        key: "vector",


        /**
         * Get a random vector in a bounding box
         * 
         * @param {Rectangle} bbox The bounding box of the random vector
         * @returns {Vector} A random vector
         * 
         * @memberOf Rand
         */
        value: function vector(bbox) {
            return Rand._vector(this, bbox);
        }
    }, {
        key: "jitter",
        value: function jitter(v, max) {
            return Rand._jitter(this, v, max);
        }
    }], [{
        key: "setSeed",
        value: function setSeed() {
            var seed = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;

            var options = {
                global: true,
                entropy: seed === undefined
            };
            (0, _seedRandom2.default)(seed, options);
        }
    }, {
        key: "rand",
        value: function rand() {
            return Math.random();
        }
    }, {
        key: "_chance",
        value: function _chance(rng, percent) {
            return rng.rand() < percent;
        }

        /**
         * Roll for a boolean value that is true @percent ammount of the time.
         * If the roll fails then return false. For example calling chance(0.3)
         * will return true 30% of the time. The input range
         * 
         * @static
         * @param {number} percent Percent chance to get True. Value is in the range
         *  from 0 - 1. With 1 returning always true.
         * @memberOf Rand
         */

    }, {
        key: "chance",
        value: function chance(percent) {
            return Rand._chance(this, percent);
        }
    }, {
        key: "_randRange",
        value: function _randRange(rng, min, max) {
            return rng.rand() * (max - min) + min;
        }

        /**
         * Get a random float value in a particular range
         * 
         * @static
         * @param {number} min 
         * @param {number} max 
         * @returns {number} Random float number from min (inclusive) 
         *  to max (exclusive)
         * 
         * @memberof Rand
         */

    }, {
        key: "randRange",
        value: function randRange(min, max) {
            return Rand._randRange(Rand, min, max);
        }
    }, {
        key: "_randInt",
        value: function _randInt(rng, min, max) {
            return Math.floor(rng.rand() * (max - min + 1)) + min;
        }

        /**
         * Get a random int in a particular range (min and max inclusive)
         * 
         * @static
         * @param {number} min 
         * @param {number} max 
         * @returns {number} Random float number from min (inclusive) 
         *  to max (exclusive)
         * 
         * @memberOf Rand
         */

    }, {
        key: "randInt",
        value: function randInt(min, max) {
            return Rand._randInt(Rand, min, max);
        }
    }, {
        key: "_randHex",
        value: function _randHex(rng) {
            return rng.randInt(0, 16777215);
        }

        /**
         * Get the random hex value of a color represented in the hexidecimal format
         * 
         * @static
         * @returns {hex} 
         * 
         * @memberOf Rand
         */

    }, {
        key: "randHex",
        value: function randHex() {
            return Rand._randHex(Rand);
        }
    }, {
        key: "_randHexColor",
        value: function _randHexColor(rng) {
            return "#" + rng.randHex().toString(16);
        }

        /**
         * Get a random hex color string represented in "#HEXSTR" format
         * 
         * @static
         * @returns {string}
         * 
         * @memberOf Rand
         */

    }, {
        key: "randHexColor",
        value: function randHexColor() {
            return Rand._randHexColor(Rand);
        }
    }, {
        key: "_vector",
        value: function _vector(rng, bbox) {
            return new _Vector2.default(Rand.randRange(bbox.x, bbox.x + bbox.width), Rand.randRange(bbox.y, bbox.y + bbox.height));
        }

        /**
         * Get a random vector in a bounding box
         * 
         * @static
         * @param {Rectangle} bbox The bounding box of the random vector
         * @returns {Vector} A random vector
         * 
         * @memberOf Rand
         */

    }, {
        key: "vector",
        value: function vector(bbox) {
            return Rand._vector(Rand, bbox);
        }
    }, {
        key: "_jitter",
        value: function _jitter(rng, v, max) {
            return _Vector2.default.add(v, _Vector2.default.Polar(max, rng.randRange(0, 2 * Math.PI)));
        }
    }, {
        key: "jitter",
        value: function jitter(v, max) {
            return Rand._jitter(Rand, v, max);
        }
    }]);

    return Rand;
}();

exports.default = Rand;
module.exports = exports["default"];

},{"../geometry/Vector":20,"seedRandom":4}],14:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = binarySpacePartition;

var _Vector = require("../geometry/Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Rectangle = require("../geometry/Rectangle");

var _Rectangle2 = _interopRequireDefault(_Rectangle);

var _Rand = require("../utilities/Rand");

var _Rand2 = _interopRequireDefault(_Rand);

var _Redist = require("../utilities/Redist");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Create a Binary Space Partition Tree of a particular depth
 * 
 * @export
 * @param {Rectangle} bbox The rectangle that the BSP tree is created within
 * @param {number} depth The depth that the BSP tree is created down to
 * @param {number} splitRange 0-1, The ammount of deviation from the center
 *  that the binary split is allowed to take. 0 Means that the split always
 *  happens in the middle and 1 means that the split can happen at the edge of
 *  the rectangle.
 * @param {number} dropoutRate 0-1, the percent chance that when dividing a
 *  cell that it will not divide anymore
 * 
 * @returns 
 */
// Tuneable Parameters
// 1.25 guarentee split horiz or vert
// Redistribute the range to split

function binarySpacePartition(bbox, depth, splitRange, dropoutRate) {
    "use strict";
    // Move back to bbox.copy()

    var root = bbox;
    root.depth = 0;
    var frontier = [root];
    var splitDenom = (0, _Redist.exp)(splitRange, 7, false).map(0, 1, 2, 100);

    while (frontier.length > 0) {
        var node = frontier.pop();

        if (node !== root && _Rand2.default.chance(dropoutRate)) {
            continue;
        }

        var leftNode = void 0;
        var rightNode = void 0;

        var isWide = node.width / node.height > 1.25;
        var isTall = node.height / node.width > 1.25;
        var splitRand = !isWide && !isTall;

        var splitVertical = void 0;
        if (splitRand) {
            splitVertical = _Rand2.default.chance(0.5);
        } else {
            splitVertical = isTall;
        }

        if (splitVertical) {
            // Split vertical

            var splitY = node.height / 2 + _Rand2.default.randRange(-node.height / splitDenom, node.height / splitDenom);

            leftNode = new _Rectangle2.default(new _Vector2.default(node.x, node.y), node.width, splitY);
            rightNode = new _Rectangle2.default(new _Vector2.default(node.x, node.y + splitY), node.width, node.height - splitY);
        } else {
            // Split Horizontal

            var splitX = node.width / 2 + _Rand2.default.randRange(-node.width / splitDenom, node.width / splitDenom);

            leftNode = new _Rectangle2.default(new _Vector2.default(node.x, node.y), splitX, node.height);
            rightNode = new _Rectangle2.default(new _Vector2.default(node.x + splitX, node.y), node.width - splitX, node.height);
        }

        leftNode.depth = node.depth + 1;
        rightNode.depth = node.depth + 1;

        node.leftNode = leftNode;
        node.rightNode = rightNode;

        if (node.depth !== depth) {
            frontier.push(leftNode);
            frontier.push(rightNode);
        }
    }

    return root;
}
module.exports = exports["default"];

},{"../geometry/Rectangle":18,"../geometry/Vector":20,"../utilities/Rand":29,"../utilities/Redist":30}],15:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = recursiveVoronoi;

var _Diagram = require("../graph/Diagram");

var _Diagram2 = _interopRequireDefault(_Diagram);

var _PointDistribution = require("../utilities/PointDistribution");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function recursiveVoronoi(bbox, depth, density) {
    "use strict";

    var diagram = new _Diagram2.default((0, _PointDistribution.poisson)(bbox, density), bbox);

    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
        for (var _iterator = diagram.tiles[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
            var tile = _step.value;

            tile.depth = 0;

            generateInPolygon(tile, 0, density / 6);
        }
    } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
    } finally {
        try {
            if (!_iteratorNormalCompletion && _iterator.return) {
                _iterator.return();
            }
        } finally {
            if (_didIteratorError) {
                throw _iteratorError;
            }
        }
    }

    return diagram;
}

function generateInPolygon(poly, currentDepth, density) {
    "use strict";

    var subdiagram = new _Diagram2.default((0, _PointDistribution.poisson)(poly.bbox(), density), poly.bbox());
    var subTiles = clipToRegion(subdiagram, poly);
    // let subTiles = subdiagram.tiles;
    subTiles.forEach(function (tile) {
        return tile.depth = currentDepth + 1;
    });
    poly.children = subTiles;
}

// Return just the tiles that remain in that region
function clipToRegion(diagram, poly) {
    "use strict";

    var internalPolys = [];
    var contains = void 0;
    var _iteratorNormalCompletion2 = true;
    var _didIteratorError2 = false;
    var _iteratorError2 = undefined;

    try {
        for (var _iterator2 = diagram.tiles[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
            var tile = _step2.value;

            // contains = tile.corners.reduce((isTrue, corner) => {
            //     console.log(isTrue);
            //     return isTrue || poly.contains(corner);
            // }, false);

            contains = poly.contains(tile.center);

            if (contains) {
                internalPolys.push(tile);
            }
        }
    } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
    } finally {
        try {
            if (!_iteratorNormalCompletion2 && _iterator2.return) {
                _iterator2.return();
            }
        } finally {
            if (_didIteratorError2) {
                throw _iteratorError2;
            }
        }
    }

    return internalPolys;
}
module.exports = exports["default"];

},{"../graph/Diagram":23,"../utilities/PointDistribution":28}],16:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Line = function () {
    /**
     * @class Line
     * 
     * A simple line object that is an array of two vector points.
     * 
     * @property {Vector} p1
     * @property {vector} p2
     * 
     * @summary Creates an instance of Polygon.
     * @param {Vector} p1 The first point
     * @param {Vector} p2 The second point
     */
    function Line(p1, p2) {
        _classCallCheck(this, Line);

        this.p1 = p1;
        this.p2 = p2;
    }

    /**
     * Determine the orientation of the three input vectors. The output will be
     * one of the following:
     * counterclockwise, clockwise, or collinear
     * 
     * @private
     * @static
     * @param {Vector} v1 The first vector
     * @param {Vecotr} v2 The second vector
     * @param {Vector} v3 The third vector
     * @return {string} The orientation of the three points
     *  "counterclockwise", "clockwise", "collinear" 
     * @memberof Line
     * @see {@link http://www.geeksforgeeks.org/check-if-two-given-line-segments-intersect/}
     */


    _createClass(Line, [{
        key: "intersects",
        value: function intersects(line1, line2) {
            return Line.intersects(line1, line2);
        }
    }], [{
        key: "_orientation",
        value: function _orientation(v1, v2, v3) {
            var val = (v2.y - v1.y) * (v3.x - v2.x) - (v2.x - v1.x) * (v3.y - v2.y);

            if (val === 0) {
                return "Collinear";
            }
            return val > 0 ? "clockwise" : "counterclockwise";
        }

        /**
         * Private helper function to intersects function.
         * 
         * Given three colinear points this function checks if v2 is on the line segment
         * v1-v3.
         * 
         * @private
         * @static
         * @param {Vector} v1 The first point in the line segment
         * @param {Vector} v2 The point to test if it is in the middle
         * @param {Vector} v3 The second point in the line segment
         * @return {boolean} True if v2 lies on the segment created by v1 & v3
         * @memberof Line
         */

    }, {
        key: "_onSegment",
        value: function _onSegment(v1, v2, v3) {
            return v2.x <= Math.max(v1.x, v3.x) && v2.x >= Math.min(v1.x, v3.x) && v2.y <= Math.max(v1.y, v3.y) && v2.y >= Math.min(v1.y, v3.y);
        }

        /**
         * Determine if two line segments intersec
         * 
         * @static
         * @param {Line} line1 
         * @param {Line} line2 
         * @return {boolean} True if the lines intersect
         * @memberof Line
         * @see {@link http://www.geeksforgeeks.org/check-if-two-given-line-segments-intersect/}
         */

    }, {
        key: "intersects",
        value: function intersects(line1, line2) {
            // Find the four orientations that are needed for general and
            // special cases
            var o1 = Line._orientation(line1.p1, line1.p2, line2.p1);
            var o2 = Line._orientation(line1.p1, line1.p2, line2.p2);
            var o3 = Line._orientation(line2.p1, line2.p2, line1.p1);
            var o4 = Line._orientation(line2.p1, line2.p2, line1.p2);

            // General Case
            if (o1 != o2 && o3 != o4) {
                return true;
            }

            // Special Cases
            // line1.x, line1.y and line2.x are colinear and
            // line2.x lies on segment line1.xline1.y
            if (o1 == "Collinear" && Line._onSegment(line1.p1, line2.p1, line1.p2)) {
                return true;
            }

            // line1.x, line1.y and line2.x are colinear and
            // line2.y lies on segment line1.xline1.y
            if (o2 == "Collinear" && Line._onSegment(line1.p1, line2.p2, line1.p2)) {
                return true;
            }

            // line2.x, line2.y and line1.x are colinear and
            // line1.x lies on segment line2.xline2.y
            if (o3 == "Collinear" && Line._onSegment(line2.p1, line1.p1, line2.p2)) {
                return true;
            }

            // line2.x, line2.y and line1.y are colinear and
            // line1.y lies on segment line2.xline2.y
            if (o4 == "Collinear" && Line._onSegment(line2.p1, line1.p2, line2.p2)) {
                return true;
            }

            return false; // Doesn't fall in any of the above cases
        }
    }]);

    return Line;
}();

exports.default = Line;
module.exports = exports["default"];

},{}],17:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Vector = require("./Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Rectangle = require("./Rectangle");

var _Rectangle2 = _interopRequireDefault(_Rectangle);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Polygon = function () {
    /**
     * @class Polygon
     * 
     * Class to store polygon information in an array format that also gives it
     * extra functionality on top of it. This can also server as a base class
     * for more specific geometric shapes. At the moment this class assumes only
     * convex polygons for simplicity.
     * 
     * @summary Creates an instance of Polygon.
     * 
     * @property {Vector} center The center of the polygon. If not otherwise
     *  stated, the center defaults to the centriod. Any transformations on
     *  the polygon are done about the center of the polygon.
     * @property {Vector[]} corners The corner vectors of the polygon
     * 
     * @param {Vector[]} [corners=[]] The corner verticies of the polygon
     * @param {Vector} [center=average(verticies)] The center of the polygon.
     *  If a value is not provided the default value becomes the centroid of
     *  the verticies.
     */
    function Polygon() {
        var corners = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
        var center = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

        _classCallCheck(this, Polygon);

        this.corners = corners ? corners : [];
        this.center = center ? center : this.centroid();
        this._bbox = null;
    }

    /**
     * Get the centroid of the polygon. This is the vector average of all the
     * points that make up the polygon.
     * 
     * @returns {Vector} The centroid of the polygon
     * 
     * @memberOf Polygon
     */


    _createClass(Polygon, [{
        key: "centroid",
        value: function centroid() {
            return _Vector2.default.avg(this.corners);
        }

        /**
         * Get the bounding box of the polygon. That is the rectangle that will
         * minimally enclose the polygon.
         * 
         * @returns {Rectangle} The bounding box of the polygon
         * @memberof Polygon
         */

    }, {
        key: "bbox",
        value: function bbox() {
            if (this._bbox) {
                return this._bbox;
            }

            var minX = Infinity;
            var maxX = -Infinity;
            var minY = Infinity;
            var maxY = -Infinity;

            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = this.corners[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var corner = _step.value;

                    minX = Math.min(corner.x, minX);
                    maxX = Math.max(corner.x, maxX);
                    minY = Math.min(corner.y, minY);
                    maxY = Math.max(corner.y, maxY);
                }
            } catch (err) {
                _didIteratorError = true;
                _iteratorError = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion && _iterator.return) {
                        _iterator.return();
                    }
                } finally {
                    if (_didIteratorError) {
                        throw _iteratorError;
                    }
                }
            }

            this._bbox = new _Rectangle2.default(new _Vector2.default(minX, minY), maxX - minX, maxY - minY);

            return this._bbox;
        }

        /**
         * Get the polygon inset of the current polygon by the input ammount
         * 
         * @param ammount
         * @returns {Polygon} The inset of the current polygon by
         * @memberOf Polygon
         */

    }, {
        key: "inset",
        value: function inset(ammount) {
            return ammount;
        }

        /**
         * Returns wheither or not this polygon is a convex polygon. If this is
         * not true then the polygon is convace or more complex.
         * 
         * @returns {boolean} If the polygon is convex
         * @memberOf Polygon
         */

    }, {
        key: "isConvex",
        value: function isConvex() {}
    }, {
        key: "rotate",
        value: function rotate() {}

        /**
         * Determine if the point is contained within the polygon
         * 
         * @param {Vector} vector
         * 
         * @see {@link https://github.com/substack/point-in-polygon/blob/master/index.js}
         * @memberOf Polygon
         */

    }, {
        key: "contains",
        value: function contains(vector) {
            if (!this.bbox().contains(vector)) {
                return false;
            }

            var len = this.corners.length;
            var x = vector.x;
            var y = vector.y;
            var inside = false;
            for (var i = 0, j = len - 1; i < len; j = i++) {
                var xi = this.corners[i].x,
                    yi = this.corners[i].y;
                var xj = this.corners[j].x,
                    yj = this.corners[j].y;

                var intersect = yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi;
                if (intersect) {
                    inside = !inside;
                }
            }

            return inside;
        }
    }]);

    return Polygon;
}();

exports.default = Polygon;
module.exports = exports["default"];

},{"./Rectangle":18,"./Vector":20}],18:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Vector = require("./Vector");

var _Vector2 = _interopRequireDefault(_Vector);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Rectangle = function () {
    /** 
     * @class Rectangle
     * @extends Polygon
     * 
     * Class to store array information about a rectangle
     * 
     * @property {Vector} position
     * @property {number} x
     * @property {number} y
     * @property {number} width
     * @property {number} height
     * 
     * @param {Vector} position
     * @param {number} width
     * @param {number} height
     */

    function Rectangle(position, width, height) {
        _classCallCheck(this, Rectangle);

        this.position = position;
        this.x = position.x;
        this.y = position.y;
        this.br = position;
        this.bl = _Vector2.default.add(position, new _Vector2.default(width, 0));
        this.tr = _Vector2.default.add(position, new _Vector2.default(width, height));
        this.tl = _Vector2.default.add(position, new _Vector2.default(0, height));
        this.width = width;
        this.height = height;
        this.area = width * height;
    }

    _createClass(Rectangle, [{
        key: "copy",
        value: function copy() {
            return Rectangle.copy(this);
        }
    }, {
        key: "intersects",


        /**
         * Determine if this rectangle is intersecting the other rectangle.
         * Determines if the rectangles segments overlap eachother.
         * 
         * @param {Rectangle} other The other rectangle
         * @returns {boolean} True if the rectangles are intersecting
         * @memberof Rectangle
         */
        value: function intersects(other) {
            return Rectangle.intersects(this, other);
        }

        /**
         * Determine if two rectangles collide with eachother. This is true when two
         * rectangles intersect eachother or one of the rectangles is contained
         * witin another rectangle.
         * 
         * @static
         * @param {Rectangle} rect1 The first rectangle
         * @param {Rectangle} rect2 The second rectangle
         * @returns {boolean} True if the two rectangles collide with eachother
         * @memberof Rectangle
         */

    }, {
        key: "collides",


        /**
         * Determine if this rectangle collides with another rectangle. This is true
         * when two rectangles intersect eachother or one of the rectangles is 
         * contained witin another rectangle.
         * 
         * @param {Rectangle} other The other rectangle
         * @returns {boolean} True if the two rectangles collide with eachother
         * @memberof Rectangle
         */
        value: function collides(other) {
            return Rectangle.collides(this, other);
        }

        /**
         * Determine if a point is contained within the rectangle.
         * 
         * @param {Vector} vector The point to be tested
         * 
         * @returns {boolean} True if the point is contained within the rectangle
         * @memberof Rectangle
         */

    }, {
        key: "contains",
        value: function contains(vector) {
            return vector.x > this.position.x && vector.x < this.position.x + this.width && vector.y > this.position.y && vector.y < this.position.y + this.height;
        }
    }], [{
        key: "copy",
        value: function copy() {
            return new Rectangle(this.position, this.width, this.height);
        }

        /**
         * Determine if the two rectangles are intersecting, if the segments overlap
         * eachother.
         * 
         * @static
         * @param {any} rect1 The first rectangle
         * @param {any} rect2 The second rectangle
         * @returns {boolean} True if the two rectangles intersect
         * @memberof Rectangle
         */

    }, {
        key: "intersects",
        value: function intersects(rect1, rect2) {
            return rect1.x <= rect2.x + rect2.width && rect2.x <= rect1.x + rect1.width && rect1.y <= rect2.y + rect2.height && rect2.y <= rect1.y + rect1.height;
        }
    }, {
        key: "collides",
        value: function collides(rect1, rect2) {
            return rect1.x < rect2.x + rect2.width && rect1.x + rect1.width > rect2.x && rect1.y < rect2.y + rect2.height && rect1.height + rect1.y > rect2.y;
        }
    }]);

    return Rectangle;
}();

exports.default = Rectangle;
module.exports = exports["default"];

},{"./Vector":20}],19:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _Vector = require("./Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Polygon2 = require("./Polygon");

var _Polygon3 = _interopRequireDefault(_Polygon2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Triangle = function (_Polygon) {
    _inherits(Triangle, _Polygon);

    /** 
     * @class Triangle
     * @extends Polygon
     * 
     * Class to store array information about a rectangle
     * 
     * @property {Vector} verticies The three verticies
     * 
     * @param {Vector} v1 The first position
     * @param {Vector} v2 The second position
     * @param {Vector} v3 The third position
     */

    function Triangle(v1, v2, v3) {
        _classCallCheck(this, Triangle);

        var verticies = [v1, v2, v3];

        var _this = _possibleConstructorReturn(this, (Triangle.__proto__ || Object.getPrototypeOf(Triangle)).call(this, verticies));

        _this.v1 = v1;
        _this.v2 = v2;
        _this.v3 = v3;
        return _this;
    }

    return Triangle;
}(_Polygon3.default);

exports.default = Triangle;
module.exports = exports["default"];

},{"./Polygon":17,"./Vector":20}],20:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Vector = function () {
    /**
     * @class Vector
     *
     * This is a basic vector class that is used for geometry, position inforamtion,
     * movement infomation, and more complex structures.
     * The vector class follows a immutable paradigm where changes are not made to the
     * vectors themselves. Any change to a vector is returned as a new vector that
     * must be captured.
     *
     * @description This vector class was constructed so that it can mirror two types of common
     * point/vector type objects. This is having object properties stored as object
     * properties (eg. vector.x, vector.y) or as list properties, [x, y] which can
     * be accessed by vector[0], or vector[1].
     *
     * @summary Create a 2D Vector object
     *
     * @property {number} x The x vector component
     * @property {number} y The y vector component
     * @property {number} 0 The x vector component
     * @property {number} 1 The y vector component
     *
     * @param {number|Vector} x The x component or another vector
     * @param {number} [y] The y component
     */
    function Vector(x, y) {
        _classCallCheck(this, Vector);

        if (x instanceof Vector || x.x && x.y && !y) {
            this._set(x.x, x.y);
        } else {
            this._set(x, y);
        }
    }

    //---- Alternate Polar Constructor ----

    /**
     * Create a vector from polar coordinates
     *
     * @static
     * @param {number} r The radius of the vector
     * @param {number} theta The angle of the vector in radians.
     *  Should be between 0 and 2*PI
     * @returns The rectangular vector produced from the polar coordinates
     *
     * @memberOf Vector
     */


    _createClass(Vector, [{
        key: "_set",


        //---- Helper Functions ----

        /**
         * Internal Helper Function for setting variable properties
         *
         * @private
         * @param {number} x The x component
         * @param {number} y The y component
         * @memberof Vector
         */
        value: function _set(x, y) {
            this.__proto__[0] = x;
            this.__proto__[1] = y;
            this.x = x;
            this.y = y;
        }

        /**
         * Get the vector key:Symbol representation [x, y]
         * Currently has the same behavior as list()
         * @returns {Symbol} The vector key element
         * @memberof Vector
         */

    }, {
        key: "key",
        value: function key() {
            return this.list();
            // return Symbol(this.list()); // Not currently working as a key symbol
        }

        /**
         * Get the vector in list form as [x, y]
         *
         * @returns {number[]} List representation of the vector of length 2
         * @memberof Vector
         */

    }, {
        key: "list",
        value: function list() {
            return [this.x, this.y];
        }

        /**
         * Returns the vector as a string of (x, y)
         *
         * @returns {string} The string representation of a vector in (x, y) form
         * @memberof Vector
         */

    }, {
        key: "toString",
        value: function toString() {
            return "(" + this.x + ", " + this.y + ")";
        }

        /**
         * Get a copy of the input vector
         *
         * @param {Vector} v the vector to be coppied
         * @returns {Vector} The vector copy
         * @memberof Vector
         */

    }, {
        key: "copy",
        value: function copy() {
            return Vector.copy(this);
        }

        /**
         * Get a copy of the input vector
         *
         * @static
         * @param {Vector} v the vector to be coppied
         * @returns {Vector} The vector copy
         * @memberof Vector
         */

    }, {
        key: "add",


        /**
         * Add this vector with another vector element wise
         *
         * @param {Vector} other The other vector
         * @returns {Vector} The vector result of adding the two vectors
         * @memberof Vector
         */
        value: function add(other) {
            return Vector.add(this, other);
        }

        /**
         * Subtract two vectors element wise
         *
         * @static
         * @param {Vector} a The first vector
         * @param {Vector} b The second Vector
         * @returns {Vector} The vector result of subtracting the two vectors
         * @memberof Vector
         */

    }, {
        key: "subtract",


        /**
         * Subtract this vector with another vector element wise
         *
         * @param {Vector} other The other vector
         * @returns {Vector} The vector result of subtracting the two vectors
         * @memberof Vector
         */
        value: function subtract(other) {
            return Vector.subtract(this, other);
        }

        /**
         * Multiply the vector by a scalar value
         *
         * @param {number} scalar The number to multiply the vector by
         * @returns {Vector} The result of multiplying the vector by a scalar
         *  element wise
         * @memberof Vector
         */

    }, {
        key: "multiply",
        value: function multiply(scalar) {
            return new Vector(this.x * scalar, this.y * scalar);
        }

        /**
         * Divide the vector by a scalar value
         *
         * @param {number} scalar
         * @returns {Vector} The result of multiplying the vector by a scalar
         * @memberof Vector
         */

    }, {
        key: "divide",
        value: function divide(scalar) {
            return new Vector(this.x / scalar, this.y / scalar);
        }

        //---- Advanced Vector Functions ----

        /**
         * Get the magnitude of the vector
         *
         * @returns {number} The magniture of the vector
         * @memberof Vector
         */

    }, {
        key: "magnitude",
        value: function magnitude() {
            return Math.sqrt(this.x * this.x + this.y * this.y);
        }

        // Get the unit vector
        /**
         * Get the normal vector of the current vector.
         *
         * @returns {Vector} A vector that is the normal compenent of the vector
         * @memberof Vector
         */

    }, {
        key: "normalize",
        value: function normalize() {
            return Vector.divide(this.magnitude());
        }

        /**
         * Get the get the current vector rotated by a certain ammount
         *
         * @param {number} radians
         * @returns {Vector} The vector that results from rotating the current
         *  vector by a particular ammount
         * @memberof Vector
         */

    }, {
        key: "rotate",
        value: function rotate(radians) {
            var c = Math.cos(radians);
            var s = Math.sin(radians);
            return new Vector(c * this.x - s * this.y, s * this.x + c * this.y);
        }

        /**
         * Get the dot product of two vectors
         *
         * @static
         * @param {Vector} a The first vector
         * @param {Vector} b The second vector
         * @returns {number} The dot product of the two vectors
         * @memberof Vector
         */

    }, {
        key: "dot",


        /**
         * Get the dot product of this vector and another vector
         *
         * @param {Vector} other The other vector
         * @returns {number} The dot product of this and the other vector
         * @memberof Vector
         */
        value: function dot(other) {
            return Vector.dot(this, other);
        }

        /**
         * Get the cross product of two vectors
         *
         * @static
         * @param {Vector} a The first vector
         * @param {Vector} b The second vector
         * @returns {number} The cross product of the two vectors
         * @memberof Vector
         */

    }, {
        key: "cross",


        /**
         * Get the cross product of this and the other vector
         *
         * @param {Vector} other The other vector
         * @returns {number} The cross product of this and the other vector
         * @memberof Vector
         */
        value: function cross(other) {
            return Vector.cross(this, other);
        }

        //---- Purely Static Vector Functions ----

        /**
         * Get the midpoint between two vectors
         *
         * @static
         * @param {Vector} a The first vector
         * @param {Vector} b The second vector
         * @returns The midpoint of two vectors
         * @memberof Vector
         */

    }, {
        key: "perpendiculars",


        /**
         * Get the two normal vectors that are perpendicular to the current vector
         *
         * @returns {Vector[]} The two normal vectors that are perpendicular
         *  to the vector. The first vector is the normal vector that is +90 deg or
         *  +PI/2 rad. The second vector is the noraml vector that is -90 deg or
         *  -PI/2 rad.
         * @memberof Vector
         */
        value: function perpendiculars() {
            var plus90 = new Vector(-this.y, this.x).normalize();
            var minus90 = new Vector(this.y, -this.x).normalize();
            return [plus90, minus90];
        }

        //---- Standard Static Vector Objects ----

        /**
         * Get a vector of no magnitude and no direction
         *
         * @static
         * @function
         * @returns {Vector} Vector of magnitude zero
         * @memberof Vector
         */

    }], [{
        key: "Polar",
        value: function Polar(r, theta) {
            return new Vector(r * Math.cos(theta), r * Math.sin(theta));
        }
    }, {
        key: "copy",
        value: function copy(v) {
            return new Vector(v.x, v.y);
        }

        /**
         * Returns true if the two vector positions are equal
         *
         * @static
         * @param {Vector} v1 The first vector
         * @param {Vector} v2 The second vector
         * @returns {boolean} True if the vector positions are equal
         * @memberOf Vector
         */

    }, {
        key: "equals",
        value: function equals(v1, v2) {
            return v1.x === v2.x && v1.y === v2.y;
        }

        //---- Basic Math Functions ----

        /**
         * Add two vectors element wise
         *
         * @static
         * @param {Vector} a The first vector
         * @param {Vector} b The second vector
         * @returns {Vector} The vector result of adding the two vectors
         * @memberof Vector
         */

    }, {
        key: "add",
        value: function add(a, b) {
            return new Vector(a.x + b.x, a.y + b.y);
        }
    }, {
        key: "subtract",
        value: function subtract(a, b) {
            return new Vector(a.x - b.x, a.y - b.y);
        }
    }, {
        key: "dot",
        value: function dot(a, b) {
            return a.x * b.x + a.y * b.y;
        }

        /**
         * Get the average location between several vectors
         *
         * @param {Vector[]} vectors The list of vectors to average
         * @memberof Vector
         */

    }, {
        key: "avg",
        value: function avg(vectors) {
            var average = Vector.zero();

            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = vectors[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var vector = _step.value;

                    average = Vector.add(average, vector);
                }
            } catch (err) {
                _didIteratorError = true;
                _iteratorError = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion && _iterator.return) {
                        _iterator.return();
                    }
                } finally {
                    if (_didIteratorError) {
                        throw _iteratorError;
                    }
                }
            }

            return average.divide(vectors.length);
        }
    }, {
        key: "cross",
        value: function cross(a, b) {
            return a.x * b.y - a.y * b.x;
        }
    }, {
        key: "midpoint",
        value: function midpoint(a, b) {
            return new Vector((a.x + b.x) / 2, (a.y + b.y) / 2);
        }

        /**
         * Get the projection of vector a onto vector b
         *
         * @static
         * @param {Vector} a The first vector
         * @param {Vector} b The second vector
         * @returns The projection vector of a onto b
         * @memberof Vector
         *
         * @todo Add assertion for non-zero length b vector
         */

    }, {
        key: "proj",
        value: function proj(a, b) {
            return b.multiply(Vector.dot(a, b) / Math.pow(b.magnitude(), 2));
        }

        /**
         * Get the angle between two vectors
         *
         * @static
         * @param {Vector} a The frist vector
         * @param {Vector} b The second vector
         * @returns The angle between vector a and vector b
         * @memberof Vector
         */

    }, {
        key: "angle",
        value: function angle(a, b) {
            return Math.acos(Vector.dot(a, b) / (a.magnitude() * b.magnitude()));
        }

        /**
         * Get the euclidean distance between two vectors
         *
         * @static
         * @param {Vector} a The first vector
         * @param {Vector} b The second vector
         * @returns The euclidean distance between a and b
         * @see {@link dist2}
         * @memberof Vector
         */

    }, {
        key: "distance",
        value: function distance(a, b) {
            return Math.sqrt(Vector.dist2(a, b));
        }

        /**
         * Get the euclidean distnace squared between two vectors.
         * This is used as a helper for the distnace function but can be used
         * to save on speed by not doing the square root operation.
         *
         * @static
         * @param {Vector} a The first vector
         * @param {Vector} b The second vector
         * @returns The euclidean distance squared between vector a and vector b
         * @see {@link distnace}
         * @memberof Vector
         */

    }, {
        key: "dist2",
        value: function dist2(a, b) {
            var dx = a.x - b.x;
            var dy = a.y - b.y;
            return dx * dx + dy * dy;
        }

        /**
         * Get the shortest distance between the point p and the line
         * segment v to w.
         *
         * @static
         * @param {Vector} p The vector point
         * @param {Vector} v The first line segment endpoint
         * @param {Vector} w The second line segment endpoint
         * @returns The shortest euclidean distance between point
         * @see {@link distToSeg2}
         * @see {@link http://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment}
         * @memberof Vector
         */

    }, {
        key: "distToSeg",
        value: function distToSeg(p, v, w) {
            return Math.sqrt(Vector.distToSeg2(p, v, w));
        }

        /**
         * Get the shortest distance squared between the point p and the line
         * segment v to w.
         *
         * @static
         * @param {Vector} p The vector point
         * @param {Vector} v The first line segment endpoint
         * @param {Vector} w The second line segment endpoint
         * @returns The shortest euclidean distance squared between point
         * @see {@link distToSeg}
         * @see {@link http://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment}
         * @memberof Vector
         */

    }, {
        key: "distToSegSquared",
        value: function distToSegSquared(p, v, w) {
            var l = Vector.dist2(v, w);
            if (l === 0) {
                return Vector.dist2(p, v);
            }
            var t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l;
            t = Math.max(0, Math.min(1, t));
            return Vector.dist2(p, new Vector(v.x + t * (w.x - v.x), v.y + t * (w.y - v.y)));
        }
    }, {
        key: "zero",
        value: function zero() {
            "use strict";

            return new Vector(0, 0);
        }

        /**
         * Get the unit vector pointing in the positive y direction
         *
         * @static
         * @function
         * @returns {Vector} Unit vector pointing up
         * @memberof Vector
         */

    }, {
        key: "up",
        value: function up() {
            "use strict";

            return new Vector(0, 1);
        }

        /**
         * Get the unit vector pointing in the negative y direction
         *
         * @static
         * @function
         * @returns {Vector} Unit vector pointing down
         * @memberof Vector
         */

    }, {
        key: "down",
        value: function down() {
            "use strict";

            return new Vector(0, -1);
        }

        /**
         * Get the unit vector pointing in the negative x direction
         *
         * @static
         * @function
         * @returns {Vector} Unit vector pointing right
         * @memberof Vector
         */

    }, {
        key: "left",
        value: function left() {
            "use strict";

            return new Vector(-1, 0);
        }

        /**
         * Get the unit vector pointing in the positive x direction
         *
         * @static
         * @function
         * @returns {Vector} Unit vector pointing right
         * @memberof Vector
         */

    }, {
        key: "right",
        value: function right() {
            "use strict";

            return new Vector(1, 0);
        }
    }]);

    return Vector;
}();

exports.default = Vector;
module.exports = exports["default"];

},{}],21:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _Vector2 = require("../geometry/Vector");

var _Vector3 = _interopRequireDefault(_Vector2);

var _Polygon = require("../geometry/Polygon");

var _Polygon2 = _interopRequireDefault(_Polygon);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Center = function (_Vector) {
    _inherits(Center, _Vector);

    /**
     * A center connection and location in a graph object
     * 
     * @property {number} id The id of the center in the graph object
     * @property {Polygon} neighbors Set of adjacent polygon centers
     * @property {Line[]} borders Set of bordering edges
     * @property {Polygon} corners Set of polygon corners
     * @property {boolean} border Is this polygon touching the border edge
     * @property {object} data The data stored by the center object. This is the
     *  data that is to be changed by the user
     * @property {Center} parent The parent object to the current object. The
     *  default is null, there is no parent.
     * @property {Center[]} children The children objects to the current object.
     *  The default is an empty list
     * 
     * @param {Vector} position The location of the Center object
     * 
     * @class Center
     * @extends {Vector}
     */
    function Center(position) {
        var parent = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
        var children = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;

        _classCallCheck(this, Center);

        // Diagram Properties
        var _this = _possibleConstructorReturn(this, (Center.__proto__ || Object.getPrototypeOf(Center)).call(this, position));

        _this.id = -1;
        _this.neighbors = []; // Centers
        _this.borders = []; // Edges
        _this.corners = [];
        _this.border = false;
        _this.tile = null;

        // Higher Level Properties
        _this.data = {};
        return _this;
    }

    return Center;
}(_Vector3.default);

exports.default = Center;
module.exports = exports["default"];

},{"../geometry/Polygon":17,"../geometry/Vector":20}],22:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _Vector2 = require("../geometry/Vector");

var _Vector3 = _interopRequireDefault(_Vector2);

var _Polygon = require("../geometry/Polygon");

var _Polygon2 = _interopRequireDefault(_Polygon);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Corner = function (_Vector) {
    _inherits(Corner, _Vector);

    /**
     * A corner connection and location in a graph object
     * 
     * @property {number} id The id of the corner in the graph object
     * @property {Polygon} touches Set of polygon centers touching this objecyt
     * @property {Line[]} protrudes Set of edges that are connected to this corner
     * @property {Polygon} adjacent Set of corners that connected to this corner
     * 
     * @class Corner
     * @extends {Vector}
     */
    function Corner(position) {
        _classCallCheck(this, Corner);

        var _this = _possibleConstructorReturn(this, (Corner.__proto__ || Object.getPrototypeOf(Corner)).call(this, position));

        _this.id = -1;
        _this.touches = []; // Centers
        _this.protrudes = []; // Edges
        _this.adjacent = []; // Corners
        return _this;
    }

    return Corner;
}(_Vector3.default);

exports.default = Corner;
module.exports = exports["default"];

},{"../geometry/Polygon":17,"../geometry/Vector":20}],23:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Graph2 = require("./Graph");

var _Graph3 = _interopRequireDefault(_Graph2);

var _Tile = require("./Tile");

var _Tile2 = _interopRequireDefault(_Tile);

var _Vector = require("../geometry/Vector");

var _Vector2 = _interopRequireDefault(_Vector);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Find a way to implement kdtrees to speed up tile selection from a point
// import KDTree from "static-kdtree";

var Diagram = function (_Graph) {
    _inherits(Diagram, _Graph);

    /**
     * Creates an instance of Diagram.
     * 
     * @param {any} points 
     * @param {any} bbox 
     * @param {number} [relaxations=0] 
     * @param {boolean} [improveCorners=false] 
     * 
     * @class Diagram
     * @extends Graph
     */
    function Diagram(points, bbox) {
        var relaxations = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
        var improveCorners = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

        _classCallCheck(this, Diagram);

        var _this = _possibleConstructorReturn(this, (Diagram.__proto__ || Object.getPrototypeOf(Diagram)).call(this, points, bbox, relaxations, improveCorners));

        _this.tiles = [];
        _this._createTiles();
        return _this;
    }

    /**
     * 
     * 
     * @memberof Diagram
     */


    _createClass(Diagram, [{
        key: "_createTiles",
        value: function _createTiles() {
            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = this.centers[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var center = _step.value;

                    var tile = new _Tile2.default(center, center.corners, center.borders);
                    center.tile = tile;
                    this.tiles.push(tile);
                }

                // Connect together the tile objects as neighbors
            } catch (err) {
                _didIteratorError = true;
                _iteratorError = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion && _iterator.return) {
                        _iterator.return();
                    }
                } finally {
                    if (_didIteratorError) {
                        throw _iteratorError;
                    }
                }
            }

            var _iteratorNormalCompletion2 = true;
            var _didIteratorError2 = false;
            var _iteratorError2 = undefined;

            try {
                for (var _iterator2 = this.tiles[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                    var _tile = _step2.value;

                    _tile.neighbors = _tile.center.neighbors.map(function (center) {
                        return center.tile;
                    });
                }
            } catch (err) {
                _didIteratorError2 = true;
                _iteratorError2 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion2 && _iterator2.return) {
                        _iterator2.return();
                    }
                } finally {
                    if (_didIteratorError2) {
                        throw _iteratorError2;
                    }
                }
            }
        }

        /**
         * This function is used to call cellular automita on the graph object.
         * The ruleset function should follow the following properties so that
         * the automation can run properly. See the example for the details
         * 
         * @summary Run a generation of cellular automation according to a user
         *  specified rule set
         * 
         * @param {function} ruleset The
         * 
         * @example
         * 
         * var gameOfLife = function(center) {
         *   var n = center.neighbors.length;
         *   return { 
         *     alive: center.data.alive && (n === 2 || n === 3) ||
         *           !center.data.alive && n === 3
         *   };
         * }
         * 
         * @todo Find a New Name
         * @memberOf Diagram
         */

    }, {
        key: "_generate",
        value: function _generate(ruleset) {
            // Run cellular automita
            var _iteratorNormalCompletion3 = true;
            var _didIteratorError3 = false;
            var _iteratorError3 = undefined;

            try {
                for (var _iterator3 = this.centers[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
                    var center = _step3.value;

                    center._data = ruleset(center);
                }

                // Update automita actions
            } catch (err) {
                _didIteratorError3 = true;
                _iteratorError3 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion3 && _iterator3.return) {
                        _iterator3.return();
                    }
                } finally {
                    if (_didIteratorError3) {
                        throw _iteratorError3;
                    }
                }
            }

            var _iteratorNormalCompletion4 = true;
            var _didIteratorError4 = false;
            var _iteratorError4 = undefined;

            try {
                for (var _iterator4 = this.centers[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
                    var _center = _step4.value;

                    // Update only the new data that has changed
                    for (var key in _center._data) {
                        if (_center._data.hasOwnProperty(key)) {
                            _center.data[key] = _center._data[key];
                        }
                    }
                    delete _center._data;
                }
            } catch (err) {
                _didIteratorError4 = true;
                _iteratorError4 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion4 && _iterator4.return) {
                        _iterator4.return();
                    }
                } finally {
                    if (_didIteratorError4) {
                        throw _iteratorError4;
                    }
                }
            }
        }
    }, {
        key: "initialize",
        value: function initialize(ruleset) {
            this._generate(ruleset);
        }
    }, {
        key: "iterate",
        value: function iterate(ruleset) {
            this._generate(ruleset);
        }

        /**
         * Get the tile that contains the specific location
         * 
         * @param {Vector} position The position which contains the desired tile 
         * 
         * @return {Tile} The tile at the position
         * 
         * @memberOf Diagram
         */

    }, {
        key: "getTile",
        value: function getTile(position) {
            if (!this.bbox.contains(position)) {
                return null;
            }

            var minDist = Infinity;
            var closest = this.tiles[0];
            var dist = void 0;

            var _iteratorNormalCompletion5 = true;
            var _didIteratorError5 = false;
            var _iteratorError5 = undefined;

            try {
                for (var _iterator5 = this.tiles[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
                    var tile = _step5.value;

                    dist = _Vector2.default.dist2(tile.center, position);

                    if (dist < minDist) {
                        minDist = dist;
                        closest = tile;
                    }
                }
            } catch (err) {
                _didIteratorError5 = true;
                _iteratorError5 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion5 && _iterator5.return) {
                        _iterator5.return();
                    }
                } finally {
                    if (_didIteratorError5) {
                        throw _iteratorError5;
                    }
                }
            }

            return closest;
        }

        /**
         * Get the path between two tiles on the diagram. This path includes both
         * the start tile and the end tile on the graph.
         * 
         * @param {Tile} start The starting tile to search from
         * @param {Tile} end The ending tile to search to
         * @param {Number} [Iterations=0]
         * @return {Tile[]} A resulting path between two tiles
         *  Returned of the form [start, ..., end]
         * 
         * @memberOf Diagram
         */

    }, {
        key: "getPath",
        value: function getPath(start, end) {
            var iterations = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 100;

            var curTile = start;
            var path = [start];
            var direction = void 0;

            while (!_Vector2.default.equals(curTile.center, end.center)) {
                direction = _Vector2.default.subtract(end.center, curTile.center);

                console.log("Current   " + curTile.center.x + " " + curTile.center.y);
                console.log("End       " + end.center.x + " " + end.center.y);
                console.log("Direction " + direction.x + " " + direction.y);
                curTile = curTile.getNeighbor(direction);
                path.push(curTile);

                if (iterations < 0) {
                    break;
                }
                iterations--;
            }

            return path;
        }
    }]);

    return Diagram;
}(_Graph3.default);

// neighborTiles = [];
//             var neighbor = selectedTile;
//             for (var i = 0; i < numNeighbors; i++) {
//                 neighbor = neighbor.getNeighbor(
//                     Vector.subtract(mousePos, neighbor.center));
//                 if (neighbor) {
//                     neighborTiles.push(neighbor);
//                 }
//             }

exports.default = Diagram;
module.exports = exports["default"];

},{"../geometry/Vector":20,"./Graph":25,"./Tile":26}],24:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _Vector = require("../geometry/Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Line2 = require("../geometry/Line");

var _Line3 = _interopRequireDefault(_Line2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Edge = function (_Line) {
    _inherits(Edge, _Line);

    /**
     * Edge connections between centers and corners in the Voronoi/Delaunay
     * graph.
     * 
     * @property {number} id The id of the edge in the graph object
     * @property {Vector} d0 The first polygon center of the delaunay graph
     * @property {Vector} d1 The second polygon center of the delaunay graph
     * @property {Vector} v0 The first corner object of the voronoi graph
     * @property {Vector} v1 The second corner object of the voronoi graph
     * 
     * @class Edge
     * @extends {Line}
     */
    function Edge(v0, v1) {
        _classCallCheck(this, Edge);

        var _this = _possibleConstructorReturn(this, (Edge.__proto__ || Object.getPrototypeOf(Edge)).call(this, v0, v1));

        _this.id = -1;
        // Polygon center objects connected by Delaunay edges
        _this.d0 = null;
        _this.d1 = null;
        // Corner objects connected by Voronoi edges
        _this.v0 = null;
        _this.v1 = null;
        _this.midpoint = null;
        _this.border = false;
        return _this;
    }

    return Edge;
}(_Line3.default);

exports.default = Edge;
module.exports = exports["default"];

},{"../geometry/Line":16,"../geometry/Vector":20}],25:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Vector = require("../geometry/Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Center = require("./Center");

var _Center2 = _interopRequireDefault(_Center);

var _Corner = require("./Corner");

var _Corner2 = _interopRequireDefault(_Corner);

var _Edge = require("./Edge");

var _Edge2 = _interopRequireDefault(_Edge);

var _Util = require("../utilities/Util");

var _Voronoi = require("Voronoi");

var _Voronoi2 = _interopRequireDefault(_Voronoi);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// Need to ES6ify
var Graph = function () {
    /**
     * The Graph class is an extenstion of the voronoi diagram. It turns the
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
     * @property {Center[]} centers All the center objects of the graph
     * @property {Corner[]} corners All the corner objects of the graph
     * @property {Edges[]} edges All the edge objects of the graph
     * 
     * @param {Vector[]} points The vector location to create the voronoi diagram with
     * @param {Rectangle} bbox The bounding box for the creation of the voronoi diagram
     * @param {integer} [relaxations=0] The number of lloyd relaxations to do.
     *  This turns a noisy graph into a more uniform graph iteration by iteration.
     *  This helps to improve the spacing between points in the graph.
     * @param {bool} [improveCorners=false] This improves uniformity among the
     *  corners by setting them to the average of their neighbors. This breaks
     *  the voronoi properties of the graph.
     * 
     * @class Graph
     */
    function Graph(points, bbox) {
        var relaxations = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
        var improveCorners = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

        _classCallCheck(this, Graph);

        this.bbox = bbox;
        this._rhillbbox = {
            xl: this.bbox.x,
            xr: this.bbox.x + this.bbox.width,
            yt: this.bbox.y,
            yb: this.bbox.y + this.bbox.height
        };

        // Compute Voronoi from initial points
        var rhillVoronoi = new _Voronoi2.default();
        this._voronoi = rhillVoronoi.compute(points, this._rhillbbox);

        // Lloyds Relaxations
        while (relaxations > 0) {
            console.log(relaxations);
            var sites = this.relaxSites(this._voronoi);
            rhillVoronoi.recycle(this._voronoi);
            this._voronoi = rhillVoronoi.compute(sites, this._rhillbbox);
            relaxations--;
        }

        this.convertDiagram(this._voronoi);

        if (improveCorners) {
            console.log(this.corners);
            this.improveCorners();
            console.log(this.corners);
        }
        this.sortCorners();
    }

    _createClass(Graph, [{
        key: "relaxSites",
        value: function relaxSites(voronoi) {
            var cells = voronoi.cells;
            var iCell = cells.length;
            var cell = void 0;
            var site = void 0;
            var sites = [];

            while (iCell--) {
                cell = cells[iCell];
                site = this.cellCentroid(cell);
                sites.push(new _Vector2.default(site.x, site.y));
            }
            return sites;
        }
    }, {
        key: "cellArea",
        value: function cellArea(cell) {
            var area = 0;
            var halfedges = cell.halfedges;
            var iHalfedge = halfedges.length;
            var halfedge = void 0,
                p1 = void 0,
                p2 = void 0;
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
    }, {
        key: "cellCentroid",
        value: function cellCentroid(cell) {
            var x = 0,
                y = 0;
            var halfedges = cell.halfedges;
            var iHalfedge = halfedges.length;
            var halfedge = void 0;
            var v = void 0,
                p1 = void 0,
                p2 = void 0;

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
    }, {
        key: "convertDiagram",
        value: function convertDiagram(voronoi) {
            var centerLookup = {};
            var cornerLookup = {};
            this.centers = [];
            this.corners = [];
            this.edges = [];

            var cornerId = 0;
            var edgeId = 0;

            // Copy over all the center nodes
            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = voronoi.cells[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var cell = _step.value;

                    var site = cell.site;
                    var pos = new _Vector2.default(site.x, site.y);
                    var center = new _Center2.default(pos);
                    center.id = site.voronoiId;
                    centerLookup[pos.key()] = center;
                    this.centers.push(center);
                }

                // Create and copy over the edges and corners
                // This portion also creates the connections between all the nodes
            } catch (err) {
                _didIteratorError = true;
                _iteratorError = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion && _iterator.return) {
                        _iterator.return();
                    }
                } finally {
                    if (_didIteratorError) {
                        throw _iteratorError;
                    }
                }
            }

            var _iteratorNormalCompletion2 = true;
            var _didIteratorError2 = false;
            var _iteratorError2 = undefined;

            try {
                for (var _iterator2 = voronoi.edges[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                    var edge = _step2.value;


                    // Convert voronoi edge to a useable form
                    // Corner positions
                    var va = new _Vector2.default(Math.round(edge.va.x), Math.round(edge.va.y));
                    var vb = new _Vector2.default(Math.round(edge.vb.x), Math.round(edge.vb.y));
                    // Center positions
                    var site1 = new _Vector2.default(edge.lSite.x, edge.lSite.y);
                    var site2 = edge.rSite ? new _Vector2.default(edge.rSite.x, edge.rSite.y) : null;

                    // Lookup the two center objects
                    var center1 = centerLookup[site1.key()];
                    var center2 = site2 ? centerLookup[site2.key()] : null;

                    // Lookup the corner objects and if one isn't created
                    // create one and add it to corners set
                    var corner1 = void 0;
                    var corner2 = void 0;

                    var isBorder = function isBorder(point, bbox) {
                        return point.x <= bbox.xl || point.x >= bbox.xr || point.y <= bbox.yt || point.y >= bbox.yb;
                    };

                    if (!(0, _Util.has)(cornerLookup, va.key())) {
                        corner1 = new _Corner2.default(va);
                        corner1.id = cornerId++;
                        corner1.border = isBorder(va, this.bbox);
                        cornerLookup[va.key()] = corner1;
                        this.corners.push(corner1);
                    } else {
                        corner1 = cornerLookup[va.key()];
                    }
                    if (!(0, _Util.has)(cornerLookup, vb.key())) {
                        corner2 = new _Corner2.default(vb);
                        corner2.id = cornerId++;
                        corner2.border = isBorder(vb, this.bbox);
                        cornerLookup[vb.key()] = corner2;
                        this.corners.push(corner2);
                    } else {
                        corner2 = cornerLookup[vb.key()];
                    }

                    // Update the edge objects
                    var newEdge = new _Edge2.default();
                    newEdge.id = edgeId++;
                    newEdge.d0 = center1;
                    newEdge.d1 = center2;
                    newEdge.v0 = corner1;
                    newEdge.v1 = corner2;
                    newEdge.midpoint = _Vector2.default.midpoint(corner1, corner2);

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
            } catch (err) {
                _didIteratorError2 = true;
                _iteratorError2 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion2 && _iterator2.return) {
                        _iterator2.return();
                    }
                } finally {
                    if (_didIteratorError2) {
                        throw _iteratorError2;
                    }
                }
            }
        }

        //------------------------------------------------------------------------------
        // Helper function to create graph
        //
        // Lloyd relaxation helped to create uniformity among polygon corners,
        // This function creates uniformity among polygon corners by setting the corners
        // to the average of their neighbors
        // This breakes the voronoi diagram properties

    }, {
        key: "improveCorners",
        value: function improveCorners() {
            var newCorners = [];

            // Calculate new corner positions
            for (var i = 0; i < this.corners.length; i++) {
                var corner = this.corners[i];

                if (corner.border) {
                    newCorners[i] = corner;
                } else {
                    var newPos = _Vector2.default.zero();

                    var _iteratorNormalCompletion3 = true;
                    var _didIteratorError3 = false;
                    var _iteratorError3 = undefined;

                    try {
                        for (var _iterator3 = corner.touches[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
                            var neighbor = _step3.value;

                            newPos = _Vector2.default.add(newPos, neighbor);
                        }
                    } catch (err) {
                        _didIteratorError3 = true;
                        _iteratorError3 = err;
                    } finally {
                        try {
                            if (!_iteratorNormalCompletion3 && _iterator3.return) {
                                _iterator3.return();
                            }
                        } finally {
                            if (_didIteratorError3) {
                                throw _iteratorError3;
                            }
                        }
                    }

                    newPos = newPos.divide(corner.touches.length);
                    newCorners[i] = newPos;
                }
            }

            console.log(newCorners);

            // Assign new corner positions
            for (var _i = 0; _i < this.corners.length; _i++) {
                this.corners[_i].x = newCorners[_i].x;
                this.corners[_i].y = newCorners[_i].y;
            }

            // Recompute edge midpoints
            var _iteratorNormalCompletion4 = true;
            var _didIteratorError4 = false;
            var _iteratorError4 = undefined;

            try {
                for (var _iterator4 = this.edges[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
                    var edge = _step4.value;

                    if (edge.v0 && edge.v1) {
                        edge.midpoint = _Vector2.default.midpoint(edge.v0, edge.v1);
                    }
                }
            } catch (err) {
                _didIteratorError4 = true;
                _iteratorError4 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion4 && _iterator4.return) {
                        _iterator4.return();
                    }
                } finally {
                    if (_didIteratorError4) {
                        throw _iteratorError4;
                    }
                }
            }
        }

        //------------------------------------------------------------------------------
        // Sorts the corners in clockwise order so that they can be printed properly
        // using a standard polygon drawing method

    }, {
        key: "sortCorners",
        value: function sortCorners() {
            var _iteratorNormalCompletion5 = true;
            var _didIteratorError5 = false;
            var _iteratorError5 = undefined;

            try {
                for (var _iterator5 = this.centers[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
                    var center = _step5.value;

                    var comp = this.comparePolyPoints(center);
                    center.corners.sort(comp);
                }
            } catch (err) {
                _didIteratorError5 = true;
                _iteratorError5 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion5 && _iterator5.return) {
                        _iterator5.return();
                    }
                } finally {
                    if (_didIteratorError5) {
                        throw _iteratorError5;
                    }
                }
            }
        }

        //------------------------------------------------------------------------------
        // Comparison function for sorting polygon points in clockwise order
        // assuming a convex polygon
        // http://stackoverflow.com/questions/6989100/sort-points-in-clockwise-order

    }, {
        key: "comparePolyPoints",
        value: function comparePolyPoints(c) {
            var center = c;
            return function (p1, p2) {
                var a = p1,
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
                var det = (a.x - center.x) * (b.y - center.y) - (b.x - center.x) * (a.y - center.y);
                if (det < 0) {
                    return -1;
                }
                if (det > 0) {
                    return 1;
                }

                // points a and b are on the same line from the center
                // check which point is closer to the center
                var d1 = (a.x - center.x) * (a.x - center.x) + (a.y - center.y) * (a.y - center.y);
                var d2 = (b.x - center.x) * (b.x - center.x) + (b.y - center.y) * (b.y - center.y);
                if (d1 > d2) {
                    return -1;
                } else {
                    return 1;
                }
            };
        }
    }]);

    return Graph;
}();

exports.default = Graph;
module.exports = exports["default"];

},{"../geometry/Vector":20,"../utilities/Util":31,"./Center":21,"./Corner":22,"./Edge":24,"Voronoi":1}],26:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Vector = require("../geometry/Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Polygon2 = require("../geometry/Polygon");

var _Polygon3 = _interopRequireDefault(_Polygon2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Tile = function (_Polygon) {
    _inherits(Tile, _Polygon);

    function Tile(center, corners, edges) {
        _classCallCheck(this, Tile);

        var _this = _possibleConstructorReturn(this, (Tile.__proto__ || Object.getPrototypeOf(Tile)).call(this, corners, center));

        _this.edges = edges;
        _this.neighbors = [];

        _this.data = {};

        _this.parent = null;
        _this.children = null;

        // Recursive Parameters
        // this.parent = parent;
        // this.children = children ? children : [];
        return _this;
    }

    /**
     * Get the neighboring tile closest to a particular direction
     * 
     * @param {Vector} direction The direction from the current tile to the
     *  neighboring tile. (Directions are assumed to start from the origin)
     * 
     * @return {Tile} The neighboring tile which is closest to the input
     *  direction.
     * 
     * @memberOf Tile
     */


    _createClass(Tile, [{
        key: "getNeighbor",
        value: function getNeighbor(direction) {
            var minAngle = Math.PI;
            var closest = this.neighbors[0];

            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = this.neighbors[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var neighbor = _step.value;

                    var ang = _Vector2.default.angle(_Vector2.default.subtract(neighbor.center, this.center), direction);

                    if (ang < minAngle) {
                        minAngle = ang;
                        closest = neighbor;
                    }
                }
            } catch (err) {
                _didIteratorError = true;
                _iteratorError = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion && _iterator.return) {
                        _iterator.return();
                    }
                } finally {
                    if (_didIteratorError) {
                        throw _iteratorError;
                    }
                }
            }

            return closest;
        }
    }]);

    return Tile;
}(_Polygon3.default);

exports.default = Tile;
module.exports = exports["default"];

},{"../geometry/Polygon":17,"../geometry/Vector":20}],27:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _Vector = require("./geometry/Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Line = require("./geometry/Line");

var _Line2 = _interopRequireDefault(_Line);

var _Polygon = require("./geometry/Polygon");

var _Polygon2 = _interopRequireDefault(_Polygon);

var _Rectangle = require("./geometry/Rectangle");

var _Rectangle2 = _interopRequireDefault(_Rectangle);

var _Triangle = require("./geometry/Triangle");

var _Triangle2 = _interopRequireDefault(_Triangle);

var _Center = require("./graph/Center");

var _Center2 = _interopRequireDefault(_Center);

var _Corner = require("./graph/Corner");

var _Corner2 = _interopRequireDefault(_Corner);

var _Edge = require("./graph/Edge");

var _Edge2 = _interopRequireDefault(_Edge);

var _Graph = require("./graph/Graph");

var _Graph2 = _interopRequireDefault(_Graph);

var _Diagram = require("./graph/Diagram");

var _Diagram2 = _interopRequireDefault(_Diagram);

var _PointDistribution = require("./Utilities/PointDistribution");

var PointDistribution = _interopRequireWildcard(_PointDistribution);

var _Redist = require("./utilities/Redist");

var Redist = _interopRequireWildcard(_Redist);

var _Rand = require("./utilities/Rand");

var _Rand2 = _interopRequireDefault(_Rand);

var _Util = require("./utilities/Util");

var Helpers = _interopRequireWildcard(_Util);

var _BinarySpacePartition = require("./algorithms/BinarySpacePartition");

var _BinarySpacePartition2 = _interopRequireDefault(_BinarySpacePartition);

var _RecursiveVoronoi = require("./algorithms/RecursiveVoronoi");

var _RecursiveVoronoi2 = _interopRequireDefault(_RecursiveVoronoi);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * The Atum procedural graph based library
 * 
 * @export
 * @module Atum
 * @see {@link https://github.com/Evelios/Atum}
 */


// Algorithms


// Utilities
// Geometry
var Atum = {
    Geometry: {
        Vector: _Vector2.default,
        Line: _Line2.default,
        Polygon: _Polygon2.default,
        Rectangle: _Rectangle2.default,
        Triangle: _Triangle2.default
    },
    Graph: {
        Center: _Center2.default,
        Corner: _Corner2.default,
        Edge: _Edge2.default,
        Graph: _Graph2.default,
        Diagram: _Diagram2.default
    },
    Utility: {
        PointDistribution: PointDistribution,
        Redist: Redist,
        Rand: _Rand2.default,
        Helpers: Helpers
    },
    Algorithm: {
        binarySpacePartition: _BinarySpacePartition2.default,
        recursiveVoronoi: _RecursiveVoronoi2.default
    }
};

// Graph
exports.default = Atum;
module.exports = exports["default"];

},{"./Utilities/PointDistribution":12,"./algorithms/BinarySpacePartition":14,"./algorithms/RecursiveVoronoi":15,"./geometry/Line":16,"./geometry/Polygon":17,"./geometry/Rectangle":18,"./geometry/Triangle":19,"./geometry/Vector":20,"./graph/Center":21,"./graph/Corner":22,"./graph/Diagram":23,"./graph/Edge":24,"./graph/Graph":25,"./utilities/Rand":29,"./utilities/Redist":30,"./utilities/Util":31}],28:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"../geometry/Rectangle":18,"../geometry/Vector":20,"./Rand":29,"dup":12,"poisson-disk-sample":3}],29:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"../geometry/Vector":20,"dup":13,"seedRandom":4}],30:[function(require,module,exports){
/**
 * Theses function are used to redistribute data located in the range 0-1
 * They take all the data and rearrange them and purturbe them slightly so that
 * they fit a particular distrubution function. For example you can use these
 * to push all the data points closer to 1 so that there are few points near 0
 * each redistribution function has different properties.
 *
 * Properties of these functions
 * the domain is (0-1) for the range (0-1)
 * in this range the function is one to one
 * f(0) == 0 and f(1) == 1
 * 
 * @summary Functions used to redistrubute values in the range 0-1
 * @class Redist
 */

"use strict";

/**
 * The identity function. It returns the input value x
 * 
 * @export
 * @function
 * @param {Number} x The input number in the range [0-1]
 * @returns {Number} Input value
 * @memberof Redist
 */

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.identity = identity;
exports.inverse = inverse;
exports.exp = exp;
exports.pow = pow;
exports.step = step;
function identity(x) {
    return x;
}

/**
 * The inverse fuction. It returns the opposite of the function in the range
 * from [0-1]. This is simply 1 - x.
 * 
 * @export
 * @function
 * @param {Number} x The input number in the range [0-1]
 * @returns {Number} The redistributed input value, 1 - x
 * @memberof Redist
 */
function inverse(x) {
    return 1 - x;
}

/**
 * Exponential redistribution function. This function skews the values either
 * up or down by a particular ammount according the input parameters. The
 * output distribution will be slight exponential shaped.
 * 
 * @export
 * @function
 * @param {Number} x The input number in the range [0-1]
 * @param {Number} [amm=1] The strength of the redistribution
 * @param {Boolean} [inc=true] If you want to increase or decrease the input
 * @returns {Number} The redistributed input value
 * @memberof Redist
 */
function exp(x) {
    var amm = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 1;
    var inc = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

    var nom = void 0,
        denom = void 0;
    if (inc) {
        nom = 1 - Math.exp(-amm * x);
        denom = 1 - Math.exp(-amm);
    } else {
        nom = Math.exp(amm * x) - 1;
        denom = Math.exp(amm) - 1;
    }

    return nom / denom;
}

// Power Function eg sqrt qubrt
/**
 * Power redistribution function. This function skews values either up or down
 * by a particular ammount according to the input parameters. The power 
 * distribution also has a slight skew up or down on top of the redistribution.
 * 
 * @export
 * @function
 * @param {Number} x The input number in the range [0-1] 
 * @param {Number} [amm=2] The strength of the redistribution
 * @param {Boolean} [inc=true] If you want to increase or decrease the input
 * @param {Boolean} [skewDown=true] If you want to skew the input value down
 *  towards 0, then skewDown=true. If you want to skew the input value up 
 *  towards 1, then skewDown=false
 * @returns {Number} The redistributed input value
 * @memberof Redist
 */
function pow(x) {
    var amm = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 2;
    var inc = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;
    var skewDown = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : true;

    if (inc) {
        if (skewDown) {
            return Math.pow(x, 1 / amm);
        } else {
            return 1 - Math.pow(1 - x, amm);
        }
    } else {
        if (skewDown) {
            return Math.pow(x, amm);
        } else {
            return 1 - Math.pow(1 - x, 1 / amm);
        }
    }
}

/**
 * Turns a continious function and turns it into a discrete function that has
 * a specific number of bins to but the distribution into.
 * 
 * @export
 * @function
 * @param {Number} x The input number in the range [0-1]
 * @param {Number} [bins=10] The number of bins for the discrite distribution
 * @returns {Number} The discretized input value
 * @memberof Redist
 */
function step(x) {
    var bins = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 10;

    return Math.floor(bins * x) / bins;
}

},{}],31:[function(require,module,exports){
/**
 * A utility file with helper functions that can be used to aid in the
 * development of the package.
 */
"use strict";

// Used for testing if an object contains a particular property
// http://stackoverflow.com/questions/7174748/javascript-object-detection-dot-syntax-versus-in-keyword/7174775#7174775

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.has = has;
exports.setOptions = setOptions;
function has(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
};

function setOptions(options, defaults) {
    var out = {};
    for (var v in defaults) {
        out[v] = options[v] ? options[v] : defaults[v];
    }
    return out;
}

// Number map from one range to another range
// https://gist.github.com/xposedbones/75ebaef3c10060a3ee3b246166caab56
Number.prototype.map = function (in_min, in_max, out_min, out_max) {
    return (this - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
};

},{}]},{},[27])(27)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvVm9yb25vaS9yaGlsbC12b3Jvbm9pLWNvcmUuanMiLCJub2RlX21vZHVsZXMvYnJvd3Nlci1yZXNvbHZlL2VtcHR5LmpzIiwibm9kZV9tb2R1bGVzL3BvaXNzb24tZGlzay1zYW1wbGUvcG9pc3Nvbi1kaXNrLmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vaW5kZXguanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIvYWxlYS5qcyIsIm5vZGVfbW9kdWxlcy9zZWVkUmFuZG9tL2xpYi90eWNoZWkuanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIveG9yMTI4LmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vbGliL3hvcjQwOTYuanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIveG9yc2hpZnQ3LmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vbGliL3hvcndvdy5qcyIsIm5vZGVfbW9kdWxlcy9zZWVkUmFuZG9tL3NlZWRyYW5kb20uanMiLCJzcmNcXFV0aWxpdGllc1xcUG9pbnREaXN0cmlidXRpb24uanMiLCJzcmNcXFV0aWxpdGllc1xcUmFuZC5qcyIsInNyY1xcYWxnb3JpdGhtc1xcQmluYXJ5U3BhY2VQYXJ0aXRpb24uanMiLCJzcmNcXGFsZ29yaXRobXNcXFJlY3Vyc2l2ZVZvcm9ub2kuanMiLCJzcmNcXGdlb21ldHJ5XFxMaW5lLmpzIiwic3JjXFxnZW9tZXRyeVxcUG9seWdvbi5qcyIsInNyY1xcZ2VvbWV0cnlcXFJlY3RhbmdsZS5qcyIsInNyY1xcZ2VvbWV0cnlcXFRyaWFuZ2xlLmpzIiwic3JjXFxnZW9tZXRyeVxcVmVjdG9yLmpzIiwic3JjXFxncmFwaFxcQ2VudGVyLmpzIiwic3JjXFxncmFwaFxcQ29ybmVyLmpzIiwic3JjXFxncmFwaFxcRGlhZ3JhbS5qcyIsInNyY1xcZ3JhcGhcXEVkZ2UuanMiLCJzcmNcXGdyYXBoXFxHcmFwaC5qcyIsInNyY1xcZ3JhcGhcXFRpbGUuanMiLCJzcmNcXG1haW4uanMiLCJzcmNcXHV0aWxpdGllc1xcUmVkaXN0LmpzIiwic3JjXFx1dGlsaXRpZXNcXFV0aWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNXJEQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ROQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNB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QUEwQixTQUFTLENBQVQsQ0FBbkM7QUFDSDtBQUNELFdBQU8sR0FBUDtBQUNIOztBQUVEO0FBQ0E7QUFDQSxPQUFPLFNBQVAsQ0FBaUIsR0FBakIsR0FBdUIsVUFBVSxNQUFWLEVBQWtCLE1BQWxCLEVBQTBCLE9BQTFCLEVBQW1DLE9BQW5DLEVBQTRDO0FBQy9ELFdBQU8sQ0FBQyxPQUFPLE1BQVIsS0FBbUIsVUFBVSxPQUE3QixLQUF5QyxTQUFTLE1BQWxELElBQTRELE9BQW5FO0FBQ0gsQ0FGRCIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKiFcbkNvcHlyaWdodCAoQykgMjAxMC0yMDEzIFJheW1vbmQgSGlsbDogaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pXG5NSVQgTGljZW5zZTogU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9nb3JoaWxsL0phdmFzY3JpcHQtVm9yb25vaS9MSUNFTlNFLm1kXG4qL1xuLypcbkF1dGhvcjogUmF5bW9uZCBIaWxsIChyaGlsbEByYXltb25kaGlsbC5uZXQpXG5Db250cmlidXRvcjogSmVzc2UgTW9yZ2FuIChtb3JnYWplbEBnbWFpbC5jb20pXG5GaWxlOiByaGlsbC12b3Jvbm9pLWNvcmUuanNcblZlcnNpb246IDAuOThcbkRhdGU6IEphbnVhcnkgMjEsIDIwMTNcbkRlc2NyaXB0aW9uOiBUaGlzIGlzIG15IHBlcnNvbmFsIEphdmFzY3JpcHQgaW1wbGVtZW50YXRpb24gb2ZcblN0ZXZlbiBGb3J0dW5lJ3MgYWxnb3JpdGhtIHRvIGNvbXB1dGUgVm9yb25vaSBkaWFncmFtcy5cblxuTGljZW5zZTogU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9nb3JoaWxsL0phdmFzY3JpcHQtVm9yb25vaS9MSUNFTlNFLm1kXG5DcmVkaXRzOiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL0NSRURJVFMubWRcbkhpc3Rvcnk6IFNlZSBodHRwczovL2dpdGh1Yi5jb20vZ29yaGlsbC9KYXZhc2NyaXB0LVZvcm9ub2kvQ0hBTkdFTE9HLm1kXG5cbiMjIFVzYWdlOlxuXG4gIHZhciBzaXRlcyA9IFt7eDozMDAseTozMDB9LCB7eDoxMDAseToxMDB9LCB7eDoyMDAseTo1MDB9LCB7eDoyNTAseTo0NTB9LCB7eDo2MDAseToxNTB9XTtcbiAgLy8geGwsIHhyIG1lYW5zIHggbGVmdCwgeCByaWdodFxuICAvLyB5dCwgeWIgbWVhbnMgeSB0b3AsIHkgYm90dG9tXG4gIHZhciBiYm94ID0ge3hsOjAsIHhyOjgwMCwgeXQ6MCwgeWI6NjAwfTtcbiAgdmFyIHZvcm9ub2kgPSBuZXcgVm9yb25vaSgpO1xuICAvLyBwYXNzIGFuIG9iamVjdCB3aGljaCBleGhpYml0cyB4bCwgeHIsIHl0LCB5YiBwcm9wZXJ0aWVzLiBUaGUgYm91bmRpbmdcbiAgLy8gYm94IHdpbGwgYmUgdXNlZCB0byBjb25uZWN0IHVuYm91bmQgZWRnZXMsIGFuZCB0byBjbG9zZSBvcGVuIGNlbGxzXG4gIHJlc3VsdCA9IHZvcm9ub2kuY29tcHV0ZShzaXRlcywgYmJveCk7XG4gIC8vIHJlbmRlciwgZnVydGhlciBhbmFseXplLCBldGMuXG5cblJldHVybiB2YWx1ZTpcbiAgQW4gb2JqZWN0IHdpdGggdGhlIGZvbGxvd2luZyBwcm9wZXJ0aWVzOlxuXG4gIHJlc3VsdC52ZXJ0aWNlcyA9IGFuIGFycmF5IG9mIHVub3JkZXJlZCwgdW5pcXVlIFZvcm9ub2kuVmVydGV4IG9iamVjdHMgbWFraW5nXG4gICAgdXAgdGhlIFZvcm9ub2kgZGlhZ3JhbS5cbiAgcmVzdWx0LmVkZ2VzID0gYW4gYXJyYXkgb2YgdW5vcmRlcmVkLCB1bmlxdWUgVm9yb25vaS5FZGdlIG9iamVjdHMgbWFraW5nIHVwXG4gICAgdGhlIFZvcm9ub2kgZGlhZ3JhbS5cbiAgcmVzdWx0LmNlbGxzID0gYW4gYXJyYXkgb2YgVm9yb25vaS5DZWxsIG9iamVjdCBtYWtpbmcgdXAgdGhlIFZvcm9ub2kgZGlhZ3JhbS5cbiAgICBBIENlbGwgb2JqZWN0IG1pZ2h0IGhhdmUgYW4gZW1wdHkgYXJyYXkgb2YgaGFsZmVkZ2VzLCBtZWFuaW5nIG5vIFZvcm9ub2lcbiAgICBjZWxsIGNvdWxkIGJlIGNvbXB1dGVkIGZvciBhIHBhcnRpY3VsYXIgY2VsbC5cbiAgcmVzdWx0LmV4ZWNUaW1lID0gdGhlIHRpbWUgaXQgdG9vayB0byBjb21wdXRlIHRoZSBWb3Jvbm9pIGRpYWdyYW0sIGluXG4gICAgbWlsbGlzZWNvbmRzLlxuXG5Wb3Jvbm9pLlZlcnRleCBvYmplY3Q6XG4gIHg6IFRoZSB4IHBvc2l0aW9uIG9mIHRoZSB2ZXJ0ZXguXG4gIHk6IFRoZSB5IHBvc2l0aW9uIG9mIHRoZSB2ZXJ0ZXguXG5cblZvcm9ub2kuRWRnZSBvYmplY3Q6XG4gIGxTaXRlOiB0aGUgVm9yb25vaSBzaXRlIG9iamVjdCBhdCB0aGUgbGVmdCBvZiB0aGlzIFZvcm9ub2kuRWRnZSBvYmplY3QuXG4gIHJTaXRlOiB0aGUgVm9yb25vaSBzaXRlIG9iamVjdCBhdCB0aGUgcmlnaHQgb2YgdGhpcyBWb3Jvbm9pLkVkZ2Ugb2JqZWN0IChjYW5cbiAgICBiZSBudWxsKS5cbiAgdmE6IGFuIG9iamVjdCB3aXRoIGFuICd4JyBhbmQgYSAneScgcHJvcGVydHkgZGVmaW5pbmcgdGhlIHN0YXJ0IHBvaW50XG4gICAgKHJlbGF0aXZlIHRvIHRoZSBWb3Jvbm9pIHNpdGUgb24gdGhlIGxlZnQpIG9mIHRoaXMgVm9yb25vaS5FZGdlIG9iamVjdC5cbiAgdmI6IGFuIG9iamVjdCB3aXRoIGFuICd4JyBhbmQgYSAneScgcHJvcGVydHkgZGVmaW5pbmcgdGhlIGVuZCBwb2ludFxuICAgIChyZWxhdGl2ZSB0byBWb3Jvbm9pIHNpdGUgb24gdGhlIGxlZnQpIG9mIHRoaXMgVm9yb25vaS5FZGdlIG9iamVjdC5cblxuICBGb3IgZWRnZXMgd2hpY2ggYXJlIHVzZWQgdG8gY2xvc2Ugb3BlbiBjZWxscyAodXNpbmcgdGhlIHN1cHBsaWVkIGJvdW5kaW5nXG4gIGJveCksIHRoZSByU2l0ZSBwcm9wZXJ0eSB3aWxsIGJlIG51bGwuXG5cblZvcm9ub2kuQ2VsbCBvYmplY3Q6XG4gIHNpdGU6IHRoZSBWb3Jvbm9pIHNpdGUgb2JqZWN0IGFzc29jaWF0ZWQgd2l0aCB0aGUgVm9yb25vaSBjZWxsLlxuICBoYWxmZWRnZXM6IGFuIGFycmF5IG9mIFZvcm9ub2kuSGFsZmVkZ2Ugb2JqZWN0cywgb3JkZXJlZCBjb3VudGVyY2xvY2t3aXNlLFxuICAgIGRlZmluaW5nIHRoZSBwb2x5Z29uIGZvciB0aGlzIFZvcm9ub2kgY2VsbC5cblxuVm9yb25vaS5IYWxmZWRnZSBvYmplY3Q6XG4gIHNpdGU6IHRoZSBWb3Jvbm9pIHNpdGUgb2JqZWN0IG93bmluZyB0aGlzIFZvcm9ub2kuSGFsZmVkZ2Ugb2JqZWN0LlxuICBlZGdlOiBhIHJlZmVyZW5jZSB0byB0aGUgdW5pcXVlIFZvcm9ub2kuRWRnZSBvYmplY3QgdW5kZXJseWluZyB0aGlzXG4gICAgVm9yb25vaS5IYWxmZWRnZSBvYmplY3QuXG4gIGdldFN0YXJ0cG9pbnQoKTogYSBtZXRob2QgcmV0dXJuaW5nIGFuIG9iamVjdCB3aXRoIGFuICd4JyBhbmQgYSAneScgcHJvcGVydHlcbiAgICBmb3IgdGhlIHN0YXJ0IHBvaW50IG9mIHRoaXMgaGFsZmVkZ2UuIEtlZXAgaW4gbWluZCBoYWxmZWRnZXMgYXJlIGFsd2F5c1xuICAgIGNvdW50ZXJjb2Nrd2lzZS5cbiAgZ2V0RW5kcG9pbnQoKTogYSBtZXRob2QgcmV0dXJuaW5nIGFuIG9iamVjdCB3aXRoIGFuICd4JyBhbmQgYSAneScgcHJvcGVydHlcbiAgICBmb3IgdGhlIGVuZCBwb2ludCBvZiB0aGlzIGhhbGZlZGdlLiBLZWVwIGluIG1pbmQgaGFsZmVkZ2VzIGFyZSBhbHdheXNcbiAgICBjb3VudGVyY29ja3dpc2UuXG5cblRPRE86IElkZW50aWZ5IG9wcG9ydHVuaXRpZXMgZm9yIHBlcmZvcm1hbmNlIGltcHJvdmVtZW50LlxuXG5UT0RPOiBMZXQgdGhlIHVzZXIgY2xvc2UgdGhlIFZvcm9ub2kgY2VsbHMsIGRvIG5vdCBkbyBpdCBhdXRvbWF0aWNhbGx5LiBOb3Qgb25seSBsZXRcbiAgICAgIGhpbSBjbG9zZSB0aGUgY2VsbHMsIGJ1dCBhbHNvIGFsbG93IGhpbSB0byBjbG9zZSBtb3JlIHRoYW4gb25jZSB1c2luZyBhIGRpZmZlcmVudFxuICAgICAgYm91bmRpbmcgYm94IGZvciB0aGUgc2FtZSBWb3Jvbm9pIGRpYWdyYW0uXG4qL1xuXG4vKmdsb2JhbCBNYXRoICovXG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBWb3Jvbm9pKCkge1xuICAgIHRoaXMudmVydGljZXMgPSBudWxsO1xuICAgIHRoaXMuZWRnZXMgPSBudWxsO1xuICAgIHRoaXMuY2VsbHMgPSBudWxsO1xuICAgIHRoaXMudG9SZWN5Y2xlID0gbnVsbDtcbiAgICB0aGlzLmJlYWNoc2VjdGlvbkp1bmt5YXJkID0gW107XG4gICAgdGhpcy5jaXJjbGVFdmVudEp1bmt5YXJkID0gW107XG4gICAgdGhpcy52ZXJ0ZXhKdW5reWFyZCA9IFtdO1xuICAgIHRoaXMuZWRnZUp1bmt5YXJkID0gW107XG4gICAgdGhpcy5jZWxsSnVua3lhcmQgPSBbXTtcbiAgICB9XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5Wb3Jvbm9pLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5iZWFjaGxpbmUpIHtcbiAgICAgICAgdGhpcy5iZWFjaGxpbmUgPSBuZXcgdGhpcy5SQlRyZWUoKTtcbiAgICAgICAgfVxuICAgIC8vIE1vdmUgbGVmdG92ZXIgYmVhY2hzZWN0aW9ucyB0byB0aGUgYmVhY2hzZWN0aW9uIGp1bmt5YXJkLlxuICAgIGlmICh0aGlzLmJlYWNobGluZS5yb290KSB7XG4gICAgICAgIHZhciBiZWFjaHNlY3Rpb24gPSB0aGlzLmJlYWNobGluZS5nZXRGaXJzdCh0aGlzLmJlYWNobGluZS5yb290KTtcbiAgICAgICAgd2hpbGUgKGJlYWNoc2VjdGlvbikge1xuICAgICAgICAgICAgdGhpcy5iZWFjaHNlY3Rpb25KdW5reWFyZC5wdXNoKGJlYWNoc2VjdGlvbik7IC8vIG1hcmsgZm9yIHJldXNlXG4gICAgICAgICAgICBiZWFjaHNlY3Rpb24gPSBiZWFjaHNlY3Rpb24ucmJOZXh0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgdGhpcy5iZWFjaGxpbmUucm9vdCA9IG51bGw7XG4gICAgaWYgKCF0aGlzLmNpcmNsZUV2ZW50cykge1xuICAgICAgICB0aGlzLmNpcmNsZUV2ZW50cyA9IG5ldyB0aGlzLlJCVHJlZSgpO1xuICAgICAgICB9XG4gICAgdGhpcy5jaXJjbGVFdmVudHMucm9vdCA9IHRoaXMuZmlyc3RDaXJjbGVFdmVudCA9IG51bGw7XG4gICAgdGhpcy52ZXJ0aWNlcyA9IFtdO1xuICAgIHRoaXMuZWRnZXMgPSBbXTtcbiAgICB0aGlzLmNlbGxzID0gW107XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuc3FydCA9IE1hdGguc3FydDtcblZvcm9ub2kucHJvdG90eXBlLmFicyA9IE1hdGguYWJzO1xuVm9yb25vaS5wcm90b3R5cGUuzrUgPSBWb3Jvbm9pLs61ID0gMWUtOTtcblZvcm9ub2kucHJvdG90eXBlLmluds61ID0gVm9yb25vaS5pbnbOtSA9IDEuMCAvIFZvcm9ub2kuzrU7XG5Wb3Jvbm9pLnByb3RvdHlwZS5lcXVhbFdpdGhFcHNpbG9uID0gZnVuY3Rpb24oYSxiKXtyZXR1cm4gdGhpcy5hYnMoYS1iKTwxZS05O307XG5Wb3Jvbm9pLnByb3RvdHlwZS5ncmVhdGVyVGhhbldpdGhFcHNpbG9uID0gZnVuY3Rpb24oYSxiKXtyZXR1cm4gYS1iPjFlLTk7fTtcblZvcm9ub2kucHJvdG90eXBlLmdyZWF0ZXJUaGFuT3JFcXVhbFdpdGhFcHNpbG9uID0gZnVuY3Rpb24oYSxiKXtyZXR1cm4gYi1hPDFlLTk7fTtcblZvcm9ub2kucHJvdG90eXBlLmxlc3NUaGFuV2l0aEVwc2lsb24gPSBmdW5jdGlvbihhLGIpe3JldHVybiBiLWE+MWUtOTt9O1xuVm9yb25vaS5wcm90b3R5cGUubGVzc1RoYW5PckVxdWFsV2l0aEVwc2lsb24gPSBmdW5jdGlvbihhLGIpe3JldHVybiBhLWI8MWUtOTt9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlZC1CbGFjayB0cmVlIGNvZGUgKGJhc2VkIG9uIEMgdmVyc2lvbiBvZiBcInJidHJlZVwiIGJ5IEZyYW5jayBCdWktSHV1XG4vLyBodHRwczovL2dpdGh1Yi5jb20vZmJ1aWh1dS9saWJ0cmVlL2Jsb2IvbWFzdGVyL3JiLmNcblxuVm9yb25vaS5wcm90b3R5cGUuUkJUcmVlID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5yb290ID0gbnVsbDtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUucHJvdG90eXBlLnJiSW5zZXJ0U3VjY2Vzc29yID0gZnVuY3Rpb24obm9kZSwgc3VjY2Vzc29yKSB7XG4gICAgdmFyIHBhcmVudDtcbiAgICBpZiAobm9kZSkge1xuICAgICAgICAvLyA+Pj4gcmhpbGwgMjAxMS0wNS0yNzogUGVyZm9ybWFuY2U6IGNhY2hlIHByZXZpb3VzL25leHQgbm9kZXNcbiAgICAgICAgc3VjY2Vzc29yLnJiUHJldmlvdXMgPSBub2RlO1xuICAgICAgICBzdWNjZXNzb3IucmJOZXh0ID0gbm9kZS5yYk5leHQ7XG4gICAgICAgIGlmIChub2RlLnJiTmV4dCkge1xuICAgICAgICAgICAgbm9kZS5yYk5leHQucmJQcmV2aW91cyA9IHN1Y2Nlc3NvcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgbm9kZS5yYk5leHQgPSBzdWNjZXNzb3I7XG4gICAgICAgIC8vIDw8PFxuICAgICAgICBpZiAobm9kZS5yYlJpZ2h0KSB7XG4gICAgICAgICAgICAvLyBpbi1wbGFjZSBleHBhbnNpb24gb2Ygbm9kZS5yYlJpZ2h0LmdldEZpcnN0KCk7XG4gICAgICAgICAgICBub2RlID0gbm9kZS5yYlJpZ2h0O1xuICAgICAgICAgICAgd2hpbGUgKG5vZGUucmJMZWZ0KSB7bm9kZSA9IG5vZGUucmJMZWZ0O31cbiAgICAgICAgICAgIG5vZGUucmJMZWZ0ID0gc3VjY2Vzc29yO1xuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIG5vZGUucmJSaWdodCA9IHN1Y2Nlc3NvcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgcGFyZW50ID0gbm9kZTtcbiAgICAgICAgfVxuICAgIC8vIHJoaWxsIDIwMTEtMDYtMDc6IGlmIG5vZGUgaXMgbnVsbCwgc3VjY2Vzc29yIG11c3QgYmUgaW5zZXJ0ZWRcbiAgICAvLyB0byB0aGUgbGVmdC1tb3N0IHBhcnQgb2YgdGhlIHRyZWVcbiAgICBlbHNlIGlmICh0aGlzLnJvb3QpIHtcbiAgICAgICAgbm9kZSA9IHRoaXMuZ2V0Rmlyc3QodGhpcy5yb290KTtcbiAgICAgICAgLy8gPj4+IFBlcmZvcm1hbmNlOiBjYWNoZSBwcmV2aW91cy9uZXh0IG5vZGVzXG4gICAgICAgIHN1Y2Nlc3Nvci5yYlByZXZpb3VzID0gbnVsbDtcbiAgICAgICAgc3VjY2Vzc29yLnJiTmV4dCA9IG5vZGU7XG4gICAgICAgIG5vZGUucmJQcmV2aW91cyA9IHN1Y2Nlc3NvcjtcbiAgICAgICAgLy8gPDw8XG4gICAgICAgIG5vZGUucmJMZWZ0ID0gc3VjY2Vzc29yO1xuICAgICAgICBwYXJlbnQgPSBub2RlO1xuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIC8vID4+PiBQZXJmb3JtYW5jZTogY2FjaGUgcHJldmlvdXMvbmV4dCBub2Rlc1xuICAgICAgICBzdWNjZXNzb3IucmJQcmV2aW91cyA9IHN1Y2Nlc3Nvci5yYk5leHQgPSBudWxsO1xuICAgICAgICAvLyA8PDxcbiAgICAgICAgdGhpcy5yb290ID0gc3VjY2Vzc29yO1xuICAgICAgICBwYXJlbnQgPSBudWxsO1xuICAgICAgICB9XG4gICAgc3VjY2Vzc29yLnJiTGVmdCA9IHN1Y2Nlc3Nvci5yYlJpZ2h0ID0gbnVsbDtcbiAgICBzdWNjZXNzb3IucmJQYXJlbnQgPSBwYXJlbnQ7XG4gICAgc3VjY2Vzc29yLnJiUmVkID0gdHJ1ZTtcbiAgICAvLyBGaXh1cCB0aGUgbW9kaWZpZWQgdHJlZSBieSByZWNvbG9yaW5nIG5vZGVzIGFuZCBwZXJmb3JtaW5nXG4gICAgLy8gcm90YXRpb25zICgyIGF0IG1vc3QpIGhlbmNlIHRoZSByZWQtYmxhY2sgdHJlZSBwcm9wZXJ0aWVzIGFyZVxuICAgIC8vIHByZXNlcnZlZC5cbiAgICB2YXIgZ3JhbmRwYSwgdW5jbGU7XG4gICAgbm9kZSA9IHN1Y2Nlc3NvcjtcbiAgICB3aGlsZSAocGFyZW50ICYmIHBhcmVudC5yYlJlZCkge1xuICAgICAgICBncmFuZHBhID0gcGFyZW50LnJiUGFyZW50O1xuICAgICAgICBpZiAocGFyZW50ID09PSBncmFuZHBhLnJiTGVmdCkge1xuICAgICAgICAgICAgdW5jbGUgPSBncmFuZHBhLnJiUmlnaHQ7XG4gICAgICAgICAgICBpZiAodW5jbGUgJiYgdW5jbGUucmJSZWQpIHtcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSB1bmNsZS5yYlJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIGdyYW5kcGEucmJSZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIG5vZGUgPSBncmFuZHBhO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGlmIChub2RlID09PSBwYXJlbnQucmJSaWdodCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlTGVmdChwYXJlbnQpO1xuICAgICAgICAgICAgICAgICAgICBub2RlID0gcGFyZW50O1xuICAgICAgICAgICAgICAgICAgICBwYXJlbnQgPSBub2RlLnJiUGFyZW50O1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcGFyZW50LnJiUmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgZ3JhbmRwYS5yYlJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZVJpZ2h0KGdyYW5kcGEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB1bmNsZSA9IGdyYW5kcGEucmJMZWZ0O1xuICAgICAgICAgICAgaWYgKHVuY2xlICYmIHVuY2xlLnJiUmVkKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50LnJiUmVkID0gdW5jbGUucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBncmFuZHBhLnJiUmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBub2RlID0gZ3JhbmRwYTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAobm9kZSA9PT0gcGFyZW50LnJiTGVmdCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlUmlnaHQocGFyZW50KTtcbiAgICAgICAgICAgICAgICAgICAgbm9kZSA9IHBhcmVudDtcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50ID0gbm9kZS5yYlBhcmVudDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHBhcmVudC5yYlJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIGdyYW5kcGEucmJSZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVMZWZ0KGdyYW5kcGEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgcGFyZW50ID0gbm9kZS5yYlBhcmVudDtcbiAgICAgICAgfVxuICAgIHRoaXMucm9vdC5yYlJlZCA9IGZhbHNlO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLlJCVHJlZS5wcm90b3R5cGUucmJSZW1vdmVOb2RlID0gZnVuY3Rpb24obm9kZSkge1xuICAgIC8vID4+PiByaGlsbCAyMDExLTA1LTI3OiBQZXJmb3JtYW5jZTogY2FjaGUgcHJldmlvdXMvbmV4dCBub2Rlc1xuICAgIGlmIChub2RlLnJiTmV4dCkge1xuICAgICAgICBub2RlLnJiTmV4dC5yYlByZXZpb3VzID0gbm9kZS5yYlByZXZpb3VzO1xuICAgICAgICB9XG4gICAgaWYgKG5vZGUucmJQcmV2aW91cykge1xuICAgICAgICBub2RlLnJiUHJldmlvdXMucmJOZXh0ID0gbm9kZS5yYk5leHQ7XG4gICAgICAgIH1cbiAgICBub2RlLnJiTmV4dCA9IG5vZGUucmJQcmV2aW91cyA9IG51bGw7XG4gICAgLy8gPDw8XG4gICAgdmFyIHBhcmVudCA9IG5vZGUucmJQYXJlbnQsXG4gICAgICAgIGxlZnQgPSBub2RlLnJiTGVmdCxcbiAgICAgICAgcmlnaHQgPSBub2RlLnJiUmlnaHQsXG4gICAgICAgIG5leHQ7XG4gICAgaWYgKCFsZWZ0KSB7XG4gICAgICAgIG5leHQgPSByaWdodDtcbiAgICAgICAgfVxuICAgIGVsc2UgaWYgKCFyaWdodCkge1xuICAgICAgICBuZXh0ID0gbGVmdDtcbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBuZXh0ID0gdGhpcy5nZXRGaXJzdChyaWdodCk7XG4gICAgICAgIH1cbiAgICBpZiAocGFyZW50KSB7XG4gICAgICAgIGlmIChwYXJlbnQucmJMZWZ0ID09PSBub2RlKSB7XG4gICAgICAgICAgICBwYXJlbnQucmJMZWZ0ID0gbmV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwYXJlbnQucmJSaWdodCA9IG5leHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgdGhpcy5yb290ID0gbmV4dDtcbiAgICAgICAgfVxuICAgIC8vIGVuZm9yY2UgcmVkLWJsYWNrIHJ1bGVzXG4gICAgdmFyIGlzUmVkO1xuICAgIGlmIChsZWZ0ICYmIHJpZ2h0KSB7XG4gICAgICAgIGlzUmVkID0gbmV4dC5yYlJlZDtcbiAgICAgICAgbmV4dC5yYlJlZCA9IG5vZGUucmJSZWQ7XG4gICAgICAgIG5leHQucmJMZWZ0ID0gbGVmdDtcbiAgICAgICAgbGVmdC5yYlBhcmVudCA9IG5leHQ7XG4gICAgICAgIGlmIChuZXh0ICE9PSByaWdodCkge1xuICAgICAgICAgICAgcGFyZW50ID0gbmV4dC5yYlBhcmVudDtcbiAgICAgICAgICAgIG5leHQucmJQYXJlbnQgPSBub2RlLnJiUGFyZW50O1xuICAgICAgICAgICAgbm9kZSA9IG5leHQucmJSaWdodDtcbiAgICAgICAgICAgIHBhcmVudC5yYkxlZnQgPSBub2RlO1xuICAgICAgICAgICAgbmV4dC5yYlJpZ2h0ID0gcmlnaHQ7XG4gICAgICAgICAgICByaWdodC5yYlBhcmVudCA9IG5leHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgbmV4dC5yYlBhcmVudCA9IHBhcmVudDtcbiAgICAgICAgICAgIHBhcmVudCA9IG5leHQ7XG4gICAgICAgICAgICBub2RlID0gbmV4dC5yYlJpZ2h0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlzUmVkID0gbm9kZS5yYlJlZDtcbiAgICAgICAgbm9kZSA9IG5leHQ7XG4gICAgICAgIH1cbiAgICAvLyAnbm9kZScgaXMgbm93IHRoZSBzb2xlIHN1Y2Nlc3NvcidzIGNoaWxkIGFuZCAncGFyZW50JyBpdHNcbiAgICAvLyBuZXcgcGFyZW50IChzaW5jZSB0aGUgc3VjY2Vzc29yIGNhbiBoYXZlIGJlZW4gbW92ZWQpXG4gICAgaWYgKG5vZGUpIHtcbiAgICAgICAgbm9kZS5yYlBhcmVudCA9IHBhcmVudDtcbiAgICAgICAgfVxuICAgIC8vIHRoZSAnZWFzeScgY2FzZXNcbiAgICBpZiAoaXNSZWQpIHtyZXR1cm47fVxuICAgIGlmIChub2RlICYmIG5vZGUucmJSZWQpIHtcbiAgICAgICAgbm9kZS5yYlJlZCA9IGZhbHNlO1xuICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAvLyB0aGUgb3RoZXIgY2FzZXNcbiAgICB2YXIgc2libGluZztcbiAgICBkbyB7XG4gICAgICAgIGlmIChub2RlID09PSB0aGlzLnJvb3QpIHtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICBpZiAobm9kZSA9PT0gcGFyZW50LnJiTGVmdCkge1xuICAgICAgICAgICAgc2libGluZyA9IHBhcmVudC5yYlJpZ2h0O1xuICAgICAgICAgICAgaWYgKHNpYmxpbmcucmJSZWQpIHtcbiAgICAgICAgICAgICAgICBzaWJsaW5nLnJiUmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcGFyZW50LnJiUmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlTGVmdChwYXJlbnQpO1xuICAgICAgICAgICAgICAgIHNpYmxpbmcgPSBwYXJlbnQucmJSaWdodDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoKHNpYmxpbmcucmJMZWZ0ICYmIHNpYmxpbmcucmJMZWZ0LnJiUmVkKSB8fCAoc2libGluZy5yYlJpZ2h0ICYmIHNpYmxpbmcucmJSaWdodC5yYlJlZCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXNpYmxpbmcucmJSaWdodCB8fCAhc2libGluZy5yYlJpZ2h0LnJiUmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmcucmJMZWZ0LnJiUmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlUmlnaHQoc2libGluZyk7XG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmcgPSBwYXJlbnQucmJSaWdodDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSZWQgPSBwYXJlbnQucmJSZWQ7XG4gICAgICAgICAgICAgICAgcGFyZW50LnJiUmVkID0gc2libGluZy5yYlJpZ2h0LnJiUmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZUxlZnQocGFyZW50KTtcbiAgICAgICAgICAgICAgICBub2RlID0gdGhpcy5yb290O1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBzaWJsaW5nID0gcGFyZW50LnJiTGVmdDtcbiAgICAgICAgICAgIGlmIChzaWJsaW5nLnJiUmVkKSB7XG4gICAgICAgICAgICAgICAgc2libGluZy5yYlJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHBhcmVudC5yYlJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZVJpZ2h0KHBhcmVudCk7XG4gICAgICAgICAgICAgICAgc2libGluZyA9IHBhcmVudC5yYkxlZnQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKChzaWJsaW5nLnJiTGVmdCAmJiBzaWJsaW5nLnJiTGVmdC5yYlJlZCkgfHwgKHNpYmxpbmcucmJSaWdodCAmJiBzaWJsaW5nLnJiUmlnaHQucmJSZWQpKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzaWJsaW5nLnJiTGVmdCB8fCAhc2libGluZy5yYkxlZnQucmJSZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgc2libGluZy5yYlJpZ2h0LnJiUmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlTGVmdChzaWJsaW5nKTtcbiAgICAgICAgICAgICAgICAgICAgc2libGluZyA9IHBhcmVudC5yYkxlZnQ7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzaWJsaW5nLnJiUmVkID0gcGFyZW50LnJiUmVkO1xuICAgICAgICAgICAgICAgIHBhcmVudC5yYlJlZCA9IHNpYmxpbmcucmJMZWZ0LnJiUmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZVJpZ2h0KHBhcmVudCk7XG4gICAgICAgICAgICAgICAgbm9kZSA9IHRoaXMucm9vdDtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIHNpYmxpbmcucmJSZWQgPSB0cnVlO1xuICAgICAgICBub2RlID0gcGFyZW50O1xuICAgICAgICBwYXJlbnQgPSBwYXJlbnQucmJQYXJlbnQ7XG4gICAgfSB3aGlsZSAoIW5vZGUucmJSZWQpO1xuICAgIGlmIChub2RlKSB7bm9kZS5yYlJlZCA9IGZhbHNlO31cbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUucHJvdG90eXBlLnJiUm90YXRlTGVmdCA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICB2YXIgcCA9IG5vZGUsXG4gICAgICAgIHEgPSBub2RlLnJiUmlnaHQsIC8vIGNhbid0IGJlIG51bGxcbiAgICAgICAgcGFyZW50ID0gcC5yYlBhcmVudDtcbiAgICBpZiAocGFyZW50KSB7XG4gICAgICAgIGlmIChwYXJlbnQucmJMZWZ0ID09PSBwKSB7XG4gICAgICAgICAgICBwYXJlbnQucmJMZWZ0ID0gcTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwYXJlbnQucmJSaWdodCA9IHE7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgdGhpcy5yb290ID0gcTtcbiAgICAgICAgfVxuICAgIHEucmJQYXJlbnQgPSBwYXJlbnQ7XG4gICAgcC5yYlBhcmVudCA9IHE7XG4gICAgcC5yYlJpZ2h0ID0gcS5yYkxlZnQ7XG4gICAgaWYgKHAucmJSaWdodCkge1xuICAgICAgICBwLnJiUmlnaHQucmJQYXJlbnQgPSBwO1xuICAgICAgICB9XG4gICAgcS5yYkxlZnQgPSBwO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLlJCVHJlZS5wcm90b3R5cGUucmJSb3RhdGVSaWdodCA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICB2YXIgcCA9IG5vZGUsXG4gICAgICAgIHEgPSBub2RlLnJiTGVmdCwgLy8gY2FuJ3QgYmUgbnVsbFxuICAgICAgICBwYXJlbnQgPSBwLnJiUGFyZW50O1xuICAgIGlmIChwYXJlbnQpIHtcbiAgICAgICAgaWYgKHBhcmVudC5yYkxlZnQgPT09IHApIHtcbiAgICAgICAgICAgIHBhcmVudC5yYkxlZnQgPSBxO1xuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHBhcmVudC5yYlJpZ2h0ID0gcTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICB0aGlzLnJvb3QgPSBxO1xuICAgICAgICB9XG4gICAgcS5yYlBhcmVudCA9IHBhcmVudDtcbiAgICBwLnJiUGFyZW50ID0gcTtcbiAgICBwLnJiTGVmdCA9IHEucmJSaWdodDtcbiAgICBpZiAocC5yYkxlZnQpIHtcbiAgICAgICAgcC5yYkxlZnQucmJQYXJlbnQgPSBwO1xuICAgICAgICB9XG4gICAgcS5yYlJpZ2h0ID0gcDtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUucHJvdG90eXBlLmdldEZpcnN0ID0gZnVuY3Rpb24obm9kZSkge1xuICAgIHdoaWxlIChub2RlLnJiTGVmdCkge1xuICAgICAgICBub2RlID0gbm9kZS5yYkxlZnQ7XG4gICAgICAgIH1cbiAgICByZXR1cm4gbm9kZTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUucHJvdG90eXBlLmdldExhc3QgPSBmdW5jdGlvbihub2RlKSB7XG4gICAgd2hpbGUgKG5vZGUucmJSaWdodCkge1xuICAgICAgICBub2RlID0gbm9kZS5yYlJpZ2h0O1xuICAgICAgICB9XG4gICAgcmV0dXJuIG5vZGU7XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEaWFncmFtIG1ldGhvZHNcblxuVm9yb25vaS5wcm90b3R5cGUuRGlhZ3JhbSA9IGZ1bmN0aW9uKHNpdGUpIHtcbiAgICB0aGlzLnNpdGUgPSBzaXRlO1xuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ2VsbCBtZXRob2RzXG5cblZvcm9ub2kucHJvdG90eXBlLkNlbGwgPSBmdW5jdGlvbihzaXRlKSB7XG4gICAgdGhpcy5zaXRlID0gc2l0ZTtcbiAgICB0aGlzLmhhbGZlZGdlcyA9IFtdO1xuICAgIHRoaXMuY2xvc2VNZSA9IGZhbHNlO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLkNlbGwucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbihzaXRlKSB7XG4gICAgdGhpcy5zaXRlID0gc2l0ZTtcbiAgICB0aGlzLmhhbGZlZGdlcyA9IFtdO1xuICAgIHRoaXMuY2xvc2VNZSA9IGZhbHNlO1xuICAgIHJldHVybiB0aGlzO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLmNyZWF0ZUNlbGwgPSBmdW5jdGlvbihzaXRlKSB7XG4gICAgdmFyIGNlbGwgPSB0aGlzLmNlbGxKdW5reWFyZC5wb3AoKTtcbiAgICBpZiAoIGNlbGwgKSB7XG4gICAgICAgIHJldHVybiBjZWxsLmluaXQoc2l0ZSk7XG4gICAgICAgIH1cbiAgICByZXR1cm4gbmV3IHRoaXMuQ2VsbChzaXRlKTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5DZWxsLnByb3RvdHlwZS5wcmVwYXJlSGFsZmVkZ2VzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGhhbGZlZGdlcyA9IHRoaXMuaGFsZmVkZ2VzLFxuICAgICAgICBpSGFsZmVkZ2UgPSBoYWxmZWRnZXMubGVuZ3RoLFxuICAgICAgICBlZGdlO1xuICAgIC8vIGdldCByaWQgb2YgdW51c2VkIGhhbGZlZGdlc1xuICAgIC8vIHJoaWxsIDIwMTEtMDUtMjc6IEtlZXAgaXQgc2ltcGxlLCBubyBwb2ludCBoZXJlIGluIHRyeWluZ1xuICAgIC8vIHRvIGJlIGZhbmN5OiBkYW5nbGluZyBlZGdlcyBhcmUgYSB0eXBpY2FsbHkgYSBtaW5vcml0eS5cbiAgICB3aGlsZSAoaUhhbGZlZGdlLS0pIHtcbiAgICAgICAgZWRnZSA9IGhhbGZlZGdlc1tpSGFsZmVkZ2VdLmVkZ2U7XG4gICAgICAgIGlmICghZWRnZS52YiB8fCAhZWRnZS52YSkge1xuICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpSGFsZmVkZ2UsMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIC8vIHJoaWxsIDIwMTEtMDUtMjY6IEkgdHJpZWQgdG8gdXNlIGEgYmluYXJ5IHNlYXJjaCBhdCBpbnNlcnRpb25cbiAgICAvLyB0aW1lIHRvIGtlZXAgdGhlIGFycmF5IHNvcnRlZCBvbi10aGUtZmx5IChpbiBDZWxsLmFkZEhhbGZlZGdlKCkpLlxuICAgIC8vIFRoZXJlIHdhcyBubyByZWFsIGJlbmVmaXRzIGluIGRvaW5nIHNvLCBwZXJmb3JtYW5jZSBvblxuICAgIC8vIEZpcmVmb3ggMy42IHdhcyBpbXByb3ZlZCBtYXJnaW5hbGx5LCB3aGlsZSBwZXJmb3JtYW5jZSBvblxuICAgIC8vIE9wZXJhIDExIHdhcyBwZW5hbGl6ZWQgbWFyZ2luYWxseS5cbiAgICBoYWxmZWRnZXMuc29ydChmdW5jdGlvbihhLGIpe3JldHVybiBiLmFuZ2xlLWEuYW5nbGU7fSk7XG4gICAgcmV0dXJuIGhhbGZlZGdlcy5sZW5ndGg7XG4gICAgfTtcblxuLy8gUmV0dXJuIGEgbGlzdCBvZiB0aGUgbmVpZ2hib3IgSWRzXG5Wb3Jvbm9pLnByb3RvdHlwZS5DZWxsLnByb3RvdHlwZS5nZXROZWlnaGJvcklkcyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBuZWlnaGJvcnMgPSBbXSxcbiAgICAgICAgaUhhbGZlZGdlID0gdGhpcy5oYWxmZWRnZXMubGVuZ3RoLFxuICAgICAgICBlZGdlO1xuICAgIHdoaWxlIChpSGFsZmVkZ2UtLSl7XG4gICAgICAgIGVkZ2UgPSB0aGlzLmhhbGZlZGdlc1tpSGFsZmVkZ2VdLmVkZ2U7XG4gICAgICAgIGlmIChlZGdlLmxTaXRlICE9PSBudWxsICYmIGVkZ2UubFNpdGUudm9yb25vaUlkICE9IHRoaXMuc2l0ZS52b3Jvbm9pSWQpIHtcbiAgICAgICAgICAgIG5laWdoYm9ycy5wdXNoKGVkZ2UubFNpdGUudm9yb25vaUlkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoZWRnZS5yU2l0ZSAhPT0gbnVsbCAmJiBlZGdlLnJTaXRlLnZvcm9ub2lJZCAhPSB0aGlzLnNpdGUudm9yb25vaUlkKXtcbiAgICAgICAgICAgIG5laWdoYm9ycy5wdXNoKGVkZ2UuclNpdGUudm9yb25vaUlkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIHJldHVybiBuZWlnaGJvcnM7XG4gICAgfTtcblxuLy8gQ29tcHV0ZSBib3VuZGluZyBib3hcbi8vXG5Wb3Jvbm9pLnByb3RvdHlwZS5DZWxsLnByb3RvdHlwZS5nZXRCYm94ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGhhbGZlZGdlcyA9IHRoaXMuaGFsZmVkZ2VzLFxuICAgICAgICBpSGFsZmVkZ2UgPSBoYWxmZWRnZXMubGVuZ3RoLFxuICAgICAgICB4bWluID0gSW5maW5pdHksXG4gICAgICAgIHltaW4gPSBJbmZpbml0eSxcbiAgICAgICAgeG1heCA9IC1JbmZpbml0eSxcbiAgICAgICAgeW1heCA9IC1JbmZpbml0eSxcbiAgICAgICAgdiwgdngsIHZ5O1xuICAgIHdoaWxlIChpSGFsZmVkZ2UtLSkge1xuICAgICAgICB2ID0gaGFsZmVkZ2VzW2lIYWxmZWRnZV0uZ2V0U3RhcnRwb2ludCgpO1xuICAgICAgICB2eCA9IHYueDtcbiAgICAgICAgdnkgPSB2Lnk7XG4gICAgICAgIGlmICh2eCA8IHhtaW4pIHt4bWluID0gdng7fVxuICAgICAgICBpZiAodnkgPCB5bWluKSB7eW1pbiA9IHZ5O31cbiAgICAgICAgaWYgKHZ4ID4geG1heCkge3htYXggPSB2eDt9XG4gICAgICAgIGlmICh2eSA+IHltYXgpIHt5bWF4ID0gdnk7fVxuICAgICAgICAvLyB3ZSBkb250IG5lZWQgdG8gdGFrZSBpbnRvIGFjY291bnQgZW5kIHBvaW50LFxuICAgICAgICAvLyBzaW5jZSBlYWNoIGVuZCBwb2ludCBtYXRjaGVzIGEgc3RhcnQgcG9pbnRcbiAgICAgICAgfVxuICAgIHJldHVybiB7XG4gICAgICAgIHg6IHhtaW4sXG4gICAgICAgIHk6IHltaW4sXG4gICAgICAgIHdpZHRoOiB4bWF4LXhtaW4sXG4gICAgICAgIGhlaWdodDogeW1heC15bWluXG4gICAgICAgIH07XG4gICAgfTtcblxuLy8gUmV0dXJuIHdoZXRoZXIgYSBwb2ludCBpcyBpbnNpZGUsIG9uLCBvciBvdXRzaWRlIHRoZSBjZWxsOlxuLy8gICAtMTogcG9pbnQgaXMgb3V0c2lkZSB0aGUgcGVyaW1ldGVyIG9mIHRoZSBjZWxsXG4vLyAgICAwOiBwb2ludCBpcyBvbiB0aGUgcGVyaW1ldGVyIG9mIHRoZSBjZWxsXG4vLyAgICAxOiBwb2ludCBpcyBpbnNpZGUgdGhlIHBlcmltZXRlciBvZiB0aGUgY2VsbFxuLy9cblZvcm9ub2kucHJvdG90eXBlLkNlbGwucHJvdG90eXBlLnBvaW50SW50ZXJzZWN0aW9uID0gZnVuY3Rpb24oeCwgeSkge1xuICAgIC8vIENoZWNrIGlmIHBvaW50IGluIHBvbHlnb24uIFNpbmNlIGFsbCBwb2x5Z29ucyBvZiBhIFZvcm9ub2lcbiAgICAvLyBkaWFncmFtIGFyZSBjb252ZXgsIHRoZW46XG4gICAgLy8gaHR0cDovL3BhdWxib3Vya2UubmV0L2dlb21ldHJ5L3BvbHlnb25tZXNoL1xuICAgIC8vIFNvbHV0aW9uIDMgKDJEKTpcbiAgICAvLyAgIFwiSWYgdGhlIHBvbHlnb24gaXMgY29udmV4IHRoZW4gb25lIGNhbiBjb25zaWRlciB0aGUgcG9seWdvblxuICAgIC8vICAgXCJhcyBhICdwYXRoJyBmcm9tIHRoZSBmaXJzdCB2ZXJ0ZXguIEEgcG9pbnQgaXMgb24gdGhlIGludGVyaW9yXG4gICAgLy8gICBcIm9mIHRoaXMgcG9seWdvbnMgaWYgaXQgaXMgYWx3YXlzIG9uIHRoZSBzYW1lIHNpZGUgb2YgYWxsIHRoZVxuICAgIC8vICAgXCJsaW5lIHNlZ21lbnRzIG1ha2luZyB1cCB0aGUgcGF0aC4gLi4uXG4gICAgLy8gICBcIih5IC0geTApICh4MSAtIHgwKSAtICh4IC0geDApICh5MSAtIHkwKVxuICAgIC8vICAgXCJpZiBpdCBpcyBsZXNzIHRoYW4gMCB0aGVuIFAgaXMgdG8gdGhlIHJpZ2h0IG9mIHRoZSBsaW5lIHNlZ21lbnQsXG4gICAgLy8gICBcImlmIGdyZWF0ZXIgdGhhbiAwIGl0IGlzIHRvIHRoZSBsZWZ0LCBpZiBlcXVhbCB0byAwIHRoZW4gaXQgbGllc1xuICAgIC8vICAgXCJvbiB0aGUgbGluZSBzZWdtZW50XCJcbiAgICB2YXIgaGFsZmVkZ2VzID0gdGhpcy5oYWxmZWRnZXMsXG4gICAgICAgIGlIYWxmZWRnZSA9IGhhbGZlZGdlcy5sZW5ndGgsXG4gICAgICAgIGhhbGZlZGdlLFxuICAgICAgICBwMCwgcDEsIHI7XG4gICAgd2hpbGUgKGlIYWxmZWRnZS0tKSB7XG4gICAgICAgIGhhbGZlZGdlID0gaGFsZmVkZ2VzW2lIYWxmZWRnZV07XG4gICAgICAgIHAwID0gaGFsZmVkZ2UuZ2V0U3RhcnRwb2ludCgpO1xuICAgICAgICBwMSA9IGhhbGZlZGdlLmdldEVuZHBvaW50KCk7XG4gICAgICAgIHIgPSAoeS1wMC55KSoocDEueC1wMC54KS0oeC1wMC54KSoocDEueS1wMC55KTtcbiAgICAgICAgaWYgKCFyKSB7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgaWYgKHIgPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gLTE7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICByZXR1cm4gMTtcbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEVkZ2UgbWV0aG9kc1xuLy9cblxuVm9yb25vaS5wcm90b3R5cGUuVmVydGV4ID0gZnVuY3Rpb24oeCwgeSkge1xuICAgIHRoaXMueCA9IHg7XG4gICAgdGhpcy55ID0geTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5FZGdlID0gZnVuY3Rpb24obFNpdGUsIHJTaXRlKSB7XG4gICAgdGhpcy5sU2l0ZSA9IGxTaXRlO1xuICAgIHRoaXMuclNpdGUgPSByU2l0ZTtcbiAgICB0aGlzLnZhID0gdGhpcy52YiA9IG51bGw7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuSGFsZmVkZ2UgPSBmdW5jdGlvbihlZGdlLCBsU2l0ZSwgclNpdGUpIHtcbiAgICB0aGlzLnNpdGUgPSBsU2l0ZTtcbiAgICB0aGlzLmVkZ2UgPSBlZGdlO1xuICAgIC8vICdhbmdsZScgaXMgYSB2YWx1ZSB0byBiZSB1c2VkIGZvciBwcm9wZXJseSBzb3J0aW5nIHRoZVxuICAgIC8vIGhhbGZzZWdtZW50cyBjb3VudGVyY2xvY2t3aXNlLiBCeSBjb252ZW50aW9uLCB3ZSB3aWxsXG4gICAgLy8gdXNlIHRoZSBhbmdsZSBvZiB0aGUgbGluZSBkZWZpbmVkIGJ5IHRoZSAnc2l0ZSB0byB0aGUgbGVmdCdcbiAgICAvLyB0byB0aGUgJ3NpdGUgdG8gdGhlIHJpZ2h0Jy5cbiAgICAvLyBIb3dldmVyLCBib3JkZXIgZWRnZXMgaGF2ZSBubyAnc2l0ZSB0byB0aGUgcmlnaHQnOiB0aHVzIHdlXG4gICAgLy8gdXNlIHRoZSBhbmdsZSBvZiBsaW5lIHBlcnBlbmRpY3VsYXIgdG8gdGhlIGhhbGZzZWdtZW50ICh0aGVcbiAgICAvLyBlZGdlIHNob3VsZCBoYXZlIGJvdGggZW5kIHBvaW50cyBkZWZpbmVkIGluIHN1Y2ggY2FzZS4pXG4gICAgaWYgKHJTaXRlKSB7XG4gICAgICAgIHRoaXMuYW5nbGUgPSBNYXRoLmF0YW4yKHJTaXRlLnktbFNpdGUueSwgclNpdGUueC1sU2l0ZS54KTtcbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICB2YXIgdmEgPSBlZGdlLnZhLFxuICAgICAgICAgICAgdmIgPSBlZGdlLnZiO1xuICAgICAgICAvLyByaGlsbCAyMDExLTA1LTMxOiB1c2VkIHRvIGNhbGwgZ2V0U3RhcnRwb2ludCgpL2dldEVuZHBvaW50KCksXG4gICAgICAgIC8vIGJ1dCBmb3IgcGVyZm9ybWFuY2UgcHVycG9zZSwgdGhlc2UgYXJlIGV4cGFuZGVkIGluIHBsYWNlIGhlcmUuXG4gICAgICAgIHRoaXMuYW5nbGUgPSBlZGdlLmxTaXRlID09PSBsU2l0ZSA/XG4gICAgICAgICAgICBNYXRoLmF0YW4yKHZiLngtdmEueCwgdmEueS12Yi55KSA6XG4gICAgICAgICAgICBNYXRoLmF0YW4yKHZhLngtdmIueCwgdmIueS12YS55KTtcbiAgICAgICAgfVxuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLmNyZWF0ZUhhbGZlZGdlID0gZnVuY3Rpb24oZWRnZSwgbFNpdGUsIHJTaXRlKSB7XG4gICAgcmV0dXJuIG5ldyB0aGlzLkhhbGZlZGdlKGVkZ2UsIGxTaXRlLCByU2l0ZSk7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuSGFsZmVkZ2UucHJvdG90eXBlLmdldFN0YXJ0cG9pbnQgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5lZGdlLmxTaXRlID09PSB0aGlzLnNpdGUgPyB0aGlzLmVkZ2UudmEgOiB0aGlzLmVkZ2UudmI7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuSGFsZmVkZ2UucHJvdG90eXBlLmdldEVuZHBvaW50ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZWRnZS5sU2l0ZSA9PT0gdGhpcy5zaXRlID8gdGhpcy5lZGdlLnZiIDogdGhpcy5lZGdlLnZhO1xuICAgIH07XG5cblxuXG4vLyB0aGlzIGNyZWF0ZSBhbmQgYWRkIGEgdmVydGV4IHRvIHRoZSBpbnRlcm5hbCBjb2xsZWN0aW9uXG5cblZvcm9ub2kucHJvdG90eXBlLmNyZWF0ZVZlcnRleCA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgICB2YXIgdiA9IHRoaXMudmVydGV4SnVua3lhcmQucG9wKCk7XG4gICAgaWYgKCAhdiApIHtcbiAgICAgICAgdiA9IG5ldyB0aGlzLlZlcnRleCh4LCB5KTtcbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICB2LnggPSB4O1xuICAgICAgICB2LnkgPSB5O1xuICAgICAgICB9XG4gICAgdGhpcy52ZXJ0aWNlcy5wdXNoKHYpO1xuICAgIHJldHVybiB2O1xuICAgIH07XG5cbi8vIHRoaXMgY3JlYXRlIGFuZCBhZGQgYW4gZWRnZSB0byBpbnRlcm5hbCBjb2xsZWN0aW9uLCBhbmQgYWxzbyBjcmVhdGVcbi8vIHR3byBoYWxmZWRnZXMgd2hpY2ggYXJlIGFkZGVkIHRvIGVhY2ggc2l0ZSdzIGNvdW50ZXJjbG9ja3dpc2UgYXJyYXlcbi8vIG9mIGhhbGZlZGdlcy5cblxuVm9yb25vaS5wcm90b3R5cGUuY3JlYXRlRWRnZSA9IGZ1bmN0aW9uKGxTaXRlLCByU2l0ZSwgdmEsIHZiKSB7XG4gICAgdmFyIGVkZ2UgPSB0aGlzLmVkZ2VKdW5reWFyZC5wb3AoKTtcbiAgICBpZiAoICFlZGdlICkge1xuICAgICAgICBlZGdlID0gbmV3IHRoaXMuRWRnZShsU2l0ZSwgclNpdGUpO1xuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGVkZ2UubFNpdGUgPSBsU2l0ZTtcbiAgICAgICAgZWRnZS5yU2l0ZSA9IHJTaXRlO1xuICAgICAgICBlZGdlLnZhID0gZWRnZS52YiA9IG51bGw7XG4gICAgICAgIH1cblxuICAgIHRoaXMuZWRnZXMucHVzaChlZGdlKTtcbiAgICBpZiAodmEpIHtcbiAgICAgICAgdGhpcy5zZXRFZGdlU3RhcnRwb2ludChlZGdlLCBsU2l0ZSwgclNpdGUsIHZhKTtcbiAgICAgICAgfVxuICAgIGlmICh2Yikge1xuICAgICAgICB0aGlzLnNldEVkZ2VFbmRwb2ludChlZGdlLCBsU2l0ZSwgclNpdGUsIHZiKTtcbiAgICAgICAgfVxuICAgIHRoaXMuY2VsbHNbbFNpdGUudm9yb25vaUlkXS5oYWxmZWRnZXMucHVzaCh0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIGxTaXRlLCByU2l0ZSkpO1xuICAgIHRoaXMuY2VsbHNbclNpdGUudm9yb25vaUlkXS5oYWxmZWRnZXMucHVzaCh0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIHJTaXRlLCBsU2l0ZSkpO1xuICAgIHJldHVybiBlZGdlO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLmNyZWF0ZUJvcmRlckVkZ2UgPSBmdW5jdGlvbihsU2l0ZSwgdmEsIHZiKSB7XG4gICAgdmFyIGVkZ2UgPSB0aGlzLmVkZ2VKdW5reWFyZC5wb3AoKTtcbiAgICBpZiAoICFlZGdlICkge1xuICAgICAgICBlZGdlID0gbmV3IHRoaXMuRWRnZShsU2l0ZSwgbnVsbCk7XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgZWRnZS5sU2l0ZSA9IGxTaXRlO1xuICAgICAgICBlZGdlLnJTaXRlID0gbnVsbDtcbiAgICAgICAgfVxuICAgIGVkZ2UudmEgPSB2YTtcbiAgICBlZGdlLnZiID0gdmI7XG4gICAgdGhpcy5lZGdlcy5wdXNoKGVkZ2UpO1xuICAgIHJldHVybiBlZGdlO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLnNldEVkZ2VTdGFydHBvaW50ID0gZnVuY3Rpb24oZWRnZSwgbFNpdGUsIHJTaXRlLCB2ZXJ0ZXgpIHtcbiAgICBpZiAoIWVkZ2UudmEgJiYgIWVkZ2UudmIpIHtcbiAgICAgICAgZWRnZS52YSA9IHZlcnRleDtcbiAgICAgICAgZWRnZS5sU2l0ZSA9IGxTaXRlO1xuICAgICAgICBlZGdlLnJTaXRlID0gclNpdGU7XG4gICAgICAgIH1cbiAgICBlbHNlIGlmIChlZGdlLmxTaXRlID09PSByU2l0ZSkge1xuICAgICAgICBlZGdlLnZiID0gdmVydGV4O1xuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGVkZ2UudmEgPSB2ZXJ0ZXg7XG4gICAgICAgIH1cbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5zZXRFZGdlRW5kcG9pbnQgPSBmdW5jdGlvbihlZGdlLCBsU2l0ZSwgclNpdGUsIHZlcnRleCkge1xuICAgIHRoaXMuc2V0RWRnZVN0YXJ0cG9pbnQoZWRnZSwgclNpdGUsIGxTaXRlLCB2ZXJ0ZXgpO1xuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQmVhY2hsaW5lIG1ldGhvZHNcblxuLy8gcmhpbGwgMjAxMS0wNi0wNzogRm9yIHNvbWUgcmVhc29ucywgcGVyZm9ybWFuY2Ugc3VmZmVycyBzaWduaWZpY2FudGx5XG4vLyB3aGVuIGluc3RhbmNpYXRpbmcgYSBsaXRlcmFsIG9iamVjdCBpbnN0ZWFkIG9mIGFuIGVtcHR5IGN0b3JcblZvcm9ub2kucHJvdG90eXBlLkJlYWNoc2VjdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIH07XG5cbi8vIHJoaWxsIDIwMTEtMDYtMDI6IEEgbG90IG9mIEJlYWNoc2VjdGlvbiBpbnN0YW5jaWF0aW9uc1xuLy8gb2NjdXIgZHVyaW5nIHRoZSBjb21wdXRhdGlvbiBvZiB0aGUgVm9yb25vaSBkaWFncmFtLFxuLy8gc29tZXdoZXJlIGJldHdlZW4gdGhlIG51bWJlciBvZiBzaXRlcyBhbmQgdHdpY2UgdGhlXG4vLyBudW1iZXIgb2Ygc2l0ZXMsIHdoaWxlIHRoZSBudW1iZXIgb2YgQmVhY2hzZWN0aW9ucyBvbiB0aGVcbi8vIGJlYWNobGluZSBhdCBhbnkgZ2l2ZW4gdGltZSBpcyBjb21wYXJhdGl2ZWx5IGxvdy4gRm9yIHRoaXNcbi8vIHJlYXNvbiwgd2UgcmV1c2UgYWxyZWFkeSBjcmVhdGVkIEJlYWNoc2VjdGlvbnMsIGluIG9yZGVyXG4vLyB0byBhdm9pZCBuZXcgbWVtb3J5IGFsbG9jYXRpb24uIFRoaXMgcmVzdWx0ZWQgaW4gYSBtZWFzdXJhYmxlXG4vLyBwZXJmb3JtYW5jZSBnYWluLlxuXG5Wb3Jvbm9pLnByb3RvdHlwZS5jcmVhdGVCZWFjaHNlY3Rpb24gPSBmdW5jdGlvbihzaXRlKSB7XG4gICAgdmFyIGJlYWNoc2VjdGlvbiA9IHRoaXMuYmVhY2hzZWN0aW9uSnVua3lhcmQucG9wKCk7XG4gICAgaWYgKCFiZWFjaHNlY3Rpb24pIHtcbiAgICAgICAgYmVhY2hzZWN0aW9uID0gbmV3IHRoaXMuQmVhY2hzZWN0aW9uKCk7XG4gICAgICAgIH1cbiAgICBiZWFjaHNlY3Rpb24uc2l0ZSA9IHNpdGU7XG4gICAgcmV0dXJuIGJlYWNoc2VjdGlvbjtcbiAgICB9O1xuXG4vLyBjYWxjdWxhdGUgdGhlIGxlZnQgYnJlYWsgcG9pbnQgb2YgYSBwYXJ0aWN1bGFyIGJlYWNoIHNlY3Rpb24sXG4vLyBnaXZlbiBhIHBhcnRpY3VsYXIgc3dlZXAgbGluZVxuVm9yb25vaS5wcm90b3R5cGUubGVmdEJyZWFrUG9pbnQgPSBmdW5jdGlvbihhcmMsIGRpcmVjdHJpeCkge1xuICAgIC8vIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvUGFyYWJvbGFcbiAgICAvLyBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL1F1YWRyYXRpY19lcXVhdGlvblxuICAgIC8vIGgxID0geDEsXG4gICAgLy8gazEgPSAoeTErZGlyZWN0cml4KS8yLFxuICAgIC8vIGgyID0geDIsXG4gICAgLy8gazIgPSAoeTIrZGlyZWN0cml4KS8yLFxuICAgIC8vIHAxID0gazEtZGlyZWN0cml4LFxuICAgIC8vIGExID0gMS8oNCpwMSksXG4gICAgLy8gYjEgPSAtaDEvKDIqcDEpLFxuICAgIC8vIGMxID0gaDEqaDEvKDQqcDEpK2sxLFxuICAgIC8vIHAyID0gazItZGlyZWN0cml4LFxuICAgIC8vIGEyID0gMS8oNCpwMiksXG4gICAgLy8gYjIgPSAtaDIvKDIqcDIpLFxuICAgIC8vIGMyID0gaDIqaDIvKDQqcDIpK2syLFxuICAgIC8vIHggPSAoLShiMi1iMSkgKyBNYXRoLnNxcnQoKGIyLWIxKSooYjItYjEpIC0gNCooYTItYTEpKihjMi1jMSkpKSAvICgyKihhMi1hMSkpXG4gICAgLy8gV2hlbiB4MSBiZWNvbWUgdGhlIHgtb3JpZ2luOlxuICAgIC8vIGgxID0gMCxcbiAgICAvLyBrMSA9ICh5MStkaXJlY3RyaXgpLzIsXG4gICAgLy8gaDIgPSB4Mi14MSxcbiAgICAvLyBrMiA9ICh5MitkaXJlY3RyaXgpLzIsXG4gICAgLy8gcDEgPSBrMS1kaXJlY3RyaXgsXG4gICAgLy8gYTEgPSAxLyg0KnAxKSxcbiAgICAvLyBiMSA9IDAsXG4gICAgLy8gYzEgPSBrMSxcbiAgICAvLyBwMiA9IGsyLWRpcmVjdHJpeCxcbiAgICAvLyBhMiA9IDEvKDQqcDIpLFxuICAgIC8vIGIyID0gLWgyLygyKnAyKSxcbiAgICAvLyBjMiA9IGgyKmgyLyg0KnAyKStrMixcbiAgICAvLyB4ID0gKC1iMiArIE1hdGguc3FydChiMipiMiAtIDQqKGEyLWExKSooYzItazEpKSkgLyAoMiooYTItYTEpKSArIHgxXG5cbiAgICAvLyBjaGFuZ2UgY29kZSBiZWxvdyBhdCB5b3VyIG93biByaXNrOiBjYXJlIGhhcyBiZWVuIHRha2VuIHRvXG4gICAgLy8gcmVkdWNlIGVycm9ycyBkdWUgdG8gY29tcHV0ZXJzJyBmaW5pdGUgYXJpdGhtZXRpYyBwcmVjaXNpb24uXG4gICAgLy8gTWF5YmUgY2FuIHN0aWxsIGJlIGltcHJvdmVkLCB3aWxsIHNlZSBpZiBhbnkgbW9yZSBvZiB0aGlzXG4gICAgLy8ga2luZCBvZiBlcnJvcnMgcG9wIHVwIGFnYWluLlxuICAgIHZhciBzaXRlID0gYXJjLnNpdGUsXG4gICAgICAgIHJmb2N4ID0gc2l0ZS54LFxuICAgICAgICByZm9jeSA9IHNpdGUueSxcbiAgICAgICAgcGJ5MiA9IHJmb2N5LWRpcmVjdHJpeDtcbiAgICAvLyBwYXJhYm9sYSBpbiBkZWdlbmVyYXRlIGNhc2Ugd2hlcmUgZm9jdXMgaXMgb24gZGlyZWN0cml4XG4gICAgaWYgKCFwYnkyKSB7XG4gICAgICAgIHJldHVybiByZm9jeDtcbiAgICAgICAgfVxuICAgIHZhciBsQXJjID0gYXJjLnJiUHJldmlvdXM7XG4gICAgaWYgKCFsQXJjKSB7XG4gICAgICAgIHJldHVybiAtSW5maW5pdHk7XG4gICAgICAgIH1cbiAgICBzaXRlID0gbEFyYy5zaXRlO1xuICAgIHZhciBsZm9jeCA9IHNpdGUueCxcbiAgICAgICAgbGZvY3kgPSBzaXRlLnksXG4gICAgICAgIHBsYnkyID0gbGZvY3ktZGlyZWN0cml4O1xuICAgIC8vIHBhcmFib2xhIGluIGRlZ2VuZXJhdGUgY2FzZSB3aGVyZSBmb2N1cyBpcyBvbiBkaXJlY3RyaXhcbiAgICBpZiAoIXBsYnkyKSB7XG4gICAgICAgIHJldHVybiBsZm9jeDtcbiAgICAgICAgfVxuICAgIHZhciBobCA9IGxmb2N4LXJmb2N4LFxuICAgICAgICBhYnkyID0gMS9wYnkyLTEvcGxieTIsXG4gICAgICAgIGIgPSBobC9wbGJ5MjtcbiAgICBpZiAoYWJ5Mikge1xuICAgICAgICByZXR1cm4gKC1iK3RoaXMuc3FydChiKmItMiphYnkyKihobCpobC8oLTIqcGxieTIpLWxmb2N5K3BsYnkyLzIrcmZvY3ktcGJ5Mi8yKSkpL2FieTIrcmZvY3g7XG4gICAgICAgIH1cbiAgICAvLyBib3RoIHBhcmFib2xhcyBoYXZlIHNhbWUgZGlzdGFuY2UgdG8gZGlyZWN0cml4LCB0aHVzIGJyZWFrIHBvaW50IGlzIG1pZHdheVxuICAgIHJldHVybiAocmZvY3grbGZvY3gpLzI7XG4gICAgfTtcblxuLy8gY2FsY3VsYXRlIHRoZSByaWdodCBicmVhayBwb2ludCBvZiBhIHBhcnRpY3VsYXIgYmVhY2ggc2VjdGlvbixcbi8vIGdpdmVuIGEgcGFydGljdWxhciBkaXJlY3RyaXhcblZvcm9ub2kucHJvdG90eXBlLnJpZ2h0QnJlYWtQb2ludCA9IGZ1bmN0aW9uKGFyYywgZGlyZWN0cml4KSB7XG4gICAgdmFyIHJBcmMgPSBhcmMucmJOZXh0O1xuICAgIGlmIChyQXJjKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmxlZnRCcmVha1BvaW50KHJBcmMsIGRpcmVjdHJpeCk7XG4gICAgICAgIH1cbiAgICB2YXIgc2l0ZSA9IGFyYy5zaXRlO1xuICAgIHJldHVybiBzaXRlLnkgPT09IGRpcmVjdHJpeCA/IHNpdGUueCA6IEluZmluaXR5O1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLmRldGFjaEJlYWNoc2VjdGlvbiA9IGZ1bmN0aW9uKGJlYWNoc2VjdGlvbikge1xuICAgIHRoaXMuZGV0YWNoQ2lyY2xlRXZlbnQoYmVhY2hzZWN0aW9uKTsgLy8gZGV0YWNoIHBvdGVudGlhbGx5IGF0dGFjaGVkIGNpcmNsZSBldmVudFxuICAgIHRoaXMuYmVhY2hsaW5lLnJiUmVtb3ZlTm9kZShiZWFjaHNlY3Rpb24pOyAvLyByZW1vdmUgZnJvbSBSQi10cmVlXG4gICAgdGhpcy5iZWFjaHNlY3Rpb25KdW5reWFyZC5wdXNoKGJlYWNoc2VjdGlvbik7IC8vIG1hcmsgZm9yIHJldXNlXG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUucmVtb3ZlQmVhY2hzZWN0aW9uID0gZnVuY3Rpb24oYmVhY2hzZWN0aW9uKSB7XG4gICAgdmFyIGNpcmNsZSA9IGJlYWNoc2VjdGlvbi5jaXJjbGVFdmVudCxcbiAgICAgICAgeCA9IGNpcmNsZS54LFxuICAgICAgICB5ID0gY2lyY2xlLnljZW50ZXIsXG4gICAgICAgIHZlcnRleCA9IHRoaXMuY3JlYXRlVmVydGV4KHgsIHkpLFxuICAgICAgICBwcmV2aW91cyA9IGJlYWNoc2VjdGlvbi5yYlByZXZpb3VzLFxuICAgICAgICBuZXh0ID0gYmVhY2hzZWN0aW9uLnJiTmV4dCxcbiAgICAgICAgZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnMgPSBbYmVhY2hzZWN0aW9uXSxcbiAgICAgICAgYWJzX2ZuID0gTWF0aC5hYnM7XG5cbiAgICAvLyByZW1vdmUgY29sbGFwc2VkIGJlYWNoc2VjdGlvbiBmcm9tIGJlYWNobGluZVxuICAgIHRoaXMuZGV0YWNoQmVhY2hzZWN0aW9uKGJlYWNoc2VjdGlvbik7XG5cbiAgICAvLyB0aGVyZSBjb3VsZCBiZSBtb3JlIHRoYW4gb25lIGVtcHR5IGFyYyBhdCB0aGUgZGVsZXRpb24gcG9pbnQsIHRoaXNcbiAgICAvLyBoYXBwZW5zIHdoZW4gbW9yZSB0aGFuIHR3byBlZGdlcyBhcmUgbGlua2VkIGJ5IHRoZSBzYW1lIHZlcnRleCxcbiAgICAvLyBzbyB3ZSB3aWxsIGNvbGxlY3QgYWxsIHRob3NlIGVkZ2VzIGJ5IGxvb2tpbmcgdXAgYm90aCBzaWRlcyBvZlxuICAgIC8vIHRoZSBkZWxldGlvbiBwb2ludC5cbiAgICAvLyBieSB0aGUgd2F5LCB0aGVyZSBpcyAqYWx3YXlzKiBhIHByZWRlY2Vzc29yL3N1Y2Nlc3NvciB0byBhbnkgY29sbGFwc2VkXG4gICAgLy8gYmVhY2ggc2VjdGlvbiwgaXQncyBqdXN0IGltcG9zc2libGUgdG8gaGF2ZSBhIGNvbGxhcHNpbmcgZmlyc3QvbGFzdFxuICAgIC8vIGJlYWNoIHNlY3Rpb25zIG9uIHRoZSBiZWFjaGxpbmUsIHNpbmNlIHRoZXkgb2J2aW91c2x5IGFyZSB1bmNvbnN0cmFpbmVkXG4gICAgLy8gb24gdGhlaXIgbGVmdC9yaWdodCBzaWRlLlxuXG4gICAgLy8gbG9vayBsZWZ0XG4gICAgdmFyIGxBcmMgPSBwcmV2aW91cztcbiAgICB3aGlsZSAobEFyYy5jaXJjbGVFdmVudCAmJiBhYnNfZm4oeC1sQXJjLmNpcmNsZUV2ZW50LngpPDFlLTkgJiYgYWJzX2ZuKHktbEFyYy5jaXJjbGVFdmVudC55Y2VudGVyKTwxZS05KSB7XG4gICAgICAgIHByZXZpb3VzID0gbEFyYy5yYlByZXZpb3VzO1xuICAgICAgICBkaXNhcHBlYXJpbmdUcmFuc2l0aW9ucy51bnNoaWZ0KGxBcmMpO1xuICAgICAgICB0aGlzLmRldGFjaEJlYWNoc2VjdGlvbihsQXJjKTsgLy8gbWFyayBmb3IgcmV1c2VcbiAgICAgICAgbEFyYyA9IHByZXZpb3VzO1xuICAgICAgICB9XG4gICAgLy8gZXZlbiB0aG91Z2ggaXQgaXMgbm90IGRpc2FwcGVhcmluZywgSSB3aWxsIGFsc28gYWRkIHRoZSBiZWFjaCBzZWN0aW9uXG4gICAgLy8gaW1tZWRpYXRlbHkgdG8gdGhlIGxlZnQgb2YgdGhlIGxlZnQtbW9zdCBjb2xsYXBzZWQgYmVhY2ggc2VjdGlvbiwgZm9yXG4gICAgLy8gY29udmVuaWVuY2UsIHNpbmNlIHdlIG5lZWQgdG8gcmVmZXIgdG8gaXQgbGF0ZXIgYXMgdGhpcyBiZWFjaCBzZWN0aW9uXG4gICAgLy8gaXMgdGhlICdsZWZ0JyBzaXRlIG9mIGFuIGVkZ2UgZm9yIHdoaWNoIGEgc3RhcnQgcG9pbnQgaXMgc2V0LlxuICAgIGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zLnVuc2hpZnQobEFyYyk7XG4gICAgdGhpcy5kZXRhY2hDaXJjbGVFdmVudChsQXJjKTtcblxuICAgIC8vIGxvb2sgcmlnaHRcbiAgICB2YXIgckFyYyA9IG5leHQ7XG4gICAgd2hpbGUgKHJBcmMuY2lyY2xlRXZlbnQgJiYgYWJzX2ZuKHgtckFyYy5jaXJjbGVFdmVudC54KTwxZS05ICYmIGFic19mbih5LXJBcmMuY2lyY2xlRXZlbnQueWNlbnRlcik8MWUtOSkge1xuICAgICAgICBuZXh0ID0gckFyYy5yYk5leHQ7XG4gICAgICAgIGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zLnB1c2gockFyYyk7XG4gICAgICAgIHRoaXMuZGV0YWNoQmVhY2hzZWN0aW9uKHJBcmMpOyAvLyBtYXJrIGZvciByZXVzZVxuICAgICAgICByQXJjID0gbmV4dDtcbiAgICAgICAgfVxuICAgIC8vIHdlIGFsc28gaGF2ZSB0byBhZGQgdGhlIGJlYWNoIHNlY3Rpb24gaW1tZWRpYXRlbHkgdG8gdGhlIHJpZ2h0IG9mIHRoZVxuICAgIC8vIHJpZ2h0LW1vc3QgY29sbGFwc2VkIGJlYWNoIHNlY3Rpb24sIHNpbmNlIHRoZXJlIGlzIGFsc28gYSBkaXNhcHBlYXJpbmdcbiAgICAvLyB0cmFuc2l0aW9uIHJlcHJlc2VudGluZyBhbiBlZGdlJ3Mgc3RhcnQgcG9pbnQgb24gaXRzIGxlZnQuXG4gICAgZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnMucHVzaChyQXJjKTtcbiAgICB0aGlzLmRldGFjaENpcmNsZUV2ZW50KHJBcmMpO1xuXG4gICAgLy8gd2FsayB0aHJvdWdoIGFsbCB0aGUgZGlzYXBwZWFyaW5nIHRyYW5zaXRpb25zIGJldHdlZW4gYmVhY2ggc2VjdGlvbnMgYW5kXG4gICAgLy8gc2V0IHRoZSBzdGFydCBwb2ludCBvZiB0aGVpciAoaW1wbGllZCkgZWRnZS5cbiAgICB2YXIgbkFyY3MgPSBkaXNhcHBlYXJpbmdUcmFuc2l0aW9ucy5sZW5ndGgsXG4gICAgICAgIGlBcmM7XG4gICAgZm9yIChpQXJjPTE7IGlBcmM8bkFyY3M7IGlBcmMrKykge1xuICAgICAgICByQXJjID0gZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnNbaUFyY107XG4gICAgICAgIGxBcmMgPSBkaXNhcHBlYXJpbmdUcmFuc2l0aW9uc1tpQXJjLTFdO1xuICAgICAgICB0aGlzLnNldEVkZ2VTdGFydHBvaW50KHJBcmMuZWRnZSwgbEFyYy5zaXRlLCByQXJjLnNpdGUsIHZlcnRleCk7XG4gICAgICAgIH1cblxuICAgIC8vIGNyZWF0ZSBhIG5ldyBlZGdlIGFzIHdlIGhhdmUgbm93IGEgbmV3IHRyYW5zaXRpb24gYmV0d2VlblxuICAgIC8vIHR3byBiZWFjaCBzZWN0aW9ucyB3aGljaCB3ZXJlIHByZXZpb3VzbHkgbm90IGFkamFjZW50LlxuICAgIC8vIHNpbmNlIHRoaXMgZWRnZSBhcHBlYXJzIGFzIGEgbmV3IHZlcnRleCBpcyBkZWZpbmVkLCB0aGUgdmVydGV4XG4gICAgLy8gYWN0dWFsbHkgZGVmaW5lIGFuIGVuZCBwb2ludCBvZiB0aGUgZWRnZSAocmVsYXRpdmUgdG8gdGhlIHNpdGVcbiAgICAvLyBvbiB0aGUgbGVmdClcbiAgICBsQXJjID0gZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnNbMF07XG4gICAgckFyYyA9IGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zW25BcmNzLTFdO1xuICAgIHJBcmMuZWRnZSA9IHRoaXMuY3JlYXRlRWRnZShsQXJjLnNpdGUsIHJBcmMuc2l0ZSwgdW5kZWZpbmVkLCB2ZXJ0ZXgpO1xuXG4gICAgLy8gY3JlYXRlIGNpcmNsZSBldmVudHMgaWYgYW55IGZvciBiZWFjaCBzZWN0aW9ucyBsZWZ0IGluIHRoZSBiZWFjaGxpbmVcbiAgICAvLyBhZGphY2VudCB0byBjb2xsYXBzZWQgc2VjdGlvbnNcbiAgICB0aGlzLmF0dGFjaENpcmNsZUV2ZW50KGxBcmMpO1xuICAgIHRoaXMuYXR0YWNoQ2lyY2xlRXZlbnQockFyYyk7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuYWRkQmVhY2hzZWN0aW9uID0gZnVuY3Rpb24oc2l0ZSkge1xuICAgIHZhciB4ID0gc2l0ZS54LFxuICAgICAgICBkaXJlY3RyaXggPSBzaXRlLnk7XG5cbiAgICAvLyBmaW5kIHRoZSBsZWZ0IGFuZCByaWdodCBiZWFjaCBzZWN0aW9ucyB3aGljaCB3aWxsIHN1cnJvdW5kIHRoZSBuZXdseVxuICAgIC8vIGNyZWF0ZWQgYmVhY2ggc2VjdGlvbi5cbiAgICAvLyByaGlsbCAyMDExLTA2LTAxOiBUaGlzIGxvb3AgaXMgb25lIG9mIHRoZSBtb3N0IG9mdGVuIGV4ZWN1dGVkLFxuICAgIC8vIGhlbmNlIHdlIGV4cGFuZCBpbi1wbGFjZSB0aGUgY29tcGFyaXNvbi1hZ2FpbnN0LWVwc2lsb24gY2FsbHMuXG4gICAgdmFyIGxBcmMsIHJBcmMsXG4gICAgICAgIGR4bCwgZHhyLFxuICAgICAgICBub2RlID0gdGhpcy5iZWFjaGxpbmUucm9vdDtcblxuICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgIGR4bCA9IHRoaXMubGVmdEJyZWFrUG9pbnQobm9kZSxkaXJlY3RyaXgpLXg7XG4gICAgICAgIC8vIHggbGVzc1RoYW5XaXRoRXBzaWxvbiB4bCA9PiBmYWxscyBzb21ld2hlcmUgYmVmb3JlIHRoZSBsZWZ0IGVkZ2Ugb2YgdGhlIGJlYWNoc2VjdGlvblxuICAgICAgICBpZiAoZHhsID4gMWUtOSkge1xuICAgICAgICAgICAgLy8gdGhpcyBjYXNlIHNob3VsZCBuZXZlciBoYXBwZW5cbiAgICAgICAgICAgIC8vIGlmICghbm9kZS5yYkxlZnQpIHtcbiAgICAgICAgICAgIC8vICAgIHJBcmMgPSBub2RlLnJiTGVmdDtcbiAgICAgICAgICAgIC8vICAgIGJyZWFrO1xuICAgICAgICAgICAgLy8gICAgfVxuICAgICAgICAgICAgbm9kZSA9IG5vZGUucmJMZWZ0O1xuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGR4ciA9IHgtdGhpcy5yaWdodEJyZWFrUG9pbnQobm9kZSxkaXJlY3RyaXgpO1xuICAgICAgICAgICAgLy8geCBncmVhdGVyVGhhbldpdGhFcHNpbG9uIHhyID0+IGZhbGxzIHNvbWV3aGVyZSBhZnRlciB0aGUgcmlnaHQgZWRnZSBvZiB0aGUgYmVhY2hzZWN0aW9uXG4gICAgICAgICAgICBpZiAoZHhyID4gMWUtOSkge1xuICAgICAgICAgICAgICAgIGlmICghbm9kZS5yYlJpZ2h0KSB7XG4gICAgICAgICAgICAgICAgICAgIGxBcmMgPSBub2RlO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5vZGUgPSBub2RlLnJiUmlnaHQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8geCBlcXVhbFdpdGhFcHNpbG9uIHhsID0+IGZhbGxzIGV4YWN0bHkgb24gdGhlIGxlZnQgZWRnZSBvZiB0aGUgYmVhY2hzZWN0aW9uXG4gICAgICAgICAgICAgICAgaWYgKGR4bCA+IC0xZS05KSB7XG4gICAgICAgICAgICAgICAgICAgIGxBcmMgPSBub2RlLnJiUHJldmlvdXM7XG4gICAgICAgICAgICAgICAgICAgIHJBcmMgPSBub2RlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8geCBlcXVhbFdpdGhFcHNpbG9uIHhyID0+IGZhbGxzIGV4YWN0bHkgb24gdGhlIHJpZ2h0IGVkZ2Ugb2YgdGhlIGJlYWNoc2VjdGlvblxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKGR4ciA+IC0xZS05KSB7XG4gICAgICAgICAgICAgICAgICAgIGxBcmMgPSBub2RlO1xuICAgICAgICAgICAgICAgICAgICByQXJjID0gbm9kZS5yYk5leHQ7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBmYWxscyBleGFjdGx5IHNvbWV3aGVyZSBpbiB0aGUgbWlkZGxlIG9mIHRoZSBiZWFjaHNlY3Rpb25cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgbEFyYyA9IHJBcmMgPSBub2RlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgLy8gYXQgdGhpcyBwb2ludCwga2VlcCBpbiBtaW5kIHRoYXQgbEFyYyBhbmQvb3IgckFyYyBjb3VsZCBiZVxuICAgIC8vIHVuZGVmaW5lZCBvciBudWxsLlxuXG4gICAgLy8gY3JlYXRlIGEgbmV3IGJlYWNoIHNlY3Rpb24gb2JqZWN0IGZvciB0aGUgc2l0ZSBhbmQgYWRkIGl0IHRvIFJCLXRyZWVcbiAgICB2YXIgbmV3QXJjID0gdGhpcy5jcmVhdGVCZWFjaHNlY3Rpb24oc2l0ZSk7XG4gICAgdGhpcy5iZWFjaGxpbmUucmJJbnNlcnRTdWNjZXNzb3IobEFyYywgbmV3QXJjKTtcblxuICAgIC8vIGNhc2VzOlxuICAgIC8vXG5cbiAgICAvLyBbbnVsbCxudWxsXVxuICAgIC8vIGxlYXN0IGxpa2VseSBjYXNlOiBuZXcgYmVhY2ggc2VjdGlvbiBpcyB0aGUgZmlyc3QgYmVhY2ggc2VjdGlvbiBvbiB0aGVcbiAgICAvLyBiZWFjaGxpbmUuXG4gICAgLy8gVGhpcyBjYXNlIG1lYW5zOlxuICAgIC8vICAgbm8gbmV3IHRyYW5zaXRpb24gYXBwZWFyc1xuICAgIC8vICAgbm8gY29sbGFwc2luZyBiZWFjaCBzZWN0aW9uXG4gICAgLy8gICBuZXcgYmVhY2hzZWN0aW9uIGJlY29tZSByb290IG9mIHRoZSBSQi10cmVlXG4gICAgaWYgKCFsQXJjICYmICFyQXJjKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgLy8gW2xBcmMsckFyY10gd2hlcmUgbEFyYyA9PSByQXJjXG4gICAgLy8gbW9zdCBsaWtlbHkgY2FzZTogbmV3IGJlYWNoIHNlY3Rpb24gc3BsaXQgYW4gZXhpc3RpbmcgYmVhY2hcbiAgICAvLyBzZWN0aW9uLlxuICAgIC8vIFRoaXMgY2FzZSBtZWFuczpcbiAgICAvLyAgIG9uZSBuZXcgdHJhbnNpdGlvbiBhcHBlYXJzXG4gICAgLy8gICB0aGUgbGVmdCBhbmQgcmlnaHQgYmVhY2ggc2VjdGlvbiBtaWdodCBiZSBjb2xsYXBzaW5nIGFzIGEgcmVzdWx0XG4gICAgLy8gICB0d28gbmV3IG5vZGVzIGFkZGVkIHRvIHRoZSBSQi10cmVlXG4gICAgaWYgKGxBcmMgPT09IHJBcmMpIHtcbiAgICAgICAgLy8gaW52YWxpZGF0ZSBjaXJjbGUgZXZlbnQgb2Ygc3BsaXQgYmVhY2ggc2VjdGlvblxuICAgICAgICB0aGlzLmRldGFjaENpcmNsZUV2ZW50KGxBcmMpO1xuXG4gICAgICAgIC8vIHNwbGl0IHRoZSBiZWFjaCBzZWN0aW9uIGludG8gdHdvIHNlcGFyYXRlIGJlYWNoIHNlY3Rpb25zXG4gICAgICAgIHJBcmMgPSB0aGlzLmNyZWF0ZUJlYWNoc2VjdGlvbihsQXJjLnNpdGUpO1xuICAgICAgICB0aGlzLmJlYWNobGluZS5yYkluc2VydFN1Y2Nlc3NvcihuZXdBcmMsIHJBcmMpO1xuXG4gICAgICAgIC8vIHNpbmNlIHdlIGhhdmUgYSBuZXcgdHJhbnNpdGlvbiBiZXR3ZWVuIHR3byBiZWFjaCBzZWN0aW9ucyxcbiAgICAgICAgLy8gYSBuZXcgZWRnZSBpcyBib3JuXG4gICAgICAgIG5ld0FyYy5lZGdlID0gckFyYy5lZGdlID0gdGhpcy5jcmVhdGVFZGdlKGxBcmMuc2l0ZSwgbmV3QXJjLnNpdGUpO1xuXG4gICAgICAgIC8vIGNoZWNrIHdoZXRoZXIgdGhlIGxlZnQgYW5kIHJpZ2h0IGJlYWNoIHNlY3Rpb25zIGFyZSBjb2xsYXBzaW5nXG4gICAgICAgIC8vIGFuZCBpZiBzbyBjcmVhdGUgY2lyY2xlIGV2ZW50cywgdG8gYmUgbm90aWZpZWQgd2hlbiB0aGUgcG9pbnQgb2ZcbiAgICAgICAgLy8gY29sbGFwc2UgaXMgcmVhY2hlZC5cbiAgICAgICAgdGhpcy5hdHRhY2hDaXJjbGVFdmVudChsQXJjKTtcbiAgICAgICAgdGhpcy5hdHRhY2hDaXJjbGVFdmVudChyQXJjKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAvLyBbbEFyYyxudWxsXVxuICAgIC8vIGV2ZW4gbGVzcyBsaWtlbHkgY2FzZTogbmV3IGJlYWNoIHNlY3Rpb24gaXMgdGhlICpsYXN0KiBiZWFjaCBzZWN0aW9uXG4gICAgLy8gb24gdGhlIGJlYWNobGluZSAtLSB0aGlzIGNhbiBoYXBwZW4gKm9ubHkqIGlmICphbGwqIHRoZSBwcmV2aW91cyBiZWFjaFxuICAgIC8vIHNlY3Rpb25zIGN1cnJlbnRseSBvbiB0aGUgYmVhY2hsaW5lIHNoYXJlIHRoZSBzYW1lIHkgdmFsdWUgYXNcbiAgICAvLyB0aGUgbmV3IGJlYWNoIHNlY3Rpb24uXG4gICAgLy8gVGhpcyBjYXNlIG1lYW5zOlxuICAgIC8vICAgb25lIG5ldyB0cmFuc2l0aW9uIGFwcGVhcnNcbiAgICAvLyAgIG5vIGNvbGxhcHNpbmcgYmVhY2ggc2VjdGlvbiBhcyBhIHJlc3VsdFxuICAgIC8vICAgbmV3IGJlYWNoIHNlY3Rpb24gYmVjb21lIHJpZ2h0LW1vc3Qgbm9kZSBvZiB0aGUgUkItdHJlZVxuICAgIGlmIChsQXJjICYmICFyQXJjKSB7XG4gICAgICAgIG5ld0FyYy5lZGdlID0gdGhpcy5jcmVhdGVFZGdlKGxBcmMuc2l0ZSxuZXdBcmMuc2l0ZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgLy8gW251bGwsckFyY11cbiAgICAvLyBpbXBvc3NpYmxlIGNhc2U6IGJlY2F1c2Ugc2l0ZXMgYXJlIHN0cmljdGx5IHByb2Nlc3NlZCBmcm9tIHRvcCB0byBib3R0b20sXG4gICAgLy8gYW5kIGxlZnQgdG8gcmlnaHQsIHdoaWNoIGd1YXJhbnRlZXMgdGhhdCB0aGVyZSB3aWxsIGFsd2F5cyBiZSBhIGJlYWNoIHNlY3Rpb25cbiAgICAvLyBvbiB0aGUgbGVmdCAtLSBleGNlcHQgb2YgY291cnNlIHdoZW4gdGhlcmUgYXJlIG5vIGJlYWNoIHNlY3Rpb24gYXQgYWxsIG9uXG4gICAgLy8gdGhlIGJlYWNoIGxpbmUsIHdoaWNoIGNhc2Ugd2FzIGhhbmRsZWQgYWJvdmUuXG4gICAgLy8gcmhpbGwgMjAxMS0wNi0wMjogTm8gcG9pbnQgdGVzdGluZyBpbiBub24tZGVidWcgdmVyc2lvblxuICAgIC8vaWYgKCFsQXJjICYmIHJBcmMpIHtcbiAgICAvLyAgICB0aHJvdyBcIlZvcm9ub2kuYWRkQmVhY2hzZWN0aW9uKCk6IFdoYXQgaXMgdGhpcyBJIGRvbid0IGV2ZW5cIjtcbiAgICAvLyAgICB9XG5cbiAgICAvLyBbbEFyYyxyQXJjXSB3aGVyZSBsQXJjICE9IHJBcmNcbiAgICAvLyBzb21ld2hhdCBsZXNzIGxpa2VseSBjYXNlOiBuZXcgYmVhY2ggc2VjdGlvbiBmYWxscyAqZXhhY3RseSogaW4gYmV0d2VlbiB0d29cbiAgICAvLyBleGlzdGluZyBiZWFjaCBzZWN0aW9uc1xuICAgIC8vIFRoaXMgY2FzZSBtZWFuczpcbiAgICAvLyAgIG9uZSB0cmFuc2l0aW9uIGRpc2FwcGVhcnNcbiAgICAvLyAgIHR3byBuZXcgdHJhbnNpdGlvbnMgYXBwZWFyXG4gICAgLy8gICB0aGUgbGVmdCBhbmQgcmlnaHQgYmVhY2ggc2VjdGlvbiBtaWdodCBiZSBjb2xsYXBzaW5nIGFzIGEgcmVzdWx0XG4gICAgLy8gICBvbmx5IG9uZSBuZXcgbm9kZSBhZGRlZCB0byB0aGUgUkItdHJlZVxuICAgIGlmIChsQXJjICE9PSByQXJjKSB7XG4gICAgICAgIC8vIGludmFsaWRhdGUgY2lyY2xlIGV2ZW50cyBvZiBsZWZ0IGFuZCByaWdodCBzaXRlc1xuICAgICAgICB0aGlzLmRldGFjaENpcmNsZUV2ZW50KGxBcmMpO1xuICAgICAgICB0aGlzLmRldGFjaENpcmNsZUV2ZW50KHJBcmMpO1xuXG4gICAgICAgIC8vIGFuIGV4aXN0aW5nIHRyYW5zaXRpb24gZGlzYXBwZWFycywgbWVhbmluZyBhIHZlcnRleCBpcyBkZWZpbmVkIGF0XG4gICAgICAgIC8vIHRoZSBkaXNhcHBlYXJhbmNlIHBvaW50LlxuICAgICAgICAvLyBzaW5jZSB0aGUgZGlzYXBwZWFyYW5jZSBpcyBjYXVzZWQgYnkgdGhlIG5ldyBiZWFjaHNlY3Rpb24sIHRoZVxuICAgICAgICAvLyB2ZXJ0ZXggaXMgYXQgdGhlIGNlbnRlciBvZiB0aGUgY2lyY3Vtc2NyaWJlZCBjaXJjbGUgb2YgdGhlIGxlZnQsXG4gICAgICAgIC8vIG5ldyBhbmQgcmlnaHQgYmVhY2hzZWN0aW9ucy5cbiAgICAgICAgLy8gaHR0cDovL21hdGhmb3J1bS5vcmcvbGlicmFyeS9kcm1hdGgvdmlldy81NTAwMi5odG1sXG4gICAgICAgIC8vIEV4Y2VwdCB0aGF0IEkgYnJpbmcgdGhlIG9yaWdpbiBhdCBBIHRvIHNpbXBsaWZ5XG4gICAgICAgIC8vIGNhbGN1bGF0aW9uXG4gICAgICAgIHZhciBsU2l0ZSA9IGxBcmMuc2l0ZSxcbiAgICAgICAgICAgIGF4ID0gbFNpdGUueCxcbiAgICAgICAgICAgIGF5ID0gbFNpdGUueSxcbiAgICAgICAgICAgIGJ4PXNpdGUueC1heCxcbiAgICAgICAgICAgIGJ5PXNpdGUueS1heSxcbiAgICAgICAgICAgIHJTaXRlID0gckFyYy5zaXRlLFxuICAgICAgICAgICAgY3g9clNpdGUueC1heCxcbiAgICAgICAgICAgIGN5PXJTaXRlLnktYXksXG4gICAgICAgICAgICBkPTIqKGJ4KmN5LWJ5KmN4KSxcbiAgICAgICAgICAgIGhiPWJ4KmJ4K2J5KmJ5LFxuICAgICAgICAgICAgaGM9Y3gqY3grY3kqY3ksXG4gICAgICAgICAgICB2ZXJ0ZXggPSB0aGlzLmNyZWF0ZVZlcnRleCgoY3kqaGItYnkqaGMpL2QrYXgsIChieCpoYy1jeCpoYikvZCtheSk7XG5cbiAgICAgICAgLy8gb25lIHRyYW5zaXRpb24gZGlzYXBwZWFyXG4gICAgICAgIHRoaXMuc2V0RWRnZVN0YXJ0cG9pbnQockFyYy5lZGdlLCBsU2l0ZSwgclNpdGUsIHZlcnRleCk7XG5cbiAgICAgICAgLy8gdHdvIG5ldyB0cmFuc2l0aW9ucyBhcHBlYXIgYXQgdGhlIG5ldyB2ZXJ0ZXggbG9jYXRpb25cbiAgICAgICAgbmV3QXJjLmVkZ2UgPSB0aGlzLmNyZWF0ZUVkZ2UobFNpdGUsIHNpdGUsIHVuZGVmaW5lZCwgdmVydGV4KTtcbiAgICAgICAgckFyYy5lZGdlID0gdGhpcy5jcmVhdGVFZGdlKHNpdGUsIHJTaXRlLCB1bmRlZmluZWQsIHZlcnRleCk7XG5cbiAgICAgICAgLy8gY2hlY2sgd2hldGhlciB0aGUgbGVmdCBhbmQgcmlnaHQgYmVhY2ggc2VjdGlvbnMgYXJlIGNvbGxhcHNpbmdcbiAgICAgICAgLy8gYW5kIGlmIHNvIGNyZWF0ZSBjaXJjbGUgZXZlbnRzLCB0byBoYW5kbGUgdGhlIHBvaW50IG9mIGNvbGxhcHNlLlxuICAgICAgICB0aGlzLmF0dGFjaENpcmNsZUV2ZW50KGxBcmMpO1xuICAgICAgICB0aGlzLmF0dGFjaENpcmNsZUV2ZW50KHJBcmMpO1xuICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENpcmNsZSBldmVudCBtZXRob2RzXG5cbi8vIHJoaWxsIDIwMTEtMDYtMDc6IEZvciBzb21lIHJlYXNvbnMsIHBlcmZvcm1hbmNlIHN1ZmZlcnMgc2lnbmlmaWNhbnRseVxuLy8gd2hlbiBpbnN0YW5jaWF0aW5nIGEgbGl0ZXJhbCBvYmplY3QgaW5zdGVhZCBvZiBhbiBlbXB0eSBjdG9yXG5Wb3Jvbm9pLnByb3RvdHlwZS5DaXJjbGVFdmVudCA9IGZ1bmN0aW9uKCkge1xuICAgIC8vIHJoaWxsIDIwMTMtMTAtMTI6IGl0IGhlbHBzIHRvIHN0YXRlIGV4YWN0bHkgd2hhdCB3ZSBhcmUgYXQgY3RvciB0aW1lLlxuICAgIHRoaXMuYXJjID0gbnVsbDtcbiAgICB0aGlzLnJiTGVmdCA9IG51bGw7XG4gICAgdGhpcy5yYk5leHQgPSBudWxsO1xuICAgIHRoaXMucmJQYXJlbnQgPSBudWxsO1xuICAgIHRoaXMucmJQcmV2aW91cyA9IG51bGw7XG4gICAgdGhpcy5yYlJlZCA9IGZhbHNlO1xuICAgIHRoaXMucmJSaWdodCA9IG51bGw7XG4gICAgdGhpcy5zaXRlID0gbnVsbDtcbiAgICB0aGlzLnggPSB0aGlzLnkgPSB0aGlzLnljZW50ZXIgPSAwO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLmF0dGFjaENpcmNsZUV2ZW50ID0gZnVuY3Rpb24oYXJjKSB7XG4gICAgdmFyIGxBcmMgPSBhcmMucmJQcmV2aW91cyxcbiAgICAgICAgckFyYyA9IGFyYy5yYk5leHQ7XG4gICAgaWYgKCFsQXJjIHx8ICFyQXJjKSB7cmV0dXJuO30gLy8gZG9lcyB0aGF0IGV2ZXIgaGFwcGVuP1xuICAgIHZhciBsU2l0ZSA9IGxBcmMuc2l0ZSxcbiAgICAgICAgY1NpdGUgPSBhcmMuc2l0ZSxcbiAgICAgICAgclNpdGUgPSByQXJjLnNpdGU7XG5cbiAgICAvLyBJZiBzaXRlIG9mIGxlZnQgYmVhY2hzZWN0aW9uIGlzIHNhbWUgYXMgc2l0ZSBvZlxuICAgIC8vIHJpZ2h0IGJlYWNoc2VjdGlvbiwgdGhlcmUgY2FuJ3QgYmUgY29udmVyZ2VuY2VcbiAgICBpZiAobFNpdGU9PT1yU2l0ZSkge3JldHVybjt9XG5cbiAgICAvLyBGaW5kIHRoZSBjaXJjdW1zY3JpYmVkIGNpcmNsZSBmb3IgdGhlIHRocmVlIHNpdGVzIGFzc29jaWF0ZWRcbiAgICAvLyB3aXRoIHRoZSBiZWFjaHNlY3Rpb24gdHJpcGxldC5cbiAgICAvLyByaGlsbCAyMDExLTA1LTI2OiBJdCBpcyBtb3JlIGVmZmljaWVudCB0byBjYWxjdWxhdGUgaW4tcGxhY2VcbiAgICAvLyByYXRoZXIgdGhhbiBnZXR0aW5nIHRoZSByZXN1bHRpbmcgY2lyY3Vtc2NyaWJlZCBjaXJjbGUgZnJvbSBhblxuICAgIC8vIG9iamVjdCByZXR1cm5lZCBieSBjYWxsaW5nIFZvcm9ub2kuY2lyY3VtY2lyY2xlKClcbiAgICAvLyBodHRwOi8vbWF0aGZvcnVtLm9yZy9saWJyYXJ5L2RybWF0aC92aWV3LzU1MDAyLmh0bWxcbiAgICAvLyBFeGNlcHQgdGhhdCBJIGJyaW5nIHRoZSBvcmlnaW4gYXQgY1NpdGUgdG8gc2ltcGxpZnkgY2FsY3VsYXRpb25zLlxuICAgIC8vIFRoZSBib3R0b20tbW9zdCBwYXJ0IG9mIHRoZSBjaXJjdW1jaXJjbGUgaXMgb3VyIEZvcnR1bmUgJ2NpcmNsZVxuICAgIC8vIGV2ZW50JywgYW5kIGl0cyBjZW50ZXIgaXMgYSB2ZXJ0ZXggcG90ZW50aWFsbHkgcGFydCBvZiB0aGUgZmluYWxcbiAgICAvLyBWb3Jvbm9pIGRpYWdyYW0uXG4gICAgdmFyIGJ4ID0gY1NpdGUueCxcbiAgICAgICAgYnkgPSBjU2l0ZS55LFxuICAgICAgICBheCA9IGxTaXRlLngtYngsXG4gICAgICAgIGF5ID0gbFNpdGUueS1ieSxcbiAgICAgICAgY3ggPSByU2l0ZS54LWJ4LFxuICAgICAgICBjeSA9IHJTaXRlLnktYnk7XG5cbiAgICAvLyBJZiBwb2ludHMgbC0+Yy0+ciBhcmUgY2xvY2t3aXNlLCB0aGVuIGNlbnRlciBiZWFjaCBzZWN0aW9uIGRvZXMgbm90XG4gICAgLy8gY29sbGFwc2UsIGhlbmNlIGl0IGNhbid0IGVuZCB1cCBhcyBhIHZlcnRleCAod2UgcmV1c2UgJ2QnIGhlcmUsIHdoaWNoXG4gICAgLy8gc2lnbiBpcyByZXZlcnNlIG9mIHRoZSBvcmllbnRhdGlvbiwgaGVuY2Ugd2UgcmV2ZXJzZSB0aGUgdGVzdC5cbiAgICAvLyBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0N1cnZlX29yaWVudGF0aW9uI09yaWVudGF0aW9uX29mX2Ffc2ltcGxlX3BvbHlnb25cbiAgICAvLyByaGlsbCAyMDExLTA1LTIxOiBOYXN0eSBmaW5pdGUgcHJlY2lzaW9uIGVycm9yIHdoaWNoIGNhdXNlZCBjaXJjdW1jaXJjbGUoKSB0b1xuICAgIC8vIHJldHVybiBpbmZpbml0ZXM6IDFlLTEyIHNlZW1zIHRvIGZpeCB0aGUgcHJvYmxlbS5cbiAgICB2YXIgZCA9IDIqKGF4KmN5LWF5KmN4KTtcbiAgICBpZiAoZCA+PSAtMmUtMTIpe3JldHVybjt9XG5cbiAgICB2YXIgaGEgPSBheCpheCtheSpheSxcbiAgICAgICAgaGMgPSBjeCpjeCtjeSpjeSxcbiAgICAgICAgeCA9IChjeSpoYS1heSpoYykvZCxcbiAgICAgICAgeSA9IChheCpoYy1jeCpoYSkvZCxcbiAgICAgICAgeWNlbnRlciA9IHkrYnk7XG5cbiAgICAvLyBJbXBvcnRhbnQ6IHlib3R0b20gc2hvdWxkIGFsd2F5cyBiZSB1bmRlciBvciBhdCBzd2VlcCwgc28gbm8gbmVlZFxuICAgIC8vIHRvIHdhc3RlIENQVSBjeWNsZXMgYnkgY2hlY2tpbmdcblxuICAgIC8vIHJlY3ljbGUgY2lyY2xlIGV2ZW50IG9iamVjdCBpZiBwb3NzaWJsZVxuICAgIHZhciBjaXJjbGVFdmVudCA9IHRoaXMuY2lyY2xlRXZlbnRKdW5reWFyZC5wb3AoKTtcbiAgICBpZiAoIWNpcmNsZUV2ZW50KSB7XG4gICAgICAgIGNpcmNsZUV2ZW50ID0gbmV3IHRoaXMuQ2lyY2xlRXZlbnQoKTtcbiAgICAgICAgfVxuICAgIGNpcmNsZUV2ZW50LmFyYyA9IGFyYztcbiAgICBjaXJjbGVFdmVudC5zaXRlID0gY1NpdGU7XG4gICAgY2lyY2xlRXZlbnQueCA9IHgrYng7XG4gICAgY2lyY2xlRXZlbnQueSA9IHljZW50ZXIrdGhpcy5zcXJ0KHgqeCt5KnkpOyAvLyB5IGJvdHRvbVxuICAgIGNpcmNsZUV2ZW50LnljZW50ZXIgPSB5Y2VudGVyO1xuICAgIGFyYy5jaXJjbGVFdmVudCA9IGNpcmNsZUV2ZW50O1xuXG4gICAgLy8gZmluZCBpbnNlcnRpb24gcG9pbnQgaW4gUkItdHJlZTogY2lyY2xlIGV2ZW50cyBhcmUgb3JkZXJlZCBmcm9tXG4gICAgLy8gc21hbGxlc3QgdG8gbGFyZ2VzdFxuICAgIHZhciBwcmVkZWNlc3NvciA9IG51bGwsXG4gICAgICAgIG5vZGUgPSB0aGlzLmNpcmNsZUV2ZW50cy5yb290O1xuICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgIGlmIChjaXJjbGVFdmVudC55IDwgbm9kZS55IHx8IChjaXJjbGVFdmVudC55ID09PSBub2RlLnkgJiYgY2lyY2xlRXZlbnQueCA8PSBub2RlLngpKSB7XG4gICAgICAgICAgICBpZiAobm9kZS5yYkxlZnQpIHtcbiAgICAgICAgICAgICAgICBub2RlID0gbm9kZS5yYkxlZnQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgcHJlZGVjZXNzb3IgPSBub2RlLnJiUHJldmlvdXM7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGlmIChub2RlLnJiUmlnaHQpIHtcbiAgICAgICAgICAgICAgICBub2RlID0gbm9kZS5yYlJpZ2h0O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHByZWRlY2Vzc29yID0gbm9kZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB0aGlzLmNpcmNsZUV2ZW50cy5yYkluc2VydFN1Y2Nlc3NvcihwcmVkZWNlc3NvciwgY2lyY2xlRXZlbnQpO1xuICAgIGlmICghcHJlZGVjZXNzb3IpIHtcbiAgICAgICAgdGhpcy5maXJzdENpcmNsZUV2ZW50ID0gY2lyY2xlRXZlbnQ7XG4gICAgICAgIH1cbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5kZXRhY2hDaXJjbGVFdmVudCA9IGZ1bmN0aW9uKGFyYykge1xuICAgIHZhciBjaXJjbGVFdmVudCA9IGFyYy5jaXJjbGVFdmVudDtcbiAgICBpZiAoY2lyY2xlRXZlbnQpIHtcbiAgICAgICAgaWYgKCFjaXJjbGVFdmVudC5yYlByZXZpb3VzKSB7XG4gICAgICAgICAgICB0aGlzLmZpcnN0Q2lyY2xlRXZlbnQgPSBjaXJjbGVFdmVudC5yYk5leHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIHRoaXMuY2lyY2xlRXZlbnRzLnJiUmVtb3ZlTm9kZShjaXJjbGVFdmVudCk7IC8vIHJlbW92ZSBmcm9tIFJCLXRyZWVcbiAgICAgICAgdGhpcy5jaXJjbGVFdmVudEp1bmt5YXJkLnB1c2goY2lyY2xlRXZlbnQpO1xuICAgICAgICBhcmMuY2lyY2xlRXZlbnQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEaWFncmFtIGNvbXBsZXRpb24gbWV0aG9kc1xuXG4vLyBjb25uZWN0IGRhbmdsaW5nIGVkZ2VzIChub3QgaWYgYSBjdXJzb3J5IHRlc3QgdGVsbHMgdXNcbi8vIGl0IGlzIG5vdCBnb2luZyB0byBiZSB2aXNpYmxlLlxuLy8gcmV0dXJuIHZhbHVlOlxuLy8gICBmYWxzZTogdGhlIGRhbmdsaW5nIGVuZHBvaW50IGNvdWxkbid0IGJlIGNvbm5lY3RlZFxuLy8gICB0cnVlOiB0aGUgZGFuZ2xpbmcgZW5kcG9pbnQgY291bGQgYmUgY29ubmVjdGVkXG5Wb3Jvbm9pLnByb3RvdHlwZS5jb25uZWN0RWRnZSA9IGZ1bmN0aW9uKGVkZ2UsIGJib3gpIHtcbiAgICAvLyBza2lwIGlmIGVuZCBwb2ludCBhbHJlYWR5IGNvbm5lY3RlZFxuICAgIHZhciB2YiA9IGVkZ2UudmI7XG4gICAgaWYgKCEhdmIpIHtyZXR1cm4gdHJ1ZTt9XG5cbiAgICAvLyBtYWtlIGxvY2FsIGNvcHkgZm9yIHBlcmZvcm1hbmNlIHB1cnBvc2VcbiAgICB2YXIgdmEgPSBlZGdlLnZhLFxuICAgICAgICB4bCA9IGJib3gueGwsXG4gICAgICAgIHhyID0gYmJveC54cixcbiAgICAgICAgeXQgPSBiYm94Lnl0LFxuICAgICAgICB5YiA9IGJib3gueWIsXG4gICAgICAgIGxTaXRlID0gZWRnZS5sU2l0ZSxcbiAgICAgICAgclNpdGUgPSBlZGdlLnJTaXRlLFxuICAgICAgICBseCA9IGxTaXRlLngsXG4gICAgICAgIGx5ID0gbFNpdGUueSxcbiAgICAgICAgcnggPSByU2l0ZS54LFxuICAgICAgICByeSA9IHJTaXRlLnksXG4gICAgICAgIGZ4ID0gKGx4K3J4KS8yLFxuICAgICAgICBmeSA9IChseStyeSkvMixcbiAgICAgICAgZm0sIGZiO1xuXG4gICAgLy8gaWYgd2UgcmVhY2ggaGVyZSwgdGhpcyBtZWFucyBjZWxscyB3aGljaCB1c2UgdGhpcyBlZGdlIHdpbGwgbmVlZFxuICAgIC8vIHRvIGJlIGNsb3NlZCwgd2hldGhlciBiZWNhdXNlIHRoZSBlZGdlIHdhcyByZW1vdmVkLCBvciBiZWNhdXNlIGl0XG4gICAgLy8gd2FzIGNvbm5lY3RlZCB0byB0aGUgYm91bmRpbmcgYm94LlxuICAgIHRoaXMuY2VsbHNbbFNpdGUudm9yb25vaUlkXS5jbG9zZU1lID0gdHJ1ZTtcbiAgICB0aGlzLmNlbGxzW3JTaXRlLnZvcm9ub2lJZF0uY2xvc2VNZSA9IHRydWU7XG5cbiAgICAvLyBnZXQgdGhlIGxpbmUgZXF1YXRpb24gb2YgdGhlIGJpc2VjdG9yIGlmIGxpbmUgaXMgbm90IHZlcnRpY2FsXG4gICAgaWYgKHJ5ICE9PSBseSkge1xuICAgICAgICBmbSA9IChseC1yeCkvKHJ5LWx5KTtcbiAgICAgICAgZmIgPSBmeS1mbSpmeDtcbiAgICAgICAgfVxuXG4gICAgLy8gcmVtZW1iZXIsIGRpcmVjdGlvbiBvZiBsaW5lIChyZWxhdGl2ZSB0byBsZWZ0IHNpdGUpOlxuICAgIC8vIHVwd2FyZDogbGVmdC54IDwgcmlnaHQueFxuICAgIC8vIGRvd253YXJkOiBsZWZ0LnggPiByaWdodC54XG4gICAgLy8gaG9yaXpvbnRhbDogbGVmdC54ID09IHJpZ2h0LnhcbiAgICAvLyB1cHdhcmQ6IGxlZnQueCA8IHJpZ2h0LnhcbiAgICAvLyByaWdodHdhcmQ6IGxlZnQueSA8IHJpZ2h0LnlcbiAgICAvLyBsZWZ0d2FyZDogbGVmdC55ID4gcmlnaHQueVxuICAgIC8vIHZlcnRpY2FsOiBsZWZ0LnkgPT0gcmlnaHQueVxuXG4gICAgLy8gZGVwZW5kaW5nIG9uIHRoZSBkaXJlY3Rpb24sIGZpbmQgdGhlIGJlc3Qgc2lkZSBvZiB0aGVcbiAgICAvLyBib3VuZGluZyBib3ggdG8gdXNlIHRvIGRldGVybWluZSBhIHJlYXNvbmFibGUgc3RhcnQgcG9pbnRcblxuICAgIC8vIHJoaWxsIDIwMTMtMTItMDI6XG4gICAgLy8gV2hpbGUgYXQgaXQsIHNpbmNlIHdlIGhhdmUgdGhlIHZhbHVlcyB3aGljaCBkZWZpbmUgdGhlIGxpbmUsXG4gICAgLy8gY2xpcCB0aGUgZW5kIG9mIHZhIGlmIGl0IGlzIG91dHNpZGUgdGhlIGJib3guXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL2lzc3Vlcy8xNVxuICAgIC8vIFRPRE86IERvIGFsbCB0aGUgY2xpcHBpbmcgaGVyZSByYXRoZXIgdGhhbiByZWx5IG9uIExpYW5nLUJhcnNreVxuICAgIC8vIHdoaWNoIGRvZXMgbm90IGRvIHdlbGwgc29tZXRpbWVzIGR1ZSB0byBsb3NzIG9mIGFyaXRobWV0aWNcbiAgICAvLyBwcmVjaXNpb24uIFRoZSBjb2RlIGhlcmUgZG9lc24ndCBkZWdyYWRlIGlmIG9uZSBvZiB0aGUgdmVydGV4IGlzXG4gICAgLy8gYXQgYSBodWdlIGRpc3RhbmNlLlxuXG4gICAgLy8gc3BlY2lhbCBjYXNlOiB2ZXJ0aWNhbCBsaW5lXG4gICAgaWYgKGZtID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy8gZG9lc24ndCBpbnRlcnNlY3Qgd2l0aCB2aWV3cG9ydFxuICAgICAgICBpZiAoZnggPCB4bCB8fCBmeCA+PSB4cikge3JldHVybiBmYWxzZTt9XG4gICAgICAgIC8vIGRvd253YXJkXG4gICAgICAgIGlmIChseCA+IHJ4KSB7XG4gICAgICAgICAgICBpZiAoIXZhIHx8IHZhLnkgPCB5dCkge1xuICAgICAgICAgICAgICAgIHZhID0gdGhpcy5jcmVhdGVWZXJ0ZXgoZngsIHl0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICh2YS55ID49IHliKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoZngsIHliKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgLy8gdXB3YXJkXG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgaWYgKCF2YSB8fCB2YS55ID4geWIpIHtcbiAgICAgICAgICAgICAgICB2YSA9IHRoaXMuY3JlYXRlVmVydGV4KGZ4LCB5Yik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAodmEueSA8IHl0KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoZngsIHl0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIC8vIGNsb3NlciB0byB2ZXJ0aWNhbCB0aGFuIGhvcml6b250YWwsIGNvbm5lY3Qgc3RhcnQgcG9pbnQgdG8gdGhlXG4gICAgLy8gdG9wIG9yIGJvdHRvbSBzaWRlIG9mIHRoZSBib3VuZGluZyBib3hcbiAgICBlbHNlIGlmIChmbSA8IC0xIHx8IGZtID4gMSkge1xuICAgICAgICAvLyBkb3dud2FyZFxuICAgICAgICBpZiAobHggPiByeCkge1xuICAgICAgICAgICAgaWYgKCF2YSB8fCB2YS55IDwgeXQpIHtcbiAgICAgICAgICAgICAgICB2YSA9IHRoaXMuY3JlYXRlVmVydGV4KCh5dC1mYikvZm0sIHl0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICh2YS55ID49IHliKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoKHliLWZiKS9mbSwgeWIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAvLyB1cHdhcmRcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBpZiAoIXZhIHx8IHZhLnkgPiB5Yikge1xuICAgICAgICAgICAgICAgIHZhID0gdGhpcy5jcmVhdGVWZXJ0ZXgoKHliLWZiKS9mbSwgeWIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHZhLnkgPCB5dCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KCh5dC1mYikvZm0sIHl0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIC8vIGNsb3NlciB0byBob3Jpem9udGFsIHRoYW4gdmVydGljYWwsIGNvbm5lY3Qgc3RhcnQgcG9pbnQgdG8gdGhlXG4gICAgLy8gbGVmdCBvciByaWdodCBzaWRlIG9mIHRoZSBib3VuZGluZyBib3hcbiAgICBlbHNlIHtcbiAgICAgICAgLy8gcmlnaHR3YXJkXG4gICAgICAgIGlmIChseSA8IHJ5KSB7XG4gICAgICAgICAgICBpZiAoIXZhIHx8IHZhLnggPCB4bCkge1xuICAgICAgICAgICAgICAgIHZhID0gdGhpcy5jcmVhdGVWZXJ0ZXgoeGwsIGZtKnhsK2ZiKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICh2YS54ID49IHhyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoeHIsIGZtKnhyK2ZiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgLy8gbGVmdHdhcmRcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBpZiAoIXZhIHx8IHZhLnggPiB4cikge1xuICAgICAgICAgICAgICAgIHZhID0gdGhpcy5jcmVhdGVWZXJ0ZXgoeHIsIGZtKnhyK2ZiKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICh2YS54IDwgeGwpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCh4bCwgZm0qeGwrZmIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgZWRnZS52YSA9IHZhO1xuICAgIGVkZ2UudmIgPSB2YjtcblxuICAgIHJldHVybiB0cnVlO1xuICAgIH07XG5cbi8vIGxpbmUtY2xpcHBpbmcgY29kZSB0YWtlbiBmcm9tOlxuLy8gICBMaWFuZy1CYXJza3kgZnVuY3Rpb24gYnkgRGFuaWVsIFdoaXRlXG4vLyAgIGh0dHA6Ly93d3cuc2t5dG9waWEuY29tL3Byb2plY3QvYXJ0aWNsZXMvY29tcHNjaS9jbGlwcGluZy5odG1sXG4vLyBUaGFua3MhXG4vLyBBIGJpdCBtb2RpZmllZCB0byBtaW5pbWl6ZSBjb2RlIHBhdGhzXG5Wb3Jvbm9pLnByb3RvdHlwZS5jbGlwRWRnZSA9IGZ1bmN0aW9uKGVkZ2UsIGJib3gpIHtcbiAgICB2YXIgYXggPSBlZGdlLnZhLngsXG4gICAgICAgIGF5ID0gZWRnZS52YS55LFxuICAgICAgICBieCA9IGVkZ2UudmIueCxcbiAgICAgICAgYnkgPSBlZGdlLnZiLnksXG4gICAgICAgIHQwID0gMCxcbiAgICAgICAgdDEgPSAxLFxuICAgICAgICBkeCA9IGJ4LWF4LFxuICAgICAgICBkeSA9IGJ5LWF5O1xuICAgIC8vIGxlZnRcbiAgICB2YXIgcSA9IGF4LWJib3gueGw7XG4gICAgaWYgKGR4PT09MCAmJiBxPDApIHtyZXR1cm4gZmFsc2U7fVxuICAgIHZhciByID0gLXEvZHg7XG4gICAgaWYgKGR4PDApIHtcbiAgICAgICAgaWYgKHI8dDApIHtyZXR1cm4gZmFsc2U7fVxuICAgICAgICBpZiAocjx0MSkge3QxPXI7fVxuICAgICAgICB9XG4gICAgZWxzZSBpZiAoZHg+MCkge1xuICAgICAgICBpZiAocj50MSkge3JldHVybiBmYWxzZTt9XG4gICAgICAgIGlmIChyPnQwKSB7dDA9cjt9XG4gICAgICAgIH1cbiAgICAvLyByaWdodFxuICAgIHEgPSBiYm94LnhyLWF4O1xuICAgIGlmIChkeD09PTAgJiYgcTwwKSB7cmV0dXJuIGZhbHNlO31cbiAgICByID0gcS9keDtcbiAgICBpZiAoZHg8MCkge1xuICAgICAgICBpZiAocj50MSkge3JldHVybiBmYWxzZTt9XG4gICAgICAgIGlmIChyPnQwKSB7dDA9cjt9XG4gICAgICAgIH1cbiAgICBlbHNlIGlmIChkeD4wKSB7XG4gICAgICAgIGlmIChyPHQwKSB7cmV0dXJuIGZhbHNlO31cbiAgICAgICAgaWYgKHI8dDEpIHt0MT1yO31cbiAgICAgICAgfVxuICAgIC8vIHRvcFxuICAgIHEgPSBheS1iYm94Lnl0O1xuICAgIGlmIChkeT09PTAgJiYgcTwwKSB7cmV0dXJuIGZhbHNlO31cbiAgICByID0gLXEvZHk7XG4gICAgaWYgKGR5PDApIHtcbiAgICAgICAgaWYgKHI8dDApIHtyZXR1cm4gZmFsc2U7fVxuICAgICAgICBpZiAocjx0MSkge3QxPXI7fVxuICAgICAgICB9XG4gICAgZWxzZSBpZiAoZHk+MCkge1xuICAgICAgICBpZiAocj50MSkge3JldHVybiBmYWxzZTt9XG4gICAgICAgIGlmIChyPnQwKSB7dDA9cjt9XG4gICAgICAgIH1cbiAgICAvLyBib3R0b20gICAgICAgIFxuICAgIHEgPSBiYm94LnliLWF5O1xuICAgIGlmIChkeT09PTAgJiYgcTwwKSB7cmV0dXJuIGZhbHNlO31cbiAgICByID0gcS9keTtcbiAgICBpZiAoZHk8MCkge1xuICAgICAgICBpZiAocj50MSkge3JldHVybiBmYWxzZTt9XG4gICAgICAgIGlmIChyPnQwKSB7dDA9cjt9XG4gICAgICAgIH1cbiAgICBlbHNlIGlmIChkeT4wKSB7XG4gICAgICAgIGlmIChyPHQwKSB7cmV0dXJuIGZhbHNlO31cbiAgICAgICAgaWYgKHI8dDEpIHt0MT1yO31cbiAgICAgICAgfVxuXG4gICAgLy8gaWYgd2UgcmVhY2ggdGhpcyBwb2ludCwgVm9yb25vaSBlZGdlIGlzIHdpdGhpbiBiYm94XG5cbiAgICAvLyBpZiB0MCA+IDAsIHZhIG5lZWRzIHRvIGNoYW5nZVxuICAgIC8vIHJoaWxsIDIwMTEtMDYtMDM6IHdlIG5lZWQgdG8gY3JlYXRlIGEgbmV3IHZlcnRleCByYXRoZXJcbiAgICAvLyB0aGFuIG1vZGlmeWluZyB0aGUgZXhpc3Rpbmcgb25lLCBzaW5jZSB0aGUgZXhpc3RpbmdcbiAgICAvLyBvbmUgaXMgbGlrZWx5IHNoYXJlZCB3aXRoIGF0IGxlYXN0IGFub3RoZXIgZWRnZVxuICAgIGlmICh0MCA+IDApIHtcbiAgICAgICAgZWRnZS52YSA9IHRoaXMuY3JlYXRlVmVydGV4KGF4K3QwKmR4LCBheSt0MCpkeSk7XG4gICAgICAgIH1cblxuICAgIC8vIGlmIHQxIDwgMSwgdmIgbmVlZHMgdG8gY2hhbmdlXG4gICAgLy8gcmhpbGwgMjAxMS0wNi0wMzogd2UgbmVlZCB0byBjcmVhdGUgYSBuZXcgdmVydGV4IHJhdGhlclxuICAgIC8vIHRoYW4gbW9kaWZ5aW5nIHRoZSBleGlzdGluZyBvbmUsIHNpbmNlIHRoZSBleGlzdGluZ1xuICAgIC8vIG9uZSBpcyBsaWtlbHkgc2hhcmVkIHdpdGggYXQgbGVhc3QgYW5vdGhlciBlZGdlXG4gICAgaWYgKHQxIDwgMSkge1xuICAgICAgICBlZGdlLnZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoYXgrdDEqZHgsIGF5K3QxKmR5KTtcbiAgICAgICAgfVxuXG4gICAgLy8gdmEgYW5kL29yIHZiIHdlcmUgY2xpcHBlZCwgdGh1cyB3ZSB3aWxsIG5lZWQgdG8gY2xvc2VcbiAgICAvLyBjZWxscyB3aGljaCB1c2UgdGhpcyBlZGdlLlxuICAgIGlmICggdDAgPiAwIHx8IHQxIDwgMSApIHtcbiAgICAgICAgdGhpcy5jZWxsc1tlZGdlLmxTaXRlLnZvcm9ub2lJZF0uY2xvc2VNZSA9IHRydWU7XG4gICAgICAgIHRoaXMuY2VsbHNbZWRnZS5yU2l0ZS52b3Jvbm9pSWRdLmNsb3NlTWUgPSB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xuICAgIH07XG5cbi8vIENvbm5lY3QvY3V0IGVkZ2VzIGF0IGJvdW5kaW5nIGJveFxuVm9yb25vaS5wcm90b3R5cGUuY2xpcEVkZ2VzID0gZnVuY3Rpb24oYmJveCkge1xuICAgIC8vIGNvbm5lY3QgYWxsIGRhbmdsaW5nIGVkZ2VzIHRvIGJvdW5kaW5nIGJveFxuICAgIC8vIG9yIGdldCByaWQgb2YgdGhlbSBpZiBpdCBjYW4ndCBiZSBkb25lXG4gICAgdmFyIGVkZ2VzID0gdGhpcy5lZGdlcyxcbiAgICAgICAgaUVkZ2UgPSBlZGdlcy5sZW5ndGgsXG4gICAgICAgIGVkZ2UsXG4gICAgICAgIGFic19mbiA9IE1hdGguYWJzO1xuXG4gICAgLy8gaXRlcmF0ZSBiYWNrd2FyZCBzbyB3ZSBjYW4gc3BsaWNlIHNhZmVseVxuICAgIHdoaWxlIChpRWRnZS0tKSB7XG4gICAgICAgIGVkZ2UgPSBlZGdlc1tpRWRnZV07XG4gICAgICAgIC8vIGVkZ2UgaXMgcmVtb3ZlZCBpZjpcbiAgICAgICAgLy8gICBpdCBpcyB3aG9sbHkgb3V0c2lkZSB0aGUgYm91bmRpbmcgYm94XG4gICAgICAgIC8vICAgaXQgaXMgbG9va2luZyBtb3JlIGxpa2UgYSBwb2ludCB0aGFuIGEgbGluZVxuICAgICAgICBpZiAoIXRoaXMuY29ubmVjdEVkZ2UoZWRnZSwgYmJveCkgfHxcbiAgICAgICAgICAgICF0aGlzLmNsaXBFZGdlKGVkZ2UsIGJib3gpIHx8XG4gICAgICAgICAgICAoYWJzX2ZuKGVkZ2UudmEueC1lZGdlLnZiLngpPDFlLTkgJiYgYWJzX2ZuKGVkZ2UudmEueS1lZGdlLnZiLnkpPDFlLTkpKSB7XG4gICAgICAgICAgICBlZGdlLnZhID0gZWRnZS52YiA9IG51bGw7XG4gICAgICAgICAgICBlZGdlcy5zcGxpY2UoaUVkZ2UsMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xuXG4vLyBDbG9zZSB0aGUgY2VsbHMuXG4vLyBUaGUgY2VsbHMgYXJlIGJvdW5kIGJ5IHRoZSBzdXBwbGllZCBib3VuZGluZyBib3guXG4vLyBFYWNoIGNlbGwgcmVmZXJzIHRvIGl0cyBhc3NvY2lhdGVkIHNpdGUsIGFuZCBhIGxpc3Rcbi8vIG9mIGhhbGZlZGdlcyBvcmRlcmVkIGNvdW50ZXJjbG9ja3dpc2UuXG5Wb3Jvbm9pLnByb3RvdHlwZS5jbG9zZUNlbGxzID0gZnVuY3Rpb24oYmJveCkge1xuICAgIHZhciB4bCA9IGJib3gueGwsXG4gICAgICAgIHhyID0gYmJveC54cixcbiAgICAgICAgeXQgPSBiYm94Lnl0LFxuICAgICAgICB5YiA9IGJib3gueWIsXG4gICAgICAgIGNlbGxzID0gdGhpcy5jZWxscyxcbiAgICAgICAgaUNlbGwgPSBjZWxscy5sZW5ndGgsXG4gICAgICAgIGNlbGwsXG4gICAgICAgIGlMZWZ0LFxuICAgICAgICBoYWxmZWRnZXMsIG5IYWxmZWRnZXMsXG4gICAgICAgIGVkZ2UsXG4gICAgICAgIHZhLCB2YiwgdnosXG4gICAgICAgIGxhc3RCb3JkZXJTZWdtZW50LFxuICAgICAgICBhYnNfZm4gPSBNYXRoLmFicztcblxuICAgIHdoaWxlIChpQ2VsbC0tKSB7XG4gICAgICAgIGNlbGwgPSBjZWxsc1tpQ2VsbF07XG4gICAgICAgIC8vIHBydW5lLCBvcmRlciBoYWxmZWRnZXMgY291bnRlcmNsb2Nrd2lzZSwgdGhlbiBhZGQgbWlzc2luZyBvbmVzXG4gICAgICAgIC8vIHJlcXVpcmVkIHRvIGNsb3NlIGNlbGxzXG4gICAgICAgIGlmICghY2VsbC5wcmVwYXJlSGFsZmVkZ2VzKCkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICBpZiAoIWNlbGwuY2xvc2VNZSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIC8vIGZpbmQgZmlyc3QgJ3VuY2xvc2VkJyBwb2ludC5cbiAgICAgICAgLy8gYW4gJ3VuY2xvc2VkJyBwb2ludCB3aWxsIGJlIHRoZSBlbmQgcG9pbnQgb2YgYSBoYWxmZWRnZSB3aGljaFxuICAgICAgICAvLyBkb2VzIG5vdCBtYXRjaCB0aGUgc3RhcnQgcG9pbnQgb2YgdGhlIGZvbGxvd2luZyBoYWxmZWRnZVxuICAgICAgICBoYWxmZWRnZXMgPSBjZWxsLmhhbGZlZGdlcztcbiAgICAgICAgbkhhbGZlZGdlcyA9IGhhbGZlZGdlcy5sZW5ndGg7XG4gICAgICAgIC8vIHNwZWNpYWwgY2FzZTogb25seSBvbmUgc2l0ZSwgaW4gd2hpY2ggY2FzZSwgdGhlIHZpZXdwb3J0IGlzIHRoZSBjZWxsXG4gICAgICAgIC8vIC4uLlxuXG4gICAgICAgIC8vIGFsbCBvdGhlciBjYXNlc1xuICAgICAgICBpTGVmdCA9IDA7XG4gICAgICAgIHdoaWxlIChpTGVmdCA8IG5IYWxmZWRnZXMpIHtcbiAgICAgICAgICAgIHZhID0gaGFsZmVkZ2VzW2lMZWZ0XS5nZXRFbmRwb2ludCgpO1xuICAgICAgICAgICAgdnogPSBoYWxmZWRnZXNbKGlMZWZ0KzEpICUgbkhhbGZlZGdlc10uZ2V0U3RhcnRwb2ludCgpO1xuICAgICAgICAgICAgLy8gaWYgZW5kIHBvaW50IGlzIG5vdCBlcXVhbCB0byBzdGFydCBwb2ludCwgd2UgbmVlZCB0byBhZGQgdGhlIG1pc3NpbmdcbiAgICAgICAgICAgIC8vIGhhbGZlZGdlKHMpIHVwIHRvIHZ6XG4gICAgICAgICAgICBpZiAoYWJzX2ZuKHZhLngtdnoueCk+PTFlLTkgfHwgYWJzX2ZuKHZhLnktdnoueSk+PTFlLTkpIHtcblxuICAgICAgICAgICAgICAgIC8vIHJoaWxsIDIwMTMtMTItMDI6XG4gICAgICAgICAgICAgICAgLy8gXCJIb2xlc1wiIGluIHRoZSBoYWxmZWRnZXMgYXJlIG5vdCBuZWNlc3NhcmlseSBhbHdheXMgYWRqYWNlbnQuXG4gICAgICAgICAgICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL2lzc3Vlcy8xNlxuXG4gICAgICAgICAgICAgICAgLy8gZmluZCBlbnRyeSBwb2ludDpcbiAgICAgICAgICAgICAgICBzd2l0Y2ggKHRydWUpIHtcblxuICAgICAgICAgICAgICAgICAgICAvLyB3YWxrIGRvd253YXJkIGFsb25nIGxlZnQgc2lkZVxuICAgICAgICAgICAgICAgICAgICBjYXNlIHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2YS54LHhsKSAmJiB0aGlzLmxlc3NUaGFuV2l0aEVwc2lsb24odmEueSx5Yik6XG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei54LHhsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoeGwsIGxhc3RCb3JkZXJTZWdtZW50ID8gdnoueSA6IHliKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkZ2UgPSB0aGlzLmNyZWF0ZUJvcmRlckVkZ2UoY2VsbC5zaXRlLCB2YSwgdmIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGZlZGdlcy5zcGxpY2UoaUxlZnQsIDAsIHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgY2VsbC5zaXRlLCBudWxsKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBuSGFsZmVkZ2VzKys7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmEgPSB2YjtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZhbGwgdGhyb3VnaFxuXG4gICAgICAgICAgICAgICAgICAgIC8vIHdhbGsgcmlnaHR3YXJkIGFsb25nIGJvdHRvbSBzaWRlXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZhLnkseWIpICYmIHRoaXMubGVzc1RoYW5XaXRoRXBzaWxvbih2YS54LHhyKTpcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RCb3JkZXJTZWdtZW50ID0gdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZ6LnkseWIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleChsYXN0Qm9yZGVyU2VnbWVudCA/IHZ6LnggOiB4ciwgeWIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZWRnZSA9IHRoaXMuY3JlYXRlQm9yZGVyRWRnZShjZWxsLnNpdGUsIHZhLCB2Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpTGVmdCsrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5IYWxmZWRnZXMrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggbGFzdEJvcmRlclNlZ21lbnQgKSB7IGJyZWFrOyB9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YSA9IHZiO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZmFsbCB0aHJvdWdoXG5cbiAgICAgICAgICAgICAgICAgICAgLy8gd2FsayB1cHdhcmQgYWxvbmcgcmlnaHQgc2lkZVxuICAgICAgICAgICAgICAgICAgICBjYXNlIHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2YS54LHhyKSAmJiB0aGlzLmdyZWF0ZXJUaGFuV2l0aEVwc2lsb24odmEueSx5dCk6XG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei54LHhyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoeHIsIGxhc3RCb3JkZXJTZWdtZW50ID8gdnoueSA6IHl0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkZ2UgPSB0aGlzLmNyZWF0ZUJvcmRlckVkZ2UoY2VsbC5zaXRlLCB2YSwgdmIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGZlZGdlcy5zcGxpY2UoaUxlZnQsIDAsIHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgY2VsbC5zaXRlLCBudWxsKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBuSGFsZmVkZ2VzKys7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmEgPSB2YjtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZhbGwgdGhyb3VnaFxuXG4gICAgICAgICAgICAgICAgICAgIC8vIHdhbGsgbGVmdHdhcmQgYWxvbmcgdG9wIHNpZGVcbiAgICAgICAgICAgICAgICAgICAgY2FzZSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odmEueSx5dCkgJiYgdGhpcy5ncmVhdGVyVGhhbldpdGhFcHNpbG9uKHZhLngseGwpOlxuICAgICAgICAgICAgICAgICAgICAgICAgbGFzdEJvcmRlclNlZ21lbnQgPSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odnoueSx5dCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KGxhc3RCb3JkZXJTZWdtZW50ID8gdnoueCA6IHhsLCB5dCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlMZWZ0Kys7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlMZWZ0LCAwLCB0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIGNlbGwuc2l0ZSwgbnVsbCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBsYXN0Qm9yZGVyU2VnbWVudCApIHsgYnJlYWs7IH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZhID0gdmI7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcblxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2FsayBkb3dud2FyZCBhbG9uZyBsZWZ0IHNpZGVcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RCb3JkZXJTZWdtZW50ID0gdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZ6LngseGwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCh4bCwgbGFzdEJvcmRlclNlZ21lbnQgPyB2ei55IDogeWIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZWRnZSA9IHRoaXMuY3JlYXRlQm9yZGVyRWRnZShjZWxsLnNpdGUsIHZhLCB2Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpTGVmdCsrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5IYWxmZWRnZXMrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggbGFzdEJvcmRlclNlZ21lbnQgKSB7IGJyZWFrOyB9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YSA9IHZiO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZmFsbCB0aHJvdWdoXG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdhbGsgcmlnaHR3YXJkIGFsb25nIGJvdHRvbSBzaWRlXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei55LHliKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgobGFzdEJvcmRlclNlZ21lbnQgPyB2ei54IDogeHIsIHliKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkZ2UgPSB0aGlzLmNyZWF0ZUJvcmRlckVkZ2UoY2VsbC5zaXRlLCB2YSwgdmIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGZlZGdlcy5zcGxpY2UoaUxlZnQsIDAsIHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgY2VsbC5zaXRlLCBudWxsKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBuSGFsZmVkZ2VzKys7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmEgPSB2YjtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZhbGwgdGhyb3VnaFxuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB3YWxrIHVwd2FyZCBhbG9uZyByaWdodCBzaWRlXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei54LHhyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoeHIsIGxhc3RCb3JkZXJTZWdtZW50ID8gdnoueSA6IHl0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkZ2UgPSB0aGlzLmNyZWF0ZUJvcmRlckVkZ2UoY2VsbC5zaXRlLCB2YSwgdmIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGZlZGdlcy5zcGxpY2UoaUxlZnQsIDAsIHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgY2VsbC5zaXRlLCBudWxsKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBuSGFsZmVkZ2VzKys7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZmFsbCB0aHJvdWdoXG5cbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IFwiVm9yb25vaS5jbG9zZUNlbGxzKCkgPiB0aGlzIG1ha2VzIG5vIHNlbnNlIVwiO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaUxlZnQrKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgY2VsbC5jbG9zZU1lID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlYnVnZ2luZyBoZWxwZXJcbi8qXG5Wb3Jvbm9pLnByb3RvdHlwZS5kdW1wQmVhY2hsaW5lID0gZnVuY3Rpb24oeSkge1xuICAgIGNvbnNvbGUubG9nKCdWb3Jvbm9pLmR1bXBCZWFjaGxpbmUoJWYpID4gQmVhY2hzZWN0aW9ucywgZnJvbSBsZWZ0IHRvIHJpZ2h0OicsIHkpO1xuICAgIGlmICggIXRoaXMuYmVhY2hsaW5lICkge1xuICAgICAgICBjb25zb2xlLmxvZygnICBOb25lJyk7XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgdmFyIGJzID0gdGhpcy5iZWFjaGxpbmUuZ2V0Rmlyc3QodGhpcy5iZWFjaGxpbmUucm9vdCk7XG4gICAgICAgIHdoaWxlICggYnMgKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnICBzaXRlICVkOiB4bDogJWYsIHhyOiAlZicsIGJzLnNpdGUudm9yb25vaUlkLCB0aGlzLmxlZnRCcmVha1BvaW50KGJzLCB5KSwgdGhpcy5yaWdodEJyZWFrUG9pbnQoYnMsIHkpKTtcbiAgICAgICAgICAgIGJzID0gYnMucmJOZXh0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfTtcbiovXG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVscGVyOiBRdWFudGl6ZSBzaXRlc1xuXG4vLyByaGlsbCAyMDEzLTEwLTEyOlxuLy8gVGhpcyBpcyB0byBzb2x2ZSBodHRwczovL2dpdGh1Yi5jb20vZ29yaGlsbC9KYXZhc2NyaXB0LVZvcm9ub2kvaXNzdWVzLzE1XG4vLyBTaW5jZSBub3QgYWxsIHVzZXJzIHdpbGwgZW5kIHVwIHVzaW5nIHRoZSBraW5kIG9mIGNvb3JkIHZhbHVlcyB3aGljaCB3b3VsZFxuLy8gY2F1c2UgdGhlIGlzc3VlIHRvIGFyaXNlLCBJIGNob3NlIHRvIGxldCB0aGUgdXNlciBkZWNpZGUgd2hldGhlciBvciBub3Rcbi8vIGhlIHNob3VsZCBzYW5pdGl6ZSBoaXMgY29vcmQgdmFsdWVzIHRocm91Z2ggdGhpcyBoZWxwZXIuIFRoaXMgd2F5LCBmb3Jcbi8vIHRob3NlIHVzZXJzIHdobyB1c2VzIGNvb3JkIHZhbHVlcyB3aGljaCBhcmUga25vd24gdG8gYmUgZmluZSwgbm8gb3ZlcmhlYWQgaXNcbi8vIGFkZGVkLlxuXG5Wb3Jvbm9pLnByb3RvdHlwZS5xdWFudGl6ZVNpdGVzID0gZnVuY3Rpb24oc2l0ZXMpIHtcbiAgICB2YXIgzrUgPSB0aGlzLs61LFxuICAgICAgICBuID0gc2l0ZXMubGVuZ3RoLFxuICAgICAgICBzaXRlO1xuICAgIHdoaWxlICggbi0tICkge1xuICAgICAgICBzaXRlID0gc2l0ZXNbbl07XG4gICAgICAgIHNpdGUueCA9IE1hdGguZmxvb3Ioc2l0ZS54IC8gzrUpICogzrU7XG4gICAgICAgIHNpdGUueSA9IE1hdGguZmxvb3Ioc2l0ZS55IC8gzrUpICogzrU7XG4gICAgICAgIH1cbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEhlbHBlcjogUmVjeWNsZSBkaWFncmFtOiBhbGwgdmVydGV4LCBlZGdlIGFuZCBjZWxsIG9iamVjdHMgYXJlXG4vLyBcInN1cnJlbmRlcmVkXCIgdG8gdGhlIFZvcm9ub2kgb2JqZWN0IGZvciByZXVzZS5cbi8vIFRPRE86IHJoaWxsLXZvcm9ub2ktY29yZSB2MjogbW9yZSBwZXJmb3JtYW5jZSB0byBiZSBnYWluZWRcbi8vIHdoZW4gSSBjaGFuZ2UgdGhlIHNlbWFudGljIG9mIHdoYXQgaXMgcmV0dXJuZWQuXG5cblZvcm9ub2kucHJvdG90eXBlLnJlY3ljbGUgPSBmdW5jdGlvbihkaWFncmFtKSB7XG4gICAgaWYgKCBkaWFncmFtICkge1xuICAgICAgICBpZiAoIGRpYWdyYW0gaW5zdGFuY2VvZiB0aGlzLkRpYWdyYW0gKSB7XG4gICAgICAgICAgICB0aGlzLnRvUmVjeWNsZSA9IGRpYWdyYW07XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgJ1Zvcm9ub2kucmVjeWNsZURpYWdyYW0oKSA+IE5lZWQgYSBEaWFncmFtIG9iamVjdC4nO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3AtbGV2ZWwgRm9ydHVuZSBsb29wXG5cbi8vIHJoaWxsIDIwMTEtMDUtMTk6XG4vLyAgIFZvcm9ub2kgc2l0ZXMgYXJlIGtlcHQgY2xpZW50LXNpZGUgbm93LCB0byBhbGxvd1xuLy8gICB1c2VyIHRvIGZyZWVseSBtb2RpZnkgY29udGVudC4gQXQgY29tcHV0ZSB0aW1lLFxuLy8gICAqcmVmZXJlbmNlcyogdG8gc2l0ZXMgYXJlIGNvcGllZCBsb2NhbGx5LlxuXG5Wb3Jvbm9pLnByb3RvdHlwZS5jb21wdXRlID0gZnVuY3Rpb24oc2l0ZXMsIGJib3gpIHtcbiAgICAvLyB0byBtZWFzdXJlIGV4ZWN1dGlvbiB0aW1lXG4gICAgdmFyIHN0YXJ0VGltZSA9IG5ldyBEYXRlKCk7XG5cbiAgICAvLyBpbml0IGludGVybmFsIHN0YXRlXG4gICAgdGhpcy5yZXNldCgpO1xuXG4gICAgLy8gYW55IGRpYWdyYW0gZGF0YSBhdmFpbGFibGUgZm9yIHJlY3ljbGluZz9cbiAgICAvLyBJIGRvIHRoYXQgaGVyZSBzbyB0aGF0IHRoaXMgaXMgaW5jbHVkZWQgaW4gZXhlY3V0aW9uIHRpbWVcbiAgICBpZiAoIHRoaXMudG9SZWN5Y2xlICkge1xuICAgICAgICB0aGlzLnZlcnRleEp1bmt5YXJkID0gdGhpcy52ZXJ0ZXhKdW5reWFyZC5jb25jYXQodGhpcy50b1JlY3ljbGUudmVydGljZXMpO1xuICAgICAgICB0aGlzLmVkZ2VKdW5reWFyZCA9IHRoaXMuZWRnZUp1bmt5YXJkLmNvbmNhdCh0aGlzLnRvUmVjeWNsZS5lZGdlcyk7XG4gICAgICAgIHRoaXMuY2VsbEp1bmt5YXJkID0gdGhpcy5jZWxsSnVua3lhcmQuY29uY2F0KHRoaXMudG9SZWN5Y2xlLmNlbGxzKTtcbiAgICAgICAgdGhpcy50b1JlY3ljbGUgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAvLyBJbml0aWFsaXplIHNpdGUgZXZlbnQgcXVldWVcbiAgICB2YXIgc2l0ZUV2ZW50cyA9IHNpdGVzLnNsaWNlKDApO1xuICAgIHNpdGVFdmVudHMuc29ydChmdW5jdGlvbihhLGIpe1xuICAgICAgICB2YXIgciA9IGIueSAtIGEueTtcbiAgICAgICAgaWYgKHIpIHtyZXR1cm4gcjt9XG4gICAgICAgIHJldHVybiBiLnggLSBhLng7XG4gICAgICAgIH0pO1xuXG4gICAgLy8gcHJvY2VzcyBxdWV1ZVxuICAgIHZhciBzaXRlID0gc2l0ZUV2ZW50cy5wb3AoKSxcbiAgICAgICAgc2l0ZWlkID0gMCxcbiAgICAgICAgeHNpdGV4LCAvLyB0byBhdm9pZCBkdXBsaWNhdGUgc2l0ZXNcbiAgICAgICAgeHNpdGV5LFxuICAgICAgICBjZWxscyA9IHRoaXMuY2VsbHMsXG4gICAgICAgIGNpcmNsZTtcblxuICAgIC8vIG1haW4gbG9vcFxuICAgIGZvciAoOzspIHtcbiAgICAgICAgLy8gd2UgbmVlZCB0byBmaWd1cmUgd2hldGhlciB3ZSBoYW5kbGUgYSBzaXRlIG9yIGNpcmNsZSBldmVudFxuICAgICAgICAvLyBmb3IgdGhpcyB3ZSBmaW5kIG91dCBpZiB0aGVyZSBpcyBhIHNpdGUgZXZlbnQgYW5kIGl0IGlzXG4gICAgICAgIC8vICdlYXJsaWVyJyB0aGFuIHRoZSBjaXJjbGUgZXZlbnRcbiAgICAgICAgY2lyY2xlID0gdGhpcy5maXJzdENpcmNsZUV2ZW50O1xuXG4gICAgICAgIC8vIGFkZCBiZWFjaCBzZWN0aW9uXG4gICAgICAgIGlmIChzaXRlICYmICghY2lyY2xlIHx8IHNpdGUueSA8IGNpcmNsZS55IHx8IChzaXRlLnkgPT09IGNpcmNsZS55ICYmIHNpdGUueCA8IGNpcmNsZS54KSkpIHtcbiAgICAgICAgICAgIC8vIG9ubHkgaWYgc2l0ZSBpcyBub3QgYSBkdXBsaWNhdGVcbiAgICAgICAgICAgIGlmIChzaXRlLnggIT09IHhzaXRleCB8fCBzaXRlLnkgIT09IHhzaXRleSkge1xuICAgICAgICAgICAgICAgIC8vIGZpcnN0IGNyZWF0ZSBjZWxsIGZvciBuZXcgc2l0ZVxuICAgICAgICAgICAgICAgIGNlbGxzW3NpdGVpZF0gPSB0aGlzLmNyZWF0ZUNlbGwoc2l0ZSk7XG4gICAgICAgICAgICAgICAgc2l0ZS52b3Jvbm9pSWQgPSBzaXRlaWQrKztcbiAgICAgICAgICAgICAgICAvLyB0aGVuIGNyZWF0ZSBhIGJlYWNoc2VjdGlvbiBmb3IgdGhhdCBzaXRlXG4gICAgICAgICAgICAgICAgdGhpcy5hZGRCZWFjaHNlY3Rpb24oc2l0ZSk7XG4gICAgICAgICAgICAgICAgLy8gcmVtZW1iZXIgbGFzdCBzaXRlIGNvb3JkcyB0byBkZXRlY3QgZHVwbGljYXRlXG4gICAgICAgICAgICAgICAgeHNpdGV5ID0gc2l0ZS55O1xuICAgICAgICAgICAgICAgIHhzaXRleCA9IHNpdGUueDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBzaXRlID0gc2l0ZUV2ZW50cy5wb3AoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAvLyByZW1vdmUgYmVhY2ggc2VjdGlvblxuICAgICAgICBlbHNlIGlmIChjaXJjbGUpIHtcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlQmVhY2hzZWN0aW9uKGNpcmNsZS5hcmMpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIC8vIGFsbCBkb25lLCBxdWl0XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIC8vIHdyYXBwaW5nLXVwOlxuICAgIC8vICAgY29ubmVjdCBkYW5nbGluZyBlZGdlcyB0byBib3VuZGluZyBib3hcbiAgICAvLyAgIGN1dCBlZGdlcyBhcyBwZXIgYm91bmRpbmcgYm94XG4gICAgLy8gICBkaXNjYXJkIGVkZ2VzIGNvbXBsZXRlbHkgb3V0c2lkZSBib3VuZGluZyBib3hcbiAgICAvLyAgIGRpc2NhcmQgZWRnZXMgd2hpY2ggYXJlIHBvaW50LWxpa2VcbiAgICB0aGlzLmNsaXBFZGdlcyhiYm94KTtcblxuICAgIC8vICAgYWRkIG1pc3NpbmcgZWRnZXMgaW4gb3JkZXIgdG8gY2xvc2Ugb3BlbmVkIGNlbGxzXG4gICAgdGhpcy5jbG9zZUNlbGxzKGJib3gpO1xuXG4gICAgLy8gdG8gbWVhc3VyZSBleGVjdXRpb24gdGltZVxuICAgIHZhciBzdG9wVGltZSA9IG5ldyBEYXRlKCk7XG5cbiAgICAvLyBwcmVwYXJlIHJldHVybiB2YWx1ZXNcbiAgICB2YXIgZGlhZ3JhbSA9IG5ldyB0aGlzLkRpYWdyYW0oKTtcbiAgICBkaWFncmFtLmNlbGxzID0gdGhpcy5jZWxscztcbiAgICBkaWFncmFtLmVkZ2VzID0gdGhpcy5lZGdlcztcbiAgICBkaWFncmFtLnZlcnRpY2VzID0gdGhpcy52ZXJ0aWNlcztcbiAgICBkaWFncmFtLmV4ZWNUaW1lID0gc3RvcFRpbWUuZ2V0VGltZSgpLXN0YXJ0VGltZS5nZXRUaW1lKCk7XG5cbiAgICAvLyBjbGVhbiB1cFxuICAgIHRoaXMucmVzZXQoKTtcblxuICAgIHJldHVybiBkaWFncmFtO1xuICAgIH07XG5cbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbmlmICggdHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBWb3Jvbm9pO1xufVxuIiwiIiwiLypcbnBvaXNzb24tZGlzay1zYW1wbGVcblxuaHR0cHM6Ly9naXRodWIuY29tL2plZmZyZXktaGVhcm4vcG9pc3Nvbi1kaXNrLXNhbXBsZVxuXG5NSVQgTGljZW5zZVxuKi9cblxuZnVuY3Rpb24gUG9pc3NvbkRpc2tTYW1wbGVyKHdpZHRoLCBoZWlnaHQsIG1pbkRpc3RhbmNlLCBzYW1wbGVGcmVxdWVuY3kpIHtcbiAgICB0aGlzLndpZHRoID0gd2lkdGg7XG4gICAgdGhpcy5oZWlnaHQgPSBoZWlnaHQ7XG4gICAgdGhpcy5taW5EaXN0YW5jZSA9IG1pbkRpc3RhbmNlO1xuICAgIHRoaXMuc2FtcGxlRnJlcXVlbmN5ID0gc2FtcGxlRnJlcXVlbmN5O1xuICAgIHRoaXMucmVzZXQoKTtcbn1cblxuUG9pc3NvbkRpc2tTYW1wbGVyLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZ3JpZCA9IG5ldyBHcmlkKHRoaXMud2lkdGgsIHRoaXMuaGVpZ2h0LCB0aGlzLm1pbkRpc3RhbmNlKTtcbiAgICB0aGlzLm91dHB1dExpc3QgPSBuZXcgQXJyYXkoKTtcbiAgICB0aGlzLnByb2Nlc3NpbmdRdWV1ZSA9IG5ldyBSYW5kb21RdWV1ZSgpO1xufVxuXG5Qb2lzc29uRGlza1NhbXBsZXIucHJvdG90eXBlLnNhbXBsZVVudGlsU29sdXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICB3aGlsZSAodGhpcy5zYW1wbGUoKSkge307XG4gICAgcmV0dXJuIHRoaXMub3V0cHV0TGlzdDtcbn1cblxuUG9pc3NvbkRpc2tTYW1wbGVyLnByb3RvdHlwZS5zYW1wbGUgPSBmdW5jdGlvbigpIHtcblxuICAgIC8vIElmIHRoaXMgaXMgdGhlIGZpcnN0IHNhbXBsZVxuICAgIGlmICgwID09IHRoaXMub3V0cHV0TGlzdC5sZW5ndGgpIHtcbiAgICAgICAgLy8gR2VuZXJhdGUgZmlyc3QgcG9pbnRcbiAgICAgICAgdGhpcy5xdWV1ZVRvQWxsKHRoaXMuZ3JpZC5yYW5kb21Qb2ludCgpKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgdmFyIHByb2Nlc3NQb2ludCA9IHRoaXMucHJvY2Vzc2luZ1F1ZXVlLnBvcCgpO1xuXG4gICAgLy8gUHJvY2Vzc2luZyBxdWV1ZSBpcyBlbXB0eSwgcmV0dXJuIGZhaWx1cmVcbiAgICBpZiAocHJvY2Vzc1BvaW50ID09IG51bGwpXG4gICAgICAgIHJldHVybiBmYWxzZTtcblxuICAgIC8vIEdlbmVyYXRlIHNhbXBsZSBwb2ludHMgYXJvdW5kIHRoZSBwcm9jZXNzaW5nIHBvaW50XG4gICAgLy8gQW5kIGNoZWNrIGlmIHRoZXkgaGF2ZSBhbnkgbmVpZ2hib3JzIG9uIHRoZSBncmlkXG4gICAgLy8gSWYgbm90LCBhZGQgdGhlbSB0byB0aGUgcXVldWVzXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnNhbXBsZUZyZXF1ZW5jeTsgaSsrKSB7XG4gICAgICAgIHNhbXBsZVBvaW50ID0gdGhpcy5ncmlkLnJhbmRvbVBvaW50QXJvdW5kKHByb2Nlc3NQb2ludCk7XG4gICAgICAgIGlmICghdGhpcy5ncmlkLmluTmVpZ2hib3Job29kKHNhbXBsZVBvaW50KSkge1xuICAgICAgICAgICAgLy8gTm8gb24gaW4gbmVpZ2hib3Job29kLCB3ZWxjb21lIHRvIHRoZSBjbHViXG4gICAgICAgICAgICB0aGlzLnF1ZXVlVG9BbGwoc2FtcGxlUG9pbnQpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8vIFNhbXBsZSBzdWNjZXNzZnVsIHNpbmNlIHRoZSBwcm9jZXNzaW5nIHF1ZXVlIGlzbid0IGVtcHR5XG4gICAgcmV0dXJuIHRydWU7XG59XG5cblBvaXNzb25EaXNrU2FtcGxlci5wcm90b3R5cGUucXVldWVUb0FsbCA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gICAgdmFyIHZhbGlkID0gdGhpcy5ncmlkLmFkZFBvaW50VG9HcmlkKHBvaW50LCB0aGlzLmdyaWQucGl4ZWxzVG9HcmlkQ29vcmRzKHBvaW50KSk7XG4gICAgaWYgKCF2YWxpZClcbiAgICAgICAgcmV0dXJuO1xuICAgIHRoaXMucHJvY2Vzc2luZ1F1ZXVlLnB1c2gocG9pbnQpO1xuICAgIHRoaXMub3V0cHV0TGlzdC5wdXNoKHBvaW50KTtcbn1cblxuXG5cbmZ1bmN0aW9uIEdyaWQod2lkdGgsIGhlaWdodCwgbWluRGlzdGFuY2UpIHtcbiAgICB0aGlzLndpZHRoID0gd2lkdGg7XG4gICAgdGhpcy5oZWlnaHQgPSBoZWlnaHQ7XG4gICAgdGhpcy5taW5EaXN0YW5jZSA9IG1pbkRpc3RhbmNlO1xuICAgIHRoaXMuY2VsbFNpemUgPSB0aGlzLm1pbkRpc3RhbmNlIC8gTWF0aC5TUVJUMjtcbiAgICAvL2NvbnNvbGUubG9nKCB0aGlzLmNlbGxTaXplICk7XG4gICAgdGhpcy5wb2ludFNpemUgPSAyO1xuXG4gICAgdGhpcy5jZWxsc1dpZGUgPSBNYXRoLmNlaWwodGhpcy53aWR0aCAvIHRoaXMuY2VsbFNpemUpO1xuICAgIHRoaXMuY2VsbHNIaWdoID0gTWF0aC5jZWlsKHRoaXMuaGVpZ2h0IC8gdGhpcy5jZWxsU2l6ZSk7XG5cbiAgICAvLyBJbml0aWFsaXplIGdyaWRcbiAgICB0aGlzLmdyaWQgPSBbXTtcbiAgICBmb3IgKHZhciB4ID0gMDsgeCA8IHRoaXMuY2VsbHNXaWRlOyB4KyspIHtcbiAgICAgICAgdGhpcy5ncmlkW3hdID0gW107XG4gICAgICAgIGZvciAodmFyIHkgPSAwOyB5IDwgdGhpcy5jZWxsc0hpZ2g7IHkrKykge1xuICAgICAgICAgICAgdGhpcy5ncmlkW3hdW3ldID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuR3JpZC5wcm90b3R5cGUucGl4ZWxzVG9HcmlkQ29vcmRzID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgICB2YXIgZ3JpZFggPSBNYXRoLmZsb29yKHBvaW50LnggLyB0aGlzLmNlbGxTaXplKTtcbiAgICB2YXIgZ3JpZFkgPSBNYXRoLmZsb29yKHBvaW50LnkgLyB0aGlzLmNlbGxTaXplKTtcbiAgICByZXR1cm4geyB4OiBncmlkWCwgeTogZ3JpZFkgfTtcbn1cblxuR3JpZC5wcm90b3R5cGUuYWRkUG9pbnRUb0dyaWQgPSBmdW5jdGlvbihwb2ludENvb3JkcywgZ3JpZENvb3Jkcykge1xuICAgIC8vIENoZWNrIHRoYXQgdGhlIGNvb3JkaW5hdGUgbWFrZXMgc2Vuc2VcbiAgICBpZiAoZ3JpZENvb3Jkcy54IDwgMCB8fCBncmlkQ29vcmRzLnggPiB0aGlzLmdyaWQubGVuZ3RoIC0gMSlcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChncmlkQ29vcmRzLnkgPCAwIHx8IGdyaWRDb29yZHMueSA+IHRoaXMuZ3JpZFtncmlkQ29vcmRzLnhdLmxlbmd0aCAtIDEpXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB0aGlzLmdyaWRbZ3JpZENvb3Jkcy54XVtncmlkQ29vcmRzLnldID0gcG9pbnRDb29yZHM7XG4gICAgLy9jb25zb2xlLmxvZyggXCJBZGRpbmcgKFwiK3BvaW50Q29vcmRzLngrXCIsXCIrcG9pbnRDb29yZHMueStcIiB0byBncmlkIFtcIitncmlkQ29vcmRzLngrXCIsXCIrZ3JpZENvb3Jkcy55K1wiXVwiICk7XG4gICAgcmV0dXJuIHRydWU7XG59XG5cbkdyaWQucHJvdG90eXBlLnJhbmRvbVBvaW50ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHsgeDogZ2V0UmFuZG9tQXJiaXRyYXJ5KDAsIHRoaXMud2lkdGgpLCB5OiBnZXRSYW5kb21BcmJpdHJhcnkoMCwgdGhpcy5oZWlnaHQpIH07XG59XG5cbkdyaWQucHJvdG90eXBlLnJhbmRvbVBvaW50QXJvdW5kID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgICB2YXIgcjEgPSBNYXRoLnJhbmRvbSgpO1xuICAgIHZhciByMiA9IE1hdGgucmFuZG9tKCk7XG4gICAgLy8gZ2V0IGEgcmFuZG9tIHJhZGl1cyBiZXR3ZWVuIHRoZSBtaW4gZGlzdGFuY2UgYW5kIDIgWCBtaW5kaXN0XG4gICAgdmFyIHJhZGl1cyA9IHRoaXMubWluRGlzdGFuY2UgKiAocjEgKyAxKTtcbiAgICAvLyBnZXQgcmFuZG9tIGFuZ2xlIGFyb3VuZCB0aGUgY2lyY2xlXG4gICAgdmFyIGFuZ2xlID0gMiAqIE1hdGguUEkgKiByMjtcbiAgICAvLyBnZXQgeCBhbmQgeSBjb29yZHMgYmFzZWQgb24gYW5nbGUgYW5kIHJhZGl1c1xuICAgIHZhciB4ID0gcG9pbnQueCArIHJhZGl1cyAqIE1hdGguY29zKGFuZ2xlKTtcbiAgICB2YXIgeSA9IHBvaW50LnkgKyByYWRpdXMgKiBNYXRoLnNpbihhbmdsZSk7XG4gICAgcmV0dXJuIHsgeDogeCwgeTogeSB9O1xufVxuXG5HcmlkLnByb3RvdHlwZS5pbk5laWdoYm9yaG9vZCA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gICAgdmFyIGdyaWRQb2ludCA9IHRoaXMucGl4ZWxzVG9HcmlkQ29vcmRzKHBvaW50KTtcblxuICAgIHZhciBjZWxsc0Fyb3VuZFBvaW50ID0gdGhpcy5jZWxsc0Fyb3VuZFBvaW50KHBvaW50KTtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2VsbHNBcm91bmRQb2ludC5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoY2VsbHNBcm91bmRQb2ludFtpXSAhPSBudWxsKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5jYWxjRGlzdGFuY2UoY2VsbHNBcm91bmRQb2ludFtpXSwgcG9pbnQpIDwgdGhpcy5taW5EaXN0YW5jZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuR3JpZC5wcm90b3R5cGUuY2VsbHNBcm91bmRQb2ludCA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gICAgdmFyIGdyaWRDb29yZHMgPSB0aGlzLnBpeGVsc1RvR3JpZENvb3Jkcyhwb2ludCk7XG4gICAgdmFyIG5laWdoYm9ycyA9IG5ldyBBcnJheSgpO1xuXG4gICAgZm9yICh2YXIgeCA9IC0yOyB4IDwgMzsgeCsrKSB7XG4gICAgICAgIHZhciB0YXJnZXRYID0gZ3JpZENvb3Jkcy54ICsgeDtcbiAgICAgICAgLy8gbWFrZSBzdXJlIGxvd2VyYm91bmQgYW5kIHVwcGVyYm91bmQgbWFrZSBzZW5zZVxuICAgICAgICBpZiAodGFyZ2V0WCA8IDApXG4gICAgICAgICAgICB0YXJnZXRYID0gMDtcbiAgICAgICAgaWYgKHRhcmdldFggPiB0aGlzLmdyaWQubGVuZ3RoIC0gMSlcbiAgICAgICAgICAgIHRhcmdldFggPSB0aGlzLmdyaWQubGVuZ3RoIC0gMTtcblxuICAgICAgICBmb3IgKHZhciB5ID0gLTI7IHkgPCAzOyB5KyspIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRZID0gZ3JpZENvb3Jkcy55ICsgeTtcbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSBsb3dlcmJvdW5kIGFuZCB1cHBlcmJvdW5kIG1ha2Ugc2Vuc2VcbiAgICAgICAgICAgIGlmICh0YXJnZXRZIDwgMClcbiAgICAgICAgICAgICAgICB0YXJnZXRZID0gMDtcbiAgICAgICAgICAgIGlmICh0YXJnZXRZID4gdGhpcy5ncmlkW3RhcmdldFhdLmxlbmd0aCAtIDEpXG4gICAgICAgICAgICAgICAgdGFyZ2V0WSA9IHRoaXMuZ3JpZFt0YXJnZXRYXS5sZW5ndGggLSAxO1xuICAgICAgICAgICAgbmVpZ2hib3JzLnB1c2godGhpcy5ncmlkW3RhcmdldFhdW3RhcmdldFldKVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBuZWlnaGJvcnM7XG59XG5cbkdyaWQucHJvdG90eXBlLmNhbGNEaXN0YW5jZSA9IGZ1bmN0aW9uKHBvaW50SW5DZWxsLCBwb2ludCkge1xuICAgIHJldHVybiBNYXRoLnNxcnQoKHBvaW50LnggLSBwb2ludEluQ2VsbC54KSAqIChwb2ludC54IC0gcG9pbnRJbkNlbGwueCkgK1xuICAgICAgICAocG9pbnQueSAtIHBvaW50SW5DZWxsLnkpICogKHBvaW50LnkgLSBwb2ludEluQ2VsbC55KSk7XG59XG5cblxuZnVuY3Rpb24gUmFuZG9tUXVldWUoYSkge1xuICAgIHRoaXMucXVldWUgPSBhIHx8IG5ldyBBcnJheSgpO1xufVxuXG5SYW5kb21RdWV1ZS5wcm90b3R5cGUucHVzaCA9IGZ1bmN0aW9uKGVsZW1lbnQpIHtcbiAgICB0aGlzLnF1ZXVlLnB1c2goZWxlbWVudCk7XG59XG5cblJhbmRvbVF1ZXVlLnByb3RvdHlwZS5wb3AgPSBmdW5jdGlvbigpIHtcblxuICAgIHJhbmRvbUluZGV4ID0gZ2V0UmFuZG9tSW50KDAsIHRoaXMucXVldWUubGVuZ3RoKTtcbiAgICB3aGlsZSAodGhpcy5xdWV1ZVtyYW5kb21JbmRleF0gPT09IHVuZGVmaW5lZCkge1xuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSBxdWV1ZSBpcyBlbXB0eVxuICAgICAgICB2YXIgZW1wdHkgPSB0cnVlO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMucXVldWUubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0aGlzLnF1ZXVlW2ldICE9PSB1bmRlZmluZWQpXG4gICAgICAgICAgICAgICAgZW1wdHkgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZW1wdHkpXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcblxuICAgICAgICByYW5kb21JbmRleCA9IGdldFJhbmRvbUludCgwLCB0aGlzLnF1ZXVlLmxlbmd0aCk7XG4gICAgfVxuXG4gICAgZWxlbWVudCA9IHRoaXMucXVldWVbcmFuZG9tSW5kZXhdO1xuICAgIHRoaXMucXVldWUucmVtb3ZlKHJhbmRvbUluZGV4KTtcbiAgICByZXR1cm4gZWxlbWVudDtcbn1cblxuLy8gQXJyYXkgUmVtb3ZlIC0gQnkgSm9obiBSZXNpZyAoTUlUIExpY2Vuc2VkKVxuQXJyYXkucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGZyb20sIHRvKSB7XG4gICAgdmFyIHJlc3QgPSB0aGlzLnNsaWNlKCh0byB8fCBmcm9tKSArIDEgfHwgdGhpcy5sZW5ndGgpO1xuICAgIHRoaXMubGVuZ3RoID0gZnJvbSA8IDAgPyB0aGlzLmxlbmd0aCArIGZyb20gOiBmcm9tO1xuICAgIHJldHVybiB0aGlzLnB1c2guYXBwbHkodGhpcywgcmVzdCk7XG59O1xuXG4vLyBNRE4gUmFuZG9tIE51bWJlciBGdW5jdGlvbnNcbi8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvTWF0aC9yYW5kb21cbmZ1bmN0aW9uIGdldFJhbmRvbUFyYml0cmFyeShtaW4sIG1heCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpICogKG1heCAtIG1pbikgKyBtaW47XG59XG5cbmZ1bmN0aW9uIGdldFJhbmRvbUludChtaW4sIG1heCkge1xuICAgIHJldHVybiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAobWF4IC0gbWluICsgMSkpICsgbWluO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFBvaXNzb25EaXNrU2FtcGxlcjsiLCIvLyBBIGxpYnJhcnkgb2Ygc2VlZGFibGUgUk5HcyBpbXBsZW1lbnRlZCBpbiBKYXZhc2NyaXB0LlxuLy9cbi8vIFVzYWdlOlxuLy9cbi8vIHZhciBzZWVkcmFuZG9tID0gcmVxdWlyZSgnc2VlZHJhbmRvbScpO1xuLy8gdmFyIHJhbmRvbSA9IHNlZWRyYW5kb20oMSk7IC8vIG9yIGFueSBzZWVkLlxuLy8gdmFyIHggPSByYW5kb20oKTsgICAgICAgLy8gMCA8PSB4IDwgMS4gIEV2ZXJ5IGJpdCBpcyByYW5kb20uXG4vLyB2YXIgeCA9IHJhbmRvbS5xdWljaygpOyAvLyAwIDw9IHggPCAxLiAgMzIgYml0cyBvZiByYW5kb21uZXNzLlxuXG4vLyBhbGVhLCBhIDUzLWJpdCBtdWx0aXBseS13aXRoLWNhcnJ5IGdlbmVyYXRvciBieSBKb2hhbm5lcyBCYWFnw7hlLlxuLy8gUGVyaW9kOiB+Ml4xMTZcbi8vIFJlcG9ydGVkIHRvIHBhc3MgYWxsIEJpZ0NydXNoIHRlc3RzLlxudmFyIGFsZWEgPSByZXF1aXJlKCcuL2xpYi9hbGVhJyk7XG5cbi8vIHhvcjEyOCwgYSBwdXJlIHhvci1zaGlmdCBnZW5lcmF0b3IgYnkgR2VvcmdlIE1hcnNhZ2xpYS5cbi8vIFBlcmlvZDogMl4xMjgtMS5cbi8vIFJlcG9ydGVkIHRvIGZhaWw6IE1hdHJpeFJhbmsgYW5kIExpbmVhckNvbXAuXG52YXIgeG9yMTI4ID0gcmVxdWlyZSgnLi9saWIveG9yMTI4Jyk7XG5cbi8vIHhvcndvdywgR2VvcmdlIE1hcnNhZ2xpYSdzIDE2MC1iaXQgeG9yLXNoaWZ0IGNvbWJpbmVkIHBsdXMgd2V5bC5cbi8vIFBlcmlvZDogMl4xOTItMl4zMlxuLy8gUmVwb3J0ZWQgdG8gZmFpbDogQ29sbGlzaW9uT3ZlciwgU2ltcFBva2VyLCBhbmQgTGluZWFyQ29tcC5cbnZhciB4b3J3b3cgPSByZXF1aXJlKCcuL2xpYi94b3J3b3cnKTtcblxuLy8geG9yc2hpZnQ3LCBieSBGcmFuw6dvaXMgUGFubmV0b24gYW5kIFBpZXJyZSBMJ2VjdXllciwgdGFrZXNcbi8vIGEgZGlmZmVyZW50IGFwcHJvYWNoOiBpdCBhZGRzIHJvYnVzdG5lc3MgYnkgYWxsb3dpbmcgbW9yZSBzaGlmdHNcbi8vIHRoYW4gTWFyc2FnbGlhJ3Mgb3JpZ2luYWwgdGhyZWUuICBJdCBpcyBhIDctc2hpZnQgZ2VuZXJhdG9yXG4vLyB3aXRoIDI1NiBiaXRzLCB0aGF0IHBhc3NlcyBCaWdDcnVzaCB3aXRoIG5vIHN5c3RtYXRpYyBmYWlsdXJlcy5cbi8vIFBlcmlvZCAyXjI1Ni0xLlxuLy8gTm8gc3lzdGVtYXRpYyBCaWdDcnVzaCBmYWlsdXJlcyByZXBvcnRlZC5cbnZhciB4b3JzaGlmdDcgPSByZXF1aXJlKCcuL2xpYi94b3JzaGlmdDcnKTtcblxuLy8geG9yNDA5NiwgYnkgUmljaGFyZCBCcmVudCwgaXMgYSA0MDk2LWJpdCB4b3Itc2hpZnQgd2l0aCBhXG4vLyB2ZXJ5IGxvbmcgcGVyaW9kIHRoYXQgYWxzbyBhZGRzIGEgV2V5bCBnZW5lcmF0b3IuIEl0IGFsc28gcGFzc2VzXG4vLyBCaWdDcnVzaCB3aXRoIG5vIHN5c3RlbWF0aWMgZmFpbHVyZXMuICBJdHMgbG9uZyBwZXJpb2QgbWF5XG4vLyBiZSB1c2VmdWwgaWYgeW91IGhhdmUgbWFueSBnZW5lcmF0b3JzIGFuZCBuZWVkIHRvIGF2b2lkXG4vLyBjb2xsaXNpb25zLlxuLy8gUGVyaW9kOiAyXjQxMjgtMl4zMi5cbi8vIE5vIHN5c3RlbWF0aWMgQmlnQ3J1c2ggZmFpbHVyZXMgcmVwb3J0ZWQuXG52YXIgeG9yNDA5NiA9IHJlcXVpcmUoJy4vbGliL3hvcjQwOTYnKTtcblxuLy8gVHljaGUtaSwgYnkgU2FtdWVsIE5ldmVzIGFuZCBGaWxpcGUgQXJhdWpvLCBpcyBhIGJpdC1zaGlmdGluZyByYW5kb21cbi8vIG51bWJlciBnZW5lcmF0b3IgZGVyaXZlZCBmcm9tIENoYUNoYSwgYSBtb2Rlcm4gc3RyZWFtIGNpcGhlci5cbi8vIGh0dHBzOi8vZWRlbi5kZWkudWMucHQvfnNuZXZlcy9wdWJzLzIwMTEtc25mYTIucGRmXG4vLyBQZXJpb2Q6IH4yXjEyN1xuLy8gTm8gc3lzdGVtYXRpYyBCaWdDcnVzaCBmYWlsdXJlcyByZXBvcnRlZC5cbnZhciB0eWNoZWkgPSByZXF1aXJlKCcuL2xpYi90eWNoZWknKTtcblxuLy8gVGhlIG9yaWdpbmFsIEFSQzQtYmFzZWQgcHJuZyBpbmNsdWRlZCBpbiB0aGlzIGxpYnJhcnkuXG4vLyBQZXJpb2Q6IH4yXjE2MDBcbnZhciBzciA9IHJlcXVpcmUoJy4vc2VlZHJhbmRvbScpO1xuXG5zci5hbGVhID0gYWxlYTtcbnNyLnhvcjEyOCA9IHhvcjEyODtcbnNyLnhvcndvdyA9IHhvcndvdztcbnNyLnhvcnNoaWZ0NyA9IHhvcnNoaWZ0NztcbnNyLnhvcjQwOTYgPSB4b3I0MDk2O1xuc3IudHljaGVpID0gdHljaGVpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHNyO1xuIiwiLy8gQSBwb3J0IG9mIGFuIGFsZ29yaXRobSBieSBKb2hhbm5lcyBCYWFnw7hlIDxiYWFnb2VAYmFhZ29lLmNvbT4sIDIwMTBcbi8vIGh0dHA6Ly9iYWFnb2UuY29tL2VuL1JhbmRvbU11c2luZ3MvamF2YXNjcmlwdC9cbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9ucXVpbmxhbi9iZXR0ZXItcmFuZG9tLW51bWJlcnMtZm9yLWphdmFzY3JpcHQtbWlycm9yXG4vLyBPcmlnaW5hbCB3b3JrIGlzIHVuZGVyIE1JVCBsaWNlbnNlIC1cblxuLy8gQ29weXJpZ2h0IChDKSAyMDEwIGJ5IEpvaGFubmVzIEJhYWfDuGUgPGJhYWdvZUBiYWFnb2Uub3JnPlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbi8vIG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWxcbi8vIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHNcbi8vIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGxcbi8vIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuLy8gZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vIFxuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW5cbi8vIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy8gXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG4vLyBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbi8vIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuLy8gQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuLy8gTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSxcbi8vIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU5cbi8vIFRIRSBTT0ZUV0FSRS5cblxuXG5cbihmdW5jdGlvbihnbG9iYWwsIG1vZHVsZSwgZGVmaW5lKSB7XG5cbmZ1bmN0aW9uIEFsZWEoc2VlZCkge1xuICB2YXIgbWUgPSB0aGlzLCBtYXNoID0gTWFzaCgpO1xuXG4gIG1lLm5leHQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgdCA9IDIwOTE2MzkgKiBtZS5zMCArIG1lLmMgKiAyLjMyODMwNjQzNjUzODY5NjNlLTEwOyAvLyAyXi0zMlxuICAgIG1lLnMwID0gbWUuczE7XG4gICAgbWUuczEgPSBtZS5zMjtcbiAgICByZXR1cm4gbWUuczIgPSB0IC0gKG1lLmMgPSB0IHwgMCk7XG4gIH07XG5cbiAgLy8gQXBwbHkgdGhlIHNlZWRpbmcgYWxnb3JpdGhtIGZyb20gQmFhZ29lLlxuICBtZS5jID0gMTtcbiAgbWUuczAgPSBtYXNoKCcgJyk7XG4gIG1lLnMxID0gbWFzaCgnICcpO1xuICBtZS5zMiA9IG1hc2goJyAnKTtcbiAgbWUuczAgLT0gbWFzaChzZWVkKTtcbiAgaWYgKG1lLnMwIDwgMCkgeyBtZS5zMCArPSAxOyB9XG4gIG1lLnMxIC09IG1hc2goc2VlZCk7XG4gIGlmIChtZS5zMSA8IDApIHsgbWUuczEgKz0gMTsgfVxuICBtZS5zMiAtPSBtYXNoKHNlZWQpO1xuICBpZiAobWUuczIgPCAwKSB7IG1lLnMyICs9IDE7IH1cbiAgbWFzaCA9IG51bGw7XG59XG5cbmZ1bmN0aW9uIGNvcHkoZiwgdCkge1xuICB0LmMgPSBmLmM7XG4gIHQuczAgPSBmLnMwO1xuICB0LnMxID0gZi5zMTtcbiAgdC5zMiA9IGYuczI7XG4gIHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBpbXBsKHNlZWQsIG9wdHMpIHtcbiAgdmFyIHhnID0gbmV3IEFsZWEoc2VlZCksXG4gICAgICBzdGF0ZSA9IG9wdHMgJiYgb3B0cy5zdGF0ZSxcbiAgICAgIHBybmcgPSB4Zy5uZXh0O1xuICBwcm5nLmludDMyID0gZnVuY3Rpb24oKSB7IHJldHVybiAoeGcubmV4dCgpICogMHgxMDAwMDAwMDApIHwgMDsgfVxuICBwcm5nLmRvdWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBwcm5nKCkgKyAocHJuZygpICogMHgyMDAwMDAgfCAwKSAqIDEuMTEwMjIzMDI0NjI1MTU2NWUtMTY7IC8vIDJeLTUzXG4gIH07XG4gIHBybmcucXVpY2sgPSBwcm5nO1xuICBpZiAoc3RhdGUpIHtcbiAgICBpZiAodHlwZW9mKHN0YXRlKSA9PSAnb2JqZWN0JykgY29weShzdGF0ZSwgeGcpO1xuICAgIHBybmcuc3RhdGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGNvcHkoeGcsIHt9KTsgfVxuICB9XG4gIHJldHVybiBwcm5nO1xufVxuXG5mdW5jdGlvbiBNYXNoKCkge1xuICB2YXIgbiA9IDB4ZWZjODI0OWQ7XG5cbiAgdmFyIG1hc2ggPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgZGF0YSA9IGRhdGEudG9TdHJpbmcoKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRhdGEubGVuZ3RoOyBpKyspIHtcbiAgICAgIG4gKz0gZGF0YS5jaGFyQ29kZUF0KGkpO1xuICAgICAgdmFyIGggPSAwLjAyNTE5NjAzMjgyNDE2OTM4ICogbjtcbiAgICAgIG4gPSBoID4+PiAwO1xuICAgICAgaCAtPSBuO1xuICAgICAgaCAqPSBuO1xuICAgICAgbiA9IGggPj4+IDA7XG4gICAgICBoIC09IG47XG4gICAgICBuICs9IGggKiAweDEwMDAwMDAwMDsgLy8gMl4zMlxuICAgIH1cbiAgICByZXR1cm4gKG4gPj4+IDApICogMi4zMjgzMDY0MzY1Mzg2OTYzZS0xMDsgLy8gMl4tMzJcbiAgfTtcblxuICByZXR1cm4gbWFzaDtcbn1cblxuXG5pZiAobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gaW1wbDtcbn0gZWxzZSBpZiAoZGVmaW5lICYmIGRlZmluZS5hbWQpIHtcbiAgZGVmaW5lKGZ1bmN0aW9uKCkgeyByZXR1cm4gaW1wbDsgfSk7XG59IGVsc2Uge1xuICB0aGlzLmFsZWEgPSBpbXBsO1xufVxuXG59KShcbiAgdGhpcyxcbiAgKHR5cGVvZiBtb2R1bGUpID09ICdvYmplY3QnICYmIG1vZHVsZSwgICAgLy8gcHJlc2VudCBpbiBub2RlLmpzXG4gICh0eXBlb2YgZGVmaW5lKSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZSAgIC8vIHByZXNlbnQgd2l0aCBhbiBBTUQgbG9hZGVyXG4pO1xuXG5cbiIsIi8vIEEgSmF2YXNjcmlwdCBpbXBsZW1lbnRhaW9uIG9mIHRoZSBcIlR5Y2hlLWlcIiBwcm5nIGFsZ29yaXRobSBieVxuLy8gU2FtdWVsIE5ldmVzIGFuZCBGaWxpcGUgQXJhdWpvLlxuLy8gU2VlIGh0dHBzOi8vZWRlbi5kZWkudWMucHQvfnNuZXZlcy9wdWJzLzIwMTEtc25mYTIucGRmXG5cbihmdW5jdGlvbihnbG9iYWwsIG1vZHVsZSwgZGVmaW5lKSB7XG5cbmZ1bmN0aW9uIFhvckdlbihzZWVkKSB7XG4gIHZhciBtZSA9IHRoaXMsIHN0cnNlZWQgPSAnJztcblxuICAvLyBTZXQgdXAgZ2VuZXJhdG9yIGZ1bmN0aW9uLlxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGIgPSBtZS5iLCBjID0gbWUuYywgZCA9IG1lLmQsIGEgPSBtZS5hO1xuICAgIGIgPSAoYiA8PCAyNSkgXiAoYiA+Pj4gNykgXiBjO1xuICAgIGMgPSAoYyAtIGQpIHwgMDtcbiAgICBkID0gKGQgPDwgMjQpIF4gKGQgPj4+IDgpIF4gYTtcbiAgICBhID0gKGEgLSBiKSB8IDA7XG4gICAgbWUuYiA9IGIgPSAoYiA8PCAyMCkgXiAoYiA+Pj4gMTIpIF4gYztcbiAgICBtZS5jID0gYyA9IChjIC0gZCkgfCAwO1xuICAgIG1lLmQgPSAoZCA8PCAxNikgXiAoYyA+Pj4gMTYpIF4gYTtcbiAgICByZXR1cm4gbWUuYSA9IChhIC0gYikgfCAwO1xuICB9O1xuXG4gIC8qIFRoZSBmb2xsb3dpbmcgaXMgbm9uLWludmVydGVkIHR5Y2hlLCB3aGljaCBoYXMgYmV0dGVyIGludGVybmFsXG4gICAqIGJpdCBkaWZmdXNpb24sIGJ1dCB3aGljaCBpcyBhYm91dCAyNSUgc2xvd2VyIHRoYW4gdHljaGUtaSBpbiBKUy5cbiAgbWUubmV4dCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhID0gbWUuYSwgYiA9IG1lLmIsIGMgPSBtZS5jLCBkID0gbWUuZDtcbiAgICBhID0gKG1lLmEgKyBtZS5iIHwgMCkgPj4+IDA7XG4gICAgZCA9IG1lLmQgXiBhOyBkID0gZCA8PCAxNiBeIGQgPj4+IDE2O1xuICAgIGMgPSBtZS5jICsgZCB8IDA7XG4gICAgYiA9IG1lLmIgXiBjOyBiID0gYiA8PCAxMiBeIGQgPj4+IDIwO1xuICAgIG1lLmEgPSBhID0gYSArIGIgfCAwO1xuICAgIGQgPSBkIF4gYTsgbWUuZCA9IGQgPSBkIDw8IDggXiBkID4+PiAyNDtcbiAgICBtZS5jID0gYyA9IGMgKyBkIHwgMDtcbiAgICBiID0gYiBeIGM7XG4gICAgcmV0dXJuIG1lLmIgPSAoYiA8PCA3IF4gYiA+Pj4gMjUpO1xuICB9XG4gICovXG5cbiAgbWUuYSA9IDA7XG4gIG1lLmIgPSAwO1xuICBtZS5jID0gMjY1NDQzNTc2OSB8IDA7XG4gIG1lLmQgPSAxMzY3MTMwNTUxO1xuXG4gIGlmIChzZWVkID09PSBNYXRoLmZsb29yKHNlZWQpKSB7XG4gICAgLy8gSW50ZWdlciBzZWVkLlxuICAgIG1lLmEgPSAoc2VlZCAvIDB4MTAwMDAwMDAwKSB8IDA7XG4gICAgbWUuYiA9IHNlZWQgfCAwO1xuICB9IGVsc2Uge1xuICAgIC8vIFN0cmluZyBzZWVkLlxuICAgIHN0cnNlZWQgKz0gc2VlZDtcbiAgfVxuXG4gIC8vIE1peCBpbiBzdHJpbmcgc2VlZCwgdGhlbiBkaXNjYXJkIGFuIGluaXRpYWwgYmF0Y2ggb2YgNjQgdmFsdWVzLlxuICBmb3IgKHZhciBrID0gMDsgayA8IHN0cnNlZWQubGVuZ3RoICsgMjA7IGsrKykge1xuICAgIG1lLmIgXj0gc3Ryc2VlZC5jaGFyQ29kZUF0KGspIHwgMDtcbiAgICBtZS5uZXh0KCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gY29weShmLCB0KSB7XG4gIHQuYSA9IGYuYTtcbiAgdC5iID0gZi5iO1xuICB0LmMgPSBmLmM7XG4gIHQuZCA9IGYuZDtcbiAgcmV0dXJuIHQ7XG59O1xuXG5mdW5jdGlvbiBpbXBsKHNlZWQsIG9wdHMpIHtcbiAgdmFyIHhnID0gbmV3IFhvckdlbihzZWVkKSxcbiAgICAgIHN0YXRlID0gb3B0cyAmJiBvcHRzLnN0YXRlLFxuICAgICAgcHJuZyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMDsgfTtcbiAgcHJuZy5kb3VibGUgPSBmdW5jdGlvbigpIHtcbiAgICBkbyB7XG4gICAgICB2YXIgdG9wID0geGcubmV4dCgpID4+PiAxMSxcbiAgICAgICAgICBib3QgPSAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwLFxuICAgICAgICAgIHJlc3VsdCA9ICh0b3AgKyBib3QpIC8gKDEgPDwgMjEpO1xuICAgIH0gd2hpbGUgKHJlc3VsdCA9PT0gMCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcbiAgcHJuZy5pbnQzMiA9IHhnLm5leHQ7XG4gIHBybmcucXVpY2sgPSBwcm5nO1xuICBpZiAoc3RhdGUpIHtcbiAgICBpZiAodHlwZW9mKHN0YXRlKSA9PSAnb2JqZWN0JykgY29weShzdGF0ZSwgeGcpO1xuICAgIHBybmcuc3RhdGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGNvcHkoeGcsIHt9KTsgfVxuICB9XG4gIHJldHVybiBwcm5nO1xufVxuXG5pZiAobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gaW1wbDtcbn0gZWxzZSBpZiAoZGVmaW5lICYmIGRlZmluZS5hbWQpIHtcbiAgZGVmaW5lKGZ1bmN0aW9uKCkgeyByZXR1cm4gaW1wbDsgfSk7XG59IGVsc2Uge1xuICB0aGlzLnR5Y2hlaSA9IGltcGw7XG59XG5cbn0pKFxuICB0aGlzLFxuICAodHlwZW9mIG1vZHVsZSkgPT0gJ29iamVjdCcgJiYgbW9kdWxlLCAgICAvLyBwcmVzZW50IGluIG5vZGUuanNcbiAgKHR5cGVvZiBkZWZpbmUpID09ICdmdW5jdGlvbicgJiYgZGVmaW5lICAgLy8gcHJlc2VudCB3aXRoIGFuIEFNRCBsb2FkZXJcbik7XG5cblxuIiwiLy8gQSBKYXZhc2NyaXB0IGltcGxlbWVudGFpb24gb2YgdGhlIFwieG9yMTI4XCIgcHJuZyBhbGdvcml0aG0gYnlcbi8vIEdlb3JnZSBNYXJzYWdsaWEuICBTZWUgaHR0cDovL3d3dy5qc3RhdHNvZnQub3JnL3YwOC9pMTQvcGFwZXJcblxuKGZ1bmN0aW9uKGdsb2JhbCwgbW9kdWxlLCBkZWZpbmUpIHtcblxuZnVuY3Rpb24gWG9yR2VuKHNlZWQpIHtcbiAgdmFyIG1lID0gdGhpcywgc3Ryc2VlZCA9ICcnO1xuXG4gIG1lLnggPSAwO1xuICBtZS55ID0gMDtcbiAgbWUueiA9IDA7XG4gIG1lLncgPSAwO1xuXG4gIC8vIFNldCB1cCBnZW5lcmF0b3IgZnVuY3Rpb24uXG4gIG1lLm5leHQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgdCA9IG1lLnggXiAobWUueCA8PCAxMSk7XG4gICAgbWUueCA9IG1lLnk7XG4gICAgbWUueSA9IG1lLno7XG4gICAgbWUueiA9IG1lLnc7XG4gICAgcmV0dXJuIG1lLncgXj0gKG1lLncgPj4+IDE5KSBeIHQgXiAodCA+Pj4gOCk7XG4gIH07XG5cbiAgaWYgKHNlZWQgPT09IChzZWVkIHwgMCkpIHtcbiAgICAvLyBJbnRlZ2VyIHNlZWQuXG4gICAgbWUueCA9IHNlZWQ7XG4gIH0gZWxzZSB7XG4gICAgLy8gU3RyaW5nIHNlZWQuXG4gICAgc3Ryc2VlZCArPSBzZWVkO1xuICB9XG5cbiAgLy8gTWl4IGluIHN0cmluZyBzZWVkLCB0aGVuIGRpc2NhcmQgYW4gaW5pdGlhbCBiYXRjaCBvZiA2NCB2YWx1ZXMuXG4gIGZvciAodmFyIGsgPSAwOyBrIDwgc3Ryc2VlZC5sZW5ndGggKyA2NDsgaysrKSB7XG4gICAgbWUueCBePSBzdHJzZWVkLmNoYXJDb2RlQXQoaykgfCAwO1xuICAgIG1lLm5leHQoKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC54ID0gZi54O1xuICB0LnkgPSBmLnk7XG4gIHQueiA9IGYuejtcbiAgdC53ID0gZi53O1xuICByZXR1cm4gdDtcbn1cblxuZnVuY3Rpb24gaW1wbChzZWVkLCBvcHRzKSB7XG4gIHZhciB4ZyA9IG5ldyBYb3JHZW4oc2VlZCksXG4gICAgICBzdGF0ZSA9IG9wdHMgJiYgb3B0cy5zdGF0ZSxcbiAgICAgIHBybmcgPSBmdW5jdGlvbigpIHsgcmV0dXJuICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDA7IH07XG4gIHBybmcuZG91YmxlID0gZnVuY3Rpb24oKSB7XG4gICAgZG8ge1xuICAgICAgdmFyIHRvcCA9IHhnLm5leHQoKSA+Pj4gMTEsXG4gICAgICAgICAgYm90ID0gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMCxcbiAgICAgICAgICByZXN1bHQgPSAodG9wICsgYm90KSAvICgxIDw8IDIxKTtcbiAgICB9IHdoaWxlIChyZXN1bHQgPT09IDApO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG4gIHBybmcuaW50MzIgPSB4Zy5uZXh0O1xuICBwcm5nLnF1aWNrID0gcHJuZztcbiAgaWYgKHN0YXRlKSB7XG4gICAgaWYgKHR5cGVvZihzdGF0ZSkgPT0gJ29iamVjdCcpIGNvcHkoc3RhdGUsIHhnKTtcbiAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KHhnLCB7fSk7IH1cbiAgfVxuICByZXR1cm4gcHJuZztcbn1cblxuaWYgKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IGltcGw7XG59IGVsc2UgaWYgKGRlZmluZSAmJiBkZWZpbmUuYW1kKSB7XG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIGltcGw7IH0pO1xufSBlbHNlIHtcbiAgdGhpcy54b3IxMjggPSBpbXBsO1xufVxuXG59KShcbiAgdGhpcyxcbiAgKHR5cGVvZiBtb2R1bGUpID09ICdvYmplY3QnICYmIG1vZHVsZSwgICAgLy8gcHJlc2VudCBpbiBub2RlLmpzXG4gICh0eXBlb2YgZGVmaW5lKSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZSAgIC8vIHByZXNlbnQgd2l0aCBhbiBBTUQgbG9hZGVyXG4pO1xuXG5cbiIsIi8vIEEgSmF2YXNjcmlwdCBpbXBsZW1lbnRhaW9uIG9mIFJpY2hhcmQgQnJlbnQncyBYb3JnZW5zIHhvcjQwOTYgYWxnb3JpdGhtLlxuLy9cbi8vIFRoaXMgZmFzdCBub24tY3J5cHRvZ3JhcGhpYyByYW5kb20gbnVtYmVyIGdlbmVyYXRvciBpcyBkZXNpZ25lZCBmb3Jcbi8vIHVzZSBpbiBNb250ZS1DYXJsbyBhbGdvcml0aG1zLiBJdCBjb21iaW5lcyBhIGxvbmctcGVyaW9kIHhvcnNoaWZ0XG4vLyBnZW5lcmF0b3Igd2l0aCBhIFdleWwgZ2VuZXJhdG9yLCBhbmQgaXQgcGFzc2VzIGFsbCBjb21tb24gYmF0dGVyaWVzXG4vLyBvZiBzdGFzdGljaWFsIHRlc3RzIGZvciByYW5kb21uZXNzIHdoaWxlIGNvbnN1bWluZyBvbmx5IGEgZmV3IG5hbm9zZWNvbmRzXG4vLyBmb3IgZWFjaCBwcm5nIGdlbmVyYXRlZC4gIEZvciBiYWNrZ3JvdW5kIG9uIHRoZSBnZW5lcmF0b3IsIHNlZSBCcmVudCdzXG4vLyBwYXBlcjogXCJTb21lIGxvbmctcGVyaW9kIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9ycyB1c2luZyBzaGlmdHMgYW5kIHhvcnMuXCJcbi8vIGh0dHA6Ly9hcnhpdi5vcmcvcGRmLzEwMDQuMzExNXYxLnBkZlxuLy9cbi8vIFVzYWdlOlxuLy9cbi8vIHZhciB4b3I0MDk2ID0gcmVxdWlyZSgneG9yNDA5NicpO1xuLy8gcmFuZG9tID0geG9yNDA5NigxKTsgICAgICAgICAgICAgICAgICAgICAgICAvLyBTZWVkIHdpdGggaW50MzIgb3Igc3RyaW5nLlxuLy8gYXNzZXJ0LmVxdWFsKHJhbmRvbSgpLCAwLjE1MjA0MzY0NTA1Mzg1NDcpOyAvLyAoMCwgMSkgcmFuZ2UsIDUzIGJpdHMuXG4vLyBhc3NlcnQuZXF1YWwocmFuZG9tLmludDMyKCksIDE4MDY1MzQ4OTcpOyAgIC8vIHNpZ25lZCBpbnQzMiwgMzIgYml0cy5cbi8vXG4vLyBGb3Igbm9uemVybyBudW1lcmljIGtleXMsIHRoaXMgaW1wZWxlbWVudGF0aW9uIHByb3ZpZGVzIGEgc2VxdWVuY2Vcbi8vIGlkZW50aWNhbCB0byB0aGF0IGJ5IEJyZW50J3MgeG9yZ2VucyAzIGltcGxlbWVudGFpb24gaW4gQy4gIFRoaXNcbi8vIGltcGxlbWVudGF0aW9uIGFsc28gcHJvdmlkZXMgZm9yIGluaXRhbGl6aW5nIHRoZSBnZW5lcmF0b3Igd2l0aFxuLy8gc3RyaW5nIHNlZWRzLCBvciBmb3Igc2F2aW5nIGFuZCByZXN0b3JpbmcgdGhlIHN0YXRlIG9mIHRoZSBnZW5lcmF0b3IuXG4vL1xuLy8gT24gQ2hyb21lLCB0aGlzIHBybmcgYmVuY2htYXJrcyBhYm91dCAyLjEgdGltZXMgc2xvd2VyIHRoYW5cbi8vIEphdmFzY3JpcHQncyBidWlsdC1pbiBNYXRoLnJhbmRvbSgpLlxuXG4oZnVuY3Rpb24oZ2xvYmFsLCBtb2R1bGUsIGRlZmluZSkge1xuXG5mdW5jdGlvbiBYb3JHZW4oc2VlZCkge1xuICB2YXIgbWUgPSB0aGlzO1xuXG4gIC8vIFNldCB1cCBnZW5lcmF0b3IgZnVuY3Rpb24uXG4gIG1lLm5leHQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgdyA9IG1lLncsXG4gICAgICAgIFggPSBtZS5YLCBpID0gbWUuaSwgdCwgdjtcbiAgICAvLyBVcGRhdGUgV2V5bCBnZW5lcmF0b3IuXG4gICAgbWUudyA9IHcgPSAodyArIDB4NjFjODg2NDcpIHwgMDtcbiAgICAvLyBVcGRhdGUgeG9yIGdlbmVyYXRvci5cbiAgICB2ID0gWFsoaSArIDM0KSAmIDEyN107XG4gICAgdCA9IFhbaSA9ICgoaSArIDEpICYgMTI3KV07XG4gICAgdiBePSB2IDw8IDEzO1xuICAgIHQgXj0gdCA8PCAxNztcbiAgICB2IF49IHYgPj4+IDE1O1xuICAgIHQgXj0gdCA+Pj4gMTI7XG4gICAgLy8gVXBkYXRlIFhvciBnZW5lcmF0b3IgYXJyYXkgc3RhdGUuXG4gICAgdiA9IFhbaV0gPSB2IF4gdDtcbiAgICBtZS5pID0gaTtcbiAgICAvLyBSZXN1bHQgaXMgdGhlIGNvbWJpbmF0aW9uLlxuICAgIHJldHVybiAodiArICh3IF4gKHcgPj4+IDE2KSkpIHwgMDtcbiAgfTtcblxuICBmdW5jdGlvbiBpbml0KG1lLCBzZWVkKSB7XG4gICAgdmFyIHQsIHYsIGksIGosIHcsIFggPSBbXSwgbGltaXQgPSAxMjg7XG4gICAgaWYgKHNlZWQgPT09IChzZWVkIHwgMCkpIHtcbiAgICAgIC8vIE51bWVyaWMgc2VlZHMgaW5pdGlhbGl6ZSB2LCB3aGljaCBpcyB1c2VkIHRvIGdlbmVyYXRlcyBYLlxuICAgICAgdiA9IHNlZWQ7XG4gICAgICBzZWVkID0gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gU3RyaW5nIHNlZWRzIGFyZSBtaXhlZCBpbnRvIHYgYW5kIFggb25lIGNoYXJhY3RlciBhdCBhIHRpbWUuXG4gICAgICBzZWVkID0gc2VlZCArICdcXDAnO1xuICAgICAgdiA9IDA7XG4gICAgICBsaW1pdCA9IE1hdGgubWF4KGxpbWl0LCBzZWVkLmxlbmd0aCk7XG4gICAgfVxuICAgIC8vIEluaXRpYWxpemUgY2lyY3VsYXIgYXJyYXkgYW5kIHdleWwgdmFsdWUuXG4gICAgZm9yIChpID0gMCwgaiA9IC0zMjsgaiA8IGxpbWl0OyArK2opIHtcbiAgICAgIC8vIFB1dCB0aGUgdW5pY29kZSBjaGFyYWN0ZXJzIGludG8gdGhlIGFycmF5LCBhbmQgc2h1ZmZsZSB0aGVtLlxuICAgICAgaWYgKHNlZWQpIHYgXj0gc2VlZC5jaGFyQ29kZUF0KChqICsgMzIpICUgc2VlZC5sZW5ndGgpO1xuICAgICAgLy8gQWZ0ZXIgMzIgc2h1ZmZsZXMsIHRha2UgdiBhcyB0aGUgc3RhcnRpbmcgdyB2YWx1ZS5cbiAgICAgIGlmIChqID09PSAwKSB3ID0gdjtcbiAgICAgIHYgXj0gdiA8PCAxMDtcbiAgICAgIHYgXj0gdiA+Pj4gMTU7XG4gICAgICB2IF49IHYgPDwgNDtcbiAgICAgIHYgXj0gdiA+Pj4gMTM7XG4gICAgICBpZiAoaiA+PSAwKSB7XG4gICAgICAgIHcgPSAodyArIDB4NjFjODg2NDcpIHwgMDsgICAgIC8vIFdleWwuXG4gICAgICAgIHQgPSAoWFtqICYgMTI3XSBePSAodiArIHcpKTsgIC8vIENvbWJpbmUgeG9yIGFuZCB3ZXlsIHRvIGluaXQgYXJyYXkuXG4gICAgICAgIGkgPSAoMCA9PSB0KSA/IGkgKyAxIDogMDsgICAgIC8vIENvdW50IHplcm9lcy5cbiAgICAgIH1cbiAgICB9XG4gICAgLy8gV2UgaGF2ZSBkZXRlY3RlZCBhbGwgemVyb2VzOyBtYWtlIHRoZSBrZXkgbm9uemVyby5cbiAgICBpZiAoaSA+PSAxMjgpIHtcbiAgICAgIFhbKHNlZWQgJiYgc2VlZC5sZW5ndGggfHwgMCkgJiAxMjddID0gLTE7XG4gICAgfVxuICAgIC8vIFJ1biB0aGUgZ2VuZXJhdG9yIDUxMiB0aW1lcyB0byBmdXJ0aGVyIG1peCB0aGUgc3RhdGUgYmVmb3JlIHVzaW5nIGl0LlxuICAgIC8vIEZhY3RvcmluZyB0aGlzIGFzIGEgZnVuY3Rpb24gc2xvd3MgdGhlIG1haW4gZ2VuZXJhdG9yLCBzbyBpdCBpcyBqdXN0XG4gICAgLy8gdW5yb2xsZWQgaGVyZS4gIFRoZSB3ZXlsIGdlbmVyYXRvciBpcyBub3QgYWR2YW5jZWQgd2hpbGUgd2FybWluZyB1cC5cbiAgICBpID0gMTI3O1xuICAgIGZvciAoaiA9IDQgKiAxMjg7IGogPiAwOyAtLWopIHtcbiAgICAgIHYgPSBYWyhpICsgMzQpICYgMTI3XTtcbiAgICAgIHQgPSBYW2kgPSAoKGkgKyAxKSAmIDEyNyldO1xuICAgICAgdiBePSB2IDw8IDEzO1xuICAgICAgdCBePSB0IDw8IDE3O1xuICAgICAgdiBePSB2ID4+PiAxNTtcbiAgICAgIHQgXj0gdCA+Pj4gMTI7XG4gICAgICBYW2ldID0gdiBeIHQ7XG4gICAgfVxuICAgIC8vIFN0b3Jpbmcgc3RhdGUgYXMgb2JqZWN0IG1lbWJlcnMgaXMgZmFzdGVyIHRoYW4gdXNpbmcgY2xvc3VyZSB2YXJpYWJsZXMuXG4gICAgbWUudyA9IHc7XG4gICAgbWUuWCA9IFg7XG4gICAgbWUuaSA9IGk7XG4gIH1cblxuICBpbml0KG1lLCBzZWVkKTtcbn1cblxuZnVuY3Rpb24gY29weShmLCB0KSB7XG4gIHQuaSA9IGYuaTtcbiAgdC53ID0gZi53O1xuICB0LlggPSBmLlguc2xpY2UoKTtcbiAgcmV0dXJuIHQ7XG59O1xuXG5mdW5jdGlvbiBpbXBsKHNlZWQsIG9wdHMpIHtcbiAgaWYgKHNlZWQgPT0gbnVsbCkgc2VlZCA9ICsobmV3IERhdGUpO1xuICB2YXIgeGcgPSBuZXcgWG9yR2VuKHNlZWQpLFxuICAgICAgc3RhdGUgPSBvcHRzICYmIG9wdHMuc3RhdGUsXG4gICAgICBwcm5nID0gZnVuY3Rpb24oKSB7IHJldHVybiAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwOyB9O1xuICBwcm5nLmRvdWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIGRvIHtcbiAgICAgIHZhciB0b3AgPSB4Zy5uZXh0KCkgPj4+IDExLFxuICAgICAgICAgIGJvdCA9ICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDAsXG4gICAgICAgICAgcmVzdWx0ID0gKHRvcCArIGJvdCkgLyAoMSA8PCAyMSk7XG4gICAgfSB3aGlsZSAocmVzdWx0ID09PSAwKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuICBwcm5nLmludDMyID0geGcubmV4dDtcbiAgcHJuZy5xdWljayA9IHBybmc7XG4gIGlmIChzdGF0ZSkge1xuICAgIGlmIChzdGF0ZS5YKSBjb3B5KHN0YXRlLCB4Zyk7XG4gICAgcHJuZy5zdGF0ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gY29weSh4Zywge30pOyB9XG4gIH1cbiAgcmV0dXJuIHBybmc7XG59XG5cbmlmIChtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBpbXBsO1xufSBlbHNlIGlmIChkZWZpbmUgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBpbXBsOyB9KTtcbn0gZWxzZSB7XG4gIHRoaXMueG9yNDA5NiA9IGltcGw7XG59XG5cbn0pKFxuICB0aGlzLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB3aW5kb3cgb2JqZWN0IG9yIGdsb2JhbFxuICAodHlwZW9mIG1vZHVsZSkgPT0gJ29iamVjdCcgJiYgbW9kdWxlLCAgICAvLyBwcmVzZW50IGluIG5vZGUuanNcbiAgKHR5cGVvZiBkZWZpbmUpID09ICdmdW5jdGlvbicgJiYgZGVmaW5lICAgLy8gcHJlc2VudCB3aXRoIGFuIEFNRCBsb2FkZXJcbik7XG4iLCIvLyBBIEphdmFzY3JpcHQgaW1wbGVtZW50YWlvbiBvZiB0aGUgXCJ4b3JzaGlmdDdcIiBhbGdvcml0aG0gYnlcbi8vIEZyYW7Dp29pcyBQYW5uZXRvbiBhbmQgUGllcnJlIEwnZWN1eWVyOlxuLy8gXCJPbiB0aGUgWG9yZ3NoaWZ0IFJhbmRvbSBOdW1iZXIgR2VuZXJhdG9yc1wiXG4vLyBodHRwOi8vc2FsdWMuZW5nci51Y29ubi5lZHUvcmVmcy9jcnlwdG8vcm5nL3Bhbm5ldG9uMDVvbnRoZXhvcnNoaWZ0LnBkZlxuXG4oZnVuY3Rpb24oZ2xvYmFsLCBtb2R1bGUsIGRlZmluZSkge1xuXG5mdW5jdGlvbiBYb3JHZW4oc2VlZCkge1xuICB2YXIgbWUgPSB0aGlzO1xuXG4gIC8vIFNldCB1cCBnZW5lcmF0b3IgZnVuY3Rpb24uXG4gIG1lLm5leHQgPSBmdW5jdGlvbigpIHtcbiAgICAvLyBVcGRhdGUgeG9yIGdlbmVyYXRvci5cbiAgICB2YXIgWCA9IG1lLngsIGkgPSBtZS5pLCB0LCB2LCB3O1xuICAgIHQgPSBYW2ldOyB0IF49ICh0ID4+PiA3KTsgdiA9IHQgXiAodCA8PCAyNCk7XG4gICAgdCA9IFhbKGkgKyAxKSAmIDddOyB2IF49IHQgXiAodCA+Pj4gMTApO1xuICAgIHQgPSBYWyhpICsgMykgJiA3XTsgdiBePSB0IF4gKHQgPj4+IDMpO1xuICAgIHQgPSBYWyhpICsgNCkgJiA3XTsgdiBePSB0IF4gKHQgPDwgNyk7XG4gICAgdCA9IFhbKGkgKyA3KSAmIDddOyB0ID0gdCBeICh0IDw8IDEzKTsgdiBePSB0IF4gKHQgPDwgOSk7XG4gICAgWFtpXSA9IHY7XG4gICAgbWUuaSA9IChpICsgMSkgJiA3O1xuICAgIHJldHVybiB2O1xuICB9O1xuXG4gIGZ1bmN0aW9uIGluaXQobWUsIHNlZWQpIHtcbiAgICB2YXIgaiwgdywgWCA9IFtdO1xuXG4gICAgaWYgKHNlZWQgPT09IChzZWVkIHwgMCkpIHtcbiAgICAgIC8vIFNlZWQgc3RhdGUgYXJyYXkgdXNpbmcgYSAzMi1iaXQgaW50ZWdlci5cbiAgICAgIHcgPSBYWzBdID0gc2VlZDtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gU2VlZCBzdGF0ZSB1c2luZyBhIHN0cmluZy5cbiAgICAgIHNlZWQgPSAnJyArIHNlZWQ7XG4gICAgICBmb3IgKGogPSAwOyBqIDwgc2VlZC5sZW5ndGg7ICsraikge1xuICAgICAgICBYW2ogJiA3XSA9IChYW2ogJiA3XSA8PCAxNSkgXlxuICAgICAgICAgICAgKHNlZWQuY2hhckNvZGVBdChqKSArIFhbKGogKyAxKSAmIDddIDw8IDEzKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gRW5mb3JjZSBhbiBhcnJheSBsZW5ndGggb2YgOCwgbm90IGFsbCB6ZXJvZXMuXG4gICAgd2hpbGUgKFgubGVuZ3RoIDwgOCkgWC5wdXNoKDApO1xuICAgIGZvciAoaiA9IDA7IGogPCA4ICYmIFhbal0gPT09IDA7ICsraik7XG4gICAgaWYgKGogPT0gOCkgdyA9IFhbN10gPSAtMTsgZWxzZSB3ID0gWFtqXTtcblxuICAgIG1lLnggPSBYO1xuICAgIG1lLmkgPSAwO1xuXG4gICAgLy8gRGlzY2FyZCBhbiBpbml0aWFsIDI1NiB2YWx1ZXMuXG4gICAgZm9yIChqID0gMjU2OyBqID4gMDsgLS1qKSB7XG4gICAgICBtZS5uZXh0KCk7XG4gICAgfVxuICB9XG5cbiAgaW5pdChtZSwgc2VlZCk7XG59XG5cbmZ1bmN0aW9uIGNvcHkoZiwgdCkge1xuICB0LnggPSBmLnguc2xpY2UoKTtcbiAgdC5pID0gZi5pO1xuICByZXR1cm4gdDtcbn1cblxuZnVuY3Rpb24gaW1wbChzZWVkLCBvcHRzKSB7XG4gIGlmIChzZWVkID09IG51bGwpIHNlZWQgPSArKG5ldyBEYXRlKTtcbiAgdmFyIHhnID0gbmV3IFhvckdlbihzZWVkKSxcbiAgICAgIHN0YXRlID0gb3B0cyAmJiBvcHRzLnN0YXRlLFxuICAgICAgcHJuZyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMDsgfTtcbiAgcHJuZy5kb3VibGUgPSBmdW5jdGlvbigpIHtcbiAgICBkbyB7XG4gICAgICB2YXIgdG9wID0geGcubmV4dCgpID4+PiAxMSxcbiAgICAgICAgICBib3QgPSAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwLFxuICAgICAgICAgIHJlc3VsdCA9ICh0b3AgKyBib3QpIC8gKDEgPDwgMjEpO1xuICAgIH0gd2hpbGUgKHJlc3VsdCA9PT0gMCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcbiAgcHJuZy5pbnQzMiA9IHhnLm5leHQ7XG4gIHBybmcucXVpY2sgPSBwcm5nO1xuICBpZiAoc3RhdGUpIHtcbiAgICBpZiAoc3RhdGUueCkgY29weShzdGF0ZSwgeGcpO1xuICAgIHBybmcuc3RhdGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGNvcHkoeGcsIHt9KTsgfVxuICB9XG4gIHJldHVybiBwcm5nO1xufVxuXG5pZiAobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gaW1wbDtcbn0gZWxzZSBpZiAoZGVmaW5lICYmIGRlZmluZS5hbWQpIHtcbiAgZGVmaW5lKGZ1bmN0aW9uKCkgeyByZXR1cm4gaW1wbDsgfSk7XG59IGVsc2Uge1xuICB0aGlzLnhvcnNoaWZ0NyA9IGltcGw7XG59XG5cbn0pKFxuICB0aGlzLFxuICAodHlwZW9mIG1vZHVsZSkgPT0gJ29iamVjdCcgJiYgbW9kdWxlLCAgICAvLyBwcmVzZW50IGluIG5vZGUuanNcbiAgKHR5cGVvZiBkZWZpbmUpID09ICdmdW5jdGlvbicgJiYgZGVmaW5lICAgLy8gcHJlc2VudCB3aXRoIGFuIEFNRCBsb2FkZXJcbik7XG5cbiIsIi8vIEEgSmF2YXNjcmlwdCBpbXBsZW1lbnRhaW9uIG9mIHRoZSBcInhvcndvd1wiIHBybmcgYWxnb3JpdGhtIGJ5XG4vLyBHZW9yZ2UgTWFyc2FnbGlhLiAgU2VlIGh0dHA6Ly93d3cuanN0YXRzb2Z0Lm9yZy92MDgvaTE0L3BhcGVyXG5cbihmdW5jdGlvbihnbG9iYWwsIG1vZHVsZSwgZGVmaW5lKSB7XG5cbmZ1bmN0aW9uIFhvckdlbihzZWVkKSB7XG4gIHZhciBtZSA9IHRoaXMsIHN0cnNlZWQgPSAnJztcblxuICAvLyBTZXQgdXAgZ2VuZXJhdG9yIGZ1bmN0aW9uLlxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHQgPSAobWUueCBeIChtZS54ID4+PiAyKSk7XG4gICAgbWUueCA9IG1lLnk7IG1lLnkgPSBtZS56OyBtZS56ID0gbWUudzsgbWUudyA9IG1lLnY7XG4gICAgcmV0dXJuIChtZS5kID0gKG1lLmQgKyAzNjI0MzcgfCAwKSkgK1xuICAgICAgIChtZS52ID0gKG1lLnYgXiAobWUudiA8PCA0KSkgXiAodCBeICh0IDw8IDEpKSkgfCAwO1xuICB9O1xuXG4gIG1lLnggPSAwO1xuICBtZS55ID0gMDtcbiAgbWUueiA9IDA7XG4gIG1lLncgPSAwO1xuICBtZS52ID0gMDtcblxuICBpZiAoc2VlZCA9PT0gKHNlZWQgfCAwKSkge1xuICAgIC8vIEludGVnZXIgc2VlZC5cbiAgICBtZS54ID0gc2VlZDtcbiAgfSBlbHNlIHtcbiAgICAvLyBTdHJpbmcgc2VlZC5cbiAgICBzdHJzZWVkICs9IHNlZWQ7XG4gIH1cblxuICAvLyBNaXggaW4gc3RyaW5nIHNlZWQsIHRoZW4gZGlzY2FyZCBhbiBpbml0aWFsIGJhdGNoIG9mIDY0IHZhbHVlcy5cbiAgZm9yICh2YXIgayA9IDA7IGsgPCBzdHJzZWVkLmxlbmd0aCArIDY0OyBrKyspIHtcbiAgICBtZS54IF49IHN0cnNlZWQuY2hhckNvZGVBdChrKSB8IDA7XG4gICAgaWYgKGsgPT0gc3Ryc2VlZC5sZW5ndGgpIHtcbiAgICAgIG1lLmQgPSBtZS54IDw8IDEwIF4gbWUueCA+Pj4gNDtcbiAgICB9XG4gICAgbWUubmV4dCgpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvcHkoZiwgdCkge1xuICB0LnggPSBmLng7XG4gIHQueSA9IGYueTtcbiAgdC56ID0gZi56O1xuICB0LncgPSBmLnc7XG4gIHQudiA9IGYudjtcbiAgdC5kID0gZi5kO1xuICByZXR1cm4gdDtcbn1cblxuZnVuY3Rpb24gaW1wbChzZWVkLCBvcHRzKSB7XG4gIHZhciB4ZyA9IG5ldyBYb3JHZW4oc2VlZCksXG4gICAgICBzdGF0ZSA9IG9wdHMgJiYgb3B0cy5zdGF0ZSxcbiAgICAgIHBybmcgPSBmdW5jdGlvbigpIHsgcmV0dXJuICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDA7IH07XG4gIHBybmcuZG91YmxlID0gZnVuY3Rpb24oKSB7XG4gICAgZG8ge1xuICAgICAgdmFyIHRvcCA9IHhnLm5leHQoKSA+Pj4gMTEsXG4gICAgICAgICAgYm90ID0gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMCxcbiAgICAgICAgICByZXN1bHQgPSAodG9wICsgYm90KSAvICgxIDw8IDIxKTtcbiAgICB9IHdoaWxlIChyZXN1bHQgPT09IDApO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG4gIHBybmcuaW50MzIgPSB4Zy5uZXh0O1xuICBwcm5nLnF1aWNrID0gcHJuZztcbiAgaWYgKHN0YXRlKSB7XG4gICAgaWYgKHR5cGVvZihzdGF0ZSkgPT0gJ29iamVjdCcpIGNvcHkoc3RhdGUsIHhnKTtcbiAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KHhnLCB7fSk7IH1cbiAgfVxuICByZXR1cm4gcHJuZztcbn1cblxuaWYgKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IGltcGw7XG59IGVsc2UgaWYgKGRlZmluZSAmJiBkZWZpbmUuYW1kKSB7XG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIGltcGw7IH0pO1xufSBlbHNlIHtcbiAgdGhpcy54b3J3b3cgPSBpbXBsO1xufVxuXG59KShcbiAgdGhpcyxcbiAgKHR5cGVvZiBtb2R1bGUpID09ICdvYmplY3QnICYmIG1vZHVsZSwgICAgLy8gcHJlc2VudCBpbiBub2RlLmpzXG4gICh0eXBlb2YgZGVmaW5lKSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZSAgIC8vIHByZXNlbnQgd2l0aCBhbiBBTUQgbG9hZGVyXG4pO1xuXG5cbiIsIi8qXG5Db3B5cmlnaHQgMjAxNCBEYXZpZCBCYXUuXG5cblBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZ1xuYSBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG5cIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbndpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbmRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0b1xucGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvXG50aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG5cblRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlXG5pbmNsdWRlZCBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cblxuVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCxcbkVYUFJFU1MgT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULlxuSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTllcbkNMQUlNLCBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsXG5UT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRVxuU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbiovXG5cbihmdW5jdGlvbiAocG9vbCwgbWF0aCkge1xuLy9cbi8vIFRoZSBmb2xsb3dpbmcgY29uc3RhbnRzIGFyZSByZWxhdGVkIHRvIElFRUUgNzU0IGxpbWl0cy5cbi8vXG52YXIgZ2xvYmFsID0gdGhpcyxcbiAgICB3aWR0aCA9IDI1NiwgICAgICAgIC8vIGVhY2ggUkM0IG91dHB1dCBpcyAwIDw9IHggPCAyNTZcbiAgICBjaHVua3MgPSA2LCAgICAgICAgIC8vIGF0IGxlYXN0IHNpeCBSQzQgb3V0cHV0cyBmb3IgZWFjaCBkb3VibGVcbiAgICBkaWdpdHMgPSA1MiwgICAgICAgIC8vIHRoZXJlIGFyZSA1MiBzaWduaWZpY2FudCBkaWdpdHMgaW4gYSBkb3VibGVcbiAgICBybmduYW1lID0gJ3JhbmRvbScsIC8vIHJuZ25hbWU6IG5hbWUgZm9yIE1hdGgucmFuZG9tIGFuZCBNYXRoLnNlZWRyYW5kb21cbiAgICBzdGFydGRlbm9tID0gbWF0aC5wb3cod2lkdGgsIGNodW5rcyksXG4gICAgc2lnbmlmaWNhbmNlID0gbWF0aC5wb3coMiwgZGlnaXRzKSxcbiAgICBvdmVyZmxvdyA9IHNpZ25pZmljYW5jZSAqIDIsXG4gICAgbWFzayA9IHdpZHRoIC0gMSxcbiAgICBub2RlY3J5cHRvOyAgICAgICAgIC8vIG5vZGUuanMgY3J5cHRvIG1vZHVsZSwgaW5pdGlhbGl6ZWQgYXQgdGhlIGJvdHRvbS5cblxuLy9cbi8vIHNlZWRyYW5kb20oKVxuLy8gVGhpcyBpcyB0aGUgc2VlZHJhbmRvbSBmdW5jdGlvbiBkZXNjcmliZWQgYWJvdmUuXG4vL1xuZnVuY3Rpb24gc2VlZHJhbmRvbShzZWVkLCBvcHRpb25zLCBjYWxsYmFjaykge1xuICB2YXIga2V5ID0gW107XG4gIG9wdGlvbnMgPSAob3B0aW9ucyA9PSB0cnVlKSA/IHsgZW50cm9weTogdHJ1ZSB9IDogKG9wdGlvbnMgfHwge30pO1xuXG4gIC8vIEZsYXR0ZW4gdGhlIHNlZWQgc3RyaW5nIG9yIGJ1aWxkIG9uZSBmcm9tIGxvY2FsIGVudHJvcHkgaWYgbmVlZGVkLlxuICB2YXIgc2hvcnRzZWVkID0gbWl4a2V5KGZsYXR0ZW4oXG4gICAgb3B0aW9ucy5lbnRyb3B5ID8gW3NlZWQsIHRvc3RyaW5nKHBvb2wpXSA6XG4gICAgKHNlZWQgPT0gbnVsbCkgPyBhdXRvc2VlZCgpIDogc2VlZCwgMyksIGtleSk7XG5cbiAgLy8gVXNlIHRoZSBzZWVkIHRvIGluaXRpYWxpemUgYW4gQVJDNCBnZW5lcmF0b3IuXG4gIHZhciBhcmM0ID0gbmV3IEFSQzQoa2V5KTtcblxuICAvLyBUaGlzIGZ1bmN0aW9uIHJldHVybnMgYSByYW5kb20gZG91YmxlIGluIFswLCAxKSB0aGF0IGNvbnRhaW5zXG4gIC8vIHJhbmRvbW5lc3MgaW4gZXZlcnkgYml0IG9mIHRoZSBtYW50aXNzYSBvZiB0aGUgSUVFRSA3NTQgdmFsdWUuXG4gIHZhciBwcm5nID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG4gPSBhcmM0LmcoY2h1bmtzKSwgICAgICAgICAgICAgLy8gU3RhcnQgd2l0aCBhIG51bWVyYXRvciBuIDwgMiBeIDQ4XG4gICAgICAgIGQgPSBzdGFydGRlbm9tLCAgICAgICAgICAgICAgICAgLy8gICBhbmQgZGVub21pbmF0b3IgZCA9IDIgXiA0OC5cbiAgICAgICAgeCA9IDA7ICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAgIGFuZCBubyAnZXh0cmEgbGFzdCBieXRlJy5cbiAgICB3aGlsZSAobiA8IHNpZ25pZmljYW5jZSkgeyAgICAgICAgICAvLyBGaWxsIHVwIGFsbCBzaWduaWZpY2FudCBkaWdpdHMgYnlcbiAgICAgIG4gPSAobiArIHgpICogd2lkdGg7ICAgICAgICAgICAgICAvLyAgIHNoaWZ0aW5nIG51bWVyYXRvciBhbmRcbiAgICAgIGQgKj0gd2lkdGg7ICAgICAgICAgICAgICAgICAgICAgICAvLyAgIGRlbm9taW5hdG9yIGFuZCBnZW5lcmF0aW5nIGFcbiAgICAgIHggPSBhcmM0LmcoMSk7ICAgICAgICAgICAgICAgICAgICAvLyAgIG5ldyBsZWFzdC1zaWduaWZpY2FudC1ieXRlLlxuICAgIH1cbiAgICB3aGlsZSAobiA+PSBvdmVyZmxvdykgeyAgICAgICAgICAgICAvLyBUbyBhdm9pZCByb3VuZGluZyB1cCwgYmVmb3JlIGFkZGluZ1xuICAgICAgbiAvPSAyOyAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgbGFzdCBieXRlLCBzaGlmdCBldmVyeXRoaW5nXG4gICAgICBkIC89IDI7ICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gICByaWdodCB1c2luZyBpbnRlZ2VyIG1hdGggdW50aWxcbiAgICAgIHggPj4+PSAxOyAgICAgICAgICAgICAgICAgICAgICAgICAvLyAgIHdlIGhhdmUgZXhhY3RseSB0aGUgZGVzaXJlZCBiaXRzLlxuICAgIH1cbiAgICByZXR1cm4gKG4gKyB4KSAvIGQ7ICAgICAgICAgICAgICAgICAvLyBGb3JtIHRoZSBudW1iZXIgd2l0aGluIFswLCAxKS5cbiAgfTtcblxuICBwcm5nLmludDMyID0gZnVuY3Rpb24oKSB7IHJldHVybiBhcmM0LmcoNCkgfCAwOyB9XG4gIHBybmcucXVpY2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGFyYzQuZyg0KSAvIDB4MTAwMDAwMDAwOyB9XG4gIHBybmcuZG91YmxlID0gcHJuZztcblxuICAvLyBNaXggdGhlIHJhbmRvbW5lc3MgaW50byBhY2N1bXVsYXRlZCBlbnRyb3B5LlxuICBtaXhrZXkodG9zdHJpbmcoYXJjNC5TKSwgcG9vbCk7XG5cbiAgLy8gQ2FsbGluZyBjb252ZW50aW9uOiB3aGF0IHRvIHJldHVybiBhcyBhIGZ1bmN0aW9uIG9mIHBybmcsIHNlZWQsIGlzX21hdGguXG4gIHJldHVybiAob3B0aW9ucy5wYXNzIHx8IGNhbGxiYWNrIHx8XG4gICAgICBmdW5jdGlvbihwcm5nLCBzZWVkLCBpc19tYXRoX2NhbGwsIHN0YXRlKSB7XG4gICAgICAgIGlmIChzdGF0ZSkge1xuICAgICAgICAgIC8vIExvYWQgdGhlIGFyYzQgc3RhdGUgZnJvbSB0aGUgZ2l2ZW4gc3RhdGUgaWYgaXQgaGFzIGFuIFMgYXJyYXkuXG4gICAgICAgICAgaWYgKHN0YXRlLlMpIHsgY29weShzdGF0ZSwgYXJjNCk7IH1cbiAgICAgICAgICAvLyBPbmx5IHByb3ZpZGUgdGhlIC5zdGF0ZSBtZXRob2QgaWYgcmVxdWVzdGVkIHZpYSBvcHRpb25zLnN0YXRlLlxuICAgICAgICAgIHBybmcuc3RhdGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGNvcHkoYXJjNCwge30pOyB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJZiBjYWxsZWQgYXMgYSBtZXRob2Qgb2YgTWF0aCAoTWF0aC5zZWVkcmFuZG9tKCkpLCBtdXRhdGVcbiAgICAgICAgLy8gTWF0aC5yYW5kb20gYmVjYXVzZSB0aGF0IGlzIGhvdyBzZWVkcmFuZG9tLmpzIGhhcyB3b3JrZWQgc2luY2UgdjEuMC5cbiAgICAgICAgaWYgKGlzX21hdGhfY2FsbCkgeyBtYXRoW3JuZ25hbWVdID0gcHJuZzsgcmV0dXJuIHNlZWQ7IH1cblxuICAgICAgICAvLyBPdGhlcndpc2UsIGl0IGlzIGEgbmV3ZXIgY2FsbGluZyBjb252ZW50aW9uLCBzbyByZXR1cm4gdGhlXG4gICAgICAgIC8vIHBybmcgZGlyZWN0bHkuXG4gICAgICAgIGVsc2UgcmV0dXJuIHBybmc7XG4gICAgICB9KShcbiAgcHJuZyxcbiAgc2hvcnRzZWVkLFxuICAnZ2xvYmFsJyBpbiBvcHRpb25zID8gb3B0aW9ucy5nbG9iYWwgOiAodGhpcyA9PSBtYXRoKSxcbiAgb3B0aW9ucy5zdGF0ZSk7XG59XG5tYXRoWydzZWVkJyArIHJuZ25hbWVdID0gc2VlZHJhbmRvbTtcblxuLy9cbi8vIEFSQzRcbi8vXG4vLyBBbiBBUkM0IGltcGxlbWVudGF0aW9uLiAgVGhlIGNvbnN0cnVjdG9yIHRha2VzIGEga2V5IGluIHRoZSBmb3JtIG9mXG4vLyBhbiBhcnJheSBvZiBhdCBtb3N0ICh3aWR0aCkgaW50ZWdlcnMgdGhhdCBzaG91bGQgYmUgMCA8PSB4IDwgKHdpZHRoKS5cbi8vXG4vLyBUaGUgZyhjb3VudCkgbWV0aG9kIHJldHVybnMgYSBwc2V1ZG9yYW5kb20gaW50ZWdlciB0aGF0IGNvbmNhdGVuYXRlc1xuLy8gdGhlIG5leHQgKGNvdW50KSBvdXRwdXRzIGZyb20gQVJDNC4gIEl0cyByZXR1cm4gdmFsdWUgaXMgYSBudW1iZXIgeFxuLy8gdGhhdCBpcyBpbiB0aGUgcmFuZ2UgMCA8PSB4IDwgKHdpZHRoIF4gY291bnQpLlxuLy9cbmZ1bmN0aW9uIEFSQzQoa2V5KSB7XG4gIHZhciB0LCBrZXlsZW4gPSBrZXkubGVuZ3RoLFxuICAgICAgbWUgPSB0aGlzLCBpID0gMCwgaiA9IG1lLmkgPSBtZS5qID0gMCwgcyA9IG1lLlMgPSBbXTtcblxuICAvLyBUaGUgZW1wdHkga2V5IFtdIGlzIHRyZWF0ZWQgYXMgWzBdLlxuICBpZiAoIWtleWxlbikgeyBrZXkgPSBba2V5bGVuKytdOyB9XG5cbiAgLy8gU2V0IHVwIFMgdXNpbmcgdGhlIHN0YW5kYXJkIGtleSBzY2hlZHVsaW5nIGFsZ29yaXRobS5cbiAgd2hpbGUgKGkgPCB3aWR0aCkge1xuICAgIHNbaV0gPSBpKys7XG4gIH1cbiAgZm9yIChpID0gMDsgaSA8IHdpZHRoOyBpKyspIHtcbiAgICBzW2ldID0gc1tqID0gbWFzayAmIChqICsga2V5W2kgJSBrZXlsZW5dICsgKHQgPSBzW2ldKSldO1xuICAgIHNbal0gPSB0O1xuICB9XG5cbiAgLy8gVGhlIFwiZ1wiIG1ldGhvZCByZXR1cm5zIHRoZSBuZXh0IChjb3VudCkgb3V0cHV0cyBhcyBvbmUgbnVtYmVyLlxuICAobWUuZyA9IGZ1bmN0aW9uKGNvdW50KSB7XG4gICAgLy8gVXNpbmcgaW5zdGFuY2UgbWVtYmVycyBpbnN0ZWFkIG9mIGNsb3N1cmUgc3RhdGUgbmVhcmx5IGRvdWJsZXMgc3BlZWQuXG4gICAgdmFyIHQsIHIgPSAwLFxuICAgICAgICBpID0gbWUuaSwgaiA9IG1lLmosIHMgPSBtZS5TO1xuICAgIHdoaWxlIChjb3VudC0tKSB7XG4gICAgICB0ID0gc1tpID0gbWFzayAmIChpICsgMSldO1xuICAgICAgciA9IHIgKiB3aWR0aCArIHNbbWFzayAmICgoc1tpXSA9IHNbaiA9IG1hc2sgJiAoaiArIHQpXSkgKyAoc1tqXSA9IHQpKV07XG4gICAgfVxuICAgIG1lLmkgPSBpOyBtZS5qID0gajtcbiAgICByZXR1cm4gcjtcbiAgICAvLyBGb3Igcm9idXN0IHVucHJlZGljdGFiaWxpdHksIHRoZSBmdW5jdGlvbiBjYWxsIGJlbG93IGF1dG9tYXRpY2FsbHlcbiAgICAvLyBkaXNjYXJkcyBhbiBpbml0aWFsIGJhdGNoIG9mIHZhbHVlcy4gIFRoaXMgaXMgY2FsbGVkIFJDNC1kcm9wWzI1Nl0uXG4gICAgLy8gU2VlIGh0dHA6Ly9nb29nbGUuY29tL3NlYXJjaD9xPXJzYStmbHVocmVyK3Jlc3BvbnNlJmJ0bklcbiAgfSkod2lkdGgpO1xufVxuXG4vL1xuLy8gY29weSgpXG4vLyBDb3BpZXMgaW50ZXJuYWwgc3RhdGUgb2YgQVJDNCB0byBvciBmcm9tIGEgcGxhaW4gb2JqZWN0LlxuLy9cbmZ1bmN0aW9uIGNvcHkoZiwgdCkge1xuICB0LmkgPSBmLmk7XG4gIHQuaiA9IGYuajtcbiAgdC5TID0gZi5TLnNsaWNlKCk7XG4gIHJldHVybiB0O1xufTtcblxuLy9cbi8vIGZsYXR0ZW4oKVxuLy8gQ29udmVydHMgYW4gb2JqZWN0IHRyZWUgdG8gbmVzdGVkIGFycmF5cyBvZiBzdHJpbmdzLlxuLy9cbmZ1bmN0aW9uIGZsYXR0ZW4ob2JqLCBkZXB0aCkge1xuICB2YXIgcmVzdWx0ID0gW10sIHR5cCA9ICh0eXBlb2Ygb2JqKSwgcHJvcDtcbiAgaWYgKGRlcHRoICYmIHR5cCA9PSAnb2JqZWN0Jykge1xuICAgIGZvciAocHJvcCBpbiBvYmopIHtcbiAgICAgIHRyeSB7IHJlc3VsdC5wdXNoKGZsYXR0ZW4ob2JqW3Byb3BdLCBkZXB0aCAtIDEpKTsgfSBjYXRjaCAoZSkge31cbiAgICB9XG4gIH1cbiAgcmV0dXJuIChyZXN1bHQubGVuZ3RoID8gcmVzdWx0IDogdHlwID09ICdzdHJpbmcnID8gb2JqIDogb2JqICsgJ1xcMCcpO1xufVxuXG4vL1xuLy8gbWl4a2V5KClcbi8vIE1peGVzIGEgc3RyaW5nIHNlZWQgaW50byBhIGtleSB0aGF0IGlzIGFuIGFycmF5IG9mIGludGVnZXJzLCBhbmRcbi8vIHJldHVybnMgYSBzaG9ydGVuZWQgc3RyaW5nIHNlZWQgdGhhdCBpcyBlcXVpdmFsZW50IHRvIHRoZSByZXN1bHQga2V5LlxuLy9cbmZ1bmN0aW9uIG1peGtleShzZWVkLCBrZXkpIHtcbiAgdmFyIHN0cmluZ3NlZWQgPSBzZWVkICsgJycsIHNtZWFyLCBqID0gMDtcbiAgd2hpbGUgKGogPCBzdHJpbmdzZWVkLmxlbmd0aCkge1xuICAgIGtleVttYXNrICYgal0gPVxuICAgICAgbWFzayAmICgoc21lYXIgXj0ga2V5W21hc2sgJiBqXSAqIDE5KSArIHN0cmluZ3NlZWQuY2hhckNvZGVBdChqKyspKTtcbiAgfVxuICByZXR1cm4gdG9zdHJpbmcoa2V5KTtcbn1cblxuLy9cbi8vIGF1dG9zZWVkKClcbi8vIFJldHVybnMgYW4gb2JqZWN0IGZvciBhdXRvc2VlZGluZywgdXNpbmcgd2luZG93LmNyeXB0byBhbmQgTm9kZSBjcnlwdG9cbi8vIG1vZHVsZSBpZiBhdmFpbGFibGUuXG4vL1xuZnVuY3Rpb24gYXV0b3NlZWQoKSB7XG4gIHRyeSB7XG4gICAgdmFyIG91dDtcbiAgICBpZiAobm9kZWNyeXB0byAmJiAob3V0ID0gbm9kZWNyeXB0by5yYW5kb21CeXRlcykpIHtcbiAgICAgIC8vIFRoZSB1c2Ugb2YgJ291dCcgdG8gcmVtZW1iZXIgcmFuZG9tQnl0ZXMgbWFrZXMgdGlnaHQgbWluaWZpZWQgY29kZS5cbiAgICAgIG91dCA9IG91dCh3aWR0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG91dCA9IG5ldyBVaW50OEFycmF5KHdpZHRoKTtcbiAgICAgIChnbG9iYWwuY3J5cHRvIHx8IGdsb2JhbC5tc0NyeXB0bykuZ2V0UmFuZG9tVmFsdWVzKG91dCk7XG4gICAgfVxuICAgIHJldHVybiB0b3N0cmluZyhvdXQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdmFyIGJyb3dzZXIgPSBnbG9iYWwubmF2aWdhdG9yLFxuICAgICAgICBwbHVnaW5zID0gYnJvd3NlciAmJiBicm93c2VyLnBsdWdpbnM7XG4gICAgcmV0dXJuIFsrbmV3IERhdGUsIGdsb2JhbCwgcGx1Z2lucywgZ2xvYmFsLnNjcmVlbiwgdG9zdHJpbmcocG9vbCldO1xuICB9XG59XG5cbi8vXG4vLyB0b3N0cmluZygpXG4vLyBDb252ZXJ0cyBhbiBhcnJheSBvZiBjaGFyY29kZXMgdG8gYSBzdHJpbmdcbi8vXG5mdW5jdGlvbiB0b3N0cmluZyhhKSB7XG4gIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KDAsIGEpO1xufVxuXG4vL1xuLy8gV2hlbiBzZWVkcmFuZG9tLmpzIGlzIGxvYWRlZCwgd2UgaW1tZWRpYXRlbHkgbWl4IGEgZmV3IGJpdHNcbi8vIGZyb20gdGhlIGJ1aWx0LWluIFJORyBpbnRvIHRoZSBlbnRyb3B5IHBvb2wuICBCZWNhdXNlIHdlIGRvXG4vLyBub3Qgd2FudCB0byBpbnRlcmZlcmUgd2l0aCBkZXRlcm1pbmlzdGljIFBSTkcgc3RhdGUgbGF0ZXIsXG4vLyBzZWVkcmFuZG9tIHdpbGwgbm90IGNhbGwgbWF0aC5yYW5kb20gb24gaXRzIG93biBhZ2FpbiBhZnRlclxuLy8gaW5pdGlhbGl6YXRpb24uXG4vL1xubWl4a2V5KG1hdGgucmFuZG9tKCksIHBvb2wpO1xuXG4vL1xuLy8gTm9kZWpzIGFuZCBBTUQgc3VwcG9ydDogZXhwb3J0IHRoZSBpbXBsZW1lbnRhdGlvbiBhcyBhIG1vZHVsZSB1c2luZ1xuLy8gZWl0aGVyIGNvbnZlbnRpb24uXG4vL1xuaWYgKCh0eXBlb2YgbW9kdWxlKSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IHNlZWRyYW5kb207XG4gIC8vIFdoZW4gaW4gbm9kZS5qcywgdHJ5IHVzaW5nIGNyeXB0byBwYWNrYWdlIGZvciBhdXRvc2VlZGluZy5cbiAgdHJ5IHtcbiAgICBub2RlY3J5cHRvID0gcmVxdWlyZSgnY3J5cHRvJyk7XG4gIH0gY2F0Y2ggKGV4KSB7fVxufSBlbHNlIGlmICgodHlwZW9mIGRlZmluZSkgPT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIHNlZWRyYW5kb207IH0pO1xufVxuXG4vLyBFbmQgYW5vbnltb3VzIHNjb3BlLCBhbmQgcGFzcyBpbml0aWFsIHZhbHVlcy5cbn0pKFxuICBbXSwgICAgIC8vIHBvb2w6IGVudHJvcHkgcG9vbCBzdGFydHMgZW1wdHlcbiAgTWF0aCAgICAvLyBtYXRoOiBwYWNrYWdlIGNvbnRhaW5pbmcgcmFuZG9tLCBwb3csIGFuZCBzZWVkcmFuZG9tXG4pO1xuIiwiLyoqXG4gKiBUaGlzIG1vZHVsZSBpcyB1c2VkIHRvIGNyZWF0ZSBkaWZmZXJlbnQgcG9pbnQgZGlzdHJpYnV0aW9ucyB0aGF0IGNhbiBiZVxuICogdHVybmVkIGludG8gZGlmZmVyZW50IHRpbGUgc2V0cyB3aGVuIG1hZGUgaW50byBhIGdyYXBoIGZvcm1hdC4gVGhlcmUgYXJlXG4gKiB2YXJpb3VzIGRpZmZlcmVudCBkaXN0cmlidXRpb25zIHRoYXQgY2FuIGJlIHVzZWQgdG8gY3JlYXRlIGludGVyZXN0aW5nXG4gKiB0aWxlIHBhdHRlcm5zIHdoZW4gdHVybmVkIGludG8gYSB2b3Jvbm9pIGRpYWdyYW0uIFxuICogXG4gKiBAY2xhc3MgUG9pbnREaXN0cmlidXRpb25cbiAqL1xuXG5cInVzZSBzdHJpY3RcIjtcblxuaW1wb3J0IFBvaXNzb24gZnJvbSBcInBvaXNzb24tZGlzay1zYW1wbGVcIjtcbmltcG9ydCBWZWN0b3IgZnJvbSBcIi4uL2dlb21ldHJ5L1ZlY3RvclwiO1xuaW1wb3J0IFJlY3RhbmdsZSBmcm9tIFwiLi4vZ2VvbWV0cnkvUmVjdGFuZ2xlXCI7XG5pbXBvcnQgUmFuZCBmcm9tIFwiLi9SYW5kXCI7XG5cbi8qKlxuICogQ3JlYXRlcyBhIHJhbmRvbSBkaXN0cmlidXRpb24gb2YgcG9pbnRzIGluIGEgcGFydGljdWxhciBib3VuZGluZyBib3hcbiAqIHdpdGggYSBwYXJ0aWN1bGFyIGF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcbiAqIEBwYXJhbSB7bnVtYmVyfSBbc2VlZD1udWxsXSBJZiBzcGVjaWZpZWQgdXNlIGEgbG9jYWwgc2VlZCBmb3IgY3JlYXRpbmcgdGhlIHBvaW50XG4gKiAgZGlzdHJpYnV0aW9uLiBPdGhlcndpc2UsIHVzZSB0aGUgY3VycmVudCBnbG9iYWwgc2VlZCBmb3IgZ2VuZXJhdGlvblxuICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgbGlzdCBvZiByYW5kb21seSBkaXN0cmlidXRlZCBwb2ludHNcbiAqIEBtZW1iZXJvZiBQb2ludERpc3RyaWJ1dGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gcmFuZG9tKGJib3gsIGQsIHNlZWQgPSBudWxsKSB7XG4gICAgY29uc3Qgcm5nID0gc2VlZCA/IG5ldyBSYW5kKHNlZWQpIDogUmFuZDtcbiAgICBjb25zdCBuUG9pbnRzID0gYmJveC5hcmVhIC8gKGQgKiBkKTtcblxuICAgIGxldCBwb2ludHMgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG5Qb2ludHM7IGkrKykge1xuICAgICAgICBwb2ludHMucHVzaChybmcudmVjdG9yKGJib3gpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcG9pbnRzO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBzcXVhcmUgZ3JpZCBsaWtlIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMgaW4gYSBwYXJ0aWN1bGFyIGJvdW5kaW5nXG4gKiBib3ggd2l0aCBhIHBhcnRpY3VsYXIgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcbiAqIEByZXR1cm5zIHtWZWN0b3JbXX0gVGhlIGxpc3Qgb2YgcmFuZG9tbHkgZGlzdHJpYnV0ZWQgcG9pbnRzXG4gKiBAbWVtYmVyb2YgUG9pbnREaXN0cmlidXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNxdWFyZShiYm94LCBkKSB7XG4gICAgY29uc3QgZHggPSBkIC8gMjtcbiAgICBjb25zdCBkeSA9IGR4O1xuICAgIGxldCBwb2ludHMgPSBbXTtcblxuICAgIGZvciAobGV0IHkgPSAwOyB5IDwgYmJveC5oZWlnaHQ7IHkgKz0gZCkge1xuICAgICAgICBmb3IgKGxldCB4ID0gMDsgeCA8IGJib3gud2lkdGg7IHggKz0gZCkge1xuICAgICAgICAgICAgcG9pbnRzLnB1c2gobmV3IFZlY3RvcihkeCArIHgsIGR5ICsgeSkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBvaW50cztcbn1cblxuXG4vKipcbiAqIENyZWF0ZXMgYSBzcXVhcmUgZ3JpZCBsaWtlIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMgaW4gYSBwYXJ0aWN1bGFyIGJvdW5kaW5nXG4gKiBib3ggd2l0aCBhIHBhcnRpY3VsYXIgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuIFRoZSBncmlkIGhhcyBhbHNvIGJlZW5cbiAqIHNsaWdodGx5IHB1cnR1cmJlZCBvciBqaXR0ZXJlZCBzbyB0aGF0IHRoZSBkaXN0cmlidXRpb24gaXMgbm90IGNvbXBsZXRlbHlcbiAqIGV2ZW4uXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcbiAqIEBwYXJhbSB7bnVtYmVyfSBhbW0gVGhlIGFtbW91bnQgb2Ygaml0dGVyIHRoYXQgaGFzIGJlZW4gYXBwbGllZCB0byB0aGUgZ3JpZFxuICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgbGlzdCBvZiByYW5kb21seSBkaXN0cmlidXRlZCBwb2ludHNcbiAqIEBtZW1iZXJvZiBQb2ludERpc3RyaWJ1dGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gc3F1YXJlSml0dGVyKGJib3gsIGQsIGFtbSkge1xuICAgIHJldHVybiBzcXVhcmUoYmJveCwgZCkubWFwKHYgPT4gUmFuZC5qaXR0ZXIodiwgYW1tKSk7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIHVuaWZvcm0gaGV4YWdvbmFsIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMgaW4gYSBwYXJ0aWN1bGFyIGJvdW5kaW5nXG4gKiBib3ggd2l0aCBhIHBhcnRpY3VsYXIgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuIFRoZSBoZXhhZ29ucyBjYW4gYWxzbyBiZVxuICogc3BlY2lmaWVkIHRvIGhhdmUgYSBwYXJ0aWN1bGFyIHdpZHRoIG9yIGhlaWdodCBhcyB3ZWxsIGFzIGNyZWF0aW5nIGhleGFnb25zXG4gKiB0aGF0IGhhdmUgXCJwb2ludHlcIiB0b3BzIG9yIFwiZmxhdFwiIHRvcHMuIEJ5IGRlZmF1bHQgaXQgbWFrZXMgZmxhdCB0b3BzLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtmbGF0VG9wPXRydWVdIENyZWF0ZSBoZWNhZ29ucyB3aXRoIGZsYXQgdG9wcyBieSBkZWZhdWx0LlxuICogIE90aGVyd2lzZSBnbyB3aXRoIHRoZSBwb2ludHkgdG9wIGhleGFnb25zLlxuICogQHBhcmFtIHtudW1iZXJ9IHcgVGhlIHdpZHRoIG9mIHRoZSBoZXhhZ29uIHRpbGVzXG4gKiBAcGFyYW0ge251bWJlcn0gaCBUaGUgaGVpZ2h0IG9mIHRoZSBoZXhhZ29uIHRpbGVzXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoZXhhZ29uKGJib3gsIGQsIGZsYXRUb3AgPSB0cnVlLCB3LCBoKSB7XG4gICAgLy8gTmVlZCB0byBhbGxvdyBmb3IgdGhlIGNoYW5nZSBvZiBoZWlnaHQgYW5kIHdpZHRoXG4gICAgLy8gUnVubmluZyBpbnRvIFwiVW5jYXVnaHQgVm9yb25vaS5jbG9zZUNlbGxzKCkgPiB0aGlzIG1ha2VzIG5vIHNlbnNlIVwiXG5cbiAgICBjb25zdCBkeCA9IGQgLyAyO1xuICAgIGNvbnN0IGR5ID0gZHg7XG4gICAgbGV0IHBvaW50cyA9IFtdO1xuICAgIGNvbnN0IGFsdGl0dWRlID0gTWF0aC5zcXJ0KDMpIC8gMiAqIGQ7XG4gICAgdmFyIE4gPSBNYXRoLnNxcnQoYmJveC5hcmVhIC8gKGQgKiBkKSk7XG4gICAgZm9yIChsZXQgeSA9IDA7IHkgPCBOOyB5KyspIHtcbiAgICAgICAgZm9yIChsZXQgeCA9IDA7IHggPCBOOyB4KyspIHtcbiAgICAgICAgICAgIHBvaW50cy5wdXNoKG5ldyBWZWN0b3IoKDAuNSArIHgpIC8gTiAqIGJib3gud2lkdGgsXG4gICAgICAgICAgICAgICAgKDAuMjUgKyAwLjUgKiB4ICUgMiArIHkpIC8gTiAqIGJib3guaGVpZ2h0KSk7XG4gICAgICAgICAgICAvLyBwb2ludHMucHVzaChuZXcgVmVjdG9yKCh5ICUgMikgKiBkeCArIHggKiBkICsgZHgsIHkgKiBkICsgZHkpKTsgLy8gUG9pbnR5IFRvcFxuICAgICAgICAgICAgLy8gcG9pbnRzLnB1c2gobmV3IFZlY3Rvcih4ICogZCwgKHggJSAyKSAqIGR4ICsgeSAqIGQpKTsgLy8gRmxhdCBUb3BcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwb2ludHM7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIGJsdWUgbm9pc2UgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXIgYm91bmRpbmcgYm94XG4gKiB3aXRoIGEgcGFydGljdWxhciBhdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLiBUaGlzIGlzIGRvbmUgYnlcbiAqIGNyZWF0aW5nIGEgZ3JpZCBzeXN0ZW0gYW5kIHBpY2tpbmcgYSByYW5kb20gcG9pbnQgaW4gZWFjaCBncmlkLiBUaGlzIGhhc1xuICogdGhlIGVmZmVjdCBvZiBjcmVhdGluZyBhIGxlc3MgcmFuZG9tIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMuIFRoZSBzZWNvbmRcbiAqIHBhcmFtZXRlciBtIGRldGVybWlucyB0aGUgc3BhY2luZyBiZXR3ZWVuIHBvaW50cyBpbiB0aGUgZ3JpZC4gVGhpcyBlbnN1cmVzXG4gKiB0aGF0IG5vIHR3byBwb2ludHMgYXJlIGluIHRoZSBzYW1lIGdyaWQuXG4gKiBcbiAqIEBzdW1tYXJ5IENyZWF0ZSBhIGppdHRlcmVkIGdyaWQgYmFzZWQgcmFuZG9tIGJsdWUgbm9pc2UgcG9pbnQgZGlzdHJpYnV0aW9uLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXG4gKiBAcGFyYW0ge251bWJlcn0gW3NlZWQ9bnVsbF0gSWYgc3BlY2lmaWVkIHVzZSBhIGxvY2FsIHNlZWQgZm9yIGNyZWF0aW5nIHRoZSBwb2ludFxuICogIGRpc3RyaWJ1dGlvbi4gT3RoZXJ3aXNlLCB1c2UgdGhlIGN1cnJlbnQgZ2xvYmFsIHNlZWQgZm9yIGdlbmVyYXRpb25cbiAqIEBwYXJhbSB7bnVtYmVyfSBbbT0wXSBNYXhpbXVtIGRpc3RhbmNlIGF3YXkgZnJvbSB0aGUgZWRnZSBvZiB0aGUgZ3JpZCB0aGF0IGFcbiAqICBwb2ludCBjYW4gYmUgcGxhY2VkLiBUaGlzIGFjdHMgdG8gaW5jcmVhc2UgdGhlIHBhZGRpbmcgYmV0d2VlbiBwb2ludHMuIFxuICogIFRoaXMgbWFrZXMgdGhlIG5vaXNlIGxlc3MgcmFuZG9tLiBUaGlzIG51bWJlciBtdXN0IGJlIHNtYWxsZXIgdGhhbiBkLlxuICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgbGlzdCBvZiByYW5kb21seSBkaXN0cmlidXRlZCBwb2ludHNcbiAqIEBtZW1iZXJvZiBQb2ludERpc3RyaWJ1dGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gaml0dGVyZWRHcmlkKGJib3gsIGQsIHNlZWQgPSBudWxsLCBtID0gMCkge1xuICAgIGNvbnN0IHJuZyA9IHNlZWQgPyBuZXcgUmFuZChzZWVkKSA6IFJhbmQ7XG5cbiAgICBsZXQgcG9pbnRzID0gW107XG4gICAgbGV0IHBvaW50Qm94O1xuICAgIGZvciAobGV0IHkgPSAwOyB5IDwgYmJveC5oZWlnaHQgLSBkOyB5ICs9IGQpIHtcbiAgICAgICAgZm9yIChsZXQgeCA9IDA7IHggPCBiYm94LndpZHRoIC0gZDsgeCArPSBkKSB7XG4gICAgICAgICAgICAvLyBMb2NhbCBiYm94IGZvciB0aGUgcG9pbnQgdG8gZ2VuZXJhdGUgaW5cbiAgICAgICAgICAgIGNvbnN0IGJveFBvcyA9IG5ldyBWZWN0b3IoeCAtIGQgKyBtLCB5IC0gZCArIG0pO1xuICAgICAgICAgICAgcG9pbnRCb3ggPSBuZXcgUmVjdGFuZ2xlKGJveFBvcywgeCAtIG0sIHkgLSBtKTtcbiAgICAgICAgICAgIHBvaW50cy5wdXNoKHJuZy52ZWN0b3IocG9pbnRCb3gpKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwb2ludHM7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIHBvaXNzb24sIG9yIGJsdWUgbm9pc2UgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXJcbiAqIGJvdW5kaW5nIGJveCB3aXRoIGEgcGFydGljdWxhciBhdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLiBUaGlzIGlzXG4gKiBkb25lIGJ5IHVzaW5nIHBvaXNzb24gZGlzayBzYW1wbGluZyB3aGljaCB0cmllcyB0byBjcmVhdGUgcG9pbnRzIHNvIHRoYXQgdGhlXG4gKiBkaXN0YW5jZSBiZXR3ZWVuIG5laWdoYm9ycyBpcyBhcyBjbG9zZSB0byBhIGZpeGVkIG51bWJlciAodGhlIGRpc3RhbmNlIGQpXG4gKiBhcyBwb3NzaWJsZS4gVGhpcyBhbGdvcml0aG0gaXMgaW1wbGVtZW50ZWQgdXNpbmcgdGhlIHBvaXNzb24gZGFydCB0aHJvd2luZ1xuICogYWxnb3JpdGhtLlxuICogIFxuICogQHN1bW1hcnkgQ3JlYXRlIGEgYmx1ZSBub2lzZSBkaXN0cmlidXRpb24gb2YgcG9pbnRzIHVzaW5nIHBvaXNzb24gZGlza1xuICogIHNhbXBsaW5nLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xuICogXG4gKiBAc2VlIHtAbGluayBodHRwczovL3d3dy5qYXNvbmRhdmllcy5jb20vcG9pc3Nvbi1kaXNjL31cbiAqIEBzZWUge0BsaW5rIGh0dHBzOi8vZ2l0aHViLmNvbS9qZWZmcmV5LWhlYXJuL3BvaXNzb24tZGlzay1zYW1wbGV9XG4gKiBAbWVtYmVyb2YgUG9pbnREaXN0cmlidXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBvaXNzb24oYmJveCwgZCkge1xuICAgIHZhciBzYW1wbGVyID0gbmV3IFBvaXNzb24oYmJveC53aWR0aCwgYmJveC5oZWlnaHQsIGQsIGQpO1xuICAgIHZhciBzb2x1dGlvbiA9IHNhbXBsZXIuc2FtcGxlVW50aWxTb2x1dGlvbigpO1xuICAgIHZhciBwb2ludHMgPSBzb2x1dGlvbi5tYXAocG9pbnQgPT4gVmVjdG9yLmFkZChuZXcgVmVjdG9yKHBvaW50KSwgYmJveC5wb3NpdGlvbikpO1xuXG4gICAgcmV0dXJuIHBvaW50cztcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgYmx1ZSBub2lzZSBkaXN0cmlidXRpb24gb2YgcG9pbnRzIGluIGEgcGFydGljdWxhciBib3VuZGluZyBib3hcbiAqIHdpdGggYSBwYXJ0aWN1bGFyIGF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuIFRoaXMgaXMgZG9uZSBieSB1c2luZ1xuICogcmVjdXJzaXZlIHdhbmcgdGlsZXMgdG8gY3JlYXRlIHRoaXMgZGlzdHJpYnV0aW9uIG9mIHBvaW50cy5cbiAqIFxuICogQHN1bW1hcnkgTm90IEltcGxlbWVudGVkIFlldFxuICogXG4gKiBAZXhwb3J0XG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWN1cnNpdmVXYW5nKGJib3gsIGQpIHtcbiAgICB0aHJvdyBcIkVycm9yOiBOb3QgSW1wbGVtZW50ZWRcIjtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgY2lyY3VsYXIgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXIgYm91bmRpbmcgYm94XG4gKiB3aXRoIGEgcGFydGljdWxhciBhdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLlxuICogXG4gKiBAc3VtbWFyeSBOb3QgSW1wbGVtZW50ZWQgWWV0XG4gKiBcbiAqIEBleHBvcnRcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcbiAqIEByZXR1cm5zIHtWZWN0b3JbXX0gVGhlIGxpc3Qgb2YgcmFuZG9tbHkgZGlzdHJpYnV0ZWQgcG9pbnRzXG4gKiBAbWVtYmVyb2YgUG9pbnREaXN0cmlidXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNpcmN1bGFyKGJib3gsIGQpIHtcbiAgICB0aHJvdyBcIkVycm9yOiBOb3QgSW1wbGVtZW50ZWRcIjtcbn0iLCJcInVzZSBzdHJpY3RcIjtcblxuaW1wb3J0IHNlZWRSYW5kb20gZnJvbSBcInNlZWRSYW5kb21cIjtcbmltcG9ydCBWZWN0b3IgZnJvbSBcIi4uL2dlb21ldHJ5L1ZlY3RvclwiO1xuXG5jbGFzcyBSYW5kIHtcbiAgICAvKipcbiAgICAgKiBXcmFwcGVyIGxpYnJhcnkgZm9yIERhdmlkIEJhdSdzIHNlZWRlZCByYW5kb20gbnVtYmVyIGdlbmVyYXRvciB3aGljaCBpcyBhXG4gICAgICogd3JhcHBlciBmb3IgdGhlIE1hdGgucmFuZCgpIGZ1bmN0aW9uYWxpdHkuIFRoaXMgbGlicmFyeSBpcyBpbXBsZW1lbnRlZCB0b1xuICAgICAqIGZpbGwgb3V0IHRoZSBmdW5jdGlvbmFsaXR5IG9mIHRoZSByYW5kb20gY2FwYWJpbGl0aWVzIGFzIHdlbGwgYXMgYnVpbGRcbiAgICAgKiBvbiB0aGUgY2FwYWJpbGl0aWVzIGV4aXN0aW5nIGluIHRoZSBmcmFtZXdvcmsgY3VycmVudGx5LiBUaGlzIGNsYXNzIGNhblxuICAgICAqIGJlIHVzZWQgb24gYSBnbG9iYWwgb3IgbG9jYWwgc2NhbGUuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBSYW5kLnNlZWRSYW5kb20oMCk7ICAgICAgLy8gU2V0IHRoZSBnbG9iYWwgc2VlZFxuICAgICAqIFJhbmQucmFuZCgpOyAgICAgICAgICAgICAvLyBQcmVkaWN0YWJsZSBiYXNlZCBvZmYgc2VlZFxuICAgICAqIFxuICAgICAqIEBleGFtcGxlIFxuICAgICAqIHZhciBybmcgPSBuZXcgUmFuZCgwKTsgICAvLyBTZXQgdGhlIGxvY2FsIHJuZyBzZWVkXG4gICAgICogcm5nLnJhbmQoKTsgICAgICAgICAgICAgIC8vIFByZWRpY3RhYmxlIGJhc2VkIG9mZiBzZWVkXG4gICAgICogXG4gICAgICogUmFuZC5yYW5kKCk7ICAgICAgICAgICAgIC8vIFVucHJlZGljdGFibGUgc2luY2UgZ2xvYmFsIHNlZWQgaXMgbm90IHNldFxuICAgICAqIFxuICAgICAqIEBzZWUge0BsaW5rIGh0dHBzOi8vZ2l0aHViLmNvbS9kYXZpZGJhdS9zZWVkcmFuZG9tfVxuICAgICAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gW3NlZWQ9MF0gVGhlIHNlZWQgdG8gYmUgYXBwbGllZCB0byB0aGUgbG9jYWxcbiAgICAgKiAgcmFuZG9tIG51bWJlciBnZW5lcmF0b3JcbiAgICAgKiBAY2xhc3MgUmFuZFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHNlZWQgPSAwKSB7XG4gICAgICAgIHRoaXMucm5nID0gc2VlZFJhbmRvbShzZWVkKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXQgdGhlIGdsb2JhbCBzZWVkIGZvciB0aGUgc2VlZGVkIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9yLiBBZnRlciB0aGUgc2VlZCBoYXMgYmVlblxuICAgICAqIHNldC4gVGhlIHJhbmRvbSBudW1iZXJzIHdpbGwgYmUgcHJlZGljdGFibGUgYW5kIHJlcGVhdGFibGUgZ2l2ZW4gdGhlIHNhbWVcbiAgICAgKiBpbnB1dCBzZWVkLiBJZiBubyBzZWVkIGlzIHNwZWNpZmllZCwgdGhlbiBhIHJhbmRvbSBzZWVkIHdpbGwgYmUgYXNzaWduZWQgdG9cbiAgICAgKiB0aGUgcmFuZG9tIG51bWJlciBnZW5lcmF0b3IgdXNpbmcgYWRkZWQgc3lzdGVtIGVudHJvcHkuXG4gICAgICogXG4gICAgICogQGV4cG9ydFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gW3NlZWQ9MF0gVGhlIHNlZWQgdG8gYmUgYXBwbGllZCB0byB0aGUgZ2xvYmFsXG4gICAgICogIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9yXG4gICAgICogQG1lbWJlcm9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgc2V0U2VlZChzZWVkID0gMCkge1xuICAgICAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgICAgICAgZ2xvYmFsOiB0cnVlLFxuICAgICAgICAgICAgZW50cm9weTogc2VlZCA9PT0gdW5kZWZpbmVkXG4gICAgICAgIH07XG4gICAgICAgIHNlZWRSYW5kb20oc2VlZCwgb3B0aW9ucyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0IHRoZSBzZWVkIGZvciB0aGUgc2VlZGVkIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9yLiBBZnRlciB0aGUgc2VlZCBoYXMgYmVlblxuICAgICAqIHNldC4gVGhlIHJhbmRvbSBudW1iZXJzIHdpbGwgYmUgcHJlZGljdGFibGUgYW5kIHJlcGVhdGFibGUgZ2l2ZW4gdGhlIHNhbWVcbiAgICAgKiBpbnB1dCBzZWVkLiBJZiBubyBzZWVkIGlzIHNwZWNpZmllZCwgdGhlbiBhIHJhbmRvbSBzZWVkIHdpbGwgYmUgYXNzaWduZWQgdG9cbiAgICAgKiB0aGUgcmFuZG9tIG51bWJlciBnZW5lcmF0b3IgdXNpbmcgYWRkZWQgc3lzdGVtIGVudHJvcHkuXG4gICAgICogXG4gICAgICogQGV4cG9ydFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gW3NlZWQ9MF0gVGhlIHNlZWQgdG8gYmUgYXBwbGllZCB0byB0aGUgUk5HXG4gICAgICogXG4gICAgICogQG1lbWJlcm9mIFJhbmRcbiAgICAgKi9cbiAgICBzZXRTZWVkKHNlZWQpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgIGVudHJvcHk6IHNlZWQgPT09IHVuZGVmaW5lZFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnJuZyA9IHNlZWRSYW5kb20oc2VlZCwgb3B0aW9ucyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGEgcmFuZG9tIG51bWJlciBmcm9tIDAgdG8gMS4gXG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IHJhbmRvbSBudW1iZXIgZnJvbSAwIHRvIDFcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyb2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyByYW5kKCkge1xuICAgICAgICByZXR1cm4gTWF0aC5yYW5kb20oKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gbnVtYmVyIGZyb20gMCB0byAxLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IHJhbmRvbSBudW1iZXIgZnJvbSAwIHRvIDFcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyb2YgUmFuZFxuICAgICAqL1xuICAgIHJhbmQoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJuZygpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByaXZhdGUgaGVscGVyIGZ1bmN0aW9uOlxuICAgICAqIFxuICAgICAqIFJvbGwgZm9yIGEgYm9vbGVhbiB2YWx1ZSB0aGF0IGlzIHRydWUgQHBlcmNlbnQgYW1tb3VudCBvZiB0aGUgdGltZS5cbiAgICAgKiBJZiB0aGUgcm9sbCBmYWlscyB0aGVuIHJldHVybiBmYWxzZS4gRm9yIGV4YW1wbGUgY2FsbGluZyBjaGFuY2UoMC4zKVxuICAgICAqIHdpbGwgcmV0dXJuIHRydWUgMzAlIG9mIHRoZSB0aW1lLiBUaGUgaW5wdXQgcmFuZ2VcbiAgICAgKiBcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gcGVyY2VudCBQZXJjZW50IGNoYW5jZSB0byBnZXQgVHJ1ZS4gVmFsdWUgaXMgaW4gdGhlIHJhbmdlXG4gICAgICogIGZyb20gMCAtIDEuIFdpdGggMSByZXR1cm5pbmcgYWx3YXlzIHRydWUuXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgX2NoYW5jZShybmcsIHBlcmNlbnQpIHtcbiAgICAgICAgcmV0dXJuIHJuZy5yYW5kKCkgPCBwZXJjZW50O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJvbGwgZm9yIGEgYm9vbGVhbiB2YWx1ZSB0aGF0IGlzIHRydWUgQHBlcmNlbnQgYW1tb3VudCBvZiB0aGUgdGltZS5cbiAgICAgKiBJZiB0aGUgcm9sbCBmYWlscyB0aGVuIHJldHVybiBmYWxzZS4gRm9yIGV4YW1wbGUgY2FsbGluZyBjaGFuY2UoMC4zKVxuICAgICAqIHdpbGwgcmV0dXJuIHRydWUgMzAlIG9mIHRoZSB0aW1lLiBUaGUgaW5wdXQgcmFuZ2VcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHBlcmNlbnQgUGVyY2VudCBjaGFuY2UgdG8gZ2V0IFRydWUuIFZhbHVlIGlzIGluIHRoZSByYW5nZVxuICAgICAqICBmcm9tIDAgLSAxLiBXaXRoIDEgcmV0dXJuaW5nIGFsd2F5cyB0cnVlLlxuICAgICAqIEBtZW1iZXJPZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIGNoYW5jZShwZXJjZW50KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9jaGFuY2UodGhpcywgcGVyY2VudCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUm9sbCBmb3IgYSBib29sZWFuIHZhbHVlIHRoYXQgaXMgdHJ1ZSBAcGVyY2VudCBhbW1vdW50IG9mIHRoZSB0aW1lLlxuICAgICAqIElmIHRoZSByb2xsIGZhaWxzIHRoZW4gcmV0dXJuIGZhbHNlLiBGb3IgZXhhbXBsZSBjYWxsaW5nIGNoYW5jZSgwLjMpXG4gICAgICogd2lsbCByZXR1cm4gdHJ1ZSAzMCUgb2YgdGhlIHRpbWUuIFRoZSBpbnB1dCByYW5nZVxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBwZXJjZW50IFBlcmNlbnQgY2hhbmNlIHRvIGdldCBUcnVlLiBWYWx1ZSBpcyBpbiB0aGUgcmFuZ2VcbiAgICAgKiAgZnJvbSAwIC0gMS4gV2l0aCAxIHJldHVybmluZyBhbHdheXMgdHJ1ZS5cbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIGNoYW5jZShwZXJjZW50KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9jaGFuY2UoUmFuZCwgcGVyY2VudCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHJpdmF0ZSBIZWxwZXIgRnVuY3Rpb246XG4gICAgICogR2V0IGEgcmFuZG9tIGZsb2F0IHZhbHVlIGluIGEgcGFydGljdWxhciByYW5nZVxuICAgICAqIFxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7YW55fSBybmcgVGhlIGxvY2FsIG9yIGdsb2JhbCBybmcgdG8gdXNlIChSYW5kIG9yIHRoaXMpXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IG1pbiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWF4IFxuICAgICAqIFxuICAgICAqIEBtZW1iZXJvZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIF9yYW5kUmFuZ2Uocm5nLCBtaW4sIG1heCkge1xuICAgICAgICByZXR1cm4gcm5nLnJhbmQoKSAqIChtYXggLSBtaW4pICsgbWluO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHJhbmRvbSBmbG9hdCB2YWx1ZSBpbiBhIHBhcnRpY3VsYXIgcmFuZ2VcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IG1pbiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWF4IFxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFJhbmRvbSBmbG9hdCBudW1iZXIgZnJvbSBtaW4gKGluY2x1c2l2ZSkgXG4gICAgICogIHRvIG1heCAoZXhjbHVzaXZlKVxuICAgICAqIFxuICAgICAqIEBtZW1iZXJvZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIHJhbmRSYW5nZShtaW4sIG1heCkge1xuICAgICAgICByZXR1cm4gUmFuZC5fcmFuZFJhbmdlKFJhbmQsIG1pbiwgbWF4KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gZmxvYXQgdmFsdWUgaW4gYSBwYXJ0aWN1bGFyIHJhbmdlXG4gICAgICogXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IG1pbiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWF4IFxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFJhbmRvbSBmbG9hdCBudW1iZXIgZnJvbSBtaW4gKGluY2x1c2l2ZSkgXG4gICAgICogIHRvIG1heCAoZXhjbHVzaXZlKVxuICAgICAqIFxuICAgICAqIEBtZW1iZXJvZiBSYW5kXG4gICAgICovXG4gICAgcmFuZFJhbmdlKG1pbiwgbWF4KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kUmFuZ2UodGhpcywgbWluLCBtYXgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByaXZhdGUgSGVscGVyIEZ1bmN0aW9uOlxuICAgICAqIEdldCBhIHJhbmRvbSBpbnQgaW4gYSBwYXJ0aWN1bGFyIHJhbmdlIChtaW4gYW5kIG1heCBpbmNsdXNpdmUpXG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWluIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtYXggXG4gICAgICogQHJldHVybnMge251bWJlcn0gUmFuZG9tIGZsb2F0IG51bWJlciBmcm9tIG1pbiAoaW5jbHVzaXZlKSBcbiAgICAgKiAgdG8gbWF4IChleGNsdXNpdmUpXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgX3JhbmRJbnQocm5nLCBtaW4sIG1heCkge1xuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcihybmcucmFuZCgpICogKG1heCAtIG1pbiArIDEpKSArIG1pbjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gaW50IGluIGEgcGFydGljdWxhciByYW5nZSAobWluIGFuZCBtYXggaW5jbHVzaXZlKVxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWluIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtYXggXG4gICAgICogQHJldHVybnMge251bWJlcn0gUmFuZG9tIGZsb2F0IG51bWJlciBmcm9tIG1pbiAoaW5jbHVzaXZlKSBcbiAgICAgKiAgdG8gbWF4IChleGNsdXNpdmUpXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgcmFuZEludChtaW4sIG1heCkge1xuICAgICAgICByZXR1cm4gUmFuZC5fcmFuZEludChSYW5kLCBtaW4sIG1heCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGEgcmFuZG9tIGludCBpbiBhIHBhcnRpY3VsYXIgcmFuZ2UgKG1pbiBhbmQgbWF4IGluY2x1c2l2ZSlcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWluIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtYXggXG4gICAgICogQHJldHVybnMge251bWJlcn0gUmFuZG9tIGZsb2F0IG51bWJlciBmcm9tIG1pbiAoaW5jbHVzaXZlKSBcbiAgICAgKiAgdG8gbWF4IChleGNsdXNpdmUpXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICByYW5kSW50KG1pbiwgbWF4KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSW50KHRoaXMsIG1pbiwgbWF4KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQcml2YXRlIEhlbHBlciBGdW5jdGlvbjpcbiAgICAgKiBHZXQgdGhlIHJhbmRvbSBoZXggdmFsdWUgb2YgYSBjb2xvciByZXByZXNlbnRlZCBpbiB0aGUgaGV4aWRlY2ltYWwgZm9ybWF0XG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcbiAgICAgKiBAcmV0dXJucyB7aGV4fSBUaGUgcmFuZG9tIGhleCB2YWx1ZSBpbiB0aGUgY29sb3Igc3BlY3RydW1cbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyBfcmFuZEhleChybmcpIHtcbiAgICAgICAgcmV0dXJuIHJuZy5yYW5kSW50KDAsIDE2Nzc3MjE1KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHJhbmRvbSBoZXggdmFsdWUgb2YgYSBjb2xvciByZXByZXNlbnRlZCBpbiB0aGUgaGV4aWRlY2ltYWwgZm9ybWF0XG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEByZXR1cm5zIHtoZXh9IFxuICAgICAqIFxuICAgICAqIEBtZW1iZXJPZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIHJhbmRIZXgoKSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSGV4KFJhbmQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgcmFuZG9tIGhleCB2YWx1ZSBvZiBhIGNvbG9yIHJlcHJlc2VudGVkIGluIHRoZSBoZXhpZGVjaW1hbCBmb3JtYXRcbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7aGV4fSBcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHJhbmRIZXgoKSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSGV4KHRoaXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByaXZhdGUgSGVscGVyIEZ1bmN0aW9uOlxuICAgICAqIEdldCBhIHJhbmRvbSBoZXggY29sb3Igc3RyaW5nIHJlcHJlc2VudGVkIGluIFwiI0hFWFNUUlwiIGZvcm1hdFxuICAgICAqIFxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7YW55fSBybmcgVGhlIGxvY2FsIG9yIGdsb2JhbCBybmcgdG8gdXNlIChSYW5kIG9yIHRoaXMpXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyBfcmFuZEhleENvbG9yKHJuZykge1xuICAgICAgICByZXR1cm4gXCIjXCIgKyBybmcucmFuZEhleCgpLnRvU3RyaW5nKDE2KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gaGV4IGNvbG9yIHN0cmluZyByZXByZXNlbnRlZCBpbiBcIiNIRVhTVFJcIiBmb3JtYXRcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyByYW5kSGV4Q29sb3IoKSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSGV4Q29sb3IoUmFuZCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGEgcmFuZG9tIGhleCBjb2xvciBzdHJpbmcgcmVwcmVzZW50ZWQgaW4gXCIjSEVYU1RSXCIgZm9ybWF0XG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICByYW5kSGV4Q29sb3IoKSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSGV4Q29sb3IodGhpcyk7XG4gICAgfVxuXG4gICAgLy8tLS0tIFJhbmRvbSBHZW9tZXRyeSAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gdmVjdG9yIGluIGEgYm91bmRpbmcgYm94XG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IG9mIHRoZSByYW5kb20gdmVjdG9yXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gQSByYW5kb20gdmVjdG9yXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgX3ZlY3RvcihybmcsIGJib3gpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoXG4gICAgICAgICAgICBSYW5kLnJhbmRSYW5nZShiYm94LngsIGJib3gueCArIGJib3gud2lkdGgpLFxuICAgICAgICAgICAgUmFuZC5yYW5kUmFuZ2UoYmJveC55LCBiYm94LnkgKyBiYm94LmhlaWdodClcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gdmVjdG9yIGluIGEgYm91bmRpbmcgYm94XG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggb2YgdGhlIHJhbmRvbSB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBBIHJhbmRvbSB2ZWN0b3JcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyB2ZWN0b3IoYmJveCkge1xuICAgICAgICByZXR1cm4gUmFuZC5fdmVjdG9yKFJhbmQsIGJib3gpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHJhbmRvbSB2ZWN0b3IgaW4gYSBib3VuZGluZyBib3hcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IG9mIHRoZSByYW5kb20gdmVjdG9yXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gQSByYW5kb20gdmVjdG9yXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICB2ZWN0b3IoYmJveCkge1xuICAgICAgICByZXR1cm4gUmFuZC5fdmVjdG9yKHRoaXMsIGJib3gpO1xuICAgIH1cblxuICAgIHN0YXRpYyBfaml0dGVyKHJuZywgdiwgbWF4KSB7XG4gICAgICAgIHJldHVybiBWZWN0b3IuYWRkKHYsIFZlY3Rvci5Qb2xhcihtYXgsIHJuZy5yYW5kUmFuZ2UoMCwgMiAqIE1hdGguUEkpKSk7XG4gICAgfVxuXG4gICAgc3RhdGljIGppdHRlcih2LCBtYXgpIHtcbiAgICAgICAgcmV0dXJuIFJhbmQuX2ppdHRlcihSYW5kLCB2LCBtYXgpO1xuICAgIH1cblxuICAgIGppdHRlcih2LCBtYXgpIHtcbiAgICAgICAgcmV0dXJuIFJhbmQuX2ppdHRlcih0aGlzLCB2LCBtYXgpO1xuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUmFuZDsiLCIvLyBUdW5lYWJsZSBQYXJhbWV0ZXJzXHJcbi8vIDEuMjUgZ3VhcmVudGVlIHNwbGl0IGhvcml6IG9yIHZlcnRcclxuLy8gUmVkaXN0cmlidXRlIHRoZSByYW5nZSB0byBzcGxpdFxyXG5cclxuaW1wb3J0IFZlY3RvciBmcm9tIFwiLi4vZ2VvbWV0cnkvVmVjdG9yXCI7XHJcbmltcG9ydCBSZWN0YW5nbGUgZnJvbSBcIi4uL2dlb21ldHJ5L1JlY3RhbmdsZVwiO1xyXG5pbXBvcnQgUmFuZCBmcm9tIFwiLi4vdXRpbGl0aWVzL1JhbmRcIjtcclxuaW1wb3J0IHsgZXhwIH0gZnJvbSBcIi4uL3V0aWxpdGllcy9SZWRpc3RcIjtcclxuXHJcbi8qKlxyXG4gKiBDcmVhdGUgYSBCaW5hcnkgU3BhY2UgUGFydGl0aW9uIFRyZWUgb2YgYSBwYXJ0aWN1bGFyIGRlcHRoXHJcbiAqIFxyXG4gKiBAZXhwb3J0XHJcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSByZWN0YW5nbGUgdGhhdCB0aGUgQlNQIHRyZWUgaXMgY3JlYXRlZCB3aXRoaW5cclxuICogQHBhcmFtIHtudW1iZXJ9IGRlcHRoIFRoZSBkZXB0aCB0aGF0IHRoZSBCU1AgdHJlZSBpcyBjcmVhdGVkIGRvd24gdG9cclxuICogQHBhcmFtIHtudW1iZXJ9IHNwbGl0UmFuZ2UgMC0xLCBUaGUgYW1tb3VudCBvZiBkZXZpYXRpb24gZnJvbSB0aGUgY2VudGVyXHJcbiAqICB0aGF0IHRoZSBiaW5hcnkgc3BsaXQgaXMgYWxsb3dlZCB0byB0YWtlLiAwIE1lYW5zIHRoYXQgdGhlIHNwbGl0IGFsd2F5c1xyXG4gKiAgaGFwcGVucyBpbiB0aGUgbWlkZGxlIGFuZCAxIG1lYW5zIHRoYXQgdGhlIHNwbGl0IGNhbiBoYXBwZW4gYXQgdGhlIGVkZ2Ugb2ZcclxuICogIHRoZSByZWN0YW5nbGUuXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSBkcm9wb3V0UmF0ZSAwLTEsIHRoZSBwZXJjZW50IGNoYW5jZSB0aGF0IHdoZW4gZGl2aWRpbmcgYVxyXG4gKiAgY2VsbCB0aGF0IGl0IHdpbGwgbm90IGRpdmlkZSBhbnltb3JlXHJcbiAqIFxyXG4gKiBAcmV0dXJucyBcclxuICovXHJcbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJpbmFyeVNwYWNlUGFydGl0aW9uKGJib3gsIGRlcHRoLCBzcGxpdFJhbmdlLCBkcm9wb3V0UmF0ZSkge1xyXG4gICAgXCJ1c2Ugc3RyaWN0XCI7XHJcbiAgICAvLyBNb3ZlIGJhY2sgdG8gYmJveC5jb3B5KClcclxuICAgIGxldCByb290ID0gYmJveDtcclxuICAgIHJvb3QuZGVwdGggPSAwO1xyXG4gICAgbGV0IGZyb250aWVyID0gIFtyb290XTtcclxuICAgIGNvbnN0IHNwbGl0RGVub20gPSBleHAoc3BsaXRSYW5nZSwgNywgZmFsc2UpLm1hcCgwLCAxLCAyLCAxMDApO1xyXG5cclxuICAgIHdoaWxlIChmcm9udGllci5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgbGV0IG5vZGUgPSBmcm9udGllci5wb3AoKTtcclxuXHJcbiAgICAgICAgaWYgKG5vZGUgIT09IHJvb3QgJiYgUmFuZC5jaGFuY2UoZHJvcG91dFJhdGUpKSB7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbGV0IGxlZnROb2RlO1xyXG4gICAgICAgIGxldCByaWdodE5vZGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGlzV2lkZSA9IG5vZGUud2lkdGggLyBub2RlLmhlaWdodCA+IDEuMjU7XHJcbiAgICAgICAgY29uc3QgaXNUYWxsID0gbm9kZS5oZWlnaHQgLyBub2RlLndpZHRoID4gMS4yNTtcclxuICAgICAgICBjb25zdCBzcGxpdFJhbmQgPSAhaXNXaWRlICYmICFpc1RhbGw7XHJcblxyXG4gICAgICAgIGxldCBzcGxpdFZlcnRpY2FsO1xyXG4gICAgICAgIGlmIChzcGxpdFJhbmQpIHtcclxuICAgICAgICAgICAgc3BsaXRWZXJ0aWNhbCA9IFJhbmQuY2hhbmNlKDAuNSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc3BsaXRWZXJ0aWNhbCA9IGlzVGFsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChzcGxpdFZlcnRpY2FsKSB7IC8vIFNwbGl0IHZlcnRpY2FsXHJcblxyXG4gICAgICAgICAgICBjb25zdCBzcGxpdFkgPSBub2RlLmhlaWdodCAvIDIgK1xyXG4gICAgICAgICAgICAgICAgUmFuZC5yYW5kUmFuZ2UoLW5vZGUuaGVpZ2h0IC8gc3BsaXREZW5vbSwgbm9kZS5oZWlnaHQgLyBzcGxpdERlbm9tKTtcclxuXHJcbiAgICAgICAgICAgIGxlZnROb2RlID0gbmV3IFJlY3RhbmdsZShuZXcgVmVjdG9yKG5vZGUueCwgbm9kZS55KSxcclxuICAgICAgICAgICAgICAgIG5vZGUud2lkdGgsIHNwbGl0WSk7XHJcbiAgICAgICAgICAgIHJpZ2h0Tm9kZSA9IG5ldyBSZWN0YW5nbGUobmV3IFZlY3Rvcihub2RlLngsIG5vZGUueSArIHNwbGl0WSksXHJcbiAgICAgICAgICAgICAgICBub2RlLndpZHRoLCBub2RlLmhlaWdodCAtIHNwbGl0WSk7XHJcblxyXG4gICAgICAgIH0gZWxzZSB7IC8vIFNwbGl0IEhvcml6b250YWxcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHNwbGl0WCA9IG5vZGUud2lkdGggLyAyICtcclxuICAgICAgICAgICAgICAgIFJhbmQucmFuZFJhbmdlKC1ub2RlLndpZHRoIC8gc3BsaXREZW5vbSwgbm9kZS53aWR0aCAvIHNwbGl0RGVub20pO1xyXG5cclxuICAgICAgICAgICAgbGVmdE5vZGUgPSBuZXcgUmVjdGFuZ2xlKG5ldyBWZWN0b3Iobm9kZS54LCBub2RlLnkpLFxyXG4gICAgICAgICAgICAgICAgc3BsaXRYLCBub2RlLmhlaWdodCk7XHJcbiAgICAgICAgICAgIHJpZ2h0Tm9kZSA9IG5ldyBSZWN0YW5nbGUobmV3IFZlY3Rvcihub2RlLnggKyBzcGxpdFgsIG5vZGUueSksXHJcbiAgICAgICAgICAgICAgICBub2RlLndpZHRoIC0gc3BsaXRYLCBub2RlLmhlaWdodCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBsZWZ0Tm9kZS5kZXB0aCA9IG5vZGUuZGVwdGggKyAxO1xyXG4gICAgICAgIHJpZ2h0Tm9kZS5kZXB0aCA9IG5vZGUuZGVwdGggKyAxO1xyXG5cclxuICAgICAgICBub2RlLmxlZnROb2RlID0gbGVmdE5vZGU7XHJcbiAgICAgICAgbm9kZS5yaWdodE5vZGUgPSByaWdodE5vZGU7XHJcblxyXG4gICAgICAgIGlmIChub2RlLmRlcHRoICE9PSBkZXB0aCkge1xyXG4gICAgICAgICAgICBmcm9udGllci5wdXNoKGxlZnROb2RlKTtcclxuICAgICAgICAgICAgZnJvbnRpZXIucHVzaChyaWdodE5vZGUpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcm9vdDtcclxufSIsImltcG9ydCBEaWFncmFtIGZyb20gXCIuLi9ncmFwaC9EaWFncmFtXCI7XHJcbmltcG9ydCB7IHBvaXNzb24sIGppdHRlcmVkR3JpZCB9IGZyb20gXCIuLi91dGlsaXRpZXMvUG9pbnREaXN0cmlidXRpb25cIjtcclxuXHJcbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHJlY3Vyc2l2ZVZvcm9ub2koYmJveCwgZGVwdGgsIGRlbnNpdHkpIHtcclxuICAgIFwidXNlIHN0cmljdFwiO1xyXG5cclxuICAgIGxldCBkaWFncmFtID0gbmV3IERpYWdyYW0ocG9pc3NvbihiYm94LCBkZW5zaXR5KSwgYmJveCk7XHJcblxyXG4gICAgZm9yIChsZXQgdGlsZSBvZiBkaWFncmFtLnRpbGVzKSB7XHJcbiAgICAgICAgdGlsZS5kZXB0aCA9IDA7XHJcblxyXG4gICAgICAgIGdlbmVyYXRlSW5Qb2x5Z29uKHRpbGUsIDAsIGRlbnNpdHkgLyA2KTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gZGlhZ3JhbTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2VuZXJhdGVJblBvbHlnb24ocG9seSwgY3VycmVudERlcHRoLCBkZW5zaXR5KSB7XHJcbiAgICBcInVzZSBzdHJpY3RcIjtcclxuXHJcbiAgICBsZXQgc3ViZGlhZ3JhbSA9IG5ldyBEaWFncmFtKHBvaXNzb24ocG9seS5iYm94KCksIGRlbnNpdHkpLCBwb2x5LmJib3goKSk7XHJcbiAgICBsZXQgc3ViVGlsZXMgPSBjbGlwVG9SZWdpb24oc3ViZGlhZ3JhbSwgcG9seSk7XHJcbiAgICAvLyBsZXQgc3ViVGlsZXMgPSBzdWJkaWFncmFtLnRpbGVzO1xyXG4gICAgc3ViVGlsZXMuZm9yRWFjaCh0aWxlID0+IHRpbGUuZGVwdGggPSBjdXJyZW50RGVwdGggKyAxKTtcclxuICAgIHBvbHkuY2hpbGRyZW4gPSBzdWJUaWxlcztcclxufVxyXG5cclxuLy8gUmV0dXJuIGp1c3QgdGhlIHRpbGVzIHRoYXQgcmVtYWluIGluIHRoYXQgcmVnaW9uXHJcbmZ1bmN0aW9uIGNsaXBUb1JlZ2lvbihkaWFncmFtLCBwb2x5KSB7XHJcbiAgICBcInVzZSBzdHJpY3RcIjtcclxuXHJcbiAgICBsZXQgaW50ZXJuYWxQb2x5cyA9IFtdO1xyXG4gICAgbGV0IGNvbnRhaW5zO1xyXG4gICAgZm9yIChsZXQgdGlsZSBvZiBkaWFncmFtLnRpbGVzKSB7XHJcbiAgICAgICAgLy8gY29udGFpbnMgPSB0aWxlLmNvcm5lcnMucmVkdWNlKChpc1RydWUsIGNvcm5lcikgPT4ge1xyXG4gICAgICAgIC8vICAgICBjb25zb2xlLmxvZyhpc1RydWUpO1xyXG4gICAgICAgIC8vICAgICByZXR1cm4gaXNUcnVlIHx8IHBvbHkuY29udGFpbnMoY29ybmVyKTtcclxuICAgICAgICAvLyB9LCBmYWxzZSk7XHJcblxyXG4gICAgICAgIGNvbnRhaW5zID0gcG9seS5jb250YWlucyh0aWxlLmNlbnRlcik7XHJcblxyXG4gICAgICAgIGlmIChjb250YWlucykge1xyXG4gICAgICAgICAgICBpbnRlcm5hbFBvbHlzLnB1c2godGlsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBpbnRlcm5hbFBvbHlzO1xyXG59IiwiY2xhc3MgTGluZSAge1xuICAgIC8qKlxuICAgICAqIEBjbGFzcyBMaW5lXG4gICAgICogXG4gICAgICogQSBzaW1wbGUgbGluZSBvYmplY3QgdGhhdCBpcyBhbiBhcnJheSBvZiB0d28gdmVjdG9yIHBvaW50cy5cbiAgICAgKiBcbiAgICAgKiBAcHJvcGVydHkge1ZlY3Rvcn0gcDFcbiAgICAgKiBAcHJvcGVydHkge3ZlY3Rvcn0gcDJcbiAgICAgKiBcbiAgICAgKiBAc3VtbWFyeSBDcmVhdGVzIGFuIGluc3RhbmNlIG9mIFBvbHlnb24uXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHAxIFRoZSBmaXJzdCBwb2ludFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBwMiBUaGUgc2Vjb25kIHBvaW50XG4gICAgICovXG4gICAgY29uc3RydWN0b3IocDEsIHAyKSB7XG4gICAgICAgIHRoaXMucDEgPSBwMTtcbiAgICAgICAgdGhpcy5wMiA9IHAyO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERldGVybWluZSB0aGUgb3JpZW50YXRpb24gb2YgdGhlIHRocmVlIGlucHV0IHZlY3RvcnMuIFRoZSBvdXRwdXQgd2lsbCBiZVxuICAgICAqIG9uZSBvZiB0aGUgZm9sbG93aW5nOlxuICAgICAqIGNvdW50ZXJjbG9ja3dpc2UsIGNsb2Nrd2lzZSwgb3IgY29sbGluZWFyXG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYxIFRoZSBmaXJzdCB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge1ZlY290cn0gdjIgVGhlIHNlY29uZCB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdjMgVGhlIHRoaXJkIHZlY3RvclxuICAgICAqIEByZXR1cm4ge3N0cmluZ30gVGhlIG9yaWVudGF0aW9uIG9mIHRoZSB0aHJlZSBwb2ludHNcbiAgICAgKiAgXCJjb3VudGVyY2xvY2t3aXNlXCIsIFwiY2xvY2t3aXNlXCIsIFwiY29sbGluZWFyXCIgXG4gICAgICogQG1lbWJlcm9mIExpbmVcbiAgICAgKiBAc2VlIHtAbGluayBodHRwOi8vd3d3LmdlZWtzZm9yZ2Vla3Mub3JnL2NoZWNrLWlmLXR3by1naXZlbi1saW5lLXNlZ21lbnRzLWludGVyc2VjdC99XG4gICAgICovXG4gICAgc3RhdGljIF9vcmllbnRhdGlvbih2MSwgdjIsIHYzKSB7XG4gICAgICAgIGNvbnN0IHZhbCA9ICh2Mi55IC0gdjEueSkgKiAodjMueCAtIHYyLngpIC1cbiAgICAgICAgICAgICh2Mi54IC0gdjEueCkgKiAodjMueSAtIHYyLnkpO1xuXG4gICAgICAgIGlmICh2YWwgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiBcIkNvbGxpbmVhclwiXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHZhbCA+IDAgPyBcImNsb2Nrd2lzZVwiIDogXCJjb3VudGVyY2xvY2t3aXNlXCI7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHJpdmF0ZSBoZWxwZXIgZnVuY3Rpb24gdG8gaW50ZXJzZWN0cyBmdW5jdGlvbi5cbiAgICAgKiBcbiAgICAgKiBHaXZlbiB0aHJlZSBjb2xpbmVhciBwb2ludHMgdGhpcyBmdW5jdGlvbiBjaGVja3MgaWYgdjIgaXMgb24gdGhlIGxpbmUgc2VnbWVudFxuICAgICAqIHYxLXYzLlxuICAgICAqIFxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MSBUaGUgZmlyc3QgcG9pbnQgaW4gdGhlIGxpbmUgc2VnbWVudFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MiBUaGUgcG9pbnQgdG8gdGVzdCBpZiBpdCBpcyBpbiB0aGUgbWlkZGxlXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYzIFRoZSBzZWNvbmQgcG9pbnQgaW4gdGhlIGxpbmUgc2VnbWVudFxuICAgICAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdjIgbGllcyBvbiB0aGUgc2VnbWVudCBjcmVhdGVkIGJ5IHYxICYgdjNcbiAgICAgKiBAbWVtYmVyb2YgTGluZVxuICAgICAqL1xuICAgIHN0YXRpYyBfb25TZWdtZW50KHYxLCB2MiwgdjMpIHtcbiAgICAgICAgcmV0dXJuIHYyLnggPD0gTWF0aC5tYXgodjEueCwgdjMueCkgJiYgdjIueCA+PSBNYXRoLm1pbih2MS54LCB2My54KSAmJlxuICAgICAgICAgICAgdjIueSA8PSBNYXRoLm1heCh2MS55LCB2My55KSAmJiB2Mi55ID49IE1hdGgubWluKHYxLnksIHYzLnkpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGV0ZXJtaW5lIGlmIHR3byBsaW5lIHNlZ21lbnRzIGludGVyc2VjXG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7TGluZX0gbGluZTEgXG4gICAgICogQHBhcmFtIHtMaW5lfSBsaW5lMiBcbiAgICAgKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSBsaW5lcyBpbnRlcnNlY3RcbiAgICAgKiBAbWVtYmVyb2YgTGluZVxuICAgICAqIEBzZWUge0BsaW5rIGh0dHA6Ly93d3cuZ2Vla3Nmb3JnZWVrcy5vcmcvY2hlY2staWYtdHdvLWdpdmVuLWxpbmUtc2VnbWVudHMtaW50ZXJzZWN0L31cbiAgICAgKi9cbiAgICBzdGF0aWMgaW50ZXJzZWN0cyhsaW5lMSwgbGluZTIpIHtcbiAgICAgICAgLy8gRmluZCB0aGUgZm91ciBvcmllbnRhdGlvbnMgdGhhdCBhcmUgbmVlZGVkIGZvciBnZW5lcmFsIGFuZFxuICAgICAgICAvLyBzcGVjaWFsIGNhc2VzXG4gICAgICAgIGNvbnN0IG8xID0gTGluZS5fb3JpZW50YXRpb24obGluZTEucDEsIGxpbmUxLnAyLCBsaW5lMi5wMSk7XG4gICAgICAgIGNvbnN0IG8yID0gTGluZS5fb3JpZW50YXRpb24obGluZTEucDEsIGxpbmUxLnAyLCBsaW5lMi5wMik7XG4gICAgICAgIGNvbnN0IG8zID0gTGluZS5fb3JpZW50YXRpb24obGluZTIucDEsIGxpbmUyLnAyLCBsaW5lMS5wMSk7XG4gICAgICAgIGNvbnN0IG80ID0gTGluZS5fb3JpZW50YXRpb24obGluZTIucDEsIGxpbmUyLnAyLCBsaW5lMS5wMik7XG5cbiAgICAgICAgLy8gR2VuZXJhbCBDYXNlXG4gICAgICAgIGlmIChvMSAhPSBvMiAmJiBvMyAhPSBvNCkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTcGVjaWFsIENhc2VzXG4gICAgICAgIC8vIGxpbmUxLngsIGxpbmUxLnkgYW5kIGxpbmUyLnggYXJlIGNvbGluZWFyIGFuZFxuICAgICAgICAvLyBsaW5lMi54IGxpZXMgb24gc2VnbWVudCBsaW5lMS54bGluZTEueVxuICAgICAgICBpZiAobzEgPT0gXCJDb2xsaW5lYXJcIiAmJiBMaW5lLl9vblNlZ21lbnQobGluZTEucDEsIGxpbmUyLnAxLCBsaW5lMS5wMikpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gbGluZTEueCwgbGluZTEueSBhbmQgbGluZTIueCBhcmUgY29saW5lYXIgYW5kXG4gICAgICAgIC8vIGxpbmUyLnkgbGllcyBvbiBzZWdtZW50IGxpbmUxLnhsaW5lMS55XG4gICAgICAgIGlmIChvMiA9PSBcIkNvbGxpbmVhclwiICYmIExpbmUuX29uU2VnbWVudChsaW5lMS5wMSwgbGluZTIucDIsIGxpbmUxLnAyKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBsaW5lMi54LCBsaW5lMi55IGFuZCBsaW5lMS54IGFyZSBjb2xpbmVhciBhbmRcbiAgICAgICAgLy8gbGluZTEueCBsaWVzIG9uIHNlZ21lbnQgbGluZTIueGxpbmUyLnlcbiAgICAgICAgaWYgKG8zID09IFwiQ29sbGluZWFyXCIgJiYgTGluZS5fb25TZWdtZW50KGxpbmUyLnAxLCBsaW5lMS5wMSwgbGluZTIucDIpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGxpbmUyLngsIGxpbmUyLnkgYW5kIGxpbmUxLnkgYXJlIGNvbGluZWFyIGFuZFxuICAgICAgICAvLyBsaW5lMS55IGxpZXMgb24gc2VnbWVudCBsaW5lMi54bGluZTIueVxuICAgICAgICBpZiAobzQgPT0gXCJDb2xsaW5lYXJcIiAmJiBMaW5lLl9vblNlZ21lbnQobGluZTIucDEsIGxpbmUxLnAyLCBsaW5lMi5wMikpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlOyAvLyBEb2Vzbid0IGZhbGwgaW4gYW55IG9mIHRoZSBhYm92ZSBjYXNlc1xuXG4gICAgfVxuXG4gICAgaW50ZXJzZWN0cyhsaW5lMSwgbGluZTIpIHtcbiAgICAgICAgcmV0dXJuIExpbmUuaW50ZXJzZWN0cyhsaW5lMSwgbGluZTIpO1xuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgTGluZTsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuL1ZlY3RvclwiO1xuaW1wb3J0IFJlY3RhbmdsZSBmcm9tIFwiLi9SZWN0YW5nbGVcIjtcblxuY2xhc3MgUG9seWdvbiB7XG4gICAgLyoqXG4gICAgICogQGNsYXNzIFBvbHlnb25cbiAgICAgKiBcbiAgICAgKiBDbGFzcyB0byBzdG9yZSBwb2x5Z29uIGluZm9ybWF0aW9uIGluIGFuIGFycmF5IGZvcm1hdCB0aGF0IGFsc28gZ2l2ZXMgaXRcbiAgICAgKiBleHRyYSBmdW5jdGlvbmFsaXR5IG9uIHRvcCBvZiBpdC4gVGhpcyBjYW4gYWxzbyBzZXJ2ZXIgYXMgYSBiYXNlIGNsYXNzXG4gICAgICogZm9yIG1vcmUgc3BlY2lmaWMgZ2VvbWV0cmljIHNoYXBlcy4gQXQgdGhlIG1vbWVudCB0aGlzIGNsYXNzIGFzc3VtZXMgb25seVxuICAgICAqIGNvbnZleCBwb2x5Z29ucyBmb3Igc2ltcGxpY2l0eS5cbiAgICAgKiBcbiAgICAgKiBAc3VtbWFyeSBDcmVhdGVzIGFuIGluc3RhbmNlIG9mIFBvbHlnb24uXG4gICAgICogXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IGNlbnRlciBUaGUgY2VudGVyIG9mIHRoZSBwb2x5Z29uLiBJZiBub3Qgb3RoZXJ3aXNlXG4gICAgICogIHN0YXRlZCwgdGhlIGNlbnRlciBkZWZhdWx0cyB0byB0aGUgY2VudHJpb2QuIEFueSB0cmFuc2Zvcm1hdGlvbnMgb25cbiAgICAgKiAgdGhlIHBvbHlnb24gYXJlIGRvbmUgYWJvdXQgdGhlIGNlbnRlciBvZiB0aGUgcG9seWdvbi5cbiAgICAgKiBAcHJvcGVydHkge1ZlY3RvcltdfSBjb3JuZXJzIFRoZSBjb3JuZXIgdmVjdG9ycyBvZiB0aGUgcG9seWdvblxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yW119IFtjb3JuZXJzPVtdXSBUaGUgY29ybmVyIHZlcnRpY2llcyBvZiB0aGUgcG9seWdvblxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBbY2VudGVyPWF2ZXJhZ2UodmVydGljaWVzKV0gVGhlIGNlbnRlciBvZiB0aGUgcG9seWdvbi5cbiAgICAgKiAgSWYgYSB2YWx1ZSBpcyBub3QgcHJvdmlkZWQgdGhlIGRlZmF1bHQgdmFsdWUgYmVjb21lcyB0aGUgY2VudHJvaWQgb2ZcbiAgICAgKiAgdGhlIHZlcnRpY2llcy5cbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihjb3JuZXJzID0gbnVsbCwgY2VudGVyID0gbnVsbCkge1xuICAgICAgICB0aGlzLmNvcm5lcnMgPSBjb3JuZXJzID8gY29ybmVycyA6IFtdO1xuICAgICAgICB0aGlzLmNlbnRlciA9IGNlbnRlciA/IGNlbnRlciA6IHRoaXMuY2VudHJvaWQoKTtcbiAgICAgICAgdGhpcy5fYmJveCA9IG51bGw7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBjZW50cm9pZCBvZiB0aGUgcG9seWdvbi4gVGhpcyBpcyB0aGUgdmVjdG9yIGF2ZXJhZ2Ugb2YgYWxsIHRoZVxuICAgICAqIHBvaW50cyB0aGF0IG1ha2UgdXAgdGhlIHBvbHlnb24uXG4gICAgICogXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIGNlbnRyb2lkIG9mIHRoZSBwb2x5Z29uXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFBvbHlnb25cbiAgICAgKi9cbiAgICBjZW50cm9pZCgpIHtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5hdmcodGhpcy5jb3JuZXJzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIGJvdW5kaW5nIGJveCBvZiB0aGUgcG9seWdvbi4gVGhhdCBpcyB0aGUgcmVjdGFuZ2xlIHRoYXQgd2lsbFxuICAgICAqIG1pbmltYWxseSBlbmNsb3NlIHRoZSBwb2x5Z29uLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtSZWN0YW5nbGV9IFRoZSBib3VuZGluZyBib3ggb2YgdGhlIHBvbHlnb25cbiAgICAgKiBAbWVtYmVyb2YgUG9seWdvblxuICAgICAqL1xuICAgIGJib3goKSB7XG4gICAgICAgIGlmICh0aGlzLl9iYm94KSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fYmJveDtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBtaW5YID0gSW5maW5pdHk7XG4gICAgICAgIGxldCBtYXhYID0gLUluZmluaXR5O1xuICAgICAgICBsZXQgbWluWSA9IEluZmluaXR5O1xuICAgICAgICBsZXQgbWF4WSA9IC1JbmZpbml0eTtcblxuICAgICAgICBmb3IgKGNvbnN0IGNvcm5lciBvZiB0aGlzLmNvcm5lcnMpIHtcbiAgICAgICAgICAgIG1pblggPSBNYXRoLm1pbihjb3JuZXIueCwgbWluWCk7XG4gICAgICAgICAgICBtYXhYID0gTWF0aC5tYXgoY29ybmVyLngsIG1heFgpO1xuICAgICAgICAgICAgbWluWSA9IE1hdGgubWluKGNvcm5lci55LCBtaW5ZKTtcbiAgICAgICAgICAgIG1heFkgPSBNYXRoLm1heChjb3JuZXIueSwgbWF4WSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLl9iYm94ID0gbmV3IFJlY3RhbmdsZShuZXcgVmVjdG9yKG1pblgsIG1pblkpLCBtYXhYIC0gbWluWCwgbWF4WSAtIG1pblkpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLl9iYm94O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgcG9seWdvbiBpbnNldCBvZiB0aGUgY3VycmVudCBwb2x5Z29uIGJ5IHRoZSBpbnB1dCBhbW1vdW50XG4gICAgICogXG4gICAgICogQHBhcmFtIGFtbW91bnRcbiAgICAgKiBAcmV0dXJucyB7UG9seWdvbn0gVGhlIGluc2V0IG9mIHRoZSBjdXJyZW50IHBvbHlnb24gYnlcbiAgICAgKiBAbWVtYmVyT2YgUG9seWdvblxuICAgICAqL1xuICAgIGluc2V0KGFtbW91bnQpIHtcbiAgICAgICAgcmV0dXJuIGFtbW91bnQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB3aGVpdGhlciBvciBub3QgdGhpcyBwb2x5Z29uIGlzIGEgY29udmV4IHBvbHlnb24uIElmIHRoaXMgaXNcbiAgICAgKiBub3QgdHJ1ZSB0aGVuIHRoZSBwb2x5Z29uIGlzIGNvbnZhY2Ugb3IgbW9yZSBjb21wbGV4LlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBJZiB0aGUgcG9seWdvbiBpcyBjb252ZXhcbiAgICAgKiBAbWVtYmVyT2YgUG9seWdvblxuICAgICAqL1xuICAgIGlzQ29udmV4KCkge1xuXG4gICAgfVxuXG4gICAgcm90YXRlKCkge1xuXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGV0ZXJtaW5lIGlmIHRoZSBwb2ludCBpcyBjb250YWluZWQgd2l0aGluIHRoZSBwb2x5Z29uXG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHZlY3RvclxuICAgICAqIFxuICAgICAqIEBzZWUge0BsaW5rIGh0dHBzOi8vZ2l0aHViLmNvbS9zdWJzdGFjay9wb2ludC1pbi1wb2x5Z29uL2Jsb2IvbWFzdGVyL2luZGV4LmpzfVxuICAgICAqIEBtZW1iZXJPZiBQb2x5Z29uXG4gICAgICovXG4gICAgY29udGFpbnModmVjdG9yKSB7XG4gICAgICAgIGlmICghdGhpcy5iYm94KCkuY29udGFpbnModmVjdG9yKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbGVuID0gdGhpcy5jb3JuZXJzLmxlbmd0aDtcbiAgICAgICAgY29uc3QgeCA9IHZlY3Rvci54O1xuICAgICAgICBjb25zdCB5ID0gdmVjdG9yLnk7XG4gICAgICAgIGxldCBpbnNpZGUgPSBmYWxzZTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDAsIGogPSBsZW4gLSAxOyBpIDwgbGVuOyBqID0gaSsrKSB7XG4gICAgICAgICAgICBsZXQgeGkgPSB0aGlzLmNvcm5lcnNbaV0ueCwgeWkgPSB0aGlzLmNvcm5lcnNbaV0ueTtcbiAgICAgICAgICAgIGxldCB4aiA9IHRoaXMuY29ybmVyc1tqXS54LCB5aiA9IHRoaXMuY29ybmVyc1tqXS55O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBsZXQgaW50ZXJzZWN0ID0gKCh5aSA+IHkpICE9PSAoeWogPiB5KSkgJiZcbiAgICAgICAgICAgICAoeCA8ICh4aiAtIHhpKSAqICh5IC0geWkpIC8gKHlqIC0geWkpICsgeGkpO1xuICAgICAgICAgICAgaWYgKGludGVyc2VjdCkgIHtcbiAgICAgICAgICAgICAgICBpbnNpZGUgPSAhaW5zaWRlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gaW5zaWRlO1xuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUG9seWdvbjsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuL1ZlY3RvclwiO1xuXG5jbGFzcyBSZWN0YW5nbGUge1xuICAgIC8qKiBcbiAgICAgKiBAY2xhc3MgUmVjdGFuZ2xlXG4gICAgICogQGV4dGVuZHMgUG9seWdvblxuICAgICAqIFxuICAgICAqIENsYXNzIHRvIHN0b3JlIGFycmF5IGluZm9ybWF0aW9uIGFib3V0IGEgcmVjdGFuZ2xlXG4gICAgICogXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IHBvc2l0aW9uXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IHhcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0geVxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB3aWR0aFxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoZWlnaHRcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gcG9zaXRpb25cbiAgICAgKiBAcGFyYW0ge251bWJlcn0gd2lkdGhcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gaGVpZ2h0XG4gICAgICovXG5cbiAgICBjb25zdHJ1Y3Rvcihwb3NpdGlvbiwgd2lkdGgsIGhlaWdodCkge1xuXG4gICAgICAgIHRoaXMucG9zaXRpb24gPSBwb3NpdGlvbjtcbiAgICAgICAgdGhpcy54ID0gcG9zaXRpb24ueDtcbiAgICAgICAgdGhpcy55ID0gcG9zaXRpb24ueTtcbiAgICAgICAgdGhpcy5iciA9IHBvc2l0aW9uO1xuICAgICAgICB0aGlzLmJsID0gVmVjdG9yLmFkZChwb3NpdGlvbiwgbmV3IFZlY3Rvcih3aWR0aCwgMCkpO1xuICAgICAgICB0aGlzLnRyID0gVmVjdG9yLmFkZChwb3NpdGlvbiwgbmV3IFZlY3Rvcih3aWR0aCwgaGVpZ2h0KSk7XG4gICAgICAgIHRoaXMudGwgPSBWZWN0b3IuYWRkKHBvc2l0aW9uLCBuZXcgVmVjdG9yKDAsIGhlaWdodCkpO1xuICAgICAgICB0aGlzLndpZHRoID0gd2lkdGg7XG4gICAgICAgIHRoaXMuaGVpZ2h0ID0gaGVpZ2h0O1xuICAgICAgICB0aGlzLmFyZWEgPSB3aWR0aCAqIGhlaWdodDtcbiAgICB9XG5cbiAgICBjb3B5KCkge1xuICAgICAgICByZXR1cm4gUmVjdGFuZ2xlLmNvcHkodGhpcyk7XG4gICAgfVxuXG4gICAgc3RhdGljIGNvcHkoKSB7XG4gICAgICAgIHJldHVybiBuZXcgUmVjdGFuZ2xlKHRoaXMucG9zaXRpb24sIHRoaXMud2lkdGgsIHRoaXMuaGVpZ2h0KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZXRlcm1pbmUgaWYgdGhlIHR3byByZWN0YW5nbGVzIGFyZSBpbnRlcnNlY3RpbmcsIGlmIHRoZSBzZWdtZW50cyBvdmVybGFwXG4gICAgICogZWFjaG90aGVyLlxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge2FueX0gcmVjdDEgVGhlIGZpcnN0IHJlY3RhbmdsZVxuICAgICAqIEBwYXJhbSB7YW55fSByZWN0MiBUaGUgc2Vjb25kIHJlY3RhbmdsZVxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSB0d28gcmVjdGFuZ2xlcyBpbnRlcnNlY3RcbiAgICAgKiBAbWVtYmVyb2YgUmVjdGFuZ2xlXG4gICAgICovXG4gICAgc3RhdGljIGludGVyc2VjdHMocmVjdDEsIHJlY3QyKSB7XG4gICAgICAgIHJldHVybiByZWN0MS54IDw9IHJlY3QyLnggKyByZWN0Mi53aWR0aCAmJlxuICAgICAgICAgICAgcmVjdDIueCA8PSByZWN0MS54ICsgcmVjdDEud2lkdGggJiZcbiAgICAgICAgICAgIHJlY3QxLnkgPD0gcmVjdDIueSArIHJlY3QyLmhlaWdodCAmJlxuICAgICAgICAgICAgcmVjdDIueSA8PSByZWN0MS55ICsgcmVjdDEuaGVpZ2h0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERldGVybWluZSBpZiB0aGlzIHJlY3RhbmdsZSBpcyBpbnRlcnNlY3RpbmcgdGhlIG90aGVyIHJlY3RhbmdsZS5cbiAgICAgKiBEZXRlcm1pbmVzIGlmIHRoZSByZWN0YW5nbGVzIHNlZ21lbnRzIG92ZXJsYXAgZWFjaG90aGVyLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBvdGhlciBUaGUgb3RoZXIgcmVjdGFuZ2xlXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdGhlIHJlY3RhbmdsZXMgYXJlIGludGVyc2VjdGluZ1xuICAgICAqIEBtZW1iZXJvZiBSZWN0YW5nbGVcbiAgICAgKi9cbiAgICBpbnRlcnNlY3RzKG90aGVyKSB7XG4gICAgICAgIHJldHVybiBSZWN0YW5nbGUuaW50ZXJzZWN0cyh0aGlzLCBvdGhlcik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGV0ZXJtaW5lIGlmIHR3byByZWN0YW5nbGVzIGNvbGxpZGUgd2l0aCBlYWNob3RoZXIuIFRoaXMgaXMgdHJ1ZSB3aGVuIHR3b1xuICAgICAqIHJlY3RhbmdsZXMgaW50ZXJzZWN0IGVhY2hvdGhlciBvciBvbmUgb2YgdGhlIHJlY3RhbmdsZXMgaXMgY29udGFpbmVkXG4gICAgICogd2l0aW4gYW5vdGhlciByZWN0YW5nbGUuXG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSByZWN0MSBUaGUgZmlyc3QgcmVjdGFuZ2xlXG4gICAgICogQHBhcmFtIHtSZWN0YW5nbGV9IHJlY3QyIFRoZSBzZWNvbmQgcmVjdGFuZ2xlXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdGhlIHR3byByZWN0YW5nbGVzIGNvbGxpZGUgd2l0aCBlYWNob3RoZXJcbiAgICAgKiBAbWVtYmVyb2YgUmVjdGFuZ2xlXG4gICAgICovXG4gICAgc3RhdGljIGNvbGxpZGVzKHJlY3QxLCByZWN0Mikge1xuICAgICAgICByZXR1cm4gcmVjdDEueCA8IHJlY3QyLnggKyByZWN0Mi53aWR0aCAmJlxuICAgICAgICAgICAgcmVjdDEueCArIHJlY3QxLndpZHRoID4gcmVjdDIueCAmJlxuICAgICAgICAgICAgcmVjdDEueSA8IHJlY3QyLnkgKyByZWN0Mi5oZWlnaHQgJiZcbiAgICAgICAgICAgIHJlY3QxLmhlaWdodCArIHJlY3QxLnkgPiByZWN0Mi55XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGV0ZXJtaW5lIGlmIHRoaXMgcmVjdGFuZ2xlIGNvbGxpZGVzIHdpdGggYW5vdGhlciByZWN0YW5nbGUuIFRoaXMgaXMgdHJ1ZVxuICAgICAqIHdoZW4gdHdvIHJlY3RhbmdsZXMgaW50ZXJzZWN0IGVhY2hvdGhlciBvciBvbmUgb2YgdGhlIHJlY3RhbmdsZXMgaXMgXG4gICAgICogY29udGFpbmVkIHdpdGluIGFub3RoZXIgcmVjdGFuZ2xlLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBvdGhlciBUaGUgb3RoZXIgcmVjdGFuZ2xlXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdGhlIHR3byByZWN0YW5nbGVzIGNvbGxpZGUgd2l0aCBlYWNob3RoZXJcbiAgICAgKiBAbWVtYmVyb2YgUmVjdGFuZ2xlXG4gICAgICovXG4gICAgY29sbGlkZXMob3RoZXIpIHtcbiAgICAgICAgcmV0dXJuIFJlY3RhbmdsZS5jb2xsaWRlcyh0aGlzLCBvdGhlcik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGV0ZXJtaW5lIGlmIGEgcG9pbnQgaXMgY29udGFpbmVkIHdpdGhpbiB0aGUgcmVjdGFuZ2xlLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2ZWN0b3IgVGhlIHBvaW50IHRvIGJlIHRlc3RlZFxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSBwb2ludCBpcyBjb250YWluZWQgd2l0aGluIHRoZSByZWN0YW5nbGVcbiAgICAgKiBAbWVtYmVyb2YgUmVjdGFuZ2xlXG4gICAgICovXG4gICAgY29udGFpbnModmVjdG9yKSB7XG4gICAgICAgIHJldHVybiB2ZWN0b3IueCA+IHRoaXMucG9zaXRpb24ueCAmJlxuICAgICAgICAgICAgdmVjdG9yLnggPCB0aGlzLnBvc2l0aW9uLnggKyB0aGlzLndpZHRoICYmXG4gICAgICAgICAgICB2ZWN0b3IueSA+IHRoaXMucG9zaXRpb24ueSAmJlxuICAgICAgICAgICAgdmVjdG9yLnkgPCB0aGlzLnBvc2l0aW9uLnkgKyB0aGlzLmhlaWdodDtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFJlY3RhbmdsZTsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuL1ZlY3RvclwiO1xuaW1wb3J0IFBvbHlnb24gZnJvbSBcIi4vUG9seWdvblwiO1xuXG5jbGFzcyBUcmlhbmdsZSBleHRlbmRzIFBvbHlnb24ge1xuICAgIC8qKiBcbiAgICAgKiBAY2xhc3MgVHJpYW5nbGVcbiAgICAgKiBAZXh0ZW5kcyBQb2x5Z29uXG4gICAgICogXG4gICAgICogQ2xhc3MgdG8gc3RvcmUgYXJyYXkgaW5mb3JtYXRpb24gYWJvdXQgYSByZWN0YW5nbGVcbiAgICAgKiBcbiAgICAgKiBAcHJvcGVydHkge1ZlY3Rvcn0gdmVydGljaWVzIFRoZSB0aHJlZSB2ZXJ0aWNpZXNcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdjEgVGhlIGZpcnN0IHBvc2l0aW9uXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYyIFRoZSBzZWNvbmQgcG9zaXRpb25cbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdjMgVGhlIHRoaXJkIHBvc2l0aW9uXG4gICAgICovXG5cbiAgICBjb25zdHJ1Y3Rvcih2MSwgdjIsIHYzKSB7XG4gICAgICAgIHZhciB2ZXJ0aWNpZXMgPSBbdjEsIHYyLCB2M107XG4gICAgICAgIHN1cGVyKHZlcnRpY2llcyk7XG4gICAgICAgIHRoaXMudjEgPSB2MTtcbiAgICAgICAgdGhpcy52MiA9IHYyO1xuICAgICAgICB0aGlzLnYzID0gdjM7XG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBUcmlhbmdsZTsiLCJjbGFzcyBWZWN0b3Ige1xuICAgIC8qKlxuICAgICAqIEBjbGFzcyBWZWN0b3JcbiAgICAgKlxuICAgICAqIFRoaXMgaXMgYSBiYXNpYyB2ZWN0b3IgY2xhc3MgdGhhdCBpcyB1c2VkIGZvciBnZW9tZXRyeSwgcG9zaXRpb24gaW5mb3JhbXRpb24sXG4gICAgICogbW92ZW1lbnQgaW5mb21hdGlvbiwgYW5kIG1vcmUgY29tcGxleCBzdHJ1Y3R1cmVzLlxuICAgICAqIFRoZSB2ZWN0b3IgY2xhc3MgZm9sbG93cyBhIGltbXV0YWJsZSBwYXJhZGlnbSB3aGVyZSBjaGFuZ2VzIGFyZSBub3QgbWFkZSB0byB0aGVcbiAgICAgKiB2ZWN0b3JzIHRoZW1zZWx2ZXMuIEFueSBjaGFuZ2UgdG8gYSB2ZWN0b3IgaXMgcmV0dXJuZWQgYXMgYSBuZXcgdmVjdG9yIHRoYXRcbiAgICAgKiBtdXN0IGJlIGNhcHR1cmVkLlxuICAgICAqXG4gICAgICogQGRlc2NyaXB0aW9uIFRoaXMgdmVjdG9yIGNsYXNzIHdhcyBjb25zdHJ1Y3RlZCBzbyB0aGF0IGl0IGNhbiBtaXJyb3IgdHdvIHR5cGVzIG9mIGNvbW1vblxuICAgICAqIHBvaW50L3ZlY3RvciB0eXBlIG9iamVjdHMuIFRoaXMgaXMgaGF2aW5nIG9iamVjdCBwcm9wZXJ0aWVzIHN0b3JlZCBhcyBvYmplY3RcbiAgICAgKiBwcm9wZXJ0aWVzIChlZy4gdmVjdG9yLngsIHZlY3Rvci55KSBvciBhcyBsaXN0IHByb3BlcnRpZXMsIFt4LCB5XSB3aGljaCBjYW5cbiAgICAgKiBiZSBhY2Nlc3NlZCBieSB2ZWN0b3JbMF0sIG9yIHZlY3RvclsxXS5cbiAgICAgKlxuICAgICAqIEBzdW1tYXJ5IENyZWF0ZSBhIDJEIFZlY3RvciBvYmplY3RcbiAgICAgKlxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB4IFRoZSB4IHZlY3RvciBjb21wb25lbnRcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0geSBUaGUgeSB2ZWN0b3IgY29tcG9uZW50XG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IDAgVGhlIHggdmVjdG9yIGNvbXBvbmVudFxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSAxIFRoZSB5IHZlY3RvciBjb21wb25lbnRcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7bnVtYmVyfFZlY3Rvcn0geCBUaGUgeCBjb21wb25lbnQgb3IgYW5vdGhlciB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gW3ldIFRoZSB5IGNvbXBvbmVudFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHgsIHkpIHtcbiAgICAgICAgaWYgKHggaW5zdGFuY2VvZiBWZWN0b3IgfHwgKHgueCAmJiB4LnkgJiYgIXkpKSB7XG4gICAgICAgICAgICB0aGlzLl9zZXQoeC54LCB4LnkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fc2V0KHgsIHkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8tLS0tIEFsdGVybmF0ZSBQb2xhciBDb25zdHJ1Y3RvciAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGUgYSB2ZWN0b3IgZnJvbSBwb2xhciBjb29yZGluYXRlc1xuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7bnVtYmVyfSByIFRoZSByYWRpdXMgb2YgdGhlIHZlY3RvclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSB0aGV0YSBUaGUgYW5nbGUgb2YgdGhlIHZlY3RvciBpbiByYWRpYW5zLlxuICAgICAqICBTaG91bGQgYmUgYmV0d2VlbiAwIGFuZCAyKlBJXG4gICAgICogQHJldHVybnMgVGhlIHJlY3Rhbmd1bGFyIHZlY3RvciBwcm9kdWNlZCBmcm9tIHRoZSBwb2xhciBjb29yZGluYXRlc1xuICAgICAqXG4gICAgICogQG1lbWJlck9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBQb2xhcihyLCB0aGV0YSkge1xuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcihyICogTWF0aC5jb3ModGhldGEpLCByICogTWF0aC5zaW4odGhldGEpKTtcbiAgICB9XG5cbiAgICAvLy0tLS0gSGVscGVyIEZ1bmN0aW9ucyAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBJbnRlcm5hbCBIZWxwZXIgRnVuY3Rpb24gZm9yIHNldHRpbmcgdmFyaWFibGUgcHJvcGVydGllc1xuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAcGFyYW0ge251bWJlcn0geCBUaGUgeCBjb21wb25lbnRcbiAgICAgKiBAcGFyYW0ge251bWJlcn0geSBUaGUgeSBjb21wb25lbnRcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgX3NldCh4LCB5KSB7XG4gICAgICAgIHRoaXMuX19wcm90b19fWzBdID0geDtcbiAgICAgICAgdGhpcy5fX3Byb3RvX19bMV0gPSB5O1xuICAgICAgICB0aGlzLnggPSB4O1xuICAgICAgICB0aGlzLnkgPSB5O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdmVjdG9yIGtleTpTeW1ib2wgcmVwcmVzZW50YXRpb24gW3gsIHldXG4gICAgICogQ3VycmVudGx5IGhhcyB0aGUgc2FtZSBiZWhhdmlvciBhcyBsaXN0KClcbiAgICAgKiBAcmV0dXJucyB7U3ltYm9sfSBUaGUgdmVjdG9yIGtleSBlbGVtZW50XG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIGtleSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubGlzdCgpO1xuICAgICAgICAvLyByZXR1cm4gU3ltYm9sKHRoaXMubGlzdCgpKTsgLy8gTm90IGN1cnJlbnRseSB3b3JraW5nIGFzIGEga2V5IHN5bWJvbFxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdmVjdG9yIGluIGxpc3QgZm9ybSBhcyBbeCwgeV1cbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHtudW1iZXJbXX0gTGlzdCByZXByZXNlbnRhdGlvbiBvZiB0aGUgdmVjdG9yIG9mIGxlbmd0aCAyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIGxpc3QoKSB7XG4gICAgICAgIHJldHVybiBbdGhpcy54LCB0aGlzLnldO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIHZlY3RvciBhcyBhIHN0cmluZyBvZiAoeCwgeSlcbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSBzdHJpbmcgcmVwcmVzZW50YXRpb24gb2YgYSB2ZWN0b3IgaW4gKHgsIHkpIGZvcm1cbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgdG9TdHJpbmcoKSB7XG4gICAgICAgIHJldHVybiBgKCR7dGhpcy54fSwgJHt0aGlzLnl9KWA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGEgY29weSBvZiB0aGUgaW5wdXQgdmVjdG9yXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdiB0aGUgdmVjdG9yIHRvIGJlIGNvcHBpZWRcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgdmVjdG9yIGNvcHlcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgY29weSgpIHtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5jb3B5KHRoaXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIGNvcHkgb2YgdGhlIGlucHV0IHZlY3RvclxuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2IHRoZSB2ZWN0b3IgdG8gYmUgY29wcGllZFxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSB2ZWN0b3IgY29weVxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgY29weSh2KSB7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKHYueCwgdi55KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRydWUgaWYgdGhlIHR3byB2ZWN0b3IgcG9zaXRpb25zIGFyZSBlcXVhbFxuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MSBUaGUgZmlyc3QgdmVjdG9yXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYyIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdGhlIHZlY3RvciBwb3NpdGlvbnMgYXJlIGVxdWFsXG4gICAgICogQG1lbWJlck9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBlcXVhbHModjEsIHYyKSB7XG4gICAgICAgIHJldHVybiB2MS54ID09PSB2Mi54ICYmIHYxLnkgPT09IHYyLnk7XG4gICAgfVxuXG4gICAgLy8tLS0tIEJhc2ljIE1hdGggRnVuY3Rpb25zIC0tLS1cblxuICAgIC8qKlxuICAgICAqIEFkZCB0d28gdmVjdG9ycyBlbGVtZW50IHdpc2VcbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYSBUaGUgZmlyc3QgdmVjdG9yXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgdmVjdG9yIHJlc3VsdCBvZiBhZGRpbmcgdGhlIHR3byB2ZWN0b3JzXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBhZGQoYSwgYikge1xuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcihhLnggKyBiLngsIGEueSArIGIueSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQWRkIHRoaXMgdmVjdG9yIHdpdGggYW5vdGhlciB2ZWN0b3IgZWxlbWVudCB3aXNlXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gb3RoZXIgVGhlIG90aGVyIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSB2ZWN0b3IgcmVzdWx0IG9mIGFkZGluZyB0aGUgdHdvIHZlY3RvcnNcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgYWRkKG90aGVyKSB7XG4gICAgICAgIHJldHVybiBWZWN0b3IuYWRkKHRoaXMsIG90aGVyKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTdWJ0cmFjdCB0d28gdmVjdG9ycyBlbGVtZW50IHdpc2VcbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYSBUaGUgZmlyc3QgdmVjdG9yXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCBWZWN0b3JcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgdmVjdG9yIHJlc3VsdCBvZiBzdWJ0cmFjdGluZyB0aGUgdHdvIHZlY3RvcnNcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIHN1YnRyYWN0KGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoYS54IC0gYi54LCBhLnkgLSBiLnkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFN1YnRyYWN0IHRoaXMgdmVjdG9yIHdpdGggYW5vdGhlciB2ZWN0b3IgZWxlbWVudCB3aXNlXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gb3RoZXIgVGhlIG90aGVyIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSB2ZWN0b3IgcmVzdWx0IG9mIHN1YnRyYWN0aW5nIHRoZSB0d28gdmVjdG9yc1xuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdWJ0cmFjdChvdGhlcikge1xuICAgICAgICByZXR1cm4gVmVjdG9yLnN1YnRyYWN0KHRoaXMsIG90aGVyKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBNdWx0aXBseSB0aGUgdmVjdG9yIGJ5IGEgc2NhbGFyIHZhbHVlXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gc2NhbGFyIFRoZSBudW1iZXIgdG8gbXVsdGlwbHkgdGhlIHZlY3RvciBieVxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSByZXN1bHQgb2YgbXVsdGlwbHlpbmcgdGhlIHZlY3RvciBieSBhIHNjYWxhclxuICAgICAqICBlbGVtZW50IHdpc2VcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgbXVsdGlwbHkoc2NhbGFyKSB7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKHRoaXMueCAqIHNjYWxhciwgdGhpcy55ICogc2NhbGFyKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEaXZpZGUgdGhlIHZlY3RvciBieSBhIHNjYWxhciB2YWx1ZVxuICAgICAqXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHNjYWxhclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSByZXN1bHQgb2YgbXVsdGlwbHlpbmcgdGhlIHZlY3RvciBieSBhIHNjYWxhclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBkaXZpZGUoc2NhbGFyKSB7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKHRoaXMueCAvIHNjYWxhciwgdGhpcy55IC8gc2NhbGFyKTtcbiAgICB9XG5cbiAgICAvLy0tLS0gQWR2YW5jZWQgVmVjdG9yIEZ1bmN0aW9ucyAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIG1hZ25pdHVkZSBvZiB0aGUgdmVjdG9yXG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBUaGUgbWFnbml0dXJlIG9mIHRoZSB2ZWN0b3JcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgbWFnbml0dWRlKCkge1xuICAgICAgICByZXR1cm4gTWF0aC5zcXJ0KHRoaXMueCAqIHRoaXMueCArIHRoaXMueSAqIHRoaXMueSk7XG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSB1bml0IHZlY3RvclxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgbm9ybWFsIHZlY3RvciBvZiB0aGUgY3VycmVudCB2ZWN0b3IuXG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBBIHZlY3RvciB0aGF0IGlzIHRoZSBub3JtYWwgY29tcGVuZW50IG9mIHRoZSB2ZWN0b3JcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgbm9ybWFsaXplKCkge1xuICAgICAgICByZXR1cm4gVmVjdG9yLmRpdmlkZSh0aGlzLm1hZ25pdHVkZSgpKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIGdldCB0aGUgY3VycmVudCB2ZWN0b3Igcm90YXRlZCBieSBhIGNlcnRhaW4gYW1tb3VudFxuICAgICAqXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHJhZGlhbnNcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgdmVjdG9yIHRoYXQgcmVzdWx0cyBmcm9tIHJvdGF0aW5nIHRoZSBjdXJyZW50XG4gICAgICogIHZlY3RvciBieSBhIHBhcnRpY3VsYXIgYW1tb3VudFxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICByb3RhdGUocmFkaWFucykge1xuICAgICAgICBjb25zdCBjID0gTWF0aC5jb3MocmFkaWFucyk7XG4gICAgICAgIGNvbnN0IHMgPSBNYXRoLnNpbihyYWRpYW5zKTtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoYyAqIHRoaXMueCAtIHMgKiB0aGlzLnksIHMgKiB0aGlzLnggKyBjICogdGhpcy55KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIGRvdCBwcm9kdWN0IG9mIHR3byB2ZWN0b3JzXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHJldHVybnMge251bWJlcn0gVGhlIGRvdCBwcm9kdWN0IG9mIHRoZSB0d28gdmVjdG9yc1xuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZG90KGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIGEueCAqIGIueCArIGEueSAqIGIueTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIGF2ZXJhZ2UgbG9jYXRpb24gYmV0d2VlbiBzZXZlcmFsIHZlY3RvcnNcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7VmVjdG9yW119IHZlY3RvcnMgVGhlIGxpc3Qgb2YgdmVjdG9ycyB0byBhdmVyYWdlXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBhdmcodmVjdG9ycykge1xuICAgICAgICBsZXQgYXZlcmFnZSA9IFZlY3Rvci56ZXJvKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCB2ZWN0b3Igb2YgdmVjdG9ycykge1xuICAgICAgICAgICAgYXZlcmFnZSA9IFZlY3Rvci5hZGQoYXZlcmFnZSwgdmVjdG9yKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYXZlcmFnZS5kaXZpZGUodmVjdG9ycy5sZW5ndGgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgZG90IHByb2R1Y3Qgb2YgdGhpcyB2ZWN0b3IgYW5kIGFub3RoZXIgdmVjdG9yXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gb3RoZXIgVGhlIG90aGVyIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFRoZSBkb3QgcHJvZHVjdCBvZiB0aGlzIGFuZCB0aGUgb3RoZXIgdmVjdG9yXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIGRvdChvdGhlcikge1xuICAgICAgICByZXR1cm4gVmVjdG9yLmRvdCh0aGlzLCBvdGhlcik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBjcm9zcyBwcm9kdWN0IG9mIHR3byB2ZWN0b3JzXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHJldHVybnMge251bWJlcn0gVGhlIGNyb3NzIHByb2R1Y3Qgb2YgdGhlIHR3byB2ZWN0b3JzXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBjcm9zcyhhLCBiKSB7XG4gICAgICAgIHJldHVybiBhLnggKiBiLnkgLSBhLnkgKiBiLng7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBjcm9zcyBwcm9kdWN0IG9mIHRoaXMgYW5kIHRoZSBvdGhlciB2ZWN0b3JcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBvdGhlciBUaGUgb3RoZXIgdmVjdG9yXG4gICAgICogQHJldHVybnMge251bWJlcn0gVGhlIGNyb3NzIHByb2R1Y3Qgb2YgdGhpcyBhbmQgdGhlIG90aGVyIHZlY3RvclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBjcm9zcyhvdGhlcikge1xuICAgICAgICByZXR1cm4gVmVjdG9yLmNyb3NzKHRoaXMsIG90aGVyKTtcbiAgICB9XG5cbiAgICAvLy0tLS0gUHVyZWx5IFN0YXRpYyBWZWN0b3IgRnVuY3Rpb25zIC0tLS1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgbWlkcG9pbnQgYmV0d2VlbiB0d28gdmVjdG9yc1xuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBhIFRoZSBmaXJzdCB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvclxuICAgICAqIEByZXR1cm5zIFRoZSBtaWRwb2ludCBvZiB0d28gdmVjdG9yc1xuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgbWlkcG9pbnQoYSwgYikge1xuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcigoYS54ICsgYi54KSAvIDIsIChhLnkgKyBiLnkpIC8gMik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBwcm9qZWN0aW9uIG9mIHZlY3RvciBhIG9udG8gdmVjdG9yIGJcbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYSBUaGUgZmlyc3QgdmVjdG9yXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyBUaGUgcHJvamVjdGlvbiB2ZWN0b3Igb2YgYSBvbnRvIGJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICpcbiAgICAgKiBAdG9kbyBBZGQgYXNzZXJ0aW9uIGZvciBub24temVybyBsZW5ndGggYiB2ZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgcHJvaihhLCBiKSB7XG4gICAgICAgIHJldHVybiBiLm11bHRpcGx5KFZlY3Rvci5kb3QoYSwgYikgLyBNYXRoLnBvdyhiLm1hZ25pdHVkZSgpLCAyKSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBhbmdsZSBiZXR3ZWVuIHR3byB2ZWN0b3JzXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZyaXN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHJldHVybnMgVGhlIGFuZ2xlIGJldHdlZW4gdmVjdG9yIGEgYW5kIHZlY3RvciBiXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBhbmdsZShhLCBiKSB7XG4gICAgICAgIHJldHVybiBNYXRoLmFjb3MoVmVjdG9yLmRvdChhLCBiKSAvIChhLm1hZ25pdHVkZSgpICogYi5tYWduaXR1ZGUoKSkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgZXVjbGlkZWFuIGRpc3RhbmNlIGJldHdlZW4gdHdvIHZlY3RvcnNcbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYSBUaGUgZmlyc3QgdmVjdG9yXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyBUaGUgZXVjbGlkZWFuIGRpc3RhbmNlIGJldHdlZW4gYSBhbmQgYlxuICAgICAqIEBzZWUge0BsaW5rIGRpc3QyfVxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZGlzdGFuY2UoYSwgYikge1xuICAgICAgICByZXR1cm4gTWF0aC5zcXJ0KFZlY3Rvci5kaXN0MihhLCBiKSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBldWNsaWRlYW4gZGlzdG5hY2Ugc3F1YXJlZCBiZXR3ZWVuIHR3byB2ZWN0b3JzLlxuICAgICAqIFRoaXMgaXMgdXNlZCBhcyBhIGhlbHBlciBmb3IgdGhlIGRpc3RuYWNlIGZ1bmN0aW9uIGJ1dCBjYW4gYmUgdXNlZFxuICAgICAqIHRvIHNhdmUgb24gc3BlZWQgYnkgbm90IGRvaW5nIHRoZSBzcXVhcmUgcm9vdCBvcGVyYXRpb24uXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHJldHVybnMgVGhlIGV1Y2xpZGVhbiBkaXN0YW5jZSBzcXVhcmVkIGJldHdlZW4gdmVjdG9yIGEgYW5kIHZlY3RvciBiXG4gICAgICogQHNlZSB7QGxpbmsgZGlzdG5hY2V9XG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBkaXN0MihhLCBiKSB7XG4gICAgICAgIGNvbnN0IGR4ID0gYS54IC0gYi54O1xuICAgICAgICBjb25zdCBkeSA9IGEueSAtIGIueTtcbiAgICAgICAgcmV0dXJuIGR4ICogZHggKyBkeSAqIGR5O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgc2hvcnRlc3QgZGlzdGFuY2UgYmV0d2VlbiB0aGUgcG9pbnQgcCBhbmQgdGhlIGxpbmVcbiAgICAgKiBzZWdtZW50IHYgdG8gdy5cbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gcCBUaGUgdmVjdG9yIHBvaW50XG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYgVGhlIGZpcnN0IGxpbmUgc2VnbWVudCBlbmRwb2ludFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB3IFRoZSBzZWNvbmQgbGluZSBzZWdtZW50IGVuZHBvaW50XG4gICAgICogQHJldHVybnMgVGhlIHNob3J0ZXN0IGV1Y2xpZGVhbiBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50XG4gICAgICogQHNlZSB7QGxpbmsgZGlzdFRvU2VnMn1cbiAgICAgKiBAc2VlIHtAbGluayBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzg0OTIxMS9zaG9ydGVzdC1kaXN0YW5jZS1iZXR3ZWVuLWEtcG9pbnQtYW5kLWEtbGluZS1zZWdtZW50fVxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZGlzdFRvU2VnKHAsIHYsIHcpIHtcbiAgICAgICAgcmV0dXJuIE1hdGguc3FydChWZWN0b3IuZGlzdFRvU2VnMihwLCB2LCB3KSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBzaG9ydGVzdCBkaXN0YW5jZSBzcXVhcmVkIGJldHdlZW4gdGhlIHBvaW50IHAgYW5kIHRoZSBsaW5lXG4gICAgICogc2VnbWVudCB2IHRvIHcuXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHAgVGhlIHZlY3RvciBwb2ludFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2IFRoZSBmaXJzdCBsaW5lIHNlZ21lbnQgZW5kcG9pbnRcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdyBUaGUgc2Vjb25kIGxpbmUgc2VnbWVudCBlbmRwb2ludFxuICAgICAqIEByZXR1cm5zIFRoZSBzaG9ydGVzdCBldWNsaWRlYW4gZGlzdGFuY2Ugc3F1YXJlZCBiZXR3ZWVuIHBvaW50XG4gICAgICogQHNlZSB7QGxpbmsgZGlzdFRvU2VnfVxuICAgICAqIEBzZWUge0BsaW5rIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvODQ5MjExL3Nob3J0ZXN0LWRpc3RhbmNlLWJldHdlZW4tYS1wb2ludC1hbmQtYS1saW5lLXNlZ21lbnR9XG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBkaXN0VG9TZWdTcXVhcmVkKHAsIHYsIHcpIHtcbiAgICAgICAgY29uc3QgbCA9IFZlY3Rvci5kaXN0Mih2LCB3KTtcbiAgICAgICAgaWYgKGwgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiBWZWN0b3IuZGlzdDIocCwgdik7XG4gICAgICAgIH1cbiAgICAgICAgbGV0IHQgPSAoKHAueCAtIHYueCkgKiAody54IC0gdi54KSArIChwLnkgLSB2LnkpICogKHcueSAtIHYueSkpIC8gbDtcbiAgICAgICAgdCA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEsIHQpKTtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5kaXN0MihcbiAgICAgICAgICAgIHAsXG4gICAgICAgICAgICBuZXcgVmVjdG9yKHYueCArIHQgKiAody54IC0gdi54KSwgdi55ICsgdCAqICh3LnkgLSB2LnkpKVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdHdvIG5vcm1hbCB2ZWN0b3JzIHRoYXQgYXJlIHBlcnBlbmRpY3VsYXIgdG8gdGhlIGN1cnJlbnQgdmVjdG9yXG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSB0d28gbm9ybWFsIHZlY3RvcnMgdGhhdCBhcmUgcGVycGVuZGljdWxhclxuICAgICAqICB0byB0aGUgdmVjdG9yLiBUaGUgZmlyc3QgdmVjdG9yIGlzIHRoZSBub3JtYWwgdmVjdG9yIHRoYXQgaXMgKzkwIGRlZyBvclxuICAgICAqICArUEkvMiByYWQuIFRoZSBzZWNvbmQgdmVjdG9yIGlzIHRoZSBub3JhbWwgdmVjdG9yIHRoYXQgaXMgLTkwIGRlZyBvclxuICAgICAqICAtUEkvMiByYWQuXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHBlcnBlbmRpY3VsYXJzKCkge1xuICAgICAgICBjb25zdCBwbHVzOTAgPSBuZXcgVmVjdG9yKC10aGlzLnksIHRoaXMueCkubm9ybWFsaXplKCk7XG4gICAgICAgIGNvbnN0IG1pbnVzOTAgPSBuZXcgVmVjdG9yKHRoaXMueSwgLXRoaXMueCkubm9ybWFsaXplKCk7XG4gICAgICAgIHJldHVybiBbcGx1czkwLCBtaW51czkwXTtcbiAgICB9XG5cbiAgICAvLy0tLS0gU3RhbmRhcmQgU3RhdGljIFZlY3RvciBPYmplY3RzIC0tLS1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHZlY3RvciBvZiBubyBtYWduaXR1ZGUgYW5kIG5vIGRpcmVjdGlvblxuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBmdW5jdGlvblxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFZlY3RvciBvZiBtYWduaXR1ZGUgemVyb1xuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgemVybygpIHtcbiAgICAgICAgXCJ1c2Ugc3RyaWN0XCI7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKDAsIDApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdW5pdCB2ZWN0b3IgcG9pbnRpbmcgaW4gdGhlIHBvc2l0aXZlIHkgZGlyZWN0aW9uXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQGZ1bmN0aW9uXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVW5pdCB2ZWN0b3IgcG9pbnRpbmcgdXBcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIHVwKCkge1xuICAgICAgICBcInVzZSBzdHJpY3RcIjtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoMCwgMSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSB1bml0IHZlY3RvciBwb2ludGluZyBpbiB0aGUgbmVnYXRpdmUgeSBkaXJlY3Rpb25cbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAZnVuY3Rpb25cbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBVbml0IHZlY3RvciBwb2ludGluZyBkb3duXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBkb3duKCkge1xuICAgICAgICBcInVzZSBzdHJpY3RcIjtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoMCwgLTEpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdW5pdCB2ZWN0b3IgcG9pbnRpbmcgaW4gdGhlIG5lZ2F0aXZlIHggZGlyZWN0aW9uXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQGZ1bmN0aW9uXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVW5pdCB2ZWN0b3IgcG9pbnRpbmcgcmlnaHRcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIGxlZnQoKSB7XG4gICAgICAgIFwidXNlIHN0cmljdFwiO1xuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcigtMSwgMCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSB1bml0IHZlY3RvciBwb2ludGluZyBpbiB0aGUgcG9zaXRpdmUgeCBkaXJlY3Rpb25cbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAZnVuY3Rpb25cbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBVbml0IHZlY3RvciBwb2ludGluZyByaWdodFxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgcmlnaHQoKSB7XG4gICAgICAgIFwidXNlIHN0cmljdFwiO1xuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcigxLCAwKTtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFZlY3RvcjsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcbmltcG9ydCBQb2x5Z29uIGZyb20gXCIuLi9nZW9tZXRyeS9Qb2x5Z29uXCI7XG5cbmNsYXNzIENlbnRlciBleHRlbmRzIFZlY3RvciB7XG4gICAgLyoqXG4gICAgICogQSBjZW50ZXIgY29ubmVjdGlvbiBhbmQgbG9jYXRpb24gaW4gYSBncmFwaCBvYmplY3RcbiAgICAgKiBcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0gaWQgVGhlIGlkIG9mIHRoZSBjZW50ZXIgaW4gdGhlIGdyYXBoIG9iamVjdFxuICAgICAqIEBwcm9wZXJ0eSB7UG9seWdvbn0gbmVpZ2hib3JzIFNldCBvZiBhZGphY2VudCBwb2x5Z29uIGNlbnRlcnNcbiAgICAgKiBAcHJvcGVydHkge0xpbmVbXX0gYm9yZGVycyBTZXQgb2YgYm9yZGVyaW5nIGVkZ2VzXG4gICAgICogQHByb3BlcnR5IHtQb2x5Z29ufSBjb3JuZXJzIFNldCBvZiBwb2x5Z29uIGNvcm5lcnNcbiAgICAgKiBAcHJvcGVydHkge2Jvb2xlYW59IGJvcmRlciBJcyB0aGlzIHBvbHlnb24gdG91Y2hpbmcgdGhlIGJvcmRlciBlZGdlXG4gICAgICogQHByb3BlcnR5IHtvYmplY3R9IGRhdGEgVGhlIGRhdGEgc3RvcmVkIGJ5IHRoZSBjZW50ZXIgb2JqZWN0LiBUaGlzIGlzIHRoZVxuICAgICAqICBkYXRhIHRoYXQgaXMgdG8gYmUgY2hhbmdlZCBieSB0aGUgdXNlclxuICAgICAqIEBwcm9wZXJ0eSB7Q2VudGVyfSBwYXJlbnQgVGhlIHBhcmVudCBvYmplY3QgdG8gdGhlIGN1cnJlbnQgb2JqZWN0LiBUaGVcbiAgICAgKiAgZGVmYXVsdCBpcyBudWxsLCB0aGVyZSBpcyBubyBwYXJlbnQuXG4gICAgICogQHByb3BlcnR5IHtDZW50ZXJbXX0gY2hpbGRyZW4gVGhlIGNoaWxkcmVuIG9iamVjdHMgdG8gdGhlIGN1cnJlbnQgb2JqZWN0LlxuICAgICAqICBUaGUgZGVmYXVsdCBpcyBhbiBlbXB0eSBsaXN0XG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHBvc2l0aW9uIFRoZSBsb2NhdGlvbiBvZiB0aGUgQ2VudGVyIG9iamVjdFxuICAgICAqIFxuICAgICAqIEBjbGFzcyBDZW50ZXJcbiAgICAgKiBAZXh0ZW5kcyB7VmVjdG9yfVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHBvc2l0aW9uLCBwYXJlbnQgPSBudWxsLCBjaGlsZHJlbiA9IG51bGwpIHtcbiAgICAgICAgc3VwZXIocG9zaXRpb24pO1xuXG4gICAgICAgIC8vIERpYWdyYW0gUHJvcGVydGllc1xuICAgICAgICB0aGlzLmlkID0gLTE7XG4gICAgICAgIHRoaXMubmVpZ2hib3JzID0gW107IC8vIENlbnRlcnNcbiAgICAgICAgdGhpcy5ib3JkZXJzID0gW107IC8vIEVkZ2VzXG4gICAgICAgIHRoaXMuY29ybmVycyA9IFtdO1xuICAgICAgICB0aGlzLmJvcmRlciA9IGZhbHNlO1xuICAgICAgICB0aGlzLnRpbGUgPSBudWxsO1xuXG4gICAgICAgIC8vIEhpZ2hlciBMZXZlbCBQcm9wZXJ0aWVzXG4gICAgICAgIHRoaXMuZGF0YSA9IHt9O1xuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgQ2VudGVyOyIsImltcG9ydCBWZWN0b3IgZnJvbSBcIi4uL2dlb21ldHJ5L1ZlY3RvclwiO1xuaW1wb3J0IFBvbHlnb24gZnJvbSBcIi4uL2dlb21ldHJ5L1BvbHlnb25cIjtcblxuY2xhc3MgQ29ybmVyIGV4dGVuZHMgVmVjdG9yIHtcbiAgICAvKipcbiAgICAgKiBBIGNvcm5lciBjb25uZWN0aW9uIGFuZCBsb2NhdGlvbiBpbiBhIGdyYXBoIG9iamVjdFxuICAgICAqIFxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBpZCBUaGUgaWQgb2YgdGhlIGNvcm5lciBpbiB0aGUgZ3JhcGggb2JqZWN0XG4gICAgICogQHByb3BlcnR5IHtQb2x5Z29ufSB0b3VjaGVzIFNldCBvZiBwb2x5Z29uIGNlbnRlcnMgdG91Y2hpbmcgdGhpcyBvYmplY3l0XG4gICAgICogQHByb3BlcnR5IHtMaW5lW119IHByb3RydWRlcyBTZXQgb2YgZWRnZXMgdGhhdCBhcmUgY29ubmVjdGVkIHRvIHRoaXMgY29ybmVyXG4gICAgICogQHByb3BlcnR5IHtQb2x5Z29ufSBhZGphY2VudCBTZXQgb2YgY29ybmVycyB0aGF0IGNvbm5lY3RlZCB0byB0aGlzIGNvcm5lclxuICAgICAqIFxuICAgICAqIEBjbGFzcyBDb3JuZXJcbiAgICAgKiBAZXh0ZW5kcyB7VmVjdG9yfVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHBvc2l0aW9uKSB7XG4gICAgICAgIHN1cGVyKHBvc2l0aW9uKTtcbiAgICAgICAgdGhpcy5pZCA9IC0xO1xuICAgICAgICB0aGlzLnRvdWNoZXMgPSBbXTsgLy8gQ2VudGVyc1xuICAgICAgICB0aGlzLnByb3RydWRlcyA9IFtdOyAvLyBFZGdlc1xuICAgICAgICB0aGlzLmFkamFjZW50ID0gW107IC8vIENvcm5lcnNcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IENvcm5lcjsiLCIvLyBGaW5kIGEgd2F5IHRvIGltcGxlbWVudCBrZHRyZWVzIHRvIHNwZWVkIHVwIHRpbGUgc2VsZWN0aW9uIGZyb20gYSBwb2ludFxuLy8gaW1wb3J0IEtEVHJlZSBmcm9tIFwic3RhdGljLWtkdHJlZVwiO1xuXG5pbXBvcnQgR3JhcGggZnJvbSBcIi4vR3JhcGhcIjtcbmltcG9ydCBUaWxlIGZyb20gXCIuL1RpbGVcIjtcbmltcG9ydCBWZWN0b3IgZnJvbSBcIi4uL2dlb21ldHJ5L1ZlY3RvclwiO1xuXG5jbGFzcyBEaWFncmFtIGV4dGVuZHMgR3JhcGgge1xuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhbiBpbnN0YW5jZSBvZiBEaWFncmFtLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7YW55fSBwb2ludHMgXG4gICAgICogQHBhcmFtIHthbnl9IGJib3ggXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IFtyZWxheGF0aW9ucz0wXSBcbiAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtpbXByb3ZlQ29ybmVycz1mYWxzZV0gXG4gICAgICogXG4gICAgICogQGNsYXNzIERpYWdyYW1cbiAgICAgKiBAZXh0ZW5kcyBHcmFwaFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHBvaW50cywgYmJveCwgcmVsYXhhdGlvbnMgPSAwLCBpbXByb3ZlQ29ybmVycyA9IGZhbHNlKSB7XG4gICAgICAgIHN1cGVyKHBvaW50cywgYmJveCwgcmVsYXhhdGlvbnMsIGltcHJvdmVDb3JuZXJzKTtcblxuICAgICAgICB0aGlzLnRpbGVzID0gW107XG4gICAgICAgIHRoaXMuX2NyZWF0ZVRpbGVzKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogXG4gICAgICogXG4gICAgICogQG1lbWJlcm9mIERpYWdyYW1cbiAgICAgKi9cbiAgICBfY3JlYXRlVGlsZXMoKSB7XG4gICAgICAgIGZvciAobGV0IGNlbnRlciBvZiB0aGlzLmNlbnRlcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IHRpbGUgPSBuZXcgVGlsZShjZW50ZXIsIGNlbnRlci5jb3JuZXJzLCBjZW50ZXIuYm9yZGVycyk7XG4gICAgICAgICAgICBjZW50ZXIudGlsZSA9IHRpbGU7XG4gICAgICAgICAgICB0aGlzLnRpbGVzLnB1c2godGlsZSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb25uZWN0IHRvZ2V0aGVyIHRoZSB0aWxlIG9iamVjdHMgYXMgbmVpZ2hib3JzXG4gICAgICAgIGZvciAobGV0IHRpbGUgb2YgdGhpcy50aWxlcykge1xuICAgICAgICAgICAgdGlsZS5uZWlnaGJvcnMgPSB0aWxlLmNlbnRlci5uZWlnaGJvcnMubWFwKFxuICAgICAgICAgICAgICAgIGNlbnRlciA9PiBjZW50ZXIudGlsZVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRoaXMgZnVuY3Rpb24gaXMgdXNlZCB0byBjYWxsIGNlbGx1bGFyIGF1dG9taXRhIG9uIHRoZSBncmFwaCBvYmplY3QuXG4gICAgICogVGhlIHJ1bGVzZXQgZnVuY3Rpb24gc2hvdWxkIGZvbGxvdyB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXMgc28gdGhhdFxuICAgICAqIHRoZSBhdXRvbWF0aW9uIGNhbiBydW4gcHJvcGVybHkuIFNlZSB0aGUgZXhhbXBsZSBmb3IgdGhlIGRldGFpbHNcbiAgICAgKiBcbiAgICAgKiBAc3VtbWFyeSBSdW4gYSBnZW5lcmF0aW9uIG9mIGNlbGx1bGFyIGF1dG9tYXRpb24gYWNjb3JkaW5nIHRvIGEgdXNlclxuICAgICAqICBzcGVjaWZpZWQgcnVsZSBzZXRcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSBydWxlc2V0IFRoZVxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogXG4gICAgICogdmFyIGdhbWVPZkxpZmUgPSBmdW5jdGlvbihjZW50ZXIpIHtcbiAgICAgKiAgIHZhciBuID0gY2VudGVyLm5laWdoYm9ycy5sZW5ndGg7XG4gICAgICogICByZXR1cm4geyBcbiAgICAgKiAgICAgYWxpdmU6IGNlbnRlci5kYXRhLmFsaXZlICYmIChuID09PSAyIHx8IG4gPT09IDMpIHx8XG4gICAgICogICAgICAgICAgICFjZW50ZXIuZGF0YS5hbGl2ZSAmJiBuID09PSAzXG4gICAgICogICB9O1xuICAgICAqIH1cbiAgICAgKiBcbiAgICAgKiBAdG9kbyBGaW5kIGEgTmV3IE5hbWVcbiAgICAgKiBAbWVtYmVyT2YgRGlhZ3JhbVxuICAgICAqL1xuICAgIF9nZW5lcmF0ZShydWxlc2V0KSB7XG4gICAgICAgIC8vIFJ1biBjZWxsdWxhciBhdXRvbWl0YVxuICAgICAgICBmb3IgKGxldCBjZW50ZXIgb2YgdGhpcy5jZW50ZXJzKSB7XG4gICAgICAgICAgICBjZW50ZXIuX2RhdGEgPSBydWxlc2V0KGNlbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVcGRhdGUgYXV0b21pdGEgYWN0aW9uc1xuICAgICAgICBmb3IgKGxldCBjZW50ZXIgb2YgdGhpcy5jZW50ZXJzKSB7XG4gICAgICAgICAgICAvLyBVcGRhdGUgb25seSB0aGUgbmV3IGRhdGEgdGhhdCBoYXMgY2hhbmdlZFxuICAgICAgICAgICAgZm9yIChsZXQga2V5IGluIGNlbnRlci5fZGF0YSkge1xuICAgICAgICAgICAgICAgIGlmIChjZW50ZXIuX2RhdGEuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBjZW50ZXIuZGF0YVtrZXldID0gY2VudGVyLl9kYXRhW2tleV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZGVsZXRlIGNlbnRlci5fZGF0YTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGluaXRpYWxpemUocnVsZXNldCkge1xuICAgICAgICB0aGlzLl9nZW5lcmF0ZShydWxlc2V0KTtcbiAgICB9XG5cbiAgICBpdGVyYXRlKHJ1bGVzZXQpIHtcbiAgICAgICAgdGhpcy5fZ2VuZXJhdGUocnVsZXNldCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSB0aWxlIHRoYXQgY29udGFpbnMgdGhlIHNwZWNpZmljIGxvY2F0aW9uXG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHBvc2l0aW9uIFRoZSBwb3NpdGlvbiB3aGljaCBjb250YWlucyB0aGUgZGVzaXJlZCB0aWxlIFxuICAgICAqIFxuICAgICAqIEByZXR1cm4ge1RpbGV9IFRoZSB0aWxlIGF0IHRoZSBwb3NpdGlvblxuICAgICAqIFxuICAgICAqIEBtZW1iZXJPZiBEaWFncmFtXG4gICAgICovXG4gICAgZ2V0VGlsZShwb3NpdGlvbikge1xuICAgICAgICBpZiAoIXRoaXMuYmJveC5jb250YWlucyhwb3NpdGlvbikpIHtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IG1pbkRpc3QgPSBJbmZpbml0eTtcbiAgICAgICAgbGV0IGNsb3Nlc3QgPSB0aGlzLnRpbGVzWzBdO1xuICAgICAgICBsZXQgZGlzdDtcblxuICAgICAgICBmb3IgKGNvbnN0IHRpbGUgb2YgdGhpcy50aWxlcykge1xuICAgICAgICAgICAgZGlzdCA9IFZlY3Rvci5kaXN0Mih0aWxlLmNlbnRlciwgcG9zaXRpb24pO1xuXG4gICAgICAgICAgICBpZiAoZGlzdCA8IG1pbkRpc3QpIHtcbiAgICAgICAgICAgICAgICBtaW5EaXN0ID0gZGlzdDtcbiAgICAgICAgICAgICAgICBjbG9zZXN0ID0gdGlsZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjbG9zZXN0O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBwYXRoIGJldHdlZW4gdHdvIHRpbGVzIG9uIHRoZSBkaWFncmFtLiBUaGlzIHBhdGggaW5jbHVkZXMgYm90aFxuICAgICAqIHRoZSBzdGFydCB0aWxlIGFuZCB0aGUgZW5kIHRpbGUgb24gdGhlIGdyYXBoLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VGlsZX0gc3RhcnQgVGhlIHN0YXJ0aW5nIHRpbGUgdG8gc2VhcmNoIGZyb21cbiAgICAgKiBAcGFyYW0ge1RpbGV9IGVuZCBUaGUgZW5kaW5nIHRpbGUgdG8gc2VhcmNoIHRvXG4gICAgICogQHBhcmFtIHtOdW1iZXJ9IFtJdGVyYXRpb25zPTBdXG4gICAgICogQHJldHVybiB7VGlsZVtdfSBBIHJlc3VsdGluZyBwYXRoIGJldHdlZW4gdHdvIHRpbGVzXG4gICAgICogIFJldHVybmVkIG9mIHRoZSBmb3JtIFtzdGFydCwgLi4uLCBlbmRdXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIERpYWdyYW1cbiAgICAgKi9cbiAgICBnZXRQYXRoKHN0YXJ0LCBlbmQsIGl0ZXJhdGlvbnMgPSAxMDApIHtcbiAgICAgICAgbGV0IGN1clRpbGUgPSBzdGFydDtcbiAgICAgICAgbGV0IHBhdGggPSBbc3RhcnRdO1xuICAgICAgICBsZXQgZGlyZWN0aW9uO1xuXG4gICAgICAgIHdoaWxlICghVmVjdG9yLmVxdWFscyhjdXJUaWxlLmNlbnRlciwgZW5kLmNlbnRlcikpIHtcbiAgICAgICAgICAgIGRpcmVjdGlvbiA9IFZlY3Rvci5zdWJ0cmFjdChlbmQuY2VudGVyLCBjdXJUaWxlLmNlbnRlcik7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiQ3VycmVudCAgIFwiICsgY3VyVGlsZS5jZW50ZXIueCArIFwiIFwiICsgY3VyVGlsZS5jZW50ZXIueSk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIkVuZCAgICAgICBcIiArIGVuZC5jZW50ZXIueCArIFwiIFwiICsgZW5kLmNlbnRlci55KTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiRGlyZWN0aW9uIFwiICsgZGlyZWN0aW9uLnggKyBcIiBcIiArIGRpcmVjdGlvbi55KVxuICAgICAgICAgICAgY3VyVGlsZSA9IGN1clRpbGUuZ2V0TmVpZ2hib3IoZGlyZWN0aW9uKTtcbiAgICAgICAgICAgIHBhdGgucHVzaChjdXJUaWxlKTtcblxuICAgICAgICAgICAgaWYgKGl0ZXJhdGlvbnMgPCAwKSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpdGVyYXRpb25zLS07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcGF0aDtcbiAgICB9XG59XG5cbi8vIG5laWdoYm9yVGlsZXMgPSBbXTtcbi8vICAgICAgICAgICAgIHZhciBuZWlnaGJvciA9IHNlbGVjdGVkVGlsZTtcbi8vICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbnVtTmVpZ2hib3JzOyBpKyspIHtcbi8vICAgICAgICAgICAgICAgICBuZWlnaGJvciA9IG5laWdoYm9yLmdldE5laWdoYm9yKFxuLy8gICAgICAgICAgICAgICAgICAgICBWZWN0b3Iuc3VidHJhY3QobW91c2VQb3MsIG5laWdoYm9yLmNlbnRlcikpO1xuLy8gICAgICAgICAgICAgICAgIGlmIChuZWlnaGJvcikge1xuLy8gICAgICAgICAgICAgICAgICAgICBuZWlnaGJvclRpbGVzLnB1c2gobmVpZ2hib3IpO1xuLy8gICAgICAgICAgICAgICAgIH1cbi8vICAgICAgICAgICAgIH1cblxuZXhwb3J0IGRlZmF1bHQgRGlhZ3JhbTsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcbmltcG9ydCBMaW5lIGZyb20gXCIuLi9nZW9tZXRyeS9MaW5lXCI7XG5cbmNsYXNzIEVkZ2UgZXh0ZW5kcyBMaW5lIHtcbiAgICAvKipcbiAgICAgKiBFZGdlIGNvbm5lY3Rpb25zIGJldHdlZW4gY2VudGVycyBhbmQgY29ybmVycyBpbiB0aGUgVm9yb25vaS9EZWxhdW5heVxuICAgICAqIGdyYXBoLlxuICAgICAqIFxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBpZCBUaGUgaWQgb2YgdGhlIGVkZ2UgaW4gdGhlIGdyYXBoIG9iamVjdFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSBkMCBUaGUgZmlyc3QgcG9seWdvbiBjZW50ZXIgb2YgdGhlIGRlbGF1bmF5IGdyYXBoXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IGQxIFRoZSBzZWNvbmQgcG9seWdvbiBjZW50ZXIgb2YgdGhlIGRlbGF1bmF5IGdyYXBoXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IHYwIFRoZSBmaXJzdCBjb3JuZXIgb2JqZWN0IG9mIHRoZSB2b3Jvbm9pIGdyYXBoXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IHYxIFRoZSBzZWNvbmQgY29ybmVyIG9iamVjdCBvZiB0aGUgdm9yb25vaSBncmFwaFxuICAgICAqIFxuICAgICAqIEBjbGFzcyBFZGdlXG4gICAgICogQGV4dGVuZHMge0xpbmV9XG4gICAgICovXG4gICAgY29uc3RydWN0b3IodjAsIHYxKSB7XG4gICAgICAgIHN1cGVyKHYwLCB2MSk7XG4gICAgICAgIHRoaXMuaWQgPSAtMTtcbiAgICAgICAgLy8gUG9seWdvbiBjZW50ZXIgb2JqZWN0cyBjb25uZWN0ZWQgYnkgRGVsYXVuYXkgZWRnZXNcbiAgICAgICAgdGhpcy5kMCA9IG51bGw7XG4gICAgICAgIHRoaXMuZDEgPSBudWxsO1xuICAgICAgICAvLyBDb3JuZXIgb2JqZWN0cyBjb25uZWN0ZWQgYnkgVm9yb25vaSBlZGdlc1xuICAgICAgICB0aGlzLnYwID0gbnVsbDtcbiAgICAgICAgdGhpcy52MSA9IG51bGw7XG4gICAgICAgIHRoaXMubWlkcG9pbnQgPSBudWxsO1xuICAgICAgICB0aGlzLmJvcmRlciA9IGZhbHNlO1xuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgRWRnZTsiLCJcInVzZSBzdHJpY3RcIjtcblxuaW1wb3J0IFZlY3RvciBmcm9tIFwiLi4vZ2VvbWV0cnkvVmVjdG9yXCI7XG5pbXBvcnQgQ2VudGVyIGZyb20gXCIuL0NlbnRlclwiO1xuaW1wb3J0IENvcm5lciBmcm9tIFwiLi9Db3JuZXJcIjtcbmltcG9ydCBFZGdlIGZyb20gXCIuL0VkZ2VcIjtcbmltcG9ydCB7IGhhcyB9IGZyb20gXCIuLi91dGlsaXRpZXMvVXRpbFwiO1xuaW1wb3J0IFZvcm9ub2kgZnJvbSBcIlZvcm9ub2lcIjtcblxuLy8gTmVlZCB0byBFUzZpZnlcbmNsYXNzIEdyYXBoIHtcbiAgICAvKipcbiAgICAgKiBUaGUgR3JhcGggY2xhc3MgaXMgYW4gZXh0ZW5zdGlvbiBvZiB0aGUgdm9yb25vaSBkaWFncmFtLiBJdCB0dXJucyB0aGVcbiAgICAgKiBkaWFncmFtIGludG8gYSBtb3JlIHVzZWFibGUgZm9ybWF0IHdoZXJlIGNlbnRlcnMsIGVkZ2VzLCBhbmQgY29ybmVycyBhcmVcbiAgICAgKiBiZXR0ZXIgY29ubmVjdGVkLiBUaGlzIGFsbG93cyBmb3IgbWFueSBkaWZmZXJlbnQgdHlwZXMgb2YgdHJhdmVyc2FsIG92ZXJcbiAgICAgKiB0aGUgZ3JhcGguIFRoaXMgY2xhc3MgdXNlcyB0aGUgcmhpbGwtdm9yb25vaSBsaWJyYXJ5IGZvciBidWlsZGluZyB0aGVcbiAgICAgKiB2b3Jvbm9pIGdyYXBoLiBUaGlzIGlzIHRlcm1lZCBhIFBBTiBjb25uZWN0ZWQgZ3JhcGguIFRoaXMgY2xhc3MgY2FuIGFsc28gYmVcbiAgICAgKiByZWxheGVkIG1vcmUgYnkgdXNpbmcgbGxveWQgcmVsYXhhdGlvbiB3aGljaCByZXJ1bnMgdGhlIGdyYXBoIHNpbXVsYXRpb25cbiAgICAgKiBwcm9jZXNzIHdpdGggYSBsZXNzIHBhY2tlZCBwb2ludCBzZXQgdG8gZ3JhZHVhbGx5IGNyZWF0ZSBhIG1vcmUgXCJibHVlXCIgbm9pc2VcbiAgICAgKiBlZmZlY3QuXG4gICAgICpcbiAgICAgKiBAc3VtbWFyeSBDcmVhdGVzIGEgdm9yb25vaSBkaWFncmFtIG9mIGEgZ2l2ZW4gcG9pbnQgc2V0IHRoYXQgaXMgY3JlYXRlZFxuICAgICAqICBpbnNpZGUgYSBwYXJ0aXVjbGFyIGJvdW5kaW5nIGJveC4gVGhlIHNldCBvZiBwb2ludHMgY2FuIGFsc28gYmUgcmVsYXhlZFxuICAgICAqICBjcmVhdGluZyBhIG1vcmUgXCJibHVlXCIgbm9pc2UgZWZmZWN0IHVzaW5nIGxveWQgcmVsYXhhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAcHJvcGVydHkge1JlY3RhbmdsZX0gYmJveCBUaGUgaW5wdXQgYm91bmRpbmcgYm94XG4gICAgICogQHByb3BlcnR5IHtDZW50ZXJbXX0gY2VudGVycyBBbGwgdGhlIGNlbnRlciBvYmplY3RzIG9mIHRoZSBncmFwaFxuICAgICAqIEBwcm9wZXJ0eSB7Q29ybmVyW119IGNvcm5lcnMgQWxsIHRoZSBjb3JuZXIgb2JqZWN0cyBvZiB0aGUgZ3JhcGhcbiAgICAgKiBAcHJvcGVydHkge0VkZ2VzW119IGVkZ2VzIEFsbCB0aGUgZWRnZSBvYmplY3RzIG9mIHRoZSBncmFwaFxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yW119IHBvaW50cyBUaGUgdmVjdG9yIGxvY2F0aW9uIHRvIGNyZWF0ZSB0aGUgdm9yb25vaSBkaWFncmFtIHdpdGhcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IGZvciB0aGUgY3JlYXRpb24gb2YgdGhlIHZvcm9ub2kgZGlhZ3JhbVxuICAgICAqIEBwYXJhbSB7aW50ZWdlcn0gW3JlbGF4YXRpb25zPTBdIFRoZSBudW1iZXIgb2YgbGxveWQgcmVsYXhhdGlvbnMgdG8gZG8uXG4gICAgICogIFRoaXMgdHVybnMgYSBub2lzeSBncmFwaCBpbnRvIGEgbW9yZSB1bmlmb3JtIGdyYXBoIGl0ZXJhdGlvbiBieSBpdGVyYXRpb24uXG4gICAgICogIFRoaXMgaGVscHMgdG8gaW1wcm92ZSB0aGUgc3BhY2luZyBiZXR3ZWVuIHBvaW50cyBpbiB0aGUgZ3JhcGguXG4gICAgICogQHBhcmFtIHtib29sfSBbaW1wcm92ZUNvcm5lcnM9ZmFsc2VdIFRoaXMgaW1wcm92ZXMgdW5pZm9ybWl0eSBhbW9uZyB0aGVcbiAgICAgKiAgY29ybmVycyBieSBzZXR0aW5nIHRoZW0gdG8gdGhlIGF2ZXJhZ2Ugb2YgdGhlaXIgbmVpZ2hib3JzLiBUaGlzIGJyZWFrc1xuICAgICAqICB0aGUgdm9yb25vaSBwcm9wZXJ0aWVzIG9mIHRoZSBncmFwaC5cbiAgICAgKiBcbiAgICAgKiBAY2xhc3MgR3JhcGhcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwb2ludHMsIGJib3gsIHJlbGF4YXRpb25zID0gMCwgaW1wcm92ZUNvcm5lcnMgPSBmYWxzZSkge1xuICAgICAgICB0aGlzLmJib3ggPSBiYm94O1xuICAgICAgICB0aGlzLl9yaGlsbGJib3ggPSB7XG4gICAgICAgICAgICB4bDogdGhpcy5iYm94LngsXG4gICAgICAgICAgICB4cjogdGhpcy5iYm94LnggKyB0aGlzLmJib3gud2lkdGgsXG4gICAgICAgICAgICB5dDogdGhpcy5iYm94LnksXG4gICAgICAgICAgICB5YjogdGhpcy5iYm94LnkgKyB0aGlzLmJib3guaGVpZ2h0XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gQ29tcHV0ZSBWb3Jvbm9pIGZyb20gaW5pdGlhbCBwb2ludHNcbiAgICAgICAgY29uc3QgcmhpbGxWb3Jvbm9pID0gbmV3IFZvcm9ub2koKTtcbiAgICAgICAgdGhpcy5fdm9yb25vaSA9IHJoaWxsVm9yb25vaS5jb21wdXRlKHBvaW50cywgdGhpcy5fcmhpbGxiYm94KTtcblxuICAgICAgICAvLyBMbG95ZHMgUmVsYXhhdGlvbnNcbiAgICAgICAgd2hpbGUgKHJlbGF4YXRpb25zID4gMCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2cocmVsYXhhdGlvbnMpO1xuICAgICAgICAgICAgY29uc3Qgc2l0ZXMgPSB0aGlzLnJlbGF4U2l0ZXModGhpcy5fdm9yb25vaSk7XG4gICAgICAgICAgICByaGlsbFZvcm9ub2kucmVjeWNsZSh0aGlzLl92b3Jvbm9pKTtcbiAgICAgICAgICAgIHRoaXMuX3Zvcm9ub2kgPSByaGlsbFZvcm9ub2kuY29tcHV0ZShzaXRlcywgdGhpcy5fcmhpbGxiYm94KTtcbiAgICAgICAgICAgIHJlbGF4YXRpb25zLS07XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmNvbnZlcnREaWFncmFtKHRoaXMuX3Zvcm9ub2kpO1xuXG4gICAgICAgIGlmIChpbXByb3ZlQ29ybmVycykge1xuICAgICAgICAgICAgY29uc29sZS5sb2codGhpcy5jb3JuZXJzKTtcbiAgICAgICAgICAgIHRoaXMuaW1wcm92ZUNvcm5lcnMoKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKHRoaXMuY29ybmVycyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5zb3J0Q29ybmVycygpO1xuXG4gICAgfVxuXG4gICAgcmVsYXhTaXRlcyh2b3Jvbm9pKSB7XG4gICAgICAgIGNvbnN0IGNlbGxzID0gdm9yb25vaS5jZWxscztcbiAgICAgICAgbGV0IGlDZWxsID0gY2VsbHMubGVuZ3RoO1xuICAgICAgICBsZXQgY2VsbDtcbiAgICAgICAgbGV0IHNpdGU7XG4gICAgICAgIGNvbnN0IHNpdGVzID0gW107XG5cbiAgICAgICAgd2hpbGUgKGlDZWxsLS0pIHtcbiAgICAgICAgICAgIGNlbGwgPSBjZWxsc1tpQ2VsbF07XG4gICAgICAgICAgICBzaXRlID0gdGhpcy5jZWxsQ2VudHJvaWQoY2VsbCk7XG4gICAgICAgICAgICBzaXRlcy5wdXNoKG5ldyBWZWN0b3Ioc2l0ZS54LCBzaXRlLnkpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2l0ZXM7XG4gICAgfVxuXG4gICAgY2VsbEFyZWEoY2VsbCkge1xuICAgICAgICBsZXQgYXJlYSA9IDA7XG4gICAgICAgIGNvbnN0IGhhbGZlZGdlcyA9IGNlbGwuaGFsZmVkZ2VzO1xuICAgICAgICBsZXQgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aDtcbiAgICAgICAgbGV0IGhhbGZlZGdlLCBwMSwgcDI7XG4gICAgICAgIHdoaWxlIChpSGFsZmVkZ2UtLSkge1xuICAgICAgICAgICAgaGFsZmVkZ2UgPSBoYWxmZWRnZXNbaUhhbGZlZGdlXTtcbiAgICAgICAgICAgIHAxID0gaGFsZmVkZ2UuZ2V0U3RhcnRwb2ludCgpO1xuICAgICAgICAgICAgcDIgPSBoYWxmZWRnZS5nZXRFbmRwb2ludCgpO1xuICAgICAgICAgICAgYXJlYSArPSBwMS54ICogcDIueTtcbiAgICAgICAgICAgIGFyZWEgLT0gcDEueSAqIHAyLng7XG4gICAgICAgIH1cbiAgICAgICAgYXJlYSAvPSAyO1xuICAgICAgICByZXR1cm4gYXJlYTtcbiAgICB9XG5cbiAgICBjZWxsQ2VudHJvaWQoY2VsbCkge1xuICAgICAgICBsZXQgeCA9IDAsXG4gICAgICAgICAgICB5ID0gMDtcbiAgICAgICAgY29uc3QgaGFsZmVkZ2VzID0gY2VsbC5oYWxmZWRnZXM7XG4gICAgICAgIGxldCBpSGFsZmVkZ2UgPSBoYWxmZWRnZXMubGVuZ3RoO1xuICAgICAgICBsZXQgaGFsZmVkZ2U7XG4gICAgICAgIGxldCB2LCBwMSwgcDI7XG5cbiAgICAgICAgd2hpbGUgKGlIYWxmZWRnZS0tKSB7XG4gICAgICAgICAgICBoYWxmZWRnZSA9IGhhbGZlZGdlc1tpSGFsZmVkZ2VdO1xuXG4gICAgICAgICAgICBwMSA9IGhhbGZlZGdlLmdldFN0YXJ0cG9pbnQoKTtcbiAgICAgICAgICAgIHAyID0gaGFsZmVkZ2UuZ2V0RW5kcG9pbnQoKTtcblxuICAgICAgICAgICAgdiA9IHAxLnggKiBwMi55IC0gcDIueCAqIHAxLnk7XG5cbiAgICAgICAgICAgIHggKz0gKHAxLnggKyBwMi54KSAqIHY7XG4gICAgICAgICAgICB5ICs9IChwMS55ICsgcDIueSkgKiB2O1xuICAgICAgICB9XG5cbiAgICAgICAgdiA9IHRoaXMuY2VsbEFyZWEoY2VsbCkgKiA2O1xuXG4gICAgICAgIHJldHVybiB7IHg6IHggLyB2LCB5OiB5IC8gdiB9O1xuICAgIH1cblxuICAgIGNvbnZlcnREaWFncmFtKHZvcm9ub2kpIHtcbiAgICAgICAgY29uc3QgY2VudGVyTG9va3VwID0ge307XG4gICAgICAgIGNvbnN0IGNvcm5lckxvb2t1cCA9IHt9O1xuICAgICAgICB0aGlzLmNlbnRlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5jb3JuZXJzID0gW107XG4gICAgICAgIHRoaXMuZWRnZXMgPSBbXTtcblxuICAgICAgICBsZXQgY29ybmVySWQgPSAwO1xuICAgICAgICBsZXQgZWRnZUlkID0gMDtcblxuICAgICAgICAvLyBDb3B5IG92ZXIgYWxsIHRoZSBjZW50ZXIgbm9kZXNcbiAgICAgICAgZm9yIChjb25zdCBjZWxsIG9mIHZvcm9ub2kuY2VsbHMpIHtcbiAgICAgICAgICAgIGNvbnN0IHNpdGUgPSBjZWxsLnNpdGU7XG4gICAgICAgICAgICBjb25zdCBwb3MgPSBuZXcgVmVjdG9yKHNpdGUueCwgc2l0ZS55KTtcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG5ldyBDZW50ZXIocG9zKTtcbiAgICAgICAgICAgIGNlbnRlci5pZCA9IHNpdGUudm9yb25vaUlkO1xuICAgICAgICAgICAgY2VudGVyTG9va3VwW3Bvcy5rZXkoKV0gPSBjZW50ZXI7XG4gICAgICAgICAgICB0aGlzLmNlbnRlcnMucHVzaChjZW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGFuZCBjb3B5IG92ZXIgdGhlIGVkZ2VzIGFuZCBjb3JuZXJzXG4gICAgICAgIC8vIFRoaXMgcG9ydGlvbiBhbHNvIGNyZWF0ZXMgdGhlIGNvbm5lY3Rpb25zIGJldHdlZW4gYWxsIHRoZSBub2Rlc1xuICAgICAgICBmb3IgKGxldCBlZGdlIG9mIHZvcm9ub2kuZWRnZXMpIHtcblxuICAgICAgICAgICAgLy8gQ29udmVydCB2b3Jvbm9pIGVkZ2UgdG8gYSB1c2VhYmxlIGZvcm1cbiAgICAgICAgICAgIC8vIENvcm5lciBwb3NpdGlvbnNcbiAgICAgICAgICAgIGNvbnN0IHZhID0gbmV3IFZlY3RvcihNYXRoLnJvdW5kKGVkZ2UudmEueCksIE1hdGgucm91bmQoZWRnZS52YS55KSk7XG4gICAgICAgICAgICBjb25zdCB2YiA9IG5ldyBWZWN0b3IoTWF0aC5yb3VuZChlZGdlLnZiLngpLCBNYXRoLnJvdW5kKGVkZ2UudmIueSkpO1xuICAgICAgICAgICAgLy8gQ2VudGVyIHBvc2l0aW9uc1xuICAgICAgICAgICAgY29uc3Qgc2l0ZTEgPSBuZXcgVmVjdG9yKGVkZ2UubFNpdGUueCwgZWRnZS5sU2l0ZS55KTtcbiAgICAgICAgICAgIGNvbnN0IHNpdGUyID0gZWRnZS5yU2l0ZSA/IG5ldyBWZWN0b3IoZWRnZS5yU2l0ZS54LCBlZGdlLnJTaXRlLnkpIDogbnVsbDtcblxuICAgICAgICAgICAgLy8gTG9va3VwIHRoZSB0d28gY2VudGVyIG9iamVjdHNcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlcjEgPSBjZW50ZXJMb29rdXBbc2l0ZTEua2V5KCldO1xuICAgICAgICAgICAgY29uc3QgY2VudGVyMiA9IHNpdGUyID8gY2VudGVyTG9va3VwW3NpdGUyLmtleSgpXSA6IG51bGw7XG5cbiAgICAgICAgICAgIC8vIExvb2t1cCB0aGUgY29ybmVyIG9iamVjdHMgYW5kIGlmIG9uZSBpc24ndCBjcmVhdGVkXG4gICAgICAgICAgICAvLyBjcmVhdGUgb25lIGFuZCBhZGQgaXQgdG8gY29ybmVycyBzZXRcbiAgICAgICAgICAgIGxldCBjb3JuZXIxO1xuICAgICAgICAgICAgbGV0IGNvcm5lcjI7XG5cbiAgICAgICAgICAgIGNvbnN0IGlzQm9yZGVyID0gKHBvaW50LCBiYm94KSA9PiBwb2ludC54IDw9IGJib3gueGwgfHwgcG9pbnQueCA+PSBiYm94LnhyIHx8XG4gICAgICAgICAgICAgICAgcG9pbnQueSA8PSBiYm94Lnl0IHx8IHBvaW50LnkgPj0gYmJveC55YjtcblxuICAgICAgICAgICAgaWYgKCFoYXMoY29ybmVyTG9va3VwLCB2YS5rZXkoKSkpIHtcbiAgICAgICAgICAgICAgICBjb3JuZXIxID0gbmV3IENvcm5lcih2YSk7XG4gICAgICAgICAgICAgICAgY29ybmVyMS5pZCA9IGNvcm5lcklkKys7XG4gICAgICAgICAgICAgICAgY29ybmVyMS5ib3JkZXIgPSBpc0JvcmRlcih2YSwgdGhpcy5iYm94KTtcbiAgICAgICAgICAgICAgICBjb3JuZXJMb29rdXBbdmEua2V5KCldID0gY29ybmVyMTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvcm5lcnMucHVzaChjb3JuZXIxKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29ybmVyMSA9IGNvcm5lckxvb2t1cFt2YS5rZXkoKV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWhhcyhjb3JuZXJMb29rdXAsIHZiLmtleSgpKSkge1xuICAgICAgICAgICAgICAgIGNvcm5lcjIgPSBuZXcgQ29ybmVyKHZiKTtcbiAgICAgICAgICAgICAgICBjb3JuZXIyLmlkID0gY29ybmVySWQrKztcbiAgICAgICAgICAgICAgICBjb3JuZXIyLmJvcmRlciA9IGlzQm9yZGVyKHZiLCB0aGlzLmJib3gpO1xuICAgICAgICAgICAgICAgIGNvcm5lckxvb2t1cFt2Yi5rZXkoKV0gPSBjb3JuZXIyO1xuICAgICAgICAgICAgICAgIHRoaXMuY29ybmVycy5wdXNoKGNvcm5lcjIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb3JuZXIyID0gY29ybmVyTG9va3VwW3ZiLmtleSgpXTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBlZGdlIG9iamVjdHNcbiAgICAgICAgICAgIGNvbnN0IG5ld0VkZ2UgPSBuZXcgRWRnZSgpO1xuICAgICAgICAgICAgbmV3RWRnZS5pZCA9IGVkZ2VJZCsrO1xuICAgICAgICAgICAgbmV3RWRnZS5kMCA9IGNlbnRlcjE7XG4gICAgICAgICAgICBuZXdFZGdlLmQxID0gY2VudGVyMjtcbiAgICAgICAgICAgIG5ld0VkZ2UudjAgPSBjb3JuZXIxO1xuICAgICAgICAgICAgbmV3RWRnZS52MSA9IGNvcm5lcjI7XG4gICAgICAgICAgICBuZXdFZGdlLm1pZHBvaW50ID0gVmVjdG9yLm1pZHBvaW50KGNvcm5lcjEsIGNvcm5lcjIpO1xuXG4gICAgICAgICAgICAvLyBVcGRhdGUgdGhlIGNvcm5lciBvYmplY3RzXG4gICAgICAgICAgICBjb3JuZXIxLnByb3RydWRlcy5wdXNoKG5ld0VkZ2UpO1xuICAgICAgICAgICAgY29ybmVyMi5wcm90cnVkZXMucHVzaChuZXdFZGdlKTtcblxuICAgICAgICAgICAgaWYgKCFjb3JuZXIxLnRvdWNoZXMuaW5jbHVkZXMoY2VudGVyMSkpIHtcbiAgICAgICAgICAgICAgICBjb3JuZXIxLnRvdWNoZXMucHVzaChjZW50ZXIxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjZW50ZXIyICYmICFjb3JuZXIxLnRvdWNoZXMuaW5jbHVkZXMoY2VudGVyMikpIHtcbiAgICAgICAgICAgICAgICBjb3JuZXIxLnRvdWNoZXMucHVzaChjZW50ZXIyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghY29ybmVyMi50b3VjaGVzLmluY2x1ZGVzKGNlbnRlcjEpKSB7XG4gICAgICAgICAgICAgICAgY29ybmVyMi50b3VjaGVzLnB1c2goY2VudGVyMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY2VudGVyMiAmJiAhY29ybmVyMi50b3VjaGVzLmluY2x1ZGVzKGNlbnRlcjIpKSB7XG4gICAgICAgICAgICAgICAgY29ybmVyMi50b3VjaGVzLnB1c2goY2VudGVyMik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvcm5lcjEuYWRqYWNlbnQucHVzaChjb3JuZXIyKTtcbiAgICAgICAgICAgIGNvcm5lcjIuYWRqYWNlbnQucHVzaChjb3JuZXIxKTtcblxuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBjZW50ZXIgb2JqZWN0c1xuICAgICAgICAgICAgY2VudGVyMS5ib3JkZXJzLnB1c2gobmV3RWRnZSk7XG4gICAgICAgICAgICBpZiAoY2VudGVyMikge1xuICAgICAgICAgICAgICAgIGNlbnRlcjIuYm9yZGVycy5wdXNoKG5ld0VkZ2UpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWNlbnRlcjEuY29ybmVycy5pbmNsdWRlcyhjb3JuZXIxKSkge1xuICAgICAgICAgICAgICAgIGNlbnRlcjEuY29ybmVycy5wdXNoKGNvcm5lcjEpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFjZW50ZXIxLmNvcm5lcnMuaW5jbHVkZXMoY29ybmVyMikpIHtcbiAgICAgICAgICAgICAgICBjZW50ZXIxLmNvcm5lcnMucHVzaChjb3JuZXIyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjZW50ZXIyICYmICFjZW50ZXIyLmNvcm5lcnMuaW5jbHVkZXMoY29ybmVyMSkpIHtcbiAgICAgICAgICAgICAgICBjZW50ZXIyLmNvcm5lcnMucHVzaChjb3JuZXIxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjZW50ZXIyICYmICFjZW50ZXIyLmNvcm5lcnMuaW5jbHVkZXMoY29ybmVyMikpIHtcbiAgICAgICAgICAgICAgICBjZW50ZXIyLmNvcm5lcnMucHVzaChjb3JuZXIyKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNlbnRlcjIpIHtcbiAgICAgICAgICAgICAgICBjZW50ZXIxLm5laWdoYm9ycy5wdXNoKGNlbnRlcjIpO1xuICAgICAgICAgICAgICAgIGNlbnRlcjIubmVpZ2hib3JzLnB1c2goY2VudGVyMSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIElmIGVpdGhlciBjb3JuZXIgaXMgYSBib3JkZXIsIGJvdGggY2VudGVycyBhcmUgYm9yZGVyc1xuICAgICAgICAgICAgY2VudGVyMS5ib3JkZXIgPSBjZW50ZXIxLmJvcmRlciB8fCBjb3JuZXIxLmJvcmRlciB8fCBjb3JuZXIyLmJvcmRlcjtcbiAgICAgICAgICAgIGlmIChjZW50ZXIyKSB7XG4gICAgICAgICAgICAgICAgY2VudGVyMi5ib3JkZXIgPSBjZW50ZXIyLmJvcmRlciB8fCBjb3JuZXIxLmJvcmRlciB8fCBjb3JuZXIyLmJvcmRlcjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5lZGdlcy5wdXNoKG5ld0VkZ2UpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIGdyYXBoXG4gICAgLy9cbiAgICAvLyBMbG95ZCByZWxheGF0aW9uIGhlbHBlZCB0byBjcmVhdGUgdW5pZm9ybWl0eSBhbW9uZyBwb2x5Z29uIGNvcm5lcnMsXG4gICAgLy8gVGhpcyBmdW5jdGlvbiBjcmVhdGVzIHVuaWZvcm1pdHkgYW1vbmcgcG9seWdvbiBjb3JuZXJzIGJ5IHNldHRpbmcgdGhlIGNvcm5lcnNcbiAgICAvLyB0byB0aGUgYXZlcmFnZSBvZiB0aGVpciBuZWlnaGJvcnNcbiAgICAvLyBUaGlzIGJyZWFrZXMgdGhlIHZvcm9ub2kgZGlhZ3JhbSBwcm9wZXJ0aWVzXG4gICAgaW1wcm92ZUNvcm5lcnMoKSB7XG4gICAgICAgIGNvbnN0IG5ld0Nvcm5lcnMgPSBbXTtcblxuICAgICAgICAvLyBDYWxjdWxhdGUgbmV3IGNvcm5lciBwb3NpdGlvbnNcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLmNvcm5lcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGxldCBjb3JuZXIgPSB0aGlzLmNvcm5lcnNbaV07XG5cbiAgICAgICAgICAgIGlmIChjb3JuZXIuYm9yZGVyKSB7XG4gICAgICAgICAgICAgICAgbmV3Q29ybmVyc1tpXSA9IGNvcm5lcjtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbGV0IG5ld1BvcyA9IFZlY3Rvci56ZXJvKCk7XG5cbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IG5laWdoYm9yIG9mIGNvcm5lci50b3VjaGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIG5ld1BvcyA9IFZlY3Rvci5hZGQobmV3UG9zLCBuZWlnaGJvcik7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgbmV3UG9zID0gbmV3UG9zLmRpdmlkZShjb3JuZXIudG91Y2hlcy5sZW5ndGgpO1xuICAgICAgICAgICAgICAgIG5ld0Nvcm5lcnNbaV0gPSBuZXdQb3M7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZyhuZXdDb3JuZXJzKTtcblxuICAgICAgICAvLyBBc3NpZ24gbmV3IGNvcm5lciBwb3NpdGlvbnNcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLmNvcm5lcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHRoaXMuY29ybmVyc1tpXS54ID0gbmV3Q29ybmVyc1tpXS54O1xuICAgICAgICAgICAgdGhpcy5jb3JuZXJzW2ldLnkgPSBuZXdDb3JuZXJzW2ldLnk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWNvbXB1dGUgZWRnZSBtaWRwb2ludHNcbiAgICAgICAgZm9yIChsZXQgZWRnZSBvZiB0aGlzLmVkZ2VzKSB7XG4gICAgICAgICAgICBpZiAoZWRnZS52MCAmJiBlZGdlLnYxKSB7XG4gICAgICAgICAgICAgICAgZWRnZS5taWRwb2ludCA9IFZlY3Rvci5taWRwb2ludChlZGdlLnYwLCBlZGdlLnYxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gU29ydHMgdGhlIGNvcm5lcnMgaW4gY2xvY2t3aXNlIG9yZGVyIHNvIHRoYXQgdGhleSBjYW4gYmUgcHJpbnRlZCBwcm9wZXJseVxuICAgIC8vIHVzaW5nIGEgc3RhbmRhcmQgcG9seWdvbiBkcmF3aW5nIG1ldGhvZFxuXG4gICAgc29ydENvcm5lcnMoKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2VudGVyIG9mIHRoaXMuY2VudGVycykge1xuICAgICAgICAgICAgY29uc3QgY29tcCA9IHRoaXMuY29tcGFyZVBvbHlQb2ludHMoY2VudGVyKTtcbiAgICAgICAgICAgIGNlbnRlci5jb3JuZXJzLnNvcnQoY29tcCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIENvbXBhcmlzb24gZnVuY3Rpb24gZm9yIHNvcnRpbmcgcG9seWdvbiBwb2ludHMgaW4gY2xvY2t3aXNlIG9yZGVyXG4gICAgLy8gYXNzdW1pbmcgYSBjb252ZXggcG9seWdvblxuICAgIC8vIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvNjk4OTEwMC9zb3J0LXBvaW50cy1pbi1jbG9ja3dpc2Utb3JkZXJcbiAgICBjb21wYXJlUG9seVBvaW50cyhjKSB7XG4gICAgICAgIGNvbnN0IGNlbnRlciA9IGM7XG4gICAgICAgIHJldHVybiAocDEsIHAyKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhID0gcDEsXG4gICAgICAgICAgICAgICAgYiA9IHAyO1xuXG4gICAgICAgICAgICBpZiAoYS54IC0gY2VudGVyLnggPj0gMCAmJiBiLnggLSBjZW50ZXIueCA8IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gLTE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoYS54IC0gY2VudGVyLnggPCAwICYmIGIueCAtIGNlbnRlci54ID49IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChhLnggLSBjZW50ZXIueCA9PT0gMCAmJiBiLnggLSBjZW50ZXIueCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGlmIChhLnkgLSBjZW50ZXIueSA+PSAwIHx8IGIueSAtIGNlbnRlci55ID49IDApIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGEueSA+IGIueSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIC0xO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGIueSA+IGEueSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gLTE7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBjb21wdXRlIHRoZSBjcm9zcyBwcm9kdWN0IG9mIHZlY3RvcnMgKGNlbnRlciAtPiBhKSB4IChjZW50ZXIgLT4gYilcbiAgICAgICAgICAgIGNvbnN0IGRldCA9IChhLnggLSBjZW50ZXIueCkgKiAoYi55IC0gY2VudGVyLnkpIC0gKGIueCAtIGNlbnRlci54KSAqIChhLnkgLSBjZW50ZXIueSk7XG4gICAgICAgICAgICBpZiAoZGV0IDwgMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAtMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZXQgPiAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIHBvaW50cyBhIGFuZCBiIGFyZSBvbiB0aGUgc2FtZSBsaW5lIGZyb20gdGhlIGNlbnRlclxuICAgICAgICAgICAgLy8gY2hlY2sgd2hpY2ggcG9pbnQgaXMgY2xvc2VyIHRvIHRoZSBjZW50ZXJcbiAgICAgICAgICAgIGNvbnN0IGQxID0gKGEueCAtIGNlbnRlci54KSAqIChhLnggLSBjZW50ZXIueCkgKyAoYS55IC0gY2VudGVyLnkpICogKGEueSAtIGNlbnRlci55KTtcbiAgICAgICAgICAgIGNvbnN0IGQyID0gKGIueCAtIGNlbnRlci54KSAqIChiLnggLSBjZW50ZXIueCkgKyAoYi55IC0gY2VudGVyLnkpICogKGIueSAtIGNlbnRlci55KTtcbiAgICAgICAgICAgIGlmIChkMSA+IGQyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIC0xO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9O1xuICAgIH1cblxufVxuXG5leHBvcnQgZGVmYXVsdCBHcmFwaDsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcbmltcG9ydCBQb2x5Z29uIGZyb20gXCIuLi9nZW9tZXRyeS9Qb2x5Z29uXCI7XG5cbmNsYXNzIFRpbGUgZXh0ZW5kcyBQb2x5Z29uIHtcbiAgICBjb25zdHJ1Y3RvcihjZW50ZXIsIGNvcm5lcnMsIGVkZ2VzKSB7XG4gICAgICAgIFxuICAgICAgICBzdXBlcihjb3JuZXJzLCBjZW50ZXIpO1xuICAgICAgICB0aGlzLmVkZ2VzID0gZWRnZXM7XG4gICAgICAgIHRoaXMubmVpZ2hib3JzID0gW107XG5cbiAgICAgICAgdGhpcy5kYXRhID0ge307XG5cbiAgICAgICAgdGhpcy5wYXJlbnQgPSBudWxsO1xuICAgICAgICB0aGlzLmNoaWxkcmVuID0gbnVsbDtcblxuICAgICAgICAvLyBSZWN1cnNpdmUgUGFyYW1ldGVyc1xuICAgICAgICAvLyB0aGlzLnBhcmVudCA9IHBhcmVudDtcbiAgICAgICAgLy8gdGhpcy5jaGlsZHJlbiA9IGNoaWxkcmVuID8gY2hpbGRyZW4gOiBbXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIG5laWdoYm9yaW5nIHRpbGUgY2xvc2VzdCB0byBhIHBhcnRpY3VsYXIgZGlyZWN0aW9uXG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGRpcmVjdGlvbiBUaGUgZGlyZWN0aW9uIGZyb20gdGhlIGN1cnJlbnQgdGlsZSB0byB0aGVcbiAgICAgKiAgbmVpZ2hib3JpbmcgdGlsZS4gKERpcmVjdGlvbnMgYXJlIGFzc3VtZWQgdG8gc3RhcnQgZnJvbSB0aGUgb3JpZ2luKVxuICAgICAqIFxuICAgICAqIEByZXR1cm4ge1RpbGV9IFRoZSBuZWlnaGJvcmluZyB0aWxlIHdoaWNoIGlzIGNsb3Nlc3QgdG8gdGhlIGlucHV0XG4gICAgICogIGRpcmVjdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgVGlsZVxuICAgICAqL1xuICAgIGdldE5laWdoYm9yKGRpcmVjdGlvbikge1xuICAgICAgICBsZXQgbWluQW5nbGUgPSBNYXRoLlBJO1xuICAgICAgICBsZXQgY2xvc2VzdCA9IHRoaXMubmVpZ2hib3JzWzBdO1xuXG4gICAgICAgIGZvciAoY29uc3QgbmVpZ2hib3Igb2YgdGhpcy5uZWlnaGJvcnMpIHtcbiAgICAgICAgICAgIGxldCBhbmcgPSBWZWN0b3IuYW5nbGUoXG4gICAgICAgICAgICAgICAgVmVjdG9yLnN1YnRyYWN0KG5laWdoYm9yLmNlbnRlciwgdGhpcy5jZW50ZXIpLCBkaXJlY3Rpb24pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYW5nIDwgbWluQW5nbGUpIHtcbiAgICAgICAgICAgICAgICBtaW5BbmdsZSA9IGFuZztcbiAgICAgICAgICAgICAgICBjbG9zZXN0ID0gbmVpZ2hib3I7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY2xvc2VzdDtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFRpbGU7IiwiLy8gR2VvbWV0cnlcbmltcG9ydCBWZWN0b3IgZnJvbSBcIi4vZ2VvbWV0cnkvVmVjdG9yXCI7XG5pbXBvcnQgTGluZSBmcm9tIFwiLi9nZW9tZXRyeS9MaW5lXCI7XG5pbXBvcnQgUG9seWdvbiBmcm9tIFwiLi9nZW9tZXRyeS9Qb2x5Z29uXCI7XG5pbXBvcnQgUmVjdGFuZ2xlIGZyb20gXCIuL2dlb21ldHJ5L1JlY3RhbmdsZVwiO1xuaW1wb3J0IFRyaWFuZ2xlIGZyb20gXCIuL2dlb21ldHJ5L1RyaWFuZ2xlXCI7XG5cbi8vIEdyYXBoXG5pbXBvcnQgQ2VudGVyIGZyb20gXCIuL2dyYXBoL0NlbnRlclwiO1xuaW1wb3J0IENvcm5lciBmcm9tIFwiLi9ncmFwaC9Db3JuZXJcIjtcbmltcG9ydCBFZGdlIGZyb20gXCIuL2dyYXBoL0VkZ2VcIjtcbmltcG9ydCBHcmFwaCBmcm9tIFwiLi9ncmFwaC9HcmFwaFwiO1xuaW1wb3J0IERpYWdyYW0gZnJvbSBcIi4vZ3JhcGgvRGlhZ3JhbVwiO1xuXG4vLyBVdGlsaXRpZXNcbmltcG9ydCAqIGFzIFBvaW50RGlzdHJpYnV0aW9uIGZyb20gXCIuL1V0aWxpdGllcy9Qb2ludERpc3RyaWJ1dGlvblwiO1xuaW1wb3J0ICogYXMgUmVkaXN0IGZyb20gXCIuL3V0aWxpdGllcy9SZWRpc3RcIjtcbmltcG9ydCBSYW5kIGZyb20gXCIuL3V0aWxpdGllcy9SYW5kXCI7XG5pbXBvcnQgKiBhcyBIZWxwZXJzIGZyb20gXCIuL3V0aWxpdGllcy9VdGlsXCI7XG5cbi8vIEFsZ29yaXRobXNcbmltcG9ydCBiaW5hcnlTcGFjZVBhcnRpdGlvbiBmcm9tIFwiLi9hbGdvcml0aG1zL0JpbmFyeVNwYWNlUGFydGl0aW9uXCI7XG5pbXBvcnQgcmVjdXJzaXZlVm9yb25vaSBmcm9tIFwiLi9hbGdvcml0aG1zL1JlY3Vyc2l2ZVZvcm9ub2lcIjtcblxuLyoqXG4gKiBUaGUgQXR1bSBwcm9jZWR1cmFsIGdyYXBoIGJhc2VkIGxpYnJhcnlcbiAqIFxuICogQGV4cG9ydFxuICogQG1vZHVsZSBBdHVtXG4gKiBAc2VlIHtAbGluayBodHRwczovL2dpdGh1Yi5jb20vRXZlbGlvcy9BdHVtfVxuICovXG5jb25zdCBBdHVtID0ge1xuICAgIEdlb21ldHJ5OiB7XG4gICAgICAgIFZlY3RvcixcbiAgICAgICAgTGluZSxcbiAgICAgICAgUG9seWdvbixcbiAgICAgICAgUmVjdGFuZ2xlLFxuICAgICAgICBUcmlhbmdsZVxuICAgIH0sXG4gICAgR3JhcGg6IHtcbiAgICAgICAgQ2VudGVyLFxuICAgICAgICBDb3JuZXIsXG4gICAgICAgIEVkZ2UsXG4gICAgICAgIEdyYXBoLFxuICAgICAgICBEaWFncmFtXG4gICAgfSxcbiAgICBVdGlsaXR5OiB7XG4gICAgICAgIFBvaW50RGlzdHJpYnV0aW9uLFxuICAgICAgICBSZWRpc3QsXG4gICAgICAgIFJhbmQsXG4gICAgICAgIEhlbHBlcnNcbiAgICB9LFxuICAgIEFsZ29yaXRobToge1xuICAgICAgICBiaW5hcnlTcGFjZVBhcnRpdGlvbixcbiAgICAgICAgcmVjdXJzaXZlVm9yb25vaVxuICAgIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IEF0dW07IiwiLyoqXG4gKiBUaGVzZXMgZnVuY3Rpb24gYXJlIHVzZWQgdG8gcmVkaXN0cmlidXRlIGRhdGEgbG9jYXRlZCBpbiB0aGUgcmFuZ2UgMC0xXG4gKiBUaGV5IHRha2UgYWxsIHRoZSBkYXRhIGFuZCByZWFycmFuZ2UgdGhlbSBhbmQgcHVydHVyYmUgdGhlbSBzbGlnaHRseSBzbyB0aGF0XG4gKiB0aGV5IGZpdCBhIHBhcnRpY3VsYXIgZGlzdHJ1YnV0aW9uIGZ1bmN0aW9uLiBGb3IgZXhhbXBsZSB5b3UgY2FuIHVzZSB0aGVzZVxuICogdG8gcHVzaCBhbGwgdGhlIGRhdGEgcG9pbnRzIGNsb3NlciB0byAxIHNvIHRoYXQgdGhlcmUgYXJlIGZldyBwb2ludHMgbmVhciAwXG4gKiBlYWNoIHJlZGlzdHJpYnV0aW9uIGZ1bmN0aW9uIGhhcyBkaWZmZXJlbnQgcHJvcGVydGllcy5cbiAqXG4gKiBQcm9wZXJ0aWVzIG9mIHRoZXNlIGZ1bmN0aW9uc1xuICogdGhlIGRvbWFpbiBpcyAoMC0xKSBmb3IgdGhlIHJhbmdlICgwLTEpXG4gKiBpbiB0aGlzIHJhbmdlIHRoZSBmdW5jdGlvbiBpcyBvbmUgdG8gb25lXG4gKiBmKDApID09IDAgYW5kIGYoMSkgPT0gMVxuICogXG4gKiBAc3VtbWFyeSBGdW5jdGlvbnMgdXNlZCB0byByZWRpc3RydWJ1dGUgdmFsdWVzIGluIHRoZSByYW5nZSAwLTFcbiAqIEBjbGFzcyBSZWRpc3RcbiAqL1xuXG5cInVzZSBzdHJpY3RcIjtcblxuLyoqXG4gKiBUaGUgaWRlbnRpdHkgZnVuY3Rpb24uIEl0IHJldHVybnMgdGhlIGlucHV0IHZhbHVlIHhcbiAqIFxuICogQGV4cG9ydFxuICogQGZ1bmN0aW9uXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgaW5wdXQgbnVtYmVyIGluIHRoZSByYW5nZSBbMC0xXVxuICogQHJldHVybnMge051bWJlcn0gSW5wdXQgdmFsdWVcbiAqIEBtZW1iZXJvZiBSZWRpc3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlkZW50aXR5KHgpIHtcbiAgICByZXR1cm4geDtcbn1cblxuLyoqXG4gKiBUaGUgaW52ZXJzZSBmdWN0aW9uLiBJdCByZXR1cm5zIHRoZSBvcHBvc2l0ZSBvZiB0aGUgZnVuY3Rpb24gaW4gdGhlIHJhbmdlXG4gKiBmcm9tIFswLTFdLiBUaGlzIGlzIHNpbXBseSAxIC0geC5cbiAqIFxuICogQGV4cG9ydFxuICogQGZ1bmN0aW9uXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgaW5wdXQgbnVtYmVyIGluIHRoZSByYW5nZSBbMC0xXVxuICogQHJldHVybnMge051bWJlcn0gVGhlIHJlZGlzdHJpYnV0ZWQgaW5wdXQgdmFsdWUsIDEgLSB4XG4gKiBAbWVtYmVyb2YgUmVkaXN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbnZlcnNlKHgpIHtcbiAgICByZXR1cm4gMSAtIHg7XG59XG5cbi8qKlxuICogRXhwb25lbnRpYWwgcmVkaXN0cmlidXRpb24gZnVuY3Rpb24uIFRoaXMgZnVuY3Rpb24gc2tld3MgdGhlIHZhbHVlcyBlaXRoZXJcbiAqIHVwIG9yIGRvd24gYnkgYSBwYXJ0aWN1bGFyIGFtbW91bnQgYWNjb3JkaW5nIHRoZSBpbnB1dCBwYXJhbWV0ZXJzLiBUaGVcbiAqIG91dHB1dCBkaXN0cmlidXRpb24gd2lsbCBiZSBzbGlnaHQgZXhwb25lbnRpYWwgc2hhcGVkLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAZnVuY3Rpb25cbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSBpbnB1dCBudW1iZXIgaW4gdGhlIHJhbmdlIFswLTFdXG4gKiBAcGFyYW0ge051bWJlcn0gW2FtbT0xXSBUaGUgc3RyZW5ndGggb2YgdGhlIHJlZGlzdHJpYnV0aW9uXG4gKiBAcGFyYW0ge0Jvb2xlYW59IFtpbmM9dHJ1ZV0gSWYgeW91IHdhbnQgdG8gaW5jcmVhc2Ugb3IgZGVjcmVhc2UgdGhlIGlucHV0XG4gKiBAcmV0dXJucyB7TnVtYmVyfSBUaGUgcmVkaXN0cmlidXRlZCBpbnB1dCB2YWx1ZVxuICogQG1lbWJlcm9mIFJlZGlzdFxuICovXG5leHBvcnQgZnVuY3Rpb24gZXhwKHgsIGFtbSA9IDEsIGluYyA9IHRydWUpIHtcbiAgICBsZXQgbm9tLCBkZW5vbTtcbiAgICBpZiAoaW5jKSB7XG4gICAgICAgIG5vbSA9IDEgLSBNYXRoLmV4cCgtYW1tICogeCk7XG4gICAgICAgIGRlbm9tID0gMSAtIE1hdGguZXhwKC1hbW0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIG5vbSA9IE1hdGguZXhwKGFtbSAqIHgpIC0gMTtcbiAgICAgICAgZGVub20gPSBNYXRoLmV4cChhbW0pIC0gMTtcbiAgICB9XG5cbiAgICByZXR1cm4gbm9tIC8gZGVub207XG59XG5cbi8vIFBvd2VyIEZ1bmN0aW9uIGVnIHNxcnQgcXVicnRcbi8qKlxuICogUG93ZXIgcmVkaXN0cmlidXRpb24gZnVuY3Rpb24uIFRoaXMgZnVuY3Rpb24gc2tld3MgdmFsdWVzIGVpdGhlciB1cCBvciBkb3duXG4gKiBieSBhIHBhcnRpY3VsYXIgYW1tb3VudCBhY2NvcmRpbmcgdG8gdGhlIGlucHV0IHBhcmFtZXRlcnMuIFRoZSBwb3dlciBcbiAqIGRpc3RyaWJ1dGlvbiBhbHNvIGhhcyBhIHNsaWdodCBza2V3IHVwIG9yIGRvd24gb24gdG9wIG9mIHRoZSByZWRpc3RyaWJ1dGlvbi5cbiAqIFxuICogQGV4cG9ydFxuICogQGZ1bmN0aW9uXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgaW5wdXQgbnVtYmVyIGluIHRoZSByYW5nZSBbMC0xXSBcbiAqIEBwYXJhbSB7TnVtYmVyfSBbYW1tPTJdIFRoZSBzdHJlbmd0aCBvZiB0aGUgcmVkaXN0cmlidXRpb25cbiAqIEBwYXJhbSB7Qm9vbGVhbn0gW2luYz10cnVlXSBJZiB5b3Ugd2FudCB0byBpbmNyZWFzZSBvciBkZWNyZWFzZSB0aGUgaW5wdXRcbiAqIEBwYXJhbSB7Qm9vbGVhbn0gW3NrZXdEb3duPXRydWVdIElmIHlvdSB3YW50IHRvIHNrZXcgdGhlIGlucHV0IHZhbHVlIGRvd25cbiAqICB0b3dhcmRzIDAsIHRoZW4gc2tld0Rvd249dHJ1ZS4gSWYgeW91IHdhbnQgdG8gc2tldyB0aGUgaW5wdXQgdmFsdWUgdXAgXG4gKiAgdG93YXJkcyAxLCB0aGVuIHNrZXdEb3duPWZhbHNlXG4gKiBAcmV0dXJucyB7TnVtYmVyfSBUaGUgcmVkaXN0cmlidXRlZCBpbnB1dCB2YWx1ZVxuICogQG1lbWJlcm9mIFJlZGlzdFxuICovXG5leHBvcnQgZnVuY3Rpb24gcG93KHgsIGFtbSA9IDIsIGluYyA9IHRydWUsIHNrZXdEb3duID0gdHJ1ZSkge1xuICAgIGlmIChpbmMpIHtcbiAgICAgICAgaWYgKHNrZXdEb3duKSB7XG4gICAgICAgICAgICByZXR1cm4gTWF0aC5wb3coeCwgMSAvIGFtbSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gMSAtIE1hdGgucG93KDEgLSB4LCBhbW0pO1xuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHNrZXdEb3duKSB7XG4gICAgICAgICAgICByZXR1cm4gTWF0aC5wb3coeCwgYW1tKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiAxIC0gTWF0aC5wb3coMSAtIHgsIDEgLyBhbW0pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqIFR1cm5zIGEgY29udGluaW91cyBmdW5jdGlvbiBhbmQgdHVybnMgaXQgaW50byBhIGRpc2NyZXRlIGZ1bmN0aW9uIHRoYXQgaGFzXG4gKiBhIHNwZWNpZmljIG51bWJlciBvZiBiaW5zIHRvIGJ1dCB0aGUgZGlzdHJpYnV0aW9uIGludG8uXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBmdW5jdGlvblxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIGlucHV0IG51bWJlciBpbiB0aGUgcmFuZ2UgWzAtMV1cbiAqIEBwYXJhbSB7TnVtYmVyfSBbYmlucz0xMF0gVGhlIG51bWJlciBvZiBiaW5zIGZvciB0aGUgZGlzY3JpdGUgZGlzdHJpYnV0aW9uXG4gKiBAcmV0dXJucyB7TnVtYmVyfSBUaGUgZGlzY3JldGl6ZWQgaW5wdXQgdmFsdWVcbiAqIEBtZW1iZXJvZiBSZWRpc3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0ZXAoeCwgYmlucyA9IDEwKSB7XG4gICAgcmV0dXJuIE1hdGguZmxvb3IoYmlucyAqIHgpIC8gYmlucztcbn0iLCIvKipcclxuICogQSB1dGlsaXR5IGZpbGUgd2l0aCBoZWxwZXIgZnVuY3Rpb25zIHRoYXQgY2FuIGJlIHVzZWQgdG8gYWlkIGluIHRoZVxyXG4gKiBkZXZlbG9wbWVudCBvZiB0aGUgcGFja2FnZS5cclxuICovXHJcblwidXNlIHN0cmljdFwiO1xyXG5cclxuLy8gVXNlZCBmb3IgdGVzdGluZyBpZiBhbiBvYmplY3QgY29udGFpbnMgYSBwYXJ0aWN1bGFyIHByb3BlcnR5XHJcbi8vIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvNzE3NDc0OC9qYXZhc2NyaXB0LW9iamVjdC1kZXRlY3Rpb24tZG90LXN5bnRheC12ZXJzdXMtaW4ta2V5d29yZC83MTc0Nzc1IzcxNzQ3NzVcclxuZXhwb3J0IGZ1bmN0aW9uIGhhcyhvYmosIHByb3ApIHsgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApOyB9O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHNldE9wdGlvbnMob3B0aW9ucywgZGVmYXVsdHMpIHtcclxuICAgIGxldCBvdXQgPSB7fTtcclxuICAgIGZvciAoY29uc3QgdiBpbiBkZWZhdWx0cykge1xyXG4gICAgICAgIG91dFt2XSA9IG9wdGlvbnNbdl0gPyBvcHRpb25zW3ZdIDogZGVmYXVsdHNbdl07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBOdW1iZXIgbWFwIGZyb20gb25lIHJhbmdlIHRvIGFub3RoZXIgcmFuZ2VcclxuLy8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20veHBvc2VkYm9uZXMvNzVlYmFlZjNjMTAwNjBhM2VlM2IyNDYxNjZjYWFiNTZcclxuTnVtYmVyLnByb3RvdHlwZS5tYXAgPSBmdW5jdGlvbiAoaW5fbWluLCBpbl9tYXgsIG91dF9taW4sIG91dF9tYXgpIHtcclxuICAgIHJldHVybiAodGhpcyAtIGluX21pbikgKiAob3V0X21heCAtIG91dF9taW4pIC8gKGluX21heCAtIGluX21pbikgKyBvdXRfbWluO1xyXG59OyJdfQ==
