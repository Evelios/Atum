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

var _Util = require("../utilities/Util");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Create a Binary Space Partition Tree of a particular depth
 * 
 * @export
 * @param {Rectangle} bbox The rectangle that the BSP tree is created within
 * @param {object} options The options that can be set to change the properties
 *  of the Binsary Space Partition generation
 * 
 *  options = {
 *    depth {number} : The depth that the BSP tree is created down to,
 *    splitRange {number} : 0-1 The ammount of deviation from the center
 *      that the binary split is allowed to take. 0 Means that the split always,
 *      happens in the middle and 1 means that the split can happen at the edge of
 *      the rectangle.
 *    dropoutRate {number} : 0-1, the percent chance that when dividing a
 *      cell that it will not divide anymore
 *    minArea {number} : the minimum area that a rectangle can become. If the rect is
 *      not at the max depth the subdivision will still stop
 *    minSideLength {number}
 *  }
 * 
 *  defaults = {
 *      depth: 3,
 *      splitRange: 0.5,
 *      dropoutRate: 0.0,
 *      minArea: 0.0,
 *      minSideLength: 0.0,
 *  }
 * @returns 
 */
function binarySpacePartition(bbox, options) {
    "use strict";

    var defaults = {
        depth: 3,
        splitRange: 0.5,
        dropoutRate: 0.0,
        minArea: 0.0,
        minSideLength: 0.0
    };

    var params = (0, _Util.setOptions)(options, defaults);

    // Move back to bbox.copy()
    var root = bbox;
    root.depth = 0;
    var frontier = [root];
    // This is a way of redistributing 2 > infinity (aka 100) where the useable
    // range stays together. Most of the interesting behavior is near 2 - 4
    var splitDenom = (0, _Redist.exp)(params.splitRange, 7, false).map(0, 1, 2, 100);

    while (frontier.length > 0) {
        var node = frontier.pop();

        if (node !== root && _Rand2.default.chance(params.dropoutRate)) {
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

        if (node.depth !== params.depth) {
            frontier.push(leftNode);
            frontier.push(rightNode);
        }
    }

    return root;
} // Tuneable Parameters
// 1.25 guarentee split horiz or vert
// Redistribute the range to split

module.exports = exports["default"];

},{"../geometry/Rectangle":18,"../geometry/Vector":20,"../utilities/Rand":29,"../utilities/Redist":30,"../utilities/Util":31}],15:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvVm9yb25vaS9yaGlsbC12b3Jvbm9pLWNvcmUuanMiLCJub2RlX21vZHVsZXMvYnJvd3Nlci1yZXNvbHZlL2VtcHR5LmpzIiwibm9kZV9tb2R1bGVzL3BvaXNzb24tZGlzay1zYW1wbGUvcG9pc3Nvbi1kaXNrLmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vaW5kZXguanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIvYWxlYS5qcyIsIm5vZGVfbW9kdWxlcy9zZWVkUmFuZG9tL2xpYi90eWNoZWkuanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIveG9yMTI4LmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vbGliL3hvcjQwOTYuanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIveG9yc2hpZnQ3LmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vbGliL3hvcndvdy5qcyIsIm5vZGVfbW9kdWxlcy9zZWVkUmFuZG9tL3NlZWRyYW5kb20uanMiLCJzcmNcXFV0aWxpdGllc1xcUG9pbnREaXN0cmlidXRpb24uanMiLCJzcmNcXFV0aWxpdGllc1xcUmFuZC5qcyIsInNyY1xcYWxnb3JpdGhtc1xcQmluYXJ5U3BhY2VQYXJ0aXRpb24uanMiLCJzcmNcXGFsZ29yaXRobXNcXFJlY3Vyc2l2ZVZvcm9ub2kuanMiLCJzcmNcXGdlb21ldHJ5XFxMaW5lLmpzIiwic3JjXFxnZW9tZXRyeVxcUG9seWdvbi5qcyIsInNyY1xcZ2VvbWV0cnlcXFJlY3RhbmdsZS5qcyIsInNyY1xcZ2VvbWV0cnlcXFRyaWFuZ2xlLmpzIiwic3JjXFxnZW9tZXRyeVxcVmVjdG9yLmpzIiwic3JjXFxncmFwaFxcQ2VudGVyLmpzIiwic3JjXFxncmFwaFxcQ29ybmVyLmpzIiwic3JjXFxncmFwaFxcRGlhZ3JhbS5qcyIsInNyY1xcZ3JhcGhcXEVkZ2UuanMiLCJzcmNcXGdyYXBoXFxHcmFwaC5qcyIsInNyY1xcZ3JhcGhcXFRpbGUuanMiLCJzcmNcXG1haW4uanMiLCJzcmNcXHV0aWxpdGllc1xcUmVkaXN0LmpzIiwic3JjXFx1dGlsaXRpZXNcXFV0aWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNXJEQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ROQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNB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MEIsT0FBMUIsRUFBbUMsT0FBbkMsRUFBNEM7QUFDL0QsV0FBTyxDQUFDLE9BQU8sTUFBUixLQUFtQixVQUFVLE9BQTdCLEtBQXlDLFNBQVMsTUFBbEQsSUFBNEQsT0FBbkU7QUFDSCxDQUZEIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qIVxuQ29weXJpZ2h0IChDKSAyMDEwLTIwMTMgUmF5bW9uZCBIaWxsOiBodHRwczovL2dpdGh1Yi5jb20vZ29yaGlsbC9KYXZhc2NyaXB0LVZvcm9ub2lcbk1JVCBMaWNlbnNlOiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL0xJQ0VOU0UubWRcbiovXG4vKlxuQXV0aG9yOiBSYXltb25kIEhpbGwgKHJoaWxsQHJheW1vbmRoaWxsLm5ldClcbkNvbnRyaWJ1dG9yOiBKZXNzZSBNb3JnYW4gKG1vcmdhamVsQGdtYWlsLmNvbSlcbkZpbGU6IHJoaWxsLXZvcm9ub2ktY29yZS5qc1xuVmVyc2lvbjogMC45OFxuRGF0ZTogSmFudWFyeSAyMSwgMjAxM1xuRGVzY3JpcHRpb246IFRoaXMgaXMgbXkgcGVyc29uYWwgSmF2YXNjcmlwdCBpbXBsZW1lbnRhdGlvbiBvZlxuU3RldmVuIEZvcnR1bmUncyBhbGdvcml0aG0gdG8gY29tcHV0ZSBWb3Jvbm9pIGRpYWdyYW1zLlxuXG5MaWNlbnNlOiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL0xJQ0VOU0UubWRcbkNyZWRpdHM6IFNlZSBodHRwczovL2dpdGh1Yi5jb20vZ29yaGlsbC9KYXZhc2NyaXB0LVZvcm9ub2kvQ1JFRElUUy5tZFxuSGlzdG9yeTogU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9nb3JoaWxsL0phdmFzY3JpcHQtVm9yb25vaS9DSEFOR0VMT0cubWRcblxuIyMgVXNhZ2U6XG5cbiAgdmFyIHNpdGVzID0gW3t4OjMwMCx5OjMwMH0sIHt4OjEwMCx5OjEwMH0sIHt4OjIwMCx5OjUwMH0sIHt4OjI1MCx5OjQ1MH0sIHt4OjYwMCx5OjE1MH1dO1xuICAvLyB4bCwgeHIgbWVhbnMgeCBsZWZ0LCB4IHJpZ2h0XG4gIC8vIHl0LCB5YiBtZWFucyB5IHRvcCwgeSBib3R0b21cbiAgdmFyIGJib3ggPSB7eGw6MCwgeHI6ODAwLCB5dDowLCB5Yjo2MDB9O1xuICB2YXIgdm9yb25vaSA9IG5ldyBWb3Jvbm9pKCk7XG4gIC8vIHBhc3MgYW4gb2JqZWN0IHdoaWNoIGV4aGliaXRzIHhsLCB4ciwgeXQsIHliIHByb3BlcnRpZXMuIFRoZSBib3VuZGluZ1xuICAvLyBib3ggd2lsbCBiZSB1c2VkIHRvIGNvbm5lY3QgdW5ib3VuZCBlZGdlcywgYW5kIHRvIGNsb3NlIG9wZW4gY2VsbHNcbiAgcmVzdWx0ID0gdm9yb25vaS5jb21wdXRlKHNpdGVzLCBiYm94KTtcbiAgLy8gcmVuZGVyLCBmdXJ0aGVyIGFuYWx5emUsIGV0Yy5cblxuUmV0dXJuIHZhbHVlOlxuICBBbiBvYmplY3Qgd2l0aCB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXM6XG5cbiAgcmVzdWx0LnZlcnRpY2VzID0gYW4gYXJyYXkgb2YgdW5vcmRlcmVkLCB1bmlxdWUgVm9yb25vaS5WZXJ0ZXggb2JqZWN0cyBtYWtpbmdcbiAgICB1cCB0aGUgVm9yb25vaSBkaWFncmFtLlxuICByZXN1bHQuZWRnZXMgPSBhbiBhcnJheSBvZiB1bm9yZGVyZWQsIHVuaXF1ZSBWb3Jvbm9pLkVkZ2Ugb2JqZWN0cyBtYWtpbmcgdXBcbiAgICB0aGUgVm9yb25vaSBkaWFncmFtLlxuICByZXN1bHQuY2VsbHMgPSBhbiBhcnJheSBvZiBWb3Jvbm9pLkNlbGwgb2JqZWN0IG1ha2luZyB1cCB0aGUgVm9yb25vaSBkaWFncmFtLlxuICAgIEEgQ2VsbCBvYmplY3QgbWlnaHQgaGF2ZSBhbiBlbXB0eSBhcnJheSBvZiBoYWxmZWRnZXMsIG1lYW5pbmcgbm8gVm9yb25vaVxuICAgIGNlbGwgY291bGQgYmUgY29tcHV0ZWQgZm9yIGEgcGFydGljdWxhciBjZWxsLlxuICByZXN1bHQuZXhlY1RpbWUgPSB0aGUgdGltZSBpdCB0b29rIHRvIGNvbXB1dGUgdGhlIFZvcm9ub2kgZGlhZ3JhbSwgaW5cbiAgICBtaWxsaXNlY29uZHMuXG5cblZvcm9ub2kuVmVydGV4IG9iamVjdDpcbiAgeDogVGhlIHggcG9zaXRpb24gb2YgdGhlIHZlcnRleC5cbiAgeTogVGhlIHkgcG9zaXRpb24gb2YgdGhlIHZlcnRleC5cblxuVm9yb25vaS5FZGdlIG9iamVjdDpcbiAgbFNpdGU6IHRoZSBWb3Jvbm9pIHNpdGUgb2JqZWN0IGF0IHRoZSBsZWZ0IG9mIHRoaXMgVm9yb25vaS5FZGdlIG9iamVjdC5cbiAgclNpdGU6IHRoZSBWb3Jvbm9pIHNpdGUgb2JqZWN0IGF0IHRoZSByaWdodCBvZiB0aGlzIFZvcm9ub2kuRWRnZSBvYmplY3QgKGNhblxuICAgIGJlIG51bGwpLlxuICB2YTogYW4gb2JqZWN0IHdpdGggYW4gJ3gnIGFuZCBhICd5JyBwcm9wZXJ0eSBkZWZpbmluZyB0aGUgc3RhcnQgcG9pbnRcbiAgICAocmVsYXRpdmUgdG8gdGhlIFZvcm9ub2kgc2l0ZSBvbiB0aGUgbGVmdCkgb2YgdGhpcyBWb3Jvbm9pLkVkZ2Ugb2JqZWN0LlxuICB2YjogYW4gb2JqZWN0IHdpdGggYW4gJ3gnIGFuZCBhICd5JyBwcm9wZXJ0eSBkZWZpbmluZyB0aGUgZW5kIHBvaW50XG4gICAgKHJlbGF0aXZlIHRvIFZvcm9ub2kgc2l0ZSBvbiB0aGUgbGVmdCkgb2YgdGhpcyBWb3Jvbm9pLkVkZ2Ugb2JqZWN0LlxuXG4gIEZvciBlZGdlcyB3aGljaCBhcmUgdXNlZCB0byBjbG9zZSBvcGVuIGNlbGxzICh1c2luZyB0aGUgc3VwcGxpZWQgYm91bmRpbmdcbiAgYm94KSwgdGhlIHJTaXRlIHByb3BlcnR5IHdpbGwgYmUgbnVsbC5cblxuVm9yb25vaS5DZWxsIG9iamVjdDpcbiAgc2l0ZTogdGhlIFZvcm9ub2kgc2l0ZSBvYmplY3QgYXNzb2NpYXRlZCB3aXRoIHRoZSBWb3Jvbm9pIGNlbGwuXG4gIGhhbGZlZGdlczogYW4gYXJyYXkgb2YgVm9yb25vaS5IYWxmZWRnZSBvYmplY3RzLCBvcmRlcmVkIGNvdW50ZXJjbG9ja3dpc2UsXG4gICAgZGVmaW5pbmcgdGhlIHBvbHlnb24gZm9yIHRoaXMgVm9yb25vaSBjZWxsLlxuXG5Wb3Jvbm9pLkhhbGZlZGdlIG9iamVjdDpcbiAgc2l0ZTogdGhlIFZvcm9ub2kgc2l0ZSBvYmplY3Qgb3duaW5nIHRoaXMgVm9yb25vaS5IYWxmZWRnZSBvYmplY3QuXG4gIGVkZ2U6IGEgcmVmZXJlbmNlIHRvIHRoZSB1bmlxdWUgVm9yb25vaS5FZGdlIG9iamVjdCB1bmRlcmx5aW5nIHRoaXNcbiAgICBWb3Jvbm9pLkhhbGZlZGdlIG9iamVjdC5cbiAgZ2V0U3RhcnRwb2ludCgpOiBhIG1ldGhvZCByZXR1cm5pbmcgYW4gb2JqZWN0IHdpdGggYW4gJ3gnIGFuZCBhICd5JyBwcm9wZXJ0eVxuICAgIGZvciB0aGUgc3RhcnQgcG9pbnQgb2YgdGhpcyBoYWxmZWRnZS4gS2VlcCBpbiBtaW5kIGhhbGZlZGdlcyBhcmUgYWx3YXlzXG4gICAgY291bnRlcmNvY2t3aXNlLlxuICBnZXRFbmRwb2ludCgpOiBhIG1ldGhvZCByZXR1cm5pbmcgYW4gb2JqZWN0IHdpdGggYW4gJ3gnIGFuZCBhICd5JyBwcm9wZXJ0eVxuICAgIGZvciB0aGUgZW5kIHBvaW50IG9mIHRoaXMgaGFsZmVkZ2UuIEtlZXAgaW4gbWluZCBoYWxmZWRnZXMgYXJlIGFsd2F5c1xuICAgIGNvdW50ZXJjb2Nrd2lzZS5cblxuVE9ETzogSWRlbnRpZnkgb3Bwb3J0dW5pdGllcyBmb3IgcGVyZm9ybWFuY2UgaW1wcm92ZW1lbnQuXG5cblRPRE86IExldCB0aGUgdXNlciBjbG9zZSB0aGUgVm9yb25vaSBjZWxscywgZG8gbm90IGRvIGl0IGF1dG9tYXRpY2FsbHkuIE5vdCBvbmx5IGxldFxuICAgICAgaGltIGNsb3NlIHRoZSBjZWxscywgYnV0IGFsc28gYWxsb3cgaGltIHRvIGNsb3NlIG1vcmUgdGhhbiBvbmNlIHVzaW5nIGEgZGlmZmVyZW50XG4gICAgICBib3VuZGluZyBib3ggZm9yIHRoZSBzYW1lIFZvcm9ub2kgZGlhZ3JhbS5cbiovXG5cbi8qZ2xvYmFsIE1hdGggKi9cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIFZvcm9ub2koKSB7XG4gICAgdGhpcy52ZXJ0aWNlcyA9IG51bGw7XG4gICAgdGhpcy5lZGdlcyA9IG51bGw7XG4gICAgdGhpcy5jZWxscyA9IG51bGw7XG4gICAgdGhpcy50b1JlY3ljbGUgPSBudWxsO1xuICAgIHRoaXMuYmVhY2hzZWN0aW9uSnVua3lhcmQgPSBbXTtcbiAgICB0aGlzLmNpcmNsZUV2ZW50SnVua3lhcmQgPSBbXTtcbiAgICB0aGlzLnZlcnRleEp1bmt5YXJkID0gW107XG4gICAgdGhpcy5lZGdlSnVua3lhcmQgPSBbXTtcbiAgICB0aGlzLmNlbGxKdW5reWFyZCA9IFtdO1xuICAgIH1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cblZvcm9ub2kucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLmJlYWNobGluZSkge1xuICAgICAgICB0aGlzLmJlYWNobGluZSA9IG5ldyB0aGlzLlJCVHJlZSgpO1xuICAgICAgICB9XG4gICAgLy8gTW92ZSBsZWZ0b3ZlciBiZWFjaHNlY3Rpb25zIHRvIHRoZSBiZWFjaHNlY3Rpb24ganVua3lhcmQuXG4gICAgaWYgKHRoaXMuYmVhY2hsaW5lLnJvb3QpIHtcbiAgICAgICAgdmFyIGJlYWNoc2VjdGlvbiA9IHRoaXMuYmVhY2hsaW5lLmdldEZpcnN0KHRoaXMuYmVhY2hsaW5lLnJvb3QpO1xuICAgICAgICB3aGlsZSAoYmVhY2hzZWN0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmJlYWNoc2VjdGlvbkp1bmt5YXJkLnB1c2goYmVhY2hzZWN0aW9uKTsgLy8gbWFyayBmb3IgcmV1c2VcbiAgICAgICAgICAgIGJlYWNoc2VjdGlvbiA9IGJlYWNoc2VjdGlvbi5yYk5leHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB0aGlzLmJlYWNobGluZS5yb290ID0gbnVsbDtcbiAgICBpZiAoIXRoaXMuY2lyY2xlRXZlbnRzKSB7XG4gICAgICAgIHRoaXMuY2lyY2xlRXZlbnRzID0gbmV3IHRoaXMuUkJUcmVlKCk7XG4gICAgICAgIH1cbiAgICB0aGlzLmNpcmNsZUV2ZW50cy5yb290ID0gdGhpcy5maXJzdENpcmNsZUV2ZW50ID0gbnVsbDtcbiAgICB0aGlzLnZlcnRpY2VzID0gW107XG4gICAgdGhpcy5lZGdlcyA9IFtdO1xuICAgIHRoaXMuY2VsbHMgPSBbXTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5zcXJ0ID0gTWF0aC5zcXJ0O1xuVm9yb25vaS5wcm90b3R5cGUuYWJzID0gTWF0aC5hYnM7XG5Wb3Jvbm9pLnByb3RvdHlwZS7OtSA9IFZvcm9ub2kuzrUgPSAxZS05O1xuVm9yb25vaS5wcm90b3R5cGUuaW52zrUgPSBWb3Jvbm9pLmluds61ID0gMS4wIC8gVm9yb25vaS7OtTtcblZvcm9ub2kucHJvdG90eXBlLmVxdWFsV2l0aEVwc2lsb24gPSBmdW5jdGlvbihhLGIpe3JldHVybiB0aGlzLmFicyhhLWIpPDFlLTk7fTtcblZvcm9ub2kucHJvdG90eXBlLmdyZWF0ZXJUaGFuV2l0aEVwc2lsb24gPSBmdW5jdGlvbihhLGIpe3JldHVybiBhLWI+MWUtOTt9O1xuVm9yb25vaS5wcm90b3R5cGUuZ3JlYXRlclRoYW5PckVxdWFsV2l0aEVwc2lsb24gPSBmdW5jdGlvbihhLGIpe3JldHVybiBiLWE8MWUtOTt9O1xuVm9yb25vaS5wcm90b3R5cGUubGVzc1RoYW5XaXRoRXBzaWxvbiA9IGZ1bmN0aW9uKGEsYil7cmV0dXJuIGItYT4xZS05O307XG5Wb3Jvbm9pLnByb3RvdHlwZS5sZXNzVGhhbk9yRXF1YWxXaXRoRXBzaWxvbiA9IGZ1bmN0aW9uKGEsYil7cmV0dXJuIGEtYjwxZS05O307XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVkLUJsYWNrIHRyZWUgY29kZSAoYmFzZWQgb24gQyB2ZXJzaW9uIG9mIFwicmJ0cmVlXCIgYnkgRnJhbmNrIEJ1aS1IdXVcbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9mYnVpaHV1L2xpYnRyZWUvYmxvYi9tYXN0ZXIvcmIuY1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnJvb3QgPSBudWxsO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLlJCVHJlZS5wcm90b3R5cGUucmJJbnNlcnRTdWNjZXNzb3IgPSBmdW5jdGlvbihub2RlLCBzdWNjZXNzb3IpIHtcbiAgICB2YXIgcGFyZW50O1xuICAgIGlmIChub2RlKSB7XG4gICAgICAgIC8vID4+PiByaGlsbCAyMDExLTA1LTI3OiBQZXJmb3JtYW5jZTogY2FjaGUgcHJldmlvdXMvbmV4dCBub2Rlc1xuICAgICAgICBzdWNjZXNzb3IucmJQcmV2aW91cyA9IG5vZGU7XG4gICAgICAgIHN1Y2Nlc3Nvci5yYk5leHQgPSBub2RlLnJiTmV4dDtcbiAgICAgICAgaWYgKG5vZGUucmJOZXh0KSB7XG4gICAgICAgICAgICBub2RlLnJiTmV4dC5yYlByZXZpb3VzID0gc3VjY2Vzc29yO1xuICAgICAgICAgICAgfVxuICAgICAgICBub2RlLnJiTmV4dCA9IHN1Y2Nlc3NvcjtcbiAgICAgICAgLy8gPDw8XG4gICAgICAgIGlmIChub2RlLnJiUmlnaHQpIHtcbiAgICAgICAgICAgIC8vIGluLXBsYWNlIGV4cGFuc2lvbiBvZiBub2RlLnJiUmlnaHQuZ2V0Rmlyc3QoKTtcbiAgICAgICAgICAgIG5vZGUgPSBub2RlLnJiUmlnaHQ7XG4gICAgICAgICAgICB3aGlsZSAobm9kZS5yYkxlZnQpIHtub2RlID0gbm9kZS5yYkxlZnQ7fVxuICAgICAgICAgICAgbm9kZS5yYkxlZnQgPSBzdWNjZXNzb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgbm9kZS5yYlJpZ2h0ID0gc3VjY2Vzc29yO1xuICAgICAgICAgICAgfVxuICAgICAgICBwYXJlbnQgPSBub2RlO1xuICAgICAgICB9XG4gICAgLy8gcmhpbGwgMjAxMS0wNi0wNzogaWYgbm9kZSBpcyBudWxsLCBzdWNjZXNzb3IgbXVzdCBiZSBpbnNlcnRlZFxuICAgIC8vIHRvIHRoZSBsZWZ0LW1vc3QgcGFydCBvZiB0aGUgdHJlZVxuICAgIGVsc2UgaWYgKHRoaXMucm9vdCkge1xuICAgICAgICBub2RlID0gdGhpcy5nZXRGaXJzdCh0aGlzLnJvb3QpO1xuICAgICAgICAvLyA+Pj4gUGVyZm9ybWFuY2U6IGNhY2hlIHByZXZpb3VzL25leHQgbm9kZXNcbiAgICAgICAgc3VjY2Vzc29yLnJiUHJldmlvdXMgPSBudWxsO1xuICAgICAgICBzdWNjZXNzb3IucmJOZXh0ID0gbm9kZTtcbiAgICAgICAgbm9kZS5yYlByZXZpb3VzID0gc3VjY2Vzc29yO1xuICAgICAgICAvLyA8PDxcbiAgICAgICAgbm9kZS5yYkxlZnQgPSBzdWNjZXNzb3I7XG4gICAgICAgIHBhcmVudCA9IG5vZGU7XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgLy8gPj4+IFBlcmZvcm1hbmNlOiBjYWNoZSBwcmV2aW91cy9uZXh0IG5vZGVzXG4gICAgICAgIHN1Y2Nlc3Nvci5yYlByZXZpb3VzID0gc3VjY2Vzc29yLnJiTmV4dCA9IG51bGw7XG4gICAgICAgIC8vIDw8PFxuICAgICAgICB0aGlzLnJvb3QgPSBzdWNjZXNzb3I7XG4gICAgICAgIHBhcmVudCA9IG51bGw7XG4gICAgICAgIH1cbiAgICBzdWNjZXNzb3IucmJMZWZ0ID0gc3VjY2Vzc29yLnJiUmlnaHQgPSBudWxsO1xuICAgIHN1Y2Nlc3Nvci5yYlBhcmVudCA9IHBhcmVudDtcbiAgICBzdWNjZXNzb3IucmJSZWQgPSB0cnVlO1xuICAgIC8vIEZpeHVwIHRoZSBtb2RpZmllZCB0cmVlIGJ5IHJlY29sb3Jpbmcgbm9kZXMgYW5kIHBlcmZvcm1pbmdcbiAgICAvLyByb3RhdGlvbnMgKDIgYXQgbW9zdCkgaGVuY2UgdGhlIHJlZC1ibGFjayB0cmVlIHByb3BlcnRpZXMgYXJlXG4gICAgLy8gcHJlc2VydmVkLlxuICAgIHZhciBncmFuZHBhLCB1bmNsZTtcbiAgICBub2RlID0gc3VjY2Vzc29yO1xuICAgIHdoaWxlIChwYXJlbnQgJiYgcGFyZW50LnJiUmVkKSB7XG4gICAgICAgIGdyYW5kcGEgPSBwYXJlbnQucmJQYXJlbnQ7XG4gICAgICAgIGlmIChwYXJlbnQgPT09IGdyYW5kcGEucmJMZWZ0KSB7XG4gICAgICAgICAgICB1bmNsZSA9IGdyYW5kcGEucmJSaWdodDtcbiAgICAgICAgICAgIGlmICh1bmNsZSAmJiB1bmNsZS5yYlJlZCkge1xuICAgICAgICAgICAgICAgIHBhcmVudC5yYlJlZCA9IHVuY2xlLnJiUmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgZ3JhbmRwYS5yYlJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgbm9kZSA9IGdyYW5kcGE7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgaWYgKG5vZGUgPT09IHBhcmVudC5yYlJpZ2h0KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVMZWZ0KHBhcmVudCk7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUgPSBwYXJlbnQ7XG4gICAgICAgICAgICAgICAgICAgIHBhcmVudCA9IG5vZGUucmJQYXJlbnQ7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBncmFuZHBhLnJiUmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlUmlnaHQoZ3JhbmRwYSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHVuY2xlID0gZ3JhbmRwYS5yYkxlZnQ7XG4gICAgICAgICAgICBpZiAodW5jbGUgJiYgdW5jbGUucmJSZWQpIHtcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSB1bmNsZS5yYlJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIGdyYW5kcGEucmJSZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIG5vZGUgPSBncmFuZHBhO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGlmIChub2RlID09PSBwYXJlbnQucmJMZWZ0KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVSaWdodChwYXJlbnQpO1xuICAgICAgICAgICAgICAgICAgICBub2RlID0gcGFyZW50O1xuICAgICAgICAgICAgICAgICAgICBwYXJlbnQgPSBub2RlLnJiUGFyZW50O1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcGFyZW50LnJiUmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgZ3JhbmRwYS5yYlJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZUxlZnQoZ3JhbmRwYSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICBwYXJlbnQgPSBub2RlLnJiUGFyZW50O1xuICAgICAgICB9XG4gICAgdGhpcy5yb290LnJiUmVkID0gZmFsc2U7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuUkJUcmVlLnByb3RvdHlwZS5yYlJlbW92ZU5vZGUgPSBmdW5jdGlvbihub2RlKSB7XG4gICAgLy8gPj4+IHJoaWxsIDIwMTEtMDUtMjc6IFBlcmZvcm1hbmNlOiBjYWNoZSBwcmV2aW91cy9uZXh0IG5vZGVzXG4gICAgaWYgKG5vZGUucmJOZXh0KSB7XG4gICAgICAgIG5vZGUucmJOZXh0LnJiUHJldmlvdXMgPSBub2RlLnJiUHJldmlvdXM7XG4gICAgICAgIH1cbiAgICBpZiAobm9kZS5yYlByZXZpb3VzKSB7XG4gICAgICAgIG5vZGUucmJQcmV2aW91cy5yYk5leHQgPSBub2RlLnJiTmV4dDtcbiAgICAgICAgfVxuICAgIG5vZGUucmJOZXh0ID0gbm9kZS5yYlByZXZpb3VzID0gbnVsbDtcbiAgICAvLyA8PDxcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5yYlBhcmVudCxcbiAgICAgICAgbGVmdCA9IG5vZGUucmJMZWZ0LFxuICAgICAgICByaWdodCA9IG5vZGUucmJSaWdodCxcbiAgICAgICAgbmV4dDtcbiAgICBpZiAoIWxlZnQpIHtcbiAgICAgICAgbmV4dCA9IHJpZ2h0O1xuICAgICAgICB9XG4gICAgZWxzZSBpZiAoIXJpZ2h0KSB7XG4gICAgICAgIG5leHQgPSBsZWZ0O1xuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIG5leHQgPSB0aGlzLmdldEZpcnN0KHJpZ2h0KTtcbiAgICAgICAgfVxuICAgIGlmIChwYXJlbnQpIHtcbiAgICAgICAgaWYgKHBhcmVudC5yYkxlZnQgPT09IG5vZGUpIHtcbiAgICAgICAgICAgIHBhcmVudC5yYkxlZnQgPSBuZXh0O1xuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHBhcmVudC5yYlJpZ2h0ID0gbmV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICB0aGlzLnJvb3QgPSBuZXh0O1xuICAgICAgICB9XG4gICAgLy8gZW5mb3JjZSByZWQtYmxhY2sgcnVsZXNcbiAgICB2YXIgaXNSZWQ7XG4gICAgaWYgKGxlZnQgJiYgcmlnaHQpIHtcbiAgICAgICAgaXNSZWQgPSBuZXh0LnJiUmVkO1xuICAgICAgICBuZXh0LnJiUmVkID0gbm9kZS5yYlJlZDtcbiAgICAgICAgbmV4dC5yYkxlZnQgPSBsZWZ0O1xuICAgICAgICBsZWZ0LnJiUGFyZW50ID0gbmV4dDtcbiAgICAgICAgaWYgKG5leHQgIT09IHJpZ2h0KSB7XG4gICAgICAgICAgICBwYXJlbnQgPSBuZXh0LnJiUGFyZW50O1xuICAgICAgICAgICAgbmV4dC5yYlBhcmVudCA9IG5vZGUucmJQYXJlbnQ7XG4gICAgICAgICAgICBub2RlID0gbmV4dC5yYlJpZ2h0O1xuICAgICAgICAgICAgcGFyZW50LnJiTGVmdCA9IG5vZGU7XG4gICAgICAgICAgICBuZXh0LnJiUmlnaHQgPSByaWdodDtcbiAgICAgICAgICAgIHJpZ2h0LnJiUGFyZW50ID0gbmV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBuZXh0LnJiUGFyZW50ID0gcGFyZW50O1xuICAgICAgICAgICAgcGFyZW50ID0gbmV4dDtcbiAgICAgICAgICAgIG5vZGUgPSBuZXh0LnJiUmlnaHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaXNSZWQgPSBub2RlLnJiUmVkO1xuICAgICAgICBub2RlID0gbmV4dDtcbiAgICAgICAgfVxuICAgIC8vICdub2RlJyBpcyBub3cgdGhlIHNvbGUgc3VjY2Vzc29yJ3MgY2hpbGQgYW5kICdwYXJlbnQnIGl0c1xuICAgIC8vIG5ldyBwYXJlbnQgKHNpbmNlIHRoZSBzdWNjZXNzb3IgY2FuIGhhdmUgYmVlbiBtb3ZlZClcbiAgICBpZiAobm9kZSkge1xuICAgICAgICBub2RlLnJiUGFyZW50ID0gcGFyZW50O1xuICAgICAgICB9XG4gICAgLy8gdGhlICdlYXN5JyBjYXNlc1xuICAgIGlmIChpc1JlZCkge3JldHVybjt9XG4gICAgaWYgKG5vZGUgJiYgbm9kZS5yYlJlZCkge1xuICAgICAgICBub2RlLnJiUmVkID0gZmFsc2U7XG4gICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgIC8vIHRoZSBvdGhlciBjYXNlc1xuICAgIHZhciBzaWJsaW5nO1xuICAgIGRvIHtcbiAgICAgICAgaWYgKG5vZGUgPT09IHRoaXMucm9vdCkge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIGlmIChub2RlID09PSBwYXJlbnQucmJMZWZ0KSB7XG4gICAgICAgICAgICBzaWJsaW5nID0gcGFyZW50LnJiUmlnaHQ7XG4gICAgICAgICAgICBpZiAoc2libGluZy5yYlJlZCkge1xuICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVMZWZ0KHBhcmVudCk7XG4gICAgICAgICAgICAgICAgc2libGluZyA9IHBhcmVudC5yYlJpZ2h0O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICgoc2libGluZy5yYkxlZnQgJiYgc2libGluZy5yYkxlZnQucmJSZWQpIHx8IChzaWJsaW5nLnJiUmlnaHQgJiYgc2libGluZy5yYlJpZ2h0LnJiUmVkKSkge1xuICAgICAgICAgICAgICAgIGlmICghc2libGluZy5yYlJpZ2h0IHx8ICFzaWJsaW5nLnJiUmlnaHQucmJSZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgc2libGluZy5yYkxlZnQucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgc2libGluZy5yYlJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVSaWdodChzaWJsaW5nKTtcbiAgICAgICAgICAgICAgICAgICAgc2libGluZyA9IHBhcmVudC5yYlJpZ2h0O1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2libGluZy5yYlJlZCA9IHBhcmVudC5yYlJlZDtcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSBzaWJsaW5nLnJiUmlnaHQucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlTGVmdChwYXJlbnQpO1xuICAgICAgICAgICAgICAgIG5vZGUgPSB0aGlzLnJvb3Q7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHNpYmxpbmcgPSBwYXJlbnQucmJMZWZ0O1xuICAgICAgICAgICAgaWYgKHNpYmxpbmcucmJSZWQpIHtcbiAgICAgICAgICAgICAgICBzaWJsaW5nLnJiUmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcGFyZW50LnJiUmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlUmlnaHQocGFyZW50KTtcbiAgICAgICAgICAgICAgICBzaWJsaW5nID0gcGFyZW50LnJiTGVmdDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoKHNpYmxpbmcucmJMZWZ0ICYmIHNpYmxpbmcucmJMZWZ0LnJiUmVkKSB8fCAoc2libGluZy5yYlJpZ2h0ICYmIHNpYmxpbmcucmJSaWdodC5yYlJlZCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXNpYmxpbmcucmJMZWZ0IHx8ICFzaWJsaW5nLnJiTGVmdC5yYlJlZCkge1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5nLnJiUmlnaHQucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgc2libGluZy5yYlJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVMZWZ0KHNpYmxpbmcpO1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5nID0gcGFyZW50LnJiTGVmdDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSZWQgPSBwYXJlbnQucmJSZWQ7XG4gICAgICAgICAgICAgICAgcGFyZW50LnJiUmVkID0gc2libGluZy5yYkxlZnQucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlUmlnaHQocGFyZW50KTtcbiAgICAgICAgICAgICAgICBub2RlID0gdGhpcy5yb290O1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgc2libGluZy5yYlJlZCA9IHRydWU7XG4gICAgICAgIG5vZGUgPSBwYXJlbnQ7XG4gICAgICAgIHBhcmVudCA9IHBhcmVudC5yYlBhcmVudDtcbiAgICB9IHdoaWxlICghbm9kZS5yYlJlZCk7XG4gICAgaWYgKG5vZGUpIHtub2RlLnJiUmVkID0gZmFsc2U7fVxuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLlJCVHJlZS5wcm90b3R5cGUucmJSb3RhdGVMZWZ0ID0gZnVuY3Rpb24obm9kZSkge1xuICAgIHZhciBwID0gbm9kZSxcbiAgICAgICAgcSA9IG5vZGUucmJSaWdodCwgLy8gY2FuJ3QgYmUgbnVsbFxuICAgICAgICBwYXJlbnQgPSBwLnJiUGFyZW50O1xuICAgIGlmIChwYXJlbnQpIHtcbiAgICAgICAgaWYgKHBhcmVudC5yYkxlZnQgPT09IHApIHtcbiAgICAgICAgICAgIHBhcmVudC5yYkxlZnQgPSBxO1xuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHBhcmVudC5yYlJpZ2h0ID0gcTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICB0aGlzLnJvb3QgPSBxO1xuICAgICAgICB9XG4gICAgcS5yYlBhcmVudCA9IHBhcmVudDtcbiAgICBwLnJiUGFyZW50ID0gcTtcbiAgICBwLnJiUmlnaHQgPSBxLnJiTGVmdDtcbiAgICBpZiAocC5yYlJpZ2h0KSB7XG4gICAgICAgIHAucmJSaWdodC5yYlBhcmVudCA9IHA7XG4gICAgICAgIH1cbiAgICBxLnJiTGVmdCA9IHA7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuUkJUcmVlLnByb3RvdHlwZS5yYlJvdGF0ZVJpZ2h0ID0gZnVuY3Rpb24obm9kZSkge1xuICAgIHZhciBwID0gbm9kZSxcbiAgICAgICAgcSA9IG5vZGUucmJMZWZ0LCAvLyBjYW4ndCBiZSBudWxsXG4gICAgICAgIHBhcmVudCA9IHAucmJQYXJlbnQ7XG4gICAgaWYgKHBhcmVudCkge1xuICAgICAgICBpZiAocGFyZW50LnJiTGVmdCA9PT0gcCkge1xuICAgICAgICAgICAgcGFyZW50LnJiTGVmdCA9IHE7XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcGFyZW50LnJiUmlnaHQgPSBxO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHRoaXMucm9vdCA9IHE7XG4gICAgICAgIH1cbiAgICBxLnJiUGFyZW50ID0gcGFyZW50O1xuICAgIHAucmJQYXJlbnQgPSBxO1xuICAgIHAucmJMZWZ0ID0gcS5yYlJpZ2h0O1xuICAgIGlmIChwLnJiTGVmdCkge1xuICAgICAgICBwLnJiTGVmdC5yYlBhcmVudCA9IHA7XG4gICAgICAgIH1cbiAgICBxLnJiUmlnaHQgPSBwO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLlJCVHJlZS5wcm90b3R5cGUuZ2V0Rmlyc3QgPSBmdW5jdGlvbihub2RlKSB7XG4gICAgd2hpbGUgKG5vZGUucmJMZWZ0KSB7XG4gICAgICAgIG5vZGUgPSBub2RlLnJiTGVmdDtcbiAgICAgICAgfVxuICAgIHJldHVybiBub2RlO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLlJCVHJlZS5wcm90b3R5cGUuZ2V0TGFzdCA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICB3aGlsZSAobm9kZS5yYlJpZ2h0KSB7XG4gICAgICAgIG5vZGUgPSBub2RlLnJiUmlnaHQ7XG4gICAgICAgIH1cbiAgICByZXR1cm4gbm9kZTtcbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERpYWdyYW0gbWV0aG9kc1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5EaWFncmFtID0gZnVuY3Rpb24oc2l0ZSkge1xuICAgIHRoaXMuc2l0ZSA9IHNpdGU7XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDZWxsIG1ldGhvZHNcblxuVm9yb25vaS5wcm90b3R5cGUuQ2VsbCA9IGZ1bmN0aW9uKHNpdGUpIHtcbiAgICB0aGlzLnNpdGUgPSBzaXRlO1xuICAgIHRoaXMuaGFsZmVkZ2VzID0gW107XG4gICAgdGhpcy5jbG9zZU1lID0gZmFsc2U7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuQ2VsbC5wcm90b3R5cGUuaW5pdCA9IGZ1bmN0aW9uKHNpdGUpIHtcbiAgICB0aGlzLnNpdGUgPSBzaXRlO1xuICAgIHRoaXMuaGFsZmVkZ2VzID0gW107XG4gICAgdGhpcy5jbG9zZU1lID0gZmFsc2U7XG4gICAgcmV0dXJuIHRoaXM7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuY3JlYXRlQ2VsbCA9IGZ1bmN0aW9uKHNpdGUpIHtcbiAgICB2YXIgY2VsbCA9IHRoaXMuY2VsbEp1bmt5YXJkLnBvcCgpO1xuICAgIGlmICggY2VsbCApIHtcbiAgICAgICAgcmV0dXJuIGNlbGwuaW5pdChzaXRlKTtcbiAgICAgICAgfVxuICAgIHJldHVybiBuZXcgdGhpcy5DZWxsKHNpdGUpO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLkNlbGwucHJvdG90eXBlLnByZXBhcmVIYWxmZWRnZXMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgaGFsZmVkZ2VzID0gdGhpcy5oYWxmZWRnZXMsXG4gICAgICAgIGlIYWxmZWRnZSA9IGhhbGZlZGdlcy5sZW5ndGgsXG4gICAgICAgIGVkZ2U7XG4gICAgLy8gZ2V0IHJpZCBvZiB1bnVzZWQgaGFsZmVkZ2VzXG4gICAgLy8gcmhpbGwgMjAxMS0wNS0yNzogS2VlcCBpdCBzaW1wbGUsIG5vIHBvaW50IGhlcmUgaW4gdHJ5aW5nXG4gICAgLy8gdG8gYmUgZmFuY3k6IGRhbmdsaW5nIGVkZ2VzIGFyZSBhIHR5cGljYWxseSBhIG1pbm9yaXR5LlxuICAgIHdoaWxlIChpSGFsZmVkZ2UtLSkge1xuICAgICAgICBlZGdlID0gaGFsZmVkZ2VzW2lIYWxmZWRnZV0uZWRnZTtcbiAgICAgICAgaWYgKCFlZGdlLnZiIHx8ICFlZGdlLnZhKSB7XG4gICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlIYWxmZWRnZSwxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgLy8gcmhpbGwgMjAxMS0wNS0yNjogSSB0cmllZCB0byB1c2UgYSBiaW5hcnkgc2VhcmNoIGF0IGluc2VydGlvblxuICAgIC8vIHRpbWUgdG8ga2VlcCB0aGUgYXJyYXkgc29ydGVkIG9uLXRoZS1mbHkgKGluIENlbGwuYWRkSGFsZmVkZ2UoKSkuXG4gICAgLy8gVGhlcmUgd2FzIG5vIHJlYWwgYmVuZWZpdHMgaW4gZG9pbmcgc28sIHBlcmZvcm1hbmNlIG9uXG4gICAgLy8gRmlyZWZveCAzLjYgd2FzIGltcHJvdmVkIG1hcmdpbmFsbHksIHdoaWxlIHBlcmZvcm1hbmNlIG9uXG4gICAgLy8gT3BlcmEgMTEgd2FzIHBlbmFsaXplZCBtYXJnaW5hbGx5LlxuICAgIGhhbGZlZGdlcy5zb3J0KGZ1bmN0aW9uKGEsYil7cmV0dXJuIGIuYW5nbGUtYS5hbmdsZTt9KTtcbiAgICByZXR1cm4gaGFsZmVkZ2VzLmxlbmd0aDtcbiAgICB9O1xuXG4vLyBSZXR1cm4gYSBsaXN0IG9mIHRoZSBuZWlnaGJvciBJZHNcblZvcm9ub2kucHJvdG90eXBlLkNlbGwucHJvdG90eXBlLmdldE5laWdoYm9ySWRzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5laWdoYm9ycyA9IFtdLFxuICAgICAgICBpSGFsZmVkZ2UgPSB0aGlzLmhhbGZlZGdlcy5sZW5ndGgsXG4gICAgICAgIGVkZ2U7XG4gICAgd2hpbGUgKGlIYWxmZWRnZS0tKXtcbiAgICAgICAgZWRnZSA9IHRoaXMuaGFsZmVkZ2VzW2lIYWxmZWRnZV0uZWRnZTtcbiAgICAgICAgaWYgKGVkZ2UubFNpdGUgIT09IG51bGwgJiYgZWRnZS5sU2l0ZS52b3Jvbm9pSWQgIT0gdGhpcy5zaXRlLnZvcm9ub2lJZCkge1xuICAgICAgICAgICAgbmVpZ2hib3JzLnB1c2goZWRnZS5sU2l0ZS52b3Jvbm9pSWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChlZGdlLnJTaXRlICE9PSBudWxsICYmIGVkZ2UuclNpdGUudm9yb25vaUlkICE9IHRoaXMuc2l0ZS52b3Jvbm9pSWQpe1xuICAgICAgICAgICAgbmVpZ2hib3JzLnB1c2goZWRnZS5yU2l0ZS52b3Jvbm9pSWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgcmV0dXJuIG5laWdoYm9ycztcbiAgICB9O1xuXG4vLyBDb21wdXRlIGJvdW5kaW5nIGJveFxuLy9cblZvcm9ub2kucHJvdG90eXBlLkNlbGwucHJvdG90eXBlLmdldEJib3ggPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgaGFsZmVkZ2VzID0gdGhpcy5oYWxmZWRnZXMsXG4gICAgICAgIGlIYWxmZWRnZSA9IGhhbGZlZGdlcy5sZW5ndGgsXG4gICAgICAgIHhtaW4gPSBJbmZpbml0eSxcbiAgICAgICAgeW1pbiA9IEluZmluaXR5LFxuICAgICAgICB4bWF4ID0gLUluZmluaXR5LFxuICAgICAgICB5bWF4ID0gLUluZmluaXR5LFxuICAgICAgICB2LCB2eCwgdnk7XG4gICAgd2hpbGUgKGlIYWxmZWRnZS0tKSB7XG4gICAgICAgIHYgPSBoYWxmZWRnZXNbaUhhbGZlZGdlXS5nZXRTdGFydHBvaW50KCk7XG4gICAgICAgIHZ4ID0gdi54O1xuICAgICAgICB2eSA9IHYueTtcbiAgICAgICAgaWYgKHZ4IDwgeG1pbikge3htaW4gPSB2eDt9XG4gICAgICAgIGlmICh2eSA8IHltaW4pIHt5bWluID0gdnk7fVxuICAgICAgICBpZiAodnggPiB4bWF4KSB7eG1heCA9IHZ4O31cbiAgICAgICAgaWYgKHZ5ID4geW1heCkge3ltYXggPSB2eTt9XG4gICAgICAgIC8vIHdlIGRvbnQgbmVlZCB0byB0YWtlIGludG8gYWNjb3VudCBlbmQgcG9pbnQsXG4gICAgICAgIC8vIHNpbmNlIGVhY2ggZW5kIHBvaW50IG1hdGNoZXMgYSBzdGFydCBwb2ludFxuICAgICAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeDogeG1pbixcbiAgICAgICAgeTogeW1pbixcbiAgICAgICAgd2lkdGg6IHhtYXgteG1pbixcbiAgICAgICAgaGVpZ2h0OiB5bWF4LXltaW5cbiAgICAgICAgfTtcbiAgICB9O1xuXG4vLyBSZXR1cm4gd2hldGhlciBhIHBvaW50IGlzIGluc2lkZSwgb24sIG9yIG91dHNpZGUgdGhlIGNlbGw6XG4vLyAgIC0xOiBwb2ludCBpcyBvdXRzaWRlIHRoZSBwZXJpbWV0ZXIgb2YgdGhlIGNlbGxcbi8vICAgIDA6IHBvaW50IGlzIG9uIHRoZSBwZXJpbWV0ZXIgb2YgdGhlIGNlbGxcbi8vICAgIDE6IHBvaW50IGlzIGluc2lkZSB0aGUgcGVyaW1ldGVyIG9mIHRoZSBjZWxsXG4vL1xuVm9yb25vaS5wcm90b3R5cGUuQ2VsbC5wcm90b3R5cGUucG9pbnRJbnRlcnNlY3Rpb24gPSBmdW5jdGlvbih4LCB5KSB7XG4gICAgLy8gQ2hlY2sgaWYgcG9pbnQgaW4gcG9seWdvbi4gU2luY2UgYWxsIHBvbHlnb25zIG9mIGEgVm9yb25vaVxuICAgIC8vIGRpYWdyYW0gYXJlIGNvbnZleCwgdGhlbjpcbiAgICAvLyBodHRwOi8vcGF1bGJvdXJrZS5uZXQvZ2VvbWV0cnkvcG9seWdvbm1lc2gvXG4gICAgLy8gU29sdXRpb24gMyAoMkQpOlxuICAgIC8vICAgXCJJZiB0aGUgcG9seWdvbiBpcyBjb252ZXggdGhlbiBvbmUgY2FuIGNvbnNpZGVyIHRoZSBwb2x5Z29uXG4gICAgLy8gICBcImFzIGEgJ3BhdGgnIGZyb20gdGhlIGZpcnN0IHZlcnRleC4gQSBwb2ludCBpcyBvbiB0aGUgaW50ZXJpb3JcbiAgICAvLyAgIFwib2YgdGhpcyBwb2x5Z29ucyBpZiBpdCBpcyBhbHdheXMgb24gdGhlIHNhbWUgc2lkZSBvZiBhbGwgdGhlXG4gICAgLy8gICBcImxpbmUgc2VnbWVudHMgbWFraW5nIHVwIHRoZSBwYXRoLiAuLi5cbiAgICAvLyAgIFwiKHkgLSB5MCkgKHgxIC0geDApIC0gKHggLSB4MCkgKHkxIC0geTApXG4gICAgLy8gICBcImlmIGl0IGlzIGxlc3MgdGhhbiAwIHRoZW4gUCBpcyB0byB0aGUgcmlnaHQgb2YgdGhlIGxpbmUgc2VnbWVudCxcbiAgICAvLyAgIFwiaWYgZ3JlYXRlciB0aGFuIDAgaXQgaXMgdG8gdGhlIGxlZnQsIGlmIGVxdWFsIHRvIDAgdGhlbiBpdCBsaWVzXG4gICAgLy8gICBcIm9uIHRoZSBsaW5lIHNlZ21lbnRcIlxuICAgIHZhciBoYWxmZWRnZXMgPSB0aGlzLmhhbGZlZGdlcyxcbiAgICAgICAgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aCxcbiAgICAgICAgaGFsZmVkZ2UsXG4gICAgICAgIHAwLCBwMSwgcjtcbiAgICB3aGlsZSAoaUhhbGZlZGdlLS0pIHtcbiAgICAgICAgaGFsZmVkZ2UgPSBoYWxmZWRnZXNbaUhhbGZlZGdlXTtcbiAgICAgICAgcDAgPSBoYWxmZWRnZS5nZXRTdGFydHBvaW50KCk7XG4gICAgICAgIHAxID0gaGFsZmVkZ2UuZ2V0RW5kcG9pbnQoKTtcbiAgICAgICAgciA9ICh5LXAwLnkpKihwMS54LXAwLngpLSh4LXAwLngpKihwMS55LXAwLnkpO1xuICAgICAgICBpZiAoIXIpIHtcbiAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICAgICAgfVxuICAgICAgICBpZiAociA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiAtMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIHJldHVybiAxO1xuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRWRnZSBtZXRob2RzXG4vL1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5WZXJ0ZXggPSBmdW5jdGlvbih4LCB5KSB7XG4gICAgdGhpcy54ID0geDtcbiAgICB0aGlzLnkgPSB5O1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLkVkZ2UgPSBmdW5jdGlvbihsU2l0ZSwgclNpdGUpIHtcbiAgICB0aGlzLmxTaXRlID0gbFNpdGU7XG4gICAgdGhpcy5yU2l0ZSA9IHJTaXRlO1xuICAgIHRoaXMudmEgPSB0aGlzLnZiID0gbnVsbDtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5IYWxmZWRnZSA9IGZ1bmN0aW9uKGVkZ2UsIGxTaXRlLCByU2l0ZSkge1xuICAgIHRoaXMuc2l0ZSA9IGxTaXRlO1xuICAgIHRoaXMuZWRnZSA9IGVkZ2U7XG4gICAgLy8gJ2FuZ2xlJyBpcyBhIHZhbHVlIHRvIGJlIHVzZWQgZm9yIHByb3Blcmx5IHNvcnRpbmcgdGhlXG4gICAgLy8gaGFsZnNlZ21lbnRzIGNvdW50ZXJjbG9ja3dpc2UuIEJ5IGNvbnZlbnRpb24sIHdlIHdpbGxcbiAgICAvLyB1c2UgdGhlIGFuZ2xlIG9mIHRoZSBsaW5lIGRlZmluZWQgYnkgdGhlICdzaXRlIHRvIHRoZSBsZWZ0J1xuICAgIC8vIHRvIHRoZSAnc2l0ZSB0byB0aGUgcmlnaHQnLlxuICAgIC8vIEhvd2V2ZXIsIGJvcmRlciBlZGdlcyBoYXZlIG5vICdzaXRlIHRvIHRoZSByaWdodCc6IHRodXMgd2VcbiAgICAvLyB1c2UgdGhlIGFuZ2xlIG9mIGxpbmUgcGVycGVuZGljdWxhciB0byB0aGUgaGFsZnNlZ21lbnQgKHRoZVxuICAgIC8vIGVkZ2Ugc2hvdWxkIGhhdmUgYm90aCBlbmQgcG9pbnRzIGRlZmluZWQgaW4gc3VjaCBjYXNlLilcbiAgICBpZiAoclNpdGUpIHtcbiAgICAgICAgdGhpcy5hbmdsZSA9IE1hdGguYXRhbjIoclNpdGUueS1sU2l0ZS55LCByU2l0ZS54LWxTaXRlLngpO1xuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHZhciB2YSA9IGVkZ2UudmEsXG4gICAgICAgICAgICB2YiA9IGVkZ2UudmI7XG4gICAgICAgIC8vIHJoaWxsIDIwMTEtMDUtMzE6IHVzZWQgdG8gY2FsbCBnZXRTdGFydHBvaW50KCkvZ2V0RW5kcG9pbnQoKSxcbiAgICAgICAgLy8gYnV0IGZvciBwZXJmb3JtYW5jZSBwdXJwb3NlLCB0aGVzZSBhcmUgZXhwYW5kZWQgaW4gcGxhY2UgaGVyZS5cbiAgICAgICAgdGhpcy5hbmdsZSA9IGVkZ2UubFNpdGUgPT09IGxTaXRlID9cbiAgICAgICAgICAgIE1hdGguYXRhbjIodmIueC12YS54LCB2YS55LXZiLnkpIDpcbiAgICAgICAgICAgIE1hdGguYXRhbjIodmEueC12Yi54LCB2Yi55LXZhLnkpO1xuICAgICAgICB9XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuY3JlYXRlSGFsZmVkZ2UgPSBmdW5jdGlvbihlZGdlLCBsU2l0ZSwgclNpdGUpIHtcbiAgICByZXR1cm4gbmV3IHRoaXMuSGFsZmVkZ2UoZWRnZSwgbFNpdGUsIHJTaXRlKTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5IYWxmZWRnZS5wcm90b3R5cGUuZ2V0U3RhcnRwb2ludCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmVkZ2UubFNpdGUgPT09IHRoaXMuc2l0ZSA/IHRoaXMuZWRnZS52YSA6IHRoaXMuZWRnZS52YjtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5IYWxmZWRnZS5wcm90b3R5cGUuZ2V0RW5kcG9pbnQgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5lZGdlLmxTaXRlID09PSB0aGlzLnNpdGUgPyB0aGlzLmVkZ2UudmIgOiB0aGlzLmVkZ2UudmE7XG4gICAgfTtcblxuXG5cbi8vIHRoaXMgY3JlYXRlIGFuZCBhZGQgYSB2ZXJ0ZXggdG8gdGhlIGludGVybmFsIGNvbGxlY3Rpb25cblxuVm9yb25vaS5wcm90b3R5cGUuY3JlYXRlVmVydGV4ID0gZnVuY3Rpb24oeCwgeSkge1xuICAgIHZhciB2ID0gdGhpcy52ZXJ0ZXhKdW5reWFyZC5wb3AoKTtcbiAgICBpZiAoICF2ICkge1xuICAgICAgICB2ID0gbmV3IHRoaXMuVmVydGV4KHgsIHkpO1xuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHYueCA9IHg7XG4gICAgICAgIHYueSA9IHk7XG4gICAgICAgIH1cbiAgICB0aGlzLnZlcnRpY2VzLnB1c2godik7XG4gICAgcmV0dXJuIHY7XG4gICAgfTtcblxuLy8gdGhpcyBjcmVhdGUgYW5kIGFkZCBhbiBlZGdlIHRvIGludGVybmFsIGNvbGxlY3Rpb24sIGFuZCBhbHNvIGNyZWF0ZVxuLy8gdHdvIGhhbGZlZGdlcyB3aGljaCBhcmUgYWRkZWQgdG8gZWFjaCBzaXRlJ3MgY291bnRlcmNsb2Nrd2lzZSBhcnJheVxuLy8gb2YgaGFsZmVkZ2VzLlxuXG5Wb3Jvbm9pLnByb3RvdHlwZS5jcmVhdGVFZGdlID0gZnVuY3Rpb24obFNpdGUsIHJTaXRlLCB2YSwgdmIpIHtcbiAgICB2YXIgZWRnZSA9IHRoaXMuZWRnZUp1bmt5YXJkLnBvcCgpO1xuICAgIGlmICggIWVkZ2UgKSB7XG4gICAgICAgIGVkZ2UgPSBuZXcgdGhpcy5FZGdlKGxTaXRlLCByU2l0ZSk7XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgZWRnZS5sU2l0ZSA9IGxTaXRlO1xuICAgICAgICBlZGdlLnJTaXRlID0gclNpdGU7XG4gICAgICAgIGVkZ2UudmEgPSBlZGdlLnZiID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgdGhpcy5lZGdlcy5wdXNoKGVkZ2UpO1xuICAgIGlmICh2YSkge1xuICAgICAgICB0aGlzLnNldEVkZ2VTdGFydHBvaW50KGVkZ2UsIGxTaXRlLCByU2l0ZSwgdmEpO1xuICAgICAgICB9XG4gICAgaWYgKHZiKSB7XG4gICAgICAgIHRoaXMuc2V0RWRnZUVuZHBvaW50KGVkZ2UsIGxTaXRlLCByU2l0ZSwgdmIpO1xuICAgICAgICB9XG4gICAgdGhpcy5jZWxsc1tsU2l0ZS52b3Jvbm9pSWRdLmhhbGZlZGdlcy5wdXNoKHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgbFNpdGUsIHJTaXRlKSk7XG4gICAgdGhpcy5jZWxsc1tyU2l0ZS52b3Jvbm9pSWRdLmhhbGZlZGdlcy5wdXNoKHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgclNpdGUsIGxTaXRlKSk7XG4gICAgcmV0dXJuIGVkZ2U7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuY3JlYXRlQm9yZGVyRWRnZSA9IGZ1bmN0aW9uKGxTaXRlLCB2YSwgdmIpIHtcbiAgICB2YXIgZWRnZSA9IHRoaXMuZWRnZUp1bmt5YXJkLnBvcCgpO1xuICAgIGlmICggIWVkZ2UgKSB7XG4gICAgICAgIGVkZ2UgPSBuZXcgdGhpcy5FZGdlKGxTaXRlLCBudWxsKTtcbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBlZGdlLmxTaXRlID0gbFNpdGU7XG4gICAgICAgIGVkZ2UuclNpdGUgPSBudWxsO1xuICAgICAgICB9XG4gICAgZWRnZS52YSA9IHZhO1xuICAgIGVkZ2UudmIgPSB2YjtcbiAgICB0aGlzLmVkZ2VzLnB1c2goZWRnZSk7XG4gICAgcmV0dXJuIGVkZ2U7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuc2V0RWRnZVN0YXJ0cG9pbnQgPSBmdW5jdGlvbihlZGdlLCBsU2l0ZSwgclNpdGUsIHZlcnRleCkge1xuICAgIGlmICghZWRnZS52YSAmJiAhZWRnZS52Yikge1xuICAgICAgICBlZGdlLnZhID0gdmVydGV4O1xuICAgICAgICBlZGdlLmxTaXRlID0gbFNpdGU7XG4gICAgICAgIGVkZ2UuclNpdGUgPSByU2l0ZTtcbiAgICAgICAgfVxuICAgIGVsc2UgaWYgKGVkZ2UubFNpdGUgPT09IHJTaXRlKSB7XG4gICAgICAgIGVkZ2UudmIgPSB2ZXJ0ZXg7XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgZWRnZS52YSA9IHZlcnRleDtcbiAgICAgICAgfVxuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLnNldEVkZ2VFbmRwb2ludCA9IGZ1bmN0aW9uKGVkZ2UsIGxTaXRlLCByU2l0ZSwgdmVydGV4KSB7XG4gICAgdGhpcy5zZXRFZGdlU3RhcnRwb2ludChlZGdlLCByU2l0ZSwgbFNpdGUsIHZlcnRleCk7XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBCZWFjaGxpbmUgbWV0aG9kc1xuXG4vLyByaGlsbCAyMDExLTA2LTA3OiBGb3Igc29tZSByZWFzb25zLCBwZXJmb3JtYW5jZSBzdWZmZXJzIHNpZ25pZmljYW50bHlcbi8vIHdoZW4gaW5zdGFuY2lhdGluZyBhIGxpdGVyYWwgb2JqZWN0IGluc3RlYWQgb2YgYW4gZW1wdHkgY3RvclxuVm9yb25vaS5wcm90b3R5cGUuQmVhY2hzZWN0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgfTtcblxuLy8gcmhpbGwgMjAxMS0wNi0wMjogQSBsb3Qgb2YgQmVhY2hzZWN0aW9uIGluc3RhbmNpYXRpb25zXG4vLyBvY2N1ciBkdXJpbmcgdGhlIGNvbXB1dGF0aW9uIG9mIHRoZSBWb3Jvbm9pIGRpYWdyYW0sXG4vLyBzb21ld2hlcmUgYmV0d2VlbiB0aGUgbnVtYmVyIG9mIHNpdGVzIGFuZCB0d2ljZSB0aGVcbi8vIG51bWJlciBvZiBzaXRlcywgd2hpbGUgdGhlIG51bWJlciBvZiBCZWFjaHNlY3Rpb25zIG9uIHRoZVxuLy8gYmVhY2hsaW5lIGF0IGFueSBnaXZlbiB0aW1lIGlzIGNvbXBhcmF0aXZlbHkgbG93LiBGb3IgdGhpc1xuLy8gcmVhc29uLCB3ZSByZXVzZSBhbHJlYWR5IGNyZWF0ZWQgQmVhY2hzZWN0aW9ucywgaW4gb3JkZXJcbi8vIHRvIGF2b2lkIG5ldyBtZW1vcnkgYWxsb2NhdGlvbi4gVGhpcyByZXN1bHRlZCBpbiBhIG1lYXN1cmFibGVcbi8vIHBlcmZvcm1hbmNlIGdhaW4uXG5cblZvcm9ub2kucHJvdG90eXBlLmNyZWF0ZUJlYWNoc2VjdGlvbiA9IGZ1bmN0aW9uKHNpdGUpIHtcbiAgICB2YXIgYmVhY2hzZWN0aW9uID0gdGhpcy5iZWFjaHNlY3Rpb25KdW5reWFyZC5wb3AoKTtcbiAgICBpZiAoIWJlYWNoc2VjdGlvbikge1xuICAgICAgICBiZWFjaHNlY3Rpb24gPSBuZXcgdGhpcy5CZWFjaHNlY3Rpb24oKTtcbiAgICAgICAgfVxuICAgIGJlYWNoc2VjdGlvbi5zaXRlID0gc2l0ZTtcbiAgICByZXR1cm4gYmVhY2hzZWN0aW9uO1xuICAgIH07XG5cbi8vIGNhbGN1bGF0ZSB0aGUgbGVmdCBicmVhayBwb2ludCBvZiBhIHBhcnRpY3VsYXIgYmVhY2ggc2VjdGlvbixcbi8vIGdpdmVuIGEgcGFydGljdWxhciBzd2VlcCBsaW5lXG5Wb3Jvbm9pLnByb3RvdHlwZS5sZWZ0QnJlYWtQb2ludCA9IGZ1bmN0aW9uKGFyYywgZGlyZWN0cml4KSB7XG4gICAgLy8gaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9QYXJhYm9sYVxuICAgIC8vIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvUXVhZHJhdGljX2VxdWF0aW9uXG4gICAgLy8gaDEgPSB4MSxcbiAgICAvLyBrMSA9ICh5MStkaXJlY3RyaXgpLzIsXG4gICAgLy8gaDIgPSB4MixcbiAgICAvLyBrMiA9ICh5MitkaXJlY3RyaXgpLzIsXG4gICAgLy8gcDEgPSBrMS1kaXJlY3RyaXgsXG4gICAgLy8gYTEgPSAxLyg0KnAxKSxcbiAgICAvLyBiMSA9IC1oMS8oMipwMSksXG4gICAgLy8gYzEgPSBoMSpoMS8oNCpwMSkrazEsXG4gICAgLy8gcDIgPSBrMi1kaXJlY3RyaXgsXG4gICAgLy8gYTIgPSAxLyg0KnAyKSxcbiAgICAvLyBiMiA9IC1oMi8oMipwMiksXG4gICAgLy8gYzIgPSBoMipoMi8oNCpwMikrazIsXG4gICAgLy8geCA9ICgtKGIyLWIxKSArIE1hdGguc3FydCgoYjItYjEpKihiMi1iMSkgLSA0KihhMi1hMSkqKGMyLWMxKSkpIC8gKDIqKGEyLWExKSlcbiAgICAvLyBXaGVuIHgxIGJlY29tZSB0aGUgeC1vcmlnaW46XG4gICAgLy8gaDEgPSAwLFxuICAgIC8vIGsxID0gKHkxK2RpcmVjdHJpeCkvMixcbiAgICAvLyBoMiA9IHgyLXgxLFxuICAgIC8vIGsyID0gKHkyK2RpcmVjdHJpeCkvMixcbiAgICAvLyBwMSA9IGsxLWRpcmVjdHJpeCxcbiAgICAvLyBhMSA9IDEvKDQqcDEpLFxuICAgIC8vIGIxID0gMCxcbiAgICAvLyBjMSA9IGsxLFxuICAgIC8vIHAyID0gazItZGlyZWN0cml4LFxuICAgIC8vIGEyID0gMS8oNCpwMiksXG4gICAgLy8gYjIgPSAtaDIvKDIqcDIpLFxuICAgIC8vIGMyID0gaDIqaDIvKDQqcDIpK2syLFxuICAgIC8vIHggPSAoLWIyICsgTWF0aC5zcXJ0KGIyKmIyIC0gNCooYTItYTEpKihjMi1rMSkpKSAvICgyKihhMi1hMSkpICsgeDFcblxuICAgIC8vIGNoYW5nZSBjb2RlIGJlbG93IGF0IHlvdXIgb3duIHJpc2s6IGNhcmUgaGFzIGJlZW4gdGFrZW4gdG9cbiAgICAvLyByZWR1Y2UgZXJyb3JzIGR1ZSB0byBjb21wdXRlcnMnIGZpbml0ZSBhcml0aG1ldGljIHByZWNpc2lvbi5cbiAgICAvLyBNYXliZSBjYW4gc3RpbGwgYmUgaW1wcm92ZWQsIHdpbGwgc2VlIGlmIGFueSBtb3JlIG9mIHRoaXNcbiAgICAvLyBraW5kIG9mIGVycm9ycyBwb3AgdXAgYWdhaW4uXG4gICAgdmFyIHNpdGUgPSBhcmMuc2l0ZSxcbiAgICAgICAgcmZvY3ggPSBzaXRlLngsXG4gICAgICAgIHJmb2N5ID0gc2l0ZS55LFxuICAgICAgICBwYnkyID0gcmZvY3ktZGlyZWN0cml4O1xuICAgIC8vIHBhcmFib2xhIGluIGRlZ2VuZXJhdGUgY2FzZSB3aGVyZSBmb2N1cyBpcyBvbiBkaXJlY3RyaXhcbiAgICBpZiAoIXBieTIpIHtcbiAgICAgICAgcmV0dXJuIHJmb2N4O1xuICAgICAgICB9XG4gICAgdmFyIGxBcmMgPSBhcmMucmJQcmV2aW91cztcbiAgICBpZiAoIWxBcmMpIHtcbiAgICAgICAgcmV0dXJuIC1JbmZpbml0eTtcbiAgICAgICAgfVxuICAgIHNpdGUgPSBsQXJjLnNpdGU7XG4gICAgdmFyIGxmb2N4ID0gc2l0ZS54LFxuICAgICAgICBsZm9jeSA9IHNpdGUueSxcbiAgICAgICAgcGxieTIgPSBsZm9jeS1kaXJlY3RyaXg7XG4gICAgLy8gcGFyYWJvbGEgaW4gZGVnZW5lcmF0ZSBjYXNlIHdoZXJlIGZvY3VzIGlzIG9uIGRpcmVjdHJpeFxuICAgIGlmICghcGxieTIpIHtcbiAgICAgICAgcmV0dXJuIGxmb2N4O1xuICAgICAgICB9XG4gICAgdmFyIGhsID0gbGZvY3gtcmZvY3gsXG4gICAgICAgIGFieTIgPSAxL3BieTItMS9wbGJ5MixcbiAgICAgICAgYiA9IGhsL3BsYnkyO1xuICAgIGlmIChhYnkyKSB7XG4gICAgICAgIHJldHVybiAoLWIrdGhpcy5zcXJ0KGIqYi0yKmFieTIqKGhsKmhsLygtMipwbGJ5MiktbGZvY3krcGxieTIvMityZm9jeS1wYnkyLzIpKSkvYWJ5MityZm9jeDtcbiAgICAgICAgfVxuICAgIC8vIGJvdGggcGFyYWJvbGFzIGhhdmUgc2FtZSBkaXN0YW5jZSB0byBkaXJlY3RyaXgsIHRodXMgYnJlYWsgcG9pbnQgaXMgbWlkd2F5XG4gICAgcmV0dXJuIChyZm9jeCtsZm9jeCkvMjtcbiAgICB9O1xuXG4vLyBjYWxjdWxhdGUgdGhlIHJpZ2h0IGJyZWFrIHBvaW50IG9mIGEgcGFydGljdWxhciBiZWFjaCBzZWN0aW9uLFxuLy8gZ2l2ZW4gYSBwYXJ0aWN1bGFyIGRpcmVjdHJpeFxuVm9yb25vaS5wcm90b3R5cGUucmlnaHRCcmVha1BvaW50ID0gZnVuY3Rpb24oYXJjLCBkaXJlY3RyaXgpIHtcbiAgICB2YXIgckFyYyA9IGFyYy5yYk5leHQ7XG4gICAgaWYgKHJBcmMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubGVmdEJyZWFrUG9pbnQockFyYywgZGlyZWN0cml4KTtcbiAgICAgICAgfVxuICAgIHZhciBzaXRlID0gYXJjLnNpdGU7XG4gICAgcmV0dXJuIHNpdGUueSA9PT0gZGlyZWN0cml4ID8gc2l0ZS54IDogSW5maW5pdHk7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuZGV0YWNoQmVhY2hzZWN0aW9uID0gZnVuY3Rpb24oYmVhY2hzZWN0aW9uKSB7XG4gICAgdGhpcy5kZXRhY2hDaXJjbGVFdmVudChiZWFjaHNlY3Rpb24pOyAvLyBkZXRhY2ggcG90ZW50aWFsbHkgYXR0YWNoZWQgY2lyY2xlIGV2ZW50XG4gICAgdGhpcy5iZWFjaGxpbmUucmJSZW1vdmVOb2RlKGJlYWNoc2VjdGlvbik7IC8vIHJlbW92ZSBmcm9tIFJCLXRyZWVcbiAgICB0aGlzLmJlYWNoc2VjdGlvbkp1bmt5YXJkLnB1c2goYmVhY2hzZWN0aW9uKTsgLy8gbWFyayBmb3IgcmV1c2VcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5yZW1vdmVCZWFjaHNlY3Rpb24gPSBmdW5jdGlvbihiZWFjaHNlY3Rpb24pIHtcbiAgICB2YXIgY2lyY2xlID0gYmVhY2hzZWN0aW9uLmNpcmNsZUV2ZW50LFxuICAgICAgICB4ID0gY2lyY2xlLngsXG4gICAgICAgIHkgPSBjaXJjbGUueWNlbnRlcixcbiAgICAgICAgdmVydGV4ID0gdGhpcy5jcmVhdGVWZXJ0ZXgoeCwgeSksXG4gICAgICAgIHByZXZpb3VzID0gYmVhY2hzZWN0aW9uLnJiUHJldmlvdXMsXG4gICAgICAgIG5leHQgPSBiZWFjaHNlY3Rpb24ucmJOZXh0LFxuICAgICAgICBkaXNhcHBlYXJpbmdUcmFuc2l0aW9ucyA9IFtiZWFjaHNlY3Rpb25dLFxuICAgICAgICBhYnNfZm4gPSBNYXRoLmFicztcblxuICAgIC8vIHJlbW92ZSBjb2xsYXBzZWQgYmVhY2hzZWN0aW9uIGZyb20gYmVhY2hsaW5lXG4gICAgdGhpcy5kZXRhY2hCZWFjaHNlY3Rpb24oYmVhY2hzZWN0aW9uKTtcblxuICAgIC8vIHRoZXJlIGNvdWxkIGJlIG1vcmUgdGhhbiBvbmUgZW1wdHkgYXJjIGF0IHRoZSBkZWxldGlvbiBwb2ludCwgdGhpc1xuICAgIC8vIGhhcHBlbnMgd2hlbiBtb3JlIHRoYW4gdHdvIGVkZ2VzIGFyZSBsaW5rZWQgYnkgdGhlIHNhbWUgdmVydGV4LFxuICAgIC8vIHNvIHdlIHdpbGwgY29sbGVjdCBhbGwgdGhvc2UgZWRnZXMgYnkgbG9va2luZyB1cCBib3RoIHNpZGVzIG9mXG4gICAgLy8gdGhlIGRlbGV0aW9uIHBvaW50LlxuICAgIC8vIGJ5IHRoZSB3YXksIHRoZXJlIGlzICphbHdheXMqIGEgcHJlZGVjZXNzb3Ivc3VjY2Vzc29yIHRvIGFueSBjb2xsYXBzZWRcbiAgICAvLyBiZWFjaCBzZWN0aW9uLCBpdCdzIGp1c3QgaW1wb3NzaWJsZSB0byBoYXZlIGEgY29sbGFwc2luZyBmaXJzdC9sYXN0XG4gICAgLy8gYmVhY2ggc2VjdGlvbnMgb24gdGhlIGJlYWNobGluZSwgc2luY2UgdGhleSBvYnZpb3VzbHkgYXJlIHVuY29uc3RyYWluZWRcbiAgICAvLyBvbiB0aGVpciBsZWZ0L3JpZ2h0IHNpZGUuXG5cbiAgICAvLyBsb29rIGxlZnRcbiAgICB2YXIgbEFyYyA9IHByZXZpb3VzO1xuICAgIHdoaWxlIChsQXJjLmNpcmNsZUV2ZW50ICYmIGFic19mbih4LWxBcmMuY2lyY2xlRXZlbnQueCk8MWUtOSAmJiBhYnNfZm4oeS1sQXJjLmNpcmNsZUV2ZW50LnljZW50ZXIpPDFlLTkpIHtcbiAgICAgICAgcHJldmlvdXMgPSBsQXJjLnJiUHJldmlvdXM7XG4gICAgICAgIGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zLnVuc2hpZnQobEFyYyk7XG4gICAgICAgIHRoaXMuZGV0YWNoQmVhY2hzZWN0aW9uKGxBcmMpOyAvLyBtYXJrIGZvciByZXVzZVxuICAgICAgICBsQXJjID0gcHJldmlvdXM7XG4gICAgICAgIH1cbiAgICAvLyBldmVuIHRob3VnaCBpdCBpcyBub3QgZGlzYXBwZWFyaW5nLCBJIHdpbGwgYWxzbyBhZGQgdGhlIGJlYWNoIHNlY3Rpb25cbiAgICAvLyBpbW1lZGlhdGVseSB0byB0aGUgbGVmdCBvZiB0aGUgbGVmdC1tb3N0IGNvbGxhcHNlZCBiZWFjaCBzZWN0aW9uLCBmb3JcbiAgICAvLyBjb252ZW5pZW5jZSwgc2luY2Ugd2UgbmVlZCB0byByZWZlciB0byBpdCBsYXRlciBhcyB0aGlzIGJlYWNoIHNlY3Rpb25cbiAgICAvLyBpcyB0aGUgJ2xlZnQnIHNpdGUgb2YgYW4gZWRnZSBmb3Igd2hpY2ggYSBzdGFydCBwb2ludCBpcyBzZXQuXG4gICAgZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnMudW5zaGlmdChsQXJjKTtcbiAgICB0aGlzLmRldGFjaENpcmNsZUV2ZW50KGxBcmMpO1xuXG4gICAgLy8gbG9vayByaWdodFxuICAgIHZhciByQXJjID0gbmV4dDtcbiAgICB3aGlsZSAockFyYy5jaXJjbGVFdmVudCAmJiBhYnNfZm4oeC1yQXJjLmNpcmNsZUV2ZW50LngpPDFlLTkgJiYgYWJzX2ZuKHktckFyYy5jaXJjbGVFdmVudC55Y2VudGVyKTwxZS05KSB7XG4gICAgICAgIG5leHQgPSByQXJjLnJiTmV4dDtcbiAgICAgICAgZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnMucHVzaChyQXJjKTtcbiAgICAgICAgdGhpcy5kZXRhY2hCZWFjaHNlY3Rpb24ockFyYyk7IC8vIG1hcmsgZm9yIHJldXNlXG4gICAgICAgIHJBcmMgPSBuZXh0O1xuICAgICAgICB9XG4gICAgLy8gd2UgYWxzbyBoYXZlIHRvIGFkZCB0aGUgYmVhY2ggc2VjdGlvbiBpbW1lZGlhdGVseSB0byB0aGUgcmlnaHQgb2YgdGhlXG4gICAgLy8gcmlnaHQtbW9zdCBjb2xsYXBzZWQgYmVhY2ggc2VjdGlvbiwgc2luY2UgdGhlcmUgaXMgYWxzbyBhIGRpc2FwcGVhcmluZ1xuICAgIC8vIHRyYW5zaXRpb24gcmVwcmVzZW50aW5nIGFuIGVkZ2UncyBzdGFydCBwb2ludCBvbiBpdHMgbGVmdC5cbiAgICBkaXNhcHBlYXJpbmdUcmFuc2l0aW9ucy5wdXNoKHJBcmMpO1xuICAgIHRoaXMuZGV0YWNoQ2lyY2xlRXZlbnQockFyYyk7XG5cbiAgICAvLyB3YWxrIHRocm91Z2ggYWxsIHRoZSBkaXNhcHBlYXJpbmcgdHJhbnNpdGlvbnMgYmV0d2VlbiBiZWFjaCBzZWN0aW9ucyBhbmRcbiAgICAvLyBzZXQgdGhlIHN0YXJ0IHBvaW50IG9mIHRoZWlyIChpbXBsaWVkKSBlZGdlLlxuICAgIHZhciBuQXJjcyA9IGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zLmxlbmd0aCxcbiAgICAgICAgaUFyYztcbiAgICBmb3IgKGlBcmM9MTsgaUFyYzxuQXJjczsgaUFyYysrKSB7XG4gICAgICAgIHJBcmMgPSBkaXNhcHBlYXJpbmdUcmFuc2l0aW9uc1tpQXJjXTtcbiAgICAgICAgbEFyYyA9IGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zW2lBcmMtMV07XG4gICAgICAgIHRoaXMuc2V0RWRnZVN0YXJ0cG9pbnQockFyYy5lZGdlLCBsQXJjLnNpdGUsIHJBcmMuc2l0ZSwgdmVydGV4KTtcbiAgICAgICAgfVxuXG4gICAgLy8gY3JlYXRlIGEgbmV3IGVkZ2UgYXMgd2UgaGF2ZSBub3cgYSBuZXcgdHJhbnNpdGlvbiBiZXR3ZWVuXG4gICAgLy8gdHdvIGJlYWNoIHNlY3Rpb25zIHdoaWNoIHdlcmUgcHJldmlvdXNseSBub3QgYWRqYWNlbnQuXG4gICAgLy8gc2luY2UgdGhpcyBlZGdlIGFwcGVhcnMgYXMgYSBuZXcgdmVydGV4IGlzIGRlZmluZWQsIHRoZSB2ZXJ0ZXhcbiAgICAvLyBhY3R1YWxseSBkZWZpbmUgYW4gZW5kIHBvaW50IG9mIHRoZSBlZGdlIChyZWxhdGl2ZSB0byB0aGUgc2l0ZVxuICAgIC8vIG9uIHRoZSBsZWZ0KVxuICAgIGxBcmMgPSBkaXNhcHBlYXJpbmdUcmFuc2l0aW9uc1swXTtcbiAgICByQXJjID0gZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnNbbkFyY3MtMV07XG4gICAgckFyYy5lZGdlID0gdGhpcy5jcmVhdGVFZGdlKGxBcmMuc2l0ZSwgckFyYy5zaXRlLCB1bmRlZmluZWQsIHZlcnRleCk7XG5cbiAgICAvLyBjcmVhdGUgY2lyY2xlIGV2ZW50cyBpZiBhbnkgZm9yIGJlYWNoIHNlY3Rpb25zIGxlZnQgaW4gdGhlIGJlYWNobGluZVxuICAgIC8vIGFkamFjZW50IHRvIGNvbGxhcHNlZCBzZWN0aW9uc1xuICAgIHRoaXMuYXR0YWNoQ2lyY2xlRXZlbnQobEFyYyk7XG4gICAgdGhpcy5hdHRhY2hDaXJjbGVFdmVudChyQXJjKTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5hZGRCZWFjaHNlY3Rpb24gPSBmdW5jdGlvbihzaXRlKSB7XG4gICAgdmFyIHggPSBzaXRlLngsXG4gICAgICAgIGRpcmVjdHJpeCA9IHNpdGUueTtcblxuICAgIC8vIGZpbmQgdGhlIGxlZnQgYW5kIHJpZ2h0IGJlYWNoIHNlY3Rpb25zIHdoaWNoIHdpbGwgc3Vycm91bmQgdGhlIG5ld2x5XG4gICAgLy8gY3JlYXRlZCBiZWFjaCBzZWN0aW9uLlxuICAgIC8vIHJoaWxsIDIwMTEtMDYtMDE6IFRoaXMgbG9vcCBpcyBvbmUgb2YgdGhlIG1vc3Qgb2Z0ZW4gZXhlY3V0ZWQsXG4gICAgLy8gaGVuY2Ugd2UgZXhwYW5kIGluLXBsYWNlIHRoZSBjb21wYXJpc29uLWFnYWluc3QtZXBzaWxvbiBjYWxscy5cbiAgICB2YXIgbEFyYywgckFyYyxcbiAgICAgICAgZHhsLCBkeHIsXG4gICAgICAgIG5vZGUgPSB0aGlzLmJlYWNobGluZS5yb290O1xuXG4gICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgZHhsID0gdGhpcy5sZWZ0QnJlYWtQb2ludChub2RlLGRpcmVjdHJpeCkteDtcbiAgICAgICAgLy8geCBsZXNzVGhhbldpdGhFcHNpbG9uIHhsID0+IGZhbGxzIHNvbWV3aGVyZSBiZWZvcmUgdGhlIGxlZnQgZWRnZSBvZiB0aGUgYmVhY2hzZWN0aW9uXG4gICAgICAgIGlmIChkeGwgPiAxZS05KSB7XG4gICAgICAgICAgICAvLyB0aGlzIGNhc2Ugc2hvdWxkIG5ldmVyIGhhcHBlblxuICAgICAgICAgICAgLy8gaWYgKCFub2RlLnJiTGVmdCkge1xuICAgICAgICAgICAgLy8gICAgckFyYyA9IG5vZGUucmJMZWZ0O1xuICAgICAgICAgICAgLy8gICAgYnJlYWs7XG4gICAgICAgICAgICAvLyAgICB9XG4gICAgICAgICAgICBub2RlID0gbm9kZS5yYkxlZnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgZHhyID0geC10aGlzLnJpZ2h0QnJlYWtQb2ludChub2RlLGRpcmVjdHJpeCk7XG4gICAgICAgICAgICAvLyB4IGdyZWF0ZXJUaGFuV2l0aEVwc2lsb24geHIgPT4gZmFsbHMgc29tZXdoZXJlIGFmdGVyIHRoZSByaWdodCBlZGdlIG9mIHRoZSBiZWFjaHNlY3Rpb25cbiAgICAgICAgICAgIGlmIChkeHIgPiAxZS05KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFub2RlLnJiUmlnaHQpIHtcbiAgICAgICAgICAgICAgICAgICAgbEFyYyA9IG5vZGU7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbm9kZSA9IG5vZGUucmJSaWdodDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyB4IGVxdWFsV2l0aEVwc2lsb24geGwgPT4gZmFsbHMgZXhhY3RseSBvbiB0aGUgbGVmdCBlZGdlIG9mIHRoZSBiZWFjaHNlY3Rpb25cbiAgICAgICAgICAgICAgICBpZiAoZHhsID4gLTFlLTkpIHtcbiAgICAgICAgICAgICAgICAgICAgbEFyYyA9IG5vZGUucmJQcmV2aW91cztcbiAgICAgICAgICAgICAgICAgICAgckFyYyA9IG5vZGU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyB4IGVxdWFsV2l0aEVwc2lsb24geHIgPT4gZmFsbHMgZXhhY3RseSBvbiB0aGUgcmlnaHQgZWRnZSBvZiB0aGUgYmVhY2hzZWN0aW9uXG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoZHhyID4gLTFlLTkpIHtcbiAgICAgICAgICAgICAgICAgICAgbEFyYyA9IG5vZGU7XG4gICAgICAgICAgICAgICAgICAgIHJBcmMgPSBub2RlLnJiTmV4dDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIGZhbGxzIGV4YWN0bHkgc29tZXdoZXJlIGluIHRoZSBtaWRkbGUgb2YgdGhlIGJlYWNoc2VjdGlvblxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBsQXJjID0gckFyYyA9IG5vZGU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAvLyBhdCB0aGlzIHBvaW50LCBrZWVwIGluIG1pbmQgdGhhdCBsQXJjIGFuZC9vciByQXJjIGNvdWxkIGJlXG4gICAgLy8gdW5kZWZpbmVkIG9yIG51bGwuXG5cbiAgICAvLyBjcmVhdGUgYSBuZXcgYmVhY2ggc2VjdGlvbiBvYmplY3QgZm9yIHRoZSBzaXRlIGFuZCBhZGQgaXQgdG8gUkItdHJlZVxuICAgIHZhciBuZXdBcmMgPSB0aGlzLmNyZWF0ZUJlYWNoc2VjdGlvbihzaXRlKTtcbiAgICB0aGlzLmJlYWNobGluZS5yYkluc2VydFN1Y2Nlc3NvcihsQXJjLCBuZXdBcmMpO1xuXG4gICAgLy8gY2FzZXM6XG4gICAgLy9cblxuICAgIC8vIFtudWxsLG51bGxdXG4gICAgLy8gbGVhc3QgbGlrZWx5IGNhc2U6IG5ldyBiZWFjaCBzZWN0aW9uIGlzIHRoZSBmaXJzdCBiZWFjaCBzZWN0aW9uIG9uIHRoZVxuICAgIC8vIGJlYWNobGluZS5cbiAgICAvLyBUaGlzIGNhc2UgbWVhbnM6XG4gICAgLy8gICBubyBuZXcgdHJhbnNpdGlvbiBhcHBlYXJzXG4gICAgLy8gICBubyBjb2xsYXBzaW5nIGJlYWNoIHNlY3Rpb25cbiAgICAvLyAgIG5ldyBiZWFjaHNlY3Rpb24gYmVjb21lIHJvb3Qgb2YgdGhlIFJCLXRyZWVcbiAgICBpZiAoIWxBcmMgJiYgIXJBcmMpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAvLyBbbEFyYyxyQXJjXSB3aGVyZSBsQXJjID09IHJBcmNcbiAgICAvLyBtb3N0IGxpa2VseSBjYXNlOiBuZXcgYmVhY2ggc2VjdGlvbiBzcGxpdCBhbiBleGlzdGluZyBiZWFjaFxuICAgIC8vIHNlY3Rpb24uXG4gICAgLy8gVGhpcyBjYXNlIG1lYW5zOlxuICAgIC8vICAgb25lIG5ldyB0cmFuc2l0aW9uIGFwcGVhcnNcbiAgICAvLyAgIHRoZSBsZWZ0IGFuZCByaWdodCBiZWFjaCBzZWN0aW9uIG1pZ2h0IGJlIGNvbGxhcHNpbmcgYXMgYSByZXN1bHRcbiAgICAvLyAgIHR3byBuZXcgbm9kZXMgYWRkZWQgdG8gdGhlIFJCLXRyZWVcbiAgICBpZiAobEFyYyA9PT0gckFyYykge1xuICAgICAgICAvLyBpbnZhbGlkYXRlIGNpcmNsZSBldmVudCBvZiBzcGxpdCBiZWFjaCBzZWN0aW9uXG4gICAgICAgIHRoaXMuZGV0YWNoQ2lyY2xlRXZlbnQobEFyYyk7XG5cbiAgICAgICAgLy8gc3BsaXQgdGhlIGJlYWNoIHNlY3Rpb24gaW50byB0d28gc2VwYXJhdGUgYmVhY2ggc2VjdGlvbnNcbiAgICAgICAgckFyYyA9IHRoaXMuY3JlYXRlQmVhY2hzZWN0aW9uKGxBcmMuc2l0ZSk7XG4gICAgICAgIHRoaXMuYmVhY2hsaW5lLnJiSW5zZXJ0U3VjY2Vzc29yKG5ld0FyYywgckFyYyk7XG5cbiAgICAgICAgLy8gc2luY2Ugd2UgaGF2ZSBhIG5ldyB0cmFuc2l0aW9uIGJldHdlZW4gdHdvIGJlYWNoIHNlY3Rpb25zLFxuICAgICAgICAvLyBhIG5ldyBlZGdlIGlzIGJvcm5cbiAgICAgICAgbmV3QXJjLmVkZ2UgPSByQXJjLmVkZ2UgPSB0aGlzLmNyZWF0ZUVkZ2UobEFyYy5zaXRlLCBuZXdBcmMuc2l0ZSk7XG5cbiAgICAgICAgLy8gY2hlY2sgd2hldGhlciB0aGUgbGVmdCBhbmQgcmlnaHQgYmVhY2ggc2VjdGlvbnMgYXJlIGNvbGxhcHNpbmdcbiAgICAgICAgLy8gYW5kIGlmIHNvIGNyZWF0ZSBjaXJjbGUgZXZlbnRzLCB0byBiZSBub3RpZmllZCB3aGVuIHRoZSBwb2ludCBvZlxuICAgICAgICAvLyBjb2xsYXBzZSBpcyByZWFjaGVkLlxuICAgICAgICB0aGlzLmF0dGFjaENpcmNsZUV2ZW50KGxBcmMpO1xuICAgICAgICB0aGlzLmF0dGFjaENpcmNsZUV2ZW50KHJBcmMpO1xuICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgIC8vIFtsQXJjLG51bGxdXG4gICAgLy8gZXZlbiBsZXNzIGxpa2VseSBjYXNlOiBuZXcgYmVhY2ggc2VjdGlvbiBpcyB0aGUgKmxhc3QqIGJlYWNoIHNlY3Rpb25cbiAgICAvLyBvbiB0aGUgYmVhY2hsaW5lIC0tIHRoaXMgY2FuIGhhcHBlbiAqb25seSogaWYgKmFsbCogdGhlIHByZXZpb3VzIGJlYWNoXG4gICAgLy8gc2VjdGlvbnMgY3VycmVudGx5IG9uIHRoZSBiZWFjaGxpbmUgc2hhcmUgdGhlIHNhbWUgeSB2YWx1ZSBhc1xuICAgIC8vIHRoZSBuZXcgYmVhY2ggc2VjdGlvbi5cbiAgICAvLyBUaGlzIGNhc2UgbWVhbnM6XG4gICAgLy8gICBvbmUgbmV3IHRyYW5zaXRpb24gYXBwZWFyc1xuICAgIC8vICAgbm8gY29sbGFwc2luZyBiZWFjaCBzZWN0aW9uIGFzIGEgcmVzdWx0XG4gICAgLy8gICBuZXcgYmVhY2ggc2VjdGlvbiBiZWNvbWUgcmlnaHQtbW9zdCBub2RlIG9mIHRoZSBSQi10cmVlXG4gICAgaWYgKGxBcmMgJiYgIXJBcmMpIHtcbiAgICAgICAgbmV3QXJjLmVkZ2UgPSB0aGlzLmNyZWF0ZUVkZ2UobEFyYy5zaXRlLG5ld0FyYy5zaXRlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAvLyBbbnVsbCxyQXJjXVxuICAgIC8vIGltcG9zc2libGUgY2FzZTogYmVjYXVzZSBzaXRlcyBhcmUgc3RyaWN0bHkgcHJvY2Vzc2VkIGZyb20gdG9wIHRvIGJvdHRvbSxcbiAgICAvLyBhbmQgbGVmdCB0byByaWdodCwgd2hpY2ggZ3VhcmFudGVlcyB0aGF0IHRoZXJlIHdpbGwgYWx3YXlzIGJlIGEgYmVhY2ggc2VjdGlvblxuICAgIC8vIG9uIHRoZSBsZWZ0IC0tIGV4Y2VwdCBvZiBjb3Vyc2Ugd2hlbiB0aGVyZSBhcmUgbm8gYmVhY2ggc2VjdGlvbiBhdCBhbGwgb25cbiAgICAvLyB0aGUgYmVhY2ggbGluZSwgd2hpY2ggY2FzZSB3YXMgaGFuZGxlZCBhYm92ZS5cbiAgICAvLyByaGlsbCAyMDExLTA2LTAyOiBObyBwb2ludCB0ZXN0aW5nIGluIG5vbi1kZWJ1ZyB2ZXJzaW9uXG4gICAgLy9pZiAoIWxBcmMgJiYgckFyYykge1xuICAgIC8vICAgIHRocm93IFwiVm9yb25vaS5hZGRCZWFjaHNlY3Rpb24oKTogV2hhdCBpcyB0aGlzIEkgZG9uJ3QgZXZlblwiO1xuICAgIC8vICAgIH1cblxuICAgIC8vIFtsQXJjLHJBcmNdIHdoZXJlIGxBcmMgIT0gckFyY1xuICAgIC8vIHNvbWV3aGF0IGxlc3MgbGlrZWx5IGNhc2U6IG5ldyBiZWFjaCBzZWN0aW9uIGZhbGxzICpleGFjdGx5KiBpbiBiZXR3ZWVuIHR3b1xuICAgIC8vIGV4aXN0aW5nIGJlYWNoIHNlY3Rpb25zXG4gICAgLy8gVGhpcyBjYXNlIG1lYW5zOlxuICAgIC8vICAgb25lIHRyYW5zaXRpb24gZGlzYXBwZWFyc1xuICAgIC8vICAgdHdvIG5ldyB0cmFuc2l0aW9ucyBhcHBlYXJcbiAgICAvLyAgIHRoZSBsZWZ0IGFuZCByaWdodCBiZWFjaCBzZWN0aW9uIG1pZ2h0IGJlIGNvbGxhcHNpbmcgYXMgYSByZXN1bHRcbiAgICAvLyAgIG9ubHkgb25lIG5ldyBub2RlIGFkZGVkIHRvIHRoZSBSQi10cmVlXG4gICAgaWYgKGxBcmMgIT09IHJBcmMpIHtcbiAgICAgICAgLy8gaW52YWxpZGF0ZSBjaXJjbGUgZXZlbnRzIG9mIGxlZnQgYW5kIHJpZ2h0IHNpdGVzXG4gICAgICAgIHRoaXMuZGV0YWNoQ2lyY2xlRXZlbnQobEFyYyk7XG4gICAgICAgIHRoaXMuZGV0YWNoQ2lyY2xlRXZlbnQockFyYyk7XG5cbiAgICAgICAgLy8gYW4gZXhpc3RpbmcgdHJhbnNpdGlvbiBkaXNhcHBlYXJzLCBtZWFuaW5nIGEgdmVydGV4IGlzIGRlZmluZWQgYXRcbiAgICAgICAgLy8gdGhlIGRpc2FwcGVhcmFuY2UgcG9pbnQuXG4gICAgICAgIC8vIHNpbmNlIHRoZSBkaXNhcHBlYXJhbmNlIGlzIGNhdXNlZCBieSB0aGUgbmV3IGJlYWNoc2VjdGlvbiwgdGhlXG4gICAgICAgIC8vIHZlcnRleCBpcyBhdCB0aGUgY2VudGVyIG9mIHRoZSBjaXJjdW1zY3JpYmVkIGNpcmNsZSBvZiB0aGUgbGVmdCxcbiAgICAgICAgLy8gbmV3IGFuZCByaWdodCBiZWFjaHNlY3Rpb25zLlxuICAgICAgICAvLyBodHRwOi8vbWF0aGZvcnVtLm9yZy9saWJyYXJ5L2RybWF0aC92aWV3LzU1MDAyLmh0bWxcbiAgICAgICAgLy8gRXhjZXB0IHRoYXQgSSBicmluZyB0aGUgb3JpZ2luIGF0IEEgdG8gc2ltcGxpZnlcbiAgICAgICAgLy8gY2FsY3VsYXRpb25cbiAgICAgICAgdmFyIGxTaXRlID0gbEFyYy5zaXRlLFxuICAgICAgICAgICAgYXggPSBsU2l0ZS54LFxuICAgICAgICAgICAgYXkgPSBsU2l0ZS55LFxuICAgICAgICAgICAgYng9c2l0ZS54LWF4LFxuICAgICAgICAgICAgYnk9c2l0ZS55LWF5LFxuICAgICAgICAgICAgclNpdGUgPSByQXJjLnNpdGUsXG4gICAgICAgICAgICBjeD1yU2l0ZS54LWF4LFxuICAgICAgICAgICAgY3k9clNpdGUueS1heSxcbiAgICAgICAgICAgIGQ9MiooYngqY3ktYnkqY3gpLFxuICAgICAgICAgICAgaGI9YngqYngrYnkqYnksXG4gICAgICAgICAgICBoYz1jeCpjeCtjeSpjeSxcbiAgICAgICAgICAgIHZlcnRleCA9IHRoaXMuY3JlYXRlVmVydGV4KChjeSpoYi1ieSpoYykvZCtheCwgKGJ4KmhjLWN4KmhiKS9kK2F5KTtcblxuICAgICAgICAvLyBvbmUgdHJhbnNpdGlvbiBkaXNhcHBlYXJcbiAgICAgICAgdGhpcy5zZXRFZGdlU3RhcnRwb2ludChyQXJjLmVkZ2UsIGxTaXRlLCByU2l0ZSwgdmVydGV4KTtcblxuICAgICAgICAvLyB0d28gbmV3IHRyYW5zaXRpb25zIGFwcGVhciBhdCB0aGUgbmV3IHZlcnRleCBsb2NhdGlvblxuICAgICAgICBuZXdBcmMuZWRnZSA9IHRoaXMuY3JlYXRlRWRnZShsU2l0ZSwgc2l0ZSwgdW5kZWZpbmVkLCB2ZXJ0ZXgpO1xuICAgICAgICByQXJjLmVkZ2UgPSB0aGlzLmNyZWF0ZUVkZ2Uoc2l0ZSwgclNpdGUsIHVuZGVmaW5lZCwgdmVydGV4KTtcblxuICAgICAgICAvLyBjaGVjayB3aGV0aGVyIHRoZSBsZWZ0IGFuZCByaWdodCBiZWFjaCBzZWN0aW9ucyBhcmUgY29sbGFwc2luZ1xuICAgICAgICAvLyBhbmQgaWYgc28gY3JlYXRlIGNpcmNsZSBldmVudHMsIHRvIGhhbmRsZSB0aGUgcG9pbnQgb2YgY29sbGFwc2UuXG4gICAgICAgIHRoaXMuYXR0YWNoQ2lyY2xlRXZlbnQobEFyYyk7XG4gICAgICAgIHRoaXMuYXR0YWNoQ2lyY2xlRXZlbnQockFyYyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ2lyY2xlIGV2ZW50IG1ldGhvZHNcblxuLy8gcmhpbGwgMjAxMS0wNi0wNzogRm9yIHNvbWUgcmVhc29ucywgcGVyZm9ybWFuY2Ugc3VmZmVycyBzaWduaWZpY2FudGx5XG4vLyB3aGVuIGluc3RhbmNpYXRpbmcgYSBsaXRlcmFsIG9iamVjdCBpbnN0ZWFkIG9mIGFuIGVtcHR5IGN0b3JcblZvcm9ub2kucHJvdG90eXBlLkNpcmNsZUV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gICAgLy8gcmhpbGwgMjAxMy0xMC0xMjogaXQgaGVscHMgdG8gc3RhdGUgZXhhY3RseSB3aGF0IHdlIGFyZSBhdCBjdG9yIHRpbWUuXG4gICAgdGhpcy5hcmMgPSBudWxsO1xuICAgIHRoaXMucmJMZWZ0ID0gbnVsbDtcbiAgICB0aGlzLnJiTmV4dCA9IG51bGw7XG4gICAgdGhpcy5yYlBhcmVudCA9IG51bGw7XG4gICAgdGhpcy5yYlByZXZpb3VzID0gbnVsbDtcbiAgICB0aGlzLnJiUmVkID0gZmFsc2U7XG4gICAgdGhpcy5yYlJpZ2h0ID0gbnVsbDtcbiAgICB0aGlzLnNpdGUgPSBudWxsO1xuICAgIHRoaXMueCA9IHRoaXMueSA9IHRoaXMueWNlbnRlciA9IDA7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuYXR0YWNoQ2lyY2xlRXZlbnQgPSBmdW5jdGlvbihhcmMpIHtcbiAgICB2YXIgbEFyYyA9IGFyYy5yYlByZXZpb3VzLFxuICAgICAgICByQXJjID0gYXJjLnJiTmV4dDtcbiAgICBpZiAoIWxBcmMgfHwgIXJBcmMpIHtyZXR1cm47fSAvLyBkb2VzIHRoYXQgZXZlciBoYXBwZW4/XG4gICAgdmFyIGxTaXRlID0gbEFyYy5zaXRlLFxuICAgICAgICBjU2l0ZSA9IGFyYy5zaXRlLFxuICAgICAgICByU2l0ZSA9IHJBcmMuc2l0ZTtcblxuICAgIC8vIElmIHNpdGUgb2YgbGVmdCBiZWFjaHNlY3Rpb24gaXMgc2FtZSBhcyBzaXRlIG9mXG4gICAgLy8gcmlnaHQgYmVhY2hzZWN0aW9uLCB0aGVyZSBjYW4ndCBiZSBjb252ZXJnZW5jZVxuICAgIGlmIChsU2l0ZT09PXJTaXRlKSB7cmV0dXJuO31cblxuICAgIC8vIEZpbmQgdGhlIGNpcmN1bXNjcmliZWQgY2lyY2xlIGZvciB0aGUgdGhyZWUgc2l0ZXMgYXNzb2NpYXRlZFxuICAgIC8vIHdpdGggdGhlIGJlYWNoc2VjdGlvbiB0cmlwbGV0LlxuICAgIC8vIHJoaWxsIDIwMTEtMDUtMjY6IEl0IGlzIG1vcmUgZWZmaWNpZW50IHRvIGNhbGN1bGF0ZSBpbi1wbGFjZVxuICAgIC8vIHJhdGhlciB0aGFuIGdldHRpbmcgdGhlIHJlc3VsdGluZyBjaXJjdW1zY3JpYmVkIGNpcmNsZSBmcm9tIGFuXG4gICAgLy8gb2JqZWN0IHJldHVybmVkIGJ5IGNhbGxpbmcgVm9yb25vaS5jaXJjdW1jaXJjbGUoKVxuICAgIC8vIGh0dHA6Ly9tYXRoZm9ydW0ub3JnL2xpYnJhcnkvZHJtYXRoL3ZpZXcvNTUwMDIuaHRtbFxuICAgIC8vIEV4Y2VwdCB0aGF0IEkgYnJpbmcgdGhlIG9yaWdpbiBhdCBjU2l0ZSB0byBzaW1wbGlmeSBjYWxjdWxhdGlvbnMuXG4gICAgLy8gVGhlIGJvdHRvbS1tb3N0IHBhcnQgb2YgdGhlIGNpcmN1bWNpcmNsZSBpcyBvdXIgRm9ydHVuZSAnY2lyY2xlXG4gICAgLy8gZXZlbnQnLCBhbmQgaXRzIGNlbnRlciBpcyBhIHZlcnRleCBwb3RlbnRpYWxseSBwYXJ0IG9mIHRoZSBmaW5hbFxuICAgIC8vIFZvcm9ub2kgZGlhZ3JhbS5cbiAgICB2YXIgYnggPSBjU2l0ZS54LFxuICAgICAgICBieSA9IGNTaXRlLnksXG4gICAgICAgIGF4ID0gbFNpdGUueC1ieCxcbiAgICAgICAgYXkgPSBsU2l0ZS55LWJ5LFxuICAgICAgICBjeCA9IHJTaXRlLngtYngsXG4gICAgICAgIGN5ID0gclNpdGUueS1ieTtcblxuICAgIC8vIElmIHBvaW50cyBsLT5jLT5yIGFyZSBjbG9ja3dpc2UsIHRoZW4gY2VudGVyIGJlYWNoIHNlY3Rpb24gZG9lcyBub3RcbiAgICAvLyBjb2xsYXBzZSwgaGVuY2UgaXQgY2FuJ3QgZW5kIHVwIGFzIGEgdmVydGV4ICh3ZSByZXVzZSAnZCcgaGVyZSwgd2hpY2hcbiAgICAvLyBzaWduIGlzIHJldmVyc2Ugb2YgdGhlIG9yaWVudGF0aW9uLCBoZW5jZSB3ZSByZXZlcnNlIHRoZSB0ZXN0LlxuICAgIC8vIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvQ3VydmVfb3JpZW50YXRpb24jT3JpZW50YXRpb25fb2ZfYV9zaW1wbGVfcG9seWdvblxuICAgIC8vIHJoaWxsIDIwMTEtMDUtMjE6IE5hc3R5IGZpbml0ZSBwcmVjaXNpb24gZXJyb3Igd2hpY2ggY2F1c2VkIGNpcmN1bWNpcmNsZSgpIHRvXG4gICAgLy8gcmV0dXJuIGluZmluaXRlczogMWUtMTIgc2VlbXMgdG8gZml4IHRoZSBwcm9ibGVtLlxuICAgIHZhciBkID0gMiooYXgqY3ktYXkqY3gpO1xuICAgIGlmIChkID49IC0yZS0xMil7cmV0dXJuO31cblxuICAgIHZhciBoYSA9IGF4KmF4K2F5KmF5LFxuICAgICAgICBoYyA9IGN4KmN4K2N5KmN5LFxuICAgICAgICB4ID0gKGN5KmhhLWF5KmhjKS9kLFxuICAgICAgICB5ID0gKGF4KmhjLWN4KmhhKS9kLFxuICAgICAgICB5Y2VudGVyID0geStieTtcblxuICAgIC8vIEltcG9ydGFudDogeWJvdHRvbSBzaG91bGQgYWx3YXlzIGJlIHVuZGVyIG9yIGF0IHN3ZWVwLCBzbyBubyBuZWVkXG4gICAgLy8gdG8gd2FzdGUgQ1BVIGN5Y2xlcyBieSBjaGVja2luZ1xuXG4gICAgLy8gcmVjeWNsZSBjaXJjbGUgZXZlbnQgb2JqZWN0IGlmIHBvc3NpYmxlXG4gICAgdmFyIGNpcmNsZUV2ZW50ID0gdGhpcy5jaXJjbGVFdmVudEp1bmt5YXJkLnBvcCgpO1xuICAgIGlmICghY2lyY2xlRXZlbnQpIHtcbiAgICAgICAgY2lyY2xlRXZlbnQgPSBuZXcgdGhpcy5DaXJjbGVFdmVudCgpO1xuICAgICAgICB9XG4gICAgY2lyY2xlRXZlbnQuYXJjID0gYXJjO1xuICAgIGNpcmNsZUV2ZW50LnNpdGUgPSBjU2l0ZTtcbiAgICBjaXJjbGVFdmVudC54ID0geCtieDtcbiAgICBjaXJjbGVFdmVudC55ID0geWNlbnRlcit0aGlzLnNxcnQoeCp4K3kqeSk7IC8vIHkgYm90dG9tXG4gICAgY2lyY2xlRXZlbnQueWNlbnRlciA9IHljZW50ZXI7XG4gICAgYXJjLmNpcmNsZUV2ZW50ID0gY2lyY2xlRXZlbnQ7XG5cbiAgICAvLyBmaW5kIGluc2VydGlvbiBwb2ludCBpbiBSQi10cmVlOiBjaXJjbGUgZXZlbnRzIGFyZSBvcmRlcmVkIGZyb21cbiAgICAvLyBzbWFsbGVzdCB0byBsYXJnZXN0XG4gICAgdmFyIHByZWRlY2Vzc29yID0gbnVsbCxcbiAgICAgICAgbm9kZSA9IHRoaXMuY2lyY2xlRXZlbnRzLnJvb3Q7XG4gICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgaWYgKGNpcmNsZUV2ZW50LnkgPCBub2RlLnkgfHwgKGNpcmNsZUV2ZW50LnkgPT09IG5vZGUueSAmJiBjaXJjbGVFdmVudC54IDw9IG5vZGUueCkpIHtcbiAgICAgICAgICAgIGlmIChub2RlLnJiTGVmdCkge1xuICAgICAgICAgICAgICAgIG5vZGUgPSBub2RlLnJiTGVmdDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBwcmVkZWNlc3NvciA9IG5vZGUucmJQcmV2aW91cztcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgaWYgKG5vZGUucmJSaWdodCkge1xuICAgICAgICAgICAgICAgIG5vZGUgPSBub2RlLnJiUmlnaHQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgcHJlZGVjZXNzb3IgPSBub2RlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIHRoaXMuY2lyY2xlRXZlbnRzLnJiSW5zZXJ0U3VjY2Vzc29yKHByZWRlY2Vzc29yLCBjaXJjbGVFdmVudCk7XG4gICAgaWYgKCFwcmVkZWNlc3Nvcikge1xuICAgICAgICB0aGlzLmZpcnN0Q2lyY2xlRXZlbnQgPSBjaXJjbGVFdmVudDtcbiAgICAgICAgfVxuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLmRldGFjaENpcmNsZUV2ZW50ID0gZnVuY3Rpb24oYXJjKSB7XG4gICAgdmFyIGNpcmNsZUV2ZW50ID0gYXJjLmNpcmNsZUV2ZW50O1xuICAgIGlmIChjaXJjbGVFdmVudCkge1xuICAgICAgICBpZiAoIWNpcmNsZUV2ZW50LnJiUHJldmlvdXMpIHtcbiAgICAgICAgICAgIHRoaXMuZmlyc3RDaXJjbGVFdmVudCA9IGNpcmNsZUV2ZW50LnJiTmV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgdGhpcy5jaXJjbGVFdmVudHMucmJSZW1vdmVOb2RlKGNpcmNsZUV2ZW50KTsgLy8gcmVtb3ZlIGZyb20gUkItdHJlZVxuICAgICAgICB0aGlzLmNpcmNsZUV2ZW50SnVua3lhcmQucHVzaChjaXJjbGVFdmVudCk7XG4gICAgICAgIGFyYy5jaXJjbGVFdmVudCA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERpYWdyYW0gY29tcGxldGlvbiBtZXRob2RzXG5cbi8vIGNvbm5lY3QgZGFuZ2xpbmcgZWRnZXMgKG5vdCBpZiBhIGN1cnNvcnkgdGVzdCB0ZWxscyB1c1xuLy8gaXQgaXMgbm90IGdvaW5nIHRvIGJlIHZpc2libGUuXG4vLyByZXR1cm4gdmFsdWU6XG4vLyAgIGZhbHNlOiB0aGUgZGFuZ2xpbmcgZW5kcG9pbnQgY291bGRuJ3QgYmUgY29ubmVjdGVkXG4vLyAgIHRydWU6IHRoZSBkYW5nbGluZyBlbmRwb2ludCBjb3VsZCBiZSBjb25uZWN0ZWRcblZvcm9ub2kucHJvdG90eXBlLmNvbm5lY3RFZGdlID0gZnVuY3Rpb24oZWRnZSwgYmJveCkge1xuICAgIC8vIHNraXAgaWYgZW5kIHBvaW50IGFscmVhZHkgY29ubmVjdGVkXG4gICAgdmFyIHZiID0gZWRnZS52YjtcbiAgICBpZiAoISF2Yikge3JldHVybiB0cnVlO31cblxuICAgIC8vIG1ha2UgbG9jYWwgY29weSBmb3IgcGVyZm9ybWFuY2UgcHVycG9zZVxuICAgIHZhciB2YSA9IGVkZ2UudmEsXG4gICAgICAgIHhsID0gYmJveC54bCxcbiAgICAgICAgeHIgPSBiYm94LnhyLFxuICAgICAgICB5dCA9IGJib3gueXQsXG4gICAgICAgIHliID0gYmJveC55YixcbiAgICAgICAgbFNpdGUgPSBlZGdlLmxTaXRlLFxuICAgICAgICByU2l0ZSA9IGVkZ2UuclNpdGUsXG4gICAgICAgIGx4ID0gbFNpdGUueCxcbiAgICAgICAgbHkgPSBsU2l0ZS55LFxuICAgICAgICByeCA9IHJTaXRlLngsXG4gICAgICAgIHJ5ID0gclNpdGUueSxcbiAgICAgICAgZnggPSAobHgrcngpLzIsXG4gICAgICAgIGZ5ID0gKGx5K3J5KS8yLFxuICAgICAgICBmbSwgZmI7XG5cbiAgICAvLyBpZiB3ZSByZWFjaCBoZXJlLCB0aGlzIG1lYW5zIGNlbGxzIHdoaWNoIHVzZSB0aGlzIGVkZ2Ugd2lsbCBuZWVkXG4gICAgLy8gdG8gYmUgY2xvc2VkLCB3aGV0aGVyIGJlY2F1c2UgdGhlIGVkZ2Ugd2FzIHJlbW92ZWQsIG9yIGJlY2F1c2UgaXRcbiAgICAvLyB3YXMgY29ubmVjdGVkIHRvIHRoZSBib3VuZGluZyBib3guXG4gICAgdGhpcy5jZWxsc1tsU2l0ZS52b3Jvbm9pSWRdLmNsb3NlTWUgPSB0cnVlO1xuICAgIHRoaXMuY2VsbHNbclNpdGUudm9yb25vaUlkXS5jbG9zZU1lID0gdHJ1ZTtcblxuICAgIC8vIGdldCB0aGUgbGluZSBlcXVhdGlvbiBvZiB0aGUgYmlzZWN0b3IgaWYgbGluZSBpcyBub3QgdmVydGljYWxcbiAgICBpZiAocnkgIT09IGx5KSB7XG4gICAgICAgIGZtID0gKGx4LXJ4KS8ocnktbHkpO1xuICAgICAgICBmYiA9IGZ5LWZtKmZ4O1xuICAgICAgICB9XG5cbiAgICAvLyByZW1lbWJlciwgZGlyZWN0aW9uIG9mIGxpbmUgKHJlbGF0aXZlIHRvIGxlZnQgc2l0ZSk6XG4gICAgLy8gdXB3YXJkOiBsZWZ0LnggPCByaWdodC54XG4gICAgLy8gZG93bndhcmQ6IGxlZnQueCA+IHJpZ2h0LnhcbiAgICAvLyBob3Jpem9udGFsOiBsZWZ0LnggPT0gcmlnaHQueFxuICAgIC8vIHVwd2FyZDogbGVmdC54IDwgcmlnaHQueFxuICAgIC8vIHJpZ2h0d2FyZDogbGVmdC55IDwgcmlnaHQueVxuICAgIC8vIGxlZnR3YXJkOiBsZWZ0LnkgPiByaWdodC55XG4gICAgLy8gdmVydGljYWw6IGxlZnQueSA9PSByaWdodC55XG5cbiAgICAvLyBkZXBlbmRpbmcgb24gdGhlIGRpcmVjdGlvbiwgZmluZCB0aGUgYmVzdCBzaWRlIG9mIHRoZVxuICAgIC8vIGJvdW5kaW5nIGJveCB0byB1c2UgdG8gZGV0ZXJtaW5lIGEgcmVhc29uYWJsZSBzdGFydCBwb2ludFxuXG4gICAgLy8gcmhpbGwgMjAxMy0xMi0wMjpcbiAgICAvLyBXaGlsZSBhdCBpdCwgc2luY2Ugd2UgaGF2ZSB0aGUgdmFsdWVzIHdoaWNoIGRlZmluZSB0aGUgbGluZSxcbiAgICAvLyBjbGlwIHRoZSBlbmQgb2YgdmEgaWYgaXQgaXMgb3V0c2lkZSB0aGUgYmJveC5cbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vZ29yaGlsbC9KYXZhc2NyaXB0LVZvcm9ub2kvaXNzdWVzLzE1XG4gICAgLy8gVE9ETzogRG8gYWxsIHRoZSBjbGlwcGluZyBoZXJlIHJhdGhlciB0aGFuIHJlbHkgb24gTGlhbmctQmFyc2t5XG4gICAgLy8gd2hpY2ggZG9lcyBub3QgZG8gd2VsbCBzb21ldGltZXMgZHVlIHRvIGxvc3Mgb2YgYXJpdGhtZXRpY1xuICAgIC8vIHByZWNpc2lvbi4gVGhlIGNvZGUgaGVyZSBkb2Vzbid0IGRlZ3JhZGUgaWYgb25lIG9mIHRoZSB2ZXJ0ZXggaXNcbiAgICAvLyBhdCBhIGh1Z2UgZGlzdGFuY2UuXG5cbiAgICAvLyBzcGVjaWFsIGNhc2U6IHZlcnRpY2FsIGxpbmVcbiAgICBpZiAoZm0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBkb2Vzbid0IGludGVyc2VjdCB3aXRoIHZpZXdwb3J0XG4gICAgICAgIGlmIChmeCA8IHhsIHx8IGZ4ID49IHhyKSB7cmV0dXJuIGZhbHNlO31cbiAgICAgICAgLy8gZG93bndhcmRcbiAgICAgICAgaWYgKGx4ID4gcngpIHtcbiAgICAgICAgICAgIGlmICghdmEgfHwgdmEueSA8IHl0KSB7XG4gICAgICAgICAgICAgICAgdmEgPSB0aGlzLmNyZWF0ZVZlcnRleChmeCwgeXQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHZhLnkgPj0geWIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleChmeCwgeWIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAvLyB1cHdhcmRcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBpZiAoIXZhIHx8IHZhLnkgPiB5Yikge1xuICAgICAgICAgICAgICAgIHZhID0gdGhpcy5jcmVhdGVWZXJ0ZXgoZngsIHliKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICh2YS55IDwgeXQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleChmeCwgeXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgLy8gY2xvc2VyIHRvIHZlcnRpY2FsIHRoYW4gaG9yaXpvbnRhbCwgY29ubmVjdCBzdGFydCBwb2ludCB0byB0aGVcbiAgICAvLyB0b3Agb3IgYm90dG9tIHNpZGUgb2YgdGhlIGJvdW5kaW5nIGJveFxuICAgIGVsc2UgaWYgKGZtIDwgLTEgfHwgZm0gPiAxKSB7XG4gICAgICAgIC8vIGRvd253YXJkXG4gICAgICAgIGlmIChseCA+IHJ4KSB7XG4gICAgICAgICAgICBpZiAoIXZhIHx8IHZhLnkgPCB5dCkge1xuICAgICAgICAgICAgICAgIHZhID0gdGhpcy5jcmVhdGVWZXJ0ZXgoKHl0LWZiKS9mbSwgeXQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHZhLnkgPj0geWIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCgoeWItZmIpL2ZtLCB5Yik7XG4gICAgICAgICAgICB9XG4gICAgICAgIC8vIHVwd2FyZFxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGlmICghdmEgfHwgdmEueSA+IHliKSB7XG4gICAgICAgICAgICAgICAgdmEgPSB0aGlzLmNyZWF0ZVZlcnRleCgoeWItZmIpL2ZtLCB5Yik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAodmEueSA8IHl0KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoKHl0LWZiKS9mbSwgeXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgLy8gY2xvc2VyIHRvIGhvcml6b250YWwgdGhhbiB2ZXJ0aWNhbCwgY29ubmVjdCBzdGFydCBwb2ludCB0byB0aGVcbiAgICAvLyBsZWZ0IG9yIHJpZ2h0IHNpZGUgb2YgdGhlIGJvdW5kaW5nIGJveFxuICAgIGVsc2Uge1xuICAgICAgICAvLyByaWdodHdhcmRcbiAgICAgICAgaWYgKGx5IDwgcnkpIHtcbiAgICAgICAgICAgIGlmICghdmEgfHwgdmEueCA8IHhsKSB7XG4gICAgICAgICAgICAgICAgdmEgPSB0aGlzLmNyZWF0ZVZlcnRleCh4bCwgZm0qeGwrZmIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHZhLnggPj0geHIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCh4ciwgZm0qeHIrZmIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAvLyBsZWZ0d2FyZFxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGlmICghdmEgfHwgdmEueCA+IHhyKSB7XG4gICAgICAgICAgICAgICAgdmEgPSB0aGlzLmNyZWF0ZVZlcnRleCh4ciwgZm0qeHIrZmIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHZhLnggPCB4bCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KHhsLCBmbSp4bCtmYik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICBlZGdlLnZhID0gdmE7XG4gICAgZWRnZS52YiA9IHZiO1xuXG4gICAgcmV0dXJuIHRydWU7XG4gICAgfTtcblxuLy8gbGluZS1jbGlwcGluZyBjb2RlIHRha2VuIGZyb206XG4vLyAgIExpYW5nLUJhcnNreSBmdW5jdGlvbiBieSBEYW5pZWwgV2hpdGVcbi8vICAgaHR0cDovL3d3dy5za3l0b3BpYS5jb20vcHJvamVjdC9hcnRpY2xlcy9jb21wc2NpL2NsaXBwaW5nLmh0bWxcbi8vIFRoYW5rcyFcbi8vIEEgYml0IG1vZGlmaWVkIHRvIG1pbmltaXplIGNvZGUgcGF0aHNcblZvcm9ub2kucHJvdG90eXBlLmNsaXBFZGdlID0gZnVuY3Rpb24oZWRnZSwgYmJveCkge1xuICAgIHZhciBheCA9IGVkZ2UudmEueCxcbiAgICAgICAgYXkgPSBlZGdlLnZhLnksXG4gICAgICAgIGJ4ID0gZWRnZS52Yi54LFxuICAgICAgICBieSA9IGVkZ2UudmIueSxcbiAgICAgICAgdDAgPSAwLFxuICAgICAgICB0MSA9IDEsXG4gICAgICAgIGR4ID0gYngtYXgsXG4gICAgICAgIGR5ID0gYnktYXk7XG4gICAgLy8gbGVmdFxuICAgIHZhciBxID0gYXgtYmJveC54bDtcbiAgICBpZiAoZHg9PT0wICYmIHE8MCkge3JldHVybiBmYWxzZTt9XG4gICAgdmFyIHIgPSAtcS9keDtcbiAgICBpZiAoZHg8MCkge1xuICAgICAgICBpZiAocjx0MCkge3JldHVybiBmYWxzZTt9XG4gICAgICAgIGlmIChyPHQxKSB7dDE9cjt9XG4gICAgICAgIH1cbiAgICBlbHNlIGlmIChkeD4wKSB7XG4gICAgICAgIGlmIChyPnQxKSB7cmV0dXJuIGZhbHNlO31cbiAgICAgICAgaWYgKHI+dDApIHt0MD1yO31cbiAgICAgICAgfVxuICAgIC8vIHJpZ2h0XG4gICAgcSA9IGJib3gueHItYXg7XG4gICAgaWYgKGR4PT09MCAmJiBxPDApIHtyZXR1cm4gZmFsc2U7fVxuICAgIHIgPSBxL2R4O1xuICAgIGlmIChkeDwwKSB7XG4gICAgICAgIGlmIChyPnQxKSB7cmV0dXJuIGZhbHNlO31cbiAgICAgICAgaWYgKHI+dDApIHt0MD1yO31cbiAgICAgICAgfVxuICAgIGVsc2UgaWYgKGR4PjApIHtcbiAgICAgICAgaWYgKHI8dDApIHtyZXR1cm4gZmFsc2U7fVxuICAgICAgICBpZiAocjx0MSkge3QxPXI7fVxuICAgICAgICB9XG4gICAgLy8gdG9wXG4gICAgcSA9IGF5LWJib3gueXQ7XG4gICAgaWYgKGR5PT09MCAmJiBxPDApIHtyZXR1cm4gZmFsc2U7fVxuICAgIHIgPSAtcS9keTtcbiAgICBpZiAoZHk8MCkge1xuICAgICAgICBpZiAocjx0MCkge3JldHVybiBmYWxzZTt9XG4gICAgICAgIGlmIChyPHQxKSB7dDE9cjt9XG4gICAgICAgIH1cbiAgICBlbHNlIGlmIChkeT4wKSB7XG4gICAgICAgIGlmIChyPnQxKSB7cmV0dXJuIGZhbHNlO31cbiAgICAgICAgaWYgKHI+dDApIHt0MD1yO31cbiAgICAgICAgfVxuICAgIC8vIGJvdHRvbSAgICAgICAgXG4gICAgcSA9IGJib3gueWItYXk7XG4gICAgaWYgKGR5PT09MCAmJiBxPDApIHtyZXR1cm4gZmFsc2U7fVxuICAgIHIgPSBxL2R5O1xuICAgIGlmIChkeTwwKSB7XG4gICAgICAgIGlmIChyPnQxKSB7cmV0dXJuIGZhbHNlO31cbiAgICAgICAgaWYgKHI+dDApIHt0MD1yO31cbiAgICAgICAgfVxuICAgIGVsc2UgaWYgKGR5PjApIHtcbiAgICAgICAgaWYgKHI8dDApIHtyZXR1cm4gZmFsc2U7fVxuICAgICAgICBpZiAocjx0MSkge3QxPXI7fVxuICAgICAgICB9XG5cbiAgICAvLyBpZiB3ZSByZWFjaCB0aGlzIHBvaW50LCBWb3Jvbm9pIGVkZ2UgaXMgd2l0aGluIGJib3hcblxuICAgIC8vIGlmIHQwID4gMCwgdmEgbmVlZHMgdG8gY2hhbmdlXG4gICAgLy8gcmhpbGwgMjAxMS0wNi0wMzogd2UgbmVlZCB0byBjcmVhdGUgYSBuZXcgdmVydGV4IHJhdGhlclxuICAgIC8vIHRoYW4gbW9kaWZ5aW5nIHRoZSBleGlzdGluZyBvbmUsIHNpbmNlIHRoZSBleGlzdGluZ1xuICAgIC8vIG9uZSBpcyBsaWtlbHkgc2hhcmVkIHdpdGggYXQgbGVhc3QgYW5vdGhlciBlZGdlXG4gICAgaWYgKHQwID4gMCkge1xuICAgICAgICBlZGdlLnZhID0gdGhpcy5jcmVhdGVWZXJ0ZXgoYXgrdDAqZHgsIGF5K3QwKmR5KTtcbiAgICAgICAgfVxuXG4gICAgLy8gaWYgdDEgPCAxLCB2YiBuZWVkcyB0byBjaGFuZ2VcbiAgICAvLyByaGlsbCAyMDExLTA2LTAzOiB3ZSBuZWVkIHRvIGNyZWF0ZSBhIG5ldyB2ZXJ0ZXggcmF0aGVyXG4gICAgLy8gdGhhbiBtb2RpZnlpbmcgdGhlIGV4aXN0aW5nIG9uZSwgc2luY2UgdGhlIGV4aXN0aW5nXG4gICAgLy8gb25lIGlzIGxpa2VseSBzaGFyZWQgd2l0aCBhdCBsZWFzdCBhbm90aGVyIGVkZ2VcbiAgICBpZiAodDEgPCAxKSB7XG4gICAgICAgIGVkZ2UudmIgPSB0aGlzLmNyZWF0ZVZlcnRleChheCt0MSpkeCwgYXkrdDEqZHkpO1xuICAgICAgICB9XG5cbiAgICAvLyB2YSBhbmQvb3IgdmIgd2VyZSBjbGlwcGVkLCB0aHVzIHdlIHdpbGwgbmVlZCB0byBjbG9zZVxuICAgIC8vIGNlbGxzIHdoaWNoIHVzZSB0aGlzIGVkZ2UuXG4gICAgaWYgKCB0MCA+IDAgfHwgdDEgPCAxICkge1xuICAgICAgICB0aGlzLmNlbGxzW2VkZ2UubFNpdGUudm9yb25vaUlkXS5jbG9zZU1lID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5jZWxsc1tlZGdlLnJTaXRlLnZvcm9ub2lJZF0uY2xvc2VNZSA9IHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWU7XG4gICAgfTtcblxuLy8gQ29ubmVjdC9jdXQgZWRnZXMgYXQgYm91bmRpbmcgYm94XG5Wb3Jvbm9pLnByb3RvdHlwZS5jbGlwRWRnZXMgPSBmdW5jdGlvbihiYm94KSB7XG4gICAgLy8gY29ubmVjdCBhbGwgZGFuZ2xpbmcgZWRnZXMgdG8gYm91bmRpbmcgYm94XG4gICAgLy8gb3IgZ2V0IHJpZCBvZiB0aGVtIGlmIGl0IGNhbid0IGJlIGRvbmVcbiAgICB2YXIgZWRnZXMgPSB0aGlzLmVkZ2VzLFxuICAgICAgICBpRWRnZSA9IGVkZ2VzLmxlbmd0aCxcbiAgICAgICAgZWRnZSxcbiAgICAgICAgYWJzX2ZuID0gTWF0aC5hYnM7XG5cbiAgICAvLyBpdGVyYXRlIGJhY2t3YXJkIHNvIHdlIGNhbiBzcGxpY2Ugc2FmZWx5XG4gICAgd2hpbGUgKGlFZGdlLS0pIHtcbiAgICAgICAgZWRnZSA9IGVkZ2VzW2lFZGdlXTtcbiAgICAgICAgLy8gZWRnZSBpcyByZW1vdmVkIGlmOlxuICAgICAgICAvLyAgIGl0IGlzIHdob2xseSBvdXRzaWRlIHRoZSBib3VuZGluZyBib3hcbiAgICAgICAgLy8gICBpdCBpcyBsb29raW5nIG1vcmUgbGlrZSBhIHBvaW50IHRoYW4gYSBsaW5lXG4gICAgICAgIGlmICghdGhpcy5jb25uZWN0RWRnZShlZGdlLCBiYm94KSB8fFxuICAgICAgICAgICAgIXRoaXMuY2xpcEVkZ2UoZWRnZSwgYmJveCkgfHxcbiAgICAgICAgICAgIChhYnNfZm4oZWRnZS52YS54LWVkZ2UudmIueCk8MWUtOSAmJiBhYnNfZm4oZWRnZS52YS55LWVkZ2UudmIueSk8MWUtOSkpIHtcbiAgICAgICAgICAgIGVkZ2UudmEgPSBlZGdlLnZiID0gbnVsbDtcbiAgICAgICAgICAgIGVkZ2VzLnNwbGljZShpRWRnZSwxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH07XG5cbi8vIENsb3NlIHRoZSBjZWxscy5cbi8vIFRoZSBjZWxscyBhcmUgYm91bmQgYnkgdGhlIHN1cHBsaWVkIGJvdW5kaW5nIGJveC5cbi8vIEVhY2ggY2VsbCByZWZlcnMgdG8gaXRzIGFzc29jaWF0ZWQgc2l0ZSwgYW5kIGEgbGlzdFxuLy8gb2YgaGFsZmVkZ2VzIG9yZGVyZWQgY291bnRlcmNsb2Nrd2lzZS5cblZvcm9ub2kucHJvdG90eXBlLmNsb3NlQ2VsbHMgPSBmdW5jdGlvbihiYm94KSB7XG4gICAgdmFyIHhsID0gYmJveC54bCxcbiAgICAgICAgeHIgPSBiYm94LnhyLFxuICAgICAgICB5dCA9IGJib3gueXQsXG4gICAgICAgIHliID0gYmJveC55YixcbiAgICAgICAgY2VsbHMgPSB0aGlzLmNlbGxzLFxuICAgICAgICBpQ2VsbCA9IGNlbGxzLmxlbmd0aCxcbiAgICAgICAgY2VsbCxcbiAgICAgICAgaUxlZnQsXG4gICAgICAgIGhhbGZlZGdlcywgbkhhbGZlZGdlcyxcbiAgICAgICAgZWRnZSxcbiAgICAgICAgdmEsIHZiLCB2eixcbiAgICAgICAgbGFzdEJvcmRlclNlZ21lbnQsXG4gICAgICAgIGFic19mbiA9IE1hdGguYWJzO1xuXG4gICAgd2hpbGUgKGlDZWxsLS0pIHtcbiAgICAgICAgY2VsbCA9IGNlbGxzW2lDZWxsXTtcbiAgICAgICAgLy8gcHJ1bmUsIG9yZGVyIGhhbGZlZGdlcyBjb3VudGVyY2xvY2t3aXNlLCB0aGVuIGFkZCBtaXNzaW5nIG9uZXNcbiAgICAgICAgLy8gcmVxdWlyZWQgdG8gY2xvc2UgY2VsbHNcbiAgICAgICAgaWYgKCFjZWxsLnByZXBhcmVIYWxmZWRnZXMoKSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIGlmICghY2VsbC5jbG9zZU1lKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgLy8gZmluZCBmaXJzdCAndW5jbG9zZWQnIHBvaW50LlxuICAgICAgICAvLyBhbiAndW5jbG9zZWQnIHBvaW50IHdpbGwgYmUgdGhlIGVuZCBwb2ludCBvZiBhIGhhbGZlZGdlIHdoaWNoXG4gICAgICAgIC8vIGRvZXMgbm90IG1hdGNoIHRoZSBzdGFydCBwb2ludCBvZiB0aGUgZm9sbG93aW5nIGhhbGZlZGdlXG4gICAgICAgIGhhbGZlZGdlcyA9IGNlbGwuaGFsZmVkZ2VzO1xuICAgICAgICBuSGFsZmVkZ2VzID0gaGFsZmVkZ2VzLmxlbmd0aDtcbiAgICAgICAgLy8gc3BlY2lhbCBjYXNlOiBvbmx5IG9uZSBzaXRlLCBpbiB3aGljaCBjYXNlLCB0aGUgdmlld3BvcnQgaXMgdGhlIGNlbGxcbiAgICAgICAgLy8gLi4uXG5cbiAgICAgICAgLy8gYWxsIG90aGVyIGNhc2VzXG4gICAgICAgIGlMZWZ0ID0gMDtcbiAgICAgICAgd2hpbGUgKGlMZWZ0IDwgbkhhbGZlZGdlcykge1xuICAgICAgICAgICAgdmEgPSBoYWxmZWRnZXNbaUxlZnRdLmdldEVuZHBvaW50KCk7XG4gICAgICAgICAgICB2eiA9IGhhbGZlZGdlc1soaUxlZnQrMSkgJSBuSGFsZmVkZ2VzXS5nZXRTdGFydHBvaW50KCk7XG4gICAgICAgICAgICAvLyBpZiBlbmQgcG9pbnQgaXMgbm90IGVxdWFsIHRvIHN0YXJ0IHBvaW50LCB3ZSBuZWVkIHRvIGFkZCB0aGUgbWlzc2luZ1xuICAgICAgICAgICAgLy8gaGFsZmVkZ2UocykgdXAgdG8gdnpcbiAgICAgICAgICAgIGlmIChhYnNfZm4odmEueC12ei54KT49MWUtOSB8fCBhYnNfZm4odmEueS12ei55KT49MWUtOSkge1xuXG4gICAgICAgICAgICAgICAgLy8gcmhpbGwgMjAxMy0xMi0wMjpcbiAgICAgICAgICAgICAgICAvLyBcIkhvbGVzXCIgaW4gdGhlIGhhbGZlZGdlcyBhcmUgbm90IG5lY2Vzc2FyaWx5IGFsd2F5cyBhZGphY2VudC5cbiAgICAgICAgICAgICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vZ29yaGlsbC9KYXZhc2NyaXB0LVZvcm9ub2kvaXNzdWVzLzE2XG5cbiAgICAgICAgICAgICAgICAvLyBmaW5kIGVudHJ5IHBvaW50OlxuICAgICAgICAgICAgICAgIHN3aXRjaCAodHJ1ZSkge1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIHdhbGsgZG93bndhcmQgYWxvbmcgbGVmdCBzaWRlXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZhLngseGwpICYmIHRoaXMubGVzc1RoYW5XaXRoRXBzaWxvbih2YS55LHliKTpcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RCb3JkZXJTZWdtZW50ID0gdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZ6LngseGwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCh4bCwgbGFzdEJvcmRlclNlZ21lbnQgPyB2ei55IDogeWIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZWRnZSA9IHRoaXMuY3JlYXRlQm9yZGVyRWRnZShjZWxsLnNpdGUsIHZhLCB2Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpTGVmdCsrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5IYWxmZWRnZXMrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggbGFzdEJvcmRlclNlZ21lbnQgKSB7IGJyZWFrOyB9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YSA9IHZiO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZmFsbCB0aHJvdWdoXG5cbiAgICAgICAgICAgICAgICAgICAgLy8gd2FsayByaWdodHdhcmQgYWxvbmcgYm90dG9tIHNpZGVcbiAgICAgICAgICAgICAgICAgICAgY2FzZSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odmEueSx5YikgJiYgdGhpcy5sZXNzVGhhbldpdGhFcHNpbG9uKHZhLngseHIpOlxuICAgICAgICAgICAgICAgICAgICAgICAgbGFzdEJvcmRlclNlZ21lbnQgPSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odnoueSx5Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KGxhc3RCb3JkZXJTZWdtZW50ID8gdnoueCA6IHhyLCB5Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlMZWZ0Kys7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlMZWZ0LCAwLCB0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIGNlbGwuc2l0ZSwgbnVsbCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBsYXN0Qm9yZGVyU2VnbWVudCApIHsgYnJlYWs7IH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZhID0gdmI7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcblxuICAgICAgICAgICAgICAgICAgICAvLyB3YWxrIHVwd2FyZCBhbG9uZyByaWdodCBzaWRlXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZhLngseHIpICYmIHRoaXMuZ3JlYXRlclRoYW5XaXRoRXBzaWxvbih2YS55LHl0KTpcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RCb3JkZXJTZWdtZW50ID0gdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZ6LngseHIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCh4ciwgbGFzdEJvcmRlclNlZ21lbnQgPyB2ei55IDogeXQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZWRnZSA9IHRoaXMuY3JlYXRlQm9yZGVyRWRnZShjZWxsLnNpdGUsIHZhLCB2Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpTGVmdCsrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5IYWxmZWRnZXMrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggbGFzdEJvcmRlclNlZ21lbnQgKSB7IGJyZWFrOyB9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YSA9IHZiO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZmFsbCB0aHJvdWdoXG5cbiAgICAgICAgICAgICAgICAgICAgLy8gd2FsayBsZWZ0d2FyZCBhbG9uZyB0b3Agc2lkZVxuICAgICAgICAgICAgICAgICAgICBjYXNlIHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2YS55LHl0KSAmJiB0aGlzLmdyZWF0ZXJUaGFuV2l0aEVwc2lsb24odmEueCx4bCk6XG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei55LHl0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgobGFzdEJvcmRlclNlZ21lbnQgPyB2ei54IDogeGwsIHl0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkZ2UgPSB0aGlzLmNyZWF0ZUJvcmRlckVkZ2UoY2VsbC5zaXRlLCB2YSwgdmIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGZlZGdlcy5zcGxpY2UoaUxlZnQsIDAsIHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgY2VsbC5zaXRlLCBudWxsKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBuSGFsZmVkZ2VzKys7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmEgPSB2YjtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZhbGwgdGhyb3VnaFxuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB3YWxrIGRvd253YXJkIGFsb25nIGxlZnQgc2lkZVxuICAgICAgICAgICAgICAgICAgICAgICAgbGFzdEJvcmRlclNlZ21lbnQgPSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odnoueCx4bCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KHhsLCBsYXN0Qm9yZGVyU2VnbWVudCA/IHZ6LnkgOiB5Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlMZWZ0Kys7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlMZWZ0LCAwLCB0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIGNlbGwuc2l0ZSwgbnVsbCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBsYXN0Qm9yZGVyU2VnbWVudCApIHsgYnJlYWs7IH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZhID0gdmI7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcblxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2FsayByaWdodHdhcmQgYWxvbmcgYm90dG9tIHNpZGVcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RCb3JkZXJTZWdtZW50ID0gdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZ6LnkseWIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleChsYXN0Qm9yZGVyU2VnbWVudCA/IHZ6LnggOiB4ciwgeWIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZWRnZSA9IHRoaXMuY3JlYXRlQm9yZGVyRWRnZShjZWxsLnNpdGUsIHZhLCB2Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpTGVmdCsrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5IYWxmZWRnZXMrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggbGFzdEJvcmRlclNlZ21lbnQgKSB7IGJyZWFrOyB9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YSA9IHZiO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZmFsbCB0aHJvdWdoXG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdhbGsgdXB3YXJkIGFsb25nIHJpZ2h0IHNpZGVcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RCb3JkZXJTZWdtZW50ID0gdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZ6LngseHIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCh4ciwgbGFzdEJvcmRlclNlZ21lbnQgPyB2ei55IDogeXQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZWRnZSA9IHRoaXMuY3JlYXRlQm9yZGVyRWRnZShjZWxsLnNpdGUsIHZhLCB2Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpTGVmdCsrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5IYWxmZWRnZXMrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggbGFzdEJvcmRlclNlZ21lbnQgKSB7IGJyZWFrOyB9XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcblxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgXCJWb3Jvbm9pLmNsb3NlQ2VsbHMoKSA+IHRoaXMgbWFrZXMgbm8gc2Vuc2UhXCI7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBpTGVmdCsrO1xuICAgICAgICAgICAgfVxuICAgICAgICBjZWxsLmNsb3NlTWUgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVidWdnaW5nIGhlbHBlclxuLypcblZvcm9ub2kucHJvdG90eXBlLmR1bXBCZWFjaGxpbmUgPSBmdW5jdGlvbih5KSB7XG4gICAgY29uc29sZS5sb2coJ1Zvcm9ub2kuZHVtcEJlYWNobGluZSglZikgPiBCZWFjaHNlY3Rpb25zLCBmcm9tIGxlZnQgdG8gcmlnaHQ6JywgeSk7XG4gICAgaWYgKCAhdGhpcy5iZWFjaGxpbmUgKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCcgIE5vbmUnKTtcbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICB2YXIgYnMgPSB0aGlzLmJlYWNobGluZS5nZXRGaXJzdCh0aGlzLmJlYWNobGluZS5yb290KTtcbiAgICAgICAgd2hpbGUgKCBicyApIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCcgIHNpdGUgJWQ6IHhsOiAlZiwgeHI6ICVmJywgYnMuc2l0ZS52b3Jvbm9pSWQsIHRoaXMubGVmdEJyZWFrUG9pbnQoYnMsIHkpLCB0aGlzLnJpZ2h0QnJlYWtQb2ludChicywgeSkpO1xuICAgICAgICAgICAgYnMgPSBicy5yYk5leHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xuKi9cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBIZWxwZXI6IFF1YW50aXplIHNpdGVzXG5cbi8vIHJoaWxsIDIwMTMtMTAtMTI6XG4vLyBUaGlzIGlzIHRvIHNvbHZlIGh0dHBzOi8vZ2l0aHViLmNvbS9nb3JoaWxsL0phdmFzY3JpcHQtVm9yb25vaS9pc3N1ZXMvMTVcbi8vIFNpbmNlIG5vdCBhbGwgdXNlcnMgd2lsbCBlbmQgdXAgdXNpbmcgdGhlIGtpbmQgb2YgY29vcmQgdmFsdWVzIHdoaWNoIHdvdWxkXG4vLyBjYXVzZSB0aGUgaXNzdWUgdG8gYXJpc2UsIEkgY2hvc2UgdG8gbGV0IHRoZSB1c2VyIGRlY2lkZSB3aGV0aGVyIG9yIG5vdFxuLy8gaGUgc2hvdWxkIHNhbml0aXplIGhpcyBjb29yZCB2YWx1ZXMgdGhyb3VnaCB0aGlzIGhlbHBlci4gVGhpcyB3YXksIGZvclxuLy8gdGhvc2UgdXNlcnMgd2hvIHVzZXMgY29vcmQgdmFsdWVzIHdoaWNoIGFyZSBrbm93biB0byBiZSBmaW5lLCBubyBvdmVyaGVhZCBpc1xuLy8gYWRkZWQuXG5cblZvcm9ub2kucHJvdG90eXBlLnF1YW50aXplU2l0ZXMgPSBmdW5jdGlvbihzaXRlcykge1xuICAgIHZhciDOtSA9IHRoaXMuzrUsXG4gICAgICAgIG4gPSBzaXRlcy5sZW5ndGgsXG4gICAgICAgIHNpdGU7XG4gICAgd2hpbGUgKCBuLS0gKSB7XG4gICAgICAgIHNpdGUgPSBzaXRlc1tuXTtcbiAgICAgICAgc2l0ZS54ID0gTWF0aC5mbG9vcihzaXRlLnggLyDOtSkgKiDOtTtcbiAgICAgICAgc2l0ZS55ID0gTWF0aC5mbG9vcihzaXRlLnkgLyDOtSkgKiDOtTtcbiAgICAgICAgfVxuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVscGVyOiBSZWN5Y2xlIGRpYWdyYW06IGFsbCB2ZXJ0ZXgsIGVkZ2UgYW5kIGNlbGwgb2JqZWN0cyBhcmVcbi8vIFwic3VycmVuZGVyZWRcIiB0byB0aGUgVm9yb25vaSBvYmplY3QgZm9yIHJldXNlLlxuLy8gVE9ETzogcmhpbGwtdm9yb25vaS1jb3JlIHYyOiBtb3JlIHBlcmZvcm1hbmNlIHRvIGJlIGdhaW5lZFxuLy8gd2hlbiBJIGNoYW5nZSB0aGUgc2VtYW50aWMgb2Ygd2hhdCBpcyByZXR1cm5lZC5cblxuVm9yb25vaS5wcm90b3R5cGUucmVjeWNsZSA9IGZ1bmN0aW9uKGRpYWdyYW0pIHtcbiAgICBpZiAoIGRpYWdyYW0gKSB7XG4gICAgICAgIGlmICggZGlhZ3JhbSBpbnN0YW5jZW9mIHRoaXMuRGlhZ3JhbSApIHtcbiAgICAgICAgICAgIHRoaXMudG9SZWN5Y2xlID0gZGlhZ3JhbTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyAnVm9yb25vaS5yZWN5Y2xlRGlhZ3JhbSgpID4gTmVlZCBhIERpYWdyYW0gb2JqZWN0Lic7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvcC1sZXZlbCBGb3J0dW5lIGxvb3BcblxuLy8gcmhpbGwgMjAxMS0wNS0xOTpcbi8vICAgVm9yb25vaSBzaXRlcyBhcmUga2VwdCBjbGllbnQtc2lkZSBub3csIHRvIGFsbG93XG4vLyAgIHVzZXIgdG8gZnJlZWx5IG1vZGlmeSBjb250ZW50LiBBdCBjb21wdXRlIHRpbWUsXG4vLyAgICpyZWZlcmVuY2VzKiB0byBzaXRlcyBhcmUgY29waWVkIGxvY2FsbHkuXG5cblZvcm9ub2kucHJvdG90eXBlLmNvbXB1dGUgPSBmdW5jdGlvbihzaXRlcywgYmJveCkge1xuICAgIC8vIHRvIG1lYXN1cmUgZXhlY3V0aW9uIHRpbWVcbiAgICB2YXIgc3RhcnRUaW1lID0gbmV3IERhdGUoKTtcblxuICAgIC8vIGluaXQgaW50ZXJuYWwgc3RhdGVcbiAgICB0aGlzLnJlc2V0KCk7XG5cbiAgICAvLyBhbnkgZGlhZ3JhbSBkYXRhIGF2YWlsYWJsZSBmb3IgcmVjeWNsaW5nP1xuICAgIC8vIEkgZG8gdGhhdCBoZXJlIHNvIHRoYXQgdGhpcyBpcyBpbmNsdWRlZCBpbiBleGVjdXRpb24gdGltZVxuICAgIGlmICggdGhpcy50b1JlY3ljbGUgKSB7XG4gICAgICAgIHRoaXMudmVydGV4SnVua3lhcmQgPSB0aGlzLnZlcnRleEp1bmt5YXJkLmNvbmNhdCh0aGlzLnRvUmVjeWNsZS52ZXJ0aWNlcyk7XG4gICAgICAgIHRoaXMuZWRnZUp1bmt5YXJkID0gdGhpcy5lZGdlSnVua3lhcmQuY29uY2F0KHRoaXMudG9SZWN5Y2xlLmVkZ2VzKTtcbiAgICAgICAgdGhpcy5jZWxsSnVua3lhcmQgPSB0aGlzLmNlbGxKdW5reWFyZC5jb25jYXQodGhpcy50b1JlY3ljbGUuY2VsbHMpO1xuICAgICAgICB0aGlzLnRvUmVjeWNsZSA9IG51bGw7XG4gICAgICAgIH1cblxuICAgIC8vIEluaXRpYWxpemUgc2l0ZSBldmVudCBxdWV1ZVxuICAgIHZhciBzaXRlRXZlbnRzID0gc2l0ZXMuc2xpY2UoMCk7XG4gICAgc2l0ZUV2ZW50cy5zb3J0KGZ1bmN0aW9uKGEsYil7XG4gICAgICAgIHZhciByID0gYi55IC0gYS55O1xuICAgICAgICBpZiAocikge3JldHVybiByO31cbiAgICAgICAgcmV0dXJuIGIueCAtIGEueDtcbiAgICAgICAgfSk7XG5cbiAgICAvLyBwcm9jZXNzIHF1ZXVlXG4gICAgdmFyIHNpdGUgPSBzaXRlRXZlbnRzLnBvcCgpLFxuICAgICAgICBzaXRlaWQgPSAwLFxuICAgICAgICB4c2l0ZXgsIC8vIHRvIGF2b2lkIGR1cGxpY2F0ZSBzaXRlc1xuICAgICAgICB4c2l0ZXksXG4gICAgICAgIGNlbGxzID0gdGhpcy5jZWxscyxcbiAgICAgICAgY2lyY2xlO1xuXG4gICAgLy8gbWFpbiBsb29wXG4gICAgZm9yICg7Oykge1xuICAgICAgICAvLyB3ZSBuZWVkIHRvIGZpZ3VyZSB3aGV0aGVyIHdlIGhhbmRsZSBhIHNpdGUgb3IgY2lyY2xlIGV2ZW50XG4gICAgICAgIC8vIGZvciB0aGlzIHdlIGZpbmQgb3V0IGlmIHRoZXJlIGlzIGEgc2l0ZSBldmVudCBhbmQgaXQgaXNcbiAgICAgICAgLy8gJ2VhcmxpZXInIHRoYW4gdGhlIGNpcmNsZSBldmVudFxuICAgICAgICBjaXJjbGUgPSB0aGlzLmZpcnN0Q2lyY2xlRXZlbnQ7XG5cbiAgICAgICAgLy8gYWRkIGJlYWNoIHNlY3Rpb25cbiAgICAgICAgaWYgKHNpdGUgJiYgKCFjaXJjbGUgfHwgc2l0ZS55IDwgY2lyY2xlLnkgfHwgKHNpdGUueSA9PT0gY2lyY2xlLnkgJiYgc2l0ZS54IDwgY2lyY2xlLngpKSkge1xuICAgICAgICAgICAgLy8gb25seSBpZiBzaXRlIGlzIG5vdCBhIGR1cGxpY2F0ZVxuICAgICAgICAgICAgaWYgKHNpdGUueCAhPT0geHNpdGV4IHx8IHNpdGUueSAhPT0geHNpdGV5KSB7XG4gICAgICAgICAgICAgICAgLy8gZmlyc3QgY3JlYXRlIGNlbGwgZm9yIG5ldyBzaXRlXG4gICAgICAgICAgICAgICAgY2VsbHNbc2l0ZWlkXSA9IHRoaXMuY3JlYXRlQ2VsbChzaXRlKTtcbiAgICAgICAgICAgICAgICBzaXRlLnZvcm9ub2lJZCA9IHNpdGVpZCsrO1xuICAgICAgICAgICAgICAgIC8vIHRoZW4gY3JlYXRlIGEgYmVhY2hzZWN0aW9uIGZvciB0aGF0IHNpdGVcbiAgICAgICAgICAgICAgICB0aGlzLmFkZEJlYWNoc2VjdGlvbihzaXRlKTtcbiAgICAgICAgICAgICAgICAvLyByZW1lbWJlciBsYXN0IHNpdGUgY29vcmRzIHRvIGRldGVjdCBkdXBsaWNhdGVcbiAgICAgICAgICAgICAgICB4c2l0ZXkgPSBzaXRlLnk7XG4gICAgICAgICAgICAgICAgeHNpdGV4ID0gc2l0ZS54O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNpdGUgPSBzaXRlRXZlbnRzLnBvcCgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlbW92ZSBiZWFjaCBzZWN0aW9uXG4gICAgICAgIGVsc2UgaWYgKGNpcmNsZSkge1xuICAgICAgICAgICAgdGhpcy5yZW1vdmVCZWFjaHNlY3Rpb24oY2lyY2xlLmFyYyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgLy8gYWxsIGRvbmUsIHF1aXRcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgLy8gd3JhcHBpbmctdXA6XG4gICAgLy8gICBjb25uZWN0IGRhbmdsaW5nIGVkZ2VzIHRvIGJvdW5kaW5nIGJveFxuICAgIC8vICAgY3V0IGVkZ2VzIGFzIHBlciBib3VuZGluZyBib3hcbiAgICAvLyAgIGRpc2NhcmQgZWRnZXMgY29tcGxldGVseSBvdXRzaWRlIGJvdW5kaW5nIGJveFxuICAgIC8vICAgZGlzY2FyZCBlZGdlcyB3aGljaCBhcmUgcG9pbnQtbGlrZVxuICAgIHRoaXMuY2xpcEVkZ2VzKGJib3gpO1xuXG4gICAgLy8gICBhZGQgbWlzc2luZyBlZGdlcyBpbiBvcmRlciB0byBjbG9zZSBvcGVuZWQgY2VsbHNcbiAgICB0aGlzLmNsb3NlQ2VsbHMoYmJveCk7XG5cbiAgICAvLyB0byBtZWFzdXJlIGV4ZWN1dGlvbiB0aW1lXG4gICAgdmFyIHN0b3BUaW1lID0gbmV3IERhdGUoKTtcblxuICAgIC8vIHByZXBhcmUgcmV0dXJuIHZhbHVlc1xuICAgIHZhciBkaWFncmFtID0gbmV3IHRoaXMuRGlhZ3JhbSgpO1xuICAgIGRpYWdyYW0uY2VsbHMgPSB0aGlzLmNlbGxzO1xuICAgIGRpYWdyYW0uZWRnZXMgPSB0aGlzLmVkZ2VzO1xuICAgIGRpYWdyYW0udmVydGljZXMgPSB0aGlzLnZlcnRpY2VzO1xuICAgIGRpYWdyYW0uZXhlY1RpbWUgPSBzdG9wVGltZS5nZXRUaW1lKCktc3RhcnRUaW1lLmdldFRpbWUoKTtcblxuICAgIC8vIGNsZWFuIHVwXG4gICAgdGhpcy5yZXNldCgpO1xuXG4gICAgcmV0dXJuIGRpYWdyYW07XG4gICAgfTtcblxuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuaWYgKCB0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJyApIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IFZvcm9ub2k7XG59XG4iLCIiLCIvKlxucG9pc3Nvbi1kaXNrLXNhbXBsZVxuXG5odHRwczovL2dpdGh1Yi5jb20vamVmZnJleS1oZWFybi9wb2lzc29uLWRpc2stc2FtcGxlXG5cbk1JVCBMaWNlbnNlXG4qL1xuXG5mdW5jdGlvbiBQb2lzc29uRGlza1NhbXBsZXIod2lkdGgsIGhlaWdodCwgbWluRGlzdGFuY2UsIHNhbXBsZUZyZXF1ZW5jeSkge1xuICAgIHRoaXMud2lkdGggPSB3aWR0aDtcbiAgICB0aGlzLmhlaWdodCA9IGhlaWdodDtcbiAgICB0aGlzLm1pbkRpc3RhbmNlID0gbWluRGlzdGFuY2U7XG4gICAgdGhpcy5zYW1wbGVGcmVxdWVuY3kgPSBzYW1wbGVGcmVxdWVuY3k7XG4gICAgdGhpcy5yZXNldCgpO1xufVxuXG5Qb2lzc29uRGlza1NhbXBsZXIucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5ncmlkID0gbmV3IEdyaWQodGhpcy53aWR0aCwgdGhpcy5oZWlnaHQsIHRoaXMubWluRGlzdGFuY2UpO1xuICAgIHRoaXMub3V0cHV0TGlzdCA9IG5ldyBBcnJheSgpO1xuICAgIHRoaXMucHJvY2Vzc2luZ1F1ZXVlID0gbmV3IFJhbmRvbVF1ZXVlKCk7XG59XG5cblBvaXNzb25EaXNrU2FtcGxlci5wcm90b3R5cGUuc2FtcGxlVW50aWxTb2x1dGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHdoaWxlICh0aGlzLnNhbXBsZSgpKSB7fTtcbiAgICByZXR1cm4gdGhpcy5vdXRwdXRMaXN0O1xufVxuXG5Qb2lzc29uRGlza1NhbXBsZXIucHJvdG90eXBlLnNhbXBsZSA9IGZ1bmN0aW9uKCkge1xuXG4gICAgLy8gSWYgdGhpcyBpcyB0aGUgZmlyc3Qgc2FtcGxlXG4gICAgaWYgKDAgPT0gdGhpcy5vdXRwdXRMaXN0Lmxlbmd0aCkge1xuICAgICAgICAvLyBHZW5lcmF0ZSBmaXJzdCBwb2ludFxuICAgICAgICB0aGlzLnF1ZXVlVG9BbGwodGhpcy5ncmlkLnJhbmRvbVBvaW50KCkpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgcHJvY2Vzc1BvaW50ID0gdGhpcy5wcm9jZXNzaW5nUXVldWUucG9wKCk7XG5cbiAgICAvLyBQcm9jZXNzaW5nIHF1ZXVlIGlzIGVtcHR5LCByZXR1cm4gZmFpbHVyZVxuICAgIGlmIChwcm9jZXNzUG9pbnQgPT0gbnVsbClcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuXG4gICAgLy8gR2VuZXJhdGUgc2FtcGxlIHBvaW50cyBhcm91bmQgdGhlIHByb2Nlc3NpbmcgcG9pbnRcbiAgICAvLyBBbmQgY2hlY2sgaWYgdGhleSBoYXZlIGFueSBuZWlnaGJvcnMgb24gdGhlIGdyaWRcbiAgICAvLyBJZiBub3QsIGFkZCB0aGVtIHRvIHRoZSBxdWV1ZXNcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuc2FtcGxlRnJlcXVlbmN5OyBpKyspIHtcbiAgICAgICAgc2FtcGxlUG9pbnQgPSB0aGlzLmdyaWQucmFuZG9tUG9pbnRBcm91bmQocHJvY2Vzc1BvaW50KTtcbiAgICAgICAgaWYgKCF0aGlzLmdyaWQuaW5OZWlnaGJvcmhvb2Qoc2FtcGxlUG9pbnQpKSB7XG4gICAgICAgICAgICAvLyBObyBvbiBpbiBuZWlnaGJvcmhvb2QsIHdlbGNvbWUgdG8gdGhlIGNsdWJcbiAgICAgICAgICAgIHRoaXMucXVldWVUb0FsbChzYW1wbGVQb2ludCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLy8gU2FtcGxlIHN1Y2Nlc3NmdWwgc2luY2UgdGhlIHByb2Nlc3NpbmcgcXVldWUgaXNuJ3QgZW1wdHlcbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuUG9pc3NvbkRpc2tTYW1wbGVyLnByb3RvdHlwZS5xdWV1ZVRvQWxsID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgICB2YXIgdmFsaWQgPSB0aGlzLmdyaWQuYWRkUG9pbnRUb0dyaWQocG9pbnQsIHRoaXMuZ3JpZC5waXhlbHNUb0dyaWRDb29yZHMocG9pbnQpKTtcbiAgICBpZiAoIXZhbGlkKVxuICAgICAgICByZXR1cm47XG4gICAgdGhpcy5wcm9jZXNzaW5nUXVldWUucHVzaChwb2ludCk7XG4gICAgdGhpcy5vdXRwdXRMaXN0LnB1c2gocG9pbnQpO1xufVxuXG5cblxuZnVuY3Rpb24gR3JpZCh3aWR0aCwgaGVpZ2h0LCBtaW5EaXN0YW5jZSkge1xuICAgIHRoaXMud2lkdGggPSB3aWR0aDtcbiAgICB0aGlzLmhlaWdodCA9IGhlaWdodDtcbiAgICB0aGlzLm1pbkRpc3RhbmNlID0gbWluRGlzdGFuY2U7XG4gICAgdGhpcy5jZWxsU2l6ZSA9IHRoaXMubWluRGlzdGFuY2UgLyBNYXRoLlNRUlQyO1xuICAgIC8vY29uc29sZS5sb2coIHRoaXMuY2VsbFNpemUgKTtcbiAgICB0aGlzLnBvaW50U2l6ZSA9IDI7XG5cbiAgICB0aGlzLmNlbGxzV2lkZSA9IE1hdGguY2VpbCh0aGlzLndpZHRoIC8gdGhpcy5jZWxsU2l6ZSk7XG4gICAgdGhpcy5jZWxsc0hpZ2ggPSBNYXRoLmNlaWwodGhpcy5oZWlnaHQgLyB0aGlzLmNlbGxTaXplKTtcblxuICAgIC8vIEluaXRpYWxpemUgZ3JpZFxuICAgIHRoaXMuZ3JpZCA9IFtdO1xuICAgIGZvciAodmFyIHggPSAwOyB4IDwgdGhpcy5jZWxsc1dpZGU7IHgrKykge1xuICAgICAgICB0aGlzLmdyaWRbeF0gPSBbXTtcbiAgICAgICAgZm9yICh2YXIgeSA9IDA7IHkgPCB0aGlzLmNlbGxzSGlnaDsgeSsrKSB7XG4gICAgICAgICAgICB0aGlzLmdyaWRbeF1beV0gPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5HcmlkLnByb3RvdHlwZS5waXhlbHNUb0dyaWRDb29yZHMgPSBmdW5jdGlvbihwb2ludCkge1xuICAgIHZhciBncmlkWCA9IE1hdGguZmxvb3IocG9pbnQueCAvIHRoaXMuY2VsbFNpemUpO1xuICAgIHZhciBncmlkWSA9IE1hdGguZmxvb3IocG9pbnQueSAvIHRoaXMuY2VsbFNpemUpO1xuICAgIHJldHVybiB7IHg6IGdyaWRYLCB5OiBncmlkWSB9O1xufVxuXG5HcmlkLnByb3RvdHlwZS5hZGRQb2ludFRvR3JpZCA9IGZ1bmN0aW9uKHBvaW50Q29vcmRzLCBncmlkQ29vcmRzKSB7XG4gICAgLy8gQ2hlY2sgdGhhdCB0aGUgY29vcmRpbmF0ZSBtYWtlcyBzZW5zZVxuICAgIGlmIChncmlkQ29vcmRzLnggPCAwIHx8IGdyaWRDb29yZHMueCA+IHRoaXMuZ3JpZC5sZW5ndGggLSAxKVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGdyaWRDb29yZHMueSA8IDAgfHwgZ3JpZENvb3Jkcy55ID4gdGhpcy5ncmlkW2dyaWRDb29yZHMueF0ubGVuZ3RoIC0gMSlcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIHRoaXMuZ3JpZFtncmlkQ29vcmRzLnhdW2dyaWRDb29yZHMueV0gPSBwb2ludENvb3JkcztcbiAgICAvL2NvbnNvbGUubG9nKCBcIkFkZGluZyAoXCIrcG9pbnRDb29yZHMueCtcIixcIitwb2ludENvb3Jkcy55K1wiIHRvIGdyaWQgW1wiK2dyaWRDb29yZHMueCtcIixcIitncmlkQ29vcmRzLnkrXCJdXCIgKTtcbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuR3JpZC5wcm90b3R5cGUucmFuZG9tUG9pbnQgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4geyB4OiBnZXRSYW5kb21BcmJpdHJhcnkoMCwgdGhpcy53aWR0aCksIHk6IGdldFJhbmRvbUFyYml0cmFyeSgwLCB0aGlzLmhlaWdodCkgfTtcbn1cblxuR3JpZC5wcm90b3R5cGUucmFuZG9tUG9pbnRBcm91bmQgPSBmdW5jdGlvbihwb2ludCkge1xuICAgIHZhciByMSA9IE1hdGgucmFuZG9tKCk7XG4gICAgdmFyIHIyID0gTWF0aC5yYW5kb20oKTtcbiAgICAvLyBnZXQgYSByYW5kb20gcmFkaXVzIGJldHdlZW4gdGhlIG1pbiBkaXN0YW5jZSBhbmQgMiBYIG1pbmRpc3RcbiAgICB2YXIgcmFkaXVzID0gdGhpcy5taW5EaXN0YW5jZSAqIChyMSArIDEpO1xuICAgIC8vIGdldCByYW5kb20gYW5nbGUgYXJvdW5kIHRoZSBjaXJjbGVcbiAgICB2YXIgYW5nbGUgPSAyICogTWF0aC5QSSAqIHIyO1xuICAgIC8vIGdldCB4IGFuZCB5IGNvb3JkcyBiYXNlZCBvbiBhbmdsZSBhbmQgcmFkaXVzXG4gICAgdmFyIHggPSBwb2ludC54ICsgcmFkaXVzICogTWF0aC5jb3MoYW5nbGUpO1xuICAgIHZhciB5ID0gcG9pbnQueSArIHJhZGl1cyAqIE1hdGguc2luKGFuZ2xlKTtcbiAgICByZXR1cm4geyB4OiB4LCB5OiB5IH07XG59XG5cbkdyaWQucHJvdG90eXBlLmluTmVpZ2hib3Job29kID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgICB2YXIgZ3JpZFBvaW50ID0gdGhpcy5waXhlbHNUb0dyaWRDb29yZHMocG9pbnQpO1xuXG4gICAgdmFyIGNlbGxzQXJvdW5kUG9pbnQgPSB0aGlzLmNlbGxzQXJvdW5kUG9pbnQocG9pbnQpO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjZWxsc0Fyb3VuZFBvaW50Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChjZWxsc0Fyb3VuZFBvaW50W2ldICE9IG51bGwpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmNhbGNEaXN0YW5jZShjZWxsc0Fyb3VuZFBvaW50W2ldLCBwb2ludCkgPCB0aGlzLm1pbkRpc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5HcmlkLnByb3RvdHlwZS5jZWxsc0Fyb3VuZFBvaW50ID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgICB2YXIgZ3JpZENvb3JkcyA9IHRoaXMucGl4ZWxzVG9HcmlkQ29vcmRzKHBvaW50KTtcbiAgICB2YXIgbmVpZ2hib3JzID0gbmV3IEFycmF5KCk7XG5cbiAgICBmb3IgKHZhciB4ID0gLTI7IHggPCAzOyB4KyspIHtcbiAgICAgICAgdmFyIHRhcmdldFggPSBncmlkQ29vcmRzLnggKyB4O1xuICAgICAgICAvLyBtYWtlIHN1cmUgbG93ZXJib3VuZCBhbmQgdXBwZXJib3VuZCBtYWtlIHNlbnNlXG4gICAgICAgIGlmICh0YXJnZXRYIDwgMClcbiAgICAgICAgICAgIHRhcmdldFggPSAwO1xuICAgICAgICBpZiAodGFyZ2V0WCA+IHRoaXMuZ3JpZC5sZW5ndGggLSAxKVxuICAgICAgICAgICAgdGFyZ2V0WCA9IHRoaXMuZ3JpZC5sZW5ndGggLSAxO1xuXG4gICAgICAgIGZvciAodmFyIHkgPSAtMjsgeSA8IDM7IHkrKykge1xuICAgICAgICAgICAgdmFyIHRhcmdldFkgPSBncmlkQ29vcmRzLnkgKyB5O1xuICAgICAgICAgICAgLy8gbWFrZSBzdXJlIGxvd2VyYm91bmQgYW5kIHVwcGVyYm91bmQgbWFrZSBzZW5zZVxuICAgICAgICAgICAgaWYgKHRhcmdldFkgPCAwKVxuICAgICAgICAgICAgICAgIHRhcmdldFkgPSAwO1xuICAgICAgICAgICAgaWYgKHRhcmdldFkgPiB0aGlzLmdyaWRbdGFyZ2V0WF0ubGVuZ3RoIC0gMSlcbiAgICAgICAgICAgICAgICB0YXJnZXRZID0gdGhpcy5ncmlkW3RhcmdldFhdLmxlbmd0aCAtIDE7XG4gICAgICAgICAgICBuZWlnaGJvcnMucHVzaCh0aGlzLmdyaWRbdGFyZ2V0WF1bdGFyZ2V0WV0pXG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG5laWdoYm9ycztcbn1cblxuR3JpZC5wcm90b3R5cGUuY2FsY0Rpc3RhbmNlID0gZnVuY3Rpb24ocG9pbnRJbkNlbGwsIHBvaW50KSB7XG4gICAgcmV0dXJuIE1hdGguc3FydCgocG9pbnQueCAtIHBvaW50SW5DZWxsLngpICogKHBvaW50LnggLSBwb2ludEluQ2VsbC54KSArXG4gICAgICAgIChwb2ludC55IC0gcG9pbnRJbkNlbGwueSkgKiAocG9pbnQueSAtIHBvaW50SW5DZWxsLnkpKTtcbn1cblxuXG5mdW5jdGlvbiBSYW5kb21RdWV1ZShhKSB7XG4gICAgdGhpcy5xdWV1ZSA9IGEgfHwgbmV3IEFycmF5KCk7XG59XG5cblJhbmRvbVF1ZXVlLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oZWxlbWVudCkge1xuICAgIHRoaXMucXVldWUucHVzaChlbGVtZW50KTtcbn1cblxuUmFuZG9tUXVldWUucHJvdG90eXBlLnBvcCA9IGZ1bmN0aW9uKCkge1xuXG4gICAgcmFuZG9tSW5kZXggPSBnZXRSYW5kb21JbnQoMCwgdGhpcy5xdWV1ZS5sZW5ndGgpO1xuICAgIHdoaWxlICh0aGlzLnF1ZXVlW3JhbmRvbUluZGV4XSA9PT0gdW5kZWZpbmVkKSB7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHF1ZXVlIGlzIGVtcHR5XG4gICAgICAgIHZhciBlbXB0eSA9IHRydWU7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5xdWV1ZS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKHRoaXMucXVldWVbaV0gIT09IHVuZGVmaW5lZClcbiAgICAgICAgICAgICAgICBlbXB0eSA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChlbXB0eSlcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuXG4gICAgICAgIHJhbmRvbUluZGV4ID0gZ2V0UmFuZG9tSW50KDAsIHRoaXMucXVldWUubGVuZ3RoKTtcbiAgICB9XG5cbiAgICBlbGVtZW50ID0gdGhpcy5xdWV1ZVtyYW5kb21JbmRleF07XG4gICAgdGhpcy5xdWV1ZS5yZW1vdmUocmFuZG9tSW5kZXgpO1xuICAgIHJldHVybiBlbGVtZW50O1xufVxuXG4vLyBBcnJheSBSZW1vdmUgLSBCeSBKb2huIFJlc2lnIChNSVQgTGljZW5zZWQpXG5BcnJheS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oZnJvbSwgdG8pIHtcbiAgICB2YXIgcmVzdCA9IHRoaXMuc2xpY2UoKHRvIHx8IGZyb20pICsgMSB8fCB0aGlzLmxlbmd0aCk7XG4gICAgdGhpcy5sZW5ndGggPSBmcm9tIDwgMCA/IHRoaXMubGVuZ3RoICsgZnJvbSA6IGZyb207XG4gICAgcmV0dXJuIHRoaXMucHVzaC5hcHBseSh0aGlzLCByZXN0KTtcbn07XG5cbi8vIE1ETiBSYW5kb20gTnVtYmVyIEZ1bmN0aW9uc1xuLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9KYXZhU2NyaXB0L1JlZmVyZW5jZS9HbG9iYWxfT2JqZWN0cy9NYXRoL3JhbmRvbVxuZnVuY3Rpb24gZ2V0UmFuZG9tQXJiaXRyYXJ5KG1pbiwgbWF4KSB7XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgKiAobWF4IC0gbWluKSArIG1pbjtcbn1cblxuZnVuY3Rpb24gZ2V0UmFuZG9tSW50KG1pbiwgbWF4KSB7XG4gICAgcmV0dXJuIE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIChtYXggLSBtaW4gKyAxKSkgKyBtaW47XG59XG5cbm1vZHVsZS5leHBvcnRzID0gUG9pc3NvbkRpc2tTYW1wbGVyOyIsIi8vIEEgbGlicmFyeSBvZiBzZWVkYWJsZSBSTkdzIGltcGxlbWVudGVkIGluIEphdmFzY3JpcHQuXG4vL1xuLy8gVXNhZ2U6XG4vL1xuLy8gdmFyIHNlZWRyYW5kb20gPSByZXF1aXJlKCdzZWVkcmFuZG9tJyk7XG4vLyB2YXIgcmFuZG9tID0gc2VlZHJhbmRvbSgxKTsgLy8gb3IgYW55IHNlZWQuXG4vLyB2YXIgeCA9IHJhbmRvbSgpOyAgICAgICAvLyAwIDw9IHggPCAxLiAgRXZlcnkgYml0IGlzIHJhbmRvbS5cbi8vIHZhciB4ID0gcmFuZG9tLnF1aWNrKCk7IC8vIDAgPD0geCA8IDEuICAzMiBiaXRzIG9mIHJhbmRvbW5lc3MuXG5cbi8vIGFsZWEsIGEgNTMtYml0IG11bHRpcGx5LXdpdGgtY2FycnkgZ2VuZXJhdG9yIGJ5IEpvaGFubmVzIEJhYWfDuGUuXG4vLyBQZXJpb2Q6IH4yXjExNlxuLy8gUmVwb3J0ZWQgdG8gcGFzcyBhbGwgQmlnQ3J1c2ggdGVzdHMuXG52YXIgYWxlYSA9IHJlcXVpcmUoJy4vbGliL2FsZWEnKTtcblxuLy8geG9yMTI4LCBhIHB1cmUgeG9yLXNoaWZ0IGdlbmVyYXRvciBieSBHZW9yZ2UgTWFyc2FnbGlhLlxuLy8gUGVyaW9kOiAyXjEyOC0xLlxuLy8gUmVwb3J0ZWQgdG8gZmFpbDogTWF0cml4UmFuayBhbmQgTGluZWFyQ29tcC5cbnZhciB4b3IxMjggPSByZXF1aXJlKCcuL2xpYi94b3IxMjgnKTtcblxuLy8geG9yd293LCBHZW9yZ2UgTWFyc2FnbGlhJ3MgMTYwLWJpdCB4b3Itc2hpZnQgY29tYmluZWQgcGx1cyB3ZXlsLlxuLy8gUGVyaW9kOiAyXjE5Mi0yXjMyXG4vLyBSZXBvcnRlZCB0byBmYWlsOiBDb2xsaXNpb25PdmVyLCBTaW1wUG9rZXIsIGFuZCBMaW5lYXJDb21wLlxudmFyIHhvcndvdyA9IHJlcXVpcmUoJy4vbGliL3hvcndvdycpO1xuXG4vLyB4b3JzaGlmdDcsIGJ5IEZyYW7Dp29pcyBQYW5uZXRvbiBhbmQgUGllcnJlIEwnZWN1eWVyLCB0YWtlc1xuLy8gYSBkaWZmZXJlbnQgYXBwcm9hY2g6IGl0IGFkZHMgcm9idXN0bmVzcyBieSBhbGxvd2luZyBtb3JlIHNoaWZ0c1xuLy8gdGhhbiBNYXJzYWdsaWEncyBvcmlnaW5hbCB0aHJlZS4gIEl0IGlzIGEgNy1zaGlmdCBnZW5lcmF0b3Jcbi8vIHdpdGggMjU2IGJpdHMsIHRoYXQgcGFzc2VzIEJpZ0NydXNoIHdpdGggbm8gc3lzdG1hdGljIGZhaWx1cmVzLlxuLy8gUGVyaW9kIDJeMjU2LTEuXG4vLyBObyBzeXN0ZW1hdGljIEJpZ0NydXNoIGZhaWx1cmVzIHJlcG9ydGVkLlxudmFyIHhvcnNoaWZ0NyA9IHJlcXVpcmUoJy4vbGliL3hvcnNoaWZ0NycpO1xuXG4vLyB4b3I0MDk2LCBieSBSaWNoYXJkIEJyZW50LCBpcyBhIDQwOTYtYml0IHhvci1zaGlmdCB3aXRoIGFcbi8vIHZlcnkgbG9uZyBwZXJpb2QgdGhhdCBhbHNvIGFkZHMgYSBXZXlsIGdlbmVyYXRvci4gSXQgYWxzbyBwYXNzZXNcbi8vIEJpZ0NydXNoIHdpdGggbm8gc3lzdGVtYXRpYyBmYWlsdXJlcy4gIEl0cyBsb25nIHBlcmlvZCBtYXlcbi8vIGJlIHVzZWZ1bCBpZiB5b3UgaGF2ZSBtYW55IGdlbmVyYXRvcnMgYW5kIG5lZWQgdG8gYXZvaWRcbi8vIGNvbGxpc2lvbnMuXG4vLyBQZXJpb2Q6IDJeNDEyOC0yXjMyLlxuLy8gTm8gc3lzdGVtYXRpYyBCaWdDcnVzaCBmYWlsdXJlcyByZXBvcnRlZC5cbnZhciB4b3I0MDk2ID0gcmVxdWlyZSgnLi9saWIveG9yNDA5NicpO1xuXG4vLyBUeWNoZS1pLCBieSBTYW11ZWwgTmV2ZXMgYW5kIEZpbGlwZSBBcmF1am8sIGlzIGEgYml0LXNoaWZ0aW5nIHJhbmRvbVxuLy8gbnVtYmVyIGdlbmVyYXRvciBkZXJpdmVkIGZyb20gQ2hhQ2hhLCBhIG1vZGVybiBzdHJlYW0gY2lwaGVyLlxuLy8gaHR0cHM6Ly9lZGVuLmRlaS51Yy5wdC9+c25ldmVzL3B1YnMvMjAxMS1zbmZhMi5wZGZcbi8vIFBlcmlvZDogfjJeMTI3XG4vLyBObyBzeXN0ZW1hdGljIEJpZ0NydXNoIGZhaWx1cmVzIHJlcG9ydGVkLlxudmFyIHR5Y2hlaSA9IHJlcXVpcmUoJy4vbGliL3R5Y2hlaScpO1xuXG4vLyBUaGUgb3JpZ2luYWwgQVJDNC1iYXNlZCBwcm5nIGluY2x1ZGVkIGluIHRoaXMgbGlicmFyeS5cbi8vIFBlcmlvZDogfjJeMTYwMFxudmFyIHNyID0gcmVxdWlyZSgnLi9zZWVkcmFuZG9tJyk7XG5cbnNyLmFsZWEgPSBhbGVhO1xuc3IueG9yMTI4ID0geG9yMTI4O1xuc3IueG9yd293ID0geG9yd293O1xuc3IueG9yc2hpZnQ3ID0geG9yc2hpZnQ3O1xuc3IueG9yNDA5NiA9IHhvcjQwOTY7XG5zci50eWNoZWkgPSB0eWNoZWk7XG5cbm1vZHVsZS5leHBvcnRzID0gc3I7XG4iLCIvLyBBIHBvcnQgb2YgYW4gYWxnb3JpdGhtIGJ5IEpvaGFubmVzIEJhYWfDuGUgPGJhYWdvZUBiYWFnb2UuY29tPiwgMjAxMFxuLy8gaHR0cDovL2JhYWdvZS5jb20vZW4vUmFuZG9tTXVzaW5ncy9qYXZhc2NyaXB0L1xuLy8gaHR0cHM6Ly9naXRodWIuY29tL25xdWlubGFuL2JldHRlci1yYW5kb20tbnVtYmVycy1mb3ItamF2YXNjcmlwdC1taXJyb3Jcbi8vIE9yaWdpbmFsIHdvcmsgaXMgdW5kZXIgTUlUIGxpY2Vuc2UgLVxuXG4vLyBDb3B5cmlnaHQgKEMpIDIwMTAgYnkgSm9oYW5uZXMgQmFhZ8O4ZSA8YmFhZ29lQGJhYWdvZS5vcmc+XG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxuLy8gb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuLy8gaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xuLy8gdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuLy8gY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4vLyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy8gXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuLy8gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vLyBcbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1Jcbi8vIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuLy8gRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG4vLyBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG4vLyBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuLy8gT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuLy8gVEhFIFNPRlRXQVJFLlxuXG5cblxuKGZ1bmN0aW9uKGdsb2JhbCwgbW9kdWxlLCBkZWZpbmUpIHtcblxuZnVuY3Rpb24gQWxlYShzZWVkKSB7XG4gIHZhciBtZSA9IHRoaXMsIG1hc2ggPSBNYXNoKCk7XG5cbiAgbWUubmV4dCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB0ID0gMjA5MTYzOSAqIG1lLnMwICsgbWUuYyAqIDIuMzI4MzA2NDM2NTM4Njk2M2UtMTA7IC8vIDJeLTMyXG4gICAgbWUuczAgPSBtZS5zMTtcbiAgICBtZS5zMSA9IG1lLnMyO1xuICAgIHJldHVybiBtZS5zMiA9IHQgLSAobWUuYyA9IHQgfCAwKTtcbiAgfTtcblxuICAvLyBBcHBseSB0aGUgc2VlZGluZyBhbGdvcml0aG0gZnJvbSBCYWFnb2UuXG4gIG1lLmMgPSAxO1xuICBtZS5zMCA9IG1hc2goJyAnKTtcbiAgbWUuczEgPSBtYXNoKCcgJyk7XG4gIG1lLnMyID0gbWFzaCgnICcpO1xuICBtZS5zMCAtPSBtYXNoKHNlZWQpO1xuICBpZiAobWUuczAgPCAwKSB7IG1lLnMwICs9IDE7IH1cbiAgbWUuczEgLT0gbWFzaChzZWVkKTtcbiAgaWYgKG1lLnMxIDwgMCkgeyBtZS5zMSArPSAxOyB9XG4gIG1lLnMyIC09IG1hc2goc2VlZCk7XG4gIGlmIChtZS5zMiA8IDApIHsgbWUuczIgKz0gMTsgfVxuICBtYXNoID0gbnVsbDtcbn1cblxuZnVuY3Rpb24gY29weShmLCB0KSB7XG4gIHQuYyA9IGYuYztcbiAgdC5zMCA9IGYuczA7XG4gIHQuczEgPSBmLnMxO1xuICB0LnMyID0gZi5zMjtcbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGltcGwoc2VlZCwgb3B0cykge1xuICB2YXIgeGcgPSBuZXcgQWxlYShzZWVkKSxcbiAgICAgIHN0YXRlID0gb3B0cyAmJiBvcHRzLnN0YXRlLFxuICAgICAgcHJuZyA9IHhnLm5leHQ7XG4gIHBybmcuaW50MzIgPSBmdW5jdGlvbigpIHsgcmV0dXJuICh4Zy5uZXh0KCkgKiAweDEwMDAwMDAwMCkgfCAwOyB9XG4gIHBybmcuZG91YmxlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHBybmcoKSArIChwcm5nKCkgKiAweDIwMDAwMCB8IDApICogMS4xMTAyMjMwMjQ2MjUxNTY1ZS0xNjsgLy8gMl4tNTNcbiAgfTtcbiAgcHJuZy5xdWljayA9IHBybmc7XG4gIGlmIChzdGF0ZSkge1xuICAgIGlmICh0eXBlb2Yoc3RhdGUpID09ICdvYmplY3QnKSBjb3B5KHN0YXRlLCB4Zyk7XG4gICAgcHJuZy5zdGF0ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gY29weSh4Zywge30pOyB9XG4gIH1cbiAgcmV0dXJuIHBybmc7XG59XG5cbmZ1bmN0aW9uIE1hc2goKSB7XG4gIHZhciBuID0gMHhlZmM4MjQ5ZDtcblxuICB2YXIgbWFzaCA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICBkYXRhID0gZGF0YS50b1N0cmluZygpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZGF0YS5sZW5ndGg7IGkrKykge1xuICAgICAgbiArPSBkYXRhLmNoYXJDb2RlQXQoaSk7XG4gICAgICB2YXIgaCA9IDAuMDI1MTk2MDMyODI0MTY5MzggKiBuO1xuICAgICAgbiA9IGggPj4+IDA7XG4gICAgICBoIC09IG47XG4gICAgICBoICo9IG47XG4gICAgICBuID0gaCA+Pj4gMDtcbiAgICAgIGggLT0gbjtcbiAgICAgIG4gKz0gaCAqIDB4MTAwMDAwMDAwOyAvLyAyXjMyXG4gICAgfVxuICAgIHJldHVybiAobiA+Pj4gMCkgKiAyLjMyODMwNjQzNjUzODY5NjNlLTEwOyAvLyAyXi0zMlxuICB9O1xuXG4gIHJldHVybiBtYXNoO1xufVxuXG5cbmlmIChtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBpbXBsO1xufSBlbHNlIGlmIChkZWZpbmUgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBpbXBsOyB9KTtcbn0gZWxzZSB7XG4gIHRoaXMuYWxlYSA9IGltcGw7XG59XG5cbn0pKFxuICB0aGlzLFxuICAodHlwZW9mIG1vZHVsZSkgPT0gJ29iamVjdCcgJiYgbW9kdWxlLCAgICAvLyBwcmVzZW50IGluIG5vZGUuanNcbiAgKHR5cGVvZiBkZWZpbmUpID09ICdmdW5jdGlvbicgJiYgZGVmaW5lICAgLy8gcHJlc2VudCB3aXRoIGFuIEFNRCBsb2FkZXJcbik7XG5cblxuIiwiLy8gQSBKYXZhc2NyaXB0IGltcGxlbWVudGFpb24gb2YgdGhlIFwiVHljaGUtaVwiIHBybmcgYWxnb3JpdGhtIGJ5XG4vLyBTYW11ZWwgTmV2ZXMgYW5kIEZpbGlwZSBBcmF1am8uXG4vLyBTZWUgaHR0cHM6Ly9lZGVuLmRlaS51Yy5wdC9+c25ldmVzL3B1YnMvMjAxMS1zbmZhMi5wZGZcblxuKGZ1bmN0aW9uKGdsb2JhbCwgbW9kdWxlLCBkZWZpbmUpIHtcblxuZnVuY3Rpb24gWG9yR2VuKHNlZWQpIHtcbiAgdmFyIG1lID0gdGhpcywgc3Ryc2VlZCA9ICcnO1xuXG4gIC8vIFNldCB1cCBnZW5lcmF0b3IgZnVuY3Rpb24uXG4gIG1lLm5leHQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYiA9IG1lLmIsIGMgPSBtZS5jLCBkID0gbWUuZCwgYSA9IG1lLmE7XG4gICAgYiA9IChiIDw8IDI1KSBeIChiID4+PiA3KSBeIGM7XG4gICAgYyA9IChjIC0gZCkgfCAwO1xuICAgIGQgPSAoZCA8PCAyNCkgXiAoZCA+Pj4gOCkgXiBhO1xuICAgIGEgPSAoYSAtIGIpIHwgMDtcbiAgICBtZS5iID0gYiA9IChiIDw8IDIwKSBeIChiID4+PiAxMikgXiBjO1xuICAgIG1lLmMgPSBjID0gKGMgLSBkKSB8IDA7XG4gICAgbWUuZCA9IChkIDw8IDE2KSBeIChjID4+PiAxNikgXiBhO1xuICAgIHJldHVybiBtZS5hID0gKGEgLSBiKSB8IDA7XG4gIH07XG5cbiAgLyogVGhlIGZvbGxvd2luZyBpcyBub24taW52ZXJ0ZWQgdHljaGUsIHdoaWNoIGhhcyBiZXR0ZXIgaW50ZXJuYWxcbiAgICogYml0IGRpZmZ1c2lvbiwgYnV0IHdoaWNoIGlzIGFib3V0IDI1JSBzbG93ZXIgdGhhbiB0eWNoZS1pIGluIEpTLlxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGEgPSBtZS5hLCBiID0gbWUuYiwgYyA9IG1lLmMsIGQgPSBtZS5kO1xuICAgIGEgPSAobWUuYSArIG1lLmIgfCAwKSA+Pj4gMDtcbiAgICBkID0gbWUuZCBeIGE7IGQgPSBkIDw8IDE2IF4gZCA+Pj4gMTY7XG4gICAgYyA9IG1lLmMgKyBkIHwgMDtcbiAgICBiID0gbWUuYiBeIGM7IGIgPSBiIDw8IDEyIF4gZCA+Pj4gMjA7XG4gICAgbWUuYSA9IGEgPSBhICsgYiB8IDA7XG4gICAgZCA9IGQgXiBhOyBtZS5kID0gZCA9IGQgPDwgOCBeIGQgPj4+IDI0O1xuICAgIG1lLmMgPSBjID0gYyArIGQgfCAwO1xuICAgIGIgPSBiIF4gYztcbiAgICByZXR1cm4gbWUuYiA9IChiIDw8IDcgXiBiID4+PiAyNSk7XG4gIH1cbiAgKi9cblxuICBtZS5hID0gMDtcbiAgbWUuYiA9IDA7XG4gIG1lLmMgPSAyNjU0NDM1NzY5IHwgMDtcbiAgbWUuZCA9IDEzNjcxMzA1NTE7XG5cbiAgaWYgKHNlZWQgPT09IE1hdGguZmxvb3Ioc2VlZCkpIHtcbiAgICAvLyBJbnRlZ2VyIHNlZWQuXG4gICAgbWUuYSA9IChzZWVkIC8gMHgxMDAwMDAwMDApIHwgMDtcbiAgICBtZS5iID0gc2VlZCB8IDA7XG4gIH0gZWxzZSB7XG4gICAgLy8gU3RyaW5nIHNlZWQuXG4gICAgc3Ryc2VlZCArPSBzZWVkO1xuICB9XG5cbiAgLy8gTWl4IGluIHN0cmluZyBzZWVkLCB0aGVuIGRpc2NhcmQgYW4gaW5pdGlhbCBiYXRjaCBvZiA2NCB2YWx1ZXMuXG4gIGZvciAodmFyIGsgPSAwOyBrIDwgc3Ryc2VlZC5sZW5ndGggKyAyMDsgaysrKSB7XG4gICAgbWUuYiBePSBzdHJzZWVkLmNoYXJDb2RlQXQoaykgfCAwO1xuICAgIG1lLm5leHQoKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC5hID0gZi5hO1xuICB0LmIgPSBmLmI7XG4gIHQuYyA9IGYuYztcbiAgdC5kID0gZi5kO1xuICByZXR1cm4gdDtcbn07XG5cbmZ1bmN0aW9uIGltcGwoc2VlZCwgb3B0cykge1xuICB2YXIgeGcgPSBuZXcgWG9yR2VuKHNlZWQpLFxuICAgICAgc3RhdGUgPSBvcHRzICYmIG9wdHMuc3RhdGUsXG4gICAgICBwcm5nID0gZnVuY3Rpb24oKSB7IHJldHVybiAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwOyB9O1xuICBwcm5nLmRvdWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIGRvIHtcbiAgICAgIHZhciB0b3AgPSB4Zy5uZXh0KCkgPj4+IDExLFxuICAgICAgICAgIGJvdCA9ICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDAsXG4gICAgICAgICAgcmVzdWx0ID0gKHRvcCArIGJvdCkgLyAoMSA8PCAyMSk7XG4gICAgfSB3aGlsZSAocmVzdWx0ID09PSAwKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuICBwcm5nLmludDMyID0geGcubmV4dDtcbiAgcHJuZy5xdWljayA9IHBybmc7XG4gIGlmIChzdGF0ZSkge1xuICAgIGlmICh0eXBlb2Yoc3RhdGUpID09ICdvYmplY3QnKSBjb3B5KHN0YXRlLCB4Zyk7XG4gICAgcHJuZy5zdGF0ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gY29weSh4Zywge30pOyB9XG4gIH1cbiAgcmV0dXJuIHBybmc7XG59XG5cbmlmIChtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBpbXBsO1xufSBlbHNlIGlmIChkZWZpbmUgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBpbXBsOyB9KTtcbn0gZWxzZSB7XG4gIHRoaXMudHljaGVpID0gaW1wbDtcbn1cblxufSkoXG4gIHRoaXMsXG4gICh0eXBlb2YgbW9kdWxlKSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUsICAgIC8vIHByZXNlbnQgaW4gbm9kZS5qc1xuICAodHlwZW9mIGRlZmluZSkgPT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUgICAvLyBwcmVzZW50IHdpdGggYW4gQU1EIGxvYWRlclxuKTtcblxuXG4iLCIvLyBBIEphdmFzY3JpcHQgaW1wbGVtZW50YWlvbiBvZiB0aGUgXCJ4b3IxMjhcIiBwcm5nIGFsZ29yaXRobSBieVxuLy8gR2VvcmdlIE1hcnNhZ2xpYS4gIFNlZSBodHRwOi8vd3d3LmpzdGF0c29mdC5vcmcvdjA4L2kxNC9wYXBlclxuXG4oZnVuY3Rpb24oZ2xvYmFsLCBtb2R1bGUsIGRlZmluZSkge1xuXG5mdW5jdGlvbiBYb3JHZW4oc2VlZCkge1xuICB2YXIgbWUgPSB0aGlzLCBzdHJzZWVkID0gJyc7XG5cbiAgbWUueCA9IDA7XG4gIG1lLnkgPSAwO1xuICBtZS56ID0gMDtcbiAgbWUudyA9IDA7XG5cbiAgLy8gU2V0IHVwIGdlbmVyYXRvciBmdW5jdGlvbi5cbiAgbWUubmV4dCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB0ID0gbWUueCBeIChtZS54IDw8IDExKTtcbiAgICBtZS54ID0gbWUueTtcbiAgICBtZS55ID0gbWUuejtcbiAgICBtZS56ID0gbWUudztcbiAgICByZXR1cm4gbWUudyBePSAobWUudyA+Pj4gMTkpIF4gdCBeICh0ID4+PiA4KTtcbiAgfTtcblxuICBpZiAoc2VlZCA9PT0gKHNlZWQgfCAwKSkge1xuICAgIC8vIEludGVnZXIgc2VlZC5cbiAgICBtZS54ID0gc2VlZDtcbiAgfSBlbHNlIHtcbiAgICAvLyBTdHJpbmcgc2VlZC5cbiAgICBzdHJzZWVkICs9IHNlZWQ7XG4gIH1cblxuICAvLyBNaXggaW4gc3RyaW5nIHNlZWQsIHRoZW4gZGlzY2FyZCBhbiBpbml0aWFsIGJhdGNoIG9mIDY0IHZhbHVlcy5cbiAgZm9yICh2YXIgayA9IDA7IGsgPCBzdHJzZWVkLmxlbmd0aCArIDY0OyBrKyspIHtcbiAgICBtZS54IF49IHN0cnNlZWQuY2hhckNvZGVBdChrKSB8IDA7XG4gICAgbWUubmV4dCgpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvcHkoZiwgdCkge1xuICB0LnggPSBmLng7XG4gIHQueSA9IGYueTtcbiAgdC56ID0gZi56O1xuICB0LncgPSBmLnc7XG4gIHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBpbXBsKHNlZWQsIG9wdHMpIHtcbiAgdmFyIHhnID0gbmV3IFhvckdlbihzZWVkKSxcbiAgICAgIHN0YXRlID0gb3B0cyAmJiBvcHRzLnN0YXRlLFxuICAgICAgcHJuZyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMDsgfTtcbiAgcHJuZy5kb3VibGUgPSBmdW5jdGlvbigpIHtcbiAgICBkbyB7XG4gICAgICB2YXIgdG9wID0geGcubmV4dCgpID4+PiAxMSxcbiAgICAgICAgICBib3QgPSAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwLFxuICAgICAgICAgIHJlc3VsdCA9ICh0b3AgKyBib3QpIC8gKDEgPDwgMjEpO1xuICAgIH0gd2hpbGUgKHJlc3VsdCA9PT0gMCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcbiAgcHJuZy5pbnQzMiA9IHhnLm5leHQ7XG4gIHBybmcucXVpY2sgPSBwcm5nO1xuICBpZiAoc3RhdGUpIHtcbiAgICBpZiAodHlwZW9mKHN0YXRlKSA9PSAnb2JqZWN0JykgY29weShzdGF0ZSwgeGcpO1xuICAgIHBybmcuc3RhdGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGNvcHkoeGcsIHt9KTsgfVxuICB9XG4gIHJldHVybiBwcm5nO1xufVxuXG5pZiAobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gaW1wbDtcbn0gZWxzZSBpZiAoZGVmaW5lICYmIGRlZmluZS5hbWQpIHtcbiAgZGVmaW5lKGZ1bmN0aW9uKCkgeyByZXR1cm4gaW1wbDsgfSk7XG59IGVsc2Uge1xuICB0aGlzLnhvcjEyOCA9IGltcGw7XG59XG5cbn0pKFxuICB0aGlzLFxuICAodHlwZW9mIG1vZHVsZSkgPT0gJ29iamVjdCcgJiYgbW9kdWxlLCAgICAvLyBwcmVzZW50IGluIG5vZGUuanNcbiAgKHR5cGVvZiBkZWZpbmUpID09ICdmdW5jdGlvbicgJiYgZGVmaW5lICAgLy8gcHJlc2VudCB3aXRoIGFuIEFNRCBsb2FkZXJcbik7XG5cblxuIiwiLy8gQSBKYXZhc2NyaXB0IGltcGxlbWVudGFpb24gb2YgUmljaGFyZCBCcmVudCdzIFhvcmdlbnMgeG9yNDA5NiBhbGdvcml0aG0uXG4vL1xuLy8gVGhpcyBmYXN0IG5vbi1jcnlwdG9ncmFwaGljIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9yIGlzIGRlc2lnbmVkIGZvclxuLy8gdXNlIGluIE1vbnRlLUNhcmxvIGFsZ29yaXRobXMuIEl0IGNvbWJpbmVzIGEgbG9uZy1wZXJpb2QgeG9yc2hpZnRcbi8vIGdlbmVyYXRvciB3aXRoIGEgV2V5bCBnZW5lcmF0b3IsIGFuZCBpdCBwYXNzZXMgYWxsIGNvbW1vbiBiYXR0ZXJpZXNcbi8vIG9mIHN0YXN0aWNpYWwgdGVzdHMgZm9yIHJhbmRvbW5lc3Mgd2hpbGUgY29uc3VtaW5nIG9ubHkgYSBmZXcgbmFub3NlY29uZHNcbi8vIGZvciBlYWNoIHBybmcgZ2VuZXJhdGVkLiAgRm9yIGJhY2tncm91bmQgb24gdGhlIGdlbmVyYXRvciwgc2VlIEJyZW50J3Ncbi8vIHBhcGVyOiBcIlNvbWUgbG9uZy1wZXJpb2QgcmFuZG9tIG51bWJlciBnZW5lcmF0b3JzIHVzaW5nIHNoaWZ0cyBhbmQgeG9ycy5cIlxuLy8gaHR0cDovL2FyeGl2Lm9yZy9wZGYvMTAwNC4zMTE1djEucGRmXG4vL1xuLy8gVXNhZ2U6XG4vL1xuLy8gdmFyIHhvcjQwOTYgPSByZXF1aXJlKCd4b3I0MDk2Jyk7XG4vLyByYW5kb20gPSB4b3I0MDk2KDEpOyAgICAgICAgICAgICAgICAgICAgICAgIC8vIFNlZWQgd2l0aCBpbnQzMiBvciBzdHJpbmcuXG4vLyBhc3NlcnQuZXF1YWwocmFuZG9tKCksIDAuMTUyMDQzNjQ1MDUzODU0Nyk7IC8vICgwLCAxKSByYW5nZSwgNTMgYml0cy5cbi8vIGFzc2VydC5lcXVhbChyYW5kb20uaW50MzIoKSwgMTgwNjUzNDg5Nyk7ICAgLy8gc2lnbmVkIGludDMyLCAzMiBiaXRzLlxuLy9cbi8vIEZvciBub256ZXJvIG51bWVyaWMga2V5cywgdGhpcyBpbXBlbGVtZW50YXRpb24gcHJvdmlkZXMgYSBzZXF1ZW5jZVxuLy8gaWRlbnRpY2FsIHRvIHRoYXQgYnkgQnJlbnQncyB4b3JnZW5zIDMgaW1wbGVtZW50YWlvbiBpbiBDLiAgVGhpc1xuLy8gaW1wbGVtZW50YXRpb24gYWxzbyBwcm92aWRlcyBmb3IgaW5pdGFsaXppbmcgdGhlIGdlbmVyYXRvciB3aXRoXG4vLyBzdHJpbmcgc2VlZHMsIG9yIGZvciBzYXZpbmcgYW5kIHJlc3RvcmluZyB0aGUgc3RhdGUgb2YgdGhlIGdlbmVyYXRvci5cbi8vXG4vLyBPbiBDaHJvbWUsIHRoaXMgcHJuZyBiZW5jaG1hcmtzIGFib3V0IDIuMSB0aW1lcyBzbG93ZXIgdGhhblxuLy8gSmF2YXNjcmlwdCdzIGJ1aWx0LWluIE1hdGgucmFuZG9tKCkuXG5cbihmdW5jdGlvbihnbG9iYWwsIG1vZHVsZSwgZGVmaW5lKSB7XG5cbmZ1bmN0aW9uIFhvckdlbihzZWVkKSB7XG4gIHZhciBtZSA9IHRoaXM7XG5cbiAgLy8gU2V0IHVwIGdlbmVyYXRvciBmdW5jdGlvbi5cbiAgbWUubmV4dCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB3ID0gbWUudyxcbiAgICAgICAgWCA9IG1lLlgsIGkgPSBtZS5pLCB0LCB2O1xuICAgIC8vIFVwZGF0ZSBXZXlsIGdlbmVyYXRvci5cbiAgICBtZS53ID0gdyA9ICh3ICsgMHg2MWM4ODY0NykgfCAwO1xuICAgIC8vIFVwZGF0ZSB4b3IgZ2VuZXJhdG9yLlxuICAgIHYgPSBYWyhpICsgMzQpICYgMTI3XTtcbiAgICB0ID0gWFtpID0gKChpICsgMSkgJiAxMjcpXTtcbiAgICB2IF49IHYgPDwgMTM7XG4gICAgdCBePSB0IDw8IDE3O1xuICAgIHYgXj0gdiA+Pj4gMTU7XG4gICAgdCBePSB0ID4+PiAxMjtcbiAgICAvLyBVcGRhdGUgWG9yIGdlbmVyYXRvciBhcnJheSBzdGF0ZS5cbiAgICB2ID0gWFtpXSA9IHYgXiB0O1xuICAgIG1lLmkgPSBpO1xuICAgIC8vIFJlc3VsdCBpcyB0aGUgY29tYmluYXRpb24uXG4gICAgcmV0dXJuICh2ICsgKHcgXiAodyA+Pj4gMTYpKSkgfCAwO1xuICB9O1xuXG4gIGZ1bmN0aW9uIGluaXQobWUsIHNlZWQpIHtcbiAgICB2YXIgdCwgdiwgaSwgaiwgdywgWCA9IFtdLCBsaW1pdCA9IDEyODtcbiAgICBpZiAoc2VlZCA9PT0gKHNlZWQgfCAwKSkge1xuICAgICAgLy8gTnVtZXJpYyBzZWVkcyBpbml0aWFsaXplIHYsIHdoaWNoIGlzIHVzZWQgdG8gZ2VuZXJhdGVzIFguXG4gICAgICB2ID0gc2VlZDtcbiAgICAgIHNlZWQgPSBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTdHJpbmcgc2VlZHMgYXJlIG1peGVkIGludG8gdiBhbmQgWCBvbmUgY2hhcmFjdGVyIGF0IGEgdGltZS5cbiAgICAgIHNlZWQgPSBzZWVkICsgJ1xcMCc7XG4gICAgICB2ID0gMDtcbiAgICAgIGxpbWl0ID0gTWF0aC5tYXgobGltaXQsIHNlZWQubGVuZ3RoKTtcbiAgICB9XG4gICAgLy8gSW5pdGlhbGl6ZSBjaXJjdWxhciBhcnJheSBhbmQgd2V5bCB2YWx1ZS5cbiAgICBmb3IgKGkgPSAwLCBqID0gLTMyOyBqIDwgbGltaXQ7ICsraikge1xuICAgICAgLy8gUHV0IHRoZSB1bmljb2RlIGNoYXJhY3RlcnMgaW50byB0aGUgYXJyYXksIGFuZCBzaHVmZmxlIHRoZW0uXG4gICAgICBpZiAoc2VlZCkgdiBePSBzZWVkLmNoYXJDb2RlQXQoKGogKyAzMikgJSBzZWVkLmxlbmd0aCk7XG4gICAgICAvLyBBZnRlciAzMiBzaHVmZmxlcywgdGFrZSB2IGFzIHRoZSBzdGFydGluZyB3IHZhbHVlLlxuICAgICAgaWYgKGogPT09IDApIHcgPSB2O1xuICAgICAgdiBePSB2IDw8IDEwO1xuICAgICAgdiBePSB2ID4+PiAxNTtcbiAgICAgIHYgXj0gdiA8PCA0O1xuICAgICAgdiBePSB2ID4+PiAxMztcbiAgICAgIGlmIChqID49IDApIHtcbiAgICAgICAgdyA9ICh3ICsgMHg2MWM4ODY0NykgfCAwOyAgICAgLy8gV2V5bC5cbiAgICAgICAgdCA9IChYW2ogJiAxMjddIF49ICh2ICsgdykpOyAgLy8gQ29tYmluZSB4b3IgYW5kIHdleWwgdG8gaW5pdCBhcnJheS5cbiAgICAgICAgaSA9ICgwID09IHQpID8gaSArIDEgOiAwOyAgICAgLy8gQ291bnQgemVyb2VzLlxuICAgICAgfVxuICAgIH1cbiAgICAvLyBXZSBoYXZlIGRldGVjdGVkIGFsbCB6ZXJvZXM7IG1ha2UgdGhlIGtleSBub256ZXJvLlxuICAgIGlmIChpID49IDEyOCkge1xuICAgICAgWFsoc2VlZCAmJiBzZWVkLmxlbmd0aCB8fCAwKSAmIDEyN10gPSAtMTtcbiAgICB9XG4gICAgLy8gUnVuIHRoZSBnZW5lcmF0b3IgNTEyIHRpbWVzIHRvIGZ1cnRoZXIgbWl4IHRoZSBzdGF0ZSBiZWZvcmUgdXNpbmcgaXQuXG4gICAgLy8gRmFjdG9yaW5nIHRoaXMgYXMgYSBmdW5jdGlvbiBzbG93cyB0aGUgbWFpbiBnZW5lcmF0b3IsIHNvIGl0IGlzIGp1c3RcbiAgICAvLyB1bnJvbGxlZCBoZXJlLiAgVGhlIHdleWwgZ2VuZXJhdG9yIGlzIG5vdCBhZHZhbmNlZCB3aGlsZSB3YXJtaW5nIHVwLlxuICAgIGkgPSAxMjc7XG4gICAgZm9yIChqID0gNCAqIDEyODsgaiA+IDA7IC0taikge1xuICAgICAgdiA9IFhbKGkgKyAzNCkgJiAxMjddO1xuICAgICAgdCA9IFhbaSA9ICgoaSArIDEpICYgMTI3KV07XG4gICAgICB2IF49IHYgPDwgMTM7XG4gICAgICB0IF49IHQgPDwgMTc7XG4gICAgICB2IF49IHYgPj4+IDE1O1xuICAgICAgdCBePSB0ID4+PiAxMjtcbiAgICAgIFhbaV0gPSB2IF4gdDtcbiAgICB9XG4gICAgLy8gU3RvcmluZyBzdGF0ZSBhcyBvYmplY3QgbWVtYmVycyBpcyBmYXN0ZXIgdGhhbiB1c2luZyBjbG9zdXJlIHZhcmlhYmxlcy5cbiAgICBtZS53ID0gdztcbiAgICBtZS5YID0gWDtcbiAgICBtZS5pID0gaTtcbiAgfVxuXG4gIGluaXQobWUsIHNlZWQpO1xufVxuXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC5pID0gZi5pO1xuICB0LncgPSBmLnc7XG4gIHQuWCA9IGYuWC5zbGljZSgpO1xuICByZXR1cm4gdDtcbn07XG5cbmZ1bmN0aW9uIGltcGwoc2VlZCwgb3B0cykge1xuICBpZiAoc2VlZCA9PSBudWxsKSBzZWVkID0gKyhuZXcgRGF0ZSk7XG4gIHZhciB4ZyA9IG5ldyBYb3JHZW4oc2VlZCksXG4gICAgICBzdGF0ZSA9IG9wdHMgJiYgb3B0cy5zdGF0ZSxcbiAgICAgIHBybmcgPSBmdW5jdGlvbigpIHsgcmV0dXJuICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDA7IH07XG4gIHBybmcuZG91YmxlID0gZnVuY3Rpb24oKSB7XG4gICAgZG8ge1xuICAgICAgdmFyIHRvcCA9IHhnLm5leHQoKSA+Pj4gMTEsXG4gICAgICAgICAgYm90ID0gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMCxcbiAgICAgICAgICByZXN1bHQgPSAodG9wICsgYm90KSAvICgxIDw8IDIxKTtcbiAgICB9IHdoaWxlIChyZXN1bHQgPT09IDApO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG4gIHBybmcuaW50MzIgPSB4Zy5uZXh0O1xuICBwcm5nLnF1aWNrID0gcHJuZztcbiAgaWYgKHN0YXRlKSB7XG4gICAgaWYgKHN0YXRlLlgpIGNvcHkoc3RhdGUsIHhnKTtcbiAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KHhnLCB7fSk7IH1cbiAgfVxuICByZXR1cm4gcHJuZztcbn1cblxuaWYgKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IGltcGw7XG59IGVsc2UgaWYgKGRlZmluZSAmJiBkZWZpbmUuYW1kKSB7XG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIGltcGw7IH0pO1xufSBlbHNlIHtcbiAgdGhpcy54b3I0MDk2ID0gaW1wbDtcbn1cblxufSkoXG4gIHRoaXMsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdpbmRvdyBvYmplY3Qgb3IgZ2xvYmFsXG4gICh0eXBlb2YgbW9kdWxlKSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUsICAgIC8vIHByZXNlbnQgaW4gbm9kZS5qc1xuICAodHlwZW9mIGRlZmluZSkgPT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUgICAvLyBwcmVzZW50IHdpdGggYW4gQU1EIGxvYWRlclxuKTtcbiIsIi8vIEEgSmF2YXNjcmlwdCBpbXBsZW1lbnRhaW9uIG9mIHRoZSBcInhvcnNoaWZ0N1wiIGFsZ29yaXRobSBieVxuLy8gRnJhbsOnb2lzIFBhbm5ldG9uIGFuZCBQaWVycmUgTCdlY3V5ZXI6XG4vLyBcIk9uIHRoZSBYb3Jnc2hpZnQgUmFuZG9tIE51bWJlciBHZW5lcmF0b3JzXCJcbi8vIGh0dHA6Ly9zYWx1Yy5lbmdyLnVjb25uLmVkdS9yZWZzL2NyeXB0by9ybmcvcGFubmV0b24wNW9udGhleG9yc2hpZnQucGRmXG5cbihmdW5jdGlvbihnbG9iYWwsIG1vZHVsZSwgZGVmaW5lKSB7XG5cbmZ1bmN0aW9uIFhvckdlbihzZWVkKSB7XG4gIHZhciBtZSA9IHRoaXM7XG5cbiAgLy8gU2V0IHVwIGdlbmVyYXRvciBmdW5jdGlvbi5cbiAgbWUubmV4dCA9IGZ1bmN0aW9uKCkge1xuICAgIC8vIFVwZGF0ZSB4b3IgZ2VuZXJhdG9yLlxuICAgIHZhciBYID0gbWUueCwgaSA9IG1lLmksIHQsIHYsIHc7XG4gICAgdCA9IFhbaV07IHQgXj0gKHQgPj4+IDcpOyB2ID0gdCBeICh0IDw8IDI0KTtcbiAgICB0ID0gWFsoaSArIDEpICYgN107IHYgXj0gdCBeICh0ID4+PiAxMCk7XG4gICAgdCA9IFhbKGkgKyAzKSAmIDddOyB2IF49IHQgXiAodCA+Pj4gMyk7XG4gICAgdCA9IFhbKGkgKyA0KSAmIDddOyB2IF49IHQgXiAodCA8PCA3KTtcbiAgICB0ID0gWFsoaSArIDcpICYgN107IHQgPSB0IF4gKHQgPDwgMTMpOyB2IF49IHQgXiAodCA8PCA5KTtcbiAgICBYW2ldID0gdjtcbiAgICBtZS5pID0gKGkgKyAxKSAmIDc7XG4gICAgcmV0dXJuIHY7XG4gIH07XG5cbiAgZnVuY3Rpb24gaW5pdChtZSwgc2VlZCkge1xuICAgIHZhciBqLCB3LCBYID0gW107XG5cbiAgICBpZiAoc2VlZCA9PT0gKHNlZWQgfCAwKSkge1xuICAgICAgLy8gU2VlZCBzdGF0ZSBhcnJheSB1c2luZyBhIDMyLWJpdCBpbnRlZ2VyLlxuICAgICAgdyA9IFhbMF0gPSBzZWVkO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTZWVkIHN0YXRlIHVzaW5nIGEgc3RyaW5nLlxuICAgICAgc2VlZCA9ICcnICsgc2VlZDtcbiAgICAgIGZvciAoaiA9IDA7IGogPCBzZWVkLmxlbmd0aDsgKytqKSB7XG4gICAgICAgIFhbaiAmIDddID0gKFhbaiAmIDddIDw8IDE1KSBeXG4gICAgICAgICAgICAoc2VlZC5jaGFyQ29kZUF0KGopICsgWFsoaiArIDEpICYgN10gPDwgMTMpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBFbmZvcmNlIGFuIGFycmF5IGxlbmd0aCBvZiA4LCBub3QgYWxsIHplcm9lcy5cbiAgICB3aGlsZSAoWC5sZW5ndGggPCA4KSBYLnB1c2goMCk7XG4gICAgZm9yIChqID0gMDsgaiA8IDggJiYgWFtqXSA9PT0gMDsgKytqKTtcbiAgICBpZiAoaiA9PSA4KSB3ID0gWFs3XSA9IC0xOyBlbHNlIHcgPSBYW2pdO1xuXG4gICAgbWUueCA9IFg7XG4gICAgbWUuaSA9IDA7XG5cbiAgICAvLyBEaXNjYXJkIGFuIGluaXRpYWwgMjU2IHZhbHVlcy5cbiAgICBmb3IgKGogPSAyNTY7IGogPiAwOyAtLWopIHtcbiAgICAgIG1lLm5leHQoKTtcbiAgICB9XG4gIH1cblxuICBpbml0KG1lLCBzZWVkKTtcbn1cblxuZnVuY3Rpb24gY29weShmLCB0KSB7XG4gIHQueCA9IGYueC5zbGljZSgpO1xuICB0LmkgPSBmLmk7XG4gIHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBpbXBsKHNlZWQsIG9wdHMpIHtcbiAgaWYgKHNlZWQgPT0gbnVsbCkgc2VlZCA9ICsobmV3IERhdGUpO1xuICB2YXIgeGcgPSBuZXcgWG9yR2VuKHNlZWQpLFxuICAgICAgc3RhdGUgPSBvcHRzICYmIG9wdHMuc3RhdGUsXG4gICAgICBwcm5nID0gZnVuY3Rpb24oKSB7IHJldHVybiAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwOyB9O1xuICBwcm5nLmRvdWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIGRvIHtcbiAgICAgIHZhciB0b3AgPSB4Zy5uZXh0KCkgPj4+IDExLFxuICAgICAgICAgIGJvdCA9ICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDAsXG4gICAgICAgICAgcmVzdWx0ID0gKHRvcCArIGJvdCkgLyAoMSA8PCAyMSk7XG4gICAgfSB3aGlsZSAocmVzdWx0ID09PSAwKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuICBwcm5nLmludDMyID0geGcubmV4dDtcbiAgcHJuZy5xdWljayA9IHBybmc7XG4gIGlmIChzdGF0ZSkge1xuICAgIGlmIChzdGF0ZS54KSBjb3B5KHN0YXRlLCB4Zyk7XG4gICAgcHJuZy5zdGF0ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gY29weSh4Zywge30pOyB9XG4gIH1cbiAgcmV0dXJuIHBybmc7XG59XG5cbmlmIChtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBpbXBsO1xufSBlbHNlIGlmIChkZWZpbmUgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBpbXBsOyB9KTtcbn0gZWxzZSB7XG4gIHRoaXMueG9yc2hpZnQ3ID0gaW1wbDtcbn1cblxufSkoXG4gIHRoaXMsXG4gICh0eXBlb2YgbW9kdWxlKSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUsICAgIC8vIHByZXNlbnQgaW4gbm9kZS5qc1xuICAodHlwZW9mIGRlZmluZSkgPT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUgICAvLyBwcmVzZW50IHdpdGggYW4gQU1EIGxvYWRlclxuKTtcblxuIiwiLy8gQSBKYXZhc2NyaXB0IGltcGxlbWVudGFpb24gb2YgdGhlIFwieG9yd293XCIgcHJuZyBhbGdvcml0aG0gYnlcbi8vIEdlb3JnZSBNYXJzYWdsaWEuICBTZWUgaHR0cDovL3d3dy5qc3RhdHNvZnQub3JnL3YwOC9pMTQvcGFwZXJcblxuKGZ1bmN0aW9uKGdsb2JhbCwgbW9kdWxlLCBkZWZpbmUpIHtcblxuZnVuY3Rpb24gWG9yR2VuKHNlZWQpIHtcbiAgdmFyIG1lID0gdGhpcywgc3Ryc2VlZCA9ICcnO1xuXG4gIC8vIFNldCB1cCBnZW5lcmF0b3IgZnVuY3Rpb24uXG4gIG1lLm5leHQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgdCA9IChtZS54IF4gKG1lLnggPj4+IDIpKTtcbiAgICBtZS54ID0gbWUueTsgbWUueSA9IG1lLno7IG1lLnogPSBtZS53OyBtZS53ID0gbWUudjtcbiAgICByZXR1cm4gKG1lLmQgPSAobWUuZCArIDM2MjQzNyB8IDApKSArXG4gICAgICAgKG1lLnYgPSAobWUudiBeIChtZS52IDw8IDQpKSBeICh0IF4gKHQgPDwgMSkpKSB8IDA7XG4gIH07XG5cbiAgbWUueCA9IDA7XG4gIG1lLnkgPSAwO1xuICBtZS56ID0gMDtcbiAgbWUudyA9IDA7XG4gIG1lLnYgPSAwO1xuXG4gIGlmIChzZWVkID09PSAoc2VlZCB8IDApKSB7XG4gICAgLy8gSW50ZWdlciBzZWVkLlxuICAgIG1lLnggPSBzZWVkO1xuICB9IGVsc2Uge1xuICAgIC8vIFN0cmluZyBzZWVkLlxuICAgIHN0cnNlZWQgKz0gc2VlZDtcbiAgfVxuXG4gIC8vIE1peCBpbiBzdHJpbmcgc2VlZCwgdGhlbiBkaXNjYXJkIGFuIGluaXRpYWwgYmF0Y2ggb2YgNjQgdmFsdWVzLlxuICBmb3IgKHZhciBrID0gMDsgayA8IHN0cnNlZWQubGVuZ3RoICsgNjQ7IGsrKykge1xuICAgIG1lLnggXj0gc3Ryc2VlZC5jaGFyQ29kZUF0KGspIHwgMDtcbiAgICBpZiAoayA9PSBzdHJzZWVkLmxlbmd0aCkge1xuICAgICAgbWUuZCA9IG1lLnggPDwgMTAgXiBtZS54ID4+PiA0O1xuICAgIH1cbiAgICBtZS5uZXh0KCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gY29weShmLCB0KSB7XG4gIHQueCA9IGYueDtcbiAgdC55ID0gZi55O1xuICB0LnogPSBmLno7XG4gIHQudyA9IGYudztcbiAgdC52ID0gZi52O1xuICB0LmQgPSBmLmQ7XG4gIHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBpbXBsKHNlZWQsIG9wdHMpIHtcbiAgdmFyIHhnID0gbmV3IFhvckdlbihzZWVkKSxcbiAgICAgIHN0YXRlID0gb3B0cyAmJiBvcHRzLnN0YXRlLFxuICAgICAgcHJuZyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMDsgfTtcbiAgcHJuZy5kb3VibGUgPSBmdW5jdGlvbigpIHtcbiAgICBkbyB7XG4gICAgICB2YXIgdG9wID0geGcubmV4dCgpID4+PiAxMSxcbiAgICAgICAgICBib3QgPSAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwLFxuICAgICAgICAgIHJlc3VsdCA9ICh0b3AgKyBib3QpIC8gKDEgPDwgMjEpO1xuICAgIH0gd2hpbGUgKHJlc3VsdCA9PT0gMCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcbiAgcHJuZy5pbnQzMiA9IHhnLm5leHQ7XG4gIHBybmcucXVpY2sgPSBwcm5nO1xuICBpZiAoc3RhdGUpIHtcbiAgICBpZiAodHlwZW9mKHN0YXRlKSA9PSAnb2JqZWN0JykgY29weShzdGF0ZSwgeGcpO1xuICAgIHBybmcuc3RhdGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGNvcHkoeGcsIHt9KTsgfVxuICB9XG4gIHJldHVybiBwcm5nO1xufVxuXG5pZiAobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gaW1wbDtcbn0gZWxzZSBpZiAoZGVmaW5lICYmIGRlZmluZS5hbWQpIHtcbiAgZGVmaW5lKGZ1bmN0aW9uKCkgeyByZXR1cm4gaW1wbDsgfSk7XG59IGVsc2Uge1xuICB0aGlzLnhvcndvdyA9IGltcGw7XG59XG5cbn0pKFxuICB0aGlzLFxuICAodHlwZW9mIG1vZHVsZSkgPT0gJ29iamVjdCcgJiYgbW9kdWxlLCAgICAvLyBwcmVzZW50IGluIG5vZGUuanNcbiAgKHR5cGVvZiBkZWZpbmUpID09ICdmdW5jdGlvbicgJiYgZGVmaW5lICAgLy8gcHJlc2VudCB3aXRoIGFuIEFNRCBsb2FkZXJcbik7XG5cblxuIiwiLypcbkNvcHlyaWdodCAyMDE0IERhdmlkIEJhdS5cblxuUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nXG5hIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcblwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xud2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvXG5wZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG9cbnRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcblxuVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmVcbmluY2x1ZGVkIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuXG5USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELFxuRVhQUkVTUyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG5NRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuXG5JTiBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWVxuQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCxcblRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFXG5TT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuKi9cblxuKGZ1bmN0aW9uIChwb29sLCBtYXRoKSB7XG4vL1xuLy8gVGhlIGZvbGxvd2luZyBjb25zdGFudHMgYXJlIHJlbGF0ZWQgdG8gSUVFRSA3NTQgbGltaXRzLlxuLy9cbnZhciBnbG9iYWwgPSB0aGlzLFxuICAgIHdpZHRoID0gMjU2LCAgICAgICAgLy8gZWFjaCBSQzQgb3V0cHV0IGlzIDAgPD0geCA8IDI1NlxuICAgIGNodW5rcyA9IDYsICAgICAgICAgLy8gYXQgbGVhc3Qgc2l4IFJDNCBvdXRwdXRzIGZvciBlYWNoIGRvdWJsZVxuICAgIGRpZ2l0cyA9IDUyLCAgICAgICAgLy8gdGhlcmUgYXJlIDUyIHNpZ25pZmljYW50IGRpZ2l0cyBpbiBhIGRvdWJsZVxuICAgIHJuZ25hbWUgPSAncmFuZG9tJywgLy8gcm5nbmFtZTogbmFtZSBmb3IgTWF0aC5yYW5kb20gYW5kIE1hdGguc2VlZHJhbmRvbVxuICAgIHN0YXJ0ZGVub20gPSBtYXRoLnBvdyh3aWR0aCwgY2h1bmtzKSxcbiAgICBzaWduaWZpY2FuY2UgPSBtYXRoLnBvdygyLCBkaWdpdHMpLFxuICAgIG92ZXJmbG93ID0gc2lnbmlmaWNhbmNlICogMixcbiAgICBtYXNrID0gd2lkdGggLSAxLFxuICAgIG5vZGVjcnlwdG87ICAgICAgICAgLy8gbm9kZS5qcyBjcnlwdG8gbW9kdWxlLCBpbml0aWFsaXplZCBhdCB0aGUgYm90dG9tLlxuXG4vL1xuLy8gc2VlZHJhbmRvbSgpXG4vLyBUaGlzIGlzIHRoZSBzZWVkcmFuZG9tIGZ1bmN0aW9uIGRlc2NyaWJlZCBhYm92ZS5cbi8vXG5mdW5jdGlvbiBzZWVkcmFuZG9tKHNlZWQsIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gIHZhciBrZXkgPSBbXTtcbiAgb3B0aW9ucyA9IChvcHRpb25zID09IHRydWUpID8geyBlbnRyb3B5OiB0cnVlIH0gOiAob3B0aW9ucyB8fCB7fSk7XG5cbiAgLy8gRmxhdHRlbiB0aGUgc2VlZCBzdHJpbmcgb3IgYnVpbGQgb25lIGZyb20gbG9jYWwgZW50cm9weSBpZiBuZWVkZWQuXG4gIHZhciBzaG9ydHNlZWQgPSBtaXhrZXkoZmxhdHRlbihcbiAgICBvcHRpb25zLmVudHJvcHkgPyBbc2VlZCwgdG9zdHJpbmcocG9vbCldIDpcbiAgICAoc2VlZCA9PSBudWxsKSA/IGF1dG9zZWVkKCkgOiBzZWVkLCAzKSwga2V5KTtcblxuICAvLyBVc2UgdGhlIHNlZWQgdG8gaW5pdGlhbGl6ZSBhbiBBUkM0IGdlbmVyYXRvci5cbiAgdmFyIGFyYzQgPSBuZXcgQVJDNChrZXkpO1xuXG4gIC8vIFRoaXMgZnVuY3Rpb24gcmV0dXJucyBhIHJhbmRvbSBkb3VibGUgaW4gWzAsIDEpIHRoYXQgY29udGFpbnNcbiAgLy8gcmFuZG9tbmVzcyBpbiBldmVyeSBiaXQgb2YgdGhlIG1hbnRpc3NhIG9mIHRoZSBJRUVFIDc1NCB2YWx1ZS5cbiAgdmFyIHBybmcgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgbiA9IGFyYzQuZyhjaHVua3MpLCAgICAgICAgICAgICAvLyBTdGFydCB3aXRoIGEgbnVtZXJhdG9yIG4gPCAyIF4gNDhcbiAgICAgICAgZCA9IHN0YXJ0ZGVub20sICAgICAgICAgICAgICAgICAvLyAgIGFuZCBkZW5vbWluYXRvciBkID0gMiBeIDQ4LlxuICAgICAgICB4ID0gMDsgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgYW5kIG5vICdleHRyYSBsYXN0IGJ5dGUnLlxuICAgIHdoaWxlIChuIDwgc2lnbmlmaWNhbmNlKSB7ICAgICAgICAgIC8vIEZpbGwgdXAgYWxsIHNpZ25pZmljYW50IGRpZ2l0cyBieVxuICAgICAgbiA9IChuICsgeCkgKiB3aWR0aDsgICAgICAgICAgICAgIC8vICAgc2hpZnRpbmcgbnVtZXJhdG9yIGFuZFxuICAgICAgZCAqPSB3aWR0aDsgICAgICAgICAgICAgICAgICAgICAgIC8vICAgZGVub21pbmF0b3IgYW5kIGdlbmVyYXRpbmcgYVxuICAgICAgeCA9IGFyYzQuZygxKTsgICAgICAgICAgICAgICAgICAgIC8vICAgbmV3IGxlYXN0LXNpZ25pZmljYW50LWJ5dGUuXG4gICAgfVxuICAgIHdoaWxlIChuID49IG92ZXJmbG93KSB7ICAgICAgICAgICAgIC8vIFRvIGF2b2lkIHJvdW5kaW5nIHVwLCBiZWZvcmUgYWRkaW5nXG4gICAgICBuIC89IDI7ICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gICBsYXN0IGJ5dGUsIHNoaWZ0IGV2ZXJ5dGhpbmdcbiAgICAgIGQgLz0gMjsgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAgIHJpZ2h0IHVzaW5nIGludGVnZXIgbWF0aCB1bnRpbFxuICAgICAgeCA+Pj49IDE7ICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgd2UgaGF2ZSBleGFjdGx5IHRoZSBkZXNpcmVkIGJpdHMuXG4gICAgfVxuICAgIHJldHVybiAobiArIHgpIC8gZDsgICAgICAgICAgICAgICAgIC8vIEZvcm0gdGhlIG51bWJlciB3aXRoaW4gWzAsIDEpLlxuICB9O1xuXG4gIHBybmcuaW50MzIgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGFyYzQuZyg0KSB8IDA7IH1cbiAgcHJuZy5xdWljayA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gYXJjNC5nKDQpIC8gMHgxMDAwMDAwMDA7IH1cbiAgcHJuZy5kb3VibGUgPSBwcm5nO1xuXG4gIC8vIE1peCB0aGUgcmFuZG9tbmVzcyBpbnRvIGFjY3VtdWxhdGVkIGVudHJvcHkuXG4gIG1peGtleSh0b3N0cmluZyhhcmM0LlMpLCBwb29sKTtcblxuICAvLyBDYWxsaW5nIGNvbnZlbnRpb246IHdoYXQgdG8gcmV0dXJuIGFzIGEgZnVuY3Rpb24gb2YgcHJuZywgc2VlZCwgaXNfbWF0aC5cbiAgcmV0dXJuIChvcHRpb25zLnBhc3MgfHwgY2FsbGJhY2sgfHxcbiAgICAgIGZ1bmN0aW9uKHBybmcsIHNlZWQsIGlzX21hdGhfY2FsbCwgc3RhdGUpIHtcbiAgICAgICAgaWYgKHN0YXRlKSB7XG4gICAgICAgICAgLy8gTG9hZCB0aGUgYXJjNCBzdGF0ZSBmcm9tIHRoZSBnaXZlbiBzdGF0ZSBpZiBpdCBoYXMgYW4gUyBhcnJheS5cbiAgICAgICAgICBpZiAoc3RhdGUuUykgeyBjb3B5KHN0YXRlLCBhcmM0KTsgfVxuICAgICAgICAgIC8vIE9ubHkgcHJvdmlkZSB0aGUgLnN0YXRlIG1ldGhvZCBpZiByZXF1ZXN0ZWQgdmlhIG9wdGlvbnMuc3RhdGUuXG4gICAgICAgICAgcHJuZy5zdGF0ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gY29weShhcmM0LCB7fSk7IH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIGNhbGxlZCBhcyBhIG1ldGhvZCBvZiBNYXRoIChNYXRoLnNlZWRyYW5kb20oKSksIG11dGF0ZVxuICAgICAgICAvLyBNYXRoLnJhbmRvbSBiZWNhdXNlIHRoYXQgaXMgaG93IHNlZWRyYW5kb20uanMgaGFzIHdvcmtlZCBzaW5jZSB2MS4wLlxuICAgICAgICBpZiAoaXNfbWF0aF9jYWxsKSB7IG1hdGhbcm5nbmFtZV0gPSBwcm5nOyByZXR1cm4gc2VlZDsgfVxuXG4gICAgICAgIC8vIE90aGVyd2lzZSwgaXQgaXMgYSBuZXdlciBjYWxsaW5nIGNvbnZlbnRpb24sIHNvIHJldHVybiB0aGVcbiAgICAgICAgLy8gcHJuZyBkaXJlY3RseS5cbiAgICAgICAgZWxzZSByZXR1cm4gcHJuZztcbiAgICAgIH0pKFxuICBwcm5nLFxuICBzaG9ydHNlZWQsXG4gICdnbG9iYWwnIGluIG9wdGlvbnMgPyBvcHRpb25zLmdsb2JhbCA6ICh0aGlzID09IG1hdGgpLFxuICBvcHRpb25zLnN0YXRlKTtcbn1cbm1hdGhbJ3NlZWQnICsgcm5nbmFtZV0gPSBzZWVkcmFuZG9tO1xuXG4vL1xuLy8gQVJDNFxuLy9cbi8vIEFuIEFSQzQgaW1wbGVtZW50YXRpb24uICBUaGUgY29uc3RydWN0b3IgdGFrZXMgYSBrZXkgaW4gdGhlIGZvcm0gb2Zcbi8vIGFuIGFycmF5IG9mIGF0IG1vc3QgKHdpZHRoKSBpbnRlZ2VycyB0aGF0IHNob3VsZCBiZSAwIDw9IHggPCAod2lkdGgpLlxuLy9cbi8vIFRoZSBnKGNvdW50KSBtZXRob2QgcmV0dXJucyBhIHBzZXVkb3JhbmRvbSBpbnRlZ2VyIHRoYXQgY29uY2F0ZW5hdGVzXG4vLyB0aGUgbmV4dCAoY291bnQpIG91dHB1dHMgZnJvbSBBUkM0LiAgSXRzIHJldHVybiB2YWx1ZSBpcyBhIG51bWJlciB4XG4vLyB0aGF0IGlzIGluIHRoZSByYW5nZSAwIDw9IHggPCAod2lkdGggXiBjb3VudCkuXG4vL1xuZnVuY3Rpb24gQVJDNChrZXkpIHtcbiAgdmFyIHQsIGtleWxlbiA9IGtleS5sZW5ndGgsXG4gICAgICBtZSA9IHRoaXMsIGkgPSAwLCBqID0gbWUuaSA9IG1lLmogPSAwLCBzID0gbWUuUyA9IFtdO1xuXG4gIC8vIFRoZSBlbXB0eSBrZXkgW10gaXMgdHJlYXRlZCBhcyBbMF0uXG4gIGlmICgha2V5bGVuKSB7IGtleSA9IFtrZXlsZW4rK107IH1cblxuICAvLyBTZXQgdXAgUyB1c2luZyB0aGUgc3RhbmRhcmQga2V5IHNjaGVkdWxpbmcgYWxnb3JpdGhtLlxuICB3aGlsZSAoaSA8IHdpZHRoKSB7XG4gICAgc1tpXSA9IGkrKztcbiAgfVxuICBmb3IgKGkgPSAwOyBpIDwgd2lkdGg7IGkrKykge1xuICAgIHNbaV0gPSBzW2ogPSBtYXNrICYgKGogKyBrZXlbaSAlIGtleWxlbl0gKyAodCA9IHNbaV0pKV07XG4gICAgc1tqXSA9IHQ7XG4gIH1cblxuICAvLyBUaGUgXCJnXCIgbWV0aG9kIHJldHVybnMgdGhlIG5leHQgKGNvdW50KSBvdXRwdXRzIGFzIG9uZSBudW1iZXIuXG4gIChtZS5nID0gZnVuY3Rpb24oY291bnQpIHtcbiAgICAvLyBVc2luZyBpbnN0YW5jZSBtZW1iZXJzIGluc3RlYWQgb2YgY2xvc3VyZSBzdGF0ZSBuZWFybHkgZG91YmxlcyBzcGVlZC5cbiAgICB2YXIgdCwgciA9IDAsXG4gICAgICAgIGkgPSBtZS5pLCBqID0gbWUuaiwgcyA9IG1lLlM7XG4gICAgd2hpbGUgKGNvdW50LS0pIHtcbiAgICAgIHQgPSBzW2kgPSBtYXNrICYgKGkgKyAxKV07XG4gICAgICByID0gciAqIHdpZHRoICsgc1ttYXNrICYgKChzW2ldID0gc1tqID0gbWFzayAmIChqICsgdCldKSArIChzW2pdID0gdCkpXTtcbiAgICB9XG4gICAgbWUuaSA9IGk7IG1lLmogPSBqO1xuICAgIHJldHVybiByO1xuICAgIC8vIEZvciByb2J1c3QgdW5wcmVkaWN0YWJpbGl0eSwgdGhlIGZ1bmN0aW9uIGNhbGwgYmVsb3cgYXV0b21hdGljYWxseVxuICAgIC8vIGRpc2NhcmRzIGFuIGluaXRpYWwgYmF0Y2ggb2YgdmFsdWVzLiAgVGhpcyBpcyBjYWxsZWQgUkM0LWRyb3BbMjU2XS5cbiAgICAvLyBTZWUgaHR0cDovL2dvb2dsZS5jb20vc2VhcmNoP3E9cnNhK2ZsdWhyZXIrcmVzcG9uc2UmYnRuSVxuICB9KSh3aWR0aCk7XG59XG5cbi8vXG4vLyBjb3B5KClcbi8vIENvcGllcyBpbnRlcm5hbCBzdGF0ZSBvZiBBUkM0IHRvIG9yIGZyb20gYSBwbGFpbiBvYmplY3QuXG4vL1xuZnVuY3Rpb24gY29weShmLCB0KSB7XG4gIHQuaSA9IGYuaTtcbiAgdC5qID0gZi5qO1xuICB0LlMgPSBmLlMuc2xpY2UoKTtcbiAgcmV0dXJuIHQ7XG59O1xuXG4vL1xuLy8gZmxhdHRlbigpXG4vLyBDb252ZXJ0cyBhbiBvYmplY3QgdHJlZSB0byBuZXN0ZWQgYXJyYXlzIG9mIHN0cmluZ3MuXG4vL1xuZnVuY3Rpb24gZmxhdHRlbihvYmosIGRlcHRoKSB7XG4gIHZhciByZXN1bHQgPSBbXSwgdHlwID0gKHR5cGVvZiBvYmopLCBwcm9wO1xuICBpZiAoZGVwdGggJiYgdHlwID09ICdvYmplY3QnKSB7XG4gICAgZm9yIChwcm9wIGluIG9iaikge1xuICAgICAgdHJ5IHsgcmVzdWx0LnB1c2goZmxhdHRlbihvYmpbcHJvcF0sIGRlcHRoIC0gMSkpOyB9IGNhdGNoIChlKSB7fVxuICAgIH1cbiAgfVxuICByZXR1cm4gKHJlc3VsdC5sZW5ndGggPyByZXN1bHQgOiB0eXAgPT0gJ3N0cmluZycgPyBvYmogOiBvYmogKyAnXFwwJyk7XG59XG5cbi8vXG4vLyBtaXhrZXkoKVxuLy8gTWl4ZXMgYSBzdHJpbmcgc2VlZCBpbnRvIGEga2V5IHRoYXQgaXMgYW4gYXJyYXkgb2YgaW50ZWdlcnMsIGFuZFxuLy8gcmV0dXJucyBhIHNob3J0ZW5lZCBzdHJpbmcgc2VlZCB0aGF0IGlzIGVxdWl2YWxlbnQgdG8gdGhlIHJlc3VsdCBrZXkuXG4vL1xuZnVuY3Rpb24gbWl4a2V5KHNlZWQsIGtleSkge1xuICB2YXIgc3RyaW5nc2VlZCA9IHNlZWQgKyAnJywgc21lYXIsIGogPSAwO1xuICB3aGlsZSAoaiA8IHN0cmluZ3NlZWQubGVuZ3RoKSB7XG4gICAga2V5W21hc2sgJiBqXSA9XG4gICAgICBtYXNrICYgKChzbWVhciBePSBrZXlbbWFzayAmIGpdICogMTkpICsgc3RyaW5nc2VlZC5jaGFyQ29kZUF0KGorKykpO1xuICB9XG4gIHJldHVybiB0b3N0cmluZyhrZXkpO1xufVxuXG4vL1xuLy8gYXV0b3NlZWQoKVxuLy8gUmV0dXJucyBhbiBvYmplY3QgZm9yIGF1dG9zZWVkaW5nLCB1c2luZyB3aW5kb3cuY3J5cHRvIGFuZCBOb2RlIGNyeXB0b1xuLy8gbW9kdWxlIGlmIGF2YWlsYWJsZS5cbi8vXG5mdW5jdGlvbiBhdXRvc2VlZCgpIHtcbiAgdHJ5IHtcbiAgICB2YXIgb3V0O1xuICAgIGlmIChub2RlY3J5cHRvICYmIChvdXQgPSBub2RlY3J5cHRvLnJhbmRvbUJ5dGVzKSkge1xuICAgICAgLy8gVGhlIHVzZSBvZiAnb3V0JyB0byByZW1lbWJlciByYW5kb21CeXRlcyBtYWtlcyB0aWdodCBtaW5pZmllZCBjb2RlLlxuICAgICAgb3V0ID0gb3V0KHdpZHRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgb3V0ID0gbmV3IFVpbnQ4QXJyYXkod2lkdGgpO1xuICAgICAgKGdsb2JhbC5jcnlwdG8gfHwgZ2xvYmFsLm1zQ3J5cHRvKS5nZXRSYW5kb21WYWx1ZXMob3V0KTtcbiAgICB9XG4gICAgcmV0dXJuIHRvc3RyaW5nKG91dCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB2YXIgYnJvd3NlciA9IGdsb2JhbC5uYXZpZ2F0b3IsXG4gICAgICAgIHBsdWdpbnMgPSBicm93c2VyICYmIGJyb3dzZXIucGx1Z2lucztcbiAgICByZXR1cm4gWytuZXcgRGF0ZSwgZ2xvYmFsLCBwbHVnaW5zLCBnbG9iYWwuc2NyZWVuLCB0b3N0cmluZyhwb29sKV07XG4gIH1cbn1cblxuLy9cbi8vIHRvc3RyaW5nKClcbi8vIENvbnZlcnRzIGFuIGFycmF5IG9mIGNoYXJjb2RlcyB0byBhIHN0cmluZ1xuLy9cbmZ1bmN0aW9uIHRvc3RyaW5nKGEpIHtcbiAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkoMCwgYSk7XG59XG5cbi8vXG4vLyBXaGVuIHNlZWRyYW5kb20uanMgaXMgbG9hZGVkLCB3ZSBpbW1lZGlhdGVseSBtaXggYSBmZXcgYml0c1xuLy8gZnJvbSB0aGUgYnVpbHQtaW4gUk5HIGludG8gdGhlIGVudHJvcHkgcG9vbC4gIEJlY2F1c2Ugd2UgZG9cbi8vIG5vdCB3YW50IHRvIGludGVyZmVyZSB3aXRoIGRldGVybWluaXN0aWMgUFJORyBzdGF0ZSBsYXRlcixcbi8vIHNlZWRyYW5kb20gd2lsbCBub3QgY2FsbCBtYXRoLnJhbmRvbSBvbiBpdHMgb3duIGFnYWluIGFmdGVyXG4vLyBpbml0aWFsaXphdGlvbi5cbi8vXG5taXhrZXkobWF0aC5yYW5kb20oKSwgcG9vbCk7XG5cbi8vXG4vLyBOb2RlanMgYW5kIEFNRCBzdXBwb3J0OiBleHBvcnQgdGhlIGltcGxlbWVudGF0aW9uIGFzIGEgbW9kdWxlIHVzaW5nXG4vLyBlaXRoZXIgY29udmVudGlvbi5cbi8vXG5pZiAoKHR5cGVvZiBtb2R1bGUpID09ICdvYmplY3QnICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gc2VlZHJhbmRvbTtcbiAgLy8gV2hlbiBpbiBub2RlLmpzLCB0cnkgdXNpbmcgY3J5cHRvIHBhY2thZ2UgZm9yIGF1dG9zZWVkaW5nLlxuICB0cnkge1xuICAgIG5vZGVjcnlwdG8gPSByZXF1aXJlKCdjcnlwdG8nKTtcbiAgfSBjYXRjaCAoZXgpIHt9XG59IGVsc2UgaWYgKCh0eXBlb2YgZGVmaW5lKSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcbiAgZGVmaW5lKGZ1bmN0aW9uKCkgeyByZXR1cm4gc2VlZHJhbmRvbTsgfSk7XG59XG5cbi8vIEVuZCBhbm9ueW1vdXMgc2NvcGUsIGFuZCBwYXNzIGluaXRpYWwgdmFsdWVzLlxufSkoXG4gIFtdLCAgICAgLy8gcG9vbDogZW50cm9weSBwb29sIHN0YXJ0cyBlbXB0eVxuICBNYXRoICAgIC8vIG1hdGg6IHBhY2thZ2UgY29udGFpbmluZyByYW5kb20sIHBvdywgYW5kIHNlZWRyYW5kb21cbik7XG4iLCIvKipcbiAqIFRoaXMgbW9kdWxlIGlzIHVzZWQgdG8gY3JlYXRlIGRpZmZlcmVudCBwb2ludCBkaXN0cmlidXRpb25zIHRoYXQgY2FuIGJlXG4gKiB0dXJuZWQgaW50byBkaWZmZXJlbnQgdGlsZSBzZXRzIHdoZW4gbWFkZSBpbnRvIGEgZ3JhcGggZm9ybWF0LiBUaGVyZSBhcmVcbiAqIHZhcmlvdXMgZGlmZmVyZW50IGRpc3RyaWJ1dGlvbnMgdGhhdCBjYW4gYmUgdXNlZCB0byBjcmVhdGUgaW50ZXJlc3RpbmdcbiAqIHRpbGUgcGF0dGVybnMgd2hlbiB0dXJuZWQgaW50byBhIHZvcm9ub2kgZGlhZ3JhbS4gXG4gKiBcbiAqIEBjbGFzcyBQb2ludERpc3RyaWJ1dGlvblxuICovXG5cblwidXNlIHN0cmljdFwiO1xuXG5pbXBvcnQgUG9pc3NvbiBmcm9tIFwicG9pc3Nvbi1kaXNrLXNhbXBsZVwiO1xuaW1wb3J0IFZlY3RvciBmcm9tIFwiLi4vZ2VvbWV0cnkvVmVjdG9yXCI7XG5pbXBvcnQgUmVjdGFuZ2xlIGZyb20gXCIuLi9nZW9tZXRyeS9SZWN0YW5nbGVcIjtcbmltcG9ydCBSYW5kIGZyb20gXCIuL1JhbmRcIjtcblxuLyoqXG4gKiBDcmVhdGVzIGEgcmFuZG9tIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMgaW4gYSBwYXJ0aWN1bGFyIGJvdW5kaW5nIGJveFxuICogd2l0aCBhIHBhcnRpY3VsYXIgYXZlcmFnZSBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50cy5cbiAqIFxuICogQGV4cG9ydFxuICogQHBhcmFtIHtSZWN0YW5nbGV9IGJib3ggVGhlIGJvdW5kaW5nIGJveCB0byBjcmVhdGUgdGhlIHBvaW50cyBpblxuICogQHBhcmFtIHtudW1iZXJ9IGQgQXZlcmFnZSBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50c1xuICogQHBhcmFtIHtudW1iZXJ9IFtzZWVkPW51bGxdIElmIHNwZWNpZmllZCB1c2UgYSBsb2NhbCBzZWVkIGZvciBjcmVhdGluZyB0aGUgcG9pbnRcbiAqICBkaXN0cmlidXRpb24uIE90aGVyd2lzZSwgdXNlIHRoZSBjdXJyZW50IGdsb2JhbCBzZWVkIGZvciBnZW5lcmF0aW9uXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByYW5kb20oYmJveCwgZCwgc2VlZCA9IG51bGwpIHtcbiAgICBjb25zdCBybmcgPSBzZWVkID8gbmV3IFJhbmQoc2VlZCkgOiBSYW5kO1xuICAgIGNvbnN0IG5Qb2ludHMgPSBiYm94LmFyZWEgLyAoZCAqIGQpO1xuXG4gICAgbGV0IHBvaW50cyA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgblBvaW50czsgaSsrKSB7XG4gICAgICAgIHBvaW50cy5wdXNoKHJuZy52ZWN0b3IoYmJveCkpO1xuICAgIH1cblxuICAgIHJldHVybiBwb2ludHM7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIHNxdWFyZSBncmlkIGxpa2UgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXIgYm91bmRpbmdcbiAqIGJveCB3aXRoIGEgcGFydGljdWxhciBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50cy5cbiAqIFxuICogQGV4cG9ydFxuICogQHBhcmFtIHtSZWN0YW5nbGV9IGJib3ggVGhlIGJvdW5kaW5nIGJveCB0byBjcmVhdGUgdGhlIHBvaW50cyBpblxuICogQHBhcmFtIHtudW1iZXJ9IGQgQXZlcmFnZSBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50c1xuICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgbGlzdCBvZiByYW5kb21seSBkaXN0cmlidXRlZCBwb2ludHNcbiAqIEBtZW1iZXJvZiBQb2ludERpc3RyaWJ1dGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gc3F1YXJlKGJib3gsIGQpIHtcbiAgICBjb25zdCBkeCA9IGQgLyAyO1xuICAgIGNvbnN0IGR5ID0gZHg7XG4gICAgbGV0IHBvaW50cyA9IFtdO1xuXG4gICAgZm9yIChsZXQgeSA9IDA7IHkgPCBiYm94LmhlaWdodDsgeSArPSBkKSB7XG4gICAgICAgIGZvciAobGV0IHggPSAwOyB4IDwgYmJveC53aWR0aDsgeCArPSBkKSB7XG4gICAgICAgICAgICBwb2ludHMucHVzaChuZXcgVmVjdG9yKGR4ICsgeCwgZHkgKyB5KSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcG9pbnRzO1xufVxuXG5cbi8qKlxuICogQ3JlYXRlcyBhIHNxdWFyZSBncmlkIGxpa2UgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXIgYm91bmRpbmdcbiAqIGJveCB3aXRoIGEgcGFydGljdWxhciBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50cy4gVGhlIGdyaWQgaGFzIGFsc28gYmVlblxuICogc2xpZ2h0bHkgcHVydHVyYmVkIG9yIGppdHRlcmVkIHNvIHRoYXQgdGhlIGRpc3RyaWJ1dGlvbiBpcyBub3QgY29tcGxldGVseVxuICogZXZlbi5cbiAqIFxuICogQGV4cG9ydFxuICogQHBhcmFtIHtSZWN0YW5nbGV9IGJib3ggVGhlIGJvdW5kaW5nIGJveCB0byBjcmVhdGUgdGhlIHBvaW50cyBpblxuICogQHBhcmFtIHtudW1iZXJ9IGQgQXZlcmFnZSBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50c1xuICogQHBhcmFtIHtudW1iZXJ9IGFtbSBUaGUgYW1tb3VudCBvZiBqaXR0ZXIgdGhhdCBoYXMgYmVlbiBhcHBsaWVkIHRvIHRoZSBncmlkXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcXVhcmVKaXR0ZXIoYmJveCwgZCwgYW1tKSB7XG4gICAgcmV0dXJuIHNxdWFyZShiYm94LCBkKS5tYXAodiA9PiBSYW5kLmppdHRlcih2LCBhbW0pKTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgdW5pZm9ybSBoZXhhZ29uYWwgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXIgYm91bmRpbmdcbiAqIGJveCB3aXRoIGEgcGFydGljdWxhciBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50cy4gVGhlIGhleGFnb25zIGNhbiBhbHNvIGJlXG4gKiBzcGVjaWZpZWQgdG8gaGF2ZSBhIHBhcnRpY3VsYXIgd2lkdGggb3IgaGVpZ2h0IGFzIHdlbGwgYXMgY3JlYXRpbmcgaGV4YWdvbnNcbiAqIHRoYXQgaGF2ZSBcInBvaW50eVwiIHRvcHMgb3IgXCJmbGF0XCIgdG9wcy4gQnkgZGVmYXVsdCBpdCBtYWtlcyBmbGF0IHRvcHMuXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2ZsYXRUb3A9dHJ1ZV0gQ3JlYXRlIGhlY2Fnb25zIHdpdGggZmxhdCB0b3BzIGJ5IGRlZmF1bHQuXG4gKiAgT3RoZXJ3aXNlIGdvIHdpdGggdGhlIHBvaW50eSB0b3AgaGV4YWdvbnMuXG4gKiBAcGFyYW0ge251bWJlcn0gdyBUaGUgd2lkdGggb2YgdGhlIGhleGFnb24gdGlsZXNcbiAqIEBwYXJhbSB7bnVtYmVyfSBoIFRoZSBoZWlnaHQgb2YgdGhlIGhleGFnb24gdGlsZXNcbiAqIEByZXR1cm5zIHtWZWN0b3JbXX0gVGhlIGxpc3Qgb2YgcmFuZG9tbHkgZGlzdHJpYnV0ZWQgcG9pbnRzXG4gKiBAbWVtYmVyb2YgUG9pbnREaXN0cmlidXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGhleGFnb24oYmJveCwgZCwgZmxhdFRvcCA9IHRydWUsIHcsIGgpIHtcbiAgICAvLyBOZWVkIHRvIGFsbG93IGZvciB0aGUgY2hhbmdlIG9mIGhlaWdodCBhbmQgd2lkdGhcbiAgICAvLyBSdW5uaW5nIGludG8gXCJVbmNhdWdodCBWb3Jvbm9pLmNsb3NlQ2VsbHMoKSA+IHRoaXMgbWFrZXMgbm8gc2Vuc2UhXCJcblxuICAgIGNvbnN0IGR4ID0gZCAvIDI7XG4gICAgY29uc3QgZHkgPSBkeDtcbiAgICBsZXQgcG9pbnRzID0gW107XG4gICAgY29uc3QgYWx0aXR1ZGUgPSBNYXRoLnNxcnQoMykgLyAyICogZDtcbiAgICB2YXIgTiA9IE1hdGguc3FydChiYm94LmFyZWEgLyAoZCAqIGQpKTtcbiAgICBmb3IgKGxldCB5ID0gMDsgeSA8IE47IHkrKykge1xuICAgICAgICBmb3IgKGxldCB4ID0gMDsgeCA8IE47IHgrKykge1xuICAgICAgICAgICAgcG9pbnRzLnB1c2gobmV3IFZlY3RvcigoMC41ICsgeCkgLyBOICogYmJveC53aWR0aCxcbiAgICAgICAgICAgICAgICAoMC4yNSArIDAuNSAqIHggJSAyICsgeSkgLyBOICogYmJveC5oZWlnaHQpKTtcbiAgICAgICAgICAgIC8vIHBvaW50cy5wdXNoKG5ldyBWZWN0b3IoKHkgJSAyKSAqIGR4ICsgeCAqIGQgKyBkeCwgeSAqIGQgKyBkeSkpOyAvLyBQb2ludHkgVG9wXG4gICAgICAgICAgICAvLyBwb2ludHMucHVzaChuZXcgVmVjdG9yKHggKiBkLCAoeCAlIDIpICogZHggKyB5ICogZCkpOyAvLyBGbGF0IFRvcFxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBvaW50cztcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgYmx1ZSBub2lzZSBkaXN0cmlidXRpb24gb2YgcG9pbnRzIGluIGEgcGFydGljdWxhciBib3VuZGluZyBib3hcbiAqIHdpdGggYSBwYXJ0aWN1bGFyIGF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuIFRoaXMgaXMgZG9uZSBieVxuICogY3JlYXRpbmcgYSBncmlkIHN5c3RlbSBhbmQgcGlja2luZyBhIHJhbmRvbSBwb2ludCBpbiBlYWNoIGdyaWQuIFRoaXMgaGFzXG4gKiB0aGUgZWZmZWN0IG9mIGNyZWF0aW5nIGEgbGVzcyByYW5kb20gZGlzdHJpYnV0aW9uIG9mIHBvaW50cy4gVGhlIHNlY29uZFxuICogcGFyYW1ldGVyIG0gZGV0ZXJtaW5zIHRoZSBzcGFjaW5nIGJldHdlZW4gcG9pbnRzIGluIHRoZSBncmlkLiBUaGlzIGVuc3VyZXNcbiAqIHRoYXQgbm8gdHdvIHBvaW50cyBhcmUgaW4gdGhlIHNhbWUgZ3JpZC5cbiAqIFxuICogQHN1bW1hcnkgQ3JlYXRlIGEgaml0dGVyZWQgZ3JpZCBiYXNlZCByYW5kb20gYmx1ZSBub2lzZSBwb2ludCBkaXN0cmlidXRpb24uXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcbiAqIEBwYXJhbSB7bnVtYmVyfSBbc2VlZD1udWxsXSBJZiBzcGVjaWZpZWQgdXNlIGEgbG9jYWwgc2VlZCBmb3IgY3JlYXRpbmcgdGhlIHBvaW50XG4gKiAgZGlzdHJpYnV0aW9uLiBPdGhlcndpc2UsIHVzZSB0aGUgY3VycmVudCBnbG9iYWwgc2VlZCBmb3IgZ2VuZXJhdGlvblxuICogQHBhcmFtIHtudW1iZXJ9IFttPTBdIE1heGltdW0gZGlzdGFuY2UgYXdheSBmcm9tIHRoZSBlZGdlIG9mIHRoZSBncmlkIHRoYXQgYVxuICogIHBvaW50IGNhbiBiZSBwbGFjZWQuIFRoaXMgYWN0cyB0byBpbmNyZWFzZSB0aGUgcGFkZGluZyBiZXR3ZWVuIHBvaW50cy4gXG4gKiAgVGhpcyBtYWtlcyB0aGUgbm9pc2UgbGVzcyByYW5kb20uIFRoaXMgbnVtYmVyIG11c3QgYmUgc21hbGxlciB0aGFuIGQuXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBqaXR0ZXJlZEdyaWQoYmJveCwgZCwgc2VlZCA9IG51bGwsIG0gPSAwKSB7XG4gICAgY29uc3Qgcm5nID0gc2VlZCA/IG5ldyBSYW5kKHNlZWQpIDogUmFuZDtcblxuICAgIGxldCBwb2ludHMgPSBbXTtcbiAgICBsZXQgcG9pbnRCb3g7XG4gICAgZm9yIChsZXQgeSA9IDA7IHkgPCBiYm94LmhlaWdodCAtIGQ7IHkgKz0gZCkge1xuICAgICAgICBmb3IgKGxldCB4ID0gMDsgeCA8IGJib3gud2lkdGggLSBkOyB4ICs9IGQpIHtcbiAgICAgICAgICAgIC8vIExvY2FsIGJib3ggZm9yIHRoZSBwb2ludCB0byBnZW5lcmF0ZSBpblxuICAgICAgICAgICAgY29uc3QgYm94UG9zID0gbmV3IFZlY3Rvcih4IC0gZCArIG0sIHkgLSBkICsgbSk7XG4gICAgICAgICAgICBwb2ludEJveCA9IG5ldyBSZWN0YW5nbGUoYm94UG9zLCB4IC0gbSwgeSAtIG0pO1xuICAgICAgICAgICAgcG9pbnRzLnB1c2gocm5nLnZlY3Rvcihwb2ludEJveCkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBvaW50cztcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgcG9pc3Nvbiwgb3IgYmx1ZSBub2lzZSBkaXN0cmlidXRpb24gb2YgcG9pbnRzIGluIGEgcGFydGljdWxhclxuICogYm91bmRpbmcgYm94IHdpdGggYSBwYXJ0aWN1bGFyIGF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuIFRoaXMgaXNcbiAqIGRvbmUgYnkgdXNpbmcgcG9pc3NvbiBkaXNrIHNhbXBsaW5nIHdoaWNoIHRyaWVzIHRvIGNyZWF0ZSBwb2ludHMgc28gdGhhdCB0aGVcbiAqIGRpc3RhbmNlIGJldHdlZW4gbmVpZ2hib3JzIGlzIGFzIGNsb3NlIHRvIGEgZml4ZWQgbnVtYmVyICh0aGUgZGlzdGFuY2UgZClcbiAqIGFzIHBvc3NpYmxlLiBUaGlzIGFsZ29yaXRobSBpcyBpbXBsZW1lbnRlZCB1c2luZyB0aGUgcG9pc3NvbiBkYXJ0IHRocm93aW5nXG4gKiBhbGdvcml0aG0uXG4gKiAgXG4gKiBAc3VtbWFyeSBDcmVhdGUgYSBibHVlIG5vaXNlIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMgdXNpbmcgcG9pc3NvbiBkaXNrXG4gKiAgc2FtcGxpbmcuXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcbiAqIEByZXR1cm5zIHtWZWN0b3JbXX0gVGhlIGxpc3Qgb2YgcmFuZG9tbHkgZGlzdHJpYnV0ZWQgcG9pbnRzXG4gKiBcbiAqIEBzZWUge0BsaW5rIGh0dHBzOi8vd3d3Lmphc29uZGF2aWVzLmNvbS9wb2lzc29uLWRpc2MvfVxuICogQHNlZSB7QGxpbmsgaHR0cHM6Ly9naXRodWIuY29tL2plZmZyZXktaGVhcm4vcG9pc3Nvbi1kaXNrLXNhbXBsZX1cbiAqIEBtZW1iZXJvZiBQb2ludERpc3RyaWJ1dGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gcG9pc3NvbihiYm94LCBkKSB7XG4gICAgdmFyIHNhbXBsZXIgPSBuZXcgUG9pc3NvbihiYm94LndpZHRoLCBiYm94LmhlaWdodCwgZCwgZCk7XG4gICAgdmFyIHNvbHV0aW9uID0gc2FtcGxlci5zYW1wbGVVbnRpbFNvbHV0aW9uKCk7XG4gICAgdmFyIHBvaW50cyA9IHNvbHV0aW9uLm1hcChwb2ludCA9PiBWZWN0b3IuYWRkKG5ldyBWZWN0b3IocG9pbnQpLCBiYm94LnBvc2l0aW9uKSk7XG5cbiAgICByZXR1cm4gcG9pbnRzO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBibHVlIG5vaXNlIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMgaW4gYSBwYXJ0aWN1bGFyIGJvdW5kaW5nIGJveFxuICogd2l0aCBhIHBhcnRpY3VsYXIgYXZlcmFnZSBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50cy4gVGhpcyBpcyBkb25lIGJ5IHVzaW5nXG4gKiByZWN1cnNpdmUgd2FuZyB0aWxlcyB0byBjcmVhdGUgdGhpcyBkaXN0cmlidXRpb24gb2YgcG9pbnRzLlxuICogXG4gKiBAc3VtbWFyeSBOb3QgSW1wbGVtZW50ZWQgWWV0XG4gKiBcbiAqIEBleHBvcnRcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcbiAqIEByZXR1cm5zIHtWZWN0b3JbXX0gVGhlIGxpc3Qgb2YgcmFuZG9tbHkgZGlzdHJpYnV0ZWQgcG9pbnRzXG4gKiBAbWVtYmVyb2YgUG9pbnREaXN0cmlidXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY3Vyc2l2ZVdhbmcoYmJveCwgZCkge1xuICAgIHRocm93IFwiRXJyb3I6IE5vdCBJbXBsZW1lbnRlZFwiO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBjaXJjdWxhciBkaXN0cmlidXRpb24gb2YgcG9pbnRzIGluIGEgcGFydGljdWxhciBib3VuZGluZyBib3hcbiAqIHdpdGggYSBwYXJ0aWN1bGFyIGF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuXG4gKiBcbiAqIEBzdW1tYXJ5IE5vdCBJbXBsZW1lbnRlZCBZZXRcbiAqIFxuICogQGV4cG9ydFxuICogQHBhcmFtIHtSZWN0YW5nbGV9IGJib3ggVGhlIGJvdW5kaW5nIGJveCB0byBjcmVhdGUgdGhlIHBvaW50cyBpblxuICogQHBhcmFtIHtudW1iZXJ9IGQgQXZlcmFnZSBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50c1xuICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgbGlzdCBvZiByYW5kb21seSBkaXN0cmlidXRlZCBwb2ludHNcbiAqIEBtZW1iZXJvZiBQb2ludERpc3RyaWJ1dGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gY2lyY3VsYXIoYmJveCwgZCkge1xuICAgIHRocm93IFwiRXJyb3I6IE5vdCBJbXBsZW1lbnRlZFwiO1xufSIsIlwidXNlIHN0cmljdFwiO1xuXG5pbXBvcnQgc2VlZFJhbmRvbSBmcm9tIFwic2VlZFJhbmRvbVwiO1xuaW1wb3J0IFZlY3RvciBmcm9tIFwiLi4vZ2VvbWV0cnkvVmVjdG9yXCI7XG5cbmNsYXNzIFJhbmQge1xuICAgIC8qKlxuICAgICAqIFdyYXBwZXIgbGlicmFyeSBmb3IgRGF2aWQgQmF1J3Mgc2VlZGVkIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9yIHdoaWNoIGlzIGFcbiAgICAgKiB3cmFwcGVyIGZvciB0aGUgTWF0aC5yYW5kKCkgZnVuY3Rpb25hbGl0eS4gVGhpcyBsaWJyYXJ5IGlzIGltcGxlbWVudGVkIHRvXG4gICAgICogZmlsbCBvdXQgdGhlIGZ1bmN0aW9uYWxpdHkgb2YgdGhlIHJhbmRvbSBjYXBhYmlsaXRpZXMgYXMgd2VsbCBhcyBidWlsZFxuICAgICAqIG9uIHRoZSBjYXBhYmlsaXRpZXMgZXhpc3RpbmcgaW4gdGhlIGZyYW1ld29yayBjdXJyZW50bHkuIFRoaXMgY2xhc3MgY2FuXG4gICAgICogYmUgdXNlZCBvbiBhIGdsb2JhbCBvciBsb2NhbCBzY2FsZS5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIFJhbmQuc2VlZFJhbmRvbSgwKTsgICAgICAvLyBTZXQgdGhlIGdsb2JhbCBzZWVkXG4gICAgICogUmFuZC5yYW5kKCk7ICAgICAgICAgICAgIC8vIFByZWRpY3RhYmxlIGJhc2VkIG9mZiBzZWVkXG4gICAgICogXG4gICAgICogQGV4YW1wbGUgXG4gICAgICogdmFyIHJuZyA9IG5ldyBSYW5kKDApOyAgIC8vIFNldCB0aGUgbG9jYWwgcm5nIHNlZWRcbiAgICAgKiBybmcucmFuZCgpOyAgICAgICAgICAgICAgLy8gUHJlZGljdGFibGUgYmFzZWQgb2ZmIHNlZWRcbiAgICAgKiBcbiAgICAgKiBSYW5kLnJhbmQoKTsgICAgICAgICAgICAgLy8gVW5wcmVkaWN0YWJsZSBzaW5jZSBnbG9iYWwgc2VlZCBpcyBub3Qgc2V0XG4gICAgICogXG4gICAgICogQHNlZSB7QGxpbmsgaHR0cHM6Ly9naXRodWIuY29tL2RhdmlkYmF1L3NlZWRyYW5kb219XG4gICAgICogQHBhcmFtIHtudW1iZXJ8c3RyaW5nfSBbc2VlZD0wXSBUaGUgc2VlZCB0byBiZSBhcHBsaWVkIHRvIHRoZSBsb2NhbFxuICAgICAqICByYW5kb20gbnVtYmVyIGdlbmVyYXRvclxuICAgICAqIEBjbGFzcyBSYW5kXG4gICAgICovXG4gICAgY29uc3RydWN0b3Ioc2VlZCA9IDApIHtcbiAgICAgICAgdGhpcy5ybmcgPSBzZWVkUmFuZG9tKHNlZWQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldCB0aGUgZ2xvYmFsIHNlZWQgZm9yIHRoZSBzZWVkZWQgcmFuZG9tIG51bWJlciBnZW5lcmF0b3IuIEFmdGVyIHRoZSBzZWVkIGhhcyBiZWVuXG4gICAgICogc2V0LiBUaGUgcmFuZG9tIG51bWJlcnMgd2lsbCBiZSBwcmVkaWN0YWJsZSBhbmQgcmVwZWF0YWJsZSBnaXZlbiB0aGUgc2FtZVxuICAgICAqIGlucHV0IHNlZWQuIElmIG5vIHNlZWQgaXMgc3BlY2lmaWVkLCB0aGVuIGEgcmFuZG9tIHNlZWQgd2lsbCBiZSBhc3NpZ25lZCB0b1xuICAgICAqIHRoZSByYW5kb20gbnVtYmVyIGdlbmVyYXRvciB1c2luZyBhZGRlZCBzeXN0ZW0gZW50cm9weS5cbiAgICAgKiBcbiAgICAgKiBAZXhwb3J0XG4gICAgICogQHBhcmFtIHtudW1iZXJ8c3RyaW5nfSBbc2VlZD0wXSBUaGUgc2VlZCB0byBiZSBhcHBsaWVkIHRvIHRoZSBnbG9iYWxcbiAgICAgKiAgcmFuZG9tIG51bWJlciBnZW5lcmF0b3JcbiAgICAgKiBAbWVtYmVyb2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyBzZXRTZWVkKHNlZWQgPSAwKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICAgICAgICBnbG9iYWw6IHRydWUsXG4gICAgICAgICAgICBlbnRyb3B5OiBzZWVkID09PSB1bmRlZmluZWRcbiAgICAgICAgfTtcbiAgICAgICAgc2VlZFJhbmRvbShzZWVkLCBvcHRpb25zKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXQgdGhlIHNlZWQgZm9yIHRoZSBzZWVkZWQgcmFuZG9tIG51bWJlciBnZW5lcmF0b3IuIEFmdGVyIHRoZSBzZWVkIGhhcyBiZWVuXG4gICAgICogc2V0LiBUaGUgcmFuZG9tIG51bWJlcnMgd2lsbCBiZSBwcmVkaWN0YWJsZSBhbmQgcmVwZWF0YWJsZSBnaXZlbiB0aGUgc2FtZVxuICAgICAqIGlucHV0IHNlZWQuIElmIG5vIHNlZWQgaXMgc3BlY2lmaWVkLCB0aGVuIGEgcmFuZG9tIHNlZWQgd2lsbCBiZSBhc3NpZ25lZCB0b1xuICAgICAqIHRoZSByYW5kb20gbnVtYmVyIGdlbmVyYXRvciB1c2luZyBhZGRlZCBzeXN0ZW0gZW50cm9weS5cbiAgICAgKiBcbiAgICAgKiBAZXhwb3J0XG4gICAgICogQHBhcmFtIHtudW1iZXJ8c3RyaW5nfSBbc2VlZD0wXSBUaGUgc2VlZCB0byBiZSBhcHBsaWVkIHRvIHRoZSBSTkdcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyb2YgUmFuZFxuICAgICAqL1xuICAgIHNldFNlZWQoc2VlZCkge1xuICAgICAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgICAgICAgZW50cm9weTogc2VlZCA9PT0gdW5kZWZpbmVkXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMucm5nID0gc2VlZFJhbmRvbShzZWVkLCBvcHRpb25zKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gbnVtYmVyIGZyb20gMCB0byAxLiBcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHJldHVybnMge251bWJlcn0gcmFuZG9tIG51bWJlciBmcm9tIDAgdG8gMVxuICAgICAqIFxuICAgICAqIEBtZW1iZXJvZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIHJhbmQoKSB7XG4gICAgICAgIHJldHVybiBNYXRoLnJhbmRvbSgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHJhbmRvbSBudW1iZXIgZnJvbSAwIHRvIDEuXG4gICAgICogXG4gICAgICogQHJldHVybnMge251bWJlcn0gcmFuZG9tIG51bWJlciBmcm9tIDAgdG8gMVxuICAgICAqIFxuICAgICAqIEBtZW1iZXJvZiBSYW5kXG4gICAgICovXG4gICAgcmFuZCgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucm5nKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHJpdmF0ZSBoZWxwZXIgZnVuY3Rpb246XG4gICAgICogXG4gICAgICogUm9sbCBmb3IgYSBib29sZWFuIHZhbHVlIHRoYXQgaXMgdHJ1ZSBAcGVyY2VudCBhbW1vdW50IG9mIHRoZSB0aW1lLlxuICAgICAqIElmIHRoZSByb2xsIGZhaWxzIHRoZW4gcmV0dXJuIGZhbHNlLiBGb3IgZXhhbXBsZSBjYWxsaW5nIGNoYW5jZSgwLjMpXG4gICAgICogd2lsbCByZXR1cm4gdHJ1ZSAzMCUgb2YgdGhlIHRpbWUuIFRoZSBpbnB1dCByYW5nZVxuICAgICAqIFxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBwZXJjZW50IFBlcmNlbnQgY2hhbmNlIHRvIGdldCBUcnVlLiBWYWx1ZSBpcyBpbiB0aGUgcmFuZ2VcbiAgICAgKiAgZnJvbSAwIC0gMS4gV2l0aCAxIHJldHVybmluZyBhbHdheXMgdHJ1ZS5cbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyBfY2hhbmNlKHJuZywgcGVyY2VudCkge1xuICAgICAgICByZXR1cm4gcm5nLnJhbmQoKSA8IHBlcmNlbnQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUm9sbCBmb3IgYSBib29sZWFuIHZhbHVlIHRoYXQgaXMgdHJ1ZSBAcGVyY2VudCBhbW1vdW50IG9mIHRoZSB0aW1lLlxuICAgICAqIElmIHRoZSByb2xsIGZhaWxzIHRoZW4gcmV0dXJuIGZhbHNlLiBGb3IgZXhhbXBsZSBjYWxsaW5nIGNoYW5jZSgwLjMpXG4gICAgICogd2lsbCByZXR1cm4gdHJ1ZSAzMCUgb2YgdGhlIHRpbWUuIFRoZSBpbnB1dCByYW5nZVxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gcGVyY2VudCBQZXJjZW50IGNoYW5jZSB0byBnZXQgVHJ1ZS4gVmFsdWUgaXMgaW4gdGhlIHJhbmdlXG4gICAgICogIGZyb20gMCAtIDEuIFdpdGggMSByZXR1cm5pbmcgYWx3YXlzIHRydWUuXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgY2hhbmNlKHBlcmNlbnQpIHtcbiAgICAgICAgcmV0dXJuIFJhbmQuX2NoYW5jZSh0aGlzLCBwZXJjZW50KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSb2xsIGZvciBhIGJvb2xlYW4gdmFsdWUgdGhhdCBpcyB0cnVlIEBwZXJjZW50IGFtbW91bnQgb2YgdGhlIHRpbWUuXG4gICAgICogSWYgdGhlIHJvbGwgZmFpbHMgdGhlbiByZXR1cm4gZmFsc2UuIEZvciBleGFtcGxlIGNhbGxpbmcgY2hhbmNlKDAuMylcbiAgICAgKiB3aWxsIHJldHVybiB0cnVlIDMwJSBvZiB0aGUgdGltZS4gVGhlIGlucHV0IHJhbmdlXG4gICAgICogXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHBlcmNlbnQgUGVyY2VudCBjaGFuY2UgdG8gZ2V0IFRydWUuIFZhbHVlIGlzIGluIHRoZSByYW5nZVxuICAgICAqICBmcm9tIDAgLSAxLiBXaXRoIDEgcmV0dXJuaW5nIGFsd2F5cyB0cnVlLlxuICAgICAqIEBtZW1iZXJPZiBSYW5kXG4gICAgICovXG4gICAgY2hhbmNlKHBlcmNlbnQpIHtcbiAgICAgICAgcmV0dXJuIFJhbmQuX2NoYW5jZShSYW5kLCBwZXJjZW50KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQcml2YXRlIEhlbHBlciBGdW5jdGlvbjpcbiAgICAgKiBHZXQgYSByYW5kb20gZmxvYXQgdmFsdWUgaW4gYSBwYXJ0aWN1bGFyIHJhbmdlXG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWluIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtYXggXG4gICAgICogXG4gICAgICogQG1lbWJlcm9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgX3JhbmRSYW5nZShybmcsIG1pbiwgbWF4KSB7XG4gICAgICAgIHJldHVybiBybmcucmFuZCgpICogKG1heCAtIG1pbikgKyBtaW47XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGEgcmFuZG9tIGZsb2F0IHZhbHVlIGluIGEgcGFydGljdWxhciByYW5nZVxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWluIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtYXggXG4gICAgICogQHJldHVybnMge251bWJlcn0gUmFuZG9tIGZsb2F0IG51bWJlciBmcm9tIG1pbiAoaW5jbHVzaXZlKSBcbiAgICAgKiAgdG8gbWF4IChleGNsdXNpdmUpXG4gICAgICogXG4gICAgICogQG1lbWJlcm9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgcmFuZFJhbmdlKG1pbiwgbWF4KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kUmFuZ2UoUmFuZCwgbWluLCBtYXgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHJhbmRvbSBmbG9hdCB2YWx1ZSBpbiBhIHBhcnRpY3VsYXIgcmFuZ2VcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWluIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtYXggXG4gICAgICogQHJldHVybnMge251bWJlcn0gUmFuZG9tIGZsb2F0IG51bWJlciBmcm9tIG1pbiAoaW5jbHVzaXZlKSBcbiAgICAgKiAgdG8gbWF4IChleGNsdXNpdmUpXG4gICAgICogXG4gICAgICogQG1lbWJlcm9mIFJhbmRcbiAgICAgKi9cbiAgICByYW5kUmFuZ2UobWluLCBtYXgpIHtcbiAgICAgICAgcmV0dXJuIFJhbmQuX3JhbmRSYW5nZSh0aGlzLCBtaW4sIG1heCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHJpdmF0ZSBIZWxwZXIgRnVuY3Rpb246XG4gICAgICogR2V0IGEgcmFuZG9tIGludCBpbiBhIHBhcnRpY3VsYXIgcmFuZ2UgKG1pbiBhbmQgbWF4IGluY2x1c2l2ZSlcbiAgICAgKiBcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge2FueX0gcm5nIFRoZSBsb2NhbCBvciBnbG9iYWwgcm5nIHRvIHVzZSAoUmFuZCBvciB0aGlzKVxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtaW4gXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IG1heCBcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBSYW5kb20gZmxvYXQgbnVtYmVyIGZyb20gbWluIChpbmNsdXNpdmUpIFxuICAgICAqICB0byBtYXggKGV4Y2x1c2l2ZSlcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyBfcmFuZEludChybmcsIG1pbiwgbWF4KSB7XG4gICAgICAgIHJldHVybiBNYXRoLmZsb29yKHJuZy5yYW5kKCkgKiAobWF4IC0gbWluICsgMSkpICsgbWluO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHJhbmRvbSBpbnQgaW4gYSBwYXJ0aWN1bGFyIHJhbmdlIChtaW4gYW5kIG1heCBpbmNsdXNpdmUpXG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtaW4gXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IG1heCBcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBSYW5kb20gZmxvYXQgbnVtYmVyIGZyb20gbWluIChpbmNsdXNpdmUpIFxuICAgICAqICB0byBtYXggKGV4Y2x1c2l2ZSlcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyByYW5kSW50KG1pbiwgbWF4KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSW50KFJhbmQsIG1pbiwgbWF4KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gaW50IGluIGEgcGFydGljdWxhciByYW5nZSAobWluIGFuZCBtYXggaW5jbHVzaXZlKVxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtaW4gXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IG1heCBcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBSYW5kb20gZmxvYXQgbnVtYmVyIGZyb20gbWluIChpbmNsdXNpdmUpIFxuICAgICAqICB0byBtYXggKGV4Y2x1c2l2ZSlcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHJhbmRJbnQobWluLCBtYXgpIHtcbiAgICAgICAgcmV0dXJuIFJhbmQuX3JhbmRJbnQodGhpcywgbWluLCBtYXgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByaXZhdGUgSGVscGVyIEZ1bmN0aW9uOlxuICAgICAqIEdldCB0aGUgcmFuZG9tIGhleCB2YWx1ZSBvZiBhIGNvbG9yIHJlcHJlc2VudGVkIGluIHRoZSBoZXhpZGVjaW1hbCBmb3JtYXRcbiAgICAgKiBcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge2FueX0gcm5nIFRoZSBsb2NhbCBvciBnbG9iYWwgcm5nIHRvIHVzZSAoUmFuZCBvciB0aGlzKVxuICAgICAqIEByZXR1cm5zIHtoZXh9IFRoZSByYW5kb20gaGV4IHZhbHVlIGluIHRoZSBjb2xvciBzcGVjdHJ1bVxuICAgICAqIFxuICAgICAqIEBtZW1iZXJPZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIF9yYW5kSGV4KHJuZykge1xuICAgICAgICByZXR1cm4gcm5nLnJhbmRJbnQoMCwgMTY3NzcyMTUpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgcmFuZG9tIGhleCB2YWx1ZSBvZiBhIGNvbG9yIHJlcHJlc2VudGVkIGluIHRoZSBoZXhpZGVjaW1hbCBmb3JtYXRcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHJldHVybnMge2hleH0gXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgcmFuZEhleCgpIHtcbiAgICAgICAgcmV0dXJuIFJhbmQuX3JhbmRIZXgoUmFuZCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSByYW5kb20gaGV4IHZhbHVlIG9mIGEgY29sb3IgcmVwcmVzZW50ZWQgaW4gdGhlIGhleGlkZWNpbWFsIGZvcm1hdFxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtoZXh9IFxuICAgICAqIFxuICAgICAqIEBtZW1iZXJPZiBSYW5kXG4gICAgICovXG4gICAgcmFuZEhleCgpIHtcbiAgICAgICAgcmV0dXJuIFJhbmQuX3JhbmRIZXgodGhpcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHJpdmF0ZSBIZWxwZXIgRnVuY3Rpb246XG4gICAgICogR2V0IGEgcmFuZG9tIGhleCBjb2xvciBzdHJpbmcgcmVwcmVzZW50ZWQgaW4gXCIjSEVYU1RSXCIgZm9ybWF0XG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgICAqIFxuICAgICAqIEBtZW1iZXJPZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIF9yYW5kSGV4Q29sb3Iocm5nKSB7XG4gICAgICAgIHJldHVybiBcIiNcIiArIHJuZy5yYW5kSGV4KCkudG9TdHJpbmcoMTYpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHJhbmRvbSBoZXggY29sb3Igc3RyaW5nIHJlcHJlc2VudGVkIGluIFwiI0hFWFNUUlwiIGZvcm1hdFxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgICAqIFxuICAgICAqIEBtZW1iZXJPZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIHJhbmRIZXhDb2xvcigpIHtcbiAgICAgICAgcmV0dXJuIFJhbmQuX3JhbmRIZXhDb2xvcihSYW5kKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gaGV4IGNvbG9yIHN0cmluZyByZXByZXNlbnRlZCBpbiBcIiNIRVhTVFJcIiBmb3JtYXRcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHJhbmRIZXhDb2xvcigpIHtcbiAgICAgICAgcmV0dXJuIFJhbmQuX3JhbmRIZXhDb2xvcih0aGlzKTtcbiAgICB9XG5cbiAgICAvLy0tLS0gUmFuZG9tIEdlb21ldHJ5IC0tLS1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHJhbmRvbSB2ZWN0b3IgaW4gYSBib3VuZGluZyBib3hcbiAgICAgKiBcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge2FueX0gcm5nIFRoZSBsb2NhbCBvciBnbG9iYWwgcm5nIHRvIHVzZSAoUmFuZCBvciB0aGlzKVxuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggb2YgdGhlIHJhbmRvbSB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBBIHJhbmRvbSB2ZWN0b3JcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyBfdmVjdG9yKHJuZywgYmJveCkge1xuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcihcbiAgICAgICAgICAgIFJhbmQucmFuZFJhbmdlKGJib3gueCwgYmJveC54ICsgYmJveC53aWR0aCksXG4gICAgICAgICAgICBSYW5kLnJhbmRSYW5nZShiYm94LnksIGJib3gueSArIGJib3guaGVpZ2h0KVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHJhbmRvbSB2ZWN0b3IgaW4gYSBib3VuZGluZyBib3hcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtSZWN0YW5nbGV9IGJib3ggVGhlIGJvdW5kaW5nIGJveCBvZiB0aGUgcmFuZG9tIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IEEgcmFuZG9tIHZlY3RvclxuICAgICAqIFxuICAgICAqIEBtZW1iZXJPZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIHZlY3RvcihiYm94KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl92ZWN0b3IoUmFuZCwgYmJveCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGEgcmFuZG9tIHZlY3RvciBpbiBhIGJvdW5kaW5nIGJveFxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggb2YgdGhlIHJhbmRvbSB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBBIHJhbmRvbSB2ZWN0b3JcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHZlY3RvcihiYm94KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl92ZWN0b3IodGhpcywgYmJveCk7XG4gICAgfVxuXG4gICAgc3RhdGljIF9qaXR0ZXIocm5nLCB2LCBtYXgpIHtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5hZGQodiwgVmVjdG9yLlBvbGFyKG1heCwgcm5nLnJhbmRSYW5nZSgwLCAyICogTWF0aC5QSSkpKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgaml0dGVyKHYsIG1heCkge1xuICAgICAgICByZXR1cm4gUmFuZC5faml0dGVyKFJhbmQsIHYsIG1heCk7XG4gICAgfVxuXG4gICAgaml0dGVyKHYsIG1heCkge1xuICAgICAgICByZXR1cm4gUmFuZC5faml0dGVyKHRoaXMsIHYsIG1heCk7XG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBSYW5kOyIsIi8vIFR1bmVhYmxlIFBhcmFtZXRlcnNcclxuLy8gMS4yNSBndWFyZW50ZWUgc3BsaXQgaG9yaXogb3IgdmVydFxyXG4vLyBSZWRpc3RyaWJ1dGUgdGhlIHJhbmdlIHRvIHNwbGl0XHJcblxyXG5pbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcclxuaW1wb3J0IFJlY3RhbmdsZSBmcm9tIFwiLi4vZ2VvbWV0cnkvUmVjdGFuZ2xlXCI7XHJcbmltcG9ydCBSYW5kIGZyb20gXCIuLi91dGlsaXRpZXMvUmFuZFwiO1xyXG5pbXBvcnQgeyBleHAgfSBmcm9tIFwiLi4vdXRpbGl0aWVzL1JlZGlzdFwiO1xyXG5pbXBvcnQgeyBzZXRPcHRpb25zIH0gZnJvbSBcIi4uL3V0aWxpdGllcy9VdGlsXCI7XHJcblxyXG4vKipcclxuICogQ3JlYXRlIGEgQmluYXJ5IFNwYWNlIFBhcnRpdGlvbiBUcmVlIG9mIGEgcGFydGljdWxhciBkZXB0aFxyXG4gKiBcclxuICogQGV4cG9ydFxyXG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgcmVjdGFuZ2xlIHRoYXQgdGhlIEJTUCB0cmVlIGlzIGNyZWF0ZWQgd2l0aGluXHJcbiAqIEBwYXJhbSB7b2JqZWN0fSBvcHRpb25zIFRoZSBvcHRpb25zIHRoYXQgY2FuIGJlIHNldCB0byBjaGFuZ2UgdGhlIHByb3BlcnRpZXNcclxuICogIG9mIHRoZSBCaW5zYXJ5IFNwYWNlIFBhcnRpdGlvbiBnZW5lcmF0aW9uXHJcbiAqIFxyXG4gKiAgb3B0aW9ucyA9IHtcclxuICogICAgZGVwdGgge251bWJlcn0gOiBUaGUgZGVwdGggdGhhdCB0aGUgQlNQIHRyZWUgaXMgY3JlYXRlZCBkb3duIHRvLFxyXG4gKiAgICBzcGxpdFJhbmdlIHtudW1iZXJ9IDogMC0xIFRoZSBhbW1vdW50IG9mIGRldmlhdGlvbiBmcm9tIHRoZSBjZW50ZXJcclxuICogICAgICB0aGF0IHRoZSBiaW5hcnkgc3BsaXQgaXMgYWxsb3dlZCB0byB0YWtlLiAwIE1lYW5zIHRoYXQgdGhlIHNwbGl0IGFsd2F5cyxcclxuICogICAgICBoYXBwZW5zIGluIHRoZSBtaWRkbGUgYW5kIDEgbWVhbnMgdGhhdCB0aGUgc3BsaXQgY2FuIGhhcHBlbiBhdCB0aGUgZWRnZSBvZlxyXG4gKiAgICAgIHRoZSByZWN0YW5nbGUuXHJcbiAqICAgIGRyb3BvdXRSYXRlIHtudW1iZXJ9IDogMC0xLCB0aGUgcGVyY2VudCBjaGFuY2UgdGhhdCB3aGVuIGRpdmlkaW5nIGFcclxuICogICAgICBjZWxsIHRoYXQgaXQgd2lsbCBub3QgZGl2aWRlIGFueW1vcmVcclxuICogICAgbWluQXJlYSB7bnVtYmVyfSA6IHRoZSBtaW5pbXVtIGFyZWEgdGhhdCBhIHJlY3RhbmdsZSBjYW4gYmVjb21lLiBJZiB0aGUgcmVjdCBpc1xyXG4gKiAgICAgIG5vdCBhdCB0aGUgbWF4IGRlcHRoIHRoZSBzdWJkaXZpc2lvbiB3aWxsIHN0aWxsIHN0b3BcclxuICogICAgbWluU2lkZUxlbmd0aCB7bnVtYmVyfVxyXG4gKiAgfVxyXG4gKiBcclxuICogIGRlZmF1bHRzID0ge1xyXG4gKiAgICAgIGRlcHRoOiAzLFxyXG4gKiAgICAgIHNwbGl0UmFuZ2U6IDAuNSxcclxuICogICAgICBkcm9wb3V0UmF0ZTogMC4wLFxyXG4gKiAgICAgIG1pbkFyZWE6IDAuMCxcclxuICogICAgICBtaW5TaWRlTGVuZ3RoOiAwLjAsXHJcbiAqICB9XHJcbiAqIEByZXR1cm5zIFxyXG4gKi9cclxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYmluYXJ5U3BhY2VQYXJ0aXRpb24oYmJveCwgb3B0aW9ucykge1xyXG4gICAgXCJ1c2Ugc3RyaWN0XCI7XHJcblxyXG4gICAgY29uc3QgZGVmYXVsdHMgPSB7XHJcbiAgICAgICAgZGVwdGg6IDMsXHJcbiAgICAgICAgc3BsaXRSYW5nZTogMC41LFxyXG4gICAgICAgIGRyb3BvdXRSYXRlOiAwLjAsXHJcbiAgICAgICAgbWluQXJlYTogMC4wLFxyXG4gICAgICAgIG1pblNpZGVMZW5ndGg6IDAuMCxcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcGFyYW1zID0gc2V0T3B0aW9ucyhvcHRpb25zLCBkZWZhdWx0cyk7XHJcblxyXG4gICAgLy8gTW92ZSBiYWNrIHRvIGJib3guY29weSgpXHJcbiAgICBsZXQgcm9vdCA9IGJib3g7XHJcbiAgICByb290LmRlcHRoID0gMDtcclxuICAgIGxldCBmcm9udGllciA9ICBbcm9vdF07XHJcbiAgICAvLyBUaGlzIGlzIGEgd2F5IG9mIHJlZGlzdHJpYnV0aW5nIDIgPiBpbmZpbml0eSAoYWthIDEwMCkgd2hlcmUgdGhlIHVzZWFibGVcclxuICAgIC8vIHJhbmdlIHN0YXlzIHRvZ2V0aGVyLiBNb3N0IG9mIHRoZSBpbnRlcmVzdGluZyBiZWhhdmlvciBpcyBuZWFyIDIgLSA0XHJcbiAgICBjb25zdCBzcGxpdERlbm9tID0gZXhwKHBhcmFtcy5zcGxpdFJhbmdlLCA3LCBmYWxzZSkubWFwKDAsIDEsIDIsIDEwMCk7XHJcblxyXG4gICAgd2hpbGUgKGZyb250aWVyLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBsZXQgbm9kZSA9IGZyb250aWVyLnBvcCgpO1xyXG5cclxuICAgICAgICBpZiAobm9kZSAhPT0gcm9vdCAmJiBSYW5kLmNoYW5jZShwYXJhbXMuZHJvcG91dFJhdGUpKSB7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbGV0IGxlZnROb2RlO1xyXG4gICAgICAgIGxldCByaWdodE5vZGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGlzV2lkZSA9IG5vZGUud2lkdGggLyBub2RlLmhlaWdodCA+IDEuMjU7XHJcbiAgICAgICAgY29uc3QgaXNUYWxsID0gbm9kZS5oZWlnaHQgLyBub2RlLndpZHRoID4gMS4yNTtcclxuICAgICAgICBjb25zdCBzcGxpdFJhbmQgPSAhaXNXaWRlICYmICFpc1RhbGw7XHJcblxyXG4gICAgICAgIGxldCBzcGxpdFZlcnRpY2FsO1xyXG4gICAgICAgIGlmIChzcGxpdFJhbmQpIHtcclxuICAgICAgICAgICAgc3BsaXRWZXJ0aWNhbCA9IFJhbmQuY2hhbmNlKDAuNSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc3BsaXRWZXJ0aWNhbCA9IGlzVGFsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChzcGxpdFZlcnRpY2FsKSB7IC8vIFNwbGl0IHZlcnRpY2FsXHJcblxyXG4gICAgICAgICAgICBjb25zdCBzcGxpdFkgPSBub2RlLmhlaWdodCAvIDIgK1xyXG4gICAgICAgICAgICAgICAgUmFuZC5yYW5kUmFuZ2UoLW5vZGUuaGVpZ2h0IC8gc3BsaXREZW5vbSwgbm9kZS5oZWlnaHQgLyBzcGxpdERlbm9tKTtcclxuXHJcbiAgICAgICAgICAgIGxlZnROb2RlID0gbmV3IFJlY3RhbmdsZShuZXcgVmVjdG9yKG5vZGUueCwgbm9kZS55KSxcclxuICAgICAgICAgICAgICAgIG5vZGUud2lkdGgsIHNwbGl0WSk7XHJcbiAgICAgICAgICAgIHJpZ2h0Tm9kZSA9IG5ldyBSZWN0YW5nbGUobmV3IFZlY3Rvcihub2RlLngsIG5vZGUueSArIHNwbGl0WSksXHJcbiAgICAgICAgICAgICAgICBub2RlLndpZHRoLCBub2RlLmhlaWdodCAtIHNwbGl0WSk7XHJcblxyXG4gICAgICAgIH0gZWxzZSB7IC8vIFNwbGl0IEhvcml6b250YWxcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHNwbGl0WCA9IG5vZGUud2lkdGggLyAyICtcclxuICAgICAgICAgICAgICAgIFJhbmQucmFuZFJhbmdlKC1ub2RlLndpZHRoIC8gc3BsaXREZW5vbSwgbm9kZS53aWR0aCAvIHNwbGl0RGVub20pO1xyXG5cclxuICAgICAgICAgICAgbGVmdE5vZGUgPSBuZXcgUmVjdGFuZ2xlKG5ldyBWZWN0b3Iobm9kZS54LCBub2RlLnkpLFxyXG4gICAgICAgICAgICAgICAgc3BsaXRYLCBub2RlLmhlaWdodCk7XHJcbiAgICAgICAgICAgIHJpZ2h0Tm9kZSA9IG5ldyBSZWN0YW5nbGUobmV3IFZlY3Rvcihub2RlLnggKyBzcGxpdFgsIG5vZGUueSksXHJcbiAgICAgICAgICAgICAgICBub2RlLndpZHRoIC0gc3BsaXRYLCBub2RlLmhlaWdodCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBsZWZ0Tm9kZS5kZXB0aCA9IG5vZGUuZGVwdGggKyAxO1xyXG4gICAgICAgIHJpZ2h0Tm9kZS5kZXB0aCA9IG5vZGUuZGVwdGggKyAxO1xyXG5cclxuICAgICAgICBub2RlLmxlZnROb2RlID0gbGVmdE5vZGU7XHJcbiAgICAgICAgbm9kZS5yaWdodE5vZGUgPSByaWdodE5vZGU7XHJcblxyXG4gICAgICAgIGlmIChub2RlLmRlcHRoICE9PSBwYXJhbXMuZGVwdGgpIHtcclxuICAgICAgICAgICAgZnJvbnRpZXIucHVzaChsZWZ0Tm9kZSk7XHJcbiAgICAgICAgICAgIGZyb250aWVyLnB1c2gocmlnaHROb2RlKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJvb3Q7XHJcbn0iLCJpbXBvcnQgRGlhZ3JhbSBmcm9tIFwiLi4vZ3JhcGgvRGlhZ3JhbVwiO1xyXG5pbXBvcnQgeyBwb2lzc29uLCBqaXR0ZXJlZEdyaWQgfSBmcm9tIFwiLi4vdXRpbGl0aWVzL1BvaW50RGlzdHJpYnV0aW9uXCI7XHJcblxyXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiByZWN1cnNpdmVWb3Jvbm9pKGJib3gsIGRlcHRoLCBkZW5zaXR5KSB7XHJcbiAgICBcInVzZSBzdHJpY3RcIjtcclxuXHJcbiAgICBsZXQgZGlhZ3JhbSA9IG5ldyBEaWFncmFtKHBvaXNzb24oYmJveCwgZGVuc2l0eSksIGJib3gpO1xyXG5cclxuICAgIGZvciAobGV0IHRpbGUgb2YgZGlhZ3JhbS50aWxlcykge1xyXG4gICAgICAgIHRpbGUuZGVwdGggPSAwO1xyXG5cclxuICAgICAgICBnZW5lcmF0ZUluUG9seWdvbih0aWxlLCAwLCBkZW5zaXR5IC8gNik7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGRpYWdyYW07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdlbmVyYXRlSW5Qb2x5Z29uKHBvbHksIGN1cnJlbnREZXB0aCwgZGVuc2l0eSkge1xyXG4gICAgXCJ1c2Ugc3RyaWN0XCI7XHJcblxyXG4gICAgbGV0IHN1YmRpYWdyYW0gPSBuZXcgRGlhZ3JhbShwb2lzc29uKHBvbHkuYmJveCgpLCBkZW5zaXR5KSwgcG9seS5iYm94KCkpO1xyXG4gICAgbGV0IHN1YlRpbGVzID0gY2xpcFRvUmVnaW9uKHN1YmRpYWdyYW0sIHBvbHkpO1xyXG4gICAgLy8gbGV0IHN1YlRpbGVzID0gc3ViZGlhZ3JhbS50aWxlcztcclxuICAgIHN1YlRpbGVzLmZvckVhY2godGlsZSA9PiB0aWxlLmRlcHRoID0gY3VycmVudERlcHRoICsgMSk7XHJcbiAgICBwb2x5LmNoaWxkcmVuID0gc3ViVGlsZXM7XHJcbn1cclxuXHJcbi8vIFJldHVybiBqdXN0IHRoZSB0aWxlcyB0aGF0IHJlbWFpbiBpbiB0aGF0IHJlZ2lvblxyXG5mdW5jdGlvbiBjbGlwVG9SZWdpb24oZGlhZ3JhbSwgcG9seSkge1xyXG4gICAgXCJ1c2Ugc3RyaWN0XCI7XHJcblxyXG4gICAgbGV0IGludGVybmFsUG9seXMgPSBbXTtcclxuICAgIGxldCBjb250YWlucztcclxuICAgIGZvciAobGV0IHRpbGUgb2YgZGlhZ3JhbS50aWxlcykge1xyXG4gICAgICAgIC8vIGNvbnRhaW5zID0gdGlsZS5jb3JuZXJzLnJlZHVjZSgoaXNUcnVlLCBjb3JuZXIpID0+IHtcclxuICAgICAgICAvLyAgICAgY29uc29sZS5sb2coaXNUcnVlKTtcclxuICAgICAgICAvLyAgICAgcmV0dXJuIGlzVHJ1ZSB8fCBwb2x5LmNvbnRhaW5zKGNvcm5lcik7XHJcbiAgICAgICAgLy8gfSwgZmFsc2UpO1xyXG5cclxuICAgICAgICBjb250YWlucyA9IHBvbHkuY29udGFpbnModGlsZS5jZW50ZXIpO1xyXG5cclxuICAgICAgICBpZiAoY29udGFpbnMpIHtcclxuICAgICAgICAgICAgaW50ZXJuYWxQb2x5cy5wdXNoKHRpbGUpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gaW50ZXJuYWxQb2x5cztcclxufSIsImNsYXNzIExpbmUgIHtcbiAgICAvKipcbiAgICAgKiBAY2xhc3MgTGluZVxuICAgICAqIFxuICAgICAqIEEgc2ltcGxlIGxpbmUgb2JqZWN0IHRoYXQgaXMgYW4gYXJyYXkgb2YgdHdvIHZlY3RvciBwb2ludHMuXG4gICAgICogXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IHAxXG4gICAgICogQHByb3BlcnR5IHt2ZWN0b3J9IHAyXG4gICAgICogXG4gICAgICogQHN1bW1hcnkgQ3JlYXRlcyBhbiBpbnN0YW5jZSBvZiBQb2x5Z29uLlxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBwMSBUaGUgZmlyc3QgcG9pbnRcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gcDIgVGhlIHNlY29uZCBwb2ludFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHAxLCBwMikge1xuICAgICAgICB0aGlzLnAxID0gcDE7XG4gICAgICAgIHRoaXMucDIgPSBwMjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZXRlcm1pbmUgdGhlIG9yaWVudGF0aW9uIG9mIHRoZSB0aHJlZSBpbnB1dCB2ZWN0b3JzLiBUaGUgb3V0cHV0IHdpbGwgYmVcbiAgICAgKiBvbmUgb2YgdGhlIGZvbGxvd2luZzpcbiAgICAgKiBjb3VudGVyY2xvY2t3aXNlLCBjbG9ja3dpc2UsIG9yIGNvbGxpbmVhclxuICAgICAqIFxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MSBUaGUgZmlyc3QgdmVjdG9yXG4gICAgICogQHBhcmFtIHtWZWNvdHJ9IHYyIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYzIFRoZSB0aGlyZCB2ZWN0b3JcbiAgICAgKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBvcmllbnRhdGlvbiBvZiB0aGUgdGhyZWUgcG9pbnRzXG4gICAgICogIFwiY291bnRlcmNsb2Nrd2lzZVwiLCBcImNsb2Nrd2lzZVwiLCBcImNvbGxpbmVhclwiIFxuICAgICAqIEBtZW1iZXJvZiBMaW5lXG4gICAgICogQHNlZSB7QGxpbmsgaHR0cDovL3d3dy5nZWVrc2ZvcmdlZWtzLm9yZy9jaGVjay1pZi10d28tZ2l2ZW4tbGluZS1zZWdtZW50cy1pbnRlcnNlY3QvfVxuICAgICAqL1xuICAgIHN0YXRpYyBfb3JpZW50YXRpb24odjEsIHYyLCB2Mykge1xuICAgICAgICBjb25zdCB2YWwgPSAodjIueSAtIHYxLnkpICogKHYzLnggLSB2Mi54KSAtXG4gICAgICAgICAgICAodjIueCAtIHYxLngpICogKHYzLnkgLSB2Mi55KTtcblxuICAgICAgICBpZiAodmFsID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gXCJDb2xsaW5lYXJcIlxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB2YWwgPiAwID8gXCJjbG9ja3dpc2VcIiA6IFwiY291bnRlcmNsb2Nrd2lzZVwiO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByaXZhdGUgaGVscGVyIGZ1bmN0aW9uIHRvIGludGVyc2VjdHMgZnVuY3Rpb24uXG4gICAgICogXG4gICAgICogR2l2ZW4gdGhyZWUgY29saW5lYXIgcG9pbnRzIHRoaXMgZnVuY3Rpb24gY2hlY2tzIGlmIHYyIGlzIG9uIHRoZSBsaW5lIHNlZ21lbnRcbiAgICAgKiB2MS12My5cbiAgICAgKiBcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdjEgVGhlIGZpcnN0IHBvaW50IGluIHRoZSBsaW5lIHNlZ21lbnRcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdjIgVGhlIHBvaW50IHRvIHRlc3QgaWYgaXQgaXMgaW4gdGhlIG1pZGRsZVxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MyBUaGUgc2Vjb25kIHBvaW50IGluIHRoZSBsaW5lIHNlZ21lbnRcbiAgICAgKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHYyIGxpZXMgb24gdGhlIHNlZ21lbnQgY3JlYXRlZCBieSB2MSAmIHYzXG4gICAgICogQG1lbWJlcm9mIExpbmVcbiAgICAgKi9cbiAgICBzdGF0aWMgX29uU2VnbWVudCh2MSwgdjIsIHYzKSB7XG4gICAgICAgIHJldHVybiB2Mi54IDw9IE1hdGgubWF4KHYxLngsIHYzLngpICYmIHYyLnggPj0gTWF0aC5taW4odjEueCwgdjMueCkgJiZcbiAgICAgICAgICAgIHYyLnkgPD0gTWF0aC5tYXgodjEueSwgdjMueSkgJiYgdjIueSA+PSBNYXRoLm1pbih2MS55LCB2My55KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERldGVybWluZSBpZiB0d28gbGluZSBzZWdtZW50cyBpbnRlcnNlY1xuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge0xpbmV9IGxpbmUxIFxuICAgICAqIEBwYXJhbSB7TGluZX0gbGluZTIgXG4gICAgICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgbGluZXMgaW50ZXJzZWN0XG4gICAgICogQG1lbWJlcm9mIExpbmVcbiAgICAgKiBAc2VlIHtAbGluayBodHRwOi8vd3d3LmdlZWtzZm9yZ2Vla3Mub3JnL2NoZWNrLWlmLXR3by1naXZlbi1saW5lLXNlZ21lbnRzLWludGVyc2VjdC99XG4gICAgICovXG4gICAgc3RhdGljIGludGVyc2VjdHMobGluZTEsIGxpbmUyKSB7XG4gICAgICAgIC8vIEZpbmQgdGhlIGZvdXIgb3JpZW50YXRpb25zIHRoYXQgYXJlIG5lZWRlZCBmb3IgZ2VuZXJhbCBhbmRcbiAgICAgICAgLy8gc3BlY2lhbCBjYXNlc1xuICAgICAgICBjb25zdCBvMSA9IExpbmUuX29yaWVudGF0aW9uKGxpbmUxLnAxLCBsaW5lMS5wMiwgbGluZTIucDEpO1xuICAgICAgICBjb25zdCBvMiA9IExpbmUuX29yaWVudGF0aW9uKGxpbmUxLnAxLCBsaW5lMS5wMiwgbGluZTIucDIpO1xuICAgICAgICBjb25zdCBvMyA9IExpbmUuX29yaWVudGF0aW9uKGxpbmUyLnAxLCBsaW5lMi5wMiwgbGluZTEucDEpO1xuICAgICAgICBjb25zdCBvNCA9IExpbmUuX29yaWVudGF0aW9uKGxpbmUyLnAxLCBsaW5lMi5wMiwgbGluZTEucDIpO1xuXG4gICAgICAgIC8vIEdlbmVyYWwgQ2FzZVxuICAgICAgICBpZiAobzEgIT0gbzIgJiYgbzMgIT0gbzQpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU3BlY2lhbCBDYXNlc1xuICAgICAgICAvLyBsaW5lMS54LCBsaW5lMS55IGFuZCBsaW5lMi54IGFyZSBjb2xpbmVhciBhbmRcbiAgICAgICAgLy8gbGluZTIueCBsaWVzIG9uIHNlZ21lbnQgbGluZTEueGxpbmUxLnlcbiAgICAgICAgaWYgKG8xID09IFwiQ29sbGluZWFyXCIgJiYgTGluZS5fb25TZWdtZW50KGxpbmUxLnAxLCBsaW5lMi5wMSwgbGluZTEucDIpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGxpbmUxLngsIGxpbmUxLnkgYW5kIGxpbmUyLnggYXJlIGNvbGluZWFyIGFuZFxuICAgICAgICAvLyBsaW5lMi55IGxpZXMgb24gc2VnbWVudCBsaW5lMS54bGluZTEueVxuICAgICAgICBpZiAobzIgPT0gXCJDb2xsaW5lYXJcIiAmJiBMaW5lLl9vblNlZ21lbnQobGluZTEucDEsIGxpbmUyLnAyLCBsaW5lMS5wMikpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gbGluZTIueCwgbGluZTIueSBhbmQgbGluZTEueCBhcmUgY29saW5lYXIgYW5kXG4gICAgICAgIC8vIGxpbmUxLnggbGllcyBvbiBzZWdtZW50IGxpbmUyLnhsaW5lMi55XG4gICAgICAgIGlmIChvMyA9PSBcIkNvbGxpbmVhclwiICYmIExpbmUuX29uU2VnbWVudChsaW5lMi5wMSwgbGluZTEucDEsIGxpbmUyLnAyKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBsaW5lMi54LCBsaW5lMi55IGFuZCBsaW5lMS55IGFyZSBjb2xpbmVhciBhbmRcbiAgICAgICAgLy8gbGluZTEueSBsaWVzIG9uIHNlZ21lbnQgbGluZTIueGxpbmUyLnlcbiAgICAgICAgaWYgKG80ID09IFwiQ29sbGluZWFyXCIgJiYgTGluZS5fb25TZWdtZW50KGxpbmUyLnAxLCBsaW5lMS5wMiwgbGluZTIucDIpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTsgLy8gRG9lc24ndCBmYWxsIGluIGFueSBvZiB0aGUgYWJvdmUgY2FzZXNcblxuICAgIH1cblxuICAgIGludGVyc2VjdHMobGluZTEsIGxpbmUyKSB7XG4gICAgICAgIHJldHVybiBMaW5lLmludGVyc2VjdHMobGluZTEsIGxpbmUyKTtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IExpbmU7IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi9WZWN0b3JcIjtcbmltcG9ydCBSZWN0YW5nbGUgZnJvbSBcIi4vUmVjdGFuZ2xlXCI7XG5cbmNsYXNzIFBvbHlnb24ge1xuICAgIC8qKlxuICAgICAqIEBjbGFzcyBQb2x5Z29uXG4gICAgICogXG4gICAgICogQ2xhc3MgdG8gc3RvcmUgcG9seWdvbiBpbmZvcm1hdGlvbiBpbiBhbiBhcnJheSBmb3JtYXQgdGhhdCBhbHNvIGdpdmVzIGl0XG4gICAgICogZXh0cmEgZnVuY3Rpb25hbGl0eSBvbiB0b3Agb2YgaXQuIFRoaXMgY2FuIGFsc28gc2VydmVyIGFzIGEgYmFzZSBjbGFzc1xuICAgICAqIGZvciBtb3JlIHNwZWNpZmljIGdlb21ldHJpYyBzaGFwZXMuIEF0IHRoZSBtb21lbnQgdGhpcyBjbGFzcyBhc3N1bWVzIG9ubHlcbiAgICAgKiBjb252ZXggcG9seWdvbnMgZm9yIHNpbXBsaWNpdHkuXG4gICAgICogXG4gICAgICogQHN1bW1hcnkgQ3JlYXRlcyBhbiBpbnN0YW5jZSBvZiBQb2x5Z29uLlxuICAgICAqIFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSBjZW50ZXIgVGhlIGNlbnRlciBvZiB0aGUgcG9seWdvbi4gSWYgbm90IG90aGVyd2lzZVxuICAgICAqICBzdGF0ZWQsIHRoZSBjZW50ZXIgZGVmYXVsdHMgdG8gdGhlIGNlbnRyaW9kLiBBbnkgdHJhbnNmb3JtYXRpb25zIG9uXG4gICAgICogIHRoZSBwb2x5Z29uIGFyZSBkb25lIGFib3V0IHRoZSBjZW50ZXIgb2YgdGhlIHBvbHlnb24uXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3JbXX0gY29ybmVycyBUaGUgY29ybmVyIHZlY3RvcnMgb2YgdGhlIHBvbHlnb25cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1ZlY3RvcltdfSBbY29ybmVycz1bXV0gVGhlIGNvcm5lciB2ZXJ0aWNpZXMgb2YgdGhlIHBvbHlnb25cbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gW2NlbnRlcj1hdmVyYWdlKHZlcnRpY2llcyldIFRoZSBjZW50ZXIgb2YgdGhlIHBvbHlnb24uXG4gICAgICogIElmIGEgdmFsdWUgaXMgbm90IHByb3ZpZGVkIHRoZSBkZWZhdWx0IHZhbHVlIGJlY29tZXMgdGhlIGNlbnRyb2lkIG9mXG4gICAgICogIHRoZSB2ZXJ0aWNpZXMuXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoY29ybmVycyA9IG51bGwsIGNlbnRlciA9IG51bGwpIHtcbiAgICAgICAgdGhpcy5jb3JuZXJzID0gY29ybmVycyA/IGNvcm5lcnMgOiBbXTtcbiAgICAgICAgdGhpcy5jZW50ZXIgPSBjZW50ZXIgPyBjZW50ZXIgOiB0aGlzLmNlbnRyb2lkKCk7XG4gICAgICAgIHRoaXMuX2Jib3ggPSBudWxsO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgY2VudHJvaWQgb2YgdGhlIHBvbHlnb24uIFRoaXMgaXMgdGhlIHZlY3RvciBhdmVyYWdlIG9mIGFsbCB0aGVcbiAgICAgKiBwb2ludHMgdGhhdCBtYWtlIHVwIHRoZSBwb2x5Z29uLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSBjZW50cm9pZCBvZiB0aGUgcG9seWdvblxuICAgICAqIFxuICAgICAqIEBtZW1iZXJPZiBQb2x5Z29uXG4gICAgICovXG4gICAgY2VudHJvaWQoKSB7XG4gICAgICAgIHJldHVybiBWZWN0b3IuYXZnKHRoaXMuY29ybmVycyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBib3VuZGluZyBib3ggb2YgdGhlIHBvbHlnb24uIFRoYXQgaXMgdGhlIHJlY3RhbmdsZSB0aGF0IHdpbGxcbiAgICAgKiBtaW5pbWFsbHkgZW5jbG9zZSB0aGUgcG9seWdvbi5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7UmVjdGFuZ2xlfSBUaGUgYm91bmRpbmcgYm94IG9mIHRoZSBwb2x5Z29uXG4gICAgICogQG1lbWJlcm9mIFBvbHlnb25cbiAgICAgKi9cbiAgICBiYm94KCkge1xuICAgICAgICBpZiAodGhpcy5fYmJveCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2Jib3g7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgbWluWCA9IEluZmluaXR5O1xuICAgICAgICBsZXQgbWF4WCA9IC1JbmZpbml0eTtcbiAgICAgICAgbGV0IG1pblkgPSBJbmZpbml0eTtcbiAgICAgICAgbGV0IG1heFkgPSAtSW5maW5pdHk7XG5cbiAgICAgICAgZm9yIChjb25zdCBjb3JuZXIgb2YgdGhpcy5jb3JuZXJzKSB7XG4gICAgICAgICAgICBtaW5YID0gTWF0aC5taW4oY29ybmVyLngsIG1pblgpO1xuICAgICAgICAgICAgbWF4WCA9IE1hdGgubWF4KGNvcm5lci54LCBtYXhYKTtcbiAgICAgICAgICAgIG1pblkgPSBNYXRoLm1pbihjb3JuZXIueSwgbWluWSk7XG4gICAgICAgICAgICBtYXhZID0gTWF0aC5tYXgoY29ybmVyLnksIG1heFkpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fYmJveCA9IG5ldyBSZWN0YW5nbGUobmV3IFZlY3RvcihtaW5YLCBtaW5ZKSwgbWF4WCAtIG1pblgsIG1heFkgLSBtaW5ZKTtcblxuICAgICAgICByZXR1cm4gdGhpcy5fYmJveDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHBvbHlnb24gaW5zZXQgb2YgdGhlIGN1cnJlbnQgcG9seWdvbiBieSB0aGUgaW5wdXQgYW1tb3VudFxuICAgICAqIFxuICAgICAqIEBwYXJhbSBhbW1vdW50XG4gICAgICogQHJldHVybnMge1BvbHlnb259IFRoZSBpbnNldCBvZiB0aGUgY3VycmVudCBwb2x5Z29uIGJ5XG4gICAgICogQG1lbWJlck9mIFBvbHlnb25cbiAgICAgKi9cbiAgICBpbnNldChhbW1vdW50KSB7XG4gICAgICAgIHJldHVybiBhbW1vdW50O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgd2hlaXRoZXIgb3Igbm90IHRoaXMgcG9seWdvbiBpcyBhIGNvbnZleCBwb2x5Z29uLiBJZiB0aGlzIGlzXG4gICAgICogbm90IHRydWUgdGhlbiB0aGUgcG9seWdvbiBpcyBjb252YWNlIG9yIG1vcmUgY29tcGxleC5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gSWYgdGhlIHBvbHlnb24gaXMgY29udmV4XG4gICAgICogQG1lbWJlck9mIFBvbHlnb25cbiAgICAgKi9cbiAgICBpc0NvbnZleCgpIHtcblxuICAgIH1cblxuICAgIHJvdGF0ZSgpIHtcblxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERldGVybWluZSBpZiB0aGUgcG9pbnQgaXMgY29udGFpbmVkIHdpdGhpbiB0aGUgcG9seWdvblxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2ZWN0b3JcbiAgICAgKiBcbiAgICAgKiBAc2VlIHtAbGluayBodHRwczovL2dpdGh1Yi5jb20vc3Vic3RhY2svcG9pbnQtaW4tcG9seWdvbi9ibG9iL21hc3Rlci9pbmRleC5qc31cbiAgICAgKiBAbWVtYmVyT2YgUG9seWdvblxuICAgICAqL1xuICAgIGNvbnRhaW5zKHZlY3Rvcikge1xuICAgICAgICBpZiAoIXRoaXMuYmJveCgpLmNvbnRhaW5zKHZlY3RvcikpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxlbiA9IHRoaXMuY29ybmVycy5sZW5ndGg7XG4gICAgICAgIGNvbnN0IHggPSB2ZWN0b3IueDtcbiAgICAgICAgY29uc3QgeSA9IHZlY3Rvci55O1xuICAgICAgICBsZXQgaW5zaWRlID0gZmFsc2U7XG4gICAgICAgIGZvciAobGV0IGkgPSAwLCBqID0gbGVuIC0gMTsgaSA8IGxlbjsgaiA9IGkrKykge1xuICAgICAgICAgICAgbGV0IHhpID0gdGhpcy5jb3JuZXJzW2ldLngsIHlpID0gdGhpcy5jb3JuZXJzW2ldLnk7XG4gICAgICAgICAgICBsZXQgeGogPSB0aGlzLmNvcm5lcnNbal0ueCwgeWogPSB0aGlzLmNvcm5lcnNbal0ueTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgbGV0IGludGVyc2VjdCA9ICgoeWkgPiB5KSAhPT0gKHlqID4geSkpICYmXG4gICAgICAgICAgICAgKHggPCAoeGogLSB4aSkgKiAoeSAtIHlpKSAvICh5aiAtIHlpKSArIHhpKTtcbiAgICAgICAgICAgIGlmIChpbnRlcnNlY3QpICB7XG4gICAgICAgICAgICAgICAgaW5zaWRlID0gIWluc2lkZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGluc2lkZTtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFBvbHlnb247IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi9WZWN0b3JcIjtcblxuY2xhc3MgUmVjdGFuZ2xlIHtcbiAgICAvKiogXG4gICAgICogQGNsYXNzIFJlY3RhbmdsZVxuICAgICAqIEBleHRlbmRzIFBvbHlnb25cbiAgICAgKiBcbiAgICAgKiBDbGFzcyB0byBzdG9yZSBhcnJheSBpbmZvcm1hdGlvbiBhYm91dCBhIHJlY3RhbmdsZVxuICAgICAqIFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSBwb3NpdGlvblxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB4XG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IHlcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0gd2lkdGhcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0gaGVpZ2h0XG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHBvc2l0aW9uXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHdpZHRoXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IGhlaWdodFxuICAgICAqL1xuXG4gICAgY29uc3RydWN0b3IocG9zaXRpb24sIHdpZHRoLCBoZWlnaHQpIHtcblxuICAgICAgICB0aGlzLnBvc2l0aW9uID0gcG9zaXRpb247XG4gICAgICAgIHRoaXMueCA9IHBvc2l0aW9uLng7XG4gICAgICAgIHRoaXMueSA9IHBvc2l0aW9uLnk7XG4gICAgICAgIHRoaXMuYnIgPSBwb3NpdGlvbjtcbiAgICAgICAgdGhpcy5ibCA9IFZlY3Rvci5hZGQocG9zaXRpb24sIG5ldyBWZWN0b3Iod2lkdGgsIDApKTtcbiAgICAgICAgdGhpcy50ciA9IFZlY3Rvci5hZGQocG9zaXRpb24sIG5ldyBWZWN0b3Iod2lkdGgsIGhlaWdodCkpO1xuICAgICAgICB0aGlzLnRsID0gVmVjdG9yLmFkZChwb3NpdGlvbiwgbmV3IFZlY3RvcigwLCBoZWlnaHQpKTtcbiAgICAgICAgdGhpcy53aWR0aCA9IHdpZHRoO1xuICAgICAgICB0aGlzLmhlaWdodCA9IGhlaWdodDtcbiAgICAgICAgdGhpcy5hcmVhID0gd2lkdGggKiBoZWlnaHQ7XG4gICAgfVxuXG4gICAgY29weSgpIHtcbiAgICAgICAgcmV0dXJuIFJlY3RhbmdsZS5jb3B5KHRoaXMpO1xuICAgIH1cblxuICAgIHN0YXRpYyBjb3B5KCkge1xuICAgICAgICByZXR1cm4gbmV3IFJlY3RhbmdsZSh0aGlzLnBvc2l0aW9uLCB0aGlzLndpZHRoLCB0aGlzLmhlaWdodCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGV0ZXJtaW5lIGlmIHRoZSB0d28gcmVjdGFuZ2xlcyBhcmUgaW50ZXJzZWN0aW5nLCBpZiB0aGUgc2VnbWVudHMgb3ZlcmxhcFxuICAgICAqIGVhY2hvdGhlci5cbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHthbnl9IHJlY3QxIFRoZSBmaXJzdCByZWN0YW5nbGVcbiAgICAgKiBAcGFyYW0ge2FueX0gcmVjdDIgVGhlIHNlY29uZCByZWN0YW5nbGVcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgdHdvIHJlY3RhbmdsZXMgaW50ZXJzZWN0XG4gICAgICogQG1lbWJlcm9mIFJlY3RhbmdsZVxuICAgICAqL1xuICAgIHN0YXRpYyBpbnRlcnNlY3RzKHJlY3QxLCByZWN0Mikge1xuICAgICAgICByZXR1cm4gcmVjdDEueCA8PSByZWN0Mi54ICsgcmVjdDIud2lkdGggJiZcbiAgICAgICAgICAgIHJlY3QyLnggPD0gcmVjdDEueCArIHJlY3QxLndpZHRoICYmXG4gICAgICAgICAgICByZWN0MS55IDw9IHJlY3QyLnkgKyByZWN0Mi5oZWlnaHQgJiZcbiAgICAgICAgICAgIHJlY3QyLnkgPD0gcmVjdDEueSArIHJlY3QxLmhlaWdodDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZXRlcm1pbmUgaWYgdGhpcyByZWN0YW5nbGUgaXMgaW50ZXJzZWN0aW5nIHRoZSBvdGhlciByZWN0YW5nbGUuXG4gICAgICogRGV0ZXJtaW5lcyBpZiB0aGUgcmVjdGFuZ2xlcyBzZWdtZW50cyBvdmVybGFwIGVhY2hvdGhlci5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gb3RoZXIgVGhlIG90aGVyIHJlY3RhbmdsZVxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSByZWN0YW5nbGVzIGFyZSBpbnRlcnNlY3RpbmdcbiAgICAgKiBAbWVtYmVyb2YgUmVjdGFuZ2xlXG4gICAgICovXG4gICAgaW50ZXJzZWN0cyhvdGhlcikge1xuICAgICAgICByZXR1cm4gUmVjdGFuZ2xlLmludGVyc2VjdHModGhpcywgb3RoZXIpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERldGVybWluZSBpZiB0d28gcmVjdGFuZ2xlcyBjb2xsaWRlIHdpdGggZWFjaG90aGVyLiBUaGlzIGlzIHRydWUgd2hlbiB0d29cbiAgICAgKiByZWN0YW5nbGVzIGludGVyc2VjdCBlYWNob3RoZXIgb3Igb25lIG9mIHRoZSByZWN0YW5nbGVzIGlzIGNvbnRhaW5lZFxuICAgICAqIHdpdGluIGFub3RoZXIgcmVjdGFuZ2xlLlxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gcmVjdDEgVGhlIGZpcnN0IHJlY3RhbmdsZVxuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSByZWN0MiBUaGUgc2Vjb25kIHJlY3RhbmdsZVxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSB0d28gcmVjdGFuZ2xlcyBjb2xsaWRlIHdpdGggZWFjaG90aGVyXG4gICAgICogQG1lbWJlcm9mIFJlY3RhbmdsZVxuICAgICAqL1xuICAgIHN0YXRpYyBjb2xsaWRlcyhyZWN0MSwgcmVjdDIpIHtcbiAgICAgICAgcmV0dXJuIHJlY3QxLnggPCByZWN0Mi54ICsgcmVjdDIud2lkdGggJiZcbiAgICAgICAgICAgIHJlY3QxLnggKyByZWN0MS53aWR0aCA+IHJlY3QyLnggJiZcbiAgICAgICAgICAgIHJlY3QxLnkgPCByZWN0Mi55ICsgcmVjdDIuaGVpZ2h0ICYmXG4gICAgICAgICAgICByZWN0MS5oZWlnaHQgKyByZWN0MS55ID4gcmVjdDIueVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERldGVybWluZSBpZiB0aGlzIHJlY3RhbmdsZSBjb2xsaWRlcyB3aXRoIGFub3RoZXIgcmVjdGFuZ2xlLiBUaGlzIGlzIHRydWVcbiAgICAgKiB3aGVuIHR3byByZWN0YW5nbGVzIGludGVyc2VjdCBlYWNob3RoZXIgb3Igb25lIG9mIHRoZSByZWN0YW5nbGVzIGlzIFxuICAgICAqIGNvbnRhaW5lZCB3aXRpbiBhbm90aGVyIHJlY3RhbmdsZS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gb3RoZXIgVGhlIG90aGVyIHJlY3RhbmdsZVxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSB0d28gcmVjdGFuZ2xlcyBjb2xsaWRlIHdpdGggZWFjaG90aGVyXG4gICAgICogQG1lbWJlcm9mIFJlY3RhbmdsZVxuICAgICAqL1xuICAgIGNvbGxpZGVzKG90aGVyKSB7XG4gICAgICAgIHJldHVybiBSZWN0YW5nbGUuY29sbGlkZXModGhpcywgb3RoZXIpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERldGVybWluZSBpZiBhIHBvaW50IGlzIGNvbnRhaW5lZCB3aXRoaW4gdGhlIHJlY3RhbmdsZS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdmVjdG9yIFRoZSBwb2ludCB0byBiZSB0ZXN0ZWRcbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcG9pbnQgaXMgY29udGFpbmVkIHdpdGhpbiB0aGUgcmVjdGFuZ2xlXG4gICAgICogQG1lbWJlcm9mIFJlY3RhbmdsZVxuICAgICAqL1xuICAgIGNvbnRhaW5zKHZlY3Rvcikge1xuICAgICAgICByZXR1cm4gdmVjdG9yLnggPiB0aGlzLnBvc2l0aW9uLnggJiZcbiAgICAgICAgICAgIHZlY3Rvci54IDwgdGhpcy5wb3NpdGlvbi54ICsgdGhpcy53aWR0aCAmJlxuICAgICAgICAgICAgdmVjdG9yLnkgPiB0aGlzLnBvc2l0aW9uLnkgJiZcbiAgICAgICAgICAgIHZlY3Rvci55IDwgdGhpcy5wb3NpdGlvbi55ICsgdGhpcy5oZWlnaHQ7XG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBSZWN0YW5nbGU7IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi9WZWN0b3JcIjtcbmltcG9ydCBQb2x5Z29uIGZyb20gXCIuL1BvbHlnb25cIjtcblxuY2xhc3MgVHJpYW5nbGUgZXh0ZW5kcyBQb2x5Z29uIHtcbiAgICAvKiogXG4gICAgICogQGNsYXNzIFRyaWFuZ2xlXG4gICAgICogQGV4dGVuZHMgUG9seWdvblxuICAgICAqIFxuICAgICAqIENsYXNzIHRvIHN0b3JlIGFycmF5IGluZm9ybWF0aW9uIGFib3V0IGEgcmVjdGFuZ2xlXG4gICAgICogXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IHZlcnRpY2llcyBUaGUgdGhyZWUgdmVydGljaWVzXG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYxIFRoZSBmaXJzdCBwb3NpdGlvblxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MiBUaGUgc2Vjb25kIHBvc2l0aW9uXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYzIFRoZSB0aGlyZCBwb3NpdGlvblxuICAgICAqL1xuXG4gICAgY29uc3RydWN0b3IodjEsIHYyLCB2Mykge1xuICAgICAgICB2YXIgdmVydGljaWVzID0gW3YxLCB2MiwgdjNdO1xuICAgICAgICBzdXBlcih2ZXJ0aWNpZXMpO1xuICAgICAgICB0aGlzLnYxID0gdjE7XG4gICAgICAgIHRoaXMudjIgPSB2MjtcbiAgICAgICAgdGhpcy52MyA9IHYzO1xuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgVHJpYW5nbGU7IiwiY2xhc3MgVmVjdG9yIHtcbiAgICAvKipcbiAgICAgKiBAY2xhc3MgVmVjdG9yXG4gICAgICpcbiAgICAgKiBUaGlzIGlzIGEgYmFzaWMgdmVjdG9yIGNsYXNzIHRoYXQgaXMgdXNlZCBmb3IgZ2VvbWV0cnksIHBvc2l0aW9uIGluZm9yYW10aW9uLFxuICAgICAqIG1vdmVtZW50IGluZm9tYXRpb24sIGFuZCBtb3JlIGNvbXBsZXggc3RydWN0dXJlcy5cbiAgICAgKiBUaGUgdmVjdG9yIGNsYXNzIGZvbGxvd3MgYSBpbW11dGFibGUgcGFyYWRpZ20gd2hlcmUgY2hhbmdlcyBhcmUgbm90IG1hZGUgdG8gdGhlXG4gICAgICogdmVjdG9ycyB0aGVtc2VsdmVzLiBBbnkgY2hhbmdlIHRvIGEgdmVjdG9yIGlzIHJldHVybmVkIGFzIGEgbmV3IHZlY3RvciB0aGF0XG4gICAgICogbXVzdCBiZSBjYXB0dXJlZC5cbiAgICAgKlxuICAgICAqIEBkZXNjcmlwdGlvbiBUaGlzIHZlY3RvciBjbGFzcyB3YXMgY29uc3RydWN0ZWQgc28gdGhhdCBpdCBjYW4gbWlycm9yIHR3byB0eXBlcyBvZiBjb21tb25cbiAgICAgKiBwb2ludC92ZWN0b3IgdHlwZSBvYmplY3RzLiBUaGlzIGlzIGhhdmluZyBvYmplY3QgcHJvcGVydGllcyBzdG9yZWQgYXMgb2JqZWN0XG4gICAgICogcHJvcGVydGllcyAoZWcuIHZlY3Rvci54LCB2ZWN0b3IueSkgb3IgYXMgbGlzdCBwcm9wZXJ0aWVzLCBbeCwgeV0gd2hpY2ggY2FuXG4gICAgICogYmUgYWNjZXNzZWQgYnkgdmVjdG9yWzBdLCBvciB2ZWN0b3JbMV0uXG4gICAgICpcbiAgICAgKiBAc3VtbWFyeSBDcmVhdGUgYSAyRCBWZWN0b3Igb2JqZWN0XG4gICAgICpcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0geCBUaGUgeCB2ZWN0b3IgY29tcG9uZW50XG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IHkgVGhlIHkgdmVjdG9yIGNvbXBvbmVudFxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSAwIFRoZSB4IHZlY3RvciBjb21wb25lbnRcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0gMSBUaGUgeSB2ZWN0b3IgY29tcG9uZW50XG4gICAgICpcbiAgICAgKiBAcGFyYW0ge251bWJlcnxWZWN0b3J9IHggVGhlIHggY29tcG9uZW50IG9yIGFub3RoZXIgdmVjdG9yXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IFt5XSBUaGUgeSBjb21wb25lbnRcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcih4LCB5KSB7XG4gICAgICAgIGlmICh4IGluc3RhbmNlb2YgVmVjdG9yIHx8ICh4LnggJiYgeC55ICYmICF5KSkge1xuICAgICAgICAgICAgdGhpcy5fc2V0KHgueCwgeC55KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX3NldCh4LCB5KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vLS0tLSBBbHRlcm5hdGUgUG9sYXIgQ29uc3RydWN0b3IgLS0tLVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlIGEgdmVjdG9yIGZyb20gcG9sYXIgY29vcmRpbmF0ZXNcbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gciBUaGUgcmFkaXVzIG9mIHRoZSB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gdGhldGEgVGhlIGFuZ2xlIG9mIHRoZSB2ZWN0b3IgaW4gcmFkaWFucy5cbiAgICAgKiAgU2hvdWxkIGJlIGJldHdlZW4gMCBhbmQgMipQSVxuICAgICAqIEByZXR1cm5zIFRoZSByZWN0YW5ndWxhciB2ZWN0b3IgcHJvZHVjZWQgZnJvbSB0aGUgcG9sYXIgY29vcmRpbmF0ZXNcbiAgICAgKlxuICAgICAqIEBtZW1iZXJPZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgUG9sYXIociwgdGhldGEpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IociAqIE1hdGguY29zKHRoZXRhKSwgciAqIE1hdGguc2luKHRoZXRhKSk7XG4gICAgfVxuXG4gICAgLy8tLS0tIEhlbHBlciBGdW5jdGlvbnMgLS0tLVxuXG4gICAgLyoqXG4gICAgICogSW50ZXJuYWwgSGVscGVyIEZ1bmN0aW9uIGZvciBzZXR0aW5nIHZhcmlhYmxlIHByb3BlcnRpZXNcbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHggVGhlIHggY29tcG9uZW50XG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHkgVGhlIHkgY29tcG9uZW50XG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIF9zZXQoeCwgeSkge1xuICAgICAgICB0aGlzLl9fcHJvdG9fX1swXSA9IHg7XG4gICAgICAgIHRoaXMuX19wcm90b19fWzFdID0geTtcbiAgICAgICAgdGhpcy54ID0geDtcbiAgICAgICAgdGhpcy55ID0geTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHZlY3RvciBrZXk6U3ltYm9sIHJlcHJlc2VudGF0aW9uIFt4LCB5XVxuICAgICAqIEN1cnJlbnRseSBoYXMgdGhlIHNhbWUgYmVoYXZpb3IgYXMgbGlzdCgpXG4gICAgICogQHJldHVybnMge1N5bWJvbH0gVGhlIHZlY3RvciBrZXkgZWxlbWVudFxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBrZXkoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmxpc3QoKTtcbiAgICAgICAgLy8gcmV0dXJuIFN5bWJvbCh0aGlzLmxpc3QoKSk7IC8vIE5vdCBjdXJyZW50bHkgd29ya2luZyBhcyBhIGtleSBzeW1ib2xcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHZlY3RvciBpbiBsaXN0IGZvcm0gYXMgW3gsIHldXG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyW119IExpc3QgcmVwcmVzZW50YXRpb24gb2YgdGhlIHZlY3RvciBvZiBsZW5ndGggMlxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBsaXN0KCkge1xuICAgICAgICByZXR1cm4gW3RoaXMueCwgdGhpcy55XTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSB2ZWN0b3IgYXMgYSBzdHJpbmcgb2YgKHgsIHkpXG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgc3RyaW5nIHJlcHJlc2VudGF0aW9uIG9mIGEgdmVjdG9yIGluICh4LCB5KSBmb3JtXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gYCgke3RoaXMueH0sICR7dGhpcy55fSlgO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIGNvcHkgb2YgdGhlIGlucHV0IHZlY3RvclxuICAgICAqXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYgdGhlIHZlY3RvciB0byBiZSBjb3BwaWVkXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIHZlY3RvciBjb3B5XG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIGNvcHkoKSB7XG4gICAgICAgIHJldHVybiBWZWN0b3IuY29weSh0aGlzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSBjb3B5IG9mIHRoZSBpbnB1dCB2ZWN0b3JcbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdiB0aGUgdmVjdG9yIHRvIGJlIGNvcHBpZWRcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgdmVjdG9yIGNvcHlcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIGNvcHkodikge1xuICAgICAgICByZXR1cm4gbmV3IFZlY3Rvcih2LngsIHYueSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0cnVlIGlmIHRoZSB0d28gdmVjdG9yIHBvc2l0aW9ucyBhcmUgZXF1YWxcbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdjEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MiBUaGUgc2Vjb25kIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSB2ZWN0b3IgcG9zaXRpb25zIGFyZSBlcXVhbFxuICAgICAqIEBtZW1iZXJPZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZXF1YWxzKHYxLCB2Mikge1xuICAgICAgICByZXR1cm4gdjEueCA9PT0gdjIueCAmJiB2MS55ID09PSB2Mi55O1xuICAgIH1cblxuICAgIC8vLS0tLSBCYXNpYyBNYXRoIEZ1bmN0aW9ucyAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBBZGQgdHdvIHZlY3RvcnMgZWxlbWVudCB3aXNlXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIHZlY3RvciByZXN1bHQgb2YgYWRkaW5nIHRoZSB0d28gdmVjdG9yc1xuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgYWRkKGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoYS54ICsgYi54LCBhLnkgKyBiLnkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEFkZCB0aGlzIHZlY3RvciB3aXRoIGFub3RoZXIgdmVjdG9yIGVsZW1lbnQgd2lzZVxuICAgICAqXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IG90aGVyIFRoZSBvdGhlciB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgdmVjdG9yIHJlc3VsdCBvZiBhZGRpbmcgdGhlIHR3byB2ZWN0b3JzXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIGFkZChvdGhlcikge1xuICAgICAgICByZXR1cm4gVmVjdG9yLmFkZCh0aGlzLCBvdGhlcik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU3VidHJhY3QgdHdvIHZlY3RvcnMgZWxlbWVudCB3aXNlXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgVmVjdG9yXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIHZlY3RvciByZXN1bHQgb2Ygc3VidHJhY3RpbmcgdGhlIHR3byB2ZWN0b3JzXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBzdWJ0cmFjdChhLCBiKSB7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKGEueCAtIGIueCwgYS55IC0gYi55KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTdWJ0cmFjdCB0aGlzIHZlY3RvciB3aXRoIGFub3RoZXIgdmVjdG9yIGVsZW1lbnQgd2lzZVxuICAgICAqXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IG90aGVyIFRoZSBvdGhlciB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgdmVjdG9yIHJlc3VsdCBvZiBzdWJ0cmFjdGluZyB0aGUgdHdvIHZlY3RvcnNcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3VidHJhY3Qob3RoZXIpIHtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5zdWJ0cmFjdCh0aGlzLCBvdGhlcik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogTXVsdGlwbHkgdGhlIHZlY3RvciBieSBhIHNjYWxhciB2YWx1ZVxuICAgICAqXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHNjYWxhciBUaGUgbnVtYmVyIHRvIG11bHRpcGx5IHRoZSB2ZWN0b3IgYnlcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgcmVzdWx0IG9mIG11bHRpcGx5aW5nIHRoZSB2ZWN0b3IgYnkgYSBzY2FsYXJcbiAgICAgKiAgZWxlbWVudCB3aXNlXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIG11bHRpcGx5KHNjYWxhcikge1xuICAgICAgICByZXR1cm4gbmV3IFZlY3Rvcih0aGlzLnggKiBzY2FsYXIsIHRoaXMueSAqIHNjYWxhcik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGl2aWRlIHRoZSB2ZWN0b3IgYnkgYSBzY2FsYXIgdmFsdWVcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBzY2FsYXJcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgcmVzdWx0IG9mIG11bHRpcGx5aW5nIHRoZSB2ZWN0b3IgYnkgYSBzY2FsYXJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgZGl2aWRlKHNjYWxhcikge1xuICAgICAgICByZXR1cm4gbmV3IFZlY3Rvcih0aGlzLnggLyBzY2FsYXIsIHRoaXMueSAvIHNjYWxhcik7XG4gICAgfVxuXG4gICAgLy8tLS0tIEFkdmFuY2VkIFZlY3RvciBGdW5jdGlvbnMgLS0tLVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBtYWduaXR1ZGUgb2YgdGhlIHZlY3RvclxuICAgICAqXG4gICAgICogQHJldHVybnMge251bWJlcn0gVGhlIG1hZ25pdHVyZSBvZiB0aGUgdmVjdG9yXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIG1hZ25pdHVkZSgpIHtcbiAgICAgICAgcmV0dXJuIE1hdGguc3FydCh0aGlzLnggKiB0aGlzLnggKyB0aGlzLnkgKiB0aGlzLnkpO1xuICAgIH1cblxuICAgIC8vIEdldCB0aGUgdW5pdCB2ZWN0b3JcbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIG5vcm1hbCB2ZWN0b3Igb2YgdGhlIGN1cnJlbnQgdmVjdG9yLlxuICAgICAqXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gQSB2ZWN0b3IgdGhhdCBpcyB0aGUgbm9ybWFsIGNvbXBlbmVudCBvZiB0aGUgdmVjdG9yXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIG5vcm1hbGl6ZSgpIHtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5kaXZpZGUodGhpcy5tYWduaXR1ZGUoKSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBnZXQgdGhlIGN1cnJlbnQgdmVjdG9yIHJvdGF0ZWQgYnkgYSBjZXJ0YWluIGFtbW91bnRcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSByYWRpYW5zXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIHZlY3RvciB0aGF0IHJlc3VsdHMgZnJvbSByb3RhdGluZyB0aGUgY3VycmVudFxuICAgICAqICB2ZWN0b3IgYnkgYSBwYXJ0aWN1bGFyIGFtbW91bnRcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgcm90YXRlKHJhZGlhbnMpIHtcbiAgICAgICAgY29uc3QgYyA9IE1hdGguY29zKHJhZGlhbnMpO1xuICAgICAgICBjb25zdCBzID0gTWF0aC5zaW4ocmFkaWFucyk7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKGMgKiB0aGlzLnggLSBzICogdGhpcy55LCBzICogdGhpcy54ICsgYyAqIHRoaXMueSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBkb3QgcHJvZHVjdCBvZiB0d28gdmVjdG9yc1xuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBhIFRoZSBmaXJzdCB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFRoZSBkb3QgcHJvZHVjdCBvZiB0aGUgdHdvIHZlY3RvcnNcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIGRvdChhLCBiKSB7XG4gICAgICAgIHJldHVybiBhLnggKiBiLnggKyBhLnkgKiBiLnk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBhdmVyYWdlIGxvY2F0aW9uIGJldHdlZW4gc2V2ZXJhbCB2ZWN0b3JzXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1ZlY3RvcltdfSB2ZWN0b3JzIFRoZSBsaXN0IG9mIHZlY3RvcnMgdG8gYXZlcmFnZVxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgYXZnKHZlY3RvcnMpIHtcbiAgICAgICAgbGV0IGF2ZXJhZ2UgPSBWZWN0b3IuemVybygpO1xuXG4gICAgICAgIGZvciAoY29uc3QgdmVjdG9yIG9mIHZlY3RvcnMpIHtcbiAgICAgICAgICAgIGF2ZXJhZ2UgPSBWZWN0b3IuYWRkKGF2ZXJhZ2UsIHZlY3Rvcik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGF2ZXJhZ2UuZGl2aWRlKHZlY3RvcnMubGVuZ3RoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIGRvdCBwcm9kdWN0IG9mIHRoaXMgdmVjdG9yIGFuZCBhbm90aGVyIHZlY3RvclxuICAgICAqXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IG90aGVyIFRoZSBvdGhlciB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBUaGUgZG90IHByb2R1Y3Qgb2YgdGhpcyBhbmQgdGhlIG90aGVyIHZlY3RvclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBkb3Qob3RoZXIpIHtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5kb3QodGhpcywgb3RoZXIpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgY3Jvc3MgcHJvZHVjdCBvZiB0d28gdmVjdG9yc1xuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBhIFRoZSBmaXJzdCB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFRoZSBjcm9zcyBwcm9kdWN0IG9mIHRoZSB0d28gdmVjdG9yc1xuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgY3Jvc3MoYSwgYikge1xuICAgICAgICByZXR1cm4gYS54ICogYi55IC0gYS55ICogYi54O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgY3Jvc3MgcHJvZHVjdCBvZiB0aGlzIGFuZCB0aGUgb3RoZXIgdmVjdG9yXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gb3RoZXIgVGhlIG90aGVyIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFRoZSBjcm9zcyBwcm9kdWN0IG9mIHRoaXMgYW5kIHRoZSBvdGhlciB2ZWN0b3JcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgY3Jvc3Mob3RoZXIpIHtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5jcm9zcyh0aGlzLCBvdGhlcik7XG4gICAgfVxuXG4gICAgLy8tLS0tIFB1cmVseSBTdGF0aWMgVmVjdG9yIEZ1bmN0aW9ucyAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIG1pZHBvaW50IGJldHdlZW4gdHdvIHZlY3RvcnNcbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYSBUaGUgZmlyc3QgdmVjdG9yXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyBUaGUgbWlkcG9pbnQgb2YgdHdvIHZlY3RvcnNcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIG1pZHBvaW50KGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoKGEueCArIGIueCkgLyAyLCAoYS55ICsgYi55KSAvIDIpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgcHJvamVjdGlvbiBvZiB2ZWN0b3IgYSBvbnRvIHZlY3RvciBiXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHJldHVybnMgVGhlIHByb2plY3Rpb24gdmVjdG9yIG9mIGEgb250byBiXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqXG4gICAgICogQHRvZG8gQWRkIGFzc2VydGlvbiBmb3Igbm9uLXplcm8gbGVuZ3RoIGIgdmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIHByb2ooYSwgYikge1xuICAgICAgICByZXR1cm4gYi5tdWx0aXBseShWZWN0b3IuZG90KGEsIGIpIC8gTWF0aC5wb3coYi5tYWduaXR1ZGUoKSwgMikpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgYW5nbGUgYmV0d2VlbiB0d28gdmVjdG9yc1xuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBhIFRoZSBmcmlzdCB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvclxuICAgICAqIEByZXR1cm5zIFRoZSBhbmdsZSBiZXR3ZWVuIHZlY3RvciBhIGFuZCB2ZWN0b3IgYlxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgYW5nbGUoYSwgYikge1xuICAgICAgICByZXR1cm4gTWF0aC5hY29zKFZlY3Rvci5kb3QoYSwgYikgLyAoYS5tYWduaXR1ZGUoKSAqIGIubWFnbml0dWRlKCkpKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIGV1Y2xpZGVhbiBkaXN0YW5jZSBiZXR3ZWVuIHR3byB2ZWN0b3JzXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHJldHVybnMgVGhlIGV1Y2xpZGVhbiBkaXN0YW5jZSBiZXR3ZWVuIGEgYW5kIGJcbiAgICAgKiBAc2VlIHtAbGluayBkaXN0Mn1cbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIGRpc3RhbmNlKGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIE1hdGguc3FydChWZWN0b3IuZGlzdDIoYSwgYikpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgZXVjbGlkZWFuIGRpc3RuYWNlIHNxdWFyZWQgYmV0d2VlbiB0d28gdmVjdG9ycy5cbiAgICAgKiBUaGlzIGlzIHVzZWQgYXMgYSBoZWxwZXIgZm9yIHRoZSBkaXN0bmFjZSBmdW5jdGlvbiBidXQgY2FuIGJlIHVzZWRcbiAgICAgKiB0byBzYXZlIG9uIHNwZWVkIGJ5IG5vdCBkb2luZyB0aGUgc3F1YXJlIHJvb3Qgb3BlcmF0aW9uLlxuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBhIFRoZSBmaXJzdCB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvclxuICAgICAqIEByZXR1cm5zIFRoZSBldWNsaWRlYW4gZGlzdGFuY2Ugc3F1YXJlZCBiZXR3ZWVuIHZlY3RvciBhIGFuZCB2ZWN0b3IgYlxuICAgICAqIEBzZWUge0BsaW5rIGRpc3RuYWNlfVxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZGlzdDIoYSwgYikge1xuICAgICAgICBjb25zdCBkeCA9IGEueCAtIGIueDtcbiAgICAgICAgY29uc3QgZHkgPSBhLnkgLSBiLnk7XG4gICAgICAgIHJldHVybiBkeCAqIGR4ICsgZHkgKiBkeTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHNob3J0ZXN0IGRpc3RhbmNlIGJldHdlZW4gdGhlIHBvaW50IHAgYW5kIHRoZSBsaW5lXG4gICAgICogc2VnbWVudCB2IHRvIHcuXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHAgVGhlIHZlY3RvciBwb2ludFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2IFRoZSBmaXJzdCBsaW5lIHNlZ21lbnQgZW5kcG9pbnRcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdyBUaGUgc2Vjb25kIGxpbmUgc2VnbWVudCBlbmRwb2ludFxuICAgICAqIEByZXR1cm5zIFRoZSBzaG9ydGVzdCBldWNsaWRlYW4gZGlzdGFuY2UgYmV0d2VlbiBwb2ludFxuICAgICAqIEBzZWUge0BsaW5rIGRpc3RUb1NlZzJ9XG4gICAgICogQHNlZSB7QGxpbmsgaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy84NDkyMTEvc2hvcnRlc3QtZGlzdGFuY2UtYmV0d2Vlbi1hLXBvaW50LWFuZC1hLWxpbmUtc2VnbWVudH1cbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIGRpc3RUb1NlZyhwLCB2LCB3KSB7XG4gICAgICAgIHJldHVybiBNYXRoLnNxcnQoVmVjdG9yLmRpc3RUb1NlZzIocCwgdiwgdykpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgc2hvcnRlc3QgZGlzdGFuY2Ugc3F1YXJlZCBiZXR3ZWVuIHRoZSBwb2ludCBwIGFuZCB0aGUgbGluZVxuICAgICAqIHNlZ21lbnQgdiB0byB3LlxuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBwIFRoZSB2ZWN0b3IgcG9pbnRcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdiBUaGUgZmlyc3QgbGluZSBzZWdtZW50IGVuZHBvaW50XG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHcgVGhlIHNlY29uZCBsaW5lIHNlZ21lbnQgZW5kcG9pbnRcbiAgICAgKiBAcmV0dXJucyBUaGUgc2hvcnRlc3QgZXVjbGlkZWFuIGRpc3RhbmNlIHNxdWFyZWQgYmV0d2VlbiBwb2ludFxuICAgICAqIEBzZWUge0BsaW5rIGRpc3RUb1NlZ31cbiAgICAgKiBAc2VlIHtAbGluayBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzg0OTIxMS9zaG9ydGVzdC1kaXN0YW5jZS1iZXR3ZWVuLWEtcG9pbnQtYW5kLWEtbGluZS1zZWdtZW50fVxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZGlzdFRvU2VnU3F1YXJlZChwLCB2LCB3KSB7XG4gICAgICAgIGNvbnN0IGwgPSBWZWN0b3IuZGlzdDIodiwgdyk7XG4gICAgICAgIGlmIChsID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gVmVjdG9yLmRpc3QyKHAsIHYpO1xuICAgICAgICB9XG4gICAgICAgIGxldCB0ID0gKChwLnggLSB2LngpICogKHcueCAtIHYueCkgKyAocC55IC0gdi55KSAqICh3LnkgLSB2LnkpKSAvIGw7XG4gICAgICAgIHQgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCB0KSk7XG4gICAgICAgIHJldHVybiBWZWN0b3IuZGlzdDIoXG4gICAgICAgICAgICBwLFxuICAgICAgICAgICAgbmV3IFZlY3Rvcih2LnggKyB0ICogKHcueCAtIHYueCksIHYueSArIHQgKiAody55IC0gdi55KSlcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHR3byBub3JtYWwgdmVjdG9ycyB0aGF0IGFyZSBwZXJwZW5kaWN1bGFyIHRvIHRoZSBjdXJyZW50IHZlY3RvclxuICAgICAqXG4gICAgICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgdHdvIG5vcm1hbCB2ZWN0b3JzIHRoYXQgYXJlIHBlcnBlbmRpY3VsYXJcbiAgICAgKiAgdG8gdGhlIHZlY3Rvci4gVGhlIGZpcnN0IHZlY3RvciBpcyB0aGUgbm9ybWFsIHZlY3RvciB0aGF0IGlzICs5MCBkZWcgb3JcbiAgICAgKiAgK1BJLzIgcmFkLiBUaGUgc2Vjb25kIHZlY3RvciBpcyB0aGUgbm9yYW1sIHZlY3RvciB0aGF0IGlzIC05MCBkZWcgb3JcbiAgICAgKiAgLVBJLzIgcmFkLlxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBwZXJwZW5kaWN1bGFycygpIHtcbiAgICAgICAgY29uc3QgcGx1czkwID0gbmV3IFZlY3RvcigtdGhpcy55LCB0aGlzLngpLm5vcm1hbGl6ZSgpO1xuICAgICAgICBjb25zdCBtaW51czkwID0gbmV3IFZlY3Rvcih0aGlzLnksIC10aGlzLngpLm5vcm1hbGl6ZSgpO1xuICAgICAgICByZXR1cm4gW3BsdXM5MCwgbWludXM5MF07XG4gICAgfVxuXG4gICAgLy8tLS0tIFN0YW5kYXJkIFN0YXRpYyBWZWN0b3IgT2JqZWN0cyAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSB2ZWN0b3Igb2Ygbm8gbWFnbml0dWRlIGFuZCBubyBkaXJlY3Rpb25cbiAgICAgKlxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAZnVuY3Rpb25cbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBWZWN0b3Igb2YgbWFnbml0dWRlIHplcm9cbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIHplcm8oKSB7XG4gICAgICAgIFwidXNlIHN0cmljdFwiO1xuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcigwLCAwKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHVuaXQgdmVjdG9yIHBvaW50aW5nIGluIHRoZSBwb3NpdGl2ZSB5IGRpcmVjdGlvblxuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBmdW5jdGlvblxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFVuaXQgdmVjdG9yIHBvaW50aW5nIHVwXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyB1cCgpIHtcbiAgICAgICAgXCJ1c2Ugc3RyaWN0XCI7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKDAsIDEpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdW5pdCB2ZWN0b3IgcG9pbnRpbmcgaW4gdGhlIG5lZ2F0aXZlIHkgZGlyZWN0aW9uXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQGZ1bmN0aW9uXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVW5pdCB2ZWN0b3IgcG9pbnRpbmcgZG93blxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZG93bigpIHtcbiAgICAgICAgXCJ1c2Ugc3RyaWN0XCI7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKDAsIC0xKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHVuaXQgdmVjdG9yIHBvaW50aW5nIGluIHRoZSBuZWdhdGl2ZSB4IGRpcmVjdGlvblxuICAgICAqXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBmdW5jdGlvblxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFVuaXQgdmVjdG9yIHBvaW50aW5nIHJpZ2h0XG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBsZWZ0KCkge1xuICAgICAgICBcInVzZSBzdHJpY3RcIjtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoLTEsIDApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdW5pdCB2ZWN0b3IgcG9pbnRpbmcgaW4gdGhlIHBvc2l0aXZlIHggZGlyZWN0aW9uXG4gICAgICpcbiAgICAgKiBAc3RhdGljXG4gICAgICogQGZ1bmN0aW9uXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVW5pdCB2ZWN0b3IgcG9pbnRpbmcgcmlnaHRcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIHJpZ2h0KCkge1xuICAgICAgICBcInVzZSBzdHJpY3RcIjtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoMSwgMCk7XG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBWZWN0b3I7IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi4vZ2VvbWV0cnkvVmVjdG9yXCI7XG5pbXBvcnQgUG9seWdvbiBmcm9tIFwiLi4vZ2VvbWV0cnkvUG9seWdvblwiO1xuXG5jbGFzcyBDZW50ZXIgZXh0ZW5kcyBWZWN0b3Ige1xuICAgIC8qKlxuICAgICAqIEEgY2VudGVyIGNvbm5lY3Rpb24gYW5kIGxvY2F0aW9uIGluIGEgZ3JhcGggb2JqZWN0XG4gICAgICogXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IGlkIFRoZSBpZCBvZiB0aGUgY2VudGVyIGluIHRoZSBncmFwaCBvYmplY3RcbiAgICAgKiBAcHJvcGVydHkge1BvbHlnb259IG5laWdoYm9ycyBTZXQgb2YgYWRqYWNlbnQgcG9seWdvbiBjZW50ZXJzXG4gICAgICogQHByb3BlcnR5IHtMaW5lW119IGJvcmRlcnMgU2V0IG9mIGJvcmRlcmluZyBlZGdlc1xuICAgICAqIEBwcm9wZXJ0eSB7UG9seWdvbn0gY29ybmVycyBTZXQgb2YgcG9seWdvbiBjb3JuZXJzXG4gICAgICogQHByb3BlcnR5IHtib29sZWFufSBib3JkZXIgSXMgdGhpcyBwb2x5Z29uIHRvdWNoaW5nIHRoZSBib3JkZXIgZWRnZVxuICAgICAqIEBwcm9wZXJ0eSB7b2JqZWN0fSBkYXRhIFRoZSBkYXRhIHN0b3JlZCBieSB0aGUgY2VudGVyIG9iamVjdC4gVGhpcyBpcyB0aGVcbiAgICAgKiAgZGF0YSB0aGF0IGlzIHRvIGJlIGNoYW5nZWQgYnkgdGhlIHVzZXJcbiAgICAgKiBAcHJvcGVydHkge0NlbnRlcn0gcGFyZW50IFRoZSBwYXJlbnQgb2JqZWN0IHRvIHRoZSBjdXJyZW50IG9iamVjdC4gVGhlXG4gICAgICogIGRlZmF1bHQgaXMgbnVsbCwgdGhlcmUgaXMgbm8gcGFyZW50LlxuICAgICAqIEBwcm9wZXJ0eSB7Q2VudGVyW119IGNoaWxkcmVuIFRoZSBjaGlsZHJlbiBvYmplY3RzIHRvIHRoZSBjdXJyZW50IG9iamVjdC5cbiAgICAgKiAgVGhlIGRlZmF1bHQgaXMgYW4gZW1wdHkgbGlzdFxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBwb3NpdGlvbiBUaGUgbG9jYXRpb24gb2YgdGhlIENlbnRlciBvYmplY3RcbiAgICAgKiBcbiAgICAgKiBAY2xhc3MgQ2VudGVyXG4gICAgICogQGV4dGVuZHMge1ZlY3Rvcn1cbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwb3NpdGlvbiwgcGFyZW50ID0gbnVsbCwgY2hpbGRyZW4gPSBudWxsKSB7XG4gICAgICAgIHN1cGVyKHBvc2l0aW9uKTtcblxuICAgICAgICAvLyBEaWFncmFtIFByb3BlcnRpZXNcbiAgICAgICAgdGhpcy5pZCA9IC0xO1xuICAgICAgICB0aGlzLm5laWdoYm9ycyA9IFtdOyAvLyBDZW50ZXJzXG4gICAgICAgIHRoaXMuYm9yZGVycyA9IFtdOyAvLyBFZGdlc1xuICAgICAgICB0aGlzLmNvcm5lcnMgPSBbXTtcbiAgICAgICAgdGhpcy5ib3JkZXIgPSBmYWxzZTtcbiAgICAgICAgdGhpcy50aWxlID0gbnVsbDtcblxuICAgICAgICAvLyBIaWdoZXIgTGV2ZWwgUHJvcGVydGllc1xuICAgICAgICB0aGlzLmRhdGEgPSB7fTtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IENlbnRlcjsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcbmltcG9ydCBQb2x5Z29uIGZyb20gXCIuLi9nZW9tZXRyeS9Qb2x5Z29uXCI7XG5cbmNsYXNzIENvcm5lciBleHRlbmRzIFZlY3RvciB7XG4gICAgLyoqXG4gICAgICogQSBjb3JuZXIgY29ubmVjdGlvbiBhbmQgbG9jYXRpb24gaW4gYSBncmFwaCBvYmplY3RcbiAgICAgKiBcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0gaWQgVGhlIGlkIG9mIHRoZSBjb3JuZXIgaW4gdGhlIGdyYXBoIG9iamVjdFxuICAgICAqIEBwcm9wZXJ0eSB7UG9seWdvbn0gdG91Y2hlcyBTZXQgb2YgcG9seWdvbiBjZW50ZXJzIHRvdWNoaW5nIHRoaXMgb2JqZWN5dFxuICAgICAqIEBwcm9wZXJ0eSB7TGluZVtdfSBwcm90cnVkZXMgU2V0IG9mIGVkZ2VzIHRoYXQgYXJlIGNvbm5lY3RlZCB0byB0aGlzIGNvcm5lclxuICAgICAqIEBwcm9wZXJ0eSB7UG9seWdvbn0gYWRqYWNlbnQgU2V0IG9mIGNvcm5lcnMgdGhhdCBjb25uZWN0ZWQgdG8gdGhpcyBjb3JuZXJcbiAgICAgKiBcbiAgICAgKiBAY2xhc3MgQ29ybmVyXG4gICAgICogQGV4dGVuZHMge1ZlY3Rvcn1cbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwb3NpdGlvbikge1xuICAgICAgICBzdXBlcihwb3NpdGlvbik7XG4gICAgICAgIHRoaXMuaWQgPSAtMTtcbiAgICAgICAgdGhpcy50b3VjaGVzID0gW107IC8vIENlbnRlcnNcbiAgICAgICAgdGhpcy5wcm90cnVkZXMgPSBbXTsgLy8gRWRnZXNcbiAgICAgICAgdGhpcy5hZGphY2VudCA9IFtdOyAvLyBDb3JuZXJzXG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBDb3JuZXI7IiwiLy8gRmluZCBhIHdheSB0byBpbXBsZW1lbnQga2R0cmVlcyB0byBzcGVlZCB1cCB0aWxlIHNlbGVjdGlvbiBmcm9tIGEgcG9pbnRcbi8vIGltcG9ydCBLRFRyZWUgZnJvbSBcInN0YXRpYy1rZHRyZWVcIjtcblxuaW1wb3J0IEdyYXBoIGZyb20gXCIuL0dyYXBoXCI7XG5pbXBvcnQgVGlsZSBmcm9tIFwiLi9UaWxlXCI7XG5pbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcblxuY2xhc3MgRGlhZ3JhbSBleHRlbmRzIEdyYXBoIHtcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYW4gaW5zdGFuY2Ugb2YgRGlhZ3JhbS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge2FueX0gcG9pbnRzIFxuICAgICAqIEBwYXJhbSB7YW55fSBiYm94IFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBbcmVsYXhhdGlvbnM9MF0gXG4gICAgICogQHBhcmFtIHtib29sZWFufSBbaW1wcm92ZUNvcm5lcnM9ZmFsc2VdIFxuICAgICAqIFxuICAgICAqIEBjbGFzcyBEaWFncmFtXG4gICAgICogQGV4dGVuZHMgR3JhcGhcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwb2ludHMsIGJib3gsIHJlbGF4YXRpb25zID0gMCwgaW1wcm92ZUNvcm5lcnMgPSBmYWxzZSkge1xuICAgICAgICBzdXBlcihwb2ludHMsIGJib3gsIHJlbGF4YXRpb25zLCBpbXByb3ZlQ29ybmVycyk7XG5cbiAgICAgICAgdGhpcy50aWxlcyA9IFtdO1xuICAgICAgICB0aGlzLl9jcmVhdGVUaWxlcygpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFxuICAgICAqIFxuICAgICAqIEBtZW1iZXJvZiBEaWFncmFtXG4gICAgICovXG4gICAgX2NyZWF0ZVRpbGVzKCkge1xuICAgICAgICBmb3IgKGxldCBjZW50ZXIgb2YgdGhpcy5jZW50ZXJzKSB7XG4gICAgICAgICAgICBjb25zdCB0aWxlID0gbmV3IFRpbGUoY2VudGVyLCBjZW50ZXIuY29ybmVycywgY2VudGVyLmJvcmRlcnMpO1xuICAgICAgICAgICAgY2VudGVyLnRpbGUgPSB0aWxlO1xuICAgICAgICAgICAgdGhpcy50aWxlcy5wdXNoKHRpbGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ29ubmVjdCB0b2dldGhlciB0aGUgdGlsZSBvYmplY3RzIGFzIG5laWdoYm9yc1xuICAgICAgICBmb3IgKGxldCB0aWxlIG9mIHRoaXMudGlsZXMpIHtcbiAgICAgICAgICAgIHRpbGUubmVpZ2hib3JzID0gdGlsZS5jZW50ZXIubmVpZ2hib3JzLm1hcChcbiAgICAgICAgICAgICAgICBjZW50ZXIgPT4gY2VudGVyLnRpbGVcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUaGlzIGZ1bmN0aW9uIGlzIHVzZWQgdG8gY2FsbCBjZWxsdWxhciBhdXRvbWl0YSBvbiB0aGUgZ3JhcGggb2JqZWN0LlxuICAgICAqIFRoZSBydWxlc2V0IGZ1bmN0aW9uIHNob3VsZCBmb2xsb3cgdGhlIGZvbGxvd2luZyBwcm9wZXJ0aWVzIHNvIHRoYXRcbiAgICAgKiB0aGUgYXV0b21hdGlvbiBjYW4gcnVuIHByb3Blcmx5LiBTZWUgdGhlIGV4YW1wbGUgZm9yIHRoZSBkZXRhaWxzXG4gICAgICogXG4gICAgICogQHN1bW1hcnkgUnVuIGEgZ2VuZXJhdGlvbiBvZiBjZWxsdWxhciBhdXRvbWF0aW9uIGFjY29yZGluZyB0byBhIHVzZXJcbiAgICAgKiAgc3BlY2lmaWVkIHJ1bGUgc2V0XG4gICAgICogXG4gICAgICogQHBhcmFtIHtmdW5jdGlvbn0gcnVsZXNldCBUaGVcbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIFxuICAgICAqIHZhciBnYW1lT2ZMaWZlID0gZnVuY3Rpb24oY2VudGVyKSB7XG4gICAgICogICB2YXIgbiA9IGNlbnRlci5uZWlnaGJvcnMubGVuZ3RoO1xuICAgICAqICAgcmV0dXJuIHsgXG4gICAgICogICAgIGFsaXZlOiBjZW50ZXIuZGF0YS5hbGl2ZSAmJiAobiA9PT0gMiB8fCBuID09PSAzKSB8fFxuICAgICAqICAgICAgICAgICAhY2VudGVyLmRhdGEuYWxpdmUgJiYgbiA9PT0gM1xuICAgICAqICAgfTtcbiAgICAgKiB9XG4gICAgICogXG4gICAgICogQHRvZG8gRmluZCBhIE5ldyBOYW1lXG4gICAgICogQG1lbWJlck9mIERpYWdyYW1cbiAgICAgKi9cbiAgICBfZ2VuZXJhdGUocnVsZXNldCkge1xuICAgICAgICAvLyBSdW4gY2VsbHVsYXIgYXV0b21pdGFcbiAgICAgICAgZm9yIChsZXQgY2VudGVyIG9mIHRoaXMuY2VudGVycykge1xuICAgICAgICAgICAgY2VudGVyLl9kYXRhID0gcnVsZXNldChjZW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVXBkYXRlIGF1dG9taXRhIGFjdGlvbnNcbiAgICAgICAgZm9yIChsZXQgY2VudGVyIG9mIHRoaXMuY2VudGVycykge1xuICAgICAgICAgICAgLy8gVXBkYXRlIG9ubHkgdGhlIG5ldyBkYXRhIHRoYXQgaGFzIGNoYW5nZWRcbiAgICAgICAgICAgIGZvciAobGV0IGtleSBpbiBjZW50ZXIuX2RhdGEpIHtcbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyLl9kYXRhLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgY2VudGVyLmRhdGFba2V5XSA9IGNlbnRlci5fZGF0YVtrZXldO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGRlbGV0ZSBjZW50ZXIuX2RhdGE7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpbml0aWFsaXplKHJ1bGVzZXQpIHtcbiAgICAgICAgdGhpcy5fZ2VuZXJhdGUocnVsZXNldCk7XG4gICAgfVxuXG4gICAgaXRlcmF0ZShydWxlc2V0KSB7XG4gICAgICAgIHRoaXMuX2dlbmVyYXRlKHJ1bGVzZXQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdGlsZSB0aGF0IGNvbnRhaW5zIHRoZSBzcGVjaWZpYyBsb2NhdGlvblxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBwb3NpdGlvbiBUaGUgcG9zaXRpb24gd2hpY2ggY29udGFpbnMgdGhlIGRlc2lyZWQgdGlsZSBcbiAgICAgKiBcbiAgICAgKiBAcmV0dXJuIHtUaWxlfSBUaGUgdGlsZSBhdCB0aGUgcG9zaXRpb25cbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgRGlhZ3JhbVxuICAgICAqL1xuICAgIGdldFRpbGUocG9zaXRpb24pIHtcbiAgICAgICAgaWYgKCF0aGlzLmJib3guY29udGFpbnMocG9zaXRpb24pKSB7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBtaW5EaXN0ID0gSW5maW5pdHk7XG4gICAgICAgIGxldCBjbG9zZXN0ID0gdGhpcy50aWxlc1swXTtcbiAgICAgICAgbGV0IGRpc3Q7XG5cbiAgICAgICAgZm9yIChjb25zdCB0aWxlIG9mIHRoaXMudGlsZXMpIHtcbiAgICAgICAgICAgIGRpc3QgPSBWZWN0b3IuZGlzdDIodGlsZS5jZW50ZXIsIHBvc2l0aW9uKTtcblxuICAgICAgICAgICAgaWYgKGRpc3QgPCBtaW5EaXN0KSB7XG4gICAgICAgICAgICAgICAgbWluRGlzdCA9IGRpc3Q7XG4gICAgICAgICAgICAgICAgY2xvc2VzdCA9IHRpbGU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY2xvc2VzdDtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgcGF0aCBiZXR3ZWVuIHR3byB0aWxlcyBvbiB0aGUgZGlhZ3JhbS4gVGhpcyBwYXRoIGluY2x1ZGVzIGJvdGhcbiAgICAgKiB0aGUgc3RhcnQgdGlsZSBhbmQgdGhlIGVuZCB0aWxlIG9uIHRoZSBncmFwaC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1RpbGV9IHN0YXJ0IFRoZSBzdGFydGluZyB0aWxlIHRvIHNlYXJjaCBmcm9tXG4gICAgICogQHBhcmFtIHtUaWxlfSBlbmQgVGhlIGVuZGluZyB0aWxlIHRvIHNlYXJjaCB0b1xuICAgICAqIEBwYXJhbSB7TnVtYmVyfSBbSXRlcmF0aW9ucz0wXVxuICAgICAqIEByZXR1cm4ge1RpbGVbXX0gQSByZXN1bHRpbmcgcGF0aCBiZXR3ZWVuIHR3byB0aWxlc1xuICAgICAqICBSZXR1cm5lZCBvZiB0aGUgZm9ybSBbc3RhcnQsIC4uLiwgZW5kXVxuICAgICAqIFxuICAgICAqIEBtZW1iZXJPZiBEaWFncmFtXG4gICAgICovXG4gICAgZ2V0UGF0aChzdGFydCwgZW5kLCBpdGVyYXRpb25zID0gMTAwKSB7XG4gICAgICAgIGxldCBjdXJUaWxlID0gc3RhcnQ7XG4gICAgICAgIGxldCBwYXRoID0gW3N0YXJ0XTtcbiAgICAgICAgbGV0IGRpcmVjdGlvbjtcblxuICAgICAgICB3aGlsZSAoIVZlY3Rvci5lcXVhbHMoY3VyVGlsZS5jZW50ZXIsIGVuZC5jZW50ZXIpKSB7XG4gICAgICAgICAgICBkaXJlY3Rpb24gPSBWZWN0b3Iuc3VidHJhY3QoZW5kLmNlbnRlciwgY3VyVGlsZS5jZW50ZXIpO1xuICAgICAgICAgICAgY3VyVGlsZSA9IGN1clRpbGUuZ2V0TmVpZ2hib3IoZGlyZWN0aW9uKTtcbiAgICAgICAgICAgIHBhdGgucHVzaChjdXJUaWxlKTtcblxuICAgICAgICAgICAgaWYgKGl0ZXJhdGlvbnMgPCAwKSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpdGVyYXRpb25zLS07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcGF0aDtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IERpYWdyYW07IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi4vZ2VvbWV0cnkvVmVjdG9yXCI7XG5pbXBvcnQgTGluZSBmcm9tIFwiLi4vZ2VvbWV0cnkvTGluZVwiO1xuXG5jbGFzcyBFZGdlIGV4dGVuZHMgTGluZSB7XG4gICAgLyoqXG4gICAgICogRWRnZSBjb25uZWN0aW9ucyBiZXR3ZWVuIGNlbnRlcnMgYW5kIGNvcm5lcnMgaW4gdGhlIFZvcm9ub2kvRGVsYXVuYXlcbiAgICAgKiBncmFwaC5cbiAgICAgKiBcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0gaWQgVGhlIGlkIG9mIHRoZSBlZGdlIGluIHRoZSBncmFwaCBvYmplY3RcbiAgICAgKiBAcHJvcGVydHkge1ZlY3Rvcn0gZDAgVGhlIGZpcnN0IHBvbHlnb24gY2VudGVyIG9mIHRoZSBkZWxhdW5heSBncmFwaFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSBkMSBUaGUgc2Vjb25kIHBvbHlnb24gY2VudGVyIG9mIHRoZSBkZWxhdW5heSBncmFwaFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSB2MCBUaGUgZmlyc3QgY29ybmVyIG9iamVjdCBvZiB0aGUgdm9yb25vaSBncmFwaFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSB2MSBUaGUgc2Vjb25kIGNvcm5lciBvYmplY3Qgb2YgdGhlIHZvcm9ub2kgZ3JhcGhcbiAgICAgKiBcbiAgICAgKiBAY2xhc3MgRWRnZVxuICAgICAqIEBleHRlbmRzIHtMaW5lfVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHYwLCB2MSkge1xuICAgICAgICBzdXBlcih2MCwgdjEpO1xuICAgICAgICB0aGlzLmlkID0gLTE7XG4gICAgICAgIC8vIFBvbHlnb24gY2VudGVyIG9iamVjdHMgY29ubmVjdGVkIGJ5IERlbGF1bmF5IGVkZ2VzXG4gICAgICAgIHRoaXMuZDAgPSBudWxsO1xuICAgICAgICB0aGlzLmQxID0gbnVsbDtcbiAgICAgICAgLy8gQ29ybmVyIG9iamVjdHMgY29ubmVjdGVkIGJ5IFZvcm9ub2kgZWRnZXNcbiAgICAgICAgdGhpcy52MCA9IG51bGw7XG4gICAgICAgIHRoaXMudjEgPSBudWxsO1xuICAgICAgICB0aGlzLm1pZHBvaW50ID0gbnVsbDtcbiAgICAgICAgdGhpcy5ib3JkZXIgPSBmYWxzZTtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IEVkZ2U7IiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbmltcG9ydCBWZWN0b3IgZnJvbSBcIi4uL2dlb21ldHJ5L1ZlY3RvclwiO1xuaW1wb3J0IENlbnRlciBmcm9tIFwiLi9DZW50ZXJcIjtcbmltcG9ydCBDb3JuZXIgZnJvbSBcIi4vQ29ybmVyXCI7XG5pbXBvcnQgRWRnZSBmcm9tIFwiLi9FZGdlXCI7XG5pbXBvcnQgeyBoYXMgfSBmcm9tIFwiLi4vdXRpbGl0aWVzL1V0aWxcIjtcbmltcG9ydCBWb3Jvbm9pIGZyb20gXCJWb3Jvbm9pXCI7XG5cbi8vIE5lZWQgdG8gRVM2aWZ5XG5jbGFzcyBHcmFwaCB7XG4gICAgLyoqXG4gICAgICogVGhlIEdyYXBoIGNsYXNzIGlzIGFuIGV4dGVuc3Rpb24gb2YgdGhlIHZvcm9ub2kgZGlhZ3JhbS4gSXQgdHVybnMgdGhlXG4gICAgICogZGlhZ3JhbSBpbnRvIGEgbW9yZSB1c2VhYmxlIGZvcm1hdCB3aGVyZSBjZW50ZXJzLCBlZGdlcywgYW5kIGNvcm5lcnMgYXJlXG4gICAgICogYmV0dGVyIGNvbm5lY3RlZC4gVGhpcyBhbGxvd3MgZm9yIG1hbnkgZGlmZmVyZW50IHR5cGVzIG9mIHRyYXZlcnNhbCBvdmVyXG4gICAgICogdGhlIGdyYXBoLiBUaGlzIGNsYXNzIHVzZXMgdGhlIHJoaWxsLXZvcm9ub2kgbGlicmFyeSBmb3IgYnVpbGRpbmcgdGhlXG4gICAgICogdm9yb25vaSBncmFwaC4gVGhpcyBpcyB0ZXJtZWQgYSBQQU4gY29ubmVjdGVkIGdyYXBoLiBUaGlzIGNsYXNzIGNhbiBhbHNvIGJlXG4gICAgICogcmVsYXhlZCBtb3JlIGJ5IHVzaW5nIGxsb3lkIHJlbGF4YXRpb24gd2hpY2ggcmVydW5zIHRoZSBncmFwaCBzaW11bGF0aW9uXG4gICAgICogcHJvY2VzcyB3aXRoIGEgbGVzcyBwYWNrZWQgcG9pbnQgc2V0IHRvIGdyYWR1YWxseSBjcmVhdGUgYSBtb3JlIFwiYmx1ZVwiIG5vaXNlXG4gICAgICogZWZmZWN0LlxuICAgICAqXG4gICAgICogQHN1bW1hcnkgQ3JlYXRlcyBhIHZvcm9ub2kgZGlhZ3JhbSBvZiBhIGdpdmVuIHBvaW50IHNldCB0aGF0IGlzIGNyZWF0ZWRcbiAgICAgKiAgaW5zaWRlIGEgcGFydGl1Y2xhciBib3VuZGluZyBib3guIFRoZSBzZXQgb2YgcG9pbnRzIGNhbiBhbHNvIGJlIHJlbGF4ZWRcbiAgICAgKiAgY3JlYXRpbmcgYSBtb3JlIFwiYmx1ZVwiIG5vaXNlIGVmZmVjdCB1c2luZyBsb3lkIHJlbGF4YXRpb24uXG4gICAgICogXG4gICAgICogQHByb3BlcnR5IHtSZWN0YW5nbGV9IGJib3ggVGhlIGlucHV0IGJvdW5kaW5nIGJveFxuICAgICAqIEBwcm9wZXJ0eSB7Q2VudGVyW119IGNlbnRlcnMgQWxsIHRoZSBjZW50ZXIgb2JqZWN0cyBvZiB0aGUgZ3JhcGhcbiAgICAgKiBAcHJvcGVydHkge0Nvcm5lcltdfSBjb3JuZXJzIEFsbCB0aGUgY29ybmVyIG9iamVjdHMgb2YgdGhlIGdyYXBoXG4gICAgICogQHByb3BlcnR5IHtFZGdlc1tdfSBlZGdlcyBBbGwgdGhlIGVkZ2Ugb2JqZWN0cyBvZiB0aGUgZ3JhcGhcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1ZlY3RvcltdfSBwb2ludHMgVGhlIHZlY3RvciBsb2NhdGlvbiB0byBjcmVhdGUgdGhlIHZvcm9ub2kgZGlhZ3JhbSB3aXRoXG4gICAgICogQHBhcmFtIHtSZWN0YW5nbGV9IGJib3ggVGhlIGJvdW5kaW5nIGJveCBmb3IgdGhlIGNyZWF0aW9uIG9mIHRoZSB2b3Jvbm9pIGRpYWdyYW1cbiAgICAgKiBAcGFyYW0ge2ludGVnZXJ9IFtyZWxheGF0aW9ucz0wXSBUaGUgbnVtYmVyIG9mIGxsb3lkIHJlbGF4YXRpb25zIHRvIGRvLlxuICAgICAqICBUaGlzIHR1cm5zIGEgbm9pc3kgZ3JhcGggaW50byBhIG1vcmUgdW5pZm9ybSBncmFwaCBpdGVyYXRpb24gYnkgaXRlcmF0aW9uLlxuICAgICAqICBUaGlzIGhlbHBzIHRvIGltcHJvdmUgdGhlIHNwYWNpbmcgYmV0d2VlbiBwb2ludHMgaW4gdGhlIGdyYXBoLlxuICAgICAqIEBwYXJhbSB7Ym9vbH0gW2ltcHJvdmVDb3JuZXJzPWZhbHNlXSBUaGlzIGltcHJvdmVzIHVuaWZvcm1pdHkgYW1vbmcgdGhlXG4gICAgICogIGNvcm5lcnMgYnkgc2V0dGluZyB0aGVtIHRvIHRoZSBhdmVyYWdlIG9mIHRoZWlyIG5laWdoYm9ycy4gVGhpcyBicmVha3NcbiAgICAgKiAgdGhlIHZvcm9ub2kgcHJvcGVydGllcyBvZiB0aGUgZ3JhcGguXG4gICAgICogXG4gICAgICogQGNsYXNzIEdyYXBoXG4gICAgICovXG4gICAgY29uc3RydWN0b3IocG9pbnRzLCBiYm94LCByZWxheGF0aW9ucyA9IDAsIGltcHJvdmVDb3JuZXJzID0gZmFsc2UpIHtcbiAgICAgICAgdGhpcy5iYm94ID0gYmJveDtcbiAgICAgICAgdGhpcy5fcmhpbGxiYm94ID0ge1xuICAgICAgICAgICAgeGw6IHRoaXMuYmJveC54LFxuICAgICAgICAgICAgeHI6IHRoaXMuYmJveC54ICsgdGhpcy5iYm94LndpZHRoLFxuICAgICAgICAgICAgeXQ6IHRoaXMuYmJveC55LFxuICAgICAgICAgICAgeWI6IHRoaXMuYmJveC55ICsgdGhpcy5iYm94LmhlaWdodFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIENvbXB1dGUgVm9yb25vaSBmcm9tIGluaXRpYWwgcG9pbnRzXG4gICAgICAgIGNvbnN0IHJoaWxsVm9yb25vaSA9IG5ldyBWb3Jvbm9pKCk7XG4gICAgICAgIHRoaXMuX3Zvcm9ub2kgPSByaGlsbFZvcm9ub2kuY29tcHV0ZShwb2ludHMsIHRoaXMuX3JoaWxsYmJveCk7XG5cbiAgICAgICAgLy8gTGxveWRzIFJlbGF4YXRpb25zXG4gICAgICAgIHdoaWxlIChyZWxheGF0aW9ucyA+IDApIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKHJlbGF4YXRpb25zKTtcbiAgICAgICAgICAgIGNvbnN0IHNpdGVzID0gdGhpcy5yZWxheFNpdGVzKHRoaXMuX3Zvcm9ub2kpO1xuICAgICAgICAgICAgcmhpbGxWb3Jvbm9pLnJlY3ljbGUodGhpcy5fdm9yb25vaSk7XG4gICAgICAgICAgICB0aGlzLl92b3Jvbm9pID0gcmhpbGxWb3Jvbm9pLmNvbXB1dGUoc2l0ZXMsIHRoaXMuX3JoaWxsYmJveCk7XG4gICAgICAgICAgICByZWxheGF0aW9ucy0tO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5jb252ZXJ0RGlhZ3JhbSh0aGlzLl92b3Jvbm9pKTtcblxuICAgICAgICBpZiAoaW1wcm92ZUNvcm5lcnMpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKHRoaXMuY29ybmVycyk7XG4gICAgICAgICAgICB0aGlzLmltcHJvdmVDb3JuZXJzKCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyh0aGlzLmNvcm5lcnMpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuc29ydENvcm5lcnMoKTtcblxuICAgIH1cblxuICAgIHJlbGF4U2l0ZXModm9yb25vaSkge1xuICAgICAgICBjb25zdCBjZWxscyA9IHZvcm9ub2kuY2VsbHM7XG4gICAgICAgIGxldCBpQ2VsbCA9IGNlbGxzLmxlbmd0aDtcbiAgICAgICAgbGV0IGNlbGw7XG4gICAgICAgIGxldCBzaXRlO1xuICAgICAgICBjb25zdCBzaXRlcyA9IFtdO1xuXG4gICAgICAgIHdoaWxlIChpQ2VsbC0tKSB7XG4gICAgICAgICAgICBjZWxsID0gY2VsbHNbaUNlbGxdO1xuICAgICAgICAgICAgc2l0ZSA9IHRoaXMuY2VsbENlbnRyb2lkKGNlbGwpO1xuICAgICAgICAgICAgc2l0ZXMucHVzaChuZXcgVmVjdG9yKHNpdGUueCwgc2l0ZS55KSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHNpdGVzO1xuICAgIH1cblxuICAgIGNlbGxBcmVhKGNlbGwpIHtcbiAgICAgICAgbGV0IGFyZWEgPSAwO1xuICAgICAgICBjb25zdCBoYWxmZWRnZXMgPSBjZWxsLmhhbGZlZGdlcztcbiAgICAgICAgbGV0IGlIYWxmZWRnZSA9IGhhbGZlZGdlcy5sZW5ndGg7XG4gICAgICAgIGxldCBoYWxmZWRnZSwgcDEsIHAyO1xuICAgICAgICB3aGlsZSAoaUhhbGZlZGdlLS0pIHtcbiAgICAgICAgICAgIGhhbGZlZGdlID0gaGFsZmVkZ2VzW2lIYWxmZWRnZV07XG4gICAgICAgICAgICBwMSA9IGhhbGZlZGdlLmdldFN0YXJ0cG9pbnQoKTtcbiAgICAgICAgICAgIHAyID0gaGFsZmVkZ2UuZ2V0RW5kcG9pbnQoKTtcbiAgICAgICAgICAgIGFyZWEgKz0gcDEueCAqIHAyLnk7XG4gICAgICAgICAgICBhcmVhIC09IHAxLnkgKiBwMi54O1xuICAgICAgICB9XG4gICAgICAgIGFyZWEgLz0gMjtcbiAgICAgICAgcmV0dXJuIGFyZWE7XG4gICAgfVxuXG4gICAgY2VsbENlbnRyb2lkKGNlbGwpIHtcbiAgICAgICAgbGV0IHggPSAwLFxuICAgICAgICAgICAgeSA9IDA7XG4gICAgICAgIGNvbnN0IGhhbGZlZGdlcyA9IGNlbGwuaGFsZmVkZ2VzO1xuICAgICAgICBsZXQgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aDtcbiAgICAgICAgbGV0IGhhbGZlZGdlO1xuICAgICAgICBsZXQgdiwgcDEsIHAyO1xuXG4gICAgICAgIHdoaWxlIChpSGFsZmVkZ2UtLSkge1xuICAgICAgICAgICAgaGFsZmVkZ2UgPSBoYWxmZWRnZXNbaUhhbGZlZGdlXTtcblxuICAgICAgICAgICAgcDEgPSBoYWxmZWRnZS5nZXRTdGFydHBvaW50KCk7XG4gICAgICAgICAgICBwMiA9IGhhbGZlZGdlLmdldEVuZHBvaW50KCk7XG5cbiAgICAgICAgICAgIHYgPSBwMS54ICogcDIueSAtIHAyLnggKiBwMS55O1xuXG4gICAgICAgICAgICB4ICs9IChwMS54ICsgcDIueCkgKiB2O1xuICAgICAgICAgICAgeSArPSAocDEueSArIHAyLnkpICogdjtcbiAgICAgICAgfVxuXG4gICAgICAgIHYgPSB0aGlzLmNlbGxBcmVhKGNlbGwpICogNjtcblxuICAgICAgICByZXR1cm4geyB4OiB4IC8gdiwgeTogeSAvIHYgfTtcbiAgICB9XG5cbiAgICBjb252ZXJ0RGlhZ3JhbSh2b3Jvbm9pKSB7XG4gICAgICAgIGNvbnN0IGNlbnRlckxvb2t1cCA9IHt9O1xuICAgICAgICBjb25zdCBjb3JuZXJMb29rdXAgPSB7fTtcbiAgICAgICAgdGhpcy5jZW50ZXJzID0gW107XG4gICAgICAgIHRoaXMuY29ybmVycyA9IFtdO1xuICAgICAgICB0aGlzLmVkZ2VzID0gW107XG5cbiAgICAgICAgbGV0IGNvcm5lcklkID0gMDtcbiAgICAgICAgbGV0IGVkZ2VJZCA9IDA7XG5cbiAgICAgICAgLy8gQ29weSBvdmVyIGFsbCB0aGUgY2VudGVyIG5vZGVzXG4gICAgICAgIGZvciAoY29uc3QgY2VsbCBvZiB2b3Jvbm9pLmNlbGxzKSB7XG4gICAgICAgICAgICBjb25zdCBzaXRlID0gY2VsbC5zaXRlO1xuICAgICAgICAgICAgY29uc3QgcG9zID0gbmV3IFZlY3RvcihzaXRlLngsIHNpdGUueSk7XG4gICAgICAgICAgICBjb25zdCBjZW50ZXIgPSBuZXcgQ2VudGVyKHBvcyk7XG4gICAgICAgICAgICBjZW50ZXIuaWQgPSBzaXRlLnZvcm9ub2lJZDtcbiAgICAgICAgICAgIGNlbnRlckxvb2t1cFtwb3Mua2V5KCldID0gY2VudGVyO1xuICAgICAgICAgICAgdGhpcy5jZW50ZXJzLnB1c2goY2VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBhbmQgY29weSBvdmVyIHRoZSBlZGdlcyBhbmQgY29ybmVyc1xuICAgICAgICAvLyBUaGlzIHBvcnRpb24gYWxzbyBjcmVhdGVzIHRoZSBjb25uZWN0aW9ucyBiZXR3ZWVuIGFsbCB0aGUgbm9kZXNcbiAgICAgICAgZm9yIChsZXQgZWRnZSBvZiB2b3Jvbm9pLmVkZ2VzKSB7XG5cbiAgICAgICAgICAgIC8vIENvbnZlcnQgdm9yb25vaSBlZGdlIHRvIGEgdXNlYWJsZSBmb3JtXG4gICAgICAgICAgICAvLyBDb3JuZXIgcG9zaXRpb25zXG4gICAgICAgICAgICBjb25zdCB2YSA9IG5ldyBWZWN0b3IoTWF0aC5yb3VuZChlZGdlLnZhLngpLCBNYXRoLnJvdW5kKGVkZ2UudmEueSkpO1xuICAgICAgICAgICAgY29uc3QgdmIgPSBuZXcgVmVjdG9yKE1hdGgucm91bmQoZWRnZS52Yi54KSwgTWF0aC5yb3VuZChlZGdlLnZiLnkpKTtcbiAgICAgICAgICAgIC8vIENlbnRlciBwb3NpdGlvbnNcbiAgICAgICAgICAgIGNvbnN0IHNpdGUxID0gbmV3IFZlY3RvcihlZGdlLmxTaXRlLngsIGVkZ2UubFNpdGUueSk7XG4gICAgICAgICAgICBjb25zdCBzaXRlMiA9IGVkZ2UuclNpdGUgPyBuZXcgVmVjdG9yKGVkZ2UuclNpdGUueCwgZWRnZS5yU2l0ZS55KSA6IG51bGw7XG5cbiAgICAgICAgICAgIC8vIExvb2t1cCB0aGUgdHdvIGNlbnRlciBvYmplY3RzXG4gICAgICAgICAgICBjb25zdCBjZW50ZXIxID0gY2VudGVyTG9va3VwW3NpdGUxLmtleSgpXTtcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlcjIgPSBzaXRlMiA/IGNlbnRlckxvb2t1cFtzaXRlMi5rZXkoKV0gOiBudWxsO1xuXG4gICAgICAgICAgICAvLyBMb29rdXAgdGhlIGNvcm5lciBvYmplY3RzIGFuZCBpZiBvbmUgaXNuJ3QgY3JlYXRlZFxuICAgICAgICAgICAgLy8gY3JlYXRlIG9uZSBhbmQgYWRkIGl0IHRvIGNvcm5lcnMgc2V0XG4gICAgICAgICAgICBsZXQgY29ybmVyMTtcbiAgICAgICAgICAgIGxldCBjb3JuZXIyO1xuXG4gICAgICAgICAgICBjb25zdCBpc0JvcmRlciA9IChwb2ludCwgYmJveCkgPT4gcG9pbnQueCA8PSBiYm94LnhsIHx8IHBvaW50LnggPj0gYmJveC54ciB8fFxuICAgICAgICAgICAgICAgIHBvaW50LnkgPD0gYmJveC55dCB8fCBwb2ludC55ID49IGJib3gueWI7XG5cbiAgICAgICAgICAgIGlmICghaGFzKGNvcm5lckxvb2t1cCwgdmEua2V5KCkpKSB7XG4gICAgICAgICAgICAgICAgY29ybmVyMSA9IG5ldyBDb3JuZXIodmEpO1xuICAgICAgICAgICAgICAgIGNvcm5lcjEuaWQgPSBjb3JuZXJJZCsrO1xuICAgICAgICAgICAgICAgIGNvcm5lcjEuYm9yZGVyID0gaXNCb3JkZXIodmEsIHRoaXMuYmJveCk7XG4gICAgICAgICAgICAgICAgY29ybmVyTG9va3VwW3ZhLmtleSgpXSA9IGNvcm5lcjE7XG4gICAgICAgICAgICAgICAgdGhpcy5jb3JuZXJzLnB1c2goY29ybmVyMSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvcm5lcjEgPSBjb3JuZXJMb29rdXBbdmEua2V5KCldO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFoYXMoY29ybmVyTG9va3VwLCB2Yi5rZXkoKSkpIHtcbiAgICAgICAgICAgICAgICBjb3JuZXIyID0gbmV3IENvcm5lcih2Yik7XG4gICAgICAgICAgICAgICAgY29ybmVyMi5pZCA9IGNvcm5lcklkKys7XG4gICAgICAgICAgICAgICAgY29ybmVyMi5ib3JkZXIgPSBpc0JvcmRlcih2YiwgdGhpcy5iYm94KTtcbiAgICAgICAgICAgICAgICBjb3JuZXJMb29rdXBbdmIua2V5KCldID0gY29ybmVyMjtcbiAgICAgICAgICAgICAgICB0aGlzLmNvcm5lcnMucHVzaChjb3JuZXIyKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29ybmVyMiA9IGNvcm5lckxvb2t1cFt2Yi5rZXkoKV07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgZWRnZSBvYmplY3RzXG4gICAgICAgICAgICBjb25zdCBuZXdFZGdlID0gbmV3IEVkZ2UoKTtcbiAgICAgICAgICAgIG5ld0VkZ2UuaWQgPSBlZGdlSWQrKztcbiAgICAgICAgICAgIG5ld0VkZ2UuZDAgPSBjZW50ZXIxO1xuICAgICAgICAgICAgbmV3RWRnZS5kMSA9IGNlbnRlcjI7XG4gICAgICAgICAgICBuZXdFZGdlLnYwID0gY29ybmVyMTtcbiAgICAgICAgICAgIG5ld0VkZ2UudjEgPSBjb3JuZXIyO1xuICAgICAgICAgICAgbmV3RWRnZS5taWRwb2ludCA9IFZlY3Rvci5taWRwb2ludChjb3JuZXIxLCBjb3JuZXIyKTtcblxuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBjb3JuZXIgb2JqZWN0c1xuICAgICAgICAgICAgY29ybmVyMS5wcm90cnVkZXMucHVzaChuZXdFZGdlKTtcbiAgICAgICAgICAgIGNvcm5lcjIucHJvdHJ1ZGVzLnB1c2gobmV3RWRnZSk7XG5cbiAgICAgICAgICAgIGlmICghY29ybmVyMS50b3VjaGVzLmluY2x1ZGVzKGNlbnRlcjEpKSB7XG4gICAgICAgICAgICAgICAgY29ybmVyMS50b3VjaGVzLnB1c2goY2VudGVyMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY2VudGVyMiAmJiAhY29ybmVyMS50b3VjaGVzLmluY2x1ZGVzKGNlbnRlcjIpKSB7XG4gICAgICAgICAgICAgICAgY29ybmVyMS50b3VjaGVzLnB1c2goY2VudGVyMik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWNvcm5lcjIudG91Y2hlcy5pbmNsdWRlcyhjZW50ZXIxKSkge1xuICAgICAgICAgICAgICAgIGNvcm5lcjIudG91Y2hlcy5wdXNoKGNlbnRlcjEpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNlbnRlcjIgJiYgIWNvcm5lcjIudG91Y2hlcy5pbmNsdWRlcyhjZW50ZXIyKSkge1xuICAgICAgICAgICAgICAgIGNvcm5lcjIudG91Y2hlcy5wdXNoKGNlbnRlcjIpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb3JuZXIxLmFkamFjZW50LnB1c2goY29ybmVyMik7XG4gICAgICAgICAgICBjb3JuZXIyLmFkamFjZW50LnB1c2goY29ybmVyMSk7XG5cbiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgY2VudGVyIG9iamVjdHNcbiAgICAgICAgICAgIGNlbnRlcjEuYm9yZGVycy5wdXNoKG5ld0VkZ2UpO1xuICAgICAgICAgICAgaWYgKGNlbnRlcjIpIHtcbiAgICAgICAgICAgICAgICBjZW50ZXIyLmJvcmRlcnMucHVzaChuZXdFZGdlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFjZW50ZXIxLmNvcm5lcnMuaW5jbHVkZXMoY29ybmVyMSkpIHtcbiAgICAgICAgICAgICAgICBjZW50ZXIxLmNvcm5lcnMucHVzaChjb3JuZXIxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghY2VudGVyMS5jb3JuZXJzLmluY2x1ZGVzKGNvcm5lcjIpKSB7XG4gICAgICAgICAgICAgICAgY2VudGVyMS5jb3JuZXJzLnB1c2goY29ybmVyMik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY2VudGVyMiAmJiAhY2VudGVyMi5jb3JuZXJzLmluY2x1ZGVzKGNvcm5lcjEpKSB7XG4gICAgICAgICAgICAgICAgY2VudGVyMi5jb3JuZXJzLnB1c2goY29ybmVyMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY2VudGVyMiAmJiAhY2VudGVyMi5jb3JuZXJzLmluY2x1ZGVzKGNvcm5lcjIpKSB7XG4gICAgICAgICAgICAgICAgY2VudGVyMi5jb3JuZXJzLnB1c2goY29ybmVyMik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjZW50ZXIyKSB7XG4gICAgICAgICAgICAgICAgY2VudGVyMS5uZWlnaGJvcnMucHVzaChjZW50ZXIyKTtcbiAgICAgICAgICAgICAgICBjZW50ZXIyLm5laWdoYm9ycy5wdXNoKGNlbnRlcjEpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJZiBlaXRoZXIgY29ybmVyIGlzIGEgYm9yZGVyLCBib3RoIGNlbnRlcnMgYXJlIGJvcmRlcnNcbiAgICAgICAgICAgIGNlbnRlcjEuYm9yZGVyID0gY2VudGVyMS5ib3JkZXIgfHwgY29ybmVyMS5ib3JkZXIgfHwgY29ybmVyMi5ib3JkZXI7XG4gICAgICAgICAgICBpZiAoY2VudGVyMikge1xuICAgICAgICAgICAgICAgIGNlbnRlcjIuYm9yZGVyID0gY2VudGVyMi5ib3JkZXIgfHwgY29ybmVyMS5ib3JkZXIgfHwgY29ybmVyMi5ib3JkZXI7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuZWRnZXMucHVzaChuZXdFZGdlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBncmFwaFxuICAgIC8vXG4gICAgLy8gTGxveWQgcmVsYXhhdGlvbiBoZWxwZWQgdG8gY3JlYXRlIHVuaWZvcm1pdHkgYW1vbmcgcG9seWdvbiBjb3JuZXJzLFxuICAgIC8vIFRoaXMgZnVuY3Rpb24gY3JlYXRlcyB1bmlmb3JtaXR5IGFtb25nIHBvbHlnb24gY29ybmVycyBieSBzZXR0aW5nIHRoZSBjb3JuZXJzXG4gICAgLy8gdG8gdGhlIGF2ZXJhZ2Ugb2YgdGhlaXIgbmVpZ2hib3JzXG4gICAgLy8gVGhpcyBicmVha2VzIHRoZSB2b3Jvbm9pIGRpYWdyYW0gcHJvcGVydGllc1xuICAgIGltcHJvdmVDb3JuZXJzKCkge1xuICAgICAgICBjb25zdCBuZXdDb3JuZXJzID0gW107XG5cbiAgICAgICAgLy8gQ2FsY3VsYXRlIG5ldyBjb3JuZXIgcG9zaXRpb25zXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5jb3JuZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBsZXQgY29ybmVyID0gdGhpcy5jb3JuZXJzW2ldO1xuXG4gICAgICAgICAgICBpZiAoY29ybmVyLmJvcmRlcikge1xuICAgICAgICAgICAgICAgIG5ld0Nvcm5lcnNbaV0gPSBjb3JuZXI7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxldCBuZXdQb3MgPSBWZWN0b3IuemVybygpO1xuXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBuZWlnaGJvciBvZiBjb3JuZXIudG91Y2hlcykge1xuICAgICAgICAgICAgICAgICAgICBuZXdQb3MgPSBWZWN0b3IuYWRkKG5ld1BvcywgbmVpZ2hib3IpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIG5ld1BvcyA9IG5ld1Bvcy5kaXZpZGUoY29ybmVyLnRvdWNoZXMubGVuZ3RoKTtcbiAgICAgICAgICAgICAgICBuZXdDb3JuZXJzW2ldID0gbmV3UG9zO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5sb2cobmV3Q29ybmVycyk7XG5cbiAgICAgICAgLy8gQXNzaWduIG5ldyBjb3JuZXIgcG9zaXRpb25zXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5jb3JuZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB0aGlzLmNvcm5lcnNbaV0ueCA9IG5ld0Nvcm5lcnNbaV0ueDtcbiAgICAgICAgICAgIHRoaXMuY29ybmVyc1tpXS55ID0gbmV3Q29ybmVyc1tpXS55O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVjb21wdXRlIGVkZ2UgbWlkcG9pbnRzXG4gICAgICAgIGZvciAobGV0IGVkZ2Ugb2YgdGhpcy5lZGdlcykge1xuICAgICAgICAgICAgaWYgKGVkZ2UudjAgJiYgZWRnZS52MSkge1xuICAgICAgICAgICAgICAgIGVkZ2UubWlkcG9pbnQgPSBWZWN0b3IubWlkcG9pbnQoZWRnZS52MCwgZWRnZS52MSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIFNvcnRzIHRoZSBjb3JuZXJzIGluIGNsb2Nrd2lzZSBvcmRlciBzbyB0aGF0IHRoZXkgY2FuIGJlIHByaW50ZWQgcHJvcGVybHlcbiAgICAvLyB1c2luZyBhIHN0YW5kYXJkIHBvbHlnb24gZHJhd2luZyBtZXRob2RcblxuICAgIHNvcnRDb3JuZXJzKCkge1xuICAgICAgICBmb3IgKGNvbnN0IGNlbnRlciBvZiB0aGlzLmNlbnRlcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbXAgPSB0aGlzLmNvbXBhcmVQb2x5UG9pbnRzKGNlbnRlcik7XG4gICAgICAgICAgICBjZW50ZXIuY29ybmVycy5zb3J0KGNvbXApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBDb21wYXJpc29uIGZ1bmN0aW9uIGZvciBzb3J0aW5nIHBvbHlnb24gcG9pbnRzIGluIGNsb2Nrd2lzZSBvcmRlclxuICAgIC8vIGFzc3VtaW5nIGEgY29udmV4IHBvbHlnb25cbiAgICAvLyBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzY5ODkxMDAvc29ydC1wb2ludHMtaW4tY2xvY2t3aXNlLW9yZGVyXG4gICAgY29tcGFyZVBvbHlQb2ludHMoYykge1xuICAgICAgICBjb25zdCBjZW50ZXIgPSBjO1xuICAgICAgICByZXR1cm4gKHAxLCBwMikgPT4ge1xuICAgICAgICAgICAgY29uc3QgYSA9IHAxLFxuICAgICAgICAgICAgICAgIGIgPSBwMjtcblxuICAgICAgICAgICAgaWYgKGEueCAtIGNlbnRlci54ID49IDAgJiYgYi54IC0gY2VudGVyLnggPCAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIC0xO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGEueCAtIGNlbnRlci54IDwgMCAmJiBiLnggLSBjZW50ZXIueCA+PSAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoYS54IC0gY2VudGVyLnggPT09IDAgJiYgYi54IC0gY2VudGVyLnggPT09IDApIHtcbiAgICAgICAgICAgICAgICBpZiAoYS55IC0gY2VudGVyLnkgPj0gMCB8fCBiLnkgLSBjZW50ZXIueSA+PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChhLnkgPiBiLnkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAtMTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAxO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChiLnkgPiBhLnkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIC0xO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAxO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gY29tcHV0ZSB0aGUgY3Jvc3MgcHJvZHVjdCBvZiB2ZWN0b3JzIChjZW50ZXIgLT4gYSkgeCAoY2VudGVyIC0+IGIpXG4gICAgICAgICAgICBjb25zdCBkZXQgPSAoYS54IC0gY2VudGVyLngpICogKGIueSAtIGNlbnRlci55KSAtIChiLnggLSBjZW50ZXIueCkgKiAoYS55IC0gY2VudGVyLnkpO1xuICAgICAgICAgICAgaWYgKGRldCA8IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gLTE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZGV0ID4gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAxO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBwb2ludHMgYSBhbmQgYiBhcmUgb24gdGhlIHNhbWUgbGluZSBmcm9tIHRoZSBjZW50ZXJcbiAgICAgICAgICAgIC8vIGNoZWNrIHdoaWNoIHBvaW50IGlzIGNsb3NlciB0byB0aGUgY2VudGVyXG4gICAgICAgICAgICBjb25zdCBkMSA9IChhLnggLSBjZW50ZXIueCkgKiAoYS54IC0gY2VudGVyLngpICsgKGEueSAtIGNlbnRlci55KSAqIChhLnkgLSBjZW50ZXIueSk7XG4gICAgICAgICAgICBjb25zdCBkMiA9IChiLnggLSBjZW50ZXIueCkgKiAoYi54IC0gY2VudGVyLngpICsgKGIueSAtIGNlbnRlci55KSAqIChiLnkgLSBjZW50ZXIueSk7XG4gICAgICAgICAgICBpZiAoZDEgPiBkMikge1xuICAgICAgICAgICAgICAgIHJldHVybiAtMTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfTtcbiAgICB9XG5cbn1cblxuZXhwb3J0IGRlZmF1bHQgR3JhcGg7IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi4vZ2VvbWV0cnkvVmVjdG9yXCI7XG5pbXBvcnQgUG9seWdvbiBmcm9tIFwiLi4vZ2VvbWV0cnkvUG9seWdvblwiO1xuXG5jbGFzcyBUaWxlIGV4dGVuZHMgUG9seWdvbiB7XG4gICAgY29uc3RydWN0b3IoY2VudGVyLCBjb3JuZXJzLCBlZGdlcykge1xuICAgICAgICBcbiAgICAgICAgc3VwZXIoY29ybmVycywgY2VudGVyKTtcbiAgICAgICAgdGhpcy5lZGdlcyA9IGVkZ2VzO1xuICAgICAgICB0aGlzLm5laWdoYm9ycyA9IFtdO1xuXG4gICAgICAgIHRoaXMuZGF0YSA9IHt9O1xuXG4gICAgICAgIHRoaXMucGFyZW50ID0gbnVsbDtcbiAgICAgICAgdGhpcy5jaGlsZHJlbiA9IG51bGw7XG5cbiAgICAgICAgLy8gUmVjdXJzaXZlIFBhcmFtZXRlcnNcbiAgICAgICAgLy8gdGhpcy5wYXJlbnQgPSBwYXJlbnQ7XG4gICAgICAgIC8vIHRoaXMuY2hpbGRyZW4gPSBjaGlsZHJlbiA/IGNoaWxkcmVuIDogW107XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBuZWlnaGJvcmluZyB0aWxlIGNsb3Nlc3QgdG8gYSBwYXJ0aWN1bGFyIGRpcmVjdGlvblxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBkaXJlY3Rpb24gVGhlIGRpcmVjdGlvbiBmcm9tIHRoZSBjdXJyZW50IHRpbGUgdG8gdGhlXG4gICAgICogIG5laWdoYm9yaW5nIHRpbGUuIChEaXJlY3Rpb25zIGFyZSBhc3N1bWVkIHRvIHN0YXJ0IGZyb20gdGhlIG9yaWdpbilcbiAgICAgKiBcbiAgICAgKiBAcmV0dXJuIHtUaWxlfSBUaGUgbmVpZ2hib3JpbmcgdGlsZSB3aGljaCBpcyBjbG9zZXN0IHRvIHRoZSBpbnB1dFxuICAgICAqICBkaXJlY3Rpb24uXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFRpbGVcbiAgICAgKi9cbiAgICBnZXROZWlnaGJvcihkaXJlY3Rpb24pIHtcbiAgICAgICAgbGV0IG1pbkFuZ2xlID0gTWF0aC5QSTtcbiAgICAgICAgbGV0IGNsb3Nlc3QgPSB0aGlzLm5laWdoYm9yc1swXTtcblxuICAgICAgICBmb3IgKGNvbnN0IG5laWdoYm9yIG9mIHRoaXMubmVpZ2hib3JzKSB7XG4gICAgICAgICAgICBsZXQgYW5nID0gVmVjdG9yLmFuZ2xlKFxuICAgICAgICAgICAgICAgIFZlY3Rvci5zdWJ0cmFjdChuZWlnaGJvci5jZW50ZXIsIHRoaXMuY2VudGVyKSwgZGlyZWN0aW9uKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGFuZyA8IG1pbkFuZ2xlKSB7XG4gICAgICAgICAgICAgICAgbWluQW5nbGUgPSBhbmc7XG4gICAgICAgICAgICAgICAgY2xvc2VzdCA9IG5laWdoYm9yO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNsb3Nlc3Q7XG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBUaWxlOyIsIi8vIEdlb21ldHJ5XG5pbXBvcnQgVmVjdG9yIGZyb20gXCIuL2dlb21ldHJ5L1ZlY3RvclwiO1xuaW1wb3J0IExpbmUgZnJvbSBcIi4vZ2VvbWV0cnkvTGluZVwiO1xuaW1wb3J0IFBvbHlnb24gZnJvbSBcIi4vZ2VvbWV0cnkvUG9seWdvblwiO1xuaW1wb3J0IFJlY3RhbmdsZSBmcm9tIFwiLi9nZW9tZXRyeS9SZWN0YW5nbGVcIjtcbmltcG9ydCBUcmlhbmdsZSBmcm9tIFwiLi9nZW9tZXRyeS9UcmlhbmdsZVwiO1xuXG4vLyBHcmFwaFxuaW1wb3J0IENlbnRlciBmcm9tIFwiLi9ncmFwaC9DZW50ZXJcIjtcbmltcG9ydCBDb3JuZXIgZnJvbSBcIi4vZ3JhcGgvQ29ybmVyXCI7XG5pbXBvcnQgRWRnZSBmcm9tIFwiLi9ncmFwaC9FZGdlXCI7XG5pbXBvcnQgR3JhcGggZnJvbSBcIi4vZ3JhcGgvR3JhcGhcIjtcbmltcG9ydCBEaWFncmFtIGZyb20gXCIuL2dyYXBoL0RpYWdyYW1cIjtcblxuLy8gVXRpbGl0aWVzXG5pbXBvcnQgKiBhcyBQb2ludERpc3RyaWJ1dGlvbiBmcm9tIFwiLi9VdGlsaXRpZXMvUG9pbnREaXN0cmlidXRpb25cIjtcbmltcG9ydCAqIGFzIFJlZGlzdCBmcm9tIFwiLi91dGlsaXRpZXMvUmVkaXN0XCI7XG5pbXBvcnQgUmFuZCBmcm9tIFwiLi91dGlsaXRpZXMvUmFuZFwiO1xuaW1wb3J0ICogYXMgSGVscGVycyBmcm9tIFwiLi91dGlsaXRpZXMvVXRpbFwiO1xuXG4vLyBBbGdvcml0aG1zXG5pbXBvcnQgYmluYXJ5U3BhY2VQYXJ0aXRpb24gZnJvbSBcIi4vYWxnb3JpdGhtcy9CaW5hcnlTcGFjZVBhcnRpdGlvblwiO1xuaW1wb3J0IHJlY3Vyc2l2ZVZvcm9ub2kgZnJvbSBcIi4vYWxnb3JpdGhtcy9SZWN1cnNpdmVWb3Jvbm9pXCI7XG5cbi8qKlxuICogVGhlIEF0dW0gcHJvY2VkdXJhbCBncmFwaCBiYXNlZCBsaWJyYXJ5XG4gKiBcbiAqIEBleHBvcnRcbiAqIEBtb2R1bGUgQXR1bVxuICogQHNlZSB7QGxpbmsgaHR0cHM6Ly9naXRodWIuY29tL0V2ZWxpb3MvQXR1bX1cbiAqL1xuY29uc3QgQXR1bSA9IHtcbiAgICBHZW9tZXRyeToge1xuICAgICAgICBWZWN0b3IsXG4gICAgICAgIExpbmUsXG4gICAgICAgIFBvbHlnb24sXG4gICAgICAgIFJlY3RhbmdsZSxcbiAgICAgICAgVHJpYW5nbGVcbiAgICB9LFxuICAgIEdyYXBoOiB7XG4gICAgICAgIENlbnRlcixcbiAgICAgICAgQ29ybmVyLFxuICAgICAgICBFZGdlLFxuICAgICAgICBHcmFwaCxcbiAgICAgICAgRGlhZ3JhbVxuICAgIH0sXG4gICAgVXRpbGl0eToge1xuICAgICAgICBQb2ludERpc3RyaWJ1dGlvbixcbiAgICAgICAgUmVkaXN0LFxuICAgICAgICBSYW5kLFxuICAgICAgICBIZWxwZXJzXG4gICAgfSxcbiAgICBBbGdvcml0aG06IHtcbiAgICAgICAgYmluYXJ5U3BhY2VQYXJ0aXRpb24sXG4gICAgICAgIHJlY3Vyc2l2ZVZvcm9ub2lcbiAgICB9XG59O1xuXG5leHBvcnQgZGVmYXVsdCBBdHVtOyIsIi8qKlxuICogVGhlc2VzIGZ1bmN0aW9uIGFyZSB1c2VkIHRvIHJlZGlzdHJpYnV0ZSBkYXRhIGxvY2F0ZWQgaW4gdGhlIHJhbmdlIDAtMVxuICogVGhleSB0YWtlIGFsbCB0aGUgZGF0YSBhbmQgcmVhcnJhbmdlIHRoZW0gYW5kIHB1cnR1cmJlIHRoZW0gc2xpZ2h0bHkgc28gdGhhdFxuICogdGhleSBmaXQgYSBwYXJ0aWN1bGFyIGRpc3RydWJ1dGlvbiBmdW5jdGlvbi4gRm9yIGV4YW1wbGUgeW91IGNhbiB1c2UgdGhlc2VcbiAqIHRvIHB1c2ggYWxsIHRoZSBkYXRhIHBvaW50cyBjbG9zZXIgdG8gMSBzbyB0aGF0IHRoZXJlIGFyZSBmZXcgcG9pbnRzIG5lYXIgMFxuICogZWFjaCByZWRpc3RyaWJ1dGlvbiBmdW5jdGlvbiBoYXMgZGlmZmVyZW50IHByb3BlcnRpZXMuXG4gKlxuICogUHJvcGVydGllcyBvZiB0aGVzZSBmdW5jdGlvbnNcbiAqIHRoZSBkb21haW4gaXMgKDAtMSkgZm9yIHRoZSByYW5nZSAoMC0xKVxuICogaW4gdGhpcyByYW5nZSB0aGUgZnVuY3Rpb24gaXMgb25lIHRvIG9uZVxuICogZigwKSA9PSAwIGFuZCBmKDEpID09IDFcbiAqIFxuICogQHN1bW1hcnkgRnVuY3Rpb25zIHVzZWQgdG8gcmVkaXN0cnVidXRlIHZhbHVlcyBpbiB0aGUgcmFuZ2UgMC0xXG4gKiBAY2xhc3MgUmVkaXN0XG4gKi9cblxuXCJ1c2Ugc3RyaWN0XCI7XG5cbi8qKlxuICogVGhlIGlkZW50aXR5IGZ1bmN0aW9uLiBJdCByZXR1cm5zIHRoZSBpbnB1dCB2YWx1ZSB4XG4gKiBcbiAqIEBleHBvcnRcbiAqIEBmdW5jdGlvblxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIGlucHV0IG51bWJlciBpbiB0aGUgcmFuZ2UgWzAtMV1cbiAqIEByZXR1cm5zIHtOdW1iZXJ9IElucHV0IHZhbHVlXG4gKiBAbWVtYmVyb2YgUmVkaXN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpZGVudGl0eSh4KSB7XG4gICAgcmV0dXJuIHg7XG59XG5cbi8qKlxuICogVGhlIGludmVyc2UgZnVjdGlvbi4gSXQgcmV0dXJucyB0aGUgb3Bwb3NpdGUgb2YgdGhlIGZ1bmN0aW9uIGluIHRoZSByYW5nZVxuICogZnJvbSBbMC0xXS4gVGhpcyBpcyBzaW1wbHkgMSAtIHguXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBmdW5jdGlvblxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIGlucHV0IG51bWJlciBpbiB0aGUgcmFuZ2UgWzAtMV1cbiAqIEByZXR1cm5zIHtOdW1iZXJ9IFRoZSByZWRpc3RyaWJ1dGVkIGlucHV0IHZhbHVlLCAxIC0geFxuICogQG1lbWJlcm9mIFJlZGlzdFxuICovXG5leHBvcnQgZnVuY3Rpb24gaW52ZXJzZSh4KSB7XG4gICAgcmV0dXJuIDEgLSB4O1xufVxuXG4vKipcbiAqIEV4cG9uZW50aWFsIHJlZGlzdHJpYnV0aW9uIGZ1bmN0aW9uLiBUaGlzIGZ1bmN0aW9uIHNrZXdzIHRoZSB2YWx1ZXMgZWl0aGVyXG4gKiB1cCBvciBkb3duIGJ5IGEgcGFydGljdWxhciBhbW1vdW50IGFjY29yZGluZyB0aGUgaW5wdXQgcGFyYW1ldGVycy4gVGhlXG4gKiBvdXRwdXQgZGlzdHJpYnV0aW9uIHdpbGwgYmUgc2xpZ2h0IGV4cG9uZW50aWFsIHNoYXBlZC5cbiAqIFxuICogQGV4cG9ydFxuICogQGZ1bmN0aW9uXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgaW5wdXQgbnVtYmVyIGluIHRoZSByYW5nZSBbMC0xXVxuICogQHBhcmFtIHtOdW1iZXJ9IFthbW09MV0gVGhlIHN0cmVuZ3RoIG9mIHRoZSByZWRpc3RyaWJ1dGlvblxuICogQHBhcmFtIHtCb29sZWFufSBbaW5jPXRydWVdIElmIHlvdSB3YW50IHRvIGluY3JlYXNlIG9yIGRlY3JlYXNlIHRoZSBpbnB1dFxuICogQHJldHVybnMge051bWJlcn0gVGhlIHJlZGlzdHJpYnV0ZWQgaW5wdXQgdmFsdWVcbiAqIEBtZW1iZXJvZiBSZWRpc3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4cCh4LCBhbW0gPSAxLCBpbmMgPSB0cnVlKSB7XG4gICAgbGV0IG5vbSwgZGVub207XG4gICAgaWYgKGluYykge1xuICAgICAgICBub20gPSAxIC0gTWF0aC5leHAoLWFtbSAqIHgpO1xuICAgICAgICBkZW5vbSA9IDEgLSBNYXRoLmV4cCgtYW1tKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBub20gPSBNYXRoLmV4cChhbW0gKiB4KSAtIDE7XG4gICAgICAgIGRlbm9tID0gTWF0aC5leHAoYW1tKSAtIDE7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5vbSAvIGRlbm9tO1xufVxuXG4vLyBQb3dlciBGdW5jdGlvbiBlZyBzcXJ0IHF1YnJ0XG4vKipcbiAqIFBvd2VyIHJlZGlzdHJpYnV0aW9uIGZ1bmN0aW9uLiBUaGlzIGZ1bmN0aW9uIHNrZXdzIHZhbHVlcyBlaXRoZXIgdXAgb3IgZG93blxuICogYnkgYSBwYXJ0aWN1bGFyIGFtbW91bnQgYWNjb3JkaW5nIHRvIHRoZSBpbnB1dCBwYXJhbWV0ZXJzLiBUaGUgcG93ZXIgXG4gKiBkaXN0cmlidXRpb24gYWxzbyBoYXMgYSBzbGlnaHQgc2tldyB1cCBvciBkb3duIG9uIHRvcCBvZiB0aGUgcmVkaXN0cmlidXRpb24uXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBmdW5jdGlvblxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIGlucHV0IG51bWJlciBpbiB0aGUgcmFuZ2UgWzAtMV0gXG4gKiBAcGFyYW0ge051bWJlcn0gW2FtbT0yXSBUaGUgc3RyZW5ndGggb2YgdGhlIHJlZGlzdHJpYnV0aW9uXG4gKiBAcGFyYW0ge0Jvb2xlYW59IFtpbmM9dHJ1ZV0gSWYgeW91IHdhbnQgdG8gaW5jcmVhc2Ugb3IgZGVjcmVhc2UgdGhlIGlucHV0XG4gKiBAcGFyYW0ge0Jvb2xlYW59IFtza2V3RG93bj10cnVlXSBJZiB5b3Ugd2FudCB0byBza2V3IHRoZSBpbnB1dCB2YWx1ZSBkb3duXG4gKiAgdG93YXJkcyAwLCB0aGVuIHNrZXdEb3duPXRydWUuIElmIHlvdSB3YW50IHRvIHNrZXcgdGhlIGlucHV0IHZhbHVlIHVwIFxuICogIHRvd2FyZHMgMSwgdGhlbiBza2V3RG93bj1mYWxzZVxuICogQHJldHVybnMge051bWJlcn0gVGhlIHJlZGlzdHJpYnV0ZWQgaW5wdXQgdmFsdWVcbiAqIEBtZW1iZXJvZiBSZWRpc3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBvdyh4LCBhbW0gPSAyLCBpbmMgPSB0cnVlLCBza2V3RG93biA9IHRydWUpIHtcbiAgICBpZiAoaW5jKSB7XG4gICAgICAgIGlmIChza2V3RG93bikge1xuICAgICAgICAgICAgcmV0dXJuIE1hdGgucG93KHgsIDEgLyBhbW0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIDEgLSBNYXRoLnBvdygxIC0geCwgYW1tKTtcbiAgICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChza2V3RG93bikge1xuICAgICAgICAgICAgcmV0dXJuIE1hdGgucG93KHgsIGFtbSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gMSAtIE1hdGgucG93KDEgLSB4LCAxIC8gYW1tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLyoqXG4gKiBUdXJucyBhIGNvbnRpbmlvdXMgZnVuY3Rpb24gYW5kIHR1cm5zIGl0IGludG8gYSBkaXNjcmV0ZSBmdW5jdGlvbiB0aGF0IGhhc1xuICogYSBzcGVjaWZpYyBudW1iZXIgb2YgYmlucyB0byBidXQgdGhlIGRpc3RyaWJ1dGlvbiBpbnRvLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAZnVuY3Rpb25cbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSBpbnB1dCBudW1iZXIgaW4gdGhlIHJhbmdlIFswLTFdXG4gKiBAcGFyYW0ge051bWJlcn0gW2JpbnM9MTBdIFRoZSBudW1iZXIgb2YgYmlucyBmb3IgdGhlIGRpc2NyaXRlIGRpc3RyaWJ1dGlvblxuICogQHJldHVybnMge051bWJlcn0gVGhlIGRpc2NyZXRpemVkIGlucHV0IHZhbHVlXG4gKiBAbWVtYmVyb2YgUmVkaXN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGVwKHgsIGJpbnMgPSAxMCkge1xuICAgIHJldHVybiBNYXRoLmZsb29yKGJpbnMgKiB4KSAvIGJpbnM7XG59IiwiLyoqXHJcbiAqIEEgdXRpbGl0eSBmaWxlIHdpdGggaGVscGVyIGZ1bmN0aW9ucyB0aGF0IGNhbiBiZSB1c2VkIHRvIGFpZCBpbiB0aGVcclxuICogZGV2ZWxvcG1lbnQgb2YgdGhlIHBhY2thZ2UuXHJcbiAqL1xyXG5cInVzZSBzdHJpY3RcIjtcclxuXHJcbi8vIFVzZWQgZm9yIHRlc3RpbmcgaWYgYW4gb2JqZWN0IGNvbnRhaW5zIGEgcGFydGljdWxhciBwcm9wZXJ0eVxyXG4vLyBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzcxNzQ3NDgvamF2YXNjcmlwdC1vYmplY3QtZGV0ZWN0aW9uLWRvdC1zeW50YXgtdmVyc3VzLWluLWtleXdvcmQvNzE3NDc3NSM3MTc0Nzc1XHJcbmV4cG9ydCBmdW5jdGlvbiBoYXMob2JqLCBwcm9wKSB7IHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBwcm9wKTsgfTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzZXRPcHRpb25zKG9wdGlvbnMsIGRlZmF1bHRzKSB7XHJcbiAgICBsZXQgb3V0ID0ge307XHJcbiAgICBmb3IgKGNvbnN0IHYgaW4gZGVmYXVsdHMpIHtcclxuICAgICAgICBvdXRbdl0gPSBvcHRpb25zW3ZdID8gb3B0aW9uc1t2XSA6IGRlZmF1bHRzW3ZdO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG91dDtcclxufVxyXG5cclxuLy8gTnVtYmVyIG1hcCBmcm9tIG9uZSByYW5nZSB0byBhbm90aGVyIHJhbmdlXHJcbi8vIGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL3hwb3NlZGJvbmVzLzc1ZWJhZWYzYzEwMDYwYTNlZTNiMjQ2MTY2Y2FhYjU2XHJcbk51bWJlci5wcm90b3R5cGUubWFwID0gZnVuY3Rpb24gKGluX21pbiwgaW5fbWF4LCBvdXRfbWluLCBvdXRfbWF4KSB7XHJcbiAgICByZXR1cm4gKHRoaXMgLSBpbl9taW4pICogKG91dF9tYXggLSBvdXRfbWluKSAvIChpbl9tYXggLSBpbl9taW4pICsgb3V0X21pbjtcclxufTsiXX0=
