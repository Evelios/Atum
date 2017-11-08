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
        return new _Vector2.default(point);
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

},{"../geometry/Rectangle":16,"../geometry/Vector":19,"./Rand":13,"poisson-disk-sample":3}],13:[function(require,module,exports){
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
    }]);

    return Rand;
}();

exports.default = Rand;
module.exports = exports["default"];

},{"../geometry/Vector":19,"seedRandom":4}],14:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _Shape = require("./Shape");

var _Shape2 = _interopRequireDefault(_Shape);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Line =
/**
 * @class Line
 * @extends Shape
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
};

exports.default = Line;
module.exports = exports["default"];

},{"./Shape":17}],15:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Vector = require("./Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Shape = require("./Shape");

var _Shape2 = _interopRequireDefault(_Shape);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _extendableBuiltin(cls) {
    function ExtendableBuiltin() {
        var instance = Reflect.construct(cls, Array.from(arguments));
        Object.setPrototypeOf(instance, Object.getPrototypeOf(this));
        return instance;
    }

    ExtendableBuiltin.prototype = Object.create(cls.prototype, {
        constructor: {
            value: cls,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });

    if (Object.setPrototypeOf) {
        Object.setPrototypeOf(ExtendableBuiltin, cls);
    } else {
        ExtendableBuiltin.__proto__ = cls;
    }

    return ExtendableBuiltin;
}

var Polygon = function (_extendableBuiltin2) {
    _inherits(Polygon, _extendableBuiltin2);

    /**
     * @class Polygon
     * @extends Array
     * 
     * Class to store polygon information in an array format that also gives it
     * extra functionality on top of it. This can also server as a base class
     * for more specific geometric shapes.
     * 
     * @summary Creates an instance of Polygon.
     * 
     * @property {Vector} center The center of the polygon. If not otherwise
     *  stated, the center defaults to the centriod. Any transformations on
     *  the polygon are done about the center of the polygon.
     * 
     * @param {Vector} [center=average(verticies)] The center of the polygon.
     *  If a value is not provided the default value becomes the centroid of
     *  the verticies.
     */
    function Polygon() {
        var verticies = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
        var center = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

        _classCallCheck(this, Polygon);

        if (verticies) {
            var _ref;

            var _this = _possibleConstructorReturn(this, (_ref = Polygon.__proto__ || Object.getPrototypeOf(Polygon)).call.apply(_ref, [this].concat(_toConsumableArray(verticies))));
        } else {
            var _this = _possibleConstructorReturn(this, (Polygon.__proto__ || Object.getPrototypeOf(Polygon)).call(this));
        }
        _this.center = center ? center : _this.centroid();
        return _possibleConstructorReturn(_this);
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
            return _Vector2.default.avg(this);
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
    }]);

    return Polygon;
}(_extendableBuiltin(Array));

exports.default = Polygon;
module.exports = exports["default"];

},{"./Shape":17,"./Vector":19}],16:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Vector = require("./Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Polygon2 = require("./Polygon");

var _Polygon3 = _interopRequireDefault(_Polygon2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Rectangle = function (_Polygon) {
    _inherits(Rectangle, _Polygon);

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

        var points = [position, _Vector2.default.add(position, new _Vector2.default(width, 0)), _Vector2.default.add(position, new _Vector2.default(width, height)), _Vector2.default.add(position, new _Vector2.default(0, height))];

        var _this = _possibleConstructorReturn(this, (Rectangle.__proto__ || Object.getPrototypeOf(Rectangle)).call(this, points));

        _this.position = position;
        _this.x = position.x;
        _this.y = position.y;
        _this.width = width;
        _this.height = height;
        _this.area = width * height;
        return _this;
    }

    _createClass(Rectangle, [{
        key: "contains",
        value: function contains(vector) {
            return vector.x > this.position.x && vector.x < this.position.x + this.width && vector.y > this.position.y && vector.y < this.positoin.y + this.height;
        }
    }]);

    return Rectangle;
}(_Polygon3.default);

exports.default = Rectangle;
module.exports = exports["default"];

},{"./Polygon":15,"./Vector":19}],17:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _Vector = require("./Vector");

var _Vector2 = _interopRequireDefault(_Vector);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _extendableBuiltin(cls) {
    function ExtendableBuiltin() {
        var instance = Reflect.construct(cls, Array.from(arguments));
        Object.setPrototypeOf(instance, Object.getPrototypeOf(this));
        return instance;
    }

    ExtendableBuiltin.prototype = Object.create(cls.prototype, {
        constructor: {
            value: cls,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });

    if (Object.setPrototypeOf) {
        Object.setPrototypeOf(ExtendableBuiltin, cls);
    } else {
        ExtendableBuiltin.__proto__ = cls;
    }

    return ExtendableBuiltin;
}

var Shape = function (_extendableBuiltin2) {
    _inherits(Shape, _extendableBuiltin2);

    /**
     * @class Shape
     * 
     * This is an abstract base class for shapes. The shapes are stored in an array
     * format as a list of Vectors. This allows for easy manipulation and access to
     * the points that make up the shape.
     * 
     * @summary Creates an instance of Shape.
     * 
     * @param {Vector[]} [verticies] The shapes vector verticies
     */
    function Shape(verticies) {
        _classCallCheck(this, Shape);

        if (verticies) {
            var _ref;

            var _this = _possibleConstructorReturn(this, (_ref = Shape.__proto__ || Object.getPrototypeOf(Shape)).call.apply(_ref, [this].concat(_toConsumableArray(verticies))));
        } else {
            var _this = _possibleConstructorReturn(this, (Shape.__proto__ || Object.getPrototypeOf(Shape)).call(this));
        }
        return _possibleConstructorReturn(_this);
    }

    return Shape;
}(_extendableBuiltin(Array));

exports.default = Shape;
module.exports = exports["default"];

},{"./Vector":19}],18:[function(require,module,exports){
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

},{"./Polygon":15,"./Vector":19}],19:[function(require,module,exports){
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

    //---- Helper Functions ----

    /**
     * Internal Helper Function for setting variable properties
     * 
     * @private
     * @param {number} x The x component
     * @param {number} y The y component
     * @memberof Vector
     */


    _createClass(Vector, [{
        key: "_set",
        value: function _set(x, y) {
            this.__proto__[0] = x;
            this.__proto__[1] = y;
            this.x = x;
            this.y = y;
        }

        /**
         * Get the vector key:Symbol representation
         * 
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
         * Get the vector in list form
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

},{}],20:[function(require,module,exports){
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
        _this.neighbors = []; // new Polygon(); // Centers
        _this.borders = []; // Edges
        _this.corners = []; //new Polygon();
        _this.border = false;

        // Higher Level Properties
        _this.data = {};

        // Recursive Parameters
        _this.parent = parent;
        _this.children = children ? children : [];
        return _this;
    }

    return Center;
}(_Vector3.default);

exports.default = Center;
module.exports = exports["default"];

},{"../geometry/Polygon":15,"../geometry/Vector":19}],21:[function(require,module,exports){
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
        _this.touches = []; //new Polygon(); // Centers
        _this.protrudes = []; // Edges
        _this.adjacent = []; //new Polygon(); // Corners
        return _this;
    }

    return Corner;
}(_Vector3.default);

exports.default = Corner;
module.exports = exports["default"];

},{"../geometry/Polygon":15,"../geometry/Vector":19}],22:[function(require,module,exports){
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

"use strict";

// Need to ES6ify

var Diagram = function () {
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
     * @class Diagram
     */
    function Diagram(points, bbox) {
        var relaxations = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
        var improveCorners = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

        _classCallCheck(this, Diagram);

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
        while (relaxations--) {
            var sites = this.relaxSites(this._voronoi);
            rhillVoronoi.recycle(this._voronoi);
            this._voronoi = rhillVoronoi.compute(sites, this._rhillbbox);
        }

        this.convertDiagram(this._voronoi);

        if (improveCorners) {
            this.improveCorners();
        }
        this.sortCorners();
    }

    _createClass(Diagram, [{
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
        // Helper function to create diagram
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

            // Assign new corner positions
            for (var _i = 0; _i < this.corners.length; _i++) {
                var _corner = this.corners[_i];
                _corner = newCorners[_i];
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

    return Diagram;
}();

exports.default = Diagram;
module.exports = exports["default"];

},{"../geometry/Vector":19,"../utilities/Util":28,"./Center":20,"./Corner":21,"./Edge":23,"Voronoi":1}],23:[function(require,module,exports){
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

},{"../geometry/Line":14,"../geometry/Vector":19}],24:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Diagram2 = require("./Diagram");

var _Diagram3 = _interopRequireDefault(_Diagram2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Map = function (_Diagram) {
    _inherits(Map, _Diagram);

    /**
     * Creates an instance of Map.
     * 
     * @param {any} points 
     * @param {any} bbox 
     * @param {number} [relaxations=0] 
     * @param {boolean} [improveCorners=false] 
     * 
     * @class Map
     * @extends Diagram
     */
    function Map(points, bbox) {
        var relaxations = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
        var improveCorners = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

        _classCallCheck(this, Map);

        return _possibleConstructorReturn(this, (Map.__proto__ || Object.getPrototypeOf(Map)).call(this, points, bbox, relaxations = 0, improveCorners = false));
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
     * @memberOf Map
     */


    _createClass(Map, [{
        key: "_generate",
        value: function _generate(ruleset) {
            // Run cellular automita
            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = this.centers[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var center = _step.value;

                    center._data = ruleset(center);
                }

                // Update automita actions
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
                for (var _iterator2 = this.centers[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                    var _center = _step2.value;

                    // Update only the new data that has changed
                    for (var key in _center._data) {
                        if (_center._data.hasOwnProperty(key)) {
                            _center.data[key] = _center._data[key];
                        }
                    }
                    delete _center._data;
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
    }]);

    return Map;
}(_Diagram3.default);

exports.default = Map;
module.exports = exports["default"];

},{"./Diagram":22}],25:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _Vector = require("./geometry/Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Shape = require("./geometry/Shape");

var _Shape2 = _interopRequireDefault(_Shape);

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

var _Diagram = require("./graph/Diagram");

var _Diagram2 = _interopRequireDefault(_Diagram);

var _Map = require("./graph/Map");

var _Map2 = _interopRequireDefault(_Map);

var _PointDistribution = require("./Utilities/PointDistribution");

var PointDistribution = _interopRequireWildcard(_PointDistribution);

var _Redist = require("./utilities/Redist");

var Redist = _interopRequireWildcard(_Redist);

var _Rand = require("./utilities/Rand");

var _Rand2 = _interopRequireDefault(_Rand);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * The Atum procedural graph based library
 * 
 * @export
 * @module Atum
 * @see {@link https://github.com/Evelios/Atum}
 */
var Atum = {
    Geometry: {
        Vector: _Vector2.default,
        Shape: _Shape2.default,
        Line: _Line2.default,
        Polygon: _Polygon2.default,
        Rectangle: _Rectangle2.default,
        Triangle: _Triangle2.default
    },
    Graph: {
        Center: _Center2.default,
        Corner: _Corner2.default,
        Edge: _Edge2.default,
        Diagram: _Diagram2.default,
        Map: _Map2.default
    },
    Utility: {
        PointDistribution: PointDistribution,
        Redist: Redist,
        Rand: _Rand2.default
    }
};

exports.default = Atum;
module.exports = exports["default"];

},{"./Utilities/PointDistribution":12,"./geometry/Line":14,"./geometry/Polygon":15,"./geometry/Rectangle":16,"./geometry/Shape":17,"./geometry/Triangle":18,"./geometry/Vector":19,"./graph/Center":20,"./graph/Corner":21,"./graph/Diagram":22,"./graph/Edge":23,"./graph/Map":24,"./utilities/Rand":26,"./utilities/Redist":27}],26:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"../geometry/Vector":19,"dup":13,"seedRandom":4}],27:[function(require,module,exports){
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

},{}],28:[function(require,module,exports){
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
var has = exports.has = function has(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
};

},{}]},{},[25])(25)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvVm9yb25vaS9yaGlsbC12b3Jvbm9pLWNvcmUuanMiLCJub2RlX21vZHVsZXMvYnJvd3Nlci1yZXNvbHZlL2VtcHR5LmpzIiwibm9kZV9tb2R1bGVzL3BvaXNzb24tZGlzay1zYW1wbGUvcG9pc3Nvbi1kaXNrLmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vaW5kZXguanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIvYWxlYS5qcyIsIm5vZGVfbW9kdWxlcy9zZWVkUmFuZG9tL2xpYi90eWNoZWkuanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIveG9yMTI4LmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vbGliL3hvcjQwOTYuanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIveG9yc2hpZnQ3LmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vbGliL3hvcndvdy5qcyIsIm5vZGVfbW9kdWxlcy9zZWVkUmFuZG9tL3NlZWRyYW5kb20uanMiLCJzcmNcXFV0aWxpdGllc1xcUG9pbnREaXN0cmlidXRpb24uanMiLCJzcmNcXFV0aWxpdGllc1xcUmFuZC5qcyIsInNyY1xcZ2VvbWV0cnlcXExpbmUuanMiLCJzcmNcXGdlb21ldHJ5XFxQb2x5Z29uLmpzIiwic3JjXFxnZW9tZXRyeVxcUmVjdGFuZ2xlLmpzIiwic3JjXFxnZW9tZXRyeVxcU2hhcGUuanMiLCJzcmNcXGdlb21ldHJ5XFxUcmlhbmdsZS5qcyIsInNyY1xcZ2VvbWV0cnlcXFZlY3Rvci5qcyIsInNyY1xcZ3JhcGhcXENlbnRlci5qcyIsInNyY1xcZ3JhcGhcXENvcm5lci5qcyIsInNyY1xcZ3JhcGhcXERpYWdyYW0uanMiLCJzcmNcXGdyYXBoXFxFZGdlLmpzIiwic3JjXFxncmFwaFxcTWFwLmpzIiwic3JjXFxtYWluLmpzIiwic3JjXFx1dGlsaXRpZXNcXFJlZGlzdC5qcyIsInNyY1xcdXRpbGl0aWVzXFxVdGlsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVyREE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNB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aEIsQ0FBUDtBQUNILFNBRkQsTUFFTztBQUNILG1CQUFPLElBQUksS0FBSyxHQUFMLENBQVMsSUFBSSxDQUFiLEVBQWdCLEdBQWhCLENBQVg7QUFDSDtBQUNKLEtBTkQsTUFNTztBQUNILFlBQUksUUFBSixFQUFjO0FBQ1YsbUJBQU8sS0FBSyxHQUFMLENBQVMsQ0FBVCxFQUFZLEdBQVosQ0FBUDtBQUNILFNBRkQsTUFFTztBQUNILG1CQUFPLElBQUksS0FBSyxHQUFMLENBQVMsSUFBSSxDQUFiLEVBQWdCLElBQUksR0FBcEIsQ0FBWDtBQUNIO0FBQ0o7QUFDSjs7QUFFRDs7Ozs7Ozs7Ozs7QUFXTyxTQUFTLElBQVQsQ0FBYyxDQUFkLEVBQTRCO0FBQUEsUUFBWCxJQUFXLHVFQUFKLEVBQUk7O0FBQy9CLFdBQU8sS0FBSyxLQUFMLENBQVcsT0FBTyxDQUFsQixJQUF1QixJQUE5QjtBQUNIOzs7QUNySEQ7Ozs7QUFJQTs7QUFFQTtBQUNBOzs7OztBQUNPLElBQU0sb0JBQU0sU0FBTixHQUFNLENBQUMsR0FBRCxFQUFNLElBQU4sRUFBZTtBQUFFLFNBQU8sT0FBTyxTQUFQLENBQWlCLGNBQWpCLENBQWdDLElBQWhDLENBQXFDLEdBQXJDLEVBQTBDLElBQTFDLENBQVA7QUFBeUQsQ0FBdEYiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyohXG5Db3B5cmlnaHQgKEMpIDIwMTAtMjAxMyBSYXltb25kIEhpbGw6IGh0dHBzOi8vZ2l0aHViLmNvbS9nb3JoaWxsL0phdmFzY3JpcHQtVm9yb25vaVxuTUlUIExpY2Vuc2U6IFNlZSBodHRwczovL2dpdGh1Yi5jb20vZ29yaGlsbC9KYXZhc2NyaXB0LVZvcm9ub2kvTElDRU5TRS5tZFxuKi9cbi8qXG5BdXRob3I6IFJheW1vbmQgSGlsbCAocmhpbGxAcmF5bW9uZGhpbGwubmV0KVxuQ29udHJpYnV0b3I6IEplc3NlIE1vcmdhbiAobW9yZ2FqZWxAZ21haWwuY29tKVxuRmlsZTogcmhpbGwtdm9yb25vaS1jb3JlLmpzXG5WZXJzaW9uOiAwLjk4XG5EYXRlOiBKYW51YXJ5IDIxLCAyMDEzXG5EZXNjcmlwdGlvbjogVGhpcyBpcyBteSBwZXJzb25hbCBKYXZhc2NyaXB0IGltcGxlbWVudGF0aW9uIG9mXG5TdGV2ZW4gRm9ydHVuZSdzIGFsZ29yaXRobSB0byBjb21wdXRlIFZvcm9ub2kgZGlhZ3JhbXMuXG5cbkxpY2Vuc2U6IFNlZSBodHRwczovL2dpdGh1Yi5jb20vZ29yaGlsbC9KYXZhc2NyaXB0LVZvcm9ub2kvTElDRU5TRS5tZFxuQ3JlZGl0czogU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9nb3JoaWxsL0phdmFzY3JpcHQtVm9yb25vaS9DUkVESVRTLm1kXG5IaXN0b3J5OiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL0NIQU5HRUxPRy5tZFxuXG4jIyBVc2FnZTpcblxuICB2YXIgc2l0ZXMgPSBbe3g6MzAwLHk6MzAwfSwge3g6MTAwLHk6MTAwfSwge3g6MjAwLHk6NTAwfSwge3g6MjUwLHk6NDUwfSwge3g6NjAwLHk6MTUwfV07XG4gIC8vIHhsLCB4ciBtZWFucyB4IGxlZnQsIHggcmlnaHRcbiAgLy8geXQsIHliIG1lYW5zIHkgdG9wLCB5IGJvdHRvbVxuICB2YXIgYmJveCA9IHt4bDowLCB4cjo4MDAsIHl0OjAsIHliOjYwMH07XG4gIHZhciB2b3Jvbm9pID0gbmV3IFZvcm9ub2koKTtcbiAgLy8gcGFzcyBhbiBvYmplY3Qgd2hpY2ggZXhoaWJpdHMgeGwsIHhyLCB5dCwgeWIgcHJvcGVydGllcy4gVGhlIGJvdW5kaW5nXG4gIC8vIGJveCB3aWxsIGJlIHVzZWQgdG8gY29ubmVjdCB1bmJvdW5kIGVkZ2VzLCBhbmQgdG8gY2xvc2Ugb3BlbiBjZWxsc1xuICByZXN1bHQgPSB2b3Jvbm9pLmNvbXB1dGUoc2l0ZXMsIGJib3gpO1xuICAvLyByZW5kZXIsIGZ1cnRoZXIgYW5hbHl6ZSwgZXRjLlxuXG5SZXR1cm4gdmFsdWU6XG4gIEFuIG9iamVjdCB3aXRoIHRoZSBmb2xsb3dpbmcgcHJvcGVydGllczpcblxuICByZXN1bHQudmVydGljZXMgPSBhbiBhcnJheSBvZiB1bm9yZGVyZWQsIHVuaXF1ZSBWb3Jvbm9pLlZlcnRleCBvYmplY3RzIG1ha2luZ1xuICAgIHVwIHRoZSBWb3Jvbm9pIGRpYWdyYW0uXG4gIHJlc3VsdC5lZGdlcyA9IGFuIGFycmF5IG9mIHVub3JkZXJlZCwgdW5pcXVlIFZvcm9ub2kuRWRnZSBvYmplY3RzIG1ha2luZyB1cFxuICAgIHRoZSBWb3Jvbm9pIGRpYWdyYW0uXG4gIHJlc3VsdC5jZWxscyA9IGFuIGFycmF5IG9mIFZvcm9ub2kuQ2VsbCBvYmplY3QgbWFraW5nIHVwIHRoZSBWb3Jvbm9pIGRpYWdyYW0uXG4gICAgQSBDZWxsIG9iamVjdCBtaWdodCBoYXZlIGFuIGVtcHR5IGFycmF5IG9mIGhhbGZlZGdlcywgbWVhbmluZyBubyBWb3Jvbm9pXG4gICAgY2VsbCBjb3VsZCBiZSBjb21wdXRlZCBmb3IgYSBwYXJ0aWN1bGFyIGNlbGwuXG4gIHJlc3VsdC5leGVjVGltZSA9IHRoZSB0aW1lIGl0IHRvb2sgdG8gY29tcHV0ZSB0aGUgVm9yb25vaSBkaWFncmFtLCBpblxuICAgIG1pbGxpc2Vjb25kcy5cblxuVm9yb25vaS5WZXJ0ZXggb2JqZWN0OlxuICB4OiBUaGUgeCBwb3NpdGlvbiBvZiB0aGUgdmVydGV4LlxuICB5OiBUaGUgeSBwb3NpdGlvbiBvZiB0aGUgdmVydGV4LlxuXG5Wb3Jvbm9pLkVkZ2Ugb2JqZWN0OlxuICBsU2l0ZTogdGhlIFZvcm9ub2kgc2l0ZSBvYmplY3QgYXQgdGhlIGxlZnQgb2YgdGhpcyBWb3Jvbm9pLkVkZ2Ugb2JqZWN0LlxuICByU2l0ZTogdGhlIFZvcm9ub2kgc2l0ZSBvYmplY3QgYXQgdGhlIHJpZ2h0IG9mIHRoaXMgVm9yb25vaS5FZGdlIG9iamVjdCAoY2FuXG4gICAgYmUgbnVsbCkuXG4gIHZhOiBhbiBvYmplY3Qgd2l0aCBhbiAneCcgYW5kIGEgJ3knIHByb3BlcnR5IGRlZmluaW5nIHRoZSBzdGFydCBwb2ludFxuICAgIChyZWxhdGl2ZSB0byB0aGUgVm9yb25vaSBzaXRlIG9uIHRoZSBsZWZ0KSBvZiB0aGlzIFZvcm9ub2kuRWRnZSBvYmplY3QuXG4gIHZiOiBhbiBvYmplY3Qgd2l0aCBhbiAneCcgYW5kIGEgJ3knIHByb3BlcnR5IGRlZmluaW5nIHRoZSBlbmQgcG9pbnRcbiAgICAocmVsYXRpdmUgdG8gVm9yb25vaSBzaXRlIG9uIHRoZSBsZWZ0KSBvZiB0aGlzIFZvcm9ub2kuRWRnZSBvYmplY3QuXG5cbiAgRm9yIGVkZ2VzIHdoaWNoIGFyZSB1c2VkIHRvIGNsb3NlIG9wZW4gY2VsbHMgKHVzaW5nIHRoZSBzdXBwbGllZCBib3VuZGluZ1xuICBib3gpLCB0aGUgclNpdGUgcHJvcGVydHkgd2lsbCBiZSBudWxsLlxuXG5Wb3Jvbm9pLkNlbGwgb2JqZWN0OlxuICBzaXRlOiB0aGUgVm9yb25vaSBzaXRlIG9iamVjdCBhc3NvY2lhdGVkIHdpdGggdGhlIFZvcm9ub2kgY2VsbC5cbiAgaGFsZmVkZ2VzOiBhbiBhcnJheSBvZiBWb3Jvbm9pLkhhbGZlZGdlIG9iamVjdHMsIG9yZGVyZWQgY291bnRlcmNsb2Nrd2lzZSxcbiAgICBkZWZpbmluZyB0aGUgcG9seWdvbiBmb3IgdGhpcyBWb3Jvbm9pIGNlbGwuXG5cblZvcm9ub2kuSGFsZmVkZ2Ugb2JqZWN0OlxuICBzaXRlOiB0aGUgVm9yb25vaSBzaXRlIG9iamVjdCBvd25pbmcgdGhpcyBWb3Jvbm9pLkhhbGZlZGdlIG9iamVjdC5cbiAgZWRnZTogYSByZWZlcmVuY2UgdG8gdGhlIHVuaXF1ZSBWb3Jvbm9pLkVkZ2Ugb2JqZWN0IHVuZGVybHlpbmcgdGhpc1xuICAgIFZvcm9ub2kuSGFsZmVkZ2Ugb2JqZWN0LlxuICBnZXRTdGFydHBvaW50KCk6IGEgbWV0aG9kIHJldHVybmluZyBhbiBvYmplY3Qgd2l0aCBhbiAneCcgYW5kIGEgJ3knIHByb3BlcnR5XG4gICAgZm9yIHRoZSBzdGFydCBwb2ludCBvZiB0aGlzIGhhbGZlZGdlLiBLZWVwIGluIG1pbmQgaGFsZmVkZ2VzIGFyZSBhbHdheXNcbiAgICBjb3VudGVyY29ja3dpc2UuXG4gIGdldEVuZHBvaW50KCk6IGEgbWV0aG9kIHJldHVybmluZyBhbiBvYmplY3Qgd2l0aCBhbiAneCcgYW5kIGEgJ3knIHByb3BlcnR5XG4gICAgZm9yIHRoZSBlbmQgcG9pbnQgb2YgdGhpcyBoYWxmZWRnZS4gS2VlcCBpbiBtaW5kIGhhbGZlZGdlcyBhcmUgYWx3YXlzXG4gICAgY291bnRlcmNvY2t3aXNlLlxuXG5UT0RPOiBJZGVudGlmeSBvcHBvcnR1bml0aWVzIGZvciBwZXJmb3JtYW5jZSBpbXByb3ZlbWVudC5cblxuVE9ETzogTGV0IHRoZSB1c2VyIGNsb3NlIHRoZSBWb3Jvbm9pIGNlbGxzLCBkbyBub3QgZG8gaXQgYXV0b21hdGljYWxseS4gTm90IG9ubHkgbGV0XG4gICAgICBoaW0gY2xvc2UgdGhlIGNlbGxzLCBidXQgYWxzbyBhbGxvdyBoaW0gdG8gY2xvc2UgbW9yZSB0aGFuIG9uY2UgdXNpbmcgYSBkaWZmZXJlbnRcbiAgICAgIGJvdW5kaW5nIGJveCBmb3IgdGhlIHNhbWUgVm9yb25vaSBkaWFncmFtLlxuKi9cblxuLypnbG9iYWwgTWF0aCAqL1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gVm9yb25vaSgpIHtcbiAgICB0aGlzLnZlcnRpY2VzID0gbnVsbDtcbiAgICB0aGlzLmVkZ2VzID0gbnVsbDtcbiAgICB0aGlzLmNlbGxzID0gbnVsbDtcbiAgICB0aGlzLnRvUmVjeWNsZSA9IG51bGw7XG4gICAgdGhpcy5iZWFjaHNlY3Rpb25KdW5reWFyZCA9IFtdO1xuICAgIHRoaXMuY2lyY2xlRXZlbnRKdW5reWFyZCA9IFtdO1xuICAgIHRoaXMudmVydGV4SnVua3lhcmQgPSBbXTtcbiAgICB0aGlzLmVkZ2VKdW5reWFyZCA9IFtdO1xuICAgIHRoaXMuY2VsbEp1bmt5YXJkID0gW107XG4gICAgfVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuVm9yb25vaS5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuYmVhY2hsaW5lKSB7XG4gICAgICAgIHRoaXMuYmVhY2hsaW5lID0gbmV3IHRoaXMuUkJUcmVlKCk7XG4gICAgICAgIH1cbiAgICAvLyBNb3ZlIGxlZnRvdmVyIGJlYWNoc2VjdGlvbnMgdG8gdGhlIGJlYWNoc2VjdGlvbiBqdW5reWFyZC5cbiAgICBpZiAodGhpcy5iZWFjaGxpbmUucm9vdCkge1xuICAgICAgICB2YXIgYmVhY2hzZWN0aW9uID0gdGhpcy5iZWFjaGxpbmUuZ2V0Rmlyc3QodGhpcy5iZWFjaGxpbmUucm9vdCk7XG4gICAgICAgIHdoaWxlIChiZWFjaHNlY3Rpb24pIHtcbiAgICAgICAgICAgIHRoaXMuYmVhY2hzZWN0aW9uSnVua3lhcmQucHVzaChiZWFjaHNlY3Rpb24pOyAvLyBtYXJrIGZvciByZXVzZVxuICAgICAgICAgICAgYmVhY2hzZWN0aW9uID0gYmVhY2hzZWN0aW9uLnJiTmV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIHRoaXMuYmVhY2hsaW5lLnJvb3QgPSBudWxsO1xuICAgIGlmICghdGhpcy5jaXJjbGVFdmVudHMpIHtcbiAgICAgICAgdGhpcy5jaXJjbGVFdmVudHMgPSBuZXcgdGhpcy5SQlRyZWUoKTtcbiAgICAgICAgfVxuICAgIHRoaXMuY2lyY2xlRXZlbnRzLnJvb3QgPSB0aGlzLmZpcnN0Q2lyY2xlRXZlbnQgPSBudWxsO1xuICAgIHRoaXMudmVydGljZXMgPSBbXTtcbiAgICB0aGlzLmVkZ2VzID0gW107XG4gICAgdGhpcy5jZWxscyA9IFtdO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLnNxcnQgPSBNYXRoLnNxcnQ7XG5Wb3Jvbm9pLnByb3RvdHlwZS5hYnMgPSBNYXRoLmFicztcblZvcm9ub2kucHJvdG90eXBlLs61ID0gVm9yb25vaS7OtSA9IDFlLTk7XG5Wb3Jvbm9pLnByb3RvdHlwZS5pbnbOtSA9IFZvcm9ub2kuaW52zrUgPSAxLjAgLyBWb3Jvbm9pLs61O1xuVm9yb25vaS5wcm90b3R5cGUuZXF1YWxXaXRoRXBzaWxvbiA9IGZ1bmN0aW9uKGEsYil7cmV0dXJuIHRoaXMuYWJzKGEtYik8MWUtOTt9O1xuVm9yb25vaS5wcm90b3R5cGUuZ3JlYXRlclRoYW5XaXRoRXBzaWxvbiA9IGZ1bmN0aW9uKGEsYil7cmV0dXJuIGEtYj4xZS05O307XG5Wb3Jvbm9pLnByb3RvdHlwZS5ncmVhdGVyVGhhbk9yRXF1YWxXaXRoRXBzaWxvbiA9IGZ1bmN0aW9uKGEsYil7cmV0dXJuIGItYTwxZS05O307XG5Wb3Jvbm9pLnByb3RvdHlwZS5sZXNzVGhhbldpdGhFcHNpbG9uID0gZnVuY3Rpb24oYSxiKXtyZXR1cm4gYi1hPjFlLTk7fTtcblZvcm9ub2kucHJvdG90eXBlLmxlc3NUaGFuT3JFcXVhbFdpdGhFcHNpbG9uID0gZnVuY3Rpb24oYSxiKXtyZXR1cm4gYS1iPDFlLTk7fTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZWQtQmxhY2sgdHJlZSBjb2RlIChiYXNlZCBvbiBDIHZlcnNpb24gb2YgXCJyYnRyZWVcIiBieSBGcmFuY2sgQnVpLUh1dVxuLy8gaHR0cHM6Ly9naXRodWIuY29tL2ZidWlodXUvbGlidHJlZS9ibG9iL21hc3Rlci9yYi5jXG5cblZvcm9ub2kucHJvdG90eXBlLlJCVHJlZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucm9vdCA9IG51bGw7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuUkJUcmVlLnByb3RvdHlwZS5yYkluc2VydFN1Y2Nlc3NvciA9IGZ1bmN0aW9uKG5vZGUsIHN1Y2Nlc3Nvcikge1xuICAgIHZhciBwYXJlbnQ7XG4gICAgaWYgKG5vZGUpIHtcbiAgICAgICAgLy8gPj4+IHJoaWxsIDIwMTEtMDUtMjc6IFBlcmZvcm1hbmNlOiBjYWNoZSBwcmV2aW91cy9uZXh0IG5vZGVzXG4gICAgICAgIHN1Y2Nlc3Nvci5yYlByZXZpb3VzID0gbm9kZTtcbiAgICAgICAgc3VjY2Vzc29yLnJiTmV4dCA9IG5vZGUucmJOZXh0O1xuICAgICAgICBpZiAobm9kZS5yYk5leHQpIHtcbiAgICAgICAgICAgIG5vZGUucmJOZXh0LnJiUHJldmlvdXMgPSBzdWNjZXNzb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgIG5vZGUucmJOZXh0ID0gc3VjY2Vzc29yO1xuICAgICAgICAvLyA8PDxcbiAgICAgICAgaWYgKG5vZGUucmJSaWdodCkge1xuICAgICAgICAgICAgLy8gaW4tcGxhY2UgZXhwYW5zaW9uIG9mIG5vZGUucmJSaWdodC5nZXRGaXJzdCgpO1xuICAgICAgICAgICAgbm9kZSA9IG5vZGUucmJSaWdodDtcbiAgICAgICAgICAgIHdoaWxlIChub2RlLnJiTGVmdCkge25vZGUgPSBub2RlLnJiTGVmdDt9XG4gICAgICAgICAgICBub2RlLnJiTGVmdCA9IHN1Y2Nlc3NvcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBub2RlLnJiUmlnaHQgPSBzdWNjZXNzb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgIHBhcmVudCA9IG5vZGU7XG4gICAgICAgIH1cbiAgICAvLyByaGlsbCAyMDExLTA2LTA3OiBpZiBub2RlIGlzIG51bGwsIHN1Y2Nlc3NvciBtdXN0IGJlIGluc2VydGVkXG4gICAgLy8gdG8gdGhlIGxlZnQtbW9zdCBwYXJ0IG9mIHRoZSB0cmVlXG4gICAgZWxzZSBpZiAodGhpcy5yb290KSB7XG4gICAgICAgIG5vZGUgPSB0aGlzLmdldEZpcnN0KHRoaXMucm9vdCk7XG4gICAgICAgIC8vID4+PiBQZXJmb3JtYW5jZTogY2FjaGUgcHJldmlvdXMvbmV4dCBub2Rlc1xuICAgICAgICBzdWNjZXNzb3IucmJQcmV2aW91cyA9IG51bGw7XG4gICAgICAgIHN1Y2Nlc3Nvci5yYk5leHQgPSBub2RlO1xuICAgICAgICBub2RlLnJiUHJldmlvdXMgPSBzdWNjZXNzb3I7XG4gICAgICAgIC8vIDw8PFxuICAgICAgICBub2RlLnJiTGVmdCA9IHN1Y2Nlc3NvcjtcbiAgICAgICAgcGFyZW50ID0gbm9kZTtcbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICAvLyA+Pj4gUGVyZm9ybWFuY2U6IGNhY2hlIHByZXZpb3VzL25leHQgbm9kZXNcbiAgICAgICAgc3VjY2Vzc29yLnJiUHJldmlvdXMgPSBzdWNjZXNzb3IucmJOZXh0ID0gbnVsbDtcbiAgICAgICAgLy8gPDw8XG4gICAgICAgIHRoaXMucm9vdCA9IHN1Y2Nlc3NvcjtcbiAgICAgICAgcGFyZW50ID0gbnVsbDtcbiAgICAgICAgfVxuICAgIHN1Y2Nlc3Nvci5yYkxlZnQgPSBzdWNjZXNzb3IucmJSaWdodCA9IG51bGw7XG4gICAgc3VjY2Vzc29yLnJiUGFyZW50ID0gcGFyZW50O1xuICAgIHN1Y2Nlc3Nvci5yYlJlZCA9IHRydWU7XG4gICAgLy8gRml4dXAgdGhlIG1vZGlmaWVkIHRyZWUgYnkgcmVjb2xvcmluZyBub2RlcyBhbmQgcGVyZm9ybWluZ1xuICAgIC8vIHJvdGF0aW9ucyAoMiBhdCBtb3N0KSBoZW5jZSB0aGUgcmVkLWJsYWNrIHRyZWUgcHJvcGVydGllcyBhcmVcbiAgICAvLyBwcmVzZXJ2ZWQuXG4gICAgdmFyIGdyYW5kcGEsIHVuY2xlO1xuICAgIG5vZGUgPSBzdWNjZXNzb3I7XG4gICAgd2hpbGUgKHBhcmVudCAmJiBwYXJlbnQucmJSZWQpIHtcbiAgICAgICAgZ3JhbmRwYSA9IHBhcmVudC5yYlBhcmVudDtcbiAgICAgICAgaWYgKHBhcmVudCA9PT0gZ3JhbmRwYS5yYkxlZnQpIHtcbiAgICAgICAgICAgIHVuY2xlID0gZ3JhbmRwYS5yYlJpZ2h0O1xuICAgICAgICAgICAgaWYgKHVuY2xlICYmIHVuY2xlLnJiUmVkKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50LnJiUmVkID0gdW5jbGUucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBncmFuZHBhLnJiUmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBub2RlID0gZ3JhbmRwYTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAobm9kZSA9PT0gcGFyZW50LnJiUmlnaHQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZUxlZnQocGFyZW50KTtcbiAgICAgICAgICAgICAgICAgICAgbm9kZSA9IHBhcmVudDtcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50ID0gbm9kZS5yYlBhcmVudDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHBhcmVudC5yYlJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIGdyYW5kcGEucmJSZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVSaWdodChncmFuZHBhKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdW5jbGUgPSBncmFuZHBhLnJiTGVmdDtcbiAgICAgICAgICAgIGlmICh1bmNsZSAmJiB1bmNsZS5yYlJlZCkge1xuICAgICAgICAgICAgICAgIHBhcmVudC5yYlJlZCA9IHVuY2xlLnJiUmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgZ3JhbmRwYS5yYlJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgbm9kZSA9IGdyYW5kcGE7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgaWYgKG5vZGUgPT09IHBhcmVudC5yYkxlZnQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZVJpZ2h0KHBhcmVudCk7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUgPSBwYXJlbnQ7XG4gICAgICAgICAgICAgICAgICAgIHBhcmVudCA9IG5vZGUucmJQYXJlbnQ7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBncmFuZHBhLnJiUmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlTGVmdChncmFuZHBhKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIHBhcmVudCA9IG5vZGUucmJQYXJlbnQ7XG4gICAgICAgIH1cbiAgICB0aGlzLnJvb3QucmJSZWQgPSBmYWxzZTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUucHJvdG90eXBlLnJiUmVtb3ZlTm9kZSA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICAvLyA+Pj4gcmhpbGwgMjAxMS0wNS0yNzogUGVyZm9ybWFuY2U6IGNhY2hlIHByZXZpb3VzL25leHQgbm9kZXNcbiAgICBpZiAobm9kZS5yYk5leHQpIHtcbiAgICAgICAgbm9kZS5yYk5leHQucmJQcmV2aW91cyA9IG5vZGUucmJQcmV2aW91cztcbiAgICAgICAgfVxuICAgIGlmIChub2RlLnJiUHJldmlvdXMpIHtcbiAgICAgICAgbm9kZS5yYlByZXZpb3VzLnJiTmV4dCA9IG5vZGUucmJOZXh0O1xuICAgICAgICB9XG4gICAgbm9kZS5yYk5leHQgPSBub2RlLnJiUHJldmlvdXMgPSBudWxsO1xuICAgIC8vIDw8PFxuICAgIHZhciBwYXJlbnQgPSBub2RlLnJiUGFyZW50LFxuICAgICAgICBsZWZ0ID0gbm9kZS5yYkxlZnQsXG4gICAgICAgIHJpZ2h0ID0gbm9kZS5yYlJpZ2h0LFxuICAgICAgICBuZXh0O1xuICAgIGlmICghbGVmdCkge1xuICAgICAgICBuZXh0ID0gcmlnaHQ7XG4gICAgICAgIH1cbiAgICBlbHNlIGlmICghcmlnaHQpIHtcbiAgICAgICAgbmV4dCA9IGxlZnQ7XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgbmV4dCA9IHRoaXMuZ2V0Rmlyc3QocmlnaHQpO1xuICAgICAgICB9XG4gICAgaWYgKHBhcmVudCkge1xuICAgICAgICBpZiAocGFyZW50LnJiTGVmdCA9PT0gbm9kZSkge1xuICAgICAgICAgICAgcGFyZW50LnJiTGVmdCA9IG5leHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcGFyZW50LnJiUmlnaHQgPSBuZXh0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHRoaXMucm9vdCA9IG5leHQ7XG4gICAgICAgIH1cbiAgICAvLyBlbmZvcmNlIHJlZC1ibGFjayBydWxlc1xuICAgIHZhciBpc1JlZDtcbiAgICBpZiAobGVmdCAmJiByaWdodCkge1xuICAgICAgICBpc1JlZCA9IG5leHQucmJSZWQ7XG4gICAgICAgIG5leHQucmJSZWQgPSBub2RlLnJiUmVkO1xuICAgICAgICBuZXh0LnJiTGVmdCA9IGxlZnQ7XG4gICAgICAgIGxlZnQucmJQYXJlbnQgPSBuZXh0O1xuICAgICAgICBpZiAobmV4dCAhPT0gcmlnaHQpIHtcbiAgICAgICAgICAgIHBhcmVudCA9IG5leHQucmJQYXJlbnQ7XG4gICAgICAgICAgICBuZXh0LnJiUGFyZW50ID0gbm9kZS5yYlBhcmVudDtcbiAgICAgICAgICAgIG5vZGUgPSBuZXh0LnJiUmlnaHQ7XG4gICAgICAgICAgICBwYXJlbnQucmJMZWZ0ID0gbm9kZTtcbiAgICAgICAgICAgIG5leHQucmJSaWdodCA9IHJpZ2h0O1xuICAgICAgICAgICAgcmlnaHQucmJQYXJlbnQgPSBuZXh0O1xuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIG5leHQucmJQYXJlbnQgPSBwYXJlbnQ7XG4gICAgICAgICAgICBwYXJlbnQgPSBuZXh0O1xuICAgICAgICAgICAgbm9kZSA9IG5leHQucmJSaWdodDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBpc1JlZCA9IG5vZGUucmJSZWQ7XG4gICAgICAgIG5vZGUgPSBuZXh0O1xuICAgICAgICB9XG4gICAgLy8gJ25vZGUnIGlzIG5vdyB0aGUgc29sZSBzdWNjZXNzb3IncyBjaGlsZCBhbmQgJ3BhcmVudCcgaXRzXG4gICAgLy8gbmV3IHBhcmVudCAoc2luY2UgdGhlIHN1Y2Nlc3NvciBjYW4gaGF2ZSBiZWVuIG1vdmVkKVxuICAgIGlmIChub2RlKSB7XG4gICAgICAgIG5vZGUucmJQYXJlbnQgPSBwYXJlbnQ7XG4gICAgICAgIH1cbiAgICAvLyB0aGUgJ2Vhc3knIGNhc2VzXG4gICAgaWYgKGlzUmVkKSB7cmV0dXJuO31cbiAgICBpZiAobm9kZSAmJiBub2RlLnJiUmVkKSB7XG4gICAgICAgIG5vZGUucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgLy8gdGhlIG90aGVyIGNhc2VzXG4gICAgdmFyIHNpYmxpbmc7XG4gICAgZG8ge1xuICAgICAgICBpZiAobm9kZSA9PT0gdGhpcy5yb290KSB7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgaWYgKG5vZGUgPT09IHBhcmVudC5yYkxlZnQpIHtcbiAgICAgICAgICAgIHNpYmxpbmcgPSBwYXJlbnQucmJSaWdodDtcbiAgICAgICAgICAgIGlmIChzaWJsaW5nLnJiUmVkKSB7XG4gICAgICAgICAgICAgICAgc2libGluZy5yYlJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHBhcmVudC5yYlJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZUxlZnQocGFyZW50KTtcbiAgICAgICAgICAgICAgICBzaWJsaW5nID0gcGFyZW50LnJiUmlnaHQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKChzaWJsaW5nLnJiTGVmdCAmJiBzaWJsaW5nLnJiTGVmdC5yYlJlZCkgfHwgKHNpYmxpbmcucmJSaWdodCAmJiBzaWJsaW5nLnJiUmlnaHQucmJSZWQpKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzaWJsaW5nLnJiUmlnaHQgfHwgIXNpYmxpbmcucmJSaWdodC5yYlJlZCkge1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5nLnJiTGVmdC5yYlJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5nLnJiUmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZVJpZ2h0KHNpYmxpbmcpO1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5nID0gcGFyZW50LnJiUmlnaHQ7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzaWJsaW5nLnJiUmVkID0gcGFyZW50LnJiUmVkO1xuICAgICAgICAgICAgICAgIHBhcmVudC5yYlJlZCA9IHNpYmxpbmcucmJSaWdodC5yYlJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVMZWZ0KHBhcmVudCk7XG4gICAgICAgICAgICAgICAgbm9kZSA9IHRoaXMucm9vdDtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgc2libGluZyA9IHBhcmVudC5yYkxlZnQ7XG4gICAgICAgICAgICBpZiAoc2libGluZy5yYlJlZCkge1xuICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVSaWdodChwYXJlbnQpO1xuICAgICAgICAgICAgICAgIHNpYmxpbmcgPSBwYXJlbnQucmJMZWZ0O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICgoc2libGluZy5yYkxlZnQgJiYgc2libGluZy5yYkxlZnQucmJSZWQpIHx8IChzaWJsaW5nLnJiUmlnaHQgJiYgc2libGluZy5yYlJpZ2h0LnJiUmVkKSkge1xuICAgICAgICAgICAgICAgIGlmICghc2libGluZy5yYkxlZnQgfHwgIXNpYmxpbmcucmJMZWZ0LnJiUmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSaWdodC5yYlJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5nLnJiUmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZUxlZnQoc2libGluZyk7XG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmcgPSBwYXJlbnQucmJMZWZ0O1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2libGluZy5yYlJlZCA9IHBhcmVudC5yYlJlZDtcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSBzaWJsaW5nLnJiTGVmdC5yYlJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVSaWdodChwYXJlbnQpO1xuICAgICAgICAgICAgICAgIG5vZGUgPSB0aGlzLnJvb3Q7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICBzaWJsaW5nLnJiUmVkID0gdHJ1ZTtcbiAgICAgICAgbm9kZSA9IHBhcmVudDtcbiAgICAgICAgcGFyZW50ID0gcGFyZW50LnJiUGFyZW50O1xuICAgIH0gd2hpbGUgKCFub2RlLnJiUmVkKTtcbiAgICBpZiAobm9kZSkge25vZGUucmJSZWQgPSBmYWxzZTt9XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuUkJUcmVlLnByb3RvdHlwZS5yYlJvdGF0ZUxlZnQgPSBmdW5jdGlvbihub2RlKSB7XG4gICAgdmFyIHAgPSBub2RlLFxuICAgICAgICBxID0gbm9kZS5yYlJpZ2h0LCAvLyBjYW4ndCBiZSBudWxsXG4gICAgICAgIHBhcmVudCA9IHAucmJQYXJlbnQ7XG4gICAgaWYgKHBhcmVudCkge1xuICAgICAgICBpZiAocGFyZW50LnJiTGVmdCA9PT0gcCkge1xuICAgICAgICAgICAgcGFyZW50LnJiTGVmdCA9IHE7XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcGFyZW50LnJiUmlnaHQgPSBxO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHRoaXMucm9vdCA9IHE7XG4gICAgICAgIH1cbiAgICBxLnJiUGFyZW50ID0gcGFyZW50O1xuICAgIHAucmJQYXJlbnQgPSBxO1xuICAgIHAucmJSaWdodCA9IHEucmJMZWZ0O1xuICAgIGlmIChwLnJiUmlnaHQpIHtcbiAgICAgICAgcC5yYlJpZ2h0LnJiUGFyZW50ID0gcDtcbiAgICAgICAgfVxuICAgIHEucmJMZWZ0ID0gcDtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUucHJvdG90eXBlLnJiUm90YXRlUmlnaHQgPSBmdW5jdGlvbihub2RlKSB7XG4gICAgdmFyIHAgPSBub2RlLFxuICAgICAgICBxID0gbm9kZS5yYkxlZnQsIC8vIGNhbid0IGJlIG51bGxcbiAgICAgICAgcGFyZW50ID0gcC5yYlBhcmVudDtcbiAgICBpZiAocGFyZW50KSB7XG4gICAgICAgIGlmIChwYXJlbnQucmJMZWZ0ID09PSBwKSB7XG4gICAgICAgICAgICBwYXJlbnQucmJMZWZ0ID0gcTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwYXJlbnQucmJSaWdodCA9IHE7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgdGhpcy5yb290ID0gcTtcbiAgICAgICAgfVxuICAgIHEucmJQYXJlbnQgPSBwYXJlbnQ7XG4gICAgcC5yYlBhcmVudCA9IHE7XG4gICAgcC5yYkxlZnQgPSBxLnJiUmlnaHQ7XG4gICAgaWYgKHAucmJMZWZ0KSB7XG4gICAgICAgIHAucmJMZWZ0LnJiUGFyZW50ID0gcDtcbiAgICAgICAgfVxuICAgIHEucmJSaWdodCA9IHA7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuUkJUcmVlLnByb3RvdHlwZS5nZXRGaXJzdCA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICB3aGlsZSAobm9kZS5yYkxlZnQpIHtcbiAgICAgICAgbm9kZSA9IG5vZGUucmJMZWZ0O1xuICAgICAgICB9XG4gICAgcmV0dXJuIG5vZGU7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuUkJUcmVlLnByb3RvdHlwZS5nZXRMYXN0ID0gZnVuY3Rpb24obm9kZSkge1xuICAgIHdoaWxlIChub2RlLnJiUmlnaHQpIHtcbiAgICAgICAgbm9kZSA9IG5vZGUucmJSaWdodDtcbiAgICAgICAgfVxuICAgIHJldHVybiBub2RlO1xuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGlhZ3JhbSBtZXRob2RzXG5cblZvcm9ub2kucHJvdG90eXBlLkRpYWdyYW0gPSBmdW5jdGlvbihzaXRlKSB7XG4gICAgdGhpcy5zaXRlID0gc2l0ZTtcbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENlbGwgbWV0aG9kc1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5DZWxsID0gZnVuY3Rpb24oc2l0ZSkge1xuICAgIHRoaXMuc2l0ZSA9IHNpdGU7XG4gICAgdGhpcy5oYWxmZWRnZXMgPSBbXTtcbiAgICB0aGlzLmNsb3NlTWUgPSBmYWxzZTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5DZWxsLnByb3RvdHlwZS5pbml0ID0gZnVuY3Rpb24oc2l0ZSkge1xuICAgIHRoaXMuc2l0ZSA9IHNpdGU7XG4gICAgdGhpcy5oYWxmZWRnZXMgPSBbXTtcbiAgICB0aGlzLmNsb3NlTWUgPSBmYWxzZTtcbiAgICByZXR1cm4gdGhpcztcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5jcmVhdGVDZWxsID0gZnVuY3Rpb24oc2l0ZSkge1xuICAgIHZhciBjZWxsID0gdGhpcy5jZWxsSnVua3lhcmQucG9wKCk7XG4gICAgaWYgKCBjZWxsICkge1xuICAgICAgICByZXR1cm4gY2VsbC5pbml0KHNpdGUpO1xuICAgICAgICB9XG4gICAgcmV0dXJuIG5ldyB0aGlzLkNlbGwoc2l0ZSk7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuQ2VsbC5wcm90b3R5cGUucHJlcGFyZUhhbGZlZGdlcyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBoYWxmZWRnZXMgPSB0aGlzLmhhbGZlZGdlcyxcbiAgICAgICAgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aCxcbiAgICAgICAgZWRnZTtcbiAgICAvLyBnZXQgcmlkIG9mIHVudXNlZCBoYWxmZWRnZXNcbiAgICAvLyByaGlsbCAyMDExLTA1LTI3OiBLZWVwIGl0IHNpbXBsZSwgbm8gcG9pbnQgaGVyZSBpbiB0cnlpbmdcbiAgICAvLyB0byBiZSBmYW5jeTogZGFuZ2xpbmcgZWRnZXMgYXJlIGEgdHlwaWNhbGx5IGEgbWlub3JpdHkuXG4gICAgd2hpbGUgKGlIYWxmZWRnZS0tKSB7XG4gICAgICAgIGVkZ2UgPSBoYWxmZWRnZXNbaUhhbGZlZGdlXS5lZGdlO1xuICAgICAgICBpZiAoIWVkZ2UudmIgfHwgIWVkZ2UudmEpIHtcbiAgICAgICAgICAgIGhhbGZlZGdlcy5zcGxpY2UoaUhhbGZlZGdlLDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAvLyByaGlsbCAyMDExLTA1LTI2OiBJIHRyaWVkIHRvIHVzZSBhIGJpbmFyeSBzZWFyY2ggYXQgaW5zZXJ0aW9uXG4gICAgLy8gdGltZSB0byBrZWVwIHRoZSBhcnJheSBzb3J0ZWQgb24tdGhlLWZseSAoaW4gQ2VsbC5hZGRIYWxmZWRnZSgpKS5cbiAgICAvLyBUaGVyZSB3YXMgbm8gcmVhbCBiZW5lZml0cyBpbiBkb2luZyBzbywgcGVyZm9ybWFuY2Ugb25cbiAgICAvLyBGaXJlZm94IDMuNiB3YXMgaW1wcm92ZWQgbWFyZ2luYWxseSwgd2hpbGUgcGVyZm9ybWFuY2Ugb25cbiAgICAvLyBPcGVyYSAxMSB3YXMgcGVuYWxpemVkIG1hcmdpbmFsbHkuXG4gICAgaGFsZmVkZ2VzLnNvcnQoZnVuY3Rpb24oYSxiKXtyZXR1cm4gYi5hbmdsZS1hLmFuZ2xlO30pO1xuICAgIHJldHVybiBoYWxmZWRnZXMubGVuZ3RoO1xuICAgIH07XG5cbi8vIFJldHVybiBhIGxpc3Qgb2YgdGhlIG5laWdoYm9yIElkc1xuVm9yb25vaS5wcm90b3R5cGUuQ2VsbC5wcm90b3R5cGUuZ2V0TmVpZ2hib3JJZHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgbmVpZ2hib3JzID0gW10sXG4gICAgICAgIGlIYWxmZWRnZSA9IHRoaXMuaGFsZmVkZ2VzLmxlbmd0aCxcbiAgICAgICAgZWRnZTtcbiAgICB3aGlsZSAoaUhhbGZlZGdlLS0pe1xuICAgICAgICBlZGdlID0gdGhpcy5oYWxmZWRnZXNbaUhhbGZlZGdlXS5lZGdlO1xuICAgICAgICBpZiAoZWRnZS5sU2l0ZSAhPT0gbnVsbCAmJiBlZGdlLmxTaXRlLnZvcm9ub2lJZCAhPSB0aGlzLnNpdGUudm9yb25vaUlkKSB7XG4gICAgICAgICAgICBuZWlnaGJvcnMucHVzaChlZGdlLmxTaXRlLnZvcm9ub2lJZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGVkZ2UuclNpdGUgIT09IG51bGwgJiYgZWRnZS5yU2l0ZS52b3Jvbm9pSWQgIT0gdGhpcy5zaXRlLnZvcm9ub2lJZCl7XG4gICAgICAgICAgICBuZWlnaGJvcnMucHVzaChlZGdlLnJTaXRlLnZvcm9ub2lJZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICByZXR1cm4gbmVpZ2hib3JzO1xuICAgIH07XG5cbi8vIENvbXB1dGUgYm91bmRpbmcgYm94XG4vL1xuVm9yb25vaS5wcm90b3R5cGUuQ2VsbC5wcm90b3R5cGUuZ2V0QmJveCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBoYWxmZWRnZXMgPSB0aGlzLmhhbGZlZGdlcyxcbiAgICAgICAgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aCxcbiAgICAgICAgeG1pbiA9IEluZmluaXR5LFxuICAgICAgICB5bWluID0gSW5maW5pdHksXG4gICAgICAgIHhtYXggPSAtSW5maW5pdHksXG4gICAgICAgIHltYXggPSAtSW5maW5pdHksXG4gICAgICAgIHYsIHZ4LCB2eTtcbiAgICB3aGlsZSAoaUhhbGZlZGdlLS0pIHtcbiAgICAgICAgdiA9IGhhbGZlZGdlc1tpSGFsZmVkZ2VdLmdldFN0YXJ0cG9pbnQoKTtcbiAgICAgICAgdnggPSB2Lng7XG4gICAgICAgIHZ5ID0gdi55O1xuICAgICAgICBpZiAodnggPCB4bWluKSB7eG1pbiA9IHZ4O31cbiAgICAgICAgaWYgKHZ5IDwgeW1pbikge3ltaW4gPSB2eTt9XG4gICAgICAgIGlmICh2eCA+IHhtYXgpIHt4bWF4ID0gdng7fVxuICAgICAgICBpZiAodnkgPiB5bWF4KSB7eW1heCA9IHZ5O31cbiAgICAgICAgLy8gd2UgZG9udCBuZWVkIHRvIHRha2UgaW50byBhY2NvdW50IGVuZCBwb2ludCxcbiAgICAgICAgLy8gc2luY2UgZWFjaCBlbmQgcG9pbnQgbWF0Y2hlcyBhIHN0YXJ0IHBvaW50XG4gICAgICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICB4OiB4bWluLFxuICAgICAgICB5OiB5bWluLFxuICAgICAgICB3aWR0aDogeG1heC14bWluLFxuICAgICAgICBoZWlnaHQ6IHltYXgteW1pblxuICAgICAgICB9O1xuICAgIH07XG5cbi8vIFJldHVybiB3aGV0aGVyIGEgcG9pbnQgaXMgaW5zaWRlLCBvbiwgb3Igb3V0c2lkZSB0aGUgY2VsbDpcbi8vICAgLTE6IHBvaW50IGlzIG91dHNpZGUgdGhlIHBlcmltZXRlciBvZiB0aGUgY2VsbFxuLy8gICAgMDogcG9pbnQgaXMgb24gdGhlIHBlcmltZXRlciBvZiB0aGUgY2VsbFxuLy8gICAgMTogcG9pbnQgaXMgaW5zaWRlIHRoZSBwZXJpbWV0ZXIgb2YgdGhlIGNlbGxcbi8vXG5Wb3Jvbm9pLnByb3RvdHlwZS5DZWxsLnByb3RvdHlwZS5wb2ludEludGVyc2VjdGlvbiA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgICAvLyBDaGVjayBpZiBwb2ludCBpbiBwb2x5Z29uLiBTaW5jZSBhbGwgcG9seWdvbnMgb2YgYSBWb3Jvbm9pXG4gICAgLy8gZGlhZ3JhbSBhcmUgY29udmV4LCB0aGVuOlxuICAgIC8vIGh0dHA6Ly9wYXVsYm91cmtlLm5ldC9nZW9tZXRyeS9wb2x5Z29ubWVzaC9cbiAgICAvLyBTb2x1dGlvbiAzICgyRCk6XG4gICAgLy8gICBcIklmIHRoZSBwb2x5Z29uIGlzIGNvbnZleCB0aGVuIG9uZSBjYW4gY29uc2lkZXIgdGhlIHBvbHlnb25cbiAgICAvLyAgIFwiYXMgYSAncGF0aCcgZnJvbSB0aGUgZmlyc3QgdmVydGV4LiBBIHBvaW50IGlzIG9uIHRoZSBpbnRlcmlvclxuICAgIC8vICAgXCJvZiB0aGlzIHBvbHlnb25zIGlmIGl0IGlzIGFsd2F5cyBvbiB0aGUgc2FtZSBzaWRlIG9mIGFsbCB0aGVcbiAgICAvLyAgIFwibGluZSBzZWdtZW50cyBtYWtpbmcgdXAgdGhlIHBhdGguIC4uLlxuICAgIC8vICAgXCIoeSAtIHkwKSAoeDEgLSB4MCkgLSAoeCAtIHgwKSAoeTEgLSB5MClcbiAgICAvLyAgIFwiaWYgaXQgaXMgbGVzcyB0aGFuIDAgdGhlbiBQIGlzIHRvIHRoZSByaWdodCBvZiB0aGUgbGluZSBzZWdtZW50LFxuICAgIC8vICAgXCJpZiBncmVhdGVyIHRoYW4gMCBpdCBpcyB0byB0aGUgbGVmdCwgaWYgZXF1YWwgdG8gMCB0aGVuIGl0IGxpZXNcbiAgICAvLyAgIFwib24gdGhlIGxpbmUgc2VnbWVudFwiXG4gICAgdmFyIGhhbGZlZGdlcyA9IHRoaXMuaGFsZmVkZ2VzLFxuICAgICAgICBpSGFsZmVkZ2UgPSBoYWxmZWRnZXMubGVuZ3RoLFxuICAgICAgICBoYWxmZWRnZSxcbiAgICAgICAgcDAsIHAxLCByO1xuICAgIHdoaWxlIChpSGFsZmVkZ2UtLSkge1xuICAgICAgICBoYWxmZWRnZSA9IGhhbGZlZGdlc1tpSGFsZmVkZ2VdO1xuICAgICAgICBwMCA9IGhhbGZlZGdlLmdldFN0YXJ0cG9pbnQoKTtcbiAgICAgICAgcDEgPSBoYWxmZWRnZS5nZXRFbmRwb2ludCgpO1xuICAgICAgICByID0gKHktcDAueSkqKHAxLngtcDAueCktKHgtcDAueCkqKHAxLnktcDAueSk7XG4gICAgICAgIGlmICghcikge1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgICAgICB9XG4gICAgICAgIGlmIChyID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuIC0xO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgcmV0dXJuIDE7XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFZGdlIG1ldGhvZHNcbi8vXG5cblZvcm9ub2kucHJvdG90eXBlLlZlcnRleCA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgICB0aGlzLnggPSB4O1xuICAgIHRoaXMueSA9IHk7XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuRWRnZSA9IGZ1bmN0aW9uKGxTaXRlLCByU2l0ZSkge1xuICAgIHRoaXMubFNpdGUgPSBsU2l0ZTtcbiAgICB0aGlzLnJTaXRlID0gclNpdGU7XG4gICAgdGhpcy52YSA9IHRoaXMudmIgPSBudWxsO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLkhhbGZlZGdlID0gZnVuY3Rpb24oZWRnZSwgbFNpdGUsIHJTaXRlKSB7XG4gICAgdGhpcy5zaXRlID0gbFNpdGU7XG4gICAgdGhpcy5lZGdlID0gZWRnZTtcbiAgICAvLyAnYW5nbGUnIGlzIGEgdmFsdWUgdG8gYmUgdXNlZCBmb3IgcHJvcGVybHkgc29ydGluZyB0aGVcbiAgICAvLyBoYWxmc2VnbWVudHMgY291bnRlcmNsb2Nrd2lzZS4gQnkgY29udmVudGlvbiwgd2Ugd2lsbFxuICAgIC8vIHVzZSB0aGUgYW5nbGUgb2YgdGhlIGxpbmUgZGVmaW5lZCBieSB0aGUgJ3NpdGUgdG8gdGhlIGxlZnQnXG4gICAgLy8gdG8gdGhlICdzaXRlIHRvIHRoZSByaWdodCcuXG4gICAgLy8gSG93ZXZlciwgYm9yZGVyIGVkZ2VzIGhhdmUgbm8gJ3NpdGUgdG8gdGhlIHJpZ2h0JzogdGh1cyB3ZVxuICAgIC8vIHVzZSB0aGUgYW5nbGUgb2YgbGluZSBwZXJwZW5kaWN1bGFyIHRvIHRoZSBoYWxmc2VnbWVudCAodGhlXG4gICAgLy8gZWRnZSBzaG91bGQgaGF2ZSBib3RoIGVuZCBwb2ludHMgZGVmaW5lZCBpbiBzdWNoIGNhc2UuKVxuICAgIGlmIChyU2l0ZSkge1xuICAgICAgICB0aGlzLmFuZ2xlID0gTWF0aC5hdGFuMihyU2l0ZS55LWxTaXRlLnksIHJTaXRlLngtbFNpdGUueCk7XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgdmFyIHZhID0gZWRnZS52YSxcbiAgICAgICAgICAgIHZiID0gZWRnZS52YjtcbiAgICAgICAgLy8gcmhpbGwgMjAxMS0wNS0zMTogdXNlZCB0byBjYWxsIGdldFN0YXJ0cG9pbnQoKS9nZXRFbmRwb2ludCgpLFxuICAgICAgICAvLyBidXQgZm9yIHBlcmZvcm1hbmNlIHB1cnBvc2UsIHRoZXNlIGFyZSBleHBhbmRlZCBpbiBwbGFjZSBoZXJlLlxuICAgICAgICB0aGlzLmFuZ2xlID0gZWRnZS5sU2l0ZSA9PT0gbFNpdGUgP1xuICAgICAgICAgICAgTWF0aC5hdGFuMih2Yi54LXZhLngsIHZhLnktdmIueSkgOlxuICAgICAgICAgICAgTWF0aC5hdGFuMih2YS54LXZiLngsIHZiLnktdmEueSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5jcmVhdGVIYWxmZWRnZSA9IGZ1bmN0aW9uKGVkZ2UsIGxTaXRlLCByU2l0ZSkge1xuICAgIHJldHVybiBuZXcgdGhpcy5IYWxmZWRnZShlZGdlLCBsU2l0ZSwgclNpdGUpO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLkhhbGZlZGdlLnByb3RvdHlwZS5nZXRTdGFydHBvaW50ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZWRnZS5sU2l0ZSA9PT0gdGhpcy5zaXRlID8gdGhpcy5lZGdlLnZhIDogdGhpcy5lZGdlLnZiO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLkhhbGZlZGdlLnByb3RvdHlwZS5nZXRFbmRwb2ludCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmVkZ2UubFNpdGUgPT09IHRoaXMuc2l0ZSA/IHRoaXMuZWRnZS52YiA6IHRoaXMuZWRnZS52YTtcbiAgICB9O1xuXG5cblxuLy8gdGhpcyBjcmVhdGUgYW5kIGFkZCBhIHZlcnRleCB0byB0aGUgaW50ZXJuYWwgY29sbGVjdGlvblxuXG5Wb3Jvbm9pLnByb3RvdHlwZS5jcmVhdGVWZXJ0ZXggPSBmdW5jdGlvbih4LCB5KSB7XG4gICAgdmFyIHYgPSB0aGlzLnZlcnRleEp1bmt5YXJkLnBvcCgpO1xuICAgIGlmICggIXYgKSB7XG4gICAgICAgIHYgPSBuZXcgdGhpcy5WZXJ0ZXgoeCwgeSk7XG4gICAgICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgdi54ID0geDtcbiAgICAgICAgdi55ID0geTtcbiAgICAgICAgfVxuICAgIHRoaXMudmVydGljZXMucHVzaCh2KTtcbiAgICByZXR1cm4gdjtcbiAgICB9O1xuXG4vLyB0aGlzIGNyZWF0ZSBhbmQgYWRkIGFuIGVkZ2UgdG8gaW50ZXJuYWwgY29sbGVjdGlvbiwgYW5kIGFsc28gY3JlYXRlXG4vLyB0d28gaGFsZmVkZ2VzIHdoaWNoIGFyZSBhZGRlZCB0byBlYWNoIHNpdGUncyBjb3VudGVyY2xvY2t3aXNlIGFycmF5XG4vLyBvZiBoYWxmZWRnZXMuXG5cblZvcm9ub2kucHJvdG90eXBlLmNyZWF0ZUVkZ2UgPSBmdW5jdGlvbihsU2l0ZSwgclNpdGUsIHZhLCB2Yikge1xuICAgIHZhciBlZGdlID0gdGhpcy5lZGdlSnVua3lhcmQucG9wKCk7XG4gICAgaWYgKCAhZWRnZSApIHtcbiAgICAgICAgZWRnZSA9IG5ldyB0aGlzLkVkZ2UobFNpdGUsIHJTaXRlKTtcbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBlZGdlLmxTaXRlID0gbFNpdGU7XG4gICAgICAgIGVkZ2UuclNpdGUgPSByU2l0ZTtcbiAgICAgICAgZWRnZS52YSA9IGVkZ2UudmIgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICB0aGlzLmVkZ2VzLnB1c2goZWRnZSk7XG4gICAgaWYgKHZhKSB7XG4gICAgICAgIHRoaXMuc2V0RWRnZVN0YXJ0cG9pbnQoZWRnZSwgbFNpdGUsIHJTaXRlLCB2YSk7XG4gICAgICAgIH1cbiAgICBpZiAodmIpIHtcbiAgICAgICAgdGhpcy5zZXRFZGdlRW5kcG9pbnQoZWRnZSwgbFNpdGUsIHJTaXRlLCB2Yik7XG4gICAgICAgIH1cbiAgICB0aGlzLmNlbGxzW2xTaXRlLnZvcm9ub2lJZF0uaGFsZmVkZ2VzLnB1c2godGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBsU2l0ZSwgclNpdGUpKTtcbiAgICB0aGlzLmNlbGxzW3JTaXRlLnZvcm9ub2lJZF0uaGFsZmVkZ2VzLnB1c2godGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCByU2l0ZSwgbFNpdGUpKTtcbiAgICByZXR1cm4gZWRnZTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5jcmVhdGVCb3JkZXJFZGdlID0gZnVuY3Rpb24obFNpdGUsIHZhLCB2Yikge1xuICAgIHZhciBlZGdlID0gdGhpcy5lZGdlSnVua3lhcmQucG9wKCk7XG4gICAgaWYgKCAhZWRnZSApIHtcbiAgICAgICAgZWRnZSA9IG5ldyB0aGlzLkVkZ2UobFNpdGUsIG51bGwpO1xuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGVkZ2UubFNpdGUgPSBsU2l0ZTtcbiAgICAgICAgZWRnZS5yU2l0ZSA9IG51bGw7XG4gICAgICAgIH1cbiAgICBlZGdlLnZhID0gdmE7XG4gICAgZWRnZS52YiA9IHZiO1xuICAgIHRoaXMuZWRnZXMucHVzaChlZGdlKTtcbiAgICByZXR1cm4gZWRnZTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5zZXRFZGdlU3RhcnRwb2ludCA9IGZ1bmN0aW9uKGVkZ2UsIGxTaXRlLCByU2l0ZSwgdmVydGV4KSB7XG4gICAgaWYgKCFlZGdlLnZhICYmICFlZGdlLnZiKSB7XG4gICAgICAgIGVkZ2UudmEgPSB2ZXJ0ZXg7XG4gICAgICAgIGVkZ2UubFNpdGUgPSBsU2l0ZTtcbiAgICAgICAgZWRnZS5yU2l0ZSA9IHJTaXRlO1xuICAgICAgICB9XG4gICAgZWxzZSBpZiAoZWRnZS5sU2l0ZSA9PT0gclNpdGUpIHtcbiAgICAgICAgZWRnZS52YiA9IHZlcnRleDtcbiAgICAgICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBlZGdlLnZhID0gdmVydGV4O1xuICAgICAgICB9XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuc2V0RWRnZUVuZHBvaW50ID0gZnVuY3Rpb24oZWRnZSwgbFNpdGUsIHJTaXRlLCB2ZXJ0ZXgpIHtcbiAgICB0aGlzLnNldEVkZ2VTdGFydHBvaW50KGVkZ2UsIHJTaXRlLCBsU2l0ZSwgdmVydGV4KTtcbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEJlYWNobGluZSBtZXRob2RzXG5cbi8vIHJoaWxsIDIwMTEtMDYtMDc6IEZvciBzb21lIHJlYXNvbnMsIHBlcmZvcm1hbmNlIHN1ZmZlcnMgc2lnbmlmaWNhbnRseVxuLy8gd2hlbiBpbnN0YW5jaWF0aW5nIGEgbGl0ZXJhbCBvYmplY3QgaW5zdGVhZCBvZiBhbiBlbXB0eSBjdG9yXG5Wb3Jvbm9pLnByb3RvdHlwZS5CZWFjaHNlY3Rpb24gPSBmdW5jdGlvbigpIHtcbiAgICB9O1xuXG4vLyByaGlsbCAyMDExLTA2LTAyOiBBIGxvdCBvZiBCZWFjaHNlY3Rpb24gaW5zdGFuY2lhdGlvbnNcbi8vIG9jY3VyIGR1cmluZyB0aGUgY29tcHV0YXRpb24gb2YgdGhlIFZvcm9ub2kgZGlhZ3JhbSxcbi8vIHNvbWV3aGVyZSBiZXR3ZWVuIHRoZSBudW1iZXIgb2Ygc2l0ZXMgYW5kIHR3aWNlIHRoZVxuLy8gbnVtYmVyIG9mIHNpdGVzLCB3aGlsZSB0aGUgbnVtYmVyIG9mIEJlYWNoc2VjdGlvbnMgb24gdGhlXG4vLyBiZWFjaGxpbmUgYXQgYW55IGdpdmVuIHRpbWUgaXMgY29tcGFyYXRpdmVseSBsb3cuIEZvciB0aGlzXG4vLyByZWFzb24sIHdlIHJldXNlIGFscmVhZHkgY3JlYXRlZCBCZWFjaHNlY3Rpb25zLCBpbiBvcmRlclxuLy8gdG8gYXZvaWQgbmV3IG1lbW9yeSBhbGxvY2F0aW9uLiBUaGlzIHJlc3VsdGVkIGluIGEgbWVhc3VyYWJsZVxuLy8gcGVyZm9ybWFuY2UgZ2Fpbi5cblxuVm9yb25vaS5wcm90b3R5cGUuY3JlYXRlQmVhY2hzZWN0aW9uID0gZnVuY3Rpb24oc2l0ZSkge1xuICAgIHZhciBiZWFjaHNlY3Rpb24gPSB0aGlzLmJlYWNoc2VjdGlvbkp1bmt5YXJkLnBvcCgpO1xuICAgIGlmICghYmVhY2hzZWN0aW9uKSB7XG4gICAgICAgIGJlYWNoc2VjdGlvbiA9IG5ldyB0aGlzLkJlYWNoc2VjdGlvbigpO1xuICAgICAgICB9XG4gICAgYmVhY2hzZWN0aW9uLnNpdGUgPSBzaXRlO1xuICAgIHJldHVybiBiZWFjaHNlY3Rpb247XG4gICAgfTtcblxuLy8gY2FsY3VsYXRlIHRoZSBsZWZ0IGJyZWFrIHBvaW50IG9mIGEgcGFydGljdWxhciBiZWFjaCBzZWN0aW9uLFxuLy8gZ2l2ZW4gYSBwYXJ0aWN1bGFyIHN3ZWVwIGxpbmVcblZvcm9ub2kucHJvdG90eXBlLmxlZnRCcmVha1BvaW50ID0gZnVuY3Rpb24oYXJjLCBkaXJlY3RyaXgpIHtcbiAgICAvLyBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL1BhcmFib2xhXG4gICAgLy8gaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9RdWFkcmF0aWNfZXF1YXRpb25cbiAgICAvLyBoMSA9IHgxLFxuICAgIC8vIGsxID0gKHkxK2RpcmVjdHJpeCkvMixcbiAgICAvLyBoMiA9IHgyLFxuICAgIC8vIGsyID0gKHkyK2RpcmVjdHJpeCkvMixcbiAgICAvLyBwMSA9IGsxLWRpcmVjdHJpeCxcbiAgICAvLyBhMSA9IDEvKDQqcDEpLFxuICAgIC8vIGIxID0gLWgxLygyKnAxKSxcbiAgICAvLyBjMSA9IGgxKmgxLyg0KnAxKStrMSxcbiAgICAvLyBwMiA9IGsyLWRpcmVjdHJpeCxcbiAgICAvLyBhMiA9IDEvKDQqcDIpLFxuICAgIC8vIGIyID0gLWgyLygyKnAyKSxcbiAgICAvLyBjMiA9IGgyKmgyLyg0KnAyKStrMixcbiAgICAvLyB4ID0gKC0oYjItYjEpICsgTWF0aC5zcXJ0KChiMi1iMSkqKGIyLWIxKSAtIDQqKGEyLWExKSooYzItYzEpKSkgLyAoMiooYTItYTEpKVxuICAgIC8vIFdoZW4geDEgYmVjb21lIHRoZSB4LW9yaWdpbjpcbiAgICAvLyBoMSA9IDAsXG4gICAgLy8gazEgPSAoeTErZGlyZWN0cml4KS8yLFxuICAgIC8vIGgyID0geDIteDEsXG4gICAgLy8gazIgPSAoeTIrZGlyZWN0cml4KS8yLFxuICAgIC8vIHAxID0gazEtZGlyZWN0cml4LFxuICAgIC8vIGExID0gMS8oNCpwMSksXG4gICAgLy8gYjEgPSAwLFxuICAgIC8vIGMxID0gazEsXG4gICAgLy8gcDIgPSBrMi1kaXJlY3RyaXgsXG4gICAgLy8gYTIgPSAxLyg0KnAyKSxcbiAgICAvLyBiMiA9IC1oMi8oMipwMiksXG4gICAgLy8gYzIgPSBoMipoMi8oNCpwMikrazIsXG4gICAgLy8geCA9ICgtYjIgKyBNYXRoLnNxcnQoYjIqYjIgLSA0KihhMi1hMSkqKGMyLWsxKSkpIC8gKDIqKGEyLWExKSkgKyB4MVxuXG4gICAgLy8gY2hhbmdlIGNvZGUgYmVsb3cgYXQgeW91ciBvd24gcmlzazogY2FyZSBoYXMgYmVlbiB0YWtlbiB0b1xuICAgIC8vIHJlZHVjZSBlcnJvcnMgZHVlIHRvIGNvbXB1dGVycycgZmluaXRlIGFyaXRobWV0aWMgcHJlY2lzaW9uLlxuICAgIC8vIE1heWJlIGNhbiBzdGlsbCBiZSBpbXByb3ZlZCwgd2lsbCBzZWUgaWYgYW55IG1vcmUgb2YgdGhpc1xuICAgIC8vIGtpbmQgb2YgZXJyb3JzIHBvcCB1cCBhZ2Fpbi5cbiAgICB2YXIgc2l0ZSA9IGFyYy5zaXRlLFxuICAgICAgICByZm9jeCA9IHNpdGUueCxcbiAgICAgICAgcmZvY3kgPSBzaXRlLnksXG4gICAgICAgIHBieTIgPSByZm9jeS1kaXJlY3RyaXg7XG4gICAgLy8gcGFyYWJvbGEgaW4gZGVnZW5lcmF0ZSBjYXNlIHdoZXJlIGZvY3VzIGlzIG9uIGRpcmVjdHJpeFxuICAgIGlmICghcGJ5Mikge1xuICAgICAgICByZXR1cm4gcmZvY3g7XG4gICAgICAgIH1cbiAgICB2YXIgbEFyYyA9IGFyYy5yYlByZXZpb3VzO1xuICAgIGlmICghbEFyYykge1xuICAgICAgICByZXR1cm4gLUluZmluaXR5O1xuICAgICAgICB9XG4gICAgc2l0ZSA9IGxBcmMuc2l0ZTtcbiAgICB2YXIgbGZvY3ggPSBzaXRlLngsXG4gICAgICAgIGxmb2N5ID0gc2l0ZS55LFxuICAgICAgICBwbGJ5MiA9IGxmb2N5LWRpcmVjdHJpeDtcbiAgICAvLyBwYXJhYm9sYSBpbiBkZWdlbmVyYXRlIGNhc2Ugd2hlcmUgZm9jdXMgaXMgb24gZGlyZWN0cml4XG4gICAgaWYgKCFwbGJ5Mikge1xuICAgICAgICByZXR1cm4gbGZvY3g7XG4gICAgICAgIH1cbiAgICB2YXIgaGwgPSBsZm9jeC1yZm9jeCxcbiAgICAgICAgYWJ5MiA9IDEvcGJ5Mi0xL3BsYnkyLFxuICAgICAgICBiID0gaGwvcGxieTI7XG4gICAgaWYgKGFieTIpIHtcbiAgICAgICAgcmV0dXJuICgtYit0aGlzLnNxcnQoYipiLTIqYWJ5MiooaGwqaGwvKC0yKnBsYnkyKS1sZm9jeStwbGJ5Mi8yK3Jmb2N5LXBieTIvMikpKS9hYnkyK3Jmb2N4O1xuICAgICAgICB9XG4gICAgLy8gYm90aCBwYXJhYm9sYXMgaGF2ZSBzYW1lIGRpc3RhbmNlIHRvIGRpcmVjdHJpeCwgdGh1cyBicmVhayBwb2ludCBpcyBtaWR3YXlcbiAgICByZXR1cm4gKHJmb2N4K2xmb2N4KS8yO1xuICAgIH07XG5cbi8vIGNhbGN1bGF0ZSB0aGUgcmlnaHQgYnJlYWsgcG9pbnQgb2YgYSBwYXJ0aWN1bGFyIGJlYWNoIHNlY3Rpb24sXG4vLyBnaXZlbiBhIHBhcnRpY3VsYXIgZGlyZWN0cml4XG5Wb3Jvbm9pLnByb3RvdHlwZS5yaWdodEJyZWFrUG9pbnQgPSBmdW5jdGlvbihhcmMsIGRpcmVjdHJpeCkge1xuICAgIHZhciByQXJjID0gYXJjLnJiTmV4dDtcbiAgICBpZiAockFyYykge1xuICAgICAgICByZXR1cm4gdGhpcy5sZWZ0QnJlYWtQb2ludChyQXJjLCBkaXJlY3RyaXgpO1xuICAgICAgICB9XG4gICAgdmFyIHNpdGUgPSBhcmMuc2l0ZTtcbiAgICByZXR1cm4gc2l0ZS55ID09PSBkaXJlY3RyaXggPyBzaXRlLnggOiBJbmZpbml0eTtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5kZXRhY2hCZWFjaHNlY3Rpb24gPSBmdW5jdGlvbihiZWFjaHNlY3Rpb24pIHtcbiAgICB0aGlzLmRldGFjaENpcmNsZUV2ZW50KGJlYWNoc2VjdGlvbik7IC8vIGRldGFjaCBwb3RlbnRpYWxseSBhdHRhY2hlZCBjaXJjbGUgZXZlbnRcbiAgICB0aGlzLmJlYWNobGluZS5yYlJlbW92ZU5vZGUoYmVhY2hzZWN0aW9uKTsgLy8gcmVtb3ZlIGZyb20gUkItdHJlZVxuICAgIHRoaXMuYmVhY2hzZWN0aW9uSnVua3lhcmQucHVzaChiZWFjaHNlY3Rpb24pOyAvLyBtYXJrIGZvciByZXVzZVxuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLnJlbW92ZUJlYWNoc2VjdGlvbiA9IGZ1bmN0aW9uKGJlYWNoc2VjdGlvbikge1xuICAgIHZhciBjaXJjbGUgPSBiZWFjaHNlY3Rpb24uY2lyY2xlRXZlbnQsXG4gICAgICAgIHggPSBjaXJjbGUueCxcbiAgICAgICAgeSA9IGNpcmNsZS55Y2VudGVyLFxuICAgICAgICB2ZXJ0ZXggPSB0aGlzLmNyZWF0ZVZlcnRleCh4LCB5KSxcbiAgICAgICAgcHJldmlvdXMgPSBiZWFjaHNlY3Rpb24ucmJQcmV2aW91cyxcbiAgICAgICAgbmV4dCA9IGJlYWNoc2VjdGlvbi5yYk5leHQsXG4gICAgICAgIGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zID0gW2JlYWNoc2VjdGlvbl0sXG4gICAgICAgIGFic19mbiA9IE1hdGguYWJzO1xuXG4gICAgLy8gcmVtb3ZlIGNvbGxhcHNlZCBiZWFjaHNlY3Rpb24gZnJvbSBiZWFjaGxpbmVcbiAgICB0aGlzLmRldGFjaEJlYWNoc2VjdGlvbihiZWFjaHNlY3Rpb24pO1xuXG4gICAgLy8gdGhlcmUgY291bGQgYmUgbW9yZSB0aGFuIG9uZSBlbXB0eSBhcmMgYXQgdGhlIGRlbGV0aW9uIHBvaW50LCB0aGlzXG4gICAgLy8gaGFwcGVucyB3aGVuIG1vcmUgdGhhbiB0d28gZWRnZXMgYXJlIGxpbmtlZCBieSB0aGUgc2FtZSB2ZXJ0ZXgsXG4gICAgLy8gc28gd2Ugd2lsbCBjb2xsZWN0IGFsbCB0aG9zZSBlZGdlcyBieSBsb29raW5nIHVwIGJvdGggc2lkZXMgb2ZcbiAgICAvLyB0aGUgZGVsZXRpb24gcG9pbnQuXG4gICAgLy8gYnkgdGhlIHdheSwgdGhlcmUgaXMgKmFsd2F5cyogYSBwcmVkZWNlc3Nvci9zdWNjZXNzb3IgdG8gYW55IGNvbGxhcHNlZFxuICAgIC8vIGJlYWNoIHNlY3Rpb24sIGl0J3MganVzdCBpbXBvc3NpYmxlIHRvIGhhdmUgYSBjb2xsYXBzaW5nIGZpcnN0L2xhc3RcbiAgICAvLyBiZWFjaCBzZWN0aW9ucyBvbiB0aGUgYmVhY2hsaW5lLCBzaW5jZSB0aGV5IG9idmlvdXNseSBhcmUgdW5jb25zdHJhaW5lZFxuICAgIC8vIG9uIHRoZWlyIGxlZnQvcmlnaHQgc2lkZS5cblxuICAgIC8vIGxvb2sgbGVmdFxuICAgIHZhciBsQXJjID0gcHJldmlvdXM7XG4gICAgd2hpbGUgKGxBcmMuY2lyY2xlRXZlbnQgJiYgYWJzX2ZuKHgtbEFyYy5jaXJjbGVFdmVudC54KTwxZS05ICYmIGFic19mbih5LWxBcmMuY2lyY2xlRXZlbnQueWNlbnRlcik8MWUtOSkge1xuICAgICAgICBwcmV2aW91cyA9IGxBcmMucmJQcmV2aW91cztcbiAgICAgICAgZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnMudW5zaGlmdChsQXJjKTtcbiAgICAgICAgdGhpcy5kZXRhY2hCZWFjaHNlY3Rpb24obEFyYyk7IC8vIG1hcmsgZm9yIHJldXNlXG4gICAgICAgIGxBcmMgPSBwcmV2aW91cztcbiAgICAgICAgfVxuICAgIC8vIGV2ZW4gdGhvdWdoIGl0IGlzIG5vdCBkaXNhcHBlYXJpbmcsIEkgd2lsbCBhbHNvIGFkZCB0aGUgYmVhY2ggc2VjdGlvblxuICAgIC8vIGltbWVkaWF0ZWx5IHRvIHRoZSBsZWZ0IG9mIHRoZSBsZWZ0LW1vc3QgY29sbGFwc2VkIGJlYWNoIHNlY3Rpb24sIGZvclxuICAgIC8vIGNvbnZlbmllbmNlLCBzaW5jZSB3ZSBuZWVkIHRvIHJlZmVyIHRvIGl0IGxhdGVyIGFzIHRoaXMgYmVhY2ggc2VjdGlvblxuICAgIC8vIGlzIHRoZSAnbGVmdCcgc2l0ZSBvZiBhbiBlZGdlIGZvciB3aGljaCBhIHN0YXJ0IHBvaW50IGlzIHNldC5cbiAgICBkaXNhcHBlYXJpbmdUcmFuc2l0aW9ucy51bnNoaWZ0KGxBcmMpO1xuICAgIHRoaXMuZGV0YWNoQ2lyY2xlRXZlbnQobEFyYyk7XG5cbiAgICAvLyBsb29rIHJpZ2h0XG4gICAgdmFyIHJBcmMgPSBuZXh0O1xuICAgIHdoaWxlIChyQXJjLmNpcmNsZUV2ZW50ICYmIGFic19mbih4LXJBcmMuY2lyY2xlRXZlbnQueCk8MWUtOSAmJiBhYnNfZm4oeS1yQXJjLmNpcmNsZUV2ZW50LnljZW50ZXIpPDFlLTkpIHtcbiAgICAgICAgbmV4dCA9IHJBcmMucmJOZXh0O1xuICAgICAgICBkaXNhcHBlYXJpbmdUcmFuc2l0aW9ucy5wdXNoKHJBcmMpO1xuICAgICAgICB0aGlzLmRldGFjaEJlYWNoc2VjdGlvbihyQXJjKTsgLy8gbWFyayBmb3IgcmV1c2VcbiAgICAgICAgckFyYyA9IG5leHQ7XG4gICAgICAgIH1cbiAgICAvLyB3ZSBhbHNvIGhhdmUgdG8gYWRkIHRoZSBiZWFjaCBzZWN0aW9uIGltbWVkaWF0ZWx5IHRvIHRoZSByaWdodCBvZiB0aGVcbiAgICAvLyByaWdodC1tb3N0IGNvbGxhcHNlZCBiZWFjaCBzZWN0aW9uLCBzaW5jZSB0aGVyZSBpcyBhbHNvIGEgZGlzYXBwZWFyaW5nXG4gICAgLy8gdHJhbnNpdGlvbiByZXByZXNlbnRpbmcgYW4gZWRnZSdzIHN0YXJ0IHBvaW50IG9uIGl0cyBsZWZ0LlxuICAgIGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zLnB1c2gockFyYyk7XG4gICAgdGhpcy5kZXRhY2hDaXJjbGVFdmVudChyQXJjKTtcblxuICAgIC8vIHdhbGsgdGhyb3VnaCBhbGwgdGhlIGRpc2FwcGVhcmluZyB0cmFuc2l0aW9ucyBiZXR3ZWVuIGJlYWNoIHNlY3Rpb25zIGFuZFxuICAgIC8vIHNldCB0aGUgc3RhcnQgcG9pbnQgb2YgdGhlaXIgKGltcGxpZWQpIGVkZ2UuXG4gICAgdmFyIG5BcmNzID0gZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnMubGVuZ3RoLFxuICAgICAgICBpQXJjO1xuICAgIGZvciAoaUFyYz0xOyBpQXJjPG5BcmNzOyBpQXJjKyspIHtcbiAgICAgICAgckFyYyA9IGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zW2lBcmNdO1xuICAgICAgICBsQXJjID0gZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnNbaUFyYy0xXTtcbiAgICAgICAgdGhpcy5zZXRFZGdlU3RhcnRwb2ludChyQXJjLmVkZ2UsIGxBcmMuc2l0ZSwgckFyYy5zaXRlLCB2ZXJ0ZXgpO1xuICAgICAgICB9XG5cbiAgICAvLyBjcmVhdGUgYSBuZXcgZWRnZSBhcyB3ZSBoYXZlIG5vdyBhIG5ldyB0cmFuc2l0aW9uIGJldHdlZW5cbiAgICAvLyB0d28gYmVhY2ggc2VjdGlvbnMgd2hpY2ggd2VyZSBwcmV2aW91c2x5IG5vdCBhZGphY2VudC5cbiAgICAvLyBzaW5jZSB0aGlzIGVkZ2UgYXBwZWFycyBhcyBhIG5ldyB2ZXJ0ZXggaXMgZGVmaW5lZCwgdGhlIHZlcnRleFxuICAgIC8vIGFjdHVhbGx5IGRlZmluZSBhbiBlbmQgcG9pbnQgb2YgdGhlIGVkZ2UgKHJlbGF0aXZlIHRvIHRoZSBzaXRlXG4gICAgLy8gb24gdGhlIGxlZnQpXG4gICAgbEFyYyA9IGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zWzBdO1xuICAgIHJBcmMgPSBkaXNhcHBlYXJpbmdUcmFuc2l0aW9uc1tuQXJjcy0xXTtcbiAgICByQXJjLmVkZ2UgPSB0aGlzLmNyZWF0ZUVkZ2UobEFyYy5zaXRlLCByQXJjLnNpdGUsIHVuZGVmaW5lZCwgdmVydGV4KTtcblxuICAgIC8vIGNyZWF0ZSBjaXJjbGUgZXZlbnRzIGlmIGFueSBmb3IgYmVhY2ggc2VjdGlvbnMgbGVmdCBpbiB0aGUgYmVhY2hsaW5lXG4gICAgLy8gYWRqYWNlbnQgdG8gY29sbGFwc2VkIHNlY3Rpb25zXG4gICAgdGhpcy5hdHRhY2hDaXJjbGVFdmVudChsQXJjKTtcbiAgICB0aGlzLmF0dGFjaENpcmNsZUV2ZW50KHJBcmMpO1xuICAgIH07XG5cblZvcm9ub2kucHJvdG90eXBlLmFkZEJlYWNoc2VjdGlvbiA9IGZ1bmN0aW9uKHNpdGUpIHtcbiAgICB2YXIgeCA9IHNpdGUueCxcbiAgICAgICAgZGlyZWN0cml4ID0gc2l0ZS55O1xuXG4gICAgLy8gZmluZCB0aGUgbGVmdCBhbmQgcmlnaHQgYmVhY2ggc2VjdGlvbnMgd2hpY2ggd2lsbCBzdXJyb3VuZCB0aGUgbmV3bHlcbiAgICAvLyBjcmVhdGVkIGJlYWNoIHNlY3Rpb24uXG4gICAgLy8gcmhpbGwgMjAxMS0wNi0wMTogVGhpcyBsb29wIGlzIG9uZSBvZiB0aGUgbW9zdCBvZnRlbiBleGVjdXRlZCxcbiAgICAvLyBoZW5jZSB3ZSBleHBhbmQgaW4tcGxhY2UgdGhlIGNvbXBhcmlzb24tYWdhaW5zdC1lcHNpbG9uIGNhbGxzLlxuICAgIHZhciBsQXJjLCByQXJjLFxuICAgICAgICBkeGwsIGR4cixcbiAgICAgICAgbm9kZSA9IHRoaXMuYmVhY2hsaW5lLnJvb3Q7XG5cbiAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICBkeGwgPSB0aGlzLmxlZnRCcmVha1BvaW50KG5vZGUsZGlyZWN0cml4KS14O1xuICAgICAgICAvLyB4IGxlc3NUaGFuV2l0aEVwc2lsb24geGwgPT4gZmFsbHMgc29tZXdoZXJlIGJlZm9yZSB0aGUgbGVmdCBlZGdlIG9mIHRoZSBiZWFjaHNlY3Rpb25cbiAgICAgICAgaWYgKGR4bCA+IDFlLTkpIHtcbiAgICAgICAgICAgIC8vIHRoaXMgY2FzZSBzaG91bGQgbmV2ZXIgaGFwcGVuXG4gICAgICAgICAgICAvLyBpZiAoIW5vZGUucmJMZWZ0KSB7XG4gICAgICAgICAgICAvLyAgICByQXJjID0gbm9kZS5yYkxlZnQ7XG4gICAgICAgICAgICAvLyAgICBicmVhaztcbiAgICAgICAgICAgIC8vICAgIH1cbiAgICAgICAgICAgIG5vZGUgPSBub2RlLnJiTGVmdDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBkeHIgPSB4LXRoaXMucmlnaHRCcmVha1BvaW50KG5vZGUsZGlyZWN0cml4KTtcbiAgICAgICAgICAgIC8vIHggZ3JlYXRlclRoYW5XaXRoRXBzaWxvbiB4ciA9PiBmYWxscyBzb21ld2hlcmUgYWZ0ZXIgdGhlIHJpZ2h0IGVkZ2Ugb2YgdGhlIGJlYWNoc2VjdGlvblxuICAgICAgICAgICAgaWYgKGR4ciA+IDFlLTkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIW5vZGUucmJSaWdodCkge1xuICAgICAgICAgICAgICAgICAgICBsQXJjID0gbm9kZTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBub2RlID0gbm9kZS5yYlJpZ2h0O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIHggZXF1YWxXaXRoRXBzaWxvbiB4bCA9PiBmYWxscyBleGFjdGx5IG9uIHRoZSBsZWZ0IGVkZ2Ugb2YgdGhlIGJlYWNoc2VjdGlvblxuICAgICAgICAgICAgICAgIGlmIChkeGwgPiAtMWUtOSkge1xuICAgICAgICAgICAgICAgICAgICBsQXJjID0gbm9kZS5yYlByZXZpb3VzO1xuICAgICAgICAgICAgICAgICAgICByQXJjID0gbm9kZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIHggZXF1YWxXaXRoRXBzaWxvbiB4ciA9PiBmYWxscyBleGFjdGx5IG9uIHRoZSByaWdodCBlZGdlIG9mIHRoZSBiZWFjaHNlY3Rpb25cbiAgICAgICAgICAgICAgICBlbHNlIGlmIChkeHIgPiAtMWUtOSkge1xuICAgICAgICAgICAgICAgICAgICBsQXJjID0gbm9kZTtcbiAgICAgICAgICAgICAgICAgICAgckFyYyA9IG5vZGUucmJOZXh0O1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gZmFsbHMgZXhhY3RseSBzb21ld2hlcmUgaW4gdGhlIG1pZGRsZSBvZiB0aGUgYmVhY2hzZWN0aW9uXG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGxBcmMgPSByQXJjID0gbm9kZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIC8vIGF0IHRoaXMgcG9pbnQsIGtlZXAgaW4gbWluZCB0aGF0IGxBcmMgYW5kL29yIHJBcmMgY291bGQgYmVcbiAgICAvLyB1bmRlZmluZWQgb3IgbnVsbC5cblxuICAgIC8vIGNyZWF0ZSBhIG5ldyBiZWFjaCBzZWN0aW9uIG9iamVjdCBmb3IgdGhlIHNpdGUgYW5kIGFkZCBpdCB0byBSQi10cmVlXG4gICAgdmFyIG5ld0FyYyA9IHRoaXMuY3JlYXRlQmVhY2hzZWN0aW9uKHNpdGUpO1xuICAgIHRoaXMuYmVhY2hsaW5lLnJiSW5zZXJ0U3VjY2Vzc29yKGxBcmMsIG5ld0FyYyk7XG5cbiAgICAvLyBjYXNlczpcbiAgICAvL1xuXG4gICAgLy8gW251bGwsbnVsbF1cbiAgICAvLyBsZWFzdCBsaWtlbHkgY2FzZTogbmV3IGJlYWNoIHNlY3Rpb24gaXMgdGhlIGZpcnN0IGJlYWNoIHNlY3Rpb24gb24gdGhlXG4gICAgLy8gYmVhY2hsaW5lLlxuICAgIC8vIFRoaXMgY2FzZSBtZWFuczpcbiAgICAvLyAgIG5vIG5ldyB0cmFuc2l0aW9uIGFwcGVhcnNcbiAgICAvLyAgIG5vIGNvbGxhcHNpbmcgYmVhY2ggc2VjdGlvblxuICAgIC8vICAgbmV3IGJlYWNoc2VjdGlvbiBiZWNvbWUgcm9vdCBvZiB0aGUgUkItdHJlZVxuICAgIGlmICghbEFyYyAmJiAhckFyYykge1xuICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgIC8vIFtsQXJjLHJBcmNdIHdoZXJlIGxBcmMgPT0gckFyY1xuICAgIC8vIG1vc3QgbGlrZWx5IGNhc2U6IG5ldyBiZWFjaCBzZWN0aW9uIHNwbGl0IGFuIGV4aXN0aW5nIGJlYWNoXG4gICAgLy8gc2VjdGlvbi5cbiAgICAvLyBUaGlzIGNhc2UgbWVhbnM6XG4gICAgLy8gICBvbmUgbmV3IHRyYW5zaXRpb24gYXBwZWFyc1xuICAgIC8vICAgdGhlIGxlZnQgYW5kIHJpZ2h0IGJlYWNoIHNlY3Rpb24gbWlnaHQgYmUgY29sbGFwc2luZyBhcyBhIHJlc3VsdFxuICAgIC8vICAgdHdvIG5ldyBub2RlcyBhZGRlZCB0byB0aGUgUkItdHJlZVxuICAgIGlmIChsQXJjID09PSByQXJjKSB7XG4gICAgICAgIC8vIGludmFsaWRhdGUgY2lyY2xlIGV2ZW50IG9mIHNwbGl0IGJlYWNoIHNlY3Rpb25cbiAgICAgICAgdGhpcy5kZXRhY2hDaXJjbGVFdmVudChsQXJjKTtcblxuICAgICAgICAvLyBzcGxpdCB0aGUgYmVhY2ggc2VjdGlvbiBpbnRvIHR3byBzZXBhcmF0ZSBiZWFjaCBzZWN0aW9uc1xuICAgICAgICByQXJjID0gdGhpcy5jcmVhdGVCZWFjaHNlY3Rpb24obEFyYy5zaXRlKTtcbiAgICAgICAgdGhpcy5iZWFjaGxpbmUucmJJbnNlcnRTdWNjZXNzb3IobmV3QXJjLCByQXJjKTtcblxuICAgICAgICAvLyBzaW5jZSB3ZSBoYXZlIGEgbmV3IHRyYW5zaXRpb24gYmV0d2VlbiB0d28gYmVhY2ggc2VjdGlvbnMsXG4gICAgICAgIC8vIGEgbmV3IGVkZ2UgaXMgYm9yblxuICAgICAgICBuZXdBcmMuZWRnZSA9IHJBcmMuZWRnZSA9IHRoaXMuY3JlYXRlRWRnZShsQXJjLnNpdGUsIG5ld0FyYy5zaXRlKTtcblxuICAgICAgICAvLyBjaGVjayB3aGV0aGVyIHRoZSBsZWZ0IGFuZCByaWdodCBiZWFjaCBzZWN0aW9ucyBhcmUgY29sbGFwc2luZ1xuICAgICAgICAvLyBhbmQgaWYgc28gY3JlYXRlIGNpcmNsZSBldmVudHMsIHRvIGJlIG5vdGlmaWVkIHdoZW4gdGhlIHBvaW50IG9mXG4gICAgICAgIC8vIGNvbGxhcHNlIGlzIHJlYWNoZWQuXG4gICAgICAgIHRoaXMuYXR0YWNoQ2lyY2xlRXZlbnQobEFyYyk7XG4gICAgICAgIHRoaXMuYXR0YWNoQ2lyY2xlRXZlbnQockFyYyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgLy8gW2xBcmMsbnVsbF1cbiAgICAvLyBldmVuIGxlc3MgbGlrZWx5IGNhc2U6IG5ldyBiZWFjaCBzZWN0aW9uIGlzIHRoZSAqbGFzdCogYmVhY2ggc2VjdGlvblxuICAgIC8vIG9uIHRoZSBiZWFjaGxpbmUgLS0gdGhpcyBjYW4gaGFwcGVuICpvbmx5KiBpZiAqYWxsKiB0aGUgcHJldmlvdXMgYmVhY2hcbiAgICAvLyBzZWN0aW9ucyBjdXJyZW50bHkgb24gdGhlIGJlYWNobGluZSBzaGFyZSB0aGUgc2FtZSB5IHZhbHVlIGFzXG4gICAgLy8gdGhlIG5ldyBiZWFjaCBzZWN0aW9uLlxuICAgIC8vIFRoaXMgY2FzZSBtZWFuczpcbiAgICAvLyAgIG9uZSBuZXcgdHJhbnNpdGlvbiBhcHBlYXJzXG4gICAgLy8gICBubyBjb2xsYXBzaW5nIGJlYWNoIHNlY3Rpb24gYXMgYSByZXN1bHRcbiAgICAvLyAgIG5ldyBiZWFjaCBzZWN0aW9uIGJlY29tZSByaWdodC1tb3N0IG5vZGUgb2YgdGhlIFJCLXRyZWVcbiAgICBpZiAobEFyYyAmJiAhckFyYykge1xuICAgICAgICBuZXdBcmMuZWRnZSA9IHRoaXMuY3JlYXRlRWRnZShsQXJjLnNpdGUsbmV3QXJjLnNpdGUpO1xuICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgIC8vIFtudWxsLHJBcmNdXG4gICAgLy8gaW1wb3NzaWJsZSBjYXNlOiBiZWNhdXNlIHNpdGVzIGFyZSBzdHJpY3RseSBwcm9jZXNzZWQgZnJvbSB0b3AgdG8gYm90dG9tLFxuICAgIC8vIGFuZCBsZWZ0IHRvIHJpZ2h0LCB3aGljaCBndWFyYW50ZWVzIHRoYXQgdGhlcmUgd2lsbCBhbHdheXMgYmUgYSBiZWFjaCBzZWN0aW9uXG4gICAgLy8gb24gdGhlIGxlZnQgLS0gZXhjZXB0IG9mIGNvdXJzZSB3aGVuIHRoZXJlIGFyZSBubyBiZWFjaCBzZWN0aW9uIGF0IGFsbCBvblxuICAgIC8vIHRoZSBiZWFjaCBsaW5lLCB3aGljaCBjYXNlIHdhcyBoYW5kbGVkIGFib3ZlLlxuICAgIC8vIHJoaWxsIDIwMTEtMDYtMDI6IE5vIHBvaW50IHRlc3RpbmcgaW4gbm9uLWRlYnVnIHZlcnNpb25cbiAgICAvL2lmICghbEFyYyAmJiByQXJjKSB7XG4gICAgLy8gICAgdGhyb3cgXCJWb3Jvbm9pLmFkZEJlYWNoc2VjdGlvbigpOiBXaGF0IGlzIHRoaXMgSSBkb24ndCBldmVuXCI7XG4gICAgLy8gICAgfVxuXG4gICAgLy8gW2xBcmMsckFyY10gd2hlcmUgbEFyYyAhPSByQXJjXG4gICAgLy8gc29tZXdoYXQgbGVzcyBsaWtlbHkgY2FzZTogbmV3IGJlYWNoIHNlY3Rpb24gZmFsbHMgKmV4YWN0bHkqIGluIGJldHdlZW4gdHdvXG4gICAgLy8gZXhpc3RpbmcgYmVhY2ggc2VjdGlvbnNcbiAgICAvLyBUaGlzIGNhc2UgbWVhbnM6XG4gICAgLy8gICBvbmUgdHJhbnNpdGlvbiBkaXNhcHBlYXJzXG4gICAgLy8gICB0d28gbmV3IHRyYW5zaXRpb25zIGFwcGVhclxuICAgIC8vICAgdGhlIGxlZnQgYW5kIHJpZ2h0IGJlYWNoIHNlY3Rpb24gbWlnaHQgYmUgY29sbGFwc2luZyBhcyBhIHJlc3VsdFxuICAgIC8vICAgb25seSBvbmUgbmV3IG5vZGUgYWRkZWQgdG8gdGhlIFJCLXRyZWVcbiAgICBpZiAobEFyYyAhPT0gckFyYykge1xuICAgICAgICAvLyBpbnZhbGlkYXRlIGNpcmNsZSBldmVudHMgb2YgbGVmdCBhbmQgcmlnaHQgc2l0ZXNcbiAgICAgICAgdGhpcy5kZXRhY2hDaXJjbGVFdmVudChsQXJjKTtcbiAgICAgICAgdGhpcy5kZXRhY2hDaXJjbGVFdmVudChyQXJjKTtcblxuICAgICAgICAvLyBhbiBleGlzdGluZyB0cmFuc2l0aW9uIGRpc2FwcGVhcnMsIG1lYW5pbmcgYSB2ZXJ0ZXggaXMgZGVmaW5lZCBhdFxuICAgICAgICAvLyB0aGUgZGlzYXBwZWFyYW5jZSBwb2ludC5cbiAgICAgICAgLy8gc2luY2UgdGhlIGRpc2FwcGVhcmFuY2UgaXMgY2F1c2VkIGJ5IHRoZSBuZXcgYmVhY2hzZWN0aW9uLCB0aGVcbiAgICAgICAgLy8gdmVydGV4IGlzIGF0IHRoZSBjZW50ZXIgb2YgdGhlIGNpcmN1bXNjcmliZWQgY2lyY2xlIG9mIHRoZSBsZWZ0LFxuICAgICAgICAvLyBuZXcgYW5kIHJpZ2h0IGJlYWNoc2VjdGlvbnMuXG4gICAgICAgIC8vIGh0dHA6Ly9tYXRoZm9ydW0ub3JnL2xpYnJhcnkvZHJtYXRoL3ZpZXcvNTUwMDIuaHRtbFxuICAgICAgICAvLyBFeGNlcHQgdGhhdCBJIGJyaW5nIHRoZSBvcmlnaW4gYXQgQSB0byBzaW1wbGlmeVxuICAgICAgICAvLyBjYWxjdWxhdGlvblxuICAgICAgICB2YXIgbFNpdGUgPSBsQXJjLnNpdGUsXG4gICAgICAgICAgICBheCA9IGxTaXRlLngsXG4gICAgICAgICAgICBheSA9IGxTaXRlLnksXG4gICAgICAgICAgICBieD1zaXRlLngtYXgsXG4gICAgICAgICAgICBieT1zaXRlLnktYXksXG4gICAgICAgICAgICByU2l0ZSA9IHJBcmMuc2l0ZSxcbiAgICAgICAgICAgIGN4PXJTaXRlLngtYXgsXG4gICAgICAgICAgICBjeT1yU2l0ZS55LWF5LFxuICAgICAgICAgICAgZD0yKihieCpjeS1ieSpjeCksXG4gICAgICAgICAgICBoYj1ieCpieCtieSpieSxcbiAgICAgICAgICAgIGhjPWN4KmN4K2N5KmN5LFxuICAgICAgICAgICAgdmVydGV4ID0gdGhpcy5jcmVhdGVWZXJ0ZXgoKGN5KmhiLWJ5KmhjKS9kK2F4LCAoYngqaGMtY3gqaGIpL2QrYXkpO1xuXG4gICAgICAgIC8vIG9uZSB0cmFuc2l0aW9uIGRpc2FwcGVhclxuICAgICAgICB0aGlzLnNldEVkZ2VTdGFydHBvaW50KHJBcmMuZWRnZSwgbFNpdGUsIHJTaXRlLCB2ZXJ0ZXgpO1xuXG4gICAgICAgIC8vIHR3byBuZXcgdHJhbnNpdGlvbnMgYXBwZWFyIGF0IHRoZSBuZXcgdmVydGV4IGxvY2F0aW9uXG4gICAgICAgIG5ld0FyYy5lZGdlID0gdGhpcy5jcmVhdGVFZGdlKGxTaXRlLCBzaXRlLCB1bmRlZmluZWQsIHZlcnRleCk7XG4gICAgICAgIHJBcmMuZWRnZSA9IHRoaXMuY3JlYXRlRWRnZShzaXRlLCByU2l0ZSwgdW5kZWZpbmVkLCB2ZXJ0ZXgpO1xuXG4gICAgICAgIC8vIGNoZWNrIHdoZXRoZXIgdGhlIGxlZnQgYW5kIHJpZ2h0IGJlYWNoIHNlY3Rpb25zIGFyZSBjb2xsYXBzaW5nXG4gICAgICAgIC8vIGFuZCBpZiBzbyBjcmVhdGUgY2lyY2xlIGV2ZW50cywgdG8gaGFuZGxlIHRoZSBwb2ludCBvZiBjb2xsYXBzZS5cbiAgICAgICAgdGhpcy5hdHRhY2hDaXJjbGVFdmVudChsQXJjKTtcbiAgICAgICAgdGhpcy5hdHRhY2hDaXJjbGVFdmVudChyQXJjKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDaXJjbGUgZXZlbnQgbWV0aG9kc1xuXG4vLyByaGlsbCAyMDExLTA2LTA3OiBGb3Igc29tZSByZWFzb25zLCBwZXJmb3JtYW5jZSBzdWZmZXJzIHNpZ25pZmljYW50bHlcbi8vIHdoZW4gaW5zdGFuY2lhdGluZyBhIGxpdGVyYWwgb2JqZWN0IGluc3RlYWQgb2YgYW4gZW1wdHkgY3RvclxuVm9yb25vaS5wcm90b3R5cGUuQ2lyY2xlRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgICAvLyByaGlsbCAyMDEzLTEwLTEyOiBpdCBoZWxwcyB0byBzdGF0ZSBleGFjdGx5IHdoYXQgd2UgYXJlIGF0IGN0b3IgdGltZS5cbiAgICB0aGlzLmFyYyA9IG51bGw7XG4gICAgdGhpcy5yYkxlZnQgPSBudWxsO1xuICAgIHRoaXMucmJOZXh0ID0gbnVsbDtcbiAgICB0aGlzLnJiUGFyZW50ID0gbnVsbDtcbiAgICB0aGlzLnJiUHJldmlvdXMgPSBudWxsO1xuICAgIHRoaXMucmJSZWQgPSBmYWxzZTtcbiAgICB0aGlzLnJiUmlnaHQgPSBudWxsO1xuICAgIHRoaXMuc2l0ZSA9IG51bGw7XG4gICAgdGhpcy54ID0gdGhpcy55ID0gdGhpcy55Y2VudGVyID0gMDtcbiAgICB9O1xuXG5Wb3Jvbm9pLnByb3RvdHlwZS5hdHRhY2hDaXJjbGVFdmVudCA9IGZ1bmN0aW9uKGFyYykge1xuICAgIHZhciBsQXJjID0gYXJjLnJiUHJldmlvdXMsXG4gICAgICAgIHJBcmMgPSBhcmMucmJOZXh0O1xuICAgIGlmICghbEFyYyB8fCAhckFyYykge3JldHVybjt9IC8vIGRvZXMgdGhhdCBldmVyIGhhcHBlbj9cbiAgICB2YXIgbFNpdGUgPSBsQXJjLnNpdGUsXG4gICAgICAgIGNTaXRlID0gYXJjLnNpdGUsXG4gICAgICAgIHJTaXRlID0gckFyYy5zaXRlO1xuXG4gICAgLy8gSWYgc2l0ZSBvZiBsZWZ0IGJlYWNoc2VjdGlvbiBpcyBzYW1lIGFzIHNpdGUgb2ZcbiAgICAvLyByaWdodCBiZWFjaHNlY3Rpb24sIHRoZXJlIGNhbid0IGJlIGNvbnZlcmdlbmNlXG4gICAgaWYgKGxTaXRlPT09clNpdGUpIHtyZXR1cm47fVxuXG4gICAgLy8gRmluZCB0aGUgY2lyY3Vtc2NyaWJlZCBjaXJjbGUgZm9yIHRoZSB0aHJlZSBzaXRlcyBhc3NvY2lhdGVkXG4gICAgLy8gd2l0aCB0aGUgYmVhY2hzZWN0aW9uIHRyaXBsZXQuXG4gICAgLy8gcmhpbGwgMjAxMS0wNS0yNjogSXQgaXMgbW9yZSBlZmZpY2llbnQgdG8gY2FsY3VsYXRlIGluLXBsYWNlXG4gICAgLy8gcmF0aGVyIHRoYW4gZ2V0dGluZyB0aGUgcmVzdWx0aW5nIGNpcmN1bXNjcmliZWQgY2lyY2xlIGZyb20gYW5cbiAgICAvLyBvYmplY3QgcmV0dXJuZWQgYnkgY2FsbGluZyBWb3Jvbm9pLmNpcmN1bWNpcmNsZSgpXG4gICAgLy8gaHR0cDovL21hdGhmb3J1bS5vcmcvbGlicmFyeS9kcm1hdGgvdmlldy81NTAwMi5odG1sXG4gICAgLy8gRXhjZXB0IHRoYXQgSSBicmluZyB0aGUgb3JpZ2luIGF0IGNTaXRlIHRvIHNpbXBsaWZ5IGNhbGN1bGF0aW9ucy5cbiAgICAvLyBUaGUgYm90dG9tLW1vc3QgcGFydCBvZiB0aGUgY2lyY3VtY2lyY2xlIGlzIG91ciBGb3J0dW5lICdjaXJjbGVcbiAgICAvLyBldmVudCcsIGFuZCBpdHMgY2VudGVyIGlzIGEgdmVydGV4IHBvdGVudGlhbGx5IHBhcnQgb2YgdGhlIGZpbmFsXG4gICAgLy8gVm9yb25vaSBkaWFncmFtLlxuICAgIHZhciBieCA9IGNTaXRlLngsXG4gICAgICAgIGJ5ID0gY1NpdGUueSxcbiAgICAgICAgYXggPSBsU2l0ZS54LWJ4LFxuICAgICAgICBheSA9IGxTaXRlLnktYnksXG4gICAgICAgIGN4ID0gclNpdGUueC1ieCxcbiAgICAgICAgY3kgPSByU2l0ZS55LWJ5O1xuXG4gICAgLy8gSWYgcG9pbnRzIGwtPmMtPnIgYXJlIGNsb2Nrd2lzZSwgdGhlbiBjZW50ZXIgYmVhY2ggc2VjdGlvbiBkb2VzIG5vdFxuICAgIC8vIGNvbGxhcHNlLCBoZW5jZSBpdCBjYW4ndCBlbmQgdXAgYXMgYSB2ZXJ0ZXggKHdlIHJldXNlICdkJyBoZXJlLCB3aGljaFxuICAgIC8vIHNpZ24gaXMgcmV2ZXJzZSBvZiB0aGUgb3JpZW50YXRpb24sIGhlbmNlIHdlIHJldmVyc2UgdGhlIHRlc3QuXG4gICAgLy8gaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9DdXJ2ZV9vcmllbnRhdGlvbiNPcmllbnRhdGlvbl9vZl9hX3NpbXBsZV9wb2x5Z29uXG4gICAgLy8gcmhpbGwgMjAxMS0wNS0yMTogTmFzdHkgZmluaXRlIHByZWNpc2lvbiBlcnJvciB3aGljaCBjYXVzZWQgY2lyY3VtY2lyY2xlKCkgdG9cbiAgICAvLyByZXR1cm4gaW5maW5pdGVzOiAxZS0xMiBzZWVtcyB0byBmaXggdGhlIHByb2JsZW0uXG4gICAgdmFyIGQgPSAyKihheCpjeS1heSpjeCk7XG4gICAgaWYgKGQgPj0gLTJlLTEyKXtyZXR1cm47fVxuXG4gICAgdmFyIGhhID0gYXgqYXgrYXkqYXksXG4gICAgICAgIGhjID0gY3gqY3grY3kqY3ksXG4gICAgICAgIHggPSAoY3kqaGEtYXkqaGMpL2QsXG4gICAgICAgIHkgPSAoYXgqaGMtY3gqaGEpL2QsXG4gICAgICAgIHljZW50ZXIgPSB5K2J5O1xuXG4gICAgLy8gSW1wb3J0YW50OiB5Ym90dG9tIHNob3VsZCBhbHdheXMgYmUgdW5kZXIgb3IgYXQgc3dlZXAsIHNvIG5vIG5lZWRcbiAgICAvLyB0byB3YXN0ZSBDUFUgY3ljbGVzIGJ5IGNoZWNraW5nXG5cbiAgICAvLyByZWN5Y2xlIGNpcmNsZSBldmVudCBvYmplY3QgaWYgcG9zc2libGVcbiAgICB2YXIgY2lyY2xlRXZlbnQgPSB0aGlzLmNpcmNsZUV2ZW50SnVua3lhcmQucG9wKCk7XG4gICAgaWYgKCFjaXJjbGVFdmVudCkge1xuICAgICAgICBjaXJjbGVFdmVudCA9IG5ldyB0aGlzLkNpcmNsZUV2ZW50KCk7XG4gICAgICAgIH1cbiAgICBjaXJjbGVFdmVudC5hcmMgPSBhcmM7XG4gICAgY2lyY2xlRXZlbnQuc2l0ZSA9IGNTaXRlO1xuICAgIGNpcmNsZUV2ZW50LnggPSB4K2J4O1xuICAgIGNpcmNsZUV2ZW50LnkgPSB5Y2VudGVyK3RoaXMuc3FydCh4KngreSp5KTsgLy8geSBib3R0b21cbiAgICBjaXJjbGVFdmVudC55Y2VudGVyID0geWNlbnRlcjtcbiAgICBhcmMuY2lyY2xlRXZlbnQgPSBjaXJjbGVFdmVudDtcblxuICAgIC8vIGZpbmQgaW5zZXJ0aW9uIHBvaW50IGluIFJCLXRyZWU6IGNpcmNsZSBldmVudHMgYXJlIG9yZGVyZWQgZnJvbVxuICAgIC8vIHNtYWxsZXN0IHRvIGxhcmdlc3RcbiAgICB2YXIgcHJlZGVjZXNzb3IgPSBudWxsLFxuICAgICAgICBub2RlID0gdGhpcy5jaXJjbGVFdmVudHMucm9vdDtcbiAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICBpZiAoY2lyY2xlRXZlbnQueSA8IG5vZGUueSB8fCAoY2lyY2xlRXZlbnQueSA9PT0gbm9kZS55ICYmIGNpcmNsZUV2ZW50LnggPD0gbm9kZS54KSkge1xuICAgICAgICAgICAgaWYgKG5vZGUucmJMZWZ0KSB7XG4gICAgICAgICAgICAgICAgbm9kZSA9IG5vZGUucmJMZWZ0O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHByZWRlY2Vzc29yID0gbm9kZS5yYlByZXZpb3VzO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBpZiAobm9kZS5yYlJpZ2h0KSB7XG4gICAgICAgICAgICAgICAgbm9kZSA9IG5vZGUucmJSaWdodDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBwcmVkZWNlc3NvciA9IG5vZGU7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgdGhpcy5jaXJjbGVFdmVudHMucmJJbnNlcnRTdWNjZXNzb3IocHJlZGVjZXNzb3IsIGNpcmNsZUV2ZW50KTtcbiAgICBpZiAoIXByZWRlY2Vzc29yKSB7XG4gICAgICAgIHRoaXMuZmlyc3RDaXJjbGVFdmVudCA9IGNpcmNsZUV2ZW50O1xuICAgICAgICB9XG4gICAgfTtcblxuVm9yb25vaS5wcm90b3R5cGUuZGV0YWNoQ2lyY2xlRXZlbnQgPSBmdW5jdGlvbihhcmMpIHtcbiAgICB2YXIgY2lyY2xlRXZlbnQgPSBhcmMuY2lyY2xlRXZlbnQ7XG4gICAgaWYgKGNpcmNsZUV2ZW50KSB7XG4gICAgICAgIGlmICghY2lyY2xlRXZlbnQucmJQcmV2aW91cykge1xuICAgICAgICAgICAgdGhpcy5maXJzdENpcmNsZUV2ZW50ID0gY2lyY2xlRXZlbnQucmJOZXh0O1xuICAgICAgICAgICAgfVxuICAgICAgICB0aGlzLmNpcmNsZUV2ZW50cy5yYlJlbW92ZU5vZGUoY2lyY2xlRXZlbnQpOyAvLyByZW1vdmUgZnJvbSBSQi10cmVlXG4gICAgICAgIHRoaXMuY2lyY2xlRXZlbnRKdW5reWFyZC5wdXNoKGNpcmNsZUV2ZW50KTtcbiAgICAgICAgYXJjLmNpcmNsZUV2ZW50ID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGlhZ3JhbSBjb21wbGV0aW9uIG1ldGhvZHNcblxuLy8gY29ubmVjdCBkYW5nbGluZyBlZGdlcyAobm90IGlmIGEgY3Vyc29yeSB0ZXN0IHRlbGxzIHVzXG4vLyBpdCBpcyBub3QgZ29pbmcgdG8gYmUgdmlzaWJsZS5cbi8vIHJldHVybiB2YWx1ZTpcbi8vICAgZmFsc2U6IHRoZSBkYW5nbGluZyBlbmRwb2ludCBjb3VsZG4ndCBiZSBjb25uZWN0ZWRcbi8vICAgdHJ1ZTogdGhlIGRhbmdsaW5nIGVuZHBvaW50IGNvdWxkIGJlIGNvbm5lY3RlZFxuVm9yb25vaS5wcm90b3R5cGUuY29ubmVjdEVkZ2UgPSBmdW5jdGlvbihlZGdlLCBiYm94KSB7XG4gICAgLy8gc2tpcCBpZiBlbmQgcG9pbnQgYWxyZWFkeSBjb25uZWN0ZWRcbiAgICB2YXIgdmIgPSBlZGdlLnZiO1xuICAgIGlmICghIXZiKSB7cmV0dXJuIHRydWU7fVxuXG4gICAgLy8gbWFrZSBsb2NhbCBjb3B5IGZvciBwZXJmb3JtYW5jZSBwdXJwb3NlXG4gICAgdmFyIHZhID0gZWRnZS52YSxcbiAgICAgICAgeGwgPSBiYm94LnhsLFxuICAgICAgICB4ciA9IGJib3gueHIsXG4gICAgICAgIHl0ID0gYmJveC55dCxcbiAgICAgICAgeWIgPSBiYm94LnliLFxuICAgICAgICBsU2l0ZSA9IGVkZ2UubFNpdGUsXG4gICAgICAgIHJTaXRlID0gZWRnZS5yU2l0ZSxcbiAgICAgICAgbHggPSBsU2l0ZS54LFxuICAgICAgICBseSA9IGxTaXRlLnksXG4gICAgICAgIHJ4ID0gclNpdGUueCxcbiAgICAgICAgcnkgPSByU2l0ZS55LFxuICAgICAgICBmeCA9IChseCtyeCkvMixcbiAgICAgICAgZnkgPSAobHkrcnkpLzIsXG4gICAgICAgIGZtLCBmYjtcblxuICAgIC8vIGlmIHdlIHJlYWNoIGhlcmUsIHRoaXMgbWVhbnMgY2VsbHMgd2hpY2ggdXNlIHRoaXMgZWRnZSB3aWxsIG5lZWRcbiAgICAvLyB0byBiZSBjbG9zZWQsIHdoZXRoZXIgYmVjYXVzZSB0aGUgZWRnZSB3YXMgcmVtb3ZlZCwgb3IgYmVjYXVzZSBpdFxuICAgIC8vIHdhcyBjb25uZWN0ZWQgdG8gdGhlIGJvdW5kaW5nIGJveC5cbiAgICB0aGlzLmNlbGxzW2xTaXRlLnZvcm9ub2lJZF0uY2xvc2VNZSA9IHRydWU7XG4gICAgdGhpcy5jZWxsc1tyU2l0ZS52b3Jvbm9pSWRdLmNsb3NlTWUgPSB0cnVlO1xuXG4gICAgLy8gZ2V0IHRoZSBsaW5lIGVxdWF0aW9uIG9mIHRoZSBiaXNlY3RvciBpZiBsaW5lIGlzIG5vdCB2ZXJ0aWNhbFxuICAgIGlmIChyeSAhPT0gbHkpIHtcbiAgICAgICAgZm0gPSAobHgtcngpLyhyeS1seSk7XG4gICAgICAgIGZiID0gZnktZm0qZng7XG4gICAgICAgIH1cblxuICAgIC8vIHJlbWVtYmVyLCBkaXJlY3Rpb24gb2YgbGluZSAocmVsYXRpdmUgdG8gbGVmdCBzaXRlKTpcbiAgICAvLyB1cHdhcmQ6IGxlZnQueCA8IHJpZ2h0LnhcbiAgICAvLyBkb3dud2FyZDogbGVmdC54ID4gcmlnaHQueFxuICAgIC8vIGhvcml6b250YWw6IGxlZnQueCA9PSByaWdodC54XG4gICAgLy8gdXB3YXJkOiBsZWZ0LnggPCByaWdodC54XG4gICAgLy8gcmlnaHR3YXJkOiBsZWZ0LnkgPCByaWdodC55XG4gICAgLy8gbGVmdHdhcmQ6IGxlZnQueSA+IHJpZ2h0LnlcbiAgICAvLyB2ZXJ0aWNhbDogbGVmdC55ID09IHJpZ2h0LnlcblxuICAgIC8vIGRlcGVuZGluZyBvbiB0aGUgZGlyZWN0aW9uLCBmaW5kIHRoZSBiZXN0IHNpZGUgb2YgdGhlXG4gICAgLy8gYm91bmRpbmcgYm94IHRvIHVzZSB0byBkZXRlcm1pbmUgYSByZWFzb25hYmxlIHN0YXJ0IHBvaW50XG5cbiAgICAvLyByaGlsbCAyMDEzLTEyLTAyOlxuICAgIC8vIFdoaWxlIGF0IGl0LCBzaW5jZSB3ZSBoYXZlIHRoZSB2YWx1ZXMgd2hpY2ggZGVmaW5lIHRoZSBsaW5lLFxuICAgIC8vIGNsaXAgdGhlIGVuZCBvZiB2YSBpZiBpdCBpcyBvdXRzaWRlIHRoZSBiYm94LlxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9nb3JoaWxsL0phdmFzY3JpcHQtVm9yb25vaS9pc3N1ZXMvMTVcbiAgICAvLyBUT0RPOiBEbyBhbGwgdGhlIGNsaXBwaW5nIGhlcmUgcmF0aGVyIHRoYW4gcmVseSBvbiBMaWFuZy1CYXJza3lcbiAgICAvLyB3aGljaCBkb2VzIG5vdCBkbyB3ZWxsIHNvbWV0aW1lcyBkdWUgdG8gbG9zcyBvZiBhcml0aG1ldGljXG4gICAgLy8gcHJlY2lzaW9uLiBUaGUgY29kZSBoZXJlIGRvZXNuJ3QgZGVncmFkZSBpZiBvbmUgb2YgdGhlIHZlcnRleCBpc1xuICAgIC8vIGF0IGEgaHVnZSBkaXN0YW5jZS5cblxuICAgIC8vIHNwZWNpYWwgY2FzZTogdmVydGljYWwgbGluZVxuICAgIGlmIChmbSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIC8vIGRvZXNuJ3QgaW50ZXJzZWN0IHdpdGggdmlld3BvcnRcbiAgICAgICAgaWYgKGZ4IDwgeGwgfHwgZnggPj0geHIpIHtyZXR1cm4gZmFsc2U7fVxuICAgICAgICAvLyBkb3dud2FyZFxuICAgICAgICBpZiAobHggPiByeCkge1xuICAgICAgICAgICAgaWYgKCF2YSB8fCB2YS55IDwgeXQpIHtcbiAgICAgICAgICAgICAgICB2YSA9IHRoaXMuY3JlYXRlVmVydGV4KGZ4LCB5dCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAodmEueSA+PSB5Yikge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KGZ4LCB5Yik7XG4gICAgICAgICAgICB9XG4gICAgICAgIC8vIHVwd2FyZFxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGlmICghdmEgfHwgdmEueSA+IHliKSB7XG4gICAgICAgICAgICAgICAgdmEgPSB0aGlzLmNyZWF0ZVZlcnRleChmeCwgeWIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHZhLnkgPCB5dCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KGZ4LCB5dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAvLyBjbG9zZXIgdG8gdmVydGljYWwgdGhhbiBob3Jpem9udGFsLCBjb25uZWN0IHN0YXJ0IHBvaW50IHRvIHRoZVxuICAgIC8vIHRvcCBvciBib3R0b20gc2lkZSBvZiB0aGUgYm91bmRpbmcgYm94XG4gICAgZWxzZSBpZiAoZm0gPCAtMSB8fCBmbSA+IDEpIHtcbiAgICAgICAgLy8gZG93bndhcmRcbiAgICAgICAgaWYgKGx4ID4gcngpIHtcbiAgICAgICAgICAgIGlmICghdmEgfHwgdmEueSA8IHl0KSB7XG4gICAgICAgICAgICAgICAgdmEgPSB0aGlzLmNyZWF0ZVZlcnRleCgoeXQtZmIpL2ZtLCB5dCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAodmEueSA+PSB5Yikge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KCh5Yi1mYikvZm0sIHliKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgLy8gdXB3YXJkXG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgaWYgKCF2YSB8fCB2YS55ID4geWIpIHtcbiAgICAgICAgICAgICAgICB2YSA9IHRoaXMuY3JlYXRlVmVydGV4KCh5Yi1mYikvZm0sIHliKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICh2YS55IDwgeXQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCgoeXQtZmIpL2ZtLCB5dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAvLyBjbG9zZXIgdG8gaG9yaXpvbnRhbCB0aGFuIHZlcnRpY2FsLCBjb25uZWN0IHN0YXJ0IHBvaW50IHRvIHRoZVxuICAgIC8vIGxlZnQgb3IgcmlnaHQgc2lkZSBvZiB0aGUgYm91bmRpbmcgYm94XG4gICAgZWxzZSB7XG4gICAgICAgIC8vIHJpZ2h0d2FyZFxuICAgICAgICBpZiAobHkgPCByeSkge1xuICAgICAgICAgICAgaWYgKCF2YSB8fCB2YS54IDwgeGwpIHtcbiAgICAgICAgICAgICAgICB2YSA9IHRoaXMuY3JlYXRlVmVydGV4KHhsLCBmbSp4bCtmYik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAodmEueCA+PSB4cikge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KHhyLCBmbSp4citmYik7XG4gICAgICAgICAgICB9XG4gICAgICAgIC8vIGxlZnR3YXJkXG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgaWYgKCF2YSB8fCB2YS54ID4geHIpIHtcbiAgICAgICAgICAgICAgICB2YSA9IHRoaXMuY3JlYXRlVmVydGV4KHhyLCBmbSp4citmYik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAodmEueCA8IHhsKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoeGwsIGZtKnhsK2ZiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIGVkZ2UudmEgPSB2YTtcbiAgICBlZGdlLnZiID0gdmI7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbiAgICB9O1xuXG4vLyBsaW5lLWNsaXBwaW5nIGNvZGUgdGFrZW4gZnJvbTpcbi8vICAgTGlhbmctQmFyc2t5IGZ1bmN0aW9uIGJ5IERhbmllbCBXaGl0ZVxuLy8gICBodHRwOi8vd3d3LnNreXRvcGlhLmNvbS9wcm9qZWN0L2FydGljbGVzL2NvbXBzY2kvY2xpcHBpbmcuaHRtbFxuLy8gVGhhbmtzIVxuLy8gQSBiaXQgbW9kaWZpZWQgdG8gbWluaW1pemUgY29kZSBwYXRoc1xuVm9yb25vaS5wcm90b3R5cGUuY2xpcEVkZ2UgPSBmdW5jdGlvbihlZGdlLCBiYm94KSB7XG4gICAgdmFyIGF4ID0gZWRnZS52YS54LFxuICAgICAgICBheSA9IGVkZ2UudmEueSxcbiAgICAgICAgYnggPSBlZGdlLnZiLngsXG4gICAgICAgIGJ5ID0gZWRnZS52Yi55LFxuICAgICAgICB0MCA9IDAsXG4gICAgICAgIHQxID0gMSxcbiAgICAgICAgZHggPSBieC1heCxcbiAgICAgICAgZHkgPSBieS1heTtcbiAgICAvLyBsZWZ0XG4gICAgdmFyIHEgPSBheC1iYm94LnhsO1xuICAgIGlmIChkeD09PTAgJiYgcTwwKSB7cmV0dXJuIGZhbHNlO31cbiAgICB2YXIgciA9IC1xL2R4O1xuICAgIGlmIChkeDwwKSB7XG4gICAgICAgIGlmIChyPHQwKSB7cmV0dXJuIGZhbHNlO31cbiAgICAgICAgaWYgKHI8dDEpIHt0MT1yO31cbiAgICAgICAgfVxuICAgIGVsc2UgaWYgKGR4PjApIHtcbiAgICAgICAgaWYgKHI+dDEpIHtyZXR1cm4gZmFsc2U7fVxuICAgICAgICBpZiAocj50MCkge3QwPXI7fVxuICAgICAgICB9XG4gICAgLy8gcmlnaHRcbiAgICBxID0gYmJveC54ci1heDtcbiAgICBpZiAoZHg9PT0wICYmIHE8MCkge3JldHVybiBmYWxzZTt9XG4gICAgciA9IHEvZHg7XG4gICAgaWYgKGR4PDApIHtcbiAgICAgICAgaWYgKHI+dDEpIHtyZXR1cm4gZmFsc2U7fVxuICAgICAgICBpZiAocj50MCkge3QwPXI7fVxuICAgICAgICB9XG4gICAgZWxzZSBpZiAoZHg+MCkge1xuICAgICAgICBpZiAocjx0MCkge3JldHVybiBmYWxzZTt9XG4gICAgICAgIGlmIChyPHQxKSB7dDE9cjt9XG4gICAgICAgIH1cbiAgICAvLyB0b3BcbiAgICBxID0gYXktYmJveC55dDtcbiAgICBpZiAoZHk9PT0wICYmIHE8MCkge3JldHVybiBmYWxzZTt9XG4gICAgciA9IC1xL2R5O1xuICAgIGlmIChkeTwwKSB7XG4gICAgICAgIGlmIChyPHQwKSB7cmV0dXJuIGZhbHNlO31cbiAgICAgICAgaWYgKHI8dDEpIHt0MT1yO31cbiAgICAgICAgfVxuICAgIGVsc2UgaWYgKGR5PjApIHtcbiAgICAgICAgaWYgKHI+dDEpIHtyZXR1cm4gZmFsc2U7fVxuICAgICAgICBpZiAocj50MCkge3QwPXI7fVxuICAgICAgICB9XG4gICAgLy8gYm90dG9tICAgICAgICBcbiAgICBxID0gYmJveC55Yi1heTtcbiAgICBpZiAoZHk9PT0wICYmIHE8MCkge3JldHVybiBmYWxzZTt9XG4gICAgciA9IHEvZHk7XG4gICAgaWYgKGR5PDApIHtcbiAgICAgICAgaWYgKHI+dDEpIHtyZXR1cm4gZmFsc2U7fVxuICAgICAgICBpZiAocj50MCkge3QwPXI7fVxuICAgICAgICB9XG4gICAgZWxzZSBpZiAoZHk+MCkge1xuICAgICAgICBpZiAocjx0MCkge3JldHVybiBmYWxzZTt9XG4gICAgICAgIGlmIChyPHQxKSB7dDE9cjt9XG4gICAgICAgIH1cblxuICAgIC8vIGlmIHdlIHJlYWNoIHRoaXMgcG9pbnQsIFZvcm9ub2kgZWRnZSBpcyB3aXRoaW4gYmJveFxuXG4gICAgLy8gaWYgdDAgPiAwLCB2YSBuZWVkcyB0byBjaGFuZ2VcbiAgICAvLyByaGlsbCAyMDExLTA2LTAzOiB3ZSBuZWVkIHRvIGNyZWF0ZSBhIG5ldyB2ZXJ0ZXggcmF0aGVyXG4gICAgLy8gdGhhbiBtb2RpZnlpbmcgdGhlIGV4aXN0aW5nIG9uZSwgc2luY2UgdGhlIGV4aXN0aW5nXG4gICAgLy8gb25lIGlzIGxpa2VseSBzaGFyZWQgd2l0aCBhdCBsZWFzdCBhbm90aGVyIGVkZ2VcbiAgICBpZiAodDAgPiAwKSB7XG4gICAgICAgIGVkZ2UudmEgPSB0aGlzLmNyZWF0ZVZlcnRleChheCt0MCpkeCwgYXkrdDAqZHkpO1xuICAgICAgICB9XG5cbiAgICAvLyBpZiB0MSA8IDEsIHZiIG5lZWRzIHRvIGNoYW5nZVxuICAgIC8vIHJoaWxsIDIwMTEtMDYtMDM6IHdlIG5lZWQgdG8gY3JlYXRlIGEgbmV3IHZlcnRleCByYXRoZXJcbiAgICAvLyB0aGFuIG1vZGlmeWluZyB0aGUgZXhpc3Rpbmcgb25lLCBzaW5jZSB0aGUgZXhpc3RpbmdcbiAgICAvLyBvbmUgaXMgbGlrZWx5IHNoYXJlZCB3aXRoIGF0IGxlYXN0IGFub3RoZXIgZWRnZVxuICAgIGlmICh0MSA8IDEpIHtcbiAgICAgICAgZWRnZS52YiA9IHRoaXMuY3JlYXRlVmVydGV4KGF4K3QxKmR4LCBheSt0MSpkeSk7XG4gICAgICAgIH1cblxuICAgIC8vIHZhIGFuZC9vciB2YiB3ZXJlIGNsaXBwZWQsIHRodXMgd2Ugd2lsbCBuZWVkIHRvIGNsb3NlXG4gICAgLy8gY2VsbHMgd2hpY2ggdXNlIHRoaXMgZWRnZS5cbiAgICBpZiAoIHQwID4gMCB8fCB0MSA8IDEgKSB7XG4gICAgICAgIHRoaXMuY2VsbHNbZWRnZS5sU2l0ZS52b3Jvbm9pSWRdLmNsb3NlTWUgPSB0cnVlO1xuICAgICAgICB0aGlzLmNlbGxzW2VkZ2UuclNpdGUudm9yb25vaUlkXS5jbG9zZU1lID0gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZTtcbiAgICB9O1xuXG4vLyBDb25uZWN0L2N1dCBlZGdlcyBhdCBib3VuZGluZyBib3hcblZvcm9ub2kucHJvdG90eXBlLmNsaXBFZGdlcyA9IGZ1bmN0aW9uKGJib3gpIHtcbiAgICAvLyBjb25uZWN0IGFsbCBkYW5nbGluZyBlZGdlcyB0byBib3VuZGluZyBib3hcbiAgICAvLyBvciBnZXQgcmlkIG9mIHRoZW0gaWYgaXQgY2FuJ3QgYmUgZG9uZVxuICAgIHZhciBlZGdlcyA9IHRoaXMuZWRnZXMsXG4gICAgICAgIGlFZGdlID0gZWRnZXMubGVuZ3RoLFxuICAgICAgICBlZGdlLFxuICAgICAgICBhYnNfZm4gPSBNYXRoLmFicztcblxuICAgIC8vIGl0ZXJhdGUgYmFja3dhcmQgc28gd2UgY2FuIHNwbGljZSBzYWZlbHlcbiAgICB3aGlsZSAoaUVkZ2UtLSkge1xuICAgICAgICBlZGdlID0gZWRnZXNbaUVkZ2VdO1xuICAgICAgICAvLyBlZGdlIGlzIHJlbW92ZWQgaWY6XG4gICAgICAgIC8vICAgaXQgaXMgd2hvbGx5IG91dHNpZGUgdGhlIGJvdW5kaW5nIGJveFxuICAgICAgICAvLyAgIGl0IGlzIGxvb2tpbmcgbW9yZSBsaWtlIGEgcG9pbnQgdGhhbiBhIGxpbmVcbiAgICAgICAgaWYgKCF0aGlzLmNvbm5lY3RFZGdlKGVkZ2UsIGJib3gpIHx8XG4gICAgICAgICAgICAhdGhpcy5jbGlwRWRnZShlZGdlLCBiYm94KSB8fFxuICAgICAgICAgICAgKGFic19mbihlZGdlLnZhLngtZWRnZS52Yi54KTwxZS05ICYmIGFic19mbihlZGdlLnZhLnktZWRnZS52Yi55KTwxZS05KSkge1xuICAgICAgICAgICAgZWRnZS52YSA9IGVkZ2UudmIgPSBudWxsO1xuICAgICAgICAgICAgZWRnZXMuc3BsaWNlKGlFZGdlLDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfTtcblxuLy8gQ2xvc2UgdGhlIGNlbGxzLlxuLy8gVGhlIGNlbGxzIGFyZSBib3VuZCBieSB0aGUgc3VwcGxpZWQgYm91bmRpbmcgYm94LlxuLy8gRWFjaCBjZWxsIHJlZmVycyB0byBpdHMgYXNzb2NpYXRlZCBzaXRlLCBhbmQgYSBsaXN0XG4vLyBvZiBoYWxmZWRnZXMgb3JkZXJlZCBjb3VudGVyY2xvY2t3aXNlLlxuVm9yb25vaS5wcm90b3R5cGUuY2xvc2VDZWxscyA9IGZ1bmN0aW9uKGJib3gpIHtcbiAgICB2YXIgeGwgPSBiYm94LnhsLFxuICAgICAgICB4ciA9IGJib3gueHIsXG4gICAgICAgIHl0ID0gYmJveC55dCxcbiAgICAgICAgeWIgPSBiYm94LnliLFxuICAgICAgICBjZWxscyA9IHRoaXMuY2VsbHMsXG4gICAgICAgIGlDZWxsID0gY2VsbHMubGVuZ3RoLFxuICAgICAgICBjZWxsLFxuICAgICAgICBpTGVmdCxcbiAgICAgICAgaGFsZmVkZ2VzLCBuSGFsZmVkZ2VzLFxuICAgICAgICBlZGdlLFxuICAgICAgICB2YSwgdmIsIHZ6LFxuICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCxcbiAgICAgICAgYWJzX2ZuID0gTWF0aC5hYnM7XG5cbiAgICB3aGlsZSAoaUNlbGwtLSkge1xuICAgICAgICBjZWxsID0gY2VsbHNbaUNlbGxdO1xuICAgICAgICAvLyBwcnVuZSwgb3JkZXIgaGFsZmVkZ2VzIGNvdW50ZXJjbG9ja3dpc2UsIHRoZW4gYWRkIG1pc3Npbmcgb25lc1xuICAgICAgICAvLyByZXF1aXJlZCB0byBjbG9zZSBjZWxsc1xuICAgICAgICBpZiAoIWNlbGwucHJlcGFyZUhhbGZlZGdlcygpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgaWYgKCFjZWxsLmNsb3NlTWUpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAvLyBmaW5kIGZpcnN0ICd1bmNsb3NlZCcgcG9pbnQuXG4gICAgICAgIC8vIGFuICd1bmNsb3NlZCcgcG9pbnQgd2lsbCBiZSB0aGUgZW5kIHBvaW50IG9mIGEgaGFsZmVkZ2Ugd2hpY2hcbiAgICAgICAgLy8gZG9lcyBub3QgbWF0Y2ggdGhlIHN0YXJ0IHBvaW50IG9mIHRoZSBmb2xsb3dpbmcgaGFsZmVkZ2VcbiAgICAgICAgaGFsZmVkZ2VzID0gY2VsbC5oYWxmZWRnZXM7XG4gICAgICAgIG5IYWxmZWRnZXMgPSBoYWxmZWRnZXMubGVuZ3RoO1xuICAgICAgICAvLyBzcGVjaWFsIGNhc2U6IG9ubHkgb25lIHNpdGUsIGluIHdoaWNoIGNhc2UsIHRoZSB2aWV3cG9ydCBpcyB0aGUgY2VsbFxuICAgICAgICAvLyAuLi5cblxuICAgICAgICAvLyBhbGwgb3RoZXIgY2FzZXNcbiAgICAgICAgaUxlZnQgPSAwO1xuICAgICAgICB3aGlsZSAoaUxlZnQgPCBuSGFsZmVkZ2VzKSB7XG4gICAgICAgICAgICB2YSA9IGhhbGZlZGdlc1tpTGVmdF0uZ2V0RW5kcG9pbnQoKTtcbiAgICAgICAgICAgIHZ6ID0gaGFsZmVkZ2VzWyhpTGVmdCsxKSAlIG5IYWxmZWRnZXNdLmdldFN0YXJ0cG9pbnQoKTtcbiAgICAgICAgICAgIC8vIGlmIGVuZCBwb2ludCBpcyBub3QgZXF1YWwgdG8gc3RhcnQgcG9pbnQsIHdlIG5lZWQgdG8gYWRkIHRoZSBtaXNzaW5nXG4gICAgICAgICAgICAvLyBoYWxmZWRnZShzKSB1cCB0byB2elxuICAgICAgICAgICAgaWYgKGFic19mbih2YS54LXZ6LngpPj0xZS05IHx8IGFic19mbih2YS55LXZ6LnkpPj0xZS05KSB7XG5cbiAgICAgICAgICAgICAgICAvLyByaGlsbCAyMDEzLTEyLTAyOlxuICAgICAgICAgICAgICAgIC8vIFwiSG9sZXNcIiBpbiB0aGUgaGFsZmVkZ2VzIGFyZSBub3QgbmVjZXNzYXJpbHkgYWx3YXlzIGFkamFjZW50LlxuICAgICAgICAgICAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9nb3JoaWxsL0phdmFzY3JpcHQtVm9yb25vaS9pc3N1ZXMvMTZcblxuICAgICAgICAgICAgICAgIC8vIGZpbmQgZW50cnkgcG9pbnQ6XG4gICAgICAgICAgICAgICAgc3dpdGNoICh0cnVlKSB7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gd2FsayBkb3dud2FyZCBhbG9uZyBsZWZ0IHNpZGVcbiAgICAgICAgICAgICAgICAgICAgY2FzZSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odmEueCx4bCkgJiYgdGhpcy5sZXNzVGhhbldpdGhFcHNpbG9uKHZhLnkseWIpOlxuICAgICAgICAgICAgICAgICAgICAgICAgbGFzdEJvcmRlclNlZ21lbnQgPSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odnoueCx4bCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KHhsLCBsYXN0Qm9yZGVyU2VnbWVudCA/IHZ6LnkgOiB5Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlMZWZ0Kys7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlMZWZ0LCAwLCB0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIGNlbGwuc2l0ZSwgbnVsbCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBsYXN0Qm9yZGVyU2VnbWVudCApIHsgYnJlYWs7IH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZhID0gdmI7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcblxuICAgICAgICAgICAgICAgICAgICAvLyB3YWxrIHJpZ2h0d2FyZCBhbG9uZyBib3R0b20gc2lkZVxuICAgICAgICAgICAgICAgICAgICBjYXNlIHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2YS55LHliKSAmJiB0aGlzLmxlc3NUaGFuV2l0aEVwc2lsb24odmEueCx4cik6XG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei55LHliKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgobGFzdEJvcmRlclNlZ21lbnQgPyB2ei54IDogeHIsIHliKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkZ2UgPSB0aGlzLmNyZWF0ZUJvcmRlckVkZ2UoY2VsbC5zaXRlLCB2YSwgdmIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGZlZGdlcy5zcGxpY2UoaUxlZnQsIDAsIHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgY2VsbC5zaXRlLCBudWxsKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBuSGFsZmVkZ2VzKys7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmEgPSB2YjtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZhbGwgdGhyb3VnaFxuXG4gICAgICAgICAgICAgICAgICAgIC8vIHdhbGsgdXB3YXJkIGFsb25nIHJpZ2h0IHNpZGVcbiAgICAgICAgICAgICAgICAgICAgY2FzZSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odmEueCx4cikgJiYgdGhpcy5ncmVhdGVyVGhhbldpdGhFcHNpbG9uKHZhLnkseXQpOlxuICAgICAgICAgICAgICAgICAgICAgICAgbGFzdEJvcmRlclNlZ21lbnQgPSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odnoueCx4cik7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KHhyLCBsYXN0Qm9yZGVyU2VnbWVudCA/IHZ6LnkgOiB5dCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlMZWZ0Kys7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlMZWZ0LCAwLCB0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIGNlbGwuc2l0ZSwgbnVsbCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBsYXN0Qm9yZGVyU2VnbWVudCApIHsgYnJlYWs7IH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZhID0gdmI7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcblxuICAgICAgICAgICAgICAgICAgICAvLyB3YWxrIGxlZnR3YXJkIGFsb25nIHRvcCBzaWRlXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZhLnkseXQpICYmIHRoaXMuZ3JlYXRlclRoYW5XaXRoRXBzaWxvbih2YS54LHhsKTpcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RCb3JkZXJTZWdtZW50ID0gdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZ6LnkseXQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleChsYXN0Qm9yZGVyU2VnbWVudCA/IHZ6LnggOiB4bCwgeXQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZWRnZSA9IHRoaXMuY3JlYXRlQm9yZGVyRWRnZShjZWxsLnNpdGUsIHZhLCB2Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpTGVmdCsrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5IYWxmZWRnZXMrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggbGFzdEJvcmRlclNlZ21lbnQgKSB7IGJyZWFrOyB9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YSA9IHZiO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZmFsbCB0aHJvdWdoXG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdhbGsgZG93bndhcmQgYWxvbmcgbGVmdCBzaWRlXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei54LHhsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoeGwsIGxhc3RCb3JkZXJTZWdtZW50ID8gdnoueSA6IHliKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkZ2UgPSB0aGlzLmNyZWF0ZUJvcmRlckVkZ2UoY2VsbC5zaXRlLCB2YSwgdmIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGZlZGdlcy5zcGxpY2UoaUxlZnQsIDAsIHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgY2VsbC5zaXRlLCBudWxsKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBuSGFsZmVkZ2VzKys7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmEgPSB2YjtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZhbGwgdGhyb3VnaFxuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB3YWxrIHJpZ2h0d2FyZCBhbG9uZyBib3R0b20gc2lkZVxuICAgICAgICAgICAgICAgICAgICAgICAgbGFzdEJvcmRlclNlZ21lbnQgPSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odnoueSx5Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KGxhc3RCb3JkZXJTZWdtZW50ID8gdnoueCA6IHhyLCB5Yik7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlMZWZ0Kys7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlMZWZ0LCAwLCB0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIGNlbGwuc2l0ZSwgbnVsbCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBsYXN0Qm9yZGVyU2VnbWVudCApIHsgYnJlYWs7IH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZhID0gdmI7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcblxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2FsayB1cHdhcmQgYWxvbmcgcmlnaHQgc2lkZVxuICAgICAgICAgICAgICAgICAgICAgICAgbGFzdEJvcmRlclNlZ21lbnQgPSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odnoueCx4cik7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KHhyLCBsYXN0Qm9yZGVyU2VnbWVudCA/IHZ6LnkgOiB5dCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlMZWZ0Kys7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlMZWZ0LCAwLCB0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIGNlbGwuc2l0ZSwgbnVsbCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBsYXN0Qm9yZGVyU2VnbWVudCApIHsgYnJlYWs7IH1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZhbGwgdGhyb3VnaFxuXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBcIlZvcm9ub2kuY2xvc2VDZWxscygpID4gdGhpcyBtYWtlcyBubyBzZW5zZSFcIjtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlMZWZ0Kys7XG4gICAgICAgICAgICB9XG4gICAgICAgIGNlbGwuY2xvc2VNZSA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWJ1Z2dpbmcgaGVscGVyXG4vKlxuVm9yb25vaS5wcm90b3R5cGUuZHVtcEJlYWNobGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgICBjb25zb2xlLmxvZygnVm9yb25vaS5kdW1wQmVhY2hsaW5lKCVmKSA+IEJlYWNoc2VjdGlvbnMsIGZyb20gbGVmdCB0byByaWdodDonLCB5KTtcbiAgICBpZiAoICF0aGlzLmJlYWNobGluZSApIHtcbiAgICAgICAgY29uc29sZS5sb2coJyAgTm9uZScpO1xuICAgICAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHZhciBicyA9IHRoaXMuYmVhY2hsaW5lLmdldEZpcnN0KHRoaXMuYmVhY2hsaW5lLnJvb3QpO1xuICAgICAgICB3aGlsZSAoIGJzICkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJyAgc2l0ZSAlZDogeGw6ICVmLCB4cjogJWYnLCBicy5zaXRlLnZvcm9ub2lJZCwgdGhpcy5sZWZ0QnJlYWtQb2ludChicywgeSksIHRoaXMucmlnaHRCcmVha1BvaW50KGJzLCB5KSk7XG4gICAgICAgICAgICBicyA9IGJzLnJiTmV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH07XG4qL1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEhlbHBlcjogUXVhbnRpemUgc2l0ZXNcblxuLy8gcmhpbGwgMjAxMy0xMC0xMjpcbi8vIFRoaXMgaXMgdG8gc29sdmUgaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL2lzc3Vlcy8xNVxuLy8gU2luY2Ugbm90IGFsbCB1c2VycyB3aWxsIGVuZCB1cCB1c2luZyB0aGUga2luZCBvZiBjb29yZCB2YWx1ZXMgd2hpY2ggd291bGRcbi8vIGNhdXNlIHRoZSBpc3N1ZSB0byBhcmlzZSwgSSBjaG9zZSB0byBsZXQgdGhlIHVzZXIgZGVjaWRlIHdoZXRoZXIgb3Igbm90XG4vLyBoZSBzaG91bGQgc2FuaXRpemUgaGlzIGNvb3JkIHZhbHVlcyB0aHJvdWdoIHRoaXMgaGVscGVyLiBUaGlzIHdheSwgZm9yXG4vLyB0aG9zZSB1c2VycyB3aG8gdXNlcyBjb29yZCB2YWx1ZXMgd2hpY2ggYXJlIGtub3duIHRvIGJlIGZpbmUsIG5vIG92ZXJoZWFkIGlzXG4vLyBhZGRlZC5cblxuVm9yb25vaS5wcm90b3R5cGUucXVhbnRpemVTaXRlcyA9IGZ1bmN0aW9uKHNpdGVzKSB7XG4gICAgdmFyIM61ID0gdGhpcy7OtSxcbiAgICAgICAgbiA9IHNpdGVzLmxlbmd0aCxcbiAgICAgICAgc2l0ZTtcbiAgICB3aGlsZSAoIG4tLSApIHtcbiAgICAgICAgc2l0ZSA9IHNpdGVzW25dO1xuICAgICAgICBzaXRlLnggPSBNYXRoLmZsb29yKHNpdGUueCAvIM61KSAqIM61O1xuICAgICAgICBzaXRlLnkgPSBNYXRoLmZsb29yKHNpdGUueSAvIM61KSAqIM61O1xuICAgICAgICB9XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBIZWxwZXI6IFJlY3ljbGUgZGlhZ3JhbTogYWxsIHZlcnRleCwgZWRnZSBhbmQgY2VsbCBvYmplY3RzIGFyZVxuLy8gXCJzdXJyZW5kZXJlZFwiIHRvIHRoZSBWb3Jvbm9pIG9iamVjdCBmb3IgcmV1c2UuXG4vLyBUT0RPOiByaGlsbC12b3Jvbm9pLWNvcmUgdjI6IG1vcmUgcGVyZm9ybWFuY2UgdG8gYmUgZ2FpbmVkXG4vLyB3aGVuIEkgY2hhbmdlIHRoZSBzZW1hbnRpYyBvZiB3aGF0IGlzIHJldHVybmVkLlxuXG5Wb3Jvbm9pLnByb3RvdHlwZS5yZWN5Y2xlID0gZnVuY3Rpb24oZGlhZ3JhbSkge1xuICAgIGlmICggZGlhZ3JhbSApIHtcbiAgICAgICAgaWYgKCBkaWFncmFtIGluc3RhbmNlb2YgdGhpcy5EaWFncmFtICkge1xuICAgICAgICAgICAgdGhpcy50b1JlY3ljbGUgPSBkaWFncmFtO1xuICAgICAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRocm93ICdWb3Jvbm9pLnJlY3ljbGVEaWFncmFtKCkgPiBOZWVkIGEgRGlhZ3JhbSBvYmplY3QuJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG9wLWxldmVsIEZvcnR1bmUgbG9vcFxuXG4vLyByaGlsbCAyMDExLTA1LTE5OlxuLy8gICBWb3Jvbm9pIHNpdGVzIGFyZSBrZXB0IGNsaWVudC1zaWRlIG5vdywgdG8gYWxsb3dcbi8vICAgdXNlciB0byBmcmVlbHkgbW9kaWZ5IGNvbnRlbnQuIEF0IGNvbXB1dGUgdGltZSxcbi8vICAgKnJlZmVyZW5jZXMqIHRvIHNpdGVzIGFyZSBjb3BpZWQgbG9jYWxseS5cblxuVm9yb25vaS5wcm90b3R5cGUuY29tcHV0ZSA9IGZ1bmN0aW9uKHNpdGVzLCBiYm94KSB7XG4gICAgLy8gdG8gbWVhc3VyZSBleGVjdXRpb24gdGltZVxuICAgIHZhciBzdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuXG4gICAgLy8gaW5pdCBpbnRlcm5hbCBzdGF0ZVxuICAgIHRoaXMucmVzZXQoKTtcblxuICAgIC8vIGFueSBkaWFncmFtIGRhdGEgYXZhaWxhYmxlIGZvciByZWN5Y2xpbmc/XG4gICAgLy8gSSBkbyB0aGF0IGhlcmUgc28gdGhhdCB0aGlzIGlzIGluY2x1ZGVkIGluIGV4ZWN1dGlvbiB0aW1lXG4gICAgaWYgKCB0aGlzLnRvUmVjeWNsZSApIHtcbiAgICAgICAgdGhpcy52ZXJ0ZXhKdW5reWFyZCA9IHRoaXMudmVydGV4SnVua3lhcmQuY29uY2F0KHRoaXMudG9SZWN5Y2xlLnZlcnRpY2VzKTtcbiAgICAgICAgdGhpcy5lZGdlSnVua3lhcmQgPSB0aGlzLmVkZ2VKdW5reWFyZC5jb25jYXQodGhpcy50b1JlY3ljbGUuZWRnZXMpO1xuICAgICAgICB0aGlzLmNlbGxKdW5reWFyZCA9IHRoaXMuY2VsbEp1bmt5YXJkLmNvbmNhdCh0aGlzLnRvUmVjeWNsZS5jZWxscyk7XG4gICAgICAgIHRoaXMudG9SZWN5Y2xlID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSBzaXRlIGV2ZW50IHF1ZXVlXG4gICAgdmFyIHNpdGVFdmVudHMgPSBzaXRlcy5zbGljZSgwKTtcbiAgICBzaXRlRXZlbnRzLnNvcnQoZnVuY3Rpb24oYSxiKXtcbiAgICAgICAgdmFyIHIgPSBiLnkgLSBhLnk7XG4gICAgICAgIGlmIChyKSB7cmV0dXJuIHI7fVxuICAgICAgICByZXR1cm4gYi54IC0gYS54O1xuICAgICAgICB9KTtcblxuICAgIC8vIHByb2Nlc3MgcXVldWVcbiAgICB2YXIgc2l0ZSA9IHNpdGVFdmVudHMucG9wKCksXG4gICAgICAgIHNpdGVpZCA9IDAsXG4gICAgICAgIHhzaXRleCwgLy8gdG8gYXZvaWQgZHVwbGljYXRlIHNpdGVzXG4gICAgICAgIHhzaXRleSxcbiAgICAgICAgY2VsbHMgPSB0aGlzLmNlbGxzLFxuICAgICAgICBjaXJjbGU7XG5cbiAgICAvLyBtYWluIGxvb3BcbiAgICBmb3IgKDs7KSB7XG4gICAgICAgIC8vIHdlIG5lZWQgdG8gZmlndXJlIHdoZXRoZXIgd2UgaGFuZGxlIGEgc2l0ZSBvciBjaXJjbGUgZXZlbnRcbiAgICAgICAgLy8gZm9yIHRoaXMgd2UgZmluZCBvdXQgaWYgdGhlcmUgaXMgYSBzaXRlIGV2ZW50IGFuZCBpdCBpc1xuICAgICAgICAvLyAnZWFybGllcicgdGhhbiB0aGUgY2lyY2xlIGV2ZW50XG4gICAgICAgIGNpcmNsZSA9IHRoaXMuZmlyc3RDaXJjbGVFdmVudDtcblxuICAgICAgICAvLyBhZGQgYmVhY2ggc2VjdGlvblxuICAgICAgICBpZiAoc2l0ZSAmJiAoIWNpcmNsZSB8fCBzaXRlLnkgPCBjaXJjbGUueSB8fCAoc2l0ZS55ID09PSBjaXJjbGUueSAmJiBzaXRlLnggPCBjaXJjbGUueCkpKSB7XG4gICAgICAgICAgICAvLyBvbmx5IGlmIHNpdGUgaXMgbm90IGEgZHVwbGljYXRlXG4gICAgICAgICAgICBpZiAoc2l0ZS54ICE9PSB4c2l0ZXggfHwgc2l0ZS55ICE9PSB4c2l0ZXkpIHtcbiAgICAgICAgICAgICAgICAvLyBmaXJzdCBjcmVhdGUgY2VsbCBmb3IgbmV3IHNpdGVcbiAgICAgICAgICAgICAgICBjZWxsc1tzaXRlaWRdID0gdGhpcy5jcmVhdGVDZWxsKHNpdGUpO1xuICAgICAgICAgICAgICAgIHNpdGUudm9yb25vaUlkID0gc2l0ZWlkKys7XG4gICAgICAgICAgICAgICAgLy8gdGhlbiBjcmVhdGUgYSBiZWFjaHNlY3Rpb24gZm9yIHRoYXQgc2l0ZVxuICAgICAgICAgICAgICAgIHRoaXMuYWRkQmVhY2hzZWN0aW9uKHNpdGUpO1xuICAgICAgICAgICAgICAgIC8vIHJlbWVtYmVyIGxhc3Qgc2l0ZSBjb29yZHMgdG8gZGV0ZWN0IGR1cGxpY2F0ZVxuICAgICAgICAgICAgICAgIHhzaXRleSA9IHNpdGUueTtcbiAgICAgICAgICAgICAgICB4c2l0ZXggPSBzaXRlLng7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgc2l0ZSA9IHNpdGVFdmVudHMucG9wKCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgLy8gcmVtb3ZlIGJlYWNoIHNlY3Rpb25cbiAgICAgICAgZWxzZSBpZiAoY2lyY2xlKSB7XG4gICAgICAgICAgICB0aGlzLnJlbW92ZUJlYWNoc2VjdGlvbihjaXJjbGUuYXJjKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAvLyBhbGwgZG9uZSwgcXVpdFxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAvLyB3cmFwcGluZy11cDpcbiAgICAvLyAgIGNvbm5lY3QgZGFuZ2xpbmcgZWRnZXMgdG8gYm91bmRpbmcgYm94XG4gICAgLy8gICBjdXQgZWRnZXMgYXMgcGVyIGJvdW5kaW5nIGJveFxuICAgIC8vICAgZGlzY2FyZCBlZGdlcyBjb21wbGV0ZWx5IG91dHNpZGUgYm91bmRpbmcgYm94XG4gICAgLy8gICBkaXNjYXJkIGVkZ2VzIHdoaWNoIGFyZSBwb2ludC1saWtlXG4gICAgdGhpcy5jbGlwRWRnZXMoYmJveCk7XG5cbiAgICAvLyAgIGFkZCBtaXNzaW5nIGVkZ2VzIGluIG9yZGVyIHRvIGNsb3NlIG9wZW5lZCBjZWxsc1xuICAgIHRoaXMuY2xvc2VDZWxscyhiYm94KTtcblxuICAgIC8vIHRvIG1lYXN1cmUgZXhlY3V0aW9uIHRpbWVcbiAgICB2YXIgc3RvcFRpbWUgPSBuZXcgRGF0ZSgpO1xuXG4gICAgLy8gcHJlcGFyZSByZXR1cm4gdmFsdWVzXG4gICAgdmFyIGRpYWdyYW0gPSBuZXcgdGhpcy5EaWFncmFtKCk7XG4gICAgZGlhZ3JhbS5jZWxscyA9IHRoaXMuY2VsbHM7XG4gICAgZGlhZ3JhbS5lZGdlcyA9IHRoaXMuZWRnZXM7XG4gICAgZGlhZ3JhbS52ZXJ0aWNlcyA9IHRoaXMudmVydGljZXM7XG4gICAgZGlhZ3JhbS5leGVjVGltZSA9IHN0b3BUaW1lLmdldFRpbWUoKS1zdGFydFRpbWUuZ2V0VGltZSgpO1xuXG4gICAgLy8gY2xlYW4gdXBcbiAgICB0aGlzLnJlc2V0KCk7XG5cbiAgICByZXR1cm4gZGlhZ3JhbTtcbiAgICB9O1xuXG4vKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG5pZiAoIHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnICkge1xuICAgIG1vZHVsZS5leHBvcnRzID0gVm9yb25vaTtcbn1cbiIsIiIsIi8qXG5wb2lzc29uLWRpc2stc2FtcGxlXG5cbmh0dHBzOi8vZ2l0aHViLmNvbS9qZWZmcmV5LWhlYXJuL3BvaXNzb24tZGlzay1zYW1wbGVcblxuTUlUIExpY2Vuc2VcbiovXG5cbmZ1bmN0aW9uIFBvaXNzb25EaXNrU2FtcGxlcih3aWR0aCwgaGVpZ2h0LCBtaW5EaXN0YW5jZSwgc2FtcGxlRnJlcXVlbmN5KSB7XG4gICAgdGhpcy53aWR0aCA9IHdpZHRoO1xuICAgIHRoaXMuaGVpZ2h0ID0gaGVpZ2h0O1xuICAgIHRoaXMubWluRGlzdGFuY2UgPSBtaW5EaXN0YW5jZTtcbiAgICB0aGlzLnNhbXBsZUZyZXF1ZW5jeSA9IHNhbXBsZUZyZXF1ZW5jeTtcbiAgICB0aGlzLnJlc2V0KCk7XG59XG5cblBvaXNzb25EaXNrU2FtcGxlci5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmdyaWQgPSBuZXcgR3JpZCh0aGlzLndpZHRoLCB0aGlzLmhlaWdodCwgdGhpcy5taW5EaXN0YW5jZSk7XG4gICAgdGhpcy5vdXRwdXRMaXN0ID0gbmV3IEFycmF5KCk7XG4gICAgdGhpcy5wcm9jZXNzaW5nUXVldWUgPSBuZXcgUmFuZG9tUXVldWUoKTtcbn1cblxuUG9pc3NvbkRpc2tTYW1wbGVyLnByb3RvdHlwZS5zYW1wbGVVbnRpbFNvbHV0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgd2hpbGUgKHRoaXMuc2FtcGxlKCkpIHt9O1xuICAgIHJldHVybiB0aGlzLm91dHB1dExpc3Q7XG59XG5cblBvaXNzb25EaXNrU2FtcGxlci5wcm90b3R5cGUuc2FtcGxlID0gZnVuY3Rpb24oKSB7XG5cbiAgICAvLyBJZiB0aGlzIGlzIHRoZSBmaXJzdCBzYW1wbGVcbiAgICBpZiAoMCA9PSB0aGlzLm91dHB1dExpc3QubGVuZ3RoKSB7XG4gICAgICAgIC8vIEdlbmVyYXRlIGZpcnN0IHBvaW50XG4gICAgICAgIHRoaXMucXVldWVUb0FsbCh0aGlzLmdyaWQucmFuZG9tUG9pbnQoKSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHZhciBwcm9jZXNzUG9pbnQgPSB0aGlzLnByb2Nlc3NpbmdRdWV1ZS5wb3AoKTtcblxuICAgIC8vIFByb2Nlc3NpbmcgcXVldWUgaXMgZW1wdHksIHJldHVybiBmYWlsdXJlXG4gICAgaWYgKHByb2Nlc3NQb2ludCA9PSBudWxsKVxuICAgICAgICByZXR1cm4gZmFsc2U7XG5cbiAgICAvLyBHZW5lcmF0ZSBzYW1wbGUgcG9pbnRzIGFyb3VuZCB0aGUgcHJvY2Vzc2luZyBwb2ludFxuICAgIC8vIEFuZCBjaGVjayBpZiB0aGV5IGhhdmUgYW55IG5laWdoYm9ycyBvbiB0aGUgZ3JpZFxuICAgIC8vIElmIG5vdCwgYWRkIHRoZW0gdG8gdGhlIHF1ZXVlc1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5zYW1wbGVGcmVxdWVuY3k7IGkrKykge1xuICAgICAgICBzYW1wbGVQb2ludCA9IHRoaXMuZ3JpZC5yYW5kb21Qb2ludEFyb3VuZChwcm9jZXNzUG9pbnQpO1xuICAgICAgICBpZiAoIXRoaXMuZ3JpZC5pbk5laWdoYm9yaG9vZChzYW1wbGVQb2ludCkpIHtcbiAgICAgICAgICAgIC8vIE5vIG9uIGluIG5laWdoYm9yaG9vZCwgd2VsY29tZSB0byB0aGUgY2x1YlxuICAgICAgICAgICAgdGhpcy5xdWV1ZVRvQWxsKHNhbXBsZVBvaW50KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvLyBTYW1wbGUgc3VjY2Vzc2Z1bCBzaW5jZSB0aGUgcHJvY2Vzc2luZyBxdWV1ZSBpc24ndCBlbXB0eVxuICAgIHJldHVybiB0cnVlO1xufVxuXG5Qb2lzc29uRGlza1NhbXBsZXIucHJvdG90eXBlLnF1ZXVlVG9BbGwgPSBmdW5jdGlvbihwb2ludCkge1xuICAgIHZhciB2YWxpZCA9IHRoaXMuZ3JpZC5hZGRQb2ludFRvR3JpZChwb2ludCwgdGhpcy5ncmlkLnBpeGVsc1RvR3JpZENvb3Jkcyhwb2ludCkpO1xuICAgIGlmICghdmFsaWQpXG4gICAgICAgIHJldHVybjtcbiAgICB0aGlzLnByb2Nlc3NpbmdRdWV1ZS5wdXNoKHBvaW50KTtcbiAgICB0aGlzLm91dHB1dExpc3QucHVzaChwb2ludCk7XG59XG5cblxuXG5mdW5jdGlvbiBHcmlkKHdpZHRoLCBoZWlnaHQsIG1pbkRpc3RhbmNlKSB7XG4gICAgdGhpcy53aWR0aCA9IHdpZHRoO1xuICAgIHRoaXMuaGVpZ2h0ID0gaGVpZ2h0O1xuICAgIHRoaXMubWluRGlzdGFuY2UgPSBtaW5EaXN0YW5jZTtcbiAgICB0aGlzLmNlbGxTaXplID0gdGhpcy5taW5EaXN0YW5jZSAvIE1hdGguU1FSVDI7XG4gICAgLy9jb25zb2xlLmxvZyggdGhpcy5jZWxsU2l6ZSApO1xuICAgIHRoaXMucG9pbnRTaXplID0gMjtcblxuICAgIHRoaXMuY2VsbHNXaWRlID0gTWF0aC5jZWlsKHRoaXMud2lkdGggLyB0aGlzLmNlbGxTaXplKTtcbiAgICB0aGlzLmNlbGxzSGlnaCA9IE1hdGguY2VpbCh0aGlzLmhlaWdodCAvIHRoaXMuY2VsbFNpemUpO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBncmlkXG4gICAgdGhpcy5ncmlkID0gW107XG4gICAgZm9yICh2YXIgeCA9IDA7IHggPCB0aGlzLmNlbGxzV2lkZTsgeCsrKSB7XG4gICAgICAgIHRoaXMuZ3JpZFt4XSA9IFtdO1xuICAgICAgICBmb3IgKHZhciB5ID0gMDsgeSA8IHRoaXMuY2VsbHNIaWdoOyB5KyspIHtcbiAgICAgICAgICAgIHRoaXMuZ3JpZFt4XVt5XSA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbkdyaWQucHJvdG90eXBlLnBpeGVsc1RvR3JpZENvb3JkcyA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gICAgdmFyIGdyaWRYID0gTWF0aC5mbG9vcihwb2ludC54IC8gdGhpcy5jZWxsU2l6ZSk7XG4gICAgdmFyIGdyaWRZID0gTWF0aC5mbG9vcihwb2ludC55IC8gdGhpcy5jZWxsU2l6ZSk7XG4gICAgcmV0dXJuIHsgeDogZ3JpZFgsIHk6IGdyaWRZIH07XG59XG5cbkdyaWQucHJvdG90eXBlLmFkZFBvaW50VG9HcmlkID0gZnVuY3Rpb24ocG9pbnRDb29yZHMsIGdyaWRDb29yZHMpIHtcbiAgICAvLyBDaGVjayB0aGF0IHRoZSBjb29yZGluYXRlIG1ha2VzIHNlbnNlXG4gICAgaWYgKGdyaWRDb29yZHMueCA8IDAgfHwgZ3JpZENvb3Jkcy54ID4gdGhpcy5ncmlkLmxlbmd0aCAtIDEpXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICBpZiAoZ3JpZENvb3Jkcy55IDwgMCB8fCBncmlkQ29vcmRzLnkgPiB0aGlzLmdyaWRbZ3JpZENvb3Jkcy54XS5sZW5ndGggLSAxKVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgdGhpcy5ncmlkW2dyaWRDb29yZHMueF1bZ3JpZENvb3Jkcy55XSA9IHBvaW50Q29vcmRzO1xuICAgIC8vY29uc29sZS5sb2coIFwiQWRkaW5nIChcIitwb2ludENvb3Jkcy54K1wiLFwiK3BvaW50Q29vcmRzLnkrXCIgdG8gZ3JpZCBbXCIrZ3JpZENvb3Jkcy54K1wiLFwiK2dyaWRDb29yZHMueStcIl1cIiApO1xuICAgIHJldHVybiB0cnVlO1xufVxuXG5HcmlkLnByb3RvdHlwZS5yYW5kb21Qb2ludCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB7IHg6IGdldFJhbmRvbUFyYml0cmFyeSgwLCB0aGlzLndpZHRoKSwgeTogZ2V0UmFuZG9tQXJiaXRyYXJ5KDAsIHRoaXMuaGVpZ2h0KSB9O1xufVxuXG5HcmlkLnByb3RvdHlwZS5yYW5kb21Qb2ludEFyb3VuZCA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gICAgdmFyIHIxID0gTWF0aC5yYW5kb20oKTtcbiAgICB2YXIgcjIgPSBNYXRoLnJhbmRvbSgpO1xuICAgIC8vIGdldCBhIHJhbmRvbSByYWRpdXMgYmV0d2VlbiB0aGUgbWluIGRpc3RhbmNlIGFuZCAyIFggbWluZGlzdFxuICAgIHZhciByYWRpdXMgPSB0aGlzLm1pbkRpc3RhbmNlICogKHIxICsgMSk7XG4gICAgLy8gZ2V0IHJhbmRvbSBhbmdsZSBhcm91bmQgdGhlIGNpcmNsZVxuICAgIHZhciBhbmdsZSA9IDIgKiBNYXRoLlBJICogcjI7XG4gICAgLy8gZ2V0IHggYW5kIHkgY29vcmRzIGJhc2VkIG9uIGFuZ2xlIGFuZCByYWRpdXNcbiAgICB2YXIgeCA9IHBvaW50LnggKyByYWRpdXMgKiBNYXRoLmNvcyhhbmdsZSk7XG4gICAgdmFyIHkgPSBwb2ludC55ICsgcmFkaXVzICogTWF0aC5zaW4oYW5nbGUpO1xuICAgIHJldHVybiB7IHg6IHgsIHk6IHkgfTtcbn1cblxuR3JpZC5wcm90b3R5cGUuaW5OZWlnaGJvcmhvb2QgPSBmdW5jdGlvbihwb2ludCkge1xuICAgIHZhciBncmlkUG9pbnQgPSB0aGlzLnBpeGVsc1RvR3JpZENvb3Jkcyhwb2ludCk7XG5cbiAgICB2YXIgY2VsbHNBcm91bmRQb2ludCA9IHRoaXMuY2VsbHNBcm91bmRQb2ludChwb2ludCk7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNlbGxzQXJvdW5kUG9pbnQubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKGNlbGxzQXJvdW5kUG9pbnRbaV0gIT0gbnVsbCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuY2FsY0Rpc3RhbmNlKGNlbGxzQXJvdW5kUG9pbnRbaV0sIHBvaW50KSA8IHRoaXMubWluRGlzdGFuY2UpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbkdyaWQucHJvdG90eXBlLmNlbGxzQXJvdW5kUG9pbnQgPSBmdW5jdGlvbihwb2ludCkge1xuICAgIHZhciBncmlkQ29vcmRzID0gdGhpcy5waXhlbHNUb0dyaWRDb29yZHMocG9pbnQpO1xuICAgIHZhciBuZWlnaGJvcnMgPSBuZXcgQXJyYXkoKTtcblxuICAgIGZvciAodmFyIHggPSAtMjsgeCA8IDM7IHgrKykge1xuICAgICAgICB2YXIgdGFyZ2V0WCA9IGdyaWRDb29yZHMueCArIHg7XG4gICAgICAgIC8vIG1ha2Ugc3VyZSBsb3dlcmJvdW5kIGFuZCB1cHBlcmJvdW5kIG1ha2Ugc2Vuc2VcbiAgICAgICAgaWYgKHRhcmdldFggPCAwKVxuICAgICAgICAgICAgdGFyZ2V0WCA9IDA7XG4gICAgICAgIGlmICh0YXJnZXRYID4gdGhpcy5ncmlkLmxlbmd0aCAtIDEpXG4gICAgICAgICAgICB0YXJnZXRYID0gdGhpcy5ncmlkLmxlbmd0aCAtIDE7XG5cbiAgICAgICAgZm9yICh2YXIgeSA9IC0yOyB5IDwgMzsgeSsrKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0WSA9IGdyaWRDb29yZHMueSArIHk7XG4gICAgICAgICAgICAvLyBtYWtlIHN1cmUgbG93ZXJib3VuZCBhbmQgdXBwZXJib3VuZCBtYWtlIHNlbnNlXG4gICAgICAgICAgICBpZiAodGFyZ2V0WSA8IDApXG4gICAgICAgICAgICAgICAgdGFyZ2V0WSA9IDA7XG4gICAgICAgICAgICBpZiAodGFyZ2V0WSA+IHRoaXMuZ3JpZFt0YXJnZXRYXS5sZW5ndGggLSAxKVxuICAgICAgICAgICAgICAgIHRhcmdldFkgPSB0aGlzLmdyaWRbdGFyZ2V0WF0ubGVuZ3RoIC0gMTtcbiAgICAgICAgICAgIG5laWdoYm9ycy5wdXNoKHRoaXMuZ3JpZFt0YXJnZXRYXVt0YXJnZXRZXSlcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbmVpZ2hib3JzO1xufVxuXG5HcmlkLnByb3RvdHlwZS5jYWxjRGlzdGFuY2UgPSBmdW5jdGlvbihwb2ludEluQ2VsbCwgcG9pbnQpIHtcbiAgICByZXR1cm4gTWF0aC5zcXJ0KChwb2ludC54IC0gcG9pbnRJbkNlbGwueCkgKiAocG9pbnQueCAtIHBvaW50SW5DZWxsLngpICtcbiAgICAgICAgKHBvaW50LnkgLSBwb2ludEluQ2VsbC55KSAqIChwb2ludC55IC0gcG9pbnRJbkNlbGwueSkpO1xufVxuXG5cbmZ1bmN0aW9uIFJhbmRvbVF1ZXVlKGEpIHtcbiAgICB0aGlzLnF1ZXVlID0gYSB8fCBuZXcgQXJyYXkoKTtcbn1cblxuUmFuZG9tUXVldWUucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbihlbGVtZW50KSB7XG4gICAgdGhpcy5xdWV1ZS5wdXNoKGVsZW1lbnQpO1xufVxuXG5SYW5kb21RdWV1ZS5wcm90b3R5cGUucG9wID0gZnVuY3Rpb24oKSB7XG5cbiAgICByYW5kb21JbmRleCA9IGdldFJhbmRvbUludCgwLCB0aGlzLnF1ZXVlLmxlbmd0aCk7XG4gICAgd2hpbGUgKHRoaXMucXVldWVbcmFuZG9tSW5kZXhdID09PSB1bmRlZmluZWQpIHtcblxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgcXVldWUgaXMgZW1wdHlcbiAgICAgICAgdmFyIGVtcHR5ID0gdHJ1ZTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnF1ZXVlLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5xdWV1ZVtpXSAhPT0gdW5kZWZpbmVkKVxuICAgICAgICAgICAgICAgIGVtcHR5ID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVtcHR5KVxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgcmFuZG9tSW5kZXggPSBnZXRSYW5kb21JbnQoMCwgdGhpcy5xdWV1ZS5sZW5ndGgpO1xuICAgIH1cblxuICAgIGVsZW1lbnQgPSB0aGlzLnF1ZXVlW3JhbmRvbUluZGV4XTtcbiAgICB0aGlzLnF1ZXVlLnJlbW92ZShyYW5kb21JbmRleCk7XG4gICAgcmV0dXJuIGVsZW1lbnQ7XG59XG5cbi8vIEFycmF5IFJlbW92ZSAtIEJ5IEpvaG4gUmVzaWcgKE1JVCBMaWNlbnNlZClcbkFycmF5LnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihmcm9tLCB0bykge1xuICAgIHZhciByZXN0ID0gdGhpcy5zbGljZSgodG8gfHwgZnJvbSkgKyAxIHx8IHRoaXMubGVuZ3RoKTtcbiAgICB0aGlzLmxlbmd0aCA9IGZyb20gPCAwID8gdGhpcy5sZW5ndGggKyBmcm9tIDogZnJvbTtcbiAgICByZXR1cm4gdGhpcy5wdXNoLmFwcGx5KHRoaXMsIHJlc3QpO1xufTtcblxuLy8gTUROIFJhbmRvbSBOdW1iZXIgRnVuY3Rpb25zXG4vLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL0phdmFTY3JpcHQvUmVmZXJlbmNlL0dsb2JhbF9PYmplY3RzL01hdGgvcmFuZG9tXG5mdW5jdGlvbiBnZXRSYW5kb21BcmJpdHJhcnkobWluLCBtYXgpIHtcbiAgICByZXR1cm4gTWF0aC5yYW5kb20oKSAqIChtYXggLSBtaW4pICsgbWluO1xufVxuXG5mdW5jdGlvbiBnZXRSYW5kb21JbnQobWluLCBtYXgpIHtcbiAgICByZXR1cm4gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKG1heCAtIG1pbiArIDEpKSArIG1pbjtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBQb2lzc29uRGlza1NhbXBsZXI7IiwiLy8gQSBsaWJyYXJ5IG9mIHNlZWRhYmxlIFJOR3MgaW1wbGVtZW50ZWQgaW4gSmF2YXNjcmlwdC5cbi8vXG4vLyBVc2FnZTpcbi8vXG4vLyB2YXIgc2VlZHJhbmRvbSA9IHJlcXVpcmUoJ3NlZWRyYW5kb20nKTtcbi8vIHZhciByYW5kb20gPSBzZWVkcmFuZG9tKDEpOyAvLyBvciBhbnkgc2VlZC5cbi8vIHZhciB4ID0gcmFuZG9tKCk7ICAgICAgIC8vIDAgPD0geCA8IDEuICBFdmVyeSBiaXQgaXMgcmFuZG9tLlxuLy8gdmFyIHggPSByYW5kb20ucXVpY2soKTsgLy8gMCA8PSB4IDwgMS4gIDMyIGJpdHMgb2YgcmFuZG9tbmVzcy5cblxuLy8gYWxlYSwgYSA1My1iaXQgbXVsdGlwbHktd2l0aC1jYXJyeSBnZW5lcmF0b3IgYnkgSm9oYW5uZXMgQmFhZ8O4ZS5cbi8vIFBlcmlvZDogfjJeMTE2XG4vLyBSZXBvcnRlZCB0byBwYXNzIGFsbCBCaWdDcnVzaCB0ZXN0cy5cbnZhciBhbGVhID0gcmVxdWlyZSgnLi9saWIvYWxlYScpO1xuXG4vLyB4b3IxMjgsIGEgcHVyZSB4b3Itc2hpZnQgZ2VuZXJhdG9yIGJ5IEdlb3JnZSBNYXJzYWdsaWEuXG4vLyBQZXJpb2Q6IDJeMTI4LTEuXG4vLyBSZXBvcnRlZCB0byBmYWlsOiBNYXRyaXhSYW5rIGFuZCBMaW5lYXJDb21wLlxudmFyIHhvcjEyOCA9IHJlcXVpcmUoJy4vbGliL3hvcjEyOCcpO1xuXG4vLyB4b3J3b3csIEdlb3JnZSBNYXJzYWdsaWEncyAxNjAtYml0IHhvci1zaGlmdCBjb21iaW5lZCBwbHVzIHdleWwuXG4vLyBQZXJpb2Q6IDJeMTkyLTJeMzJcbi8vIFJlcG9ydGVkIHRvIGZhaWw6IENvbGxpc2lvbk92ZXIsIFNpbXBQb2tlciwgYW5kIExpbmVhckNvbXAuXG52YXIgeG9yd293ID0gcmVxdWlyZSgnLi9saWIveG9yd293Jyk7XG5cbi8vIHhvcnNoaWZ0NywgYnkgRnJhbsOnb2lzIFBhbm5ldG9uIGFuZCBQaWVycmUgTCdlY3V5ZXIsIHRha2VzXG4vLyBhIGRpZmZlcmVudCBhcHByb2FjaDogaXQgYWRkcyByb2J1c3RuZXNzIGJ5IGFsbG93aW5nIG1vcmUgc2hpZnRzXG4vLyB0aGFuIE1hcnNhZ2xpYSdzIG9yaWdpbmFsIHRocmVlLiAgSXQgaXMgYSA3LXNoaWZ0IGdlbmVyYXRvclxuLy8gd2l0aCAyNTYgYml0cywgdGhhdCBwYXNzZXMgQmlnQ3J1c2ggd2l0aCBubyBzeXN0bWF0aWMgZmFpbHVyZXMuXG4vLyBQZXJpb2QgMl4yNTYtMS5cbi8vIE5vIHN5c3RlbWF0aWMgQmlnQ3J1c2ggZmFpbHVyZXMgcmVwb3J0ZWQuXG52YXIgeG9yc2hpZnQ3ID0gcmVxdWlyZSgnLi9saWIveG9yc2hpZnQ3Jyk7XG5cbi8vIHhvcjQwOTYsIGJ5IFJpY2hhcmQgQnJlbnQsIGlzIGEgNDA5Ni1iaXQgeG9yLXNoaWZ0IHdpdGggYVxuLy8gdmVyeSBsb25nIHBlcmlvZCB0aGF0IGFsc28gYWRkcyBhIFdleWwgZ2VuZXJhdG9yLiBJdCBhbHNvIHBhc3Nlc1xuLy8gQmlnQ3J1c2ggd2l0aCBubyBzeXN0ZW1hdGljIGZhaWx1cmVzLiAgSXRzIGxvbmcgcGVyaW9kIG1heVxuLy8gYmUgdXNlZnVsIGlmIHlvdSBoYXZlIG1hbnkgZ2VuZXJhdG9ycyBhbmQgbmVlZCB0byBhdm9pZFxuLy8gY29sbGlzaW9ucy5cbi8vIFBlcmlvZDogMl40MTI4LTJeMzIuXG4vLyBObyBzeXN0ZW1hdGljIEJpZ0NydXNoIGZhaWx1cmVzIHJlcG9ydGVkLlxudmFyIHhvcjQwOTYgPSByZXF1aXJlKCcuL2xpYi94b3I0MDk2Jyk7XG5cbi8vIFR5Y2hlLWksIGJ5IFNhbXVlbCBOZXZlcyBhbmQgRmlsaXBlIEFyYXVqbywgaXMgYSBiaXQtc2hpZnRpbmcgcmFuZG9tXG4vLyBudW1iZXIgZ2VuZXJhdG9yIGRlcml2ZWQgZnJvbSBDaGFDaGEsIGEgbW9kZXJuIHN0cmVhbSBjaXBoZXIuXG4vLyBodHRwczovL2VkZW4uZGVpLnVjLnB0L35zbmV2ZXMvcHVicy8yMDExLXNuZmEyLnBkZlxuLy8gUGVyaW9kOiB+Ml4xMjdcbi8vIE5vIHN5c3RlbWF0aWMgQmlnQ3J1c2ggZmFpbHVyZXMgcmVwb3J0ZWQuXG52YXIgdHljaGVpID0gcmVxdWlyZSgnLi9saWIvdHljaGVpJyk7XG5cbi8vIFRoZSBvcmlnaW5hbCBBUkM0LWJhc2VkIHBybmcgaW5jbHVkZWQgaW4gdGhpcyBsaWJyYXJ5LlxuLy8gUGVyaW9kOiB+Ml4xNjAwXG52YXIgc3IgPSByZXF1aXJlKCcuL3NlZWRyYW5kb20nKTtcblxuc3IuYWxlYSA9IGFsZWE7XG5zci54b3IxMjggPSB4b3IxMjg7XG5zci54b3J3b3cgPSB4b3J3b3c7XG5zci54b3JzaGlmdDcgPSB4b3JzaGlmdDc7XG5zci54b3I0MDk2ID0geG9yNDA5NjtcbnNyLnR5Y2hlaSA9IHR5Y2hlaTtcblxubW9kdWxlLmV4cG9ydHMgPSBzcjtcbiIsIi8vIEEgcG9ydCBvZiBhbiBhbGdvcml0aG0gYnkgSm9oYW5uZXMgQmFhZ8O4ZSA8YmFhZ29lQGJhYWdvZS5jb20+LCAyMDEwXG4vLyBodHRwOi8vYmFhZ29lLmNvbS9lbi9SYW5kb21NdXNpbmdzL2phdmFzY3JpcHQvXG4vLyBodHRwczovL2dpdGh1Yi5jb20vbnF1aW5sYW4vYmV0dGVyLXJhbmRvbS1udW1iZXJzLWZvci1qYXZhc2NyaXB0LW1pcnJvclxuLy8gT3JpZ2luYWwgd29yayBpcyB1bmRlciBNSVQgbGljZW5zZSAtXG5cbi8vIENvcHlyaWdodCAoQykgMjAxMCBieSBKb2hhbm5lcyBCYWFnw7hlIDxiYWFnb2VAYmFhZ29lLm9yZz5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4vLyBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4vLyBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4vLyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4vLyBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbi8vIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vLyBcbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4vLyBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vIFxuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuLy8gSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4vLyBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbi8vIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbi8vIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG4vLyBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG4vLyBUSEUgU09GVFdBUkUuXG5cblxuXG4oZnVuY3Rpb24oZ2xvYmFsLCBtb2R1bGUsIGRlZmluZSkge1xuXG5mdW5jdGlvbiBBbGVhKHNlZWQpIHtcbiAgdmFyIG1lID0gdGhpcywgbWFzaCA9IE1hc2goKTtcblxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHQgPSAyMDkxNjM5ICogbWUuczAgKyBtZS5jICogMi4zMjgzMDY0MzY1Mzg2OTYzZS0xMDsgLy8gMl4tMzJcbiAgICBtZS5zMCA9IG1lLnMxO1xuICAgIG1lLnMxID0gbWUuczI7XG4gICAgcmV0dXJuIG1lLnMyID0gdCAtIChtZS5jID0gdCB8IDApO1xuICB9O1xuXG4gIC8vIEFwcGx5IHRoZSBzZWVkaW5nIGFsZ29yaXRobSBmcm9tIEJhYWdvZS5cbiAgbWUuYyA9IDE7XG4gIG1lLnMwID0gbWFzaCgnICcpO1xuICBtZS5zMSA9IG1hc2goJyAnKTtcbiAgbWUuczIgPSBtYXNoKCcgJyk7XG4gIG1lLnMwIC09IG1hc2goc2VlZCk7XG4gIGlmIChtZS5zMCA8IDApIHsgbWUuczAgKz0gMTsgfVxuICBtZS5zMSAtPSBtYXNoKHNlZWQpO1xuICBpZiAobWUuczEgPCAwKSB7IG1lLnMxICs9IDE7IH1cbiAgbWUuczIgLT0gbWFzaChzZWVkKTtcbiAgaWYgKG1lLnMyIDwgMCkgeyBtZS5zMiArPSAxOyB9XG4gIG1hc2ggPSBudWxsO1xufVxuXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC5jID0gZi5jO1xuICB0LnMwID0gZi5zMDtcbiAgdC5zMSA9IGYuczE7XG4gIHQuczIgPSBmLnMyO1xuICByZXR1cm4gdDtcbn1cblxuZnVuY3Rpb24gaW1wbChzZWVkLCBvcHRzKSB7XG4gIHZhciB4ZyA9IG5ldyBBbGVhKHNlZWQpLFxuICAgICAgc3RhdGUgPSBvcHRzICYmIG9wdHMuc3RhdGUsXG4gICAgICBwcm5nID0geGcubmV4dDtcbiAgcHJuZy5pbnQzMiA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gKHhnLm5leHQoKSAqIDB4MTAwMDAwMDAwKSB8IDA7IH1cbiAgcHJuZy5kb3VibGUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gcHJuZygpICsgKHBybmcoKSAqIDB4MjAwMDAwIHwgMCkgKiAxLjExMDIyMzAyNDYyNTE1NjVlLTE2OyAvLyAyXi01M1xuICB9O1xuICBwcm5nLnF1aWNrID0gcHJuZztcbiAgaWYgKHN0YXRlKSB7XG4gICAgaWYgKHR5cGVvZihzdGF0ZSkgPT0gJ29iamVjdCcpIGNvcHkoc3RhdGUsIHhnKTtcbiAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KHhnLCB7fSk7IH1cbiAgfVxuICByZXR1cm4gcHJuZztcbn1cblxuZnVuY3Rpb24gTWFzaCgpIHtcbiAgdmFyIG4gPSAweGVmYzgyNDlkO1xuXG4gIHZhciBtYXNoID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIGRhdGEgPSBkYXRhLnRvU3RyaW5nKCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkYXRhLmxlbmd0aDsgaSsrKSB7XG4gICAgICBuICs9IGRhdGEuY2hhckNvZGVBdChpKTtcbiAgICAgIHZhciBoID0gMC4wMjUxOTYwMzI4MjQxNjkzOCAqIG47XG4gICAgICBuID0gaCA+Pj4gMDtcbiAgICAgIGggLT0gbjtcbiAgICAgIGggKj0gbjtcbiAgICAgIG4gPSBoID4+PiAwO1xuICAgICAgaCAtPSBuO1xuICAgICAgbiArPSBoICogMHgxMDAwMDAwMDA7IC8vIDJeMzJcbiAgICB9XG4gICAgcmV0dXJuIChuID4+PiAwKSAqIDIuMzI4MzA2NDM2NTM4Njk2M2UtMTA7IC8vIDJeLTMyXG4gIH07XG5cbiAgcmV0dXJuIG1hc2g7XG59XG5cblxuaWYgKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IGltcGw7XG59IGVsc2UgaWYgKGRlZmluZSAmJiBkZWZpbmUuYW1kKSB7XG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIGltcGw7IH0pO1xufSBlbHNlIHtcbiAgdGhpcy5hbGVhID0gaW1wbDtcbn1cblxufSkoXG4gIHRoaXMsXG4gICh0eXBlb2YgbW9kdWxlKSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUsICAgIC8vIHByZXNlbnQgaW4gbm9kZS5qc1xuICAodHlwZW9mIGRlZmluZSkgPT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUgICAvLyBwcmVzZW50IHdpdGggYW4gQU1EIGxvYWRlclxuKTtcblxuXG4iLCIvLyBBIEphdmFzY3JpcHQgaW1wbGVtZW50YWlvbiBvZiB0aGUgXCJUeWNoZS1pXCIgcHJuZyBhbGdvcml0aG0gYnlcbi8vIFNhbXVlbCBOZXZlcyBhbmQgRmlsaXBlIEFyYXVqby5cbi8vIFNlZSBodHRwczovL2VkZW4uZGVpLnVjLnB0L35zbmV2ZXMvcHVicy8yMDExLXNuZmEyLnBkZlxuXG4oZnVuY3Rpb24oZ2xvYmFsLCBtb2R1bGUsIGRlZmluZSkge1xuXG5mdW5jdGlvbiBYb3JHZW4oc2VlZCkge1xuICB2YXIgbWUgPSB0aGlzLCBzdHJzZWVkID0gJyc7XG5cbiAgLy8gU2V0IHVwIGdlbmVyYXRvciBmdW5jdGlvbi5cbiAgbWUubmV4dCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBiID0gbWUuYiwgYyA9IG1lLmMsIGQgPSBtZS5kLCBhID0gbWUuYTtcbiAgICBiID0gKGIgPDwgMjUpIF4gKGIgPj4+IDcpIF4gYztcbiAgICBjID0gKGMgLSBkKSB8IDA7XG4gICAgZCA9IChkIDw8IDI0KSBeIChkID4+PiA4KSBeIGE7XG4gICAgYSA9IChhIC0gYikgfCAwO1xuICAgIG1lLmIgPSBiID0gKGIgPDwgMjApIF4gKGIgPj4+IDEyKSBeIGM7XG4gICAgbWUuYyA9IGMgPSAoYyAtIGQpIHwgMDtcbiAgICBtZS5kID0gKGQgPDwgMTYpIF4gKGMgPj4+IDE2KSBeIGE7XG4gICAgcmV0dXJuIG1lLmEgPSAoYSAtIGIpIHwgMDtcbiAgfTtcblxuICAvKiBUaGUgZm9sbG93aW5nIGlzIG5vbi1pbnZlcnRlZCB0eWNoZSwgd2hpY2ggaGFzIGJldHRlciBpbnRlcm5hbFxuICAgKiBiaXQgZGlmZnVzaW9uLCBidXQgd2hpY2ggaXMgYWJvdXQgMjUlIHNsb3dlciB0aGFuIHR5Y2hlLWkgaW4gSlMuXG4gIG1lLm5leHQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYSA9IG1lLmEsIGIgPSBtZS5iLCBjID0gbWUuYywgZCA9IG1lLmQ7XG4gICAgYSA9IChtZS5hICsgbWUuYiB8IDApID4+PiAwO1xuICAgIGQgPSBtZS5kIF4gYTsgZCA9IGQgPDwgMTYgXiBkID4+PiAxNjtcbiAgICBjID0gbWUuYyArIGQgfCAwO1xuICAgIGIgPSBtZS5iIF4gYzsgYiA9IGIgPDwgMTIgXiBkID4+PiAyMDtcbiAgICBtZS5hID0gYSA9IGEgKyBiIHwgMDtcbiAgICBkID0gZCBeIGE7IG1lLmQgPSBkID0gZCA8PCA4IF4gZCA+Pj4gMjQ7XG4gICAgbWUuYyA9IGMgPSBjICsgZCB8IDA7XG4gICAgYiA9IGIgXiBjO1xuICAgIHJldHVybiBtZS5iID0gKGIgPDwgNyBeIGIgPj4+IDI1KTtcbiAgfVxuICAqL1xuXG4gIG1lLmEgPSAwO1xuICBtZS5iID0gMDtcbiAgbWUuYyA9IDI2NTQ0MzU3NjkgfCAwO1xuICBtZS5kID0gMTM2NzEzMDU1MTtcblxuICBpZiAoc2VlZCA9PT0gTWF0aC5mbG9vcihzZWVkKSkge1xuICAgIC8vIEludGVnZXIgc2VlZC5cbiAgICBtZS5hID0gKHNlZWQgLyAweDEwMDAwMDAwMCkgfCAwO1xuICAgIG1lLmIgPSBzZWVkIHwgMDtcbiAgfSBlbHNlIHtcbiAgICAvLyBTdHJpbmcgc2VlZC5cbiAgICBzdHJzZWVkICs9IHNlZWQ7XG4gIH1cblxuICAvLyBNaXggaW4gc3RyaW5nIHNlZWQsIHRoZW4gZGlzY2FyZCBhbiBpbml0aWFsIGJhdGNoIG9mIDY0IHZhbHVlcy5cbiAgZm9yICh2YXIgayA9IDA7IGsgPCBzdHJzZWVkLmxlbmd0aCArIDIwOyBrKyspIHtcbiAgICBtZS5iIF49IHN0cnNlZWQuY2hhckNvZGVBdChrKSB8IDA7XG4gICAgbWUubmV4dCgpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvcHkoZiwgdCkge1xuICB0LmEgPSBmLmE7XG4gIHQuYiA9IGYuYjtcbiAgdC5jID0gZi5jO1xuICB0LmQgPSBmLmQ7XG4gIHJldHVybiB0O1xufTtcblxuZnVuY3Rpb24gaW1wbChzZWVkLCBvcHRzKSB7XG4gIHZhciB4ZyA9IG5ldyBYb3JHZW4oc2VlZCksXG4gICAgICBzdGF0ZSA9IG9wdHMgJiYgb3B0cy5zdGF0ZSxcbiAgICAgIHBybmcgPSBmdW5jdGlvbigpIHsgcmV0dXJuICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDA7IH07XG4gIHBybmcuZG91YmxlID0gZnVuY3Rpb24oKSB7XG4gICAgZG8ge1xuICAgICAgdmFyIHRvcCA9IHhnLm5leHQoKSA+Pj4gMTEsXG4gICAgICAgICAgYm90ID0gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMCxcbiAgICAgICAgICByZXN1bHQgPSAodG9wICsgYm90KSAvICgxIDw8IDIxKTtcbiAgICB9IHdoaWxlIChyZXN1bHQgPT09IDApO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG4gIHBybmcuaW50MzIgPSB4Zy5uZXh0O1xuICBwcm5nLnF1aWNrID0gcHJuZztcbiAgaWYgKHN0YXRlKSB7XG4gICAgaWYgKHR5cGVvZihzdGF0ZSkgPT0gJ29iamVjdCcpIGNvcHkoc3RhdGUsIHhnKTtcbiAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KHhnLCB7fSk7IH1cbiAgfVxuICByZXR1cm4gcHJuZztcbn1cblxuaWYgKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IGltcGw7XG59IGVsc2UgaWYgKGRlZmluZSAmJiBkZWZpbmUuYW1kKSB7XG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIGltcGw7IH0pO1xufSBlbHNlIHtcbiAgdGhpcy50eWNoZWkgPSBpbXBsO1xufVxuXG59KShcbiAgdGhpcyxcbiAgKHR5cGVvZiBtb2R1bGUpID09ICdvYmplY3QnICYmIG1vZHVsZSwgICAgLy8gcHJlc2VudCBpbiBub2RlLmpzXG4gICh0eXBlb2YgZGVmaW5lKSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZSAgIC8vIHByZXNlbnQgd2l0aCBhbiBBTUQgbG9hZGVyXG4pO1xuXG5cbiIsIi8vIEEgSmF2YXNjcmlwdCBpbXBsZW1lbnRhaW9uIG9mIHRoZSBcInhvcjEyOFwiIHBybmcgYWxnb3JpdGhtIGJ5XG4vLyBHZW9yZ2UgTWFyc2FnbGlhLiAgU2VlIGh0dHA6Ly93d3cuanN0YXRzb2Z0Lm9yZy92MDgvaTE0L3BhcGVyXG5cbihmdW5jdGlvbihnbG9iYWwsIG1vZHVsZSwgZGVmaW5lKSB7XG5cbmZ1bmN0aW9uIFhvckdlbihzZWVkKSB7XG4gIHZhciBtZSA9IHRoaXMsIHN0cnNlZWQgPSAnJztcblxuICBtZS54ID0gMDtcbiAgbWUueSA9IDA7XG4gIG1lLnogPSAwO1xuICBtZS53ID0gMDtcblxuICAvLyBTZXQgdXAgZ2VuZXJhdG9yIGZ1bmN0aW9uLlxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHQgPSBtZS54IF4gKG1lLnggPDwgMTEpO1xuICAgIG1lLnggPSBtZS55O1xuICAgIG1lLnkgPSBtZS56O1xuICAgIG1lLnogPSBtZS53O1xuICAgIHJldHVybiBtZS53IF49IChtZS53ID4+PiAxOSkgXiB0IF4gKHQgPj4+IDgpO1xuICB9O1xuXG4gIGlmIChzZWVkID09PSAoc2VlZCB8IDApKSB7XG4gICAgLy8gSW50ZWdlciBzZWVkLlxuICAgIG1lLnggPSBzZWVkO1xuICB9IGVsc2Uge1xuICAgIC8vIFN0cmluZyBzZWVkLlxuICAgIHN0cnNlZWQgKz0gc2VlZDtcbiAgfVxuXG4gIC8vIE1peCBpbiBzdHJpbmcgc2VlZCwgdGhlbiBkaXNjYXJkIGFuIGluaXRpYWwgYmF0Y2ggb2YgNjQgdmFsdWVzLlxuICBmb3IgKHZhciBrID0gMDsgayA8IHN0cnNlZWQubGVuZ3RoICsgNjQ7IGsrKykge1xuICAgIG1lLnggXj0gc3Ryc2VlZC5jaGFyQ29kZUF0KGspIHwgMDtcbiAgICBtZS5uZXh0KCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gY29weShmLCB0KSB7XG4gIHQueCA9IGYueDtcbiAgdC55ID0gZi55O1xuICB0LnogPSBmLno7XG4gIHQudyA9IGYudztcbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGltcGwoc2VlZCwgb3B0cykge1xuICB2YXIgeGcgPSBuZXcgWG9yR2VuKHNlZWQpLFxuICAgICAgc3RhdGUgPSBvcHRzICYmIG9wdHMuc3RhdGUsXG4gICAgICBwcm5nID0gZnVuY3Rpb24oKSB7IHJldHVybiAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwOyB9O1xuICBwcm5nLmRvdWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIGRvIHtcbiAgICAgIHZhciB0b3AgPSB4Zy5uZXh0KCkgPj4+IDExLFxuICAgICAgICAgIGJvdCA9ICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDAsXG4gICAgICAgICAgcmVzdWx0ID0gKHRvcCArIGJvdCkgLyAoMSA8PCAyMSk7XG4gICAgfSB3aGlsZSAocmVzdWx0ID09PSAwKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuICBwcm5nLmludDMyID0geGcubmV4dDtcbiAgcHJuZy5xdWljayA9IHBybmc7XG4gIGlmIChzdGF0ZSkge1xuICAgIGlmICh0eXBlb2Yoc3RhdGUpID09ICdvYmplY3QnKSBjb3B5KHN0YXRlLCB4Zyk7XG4gICAgcHJuZy5zdGF0ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gY29weSh4Zywge30pOyB9XG4gIH1cbiAgcmV0dXJuIHBybmc7XG59XG5cbmlmIChtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBpbXBsO1xufSBlbHNlIGlmIChkZWZpbmUgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBpbXBsOyB9KTtcbn0gZWxzZSB7XG4gIHRoaXMueG9yMTI4ID0gaW1wbDtcbn1cblxufSkoXG4gIHRoaXMsXG4gICh0eXBlb2YgbW9kdWxlKSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUsICAgIC8vIHByZXNlbnQgaW4gbm9kZS5qc1xuICAodHlwZW9mIGRlZmluZSkgPT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUgICAvLyBwcmVzZW50IHdpdGggYW4gQU1EIGxvYWRlclxuKTtcblxuXG4iLCIvLyBBIEphdmFzY3JpcHQgaW1wbGVtZW50YWlvbiBvZiBSaWNoYXJkIEJyZW50J3MgWG9yZ2VucyB4b3I0MDk2IGFsZ29yaXRobS5cbi8vXG4vLyBUaGlzIGZhc3Qgbm9uLWNyeXB0b2dyYXBoaWMgcmFuZG9tIG51bWJlciBnZW5lcmF0b3IgaXMgZGVzaWduZWQgZm9yXG4vLyB1c2UgaW4gTW9udGUtQ2FybG8gYWxnb3JpdGhtcy4gSXQgY29tYmluZXMgYSBsb25nLXBlcmlvZCB4b3JzaGlmdFxuLy8gZ2VuZXJhdG9yIHdpdGggYSBXZXlsIGdlbmVyYXRvciwgYW5kIGl0IHBhc3NlcyBhbGwgY29tbW9uIGJhdHRlcmllc1xuLy8gb2Ygc3Rhc3RpY2lhbCB0ZXN0cyBmb3IgcmFuZG9tbmVzcyB3aGlsZSBjb25zdW1pbmcgb25seSBhIGZldyBuYW5vc2Vjb25kc1xuLy8gZm9yIGVhY2ggcHJuZyBnZW5lcmF0ZWQuICBGb3IgYmFja2dyb3VuZCBvbiB0aGUgZ2VuZXJhdG9yLCBzZWUgQnJlbnQnc1xuLy8gcGFwZXI6IFwiU29tZSBsb25nLXBlcmlvZCByYW5kb20gbnVtYmVyIGdlbmVyYXRvcnMgdXNpbmcgc2hpZnRzIGFuZCB4b3JzLlwiXG4vLyBodHRwOi8vYXJ4aXYub3JnL3BkZi8xMDA0LjMxMTV2MS5wZGZcbi8vXG4vLyBVc2FnZTpcbi8vXG4vLyB2YXIgeG9yNDA5NiA9IHJlcXVpcmUoJ3hvcjQwOTYnKTtcbi8vIHJhbmRvbSA9IHhvcjQwOTYoMSk7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2VlZCB3aXRoIGludDMyIG9yIHN0cmluZy5cbi8vIGFzc2VydC5lcXVhbChyYW5kb20oKSwgMC4xNTIwNDM2NDUwNTM4NTQ3KTsgLy8gKDAsIDEpIHJhbmdlLCA1MyBiaXRzLlxuLy8gYXNzZXJ0LmVxdWFsKHJhbmRvbS5pbnQzMigpLCAxODA2NTM0ODk3KTsgICAvLyBzaWduZWQgaW50MzIsIDMyIGJpdHMuXG4vL1xuLy8gRm9yIG5vbnplcm8gbnVtZXJpYyBrZXlzLCB0aGlzIGltcGVsZW1lbnRhdGlvbiBwcm92aWRlcyBhIHNlcXVlbmNlXG4vLyBpZGVudGljYWwgdG8gdGhhdCBieSBCcmVudCdzIHhvcmdlbnMgMyBpbXBsZW1lbnRhaW9uIGluIEMuICBUaGlzXG4vLyBpbXBsZW1lbnRhdGlvbiBhbHNvIHByb3ZpZGVzIGZvciBpbml0YWxpemluZyB0aGUgZ2VuZXJhdG9yIHdpdGhcbi8vIHN0cmluZyBzZWVkcywgb3IgZm9yIHNhdmluZyBhbmQgcmVzdG9yaW5nIHRoZSBzdGF0ZSBvZiB0aGUgZ2VuZXJhdG9yLlxuLy9cbi8vIE9uIENocm9tZSwgdGhpcyBwcm5nIGJlbmNobWFya3MgYWJvdXQgMi4xIHRpbWVzIHNsb3dlciB0aGFuXG4vLyBKYXZhc2NyaXB0J3MgYnVpbHQtaW4gTWF0aC5yYW5kb20oKS5cblxuKGZ1bmN0aW9uKGdsb2JhbCwgbW9kdWxlLCBkZWZpbmUpIHtcblxuZnVuY3Rpb24gWG9yR2VuKHNlZWQpIHtcbiAgdmFyIG1lID0gdGhpcztcblxuICAvLyBTZXQgdXAgZ2VuZXJhdG9yIGZ1bmN0aW9uLlxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHcgPSBtZS53LFxuICAgICAgICBYID0gbWUuWCwgaSA9IG1lLmksIHQsIHY7XG4gICAgLy8gVXBkYXRlIFdleWwgZ2VuZXJhdG9yLlxuICAgIG1lLncgPSB3ID0gKHcgKyAweDYxYzg4NjQ3KSB8IDA7XG4gICAgLy8gVXBkYXRlIHhvciBnZW5lcmF0b3IuXG4gICAgdiA9IFhbKGkgKyAzNCkgJiAxMjddO1xuICAgIHQgPSBYW2kgPSAoKGkgKyAxKSAmIDEyNyldO1xuICAgIHYgXj0gdiA8PCAxMztcbiAgICB0IF49IHQgPDwgMTc7XG4gICAgdiBePSB2ID4+PiAxNTtcbiAgICB0IF49IHQgPj4+IDEyO1xuICAgIC8vIFVwZGF0ZSBYb3IgZ2VuZXJhdG9yIGFycmF5IHN0YXRlLlxuICAgIHYgPSBYW2ldID0gdiBeIHQ7XG4gICAgbWUuaSA9IGk7XG4gICAgLy8gUmVzdWx0IGlzIHRoZSBjb21iaW5hdGlvbi5cbiAgICByZXR1cm4gKHYgKyAodyBeICh3ID4+PiAxNikpKSB8IDA7XG4gIH07XG5cbiAgZnVuY3Rpb24gaW5pdChtZSwgc2VlZCkge1xuICAgIHZhciB0LCB2LCBpLCBqLCB3LCBYID0gW10sIGxpbWl0ID0gMTI4O1xuICAgIGlmIChzZWVkID09PSAoc2VlZCB8IDApKSB7XG4gICAgICAvLyBOdW1lcmljIHNlZWRzIGluaXRpYWxpemUgdiwgd2hpY2ggaXMgdXNlZCB0byBnZW5lcmF0ZXMgWC5cbiAgICAgIHYgPSBzZWVkO1xuICAgICAgc2VlZCA9IG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFN0cmluZyBzZWVkcyBhcmUgbWl4ZWQgaW50byB2IGFuZCBYIG9uZSBjaGFyYWN0ZXIgYXQgYSB0aW1lLlxuICAgICAgc2VlZCA9IHNlZWQgKyAnXFwwJztcbiAgICAgIHYgPSAwO1xuICAgICAgbGltaXQgPSBNYXRoLm1heChsaW1pdCwgc2VlZC5sZW5ndGgpO1xuICAgIH1cbiAgICAvLyBJbml0aWFsaXplIGNpcmN1bGFyIGFycmF5IGFuZCB3ZXlsIHZhbHVlLlxuICAgIGZvciAoaSA9IDAsIGogPSAtMzI7IGogPCBsaW1pdDsgKytqKSB7XG4gICAgICAvLyBQdXQgdGhlIHVuaWNvZGUgY2hhcmFjdGVycyBpbnRvIHRoZSBhcnJheSwgYW5kIHNodWZmbGUgdGhlbS5cbiAgICAgIGlmIChzZWVkKSB2IF49IHNlZWQuY2hhckNvZGVBdCgoaiArIDMyKSAlIHNlZWQubGVuZ3RoKTtcbiAgICAgIC8vIEFmdGVyIDMyIHNodWZmbGVzLCB0YWtlIHYgYXMgdGhlIHN0YXJ0aW5nIHcgdmFsdWUuXG4gICAgICBpZiAoaiA9PT0gMCkgdyA9IHY7XG4gICAgICB2IF49IHYgPDwgMTA7XG4gICAgICB2IF49IHYgPj4+IDE1O1xuICAgICAgdiBePSB2IDw8IDQ7XG4gICAgICB2IF49IHYgPj4+IDEzO1xuICAgICAgaWYgKGogPj0gMCkge1xuICAgICAgICB3ID0gKHcgKyAweDYxYzg4NjQ3KSB8IDA7ICAgICAvLyBXZXlsLlxuICAgICAgICB0ID0gKFhbaiAmIDEyN10gXj0gKHYgKyB3KSk7ICAvLyBDb21iaW5lIHhvciBhbmQgd2V5bCB0byBpbml0IGFycmF5LlxuICAgICAgICBpID0gKDAgPT0gdCkgPyBpICsgMSA6IDA7ICAgICAvLyBDb3VudCB6ZXJvZXMuXG4gICAgICB9XG4gICAgfVxuICAgIC8vIFdlIGhhdmUgZGV0ZWN0ZWQgYWxsIHplcm9lczsgbWFrZSB0aGUga2V5IG5vbnplcm8uXG4gICAgaWYgKGkgPj0gMTI4KSB7XG4gICAgICBYWyhzZWVkICYmIHNlZWQubGVuZ3RoIHx8IDApICYgMTI3XSA9IC0xO1xuICAgIH1cbiAgICAvLyBSdW4gdGhlIGdlbmVyYXRvciA1MTIgdGltZXMgdG8gZnVydGhlciBtaXggdGhlIHN0YXRlIGJlZm9yZSB1c2luZyBpdC5cbiAgICAvLyBGYWN0b3JpbmcgdGhpcyBhcyBhIGZ1bmN0aW9uIHNsb3dzIHRoZSBtYWluIGdlbmVyYXRvciwgc28gaXQgaXMganVzdFxuICAgIC8vIHVucm9sbGVkIGhlcmUuICBUaGUgd2V5bCBnZW5lcmF0b3IgaXMgbm90IGFkdmFuY2VkIHdoaWxlIHdhcm1pbmcgdXAuXG4gICAgaSA9IDEyNztcbiAgICBmb3IgKGogPSA0ICogMTI4OyBqID4gMDsgLS1qKSB7XG4gICAgICB2ID0gWFsoaSArIDM0KSAmIDEyN107XG4gICAgICB0ID0gWFtpID0gKChpICsgMSkgJiAxMjcpXTtcbiAgICAgIHYgXj0gdiA8PCAxMztcbiAgICAgIHQgXj0gdCA8PCAxNztcbiAgICAgIHYgXj0gdiA+Pj4gMTU7XG4gICAgICB0IF49IHQgPj4+IDEyO1xuICAgICAgWFtpXSA9IHYgXiB0O1xuICAgIH1cbiAgICAvLyBTdG9yaW5nIHN0YXRlIGFzIG9iamVjdCBtZW1iZXJzIGlzIGZhc3RlciB0aGFuIHVzaW5nIGNsb3N1cmUgdmFyaWFibGVzLlxuICAgIG1lLncgPSB3O1xuICAgIG1lLlggPSBYO1xuICAgIG1lLmkgPSBpO1xuICB9XG5cbiAgaW5pdChtZSwgc2VlZCk7XG59XG5cbmZ1bmN0aW9uIGNvcHkoZiwgdCkge1xuICB0LmkgPSBmLmk7XG4gIHQudyA9IGYudztcbiAgdC5YID0gZi5YLnNsaWNlKCk7XG4gIHJldHVybiB0O1xufTtcblxuZnVuY3Rpb24gaW1wbChzZWVkLCBvcHRzKSB7XG4gIGlmIChzZWVkID09IG51bGwpIHNlZWQgPSArKG5ldyBEYXRlKTtcbiAgdmFyIHhnID0gbmV3IFhvckdlbihzZWVkKSxcbiAgICAgIHN0YXRlID0gb3B0cyAmJiBvcHRzLnN0YXRlLFxuICAgICAgcHJuZyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMDsgfTtcbiAgcHJuZy5kb3VibGUgPSBmdW5jdGlvbigpIHtcbiAgICBkbyB7XG4gICAgICB2YXIgdG9wID0geGcubmV4dCgpID4+PiAxMSxcbiAgICAgICAgICBib3QgPSAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwLFxuICAgICAgICAgIHJlc3VsdCA9ICh0b3AgKyBib3QpIC8gKDEgPDwgMjEpO1xuICAgIH0gd2hpbGUgKHJlc3VsdCA9PT0gMCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcbiAgcHJuZy5pbnQzMiA9IHhnLm5leHQ7XG4gIHBybmcucXVpY2sgPSBwcm5nO1xuICBpZiAoc3RhdGUpIHtcbiAgICBpZiAoc3RhdGUuWCkgY29weShzdGF0ZSwgeGcpO1xuICAgIHBybmcuc3RhdGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGNvcHkoeGcsIHt9KTsgfVxuICB9XG4gIHJldHVybiBwcm5nO1xufVxuXG5pZiAobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gaW1wbDtcbn0gZWxzZSBpZiAoZGVmaW5lICYmIGRlZmluZS5hbWQpIHtcbiAgZGVmaW5lKGZ1bmN0aW9uKCkgeyByZXR1cm4gaW1wbDsgfSk7XG59IGVsc2Uge1xuICB0aGlzLnhvcjQwOTYgPSBpbXBsO1xufVxuXG59KShcbiAgdGhpcywgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2luZG93IG9iamVjdCBvciBnbG9iYWxcbiAgKHR5cGVvZiBtb2R1bGUpID09ICdvYmplY3QnICYmIG1vZHVsZSwgICAgLy8gcHJlc2VudCBpbiBub2RlLmpzXG4gICh0eXBlb2YgZGVmaW5lKSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZSAgIC8vIHByZXNlbnQgd2l0aCBhbiBBTUQgbG9hZGVyXG4pO1xuIiwiLy8gQSBKYXZhc2NyaXB0IGltcGxlbWVudGFpb24gb2YgdGhlIFwieG9yc2hpZnQ3XCIgYWxnb3JpdGhtIGJ5XG4vLyBGcmFuw6dvaXMgUGFubmV0b24gYW5kIFBpZXJyZSBMJ2VjdXllcjpcbi8vIFwiT24gdGhlIFhvcmdzaGlmdCBSYW5kb20gTnVtYmVyIEdlbmVyYXRvcnNcIlxuLy8gaHR0cDovL3NhbHVjLmVuZ3IudWNvbm4uZWR1L3JlZnMvY3J5cHRvL3JuZy9wYW5uZXRvbjA1b250aGV4b3JzaGlmdC5wZGZcblxuKGZ1bmN0aW9uKGdsb2JhbCwgbW9kdWxlLCBkZWZpbmUpIHtcblxuZnVuY3Rpb24gWG9yR2VuKHNlZWQpIHtcbiAgdmFyIG1lID0gdGhpcztcblxuICAvLyBTZXQgdXAgZ2VuZXJhdG9yIGZ1bmN0aW9uLlxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgLy8gVXBkYXRlIHhvciBnZW5lcmF0b3IuXG4gICAgdmFyIFggPSBtZS54LCBpID0gbWUuaSwgdCwgdiwgdztcbiAgICB0ID0gWFtpXTsgdCBePSAodCA+Pj4gNyk7IHYgPSB0IF4gKHQgPDwgMjQpO1xuICAgIHQgPSBYWyhpICsgMSkgJiA3XTsgdiBePSB0IF4gKHQgPj4+IDEwKTtcbiAgICB0ID0gWFsoaSArIDMpICYgN107IHYgXj0gdCBeICh0ID4+PiAzKTtcbiAgICB0ID0gWFsoaSArIDQpICYgN107IHYgXj0gdCBeICh0IDw8IDcpO1xuICAgIHQgPSBYWyhpICsgNykgJiA3XTsgdCA9IHQgXiAodCA8PCAxMyk7IHYgXj0gdCBeICh0IDw8IDkpO1xuICAgIFhbaV0gPSB2O1xuICAgIG1lLmkgPSAoaSArIDEpICYgNztcbiAgICByZXR1cm4gdjtcbiAgfTtcblxuICBmdW5jdGlvbiBpbml0KG1lLCBzZWVkKSB7XG4gICAgdmFyIGosIHcsIFggPSBbXTtcblxuICAgIGlmIChzZWVkID09PSAoc2VlZCB8IDApKSB7XG4gICAgICAvLyBTZWVkIHN0YXRlIGFycmF5IHVzaW5nIGEgMzItYml0IGludGVnZXIuXG4gICAgICB3ID0gWFswXSA9IHNlZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNlZWQgc3RhdGUgdXNpbmcgYSBzdHJpbmcuXG4gICAgICBzZWVkID0gJycgKyBzZWVkO1xuICAgICAgZm9yIChqID0gMDsgaiA8IHNlZWQubGVuZ3RoOyArK2opIHtcbiAgICAgICAgWFtqICYgN10gPSAoWFtqICYgN10gPDwgMTUpIF5cbiAgICAgICAgICAgIChzZWVkLmNoYXJDb2RlQXQoaikgKyBYWyhqICsgMSkgJiA3XSA8PCAxMyk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEVuZm9yY2UgYW4gYXJyYXkgbGVuZ3RoIG9mIDgsIG5vdCBhbGwgemVyb2VzLlxuICAgIHdoaWxlIChYLmxlbmd0aCA8IDgpIFgucHVzaCgwKTtcbiAgICBmb3IgKGogPSAwOyBqIDwgOCAmJiBYW2pdID09PSAwOyArK2opO1xuICAgIGlmIChqID09IDgpIHcgPSBYWzddID0gLTE7IGVsc2UgdyA9IFhbal07XG5cbiAgICBtZS54ID0gWDtcbiAgICBtZS5pID0gMDtcblxuICAgIC8vIERpc2NhcmQgYW4gaW5pdGlhbCAyNTYgdmFsdWVzLlxuICAgIGZvciAoaiA9IDI1NjsgaiA+IDA7IC0taikge1xuICAgICAgbWUubmV4dCgpO1xuICAgIH1cbiAgfVxuXG4gIGluaXQobWUsIHNlZWQpO1xufVxuXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC54ID0gZi54LnNsaWNlKCk7XG4gIHQuaSA9IGYuaTtcbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGltcGwoc2VlZCwgb3B0cykge1xuICBpZiAoc2VlZCA9PSBudWxsKSBzZWVkID0gKyhuZXcgRGF0ZSk7XG4gIHZhciB4ZyA9IG5ldyBYb3JHZW4oc2VlZCksXG4gICAgICBzdGF0ZSA9IG9wdHMgJiYgb3B0cy5zdGF0ZSxcbiAgICAgIHBybmcgPSBmdW5jdGlvbigpIHsgcmV0dXJuICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDA7IH07XG4gIHBybmcuZG91YmxlID0gZnVuY3Rpb24oKSB7XG4gICAgZG8ge1xuICAgICAgdmFyIHRvcCA9IHhnLm5leHQoKSA+Pj4gMTEsXG4gICAgICAgICAgYm90ID0gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMCxcbiAgICAgICAgICByZXN1bHQgPSAodG9wICsgYm90KSAvICgxIDw8IDIxKTtcbiAgICB9IHdoaWxlIChyZXN1bHQgPT09IDApO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG4gIHBybmcuaW50MzIgPSB4Zy5uZXh0O1xuICBwcm5nLnF1aWNrID0gcHJuZztcbiAgaWYgKHN0YXRlKSB7XG4gICAgaWYgKHN0YXRlLngpIGNvcHkoc3RhdGUsIHhnKTtcbiAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KHhnLCB7fSk7IH1cbiAgfVxuICByZXR1cm4gcHJuZztcbn1cblxuaWYgKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IGltcGw7XG59IGVsc2UgaWYgKGRlZmluZSAmJiBkZWZpbmUuYW1kKSB7XG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIGltcGw7IH0pO1xufSBlbHNlIHtcbiAgdGhpcy54b3JzaGlmdDcgPSBpbXBsO1xufVxuXG59KShcbiAgdGhpcyxcbiAgKHR5cGVvZiBtb2R1bGUpID09ICdvYmplY3QnICYmIG1vZHVsZSwgICAgLy8gcHJlc2VudCBpbiBub2RlLmpzXG4gICh0eXBlb2YgZGVmaW5lKSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZSAgIC8vIHByZXNlbnQgd2l0aCBhbiBBTUQgbG9hZGVyXG4pO1xuXG4iLCIvLyBBIEphdmFzY3JpcHQgaW1wbGVtZW50YWlvbiBvZiB0aGUgXCJ4b3J3b3dcIiBwcm5nIGFsZ29yaXRobSBieVxuLy8gR2VvcmdlIE1hcnNhZ2xpYS4gIFNlZSBodHRwOi8vd3d3LmpzdGF0c29mdC5vcmcvdjA4L2kxNC9wYXBlclxuXG4oZnVuY3Rpb24oZ2xvYmFsLCBtb2R1bGUsIGRlZmluZSkge1xuXG5mdW5jdGlvbiBYb3JHZW4oc2VlZCkge1xuICB2YXIgbWUgPSB0aGlzLCBzdHJzZWVkID0gJyc7XG5cbiAgLy8gU2V0IHVwIGdlbmVyYXRvciBmdW5jdGlvbi5cbiAgbWUubmV4dCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB0ID0gKG1lLnggXiAobWUueCA+Pj4gMikpO1xuICAgIG1lLnggPSBtZS55OyBtZS55ID0gbWUuejsgbWUueiA9IG1lLnc7IG1lLncgPSBtZS52O1xuICAgIHJldHVybiAobWUuZCA9IChtZS5kICsgMzYyNDM3IHwgMCkpICtcbiAgICAgICAobWUudiA9IChtZS52IF4gKG1lLnYgPDwgNCkpIF4gKHQgXiAodCA8PCAxKSkpIHwgMDtcbiAgfTtcblxuICBtZS54ID0gMDtcbiAgbWUueSA9IDA7XG4gIG1lLnogPSAwO1xuICBtZS53ID0gMDtcbiAgbWUudiA9IDA7XG5cbiAgaWYgKHNlZWQgPT09IChzZWVkIHwgMCkpIHtcbiAgICAvLyBJbnRlZ2VyIHNlZWQuXG4gICAgbWUueCA9IHNlZWQ7XG4gIH0gZWxzZSB7XG4gICAgLy8gU3RyaW5nIHNlZWQuXG4gICAgc3Ryc2VlZCArPSBzZWVkO1xuICB9XG5cbiAgLy8gTWl4IGluIHN0cmluZyBzZWVkLCB0aGVuIGRpc2NhcmQgYW4gaW5pdGlhbCBiYXRjaCBvZiA2NCB2YWx1ZXMuXG4gIGZvciAodmFyIGsgPSAwOyBrIDwgc3Ryc2VlZC5sZW5ndGggKyA2NDsgaysrKSB7XG4gICAgbWUueCBePSBzdHJzZWVkLmNoYXJDb2RlQXQoaykgfCAwO1xuICAgIGlmIChrID09IHN0cnNlZWQubGVuZ3RoKSB7XG4gICAgICBtZS5kID0gbWUueCA8PCAxMCBeIG1lLnggPj4+IDQ7XG4gICAgfVxuICAgIG1lLm5leHQoKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC54ID0gZi54O1xuICB0LnkgPSBmLnk7XG4gIHQueiA9IGYuejtcbiAgdC53ID0gZi53O1xuICB0LnYgPSBmLnY7XG4gIHQuZCA9IGYuZDtcbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGltcGwoc2VlZCwgb3B0cykge1xuICB2YXIgeGcgPSBuZXcgWG9yR2VuKHNlZWQpLFxuICAgICAgc3RhdGUgPSBvcHRzICYmIG9wdHMuc3RhdGUsXG4gICAgICBwcm5nID0gZnVuY3Rpb24oKSB7IHJldHVybiAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwOyB9O1xuICBwcm5nLmRvdWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIGRvIHtcbiAgICAgIHZhciB0b3AgPSB4Zy5uZXh0KCkgPj4+IDExLFxuICAgICAgICAgIGJvdCA9ICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDAsXG4gICAgICAgICAgcmVzdWx0ID0gKHRvcCArIGJvdCkgLyAoMSA8PCAyMSk7XG4gICAgfSB3aGlsZSAocmVzdWx0ID09PSAwKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuICBwcm5nLmludDMyID0geGcubmV4dDtcbiAgcHJuZy5xdWljayA9IHBybmc7XG4gIGlmIChzdGF0ZSkge1xuICAgIGlmICh0eXBlb2Yoc3RhdGUpID09ICdvYmplY3QnKSBjb3B5KHN0YXRlLCB4Zyk7XG4gICAgcHJuZy5zdGF0ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gY29weSh4Zywge30pOyB9XG4gIH1cbiAgcmV0dXJuIHBybmc7XG59XG5cbmlmIChtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBpbXBsO1xufSBlbHNlIGlmIChkZWZpbmUgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBpbXBsOyB9KTtcbn0gZWxzZSB7XG4gIHRoaXMueG9yd293ID0gaW1wbDtcbn1cblxufSkoXG4gIHRoaXMsXG4gICh0eXBlb2YgbW9kdWxlKSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUsICAgIC8vIHByZXNlbnQgaW4gbm9kZS5qc1xuICAodHlwZW9mIGRlZmluZSkgPT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUgICAvLyBwcmVzZW50IHdpdGggYW4gQU1EIGxvYWRlclxuKTtcblxuXG4iLCIvKlxuQ29weXJpZ2h0IDIwMTQgRGF2aWQgQmF1LlxuXG5QZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmdcbmEgY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG53aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG5kaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG9cbnBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0b1xudGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuXG5UaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZVxuaW5jbHVkZWQgaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG5cblRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsXG5FWFBSRVNTIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbk1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC5cbklOIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZXG5DTEFJTSwgREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULFxuVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEVcblNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG4qL1xuXG4oZnVuY3Rpb24gKHBvb2wsIG1hdGgpIHtcbi8vXG4vLyBUaGUgZm9sbG93aW5nIGNvbnN0YW50cyBhcmUgcmVsYXRlZCB0byBJRUVFIDc1NCBsaW1pdHMuXG4vL1xudmFyIGdsb2JhbCA9IHRoaXMsXG4gICAgd2lkdGggPSAyNTYsICAgICAgICAvLyBlYWNoIFJDNCBvdXRwdXQgaXMgMCA8PSB4IDwgMjU2XG4gICAgY2h1bmtzID0gNiwgICAgICAgICAvLyBhdCBsZWFzdCBzaXggUkM0IG91dHB1dHMgZm9yIGVhY2ggZG91YmxlXG4gICAgZGlnaXRzID0gNTIsICAgICAgICAvLyB0aGVyZSBhcmUgNTIgc2lnbmlmaWNhbnQgZGlnaXRzIGluIGEgZG91YmxlXG4gICAgcm5nbmFtZSA9ICdyYW5kb20nLCAvLyBybmduYW1lOiBuYW1lIGZvciBNYXRoLnJhbmRvbSBhbmQgTWF0aC5zZWVkcmFuZG9tXG4gICAgc3RhcnRkZW5vbSA9IG1hdGgucG93KHdpZHRoLCBjaHVua3MpLFxuICAgIHNpZ25pZmljYW5jZSA9IG1hdGgucG93KDIsIGRpZ2l0cyksXG4gICAgb3ZlcmZsb3cgPSBzaWduaWZpY2FuY2UgKiAyLFxuICAgIG1hc2sgPSB3aWR0aCAtIDEsXG4gICAgbm9kZWNyeXB0bzsgICAgICAgICAvLyBub2RlLmpzIGNyeXB0byBtb2R1bGUsIGluaXRpYWxpemVkIGF0IHRoZSBib3R0b20uXG5cbi8vXG4vLyBzZWVkcmFuZG9tKClcbi8vIFRoaXMgaXMgdGhlIHNlZWRyYW5kb20gZnVuY3Rpb24gZGVzY3JpYmVkIGFib3ZlLlxuLy9cbmZ1bmN0aW9uIHNlZWRyYW5kb20oc2VlZCwgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgdmFyIGtleSA9IFtdO1xuICBvcHRpb25zID0gKG9wdGlvbnMgPT0gdHJ1ZSkgPyB7IGVudHJvcHk6IHRydWUgfSA6IChvcHRpb25zIHx8IHt9KTtcblxuICAvLyBGbGF0dGVuIHRoZSBzZWVkIHN0cmluZyBvciBidWlsZCBvbmUgZnJvbSBsb2NhbCBlbnRyb3B5IGlmIG5lZWRlZC5cbiAgdmFyIHNob3J0c2VlZCA9IG1peGtleShmbGF0dGVuKFxuICAgIG9wdGlvbnMuZW50cm9weSA/IFtzZWVkLCB0b3N0cmluZyhwb29sKV0gOlxuICAgIChzZWVkID09IG51bGwpID8gYXV0b3NlZWQoKSA6IHNlZWQsIDMpLCBrZXkpO1xuXG4gIC8vIFVzZSB0aGUgc2VlZCB0byBpbml0aWFsaXplIGFuIEFSQzQgZ2VuZXJhdG9yLlxuICB2YXIgYXJjNCA9IG5ldyBBUkM0KGtleSk7XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiByZXR1cm5zIGEgcmFuZG9tIGRvdWJsZSBpbiBbMCwgMSkgdGhhdCBjb250YWluc1xuICAvLyByYW5kb21uZXNzIGluIGV2ZXJ5IGJpdCBvZiB0aGUgbWFudGlzc2Egb2YgdGhlIElFRUUgNzU0IHZhbHVlLlxuICB2YXIgcHJuZyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBuID0gYXJjNC5nKGNodW5rcyksICAgICAgICAgICAgIC8vIFN0YXJ0IHdpdGggYSBudW1lcmF0b3IgbiA8IDIgXiA0OFxuICAgICAgICBkID0gc3RhcnRkZW5vbSwgICAgICAgICAgICAgICAgIC8vICAgYW5kIGRlbm9taW5hdG9yIGQgPSAyIF4gNDguXG4gICAgICAgIHggPSAwOyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gICBhbmQgbm8gJ2V4dHJhIGxhc3QgYnl0ZScuXG4gICAgd2hpbGUgKG4gPCBzaWduaWZpY2FuY2UpIHsgICAgICAgICAgLy8gRmlsbCB1cCBhbGwgc2lnbmlmaWNhbnQgZGlnaXRzIGJ5XG4gICAgICBuID0gKG4gKyB4KSAqIHdpZHRoOyAgICAgICAgICAgICAgLy8gICBzaGlmdGluZyBudW1lcmF0b3IgYW5kXG4gICAgICBkICo9IHdpZHRoOyAgICAgICAgICAgICAgICAgICAgICAgLy8gICBkZW5vbWluYXRvciBhbmQgZ2VuZXJhdGluZyBhXG4gICAgICB4ID0gYXJjNC5nKDEpOyAgICAgICAgICAgICAgICAgICAgLy8gICBuZXcgbGVhc3Qtc2lnbmlmaWNhbnQtYnl0ZS5cbiAgICB9XG4gICAgd2hpbGUgKG4gPj0gb3ZlcmZsb3cpIHsgICAgICAgICAgICAgLy8gVG8gYXZvaWQgcm91bmRpbmcgdXAsIGJlZm9yZSBhZGRpbmdcbiAgICAgIG4gLz0gMjsgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAgIGxhc3QgYnl0ZSwgc2hpZnQgZXZlcnl0aGluZ1xuICAgICAgZCAvPSAyOyAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgcmlnaHQgdXNpbmcgaW50ZWdlciBtYXRoIHVudGlsXG4gICAgICB4ID4+Pj0gMTsgICAgICAgICAgICAgICAgICAgICAgICAgLy8gICB3ZSBoYXZlIGV4YWN0bHkgdGhlIGRlc2lyZWQgYml0cy5cbiAgICB9XG4gICAgcmV0dXJuIChuICsgeCkgLyBkOyAgICAgICAgICAgICAgICAgLy8gRm9ybSB0aGUgbnVtYmVyIHdpdGhpbiBbMCwgMSkuXG4gIH07XG5cbiAgcHJuZy5pbnQzMiA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gYXJjNC5nKDQpIHwgMDsgfVxuICBwcm5nLnF1aWNrID0gZnVuY3Rpb24oKSB7IHJldHVybiBhcmM0LmcoNCkgLyAweDEwMDAwMDAwMDsgfVxuICBwcm5nLmRvdWJsZSA9IHBybmc7XG5cbiAgLy8gTWl4IHRoZSByYW5kb21uZXNzIGludG8gYWNjdW11bGF0ZWQgZW50cm9weS5cbiAgbWl4a2V5KHRvc3RyaW5nKGFyYzQuUyksIHBvb2wpO1xuXG4gIC8vIENhbGxpbmcgY29udmVudGlvbjogd2hhdCB0byByZXR1cm4gYXMgYSBmdW5jdGlvbiBvZiBwcm5nLCBzZWVkLCBpc19tYXRoLlxuICByZXR1cm4gKG9wdGlvbnMucGFzcyB8fCBjYWxsYmFjayB8fFxuICAgICAgZnVuY3Rpb24ocHJuZywgc2VlZCwgaXNfbWF0aF9jYWxsLCBzdGF0ZSkge1xuICAgICAgICBpZiAoc3RhdGUpIHtcbiAgICAgICAgICAvLyBMb2FkIHRoZSBhcmM0IHN0YXRlIGZyb20gdGhlIGdpdmVuIHN0YXRlIGlmIGl0IGhhcyBhbiBTIGFycmF5LlxuICAgICAgICAgIGlmIChzdGF0ZS5TKSB7IGNvcHkoc3RhdGUsIGFyYzQpOyB9XG4gICAgICAgICAgLy8gT25seSBwcm92aWRlIHRoZSAuc3RhdGUgbWV0aG9kIGlmIHJlcXVlc3RlZCB2aWEgb3B0aW9ucy5zdGF0ZS5cbiAgICAgICAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KGFyYzQsIHt9KTsgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgY2FsbGVkIGFzIGEgbWV0aG9kIG9mIE1hdGggKE1hdGguc2VlZHJhbmRvbSgpKSwgbXV0YXRlXG4gICAgICAgIC8vIE1hdGgucmFuZG9tIGJlY2F1c2UgdGhhdCBpcyBob3cgc2VlZHJhbmRvbS5qcyBoYXMgd29ya2VkIHNpbmNlIHYxLjAuXG4gICAgICAgIGlmIChpc19tYXRoX2NhbGwpIHsgbWF0aFtybmduYW1lXSA9IHBybmc7IHJldHVybiBzZWVkOyB9XG5cbiAgICAgICAgLy8gT3RoZXJ3aXNlLCBpdCBpcyBhIG5ld2VyIGNhbGxpbmcgY29udmVudGlvbiwgc28gcmV0dXJuIHRoZVxuICAgICAgICAvLyBwcm5nIGRpcmVjdGx5LlxuICAgICAgICBlbHNlIHJldHVybiBwcm5nO1xuICAgICAgfSkoXG4gIHBybmcsXG4gIHNob3J0c2VlZCxcbiAgJ2dsb2JhbCcgaW4gb3B0aW9ucyA/IG9wdGlvbnMuZ2xvYmFsIDogKHRoaXMgPT0gbWF0aCksXG4gIG9wdGlvbnMuc3RhdGUpO1xufVxubWF0aFsnc2VlZCcgKyBybmduYW1lXSA9IHNlZWRyYW5kb207XG5cbi8vXG4vLyBBUkM0XG4vL1xuLy8gQW4gQVJDNCBpbXBsZW1lbnRhdGlvbi4gIFRoZSBjb25zdHJ1Y3RvciB0YWtlcyBhIGtleSBpbiB0aGUgZm9ybSBvZlxuLy8gYW4gYXJyYXkgb2YgYXQgbW9zdCAod2lkdGgpIGludGVnZXJzIHRoYXQgc2hvdWxkIGJlIDAgPD0geCA8ICh3aWR0aCkuXG4vL1xuLy8gVGhlIGcoY291bnQpIG1ldGhvZCByZXR1cm5zIGEgcHNldWRvcmFuZG9tIGludGVnZXIgdGhhdCBjb25jYXRlbmF0ZXNcbi8vIHRoZSBuZXh0IChjb3VudCkgb3V0cHV0cyBmcm9tIEFSQzQuICBJdHMgcmV0dXJuIHZhbHVlIGlzIGEgbnVtYmVyIHhcbi8vIHRoYXQgaXMgaW4gdGhlIHJhbmdlIDAgPD0geCA8ICh3aWR0aCBeIGNvdW50KS5cbi8vXG5mdW5jdGlvbiBBUkM0KGtleSkge1xuICB2YXIgdCwga2V5bGVuID0ga2V5Lmxlbmd0aCxcbiAgICAgIG1lID0gdGhpcywgaSA9IDAsIGogPSBtZS5pID0gbWUuaiA9IDAsIHMgPSBtZS5TID0gW107XG5cbiAgLy8gVGhlIGVtcHR5IGtleSBbXSBpcyB0cmVhdGVkIGFzIFswXS5cbiAgaWYgKCFrZXlsZW4pIHsga2V5ID0gW2tleWxlbisrXTsgfVxuXG4gIC8vIFNldCB1cCBTIHVzaW5nIHRoZSBzdGFuZGFyZCBrZXkgc2NoZWR1bGluZyBhbGdvcml0aG0uXG4gIHdoaWxlIChpIDwgd2lkdGgpIHtcbiAgICBzW2ldID0gaSsrO1xuICB9XG4gIGZvciAoaSA9IDA7IGkgPCB3aWR0aDsgaSsrKSB7XG4gICAgc1tpXSA9IHNbaiA9IG1hc2sgJiAoaiArIGtleVtpICUga2V5bGVuXSArICh0ID0gc1tpXSkpXTtcbiAgICBzW2pdID0gdDtcbiAgfVxuXG4gIC8vIFRoZSBcImdcIiBtZXRob2QgcmV0dXJucyB0aGUgbmV4dCAoY291bnQpIG91dHB1dHMgYXMgb25lIG51bWJlci5cbiAgKG1lLmcgPSBmdW5jdGlvbihjb3VudCkge1xuICAgIC8vIFVzaW5nIGluc3RhbmNlIG1lbWJlcnMgaW5zdGVhZCBvZiBjbG9zdXJlIHN0YXRlIG5lYXJseSBkb3VibGVzIHNwZWVkLlxuICAgIHZhciB0LCByID0gMCxcbiAgICAgICAgaSA9IG1lLmksIGogPSBtZS5qLCBzID0gbWUuUztcbiAgICB3aGlsZSAoY291bnQtLSkge1xuICAgICAgdCA9IHNbaSA9IG1hc2sgJiAoaSArIDEpXTtcbiAgICAgIHIgPSByICogd2lkdGggKyBzW21hc2sgJiAoKHNbaV0gPSBzW2ogPSBtYXNrICYgKGogKyB0KV0pICsgKHNbal0gPSB0KSldO1xuICAgIH1cbiAgICBtZS5pID0gaTsgbWUuaiA9IGo7XG4gICAgcmV0dXJuIHI7XG4gICAgLy8gRm9yIHJvYnVzdCB1bnByZWRpY3RhYmlsaXR5LCB0aGUgZnVuY3Rpb24gY2FsbCBiZWxvdyBhdXRvbWF0aWNhbGx5XG4gICAgLy8gZGlzY2FyZHMgYW4gaW5pdGlhbCBiYXRjaCBvZiB2YWx1ZXMuICBUaGlzIGlzIGNhbGxlZCBSQzQtZHJvcFsyNTZdLlxuICAgIC8vIFNlZSBodHRwOi8vZ29vZ2xlLmNvbS9zZWFyY2g/cT1yc2ErZmx1aHJlcityZXNwb25zZSZidG5JXG4gIH0pKHdpZHRoKTtcbn1cblxuLy9cbi8vIGNvcHkoKVxuLy8gQ29waWVzIGludGVybmFsIHN0YXRlIG9mIEFSQzQgdG8gb3IgZnJvbSBhIHBsYWluIG9iamVjdC5cbi8vXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC5pID0gZi5pO1xuICB0LmogPSBmLmo7XG4gIHQuUyA9IGYuUy5zbGljZSgpO1xuICByZXR1cm4gdDtcbn07XG5cbi8vXG4vLyBmbGF0dGVuKClcbi8vIENvbnZlcnRzIGFuIG9iamVjdCB0cmVlIHRvIG5lc3RlZCBhcnJheXMgb2Ygc3RyaW5ncy5cbi8vXG5mdW5jdGlvbiBmbGF0dGVuKG9iaiwgZGVwdGgpIHtcbiAgdmFyIHJlc3VsdCA9IFtdLCB0eXAgPSAodHlwZW9mIG9iaiksIHByb3A7XG4gIGlmIChkZXB0aCAmJiB0eXAgPT0gJ29iamVjdCcpIHtcbiAgICBmb3IgKHByb3AgaW4gb2JqKSB7XG4gICAgICB0cnkgeyByZXN1bHQucHVzaChmbGF0dGVuKG9ialtwcm9wXSwgZGVwdGggLSAxKSk7IH0gY2F0Y2ggKGUpIHt9XG4gICAgfVxuICB9XG4gIHJldHVybiAocmVzdWx0Lmxlbmd0aCA/IHJlc3VsdCA6IHR5cCA9PSAnc3RyaW5nJyA/IG9iaiA6IG9iaiArICdcXDAnKTtcbn1cblxuLy9cbi8vIG1peGtleSgpXG4vLyBNaXhlcyBhIHN0cmluZyBzZWVkIGludG8gYSBrZXkgdGhhdCBpcyBhbiBhcnJheSBvZiBpbnRlZ2VycywgYW5kXG4vLyByZXR1cm5zIGEgc2hvcnRlbmVkIHN0cmluZyBzZWVkIHRoYXQgaXMgZXF1aXZhbGVudCB0byB0aGUgcmVzdWx0IGtleS5cbi8vXG5mdW5jdGlvbiBtaXhrZXkoc2VlZCwga2V5KSB7XG4gIHZhciBzdHJpbmdzZWVkID0gc2VlZCArICcnLCBzbWVhciwgaiA9IDA7XG4gIHdoaWxlIChqIDwgc3RyaW5nc2VlZC5sZW5ndGgpIHtcbiAgICBrZXlbbWFzayAmIGpdID1cbiAgICAgIG1hc2sgJiAoKHNtZWFyIF49IGtleVttYXNrICYgal0gKiAxOSkgKyBzdHJpbmdzZWVkLmNoYXJDb2RlQXQoaisrKSk7XG4gIH1cbiAgcmV0dXJuIHRvc3RyaW5nKGtleSk7XG59XG5cbi8vXG4vLyBhdXRvc2VlZCgpXG4vLyBSZXR1cm5zIGFuIG9iamVjdCBmb3IgYXV0b3NlZWRpbmcsIHVzaW5nIHdpbmRvdy5jcnlwdG8gYW5kIE5vZGUgY3J5cHRvXG4vLyBtb2R1bGUgaWYgYXZhaWxhYmxlLlxuLy9cbmZ1bmN0aW9uIGF1dG9zZWVkKCkge1xuICB0cnkge1xuICAgIHZhciBvdXQ7XG4gICAgaWYgKG5vZGVjcnlwdG8gJiYgKG91dCA9IG5vZGVjcnlwdG8ucmFuZG9tQnl0ZXMpKSB7XG4gICAgICAvLyBUaGUgdXNlIG9mICdvdXQnIHRvIHJlbWVtYmVyIHJhbmRvbUJ5dGVzIG1ha2VzIHRpZ2h0IG1pbmlmaWVkIGNvZGUuXG4gICAgICBvdXQgPSBvdXQod2lkdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvdXQgPSBuZXcgVWludDhBcnJheSh3aWR0aCk7XG4gICAgICAoZ2xvYmFsLmNyeXB0byB8fCBnbG9iYWwubXNDcnlwdG8pLmdldFJhbmRvbVZhbHVlcyhvdXQpO1xuICAgIH1cbiAgICByZXR1cm4gdG9zdHJpbmcob3V0KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHZhciBicm93c2VyID0gZ2xvYmFsLm5hdmlnYXRvcixcbiAgICAgICAgcGx1Z2lucyA9IGJyb3dzZXIgJiYgYnJvd3Nlci5wbHVnaW5zO1xuICAgIHJldHVybiBbK25ldyBEYXRlLCBnbG9iYWwsIHBsdWdpbnMsIGdsb2JhbC5zY3JlZW4sIHRvc3RyaW5nKHBvb2wpXTtcbiAgfVxufVxuXG4vL1xuLy8gdG9zdHJpbmcoKVxuLy8gQ29udmVydHMgYW4gYXJyYXkgb2YgY2hhcmNvZGVzIHRvIGEgc3RyaW5nXG4vL1xuZnVuY3Rpb24gdG9zdHJpbmcoYSkge1xuICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseSgwLCBhKTtcbn1cblxuLy9cbi8vIFdoZW4gc2VlZHJhbmRvbS5qcyBpcyBsb2FkZWQsIHdlIGltbWVkaWF0ZWx5IG1peCBhIGZldyBiaXRzXG4vLyBmcm9tIHRoZSBidWlsdC1pbiBSTkcgaW50byB0aGUgZW50cm9weSBwb29sLiAgQmVjYXVzZSB3ZSBkb1xuLy8gbm90IHdhbnQgdG8gaW50ZXJmZXJlIHdpdGggZGV0ZXJtaW5pc3RpYyBQUk5HIHN0YXRlIGxhdGVyLFxuLy8gc2VlZHJhbmRvbSB3aWxsIG5vdCBjYWxsIG1hdGgucmFuZG9tIG9uIGl0cyBvd24gYWdhaW4gYWZ0ZXJcbi8vIGluaXRpYWxpemF0aW9uLlxuLy9cbm1peGtleShtYXRoLnJhbmRvbSgpLCBwb29sKTtcblxuLy9cbi8vIE5vZGVqcyBhbmQgQU1EIHN1cHBvcnQ6IGV4cG9ydCB0aGUgaW1wbGVtZW50YXRpb24gYXMgYSBtb2R1bGUgdXNpbmdcbi8vIGVpdGhlciBjb252ZW50aW9uLlxuLy9cbmlmICgodHlwZW9mIG1vZHVsZSkgPT0gJ29iamVjdCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBzZWVkcmFuZG9tO1xuICAvLyBXaGVuIGluIG5vZGUuanMsIHRyeSB1c2luZyBjcnlwdG8gcGFja2FnZSBmb3IgYXV0b3NlZWRpbmcuXG4gIHRyeSB7XG4gICAgbm9kZWNyeXB0byA9IHJlcXVpcmUoJ2NyeXB0bycpO1xuICB9IGNhdGNoIChleCkge31cbn0gZWxzZSBpZiAoKHR5cGVvZiBkZWZpbmUpID09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBzZWVkcmFuZG9tOyB9KTtcbn1cblxuLy8gRW5kIGFub255bW91cyBzY29wZSwgYW5kIHBhc3MgaW5pdGlhbCB2YWx1ZXMuXG59KShcbiAgW10sICAgICAvLyBwb29sOiBlbnRyb3B5IHBvb2wgc3RhcnRzIGVtcHR5XG4gIE1hdGggICAgLy8gbWF0aDogcGFja2FnZSBjb250YWluaW5nIHJhbmRvbSwgcG93LCBhbmQgc2VlZHJhbmRvbVxuKTtcbiIsIi8qKlxuICogVGhpcyBtb2R1bGUgaXMgdXNlZCB0byBjcmVhdGUgZGlmZmVyZW50IHBvaW50IGRpc3RyaWJ1dGlvbnMgdGhhdCBjYW4gYmVcbiAqIHR1cm5lZCBpbnRvIGRpZmZlcmVudCB0aWxlIHNldHMgd2hlbiBtYWRlIGludG8gYSBncmFwaCBmb3JtYXQuIFRoZXJlIGFyZVxuICogdmFyaW91cyBkaWZmZXJlbnQgZGlzdHJpYnV0aW9ucyB0aGF0IGNhbiBiZSB1c2VkIHRvIGNyZWF0ZSBpbnRlcmVzdGluZ1xuICogdGlsZSBwYXR0ZXJucyB3aGVuIHR1cm5lZCBpbnRvIGEgdm9yb25vaSBkaWFncmFtLiBcbiAqIFxuICogQGNsYXNzIFBvaW50RGlzdHJpYnV0aW9uXG4gKi9cblxuXCJ1c2Ugc3RyaWN0XCI7XG5cbmltcG9ydCBQb2lzc29uIGZyb20gXCJwb2lzc29uLWRpc2stc2FtcGxlXCI7XG5pbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcbmltcG9ydCBSZWN0YW5nbGUgZnJvbSBcIi4uL2dlb21ldHJ5L1JlY3RhbmdsZVwiO1xuaW1wb3J0IFJhbmQgZnJvbSBcIi4vUmFuZFwiO1xuXG4vKipcbiAqIENyZWF0ZXMgYSByYW5kb20gZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXIgYm91bmRpbmcgYm94XG4gKiB3aXRoIGEgcGFydGljdWxhciBhdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXG4gKiBAcGFyYW0ge251bWJlcn0gW3NlZWQ9bnVsbF0gSWYgc3BlY2lmaWVkIHVzZSBhIGxvY2FsIHNlZWQgZm9yIGNyZWF0aW5nIHRoZSBwb2ludFxuICogIGRpc3RyaWJ1dGlvbi4gT3RoZXJ3aXNlLCB1c2UgdGhlIGN1cnJlbnQgZ2xvYmFsIHNlZWQgZm9yIGdlbmVyYXRpb25cbiAqIEByZXR1cm5zIHtWZWN0b3JbXX0gVGhlIGxpc3Qgb2YgcmFuZG9tbHkgZGlzdHJpYnV0ZWQgcG9pbnRzXG4gKiBAbWVtYmVyb2YgUG9pbnREaXN0cmlidXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJhbmRvbShiYm94LCBkLCBzZWVkID0gbnVsbCkge1xuICAgIGNvbnN0IHJuZyA9IHNlZWQgPyBuZXcgUmFuZChzZWVkKSA6IFJhbmQ7XG4gICAgY29uc3QgblBvaW50cyA9IGJib3guYXJlYSAvIChkICogZCk7XG5cbiAgICBsZXQgcG9pbnRzID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuUG9pbnRzOyBpKyspIHtcbiAgICAgICAgcG9pbnRzLnB1c2gocm5nLnZlY3RvcihiYm94KSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHBvaW50cztcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgc3F1YXJlIGdyaWQgbGlrZSBkaXN0cmlidXRpb24gb2YgcG9pbnRzIGluIGEgcGFydGljdWxhciBib3VuZGluZ1xuICogYm94IHdpdGggYSBwYXJ0aWN1bGFyIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcXVhcmUoYmJveCwgZCkge1xuICAgIGNvbnN0IGR4ID0gZCAvIDI7XG4gICAgY29uc3QgZHkgPSBkeDtcbiAgICBsZXQgcG9pbnRzID0gW107XG5cbiAgICBmb3IgKGxldCB5ID0gMDsgeSA8IGJib3guaGVpZ2h0OyB5ICs9IGQpIHtcbiAgICAgICAgZm9yIChsZXQgeCA9IDA7IHggPCBiYm94LndpZHRoOyB4ICs9IGQpIHtcbiAgICAgICAgICAgIHBvaW50cy5wdXNoKG5ldyBWZWN0b3IoZHggKyB4LCBkeSArIHkpKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwb2ludHM7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIHVuaWZvcm0gaGV4YWdvbmFsIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMgaW4gYSBwYXJ0aWN1bGFyIGJvdW5kaW5nXG4gKiBib3ggd2l0aCBhIHBhcnRpY3VsYXIgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuIFRoZSBoZXhhZ29ucyBjYW4gYWxzbyBiZVxuICogc3BlY2lmaWVkIHRvIGhhdmUgYSBwYXJ0aWN1bGFyIHdpZHRoIG9yIGhlaWdodCBhcyB3ZWxsIGFzIGNyZWF0aW5nIGhleGFnb25zXG4gKiB0aGF0IGhhdmUgXCJwb2ludHlcIiB0b3BzIG9yIFwiZmxhdFwiIHRvcHMuIEJ5IGRlZmF1bHQgaXQgbWFrZXMgZmxhdCB0b3BzLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtmbGF0VG9wPXRydWVdIENyZWF0ZSBoZWNhZ29ucyB3aXRoIGZsYXQgdG9wcyBieSBkZWZhdWx0LlxuICogIE90aGVyd2lzZSBnbyB3aXRoIHRoZSBwb2ludHkgdG9wIGhleGFnb25zLlxuICogQHBhcmFtIHtudW1iZXJ9IHcgVGhlIHdpZHRoIG9mIHRoZSBoZXhhZ29uIHRpbGVzXG4gKiBAcGFyYW0ge251bWJlcn0gaCBUaGUgaGVpZ2h0IG9mIHRoZSBoZXhhZ29uIHRpbGVzXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoZXhhZ29uKGJib3gsIGQsIGZsYXRUb3AgPSB0cnVlLCB3LCBoKSB7XG4gICAgLy8gTmVlZCB0byBhbGxvdyBmb3IgdGhlIGNoYW5nZSBvZiBoZWlnaHQgYW5kIHdpZHRoXG4gICAgLy8gUnVubmluZyBpbnRvIFwiVW5jYXVnaHQgVm9yb25vaS5jbG9zZUNlbGxzKCkgPiB0aGlzIG1ha2VzIG5vIHNlbnNlIVwiXG5cbiAgICBjb25zdCBkeCA9IGQgLyAyO1xuICAgIGNvbnN0IGR5ID0gZHg7XG4gICAgbGV0IHBvaW50cyA9IFtdO1xuICAgIGNvbnN0IGFsdGl0dWRlID0gTWF0aC5zcXJ0KDMpIC8gMiAqIGQ7XG4gICAgdmFyIE4gPSBNYXRoLnNxcnQoYmJveC5hcmVhIC8gKGQgKiBkKSk7XG4gICAgZm9yIChsZXQgeSA9IDA7IHkgPCBOOyB5KyspIHtcbiAgICAgICAgZm9yIChsZXQgeCA9IDA7IHggPCBOOyB4KyspIHtcbiAgICAgICAgICAgIHBvaW50cy5wdXNoKG5ldyBWZWN0b3IoKDAuNSArIHgpIC8gTiAqIGJib3gud2lkdGgsXG4gICAgICAgICAgICAgICAgKDAuMjUgKyAwLjUgKiB4ICUgMiArIHkpIC8gTiAqIGJib3guaGVpZ2h0KSk7XG4gICAgICAgICAgICAvLyBwb2ludHMucHVzaChuZXcgVmVjdG9yKCh5ICUgMikgKiBkeCArIHggKiBkICsgZHgsIHkgKiBkICsgZHkpKTsgLy8gUG9pbnR5IFRvcFxuICAgICAgICAgICAgLy8gcG9pbnRzLnB1c2gobmV3IFZlY3Rvcih4ICogZCwgKHggJSAyKSAqIGR4ICsgeSAqIGQpKTsgLy8gRmxhdCBUb3BcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwb2ludHM7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIGJsdWUgbm9pc2UgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXIgYm91bmRpbmcgYm94XG4gKiB3aXRoIGEgcGFydGljdWxhciBhdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLiBUaGlzIGlzIGRvbmUgYnlcbiAqIGNyZWF0aW5nIGEgZ3JpZCBzeXN0ZW0gYW5kIHBpY2tpbmcgYSByYW5kb20gcG9pbnQgaW4gZWFjaCBncmlkLiBUaGlzIGhhc1xuICogdGhlIGVmZmVjdCBvZiBjcmVhdGluZyBhIGxlc3MgcmFuZG9tIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMuIFRoZSBzZWNvbmRcbiAqIHBhcmFtZXRlciBtIGRldGVybWlucyB0aGUgc3BhY2luZyBiZXR3ZWVuIHBvaW50cyBpbiB0aGUgZ3JpZC4gVGhpcyBlbnN1cmVzXG4gKiB0aGF0IG5vIHR3byBwb2ludHMgYXJlIGluIHRoZSBzYW1lIGdyaWQuXG4gKiBcbiAqIEBzdW1tYXJ5IENyZWF0ZSBhIGppdHRlcmVkIGdyaWQgYmFzZWQgcmFuZG9tIGJsdWUgbm9pc2UgcG9pbnQgZGlzdHJpYnV0aW9uLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXG4gKiBAcGFyYW0ge251bWJlcn0gW3NlZWQ9bnVsbF0gSWYgc3BlY2lmaWVkIHVzZSBhIGxvY2FsIHNlZWQgZm9yIGNyZWF0aW5nIHRoZSBwb2ludFxuICogIGRpc3RyaWJ1dGlvbi4gT3RoZXJ3aXNlLCB1c2UgdGhlIGN1cnJlbnQgZ2xvYmFsIHNlZWQgZm9yIGdlbmVyYXRpb25cbiAqIEBwYXJhbSB7bnVtYmVyfSBbbT0wXSBNYXhpbXVtIGRpc3RhbmNlIGF3YXkgZnJvbSB0aGUgZWRnZSBvZiB0aGUgZ3JpZCB0aGF0IGFcbiAqICBwb2ludCBjYW4gYmUgcGxhY2VkLiBUaGlzIGFjdHMgdG8gaW5jcmVhc2UgdGhlIHBhZGRpbmcgYmV0d2VlbiBwb2ludHMuIFxuICogIFRoaXMgbWFrZXMgdGhlIG5vaXNlIGxlc3MgcmFuZG9tLiBUaGlzIG51bWJlciBtdXN0IGJlIHNtYWxsZXIgdGhhbiBkLlxuICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgbGlzdCBvZiByYW5kb21seSBkaXN0cmlidXRlZCBwb2ludHNcbiAqIEBtZW1iZXJvZiBQb2ludERpc3RyaWJ1dGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gaml0dGVyZWRHcmlkKGJib3gsIGQsIHNlZWQgPSBudWxsLCBtID0gMCkge1xuICAgIGNvbnN0IHJuZyA9IHNlZWQgPyBuZXcgUmFuZChzZWVkKSA6IFJhbmQ7XG5cbiAgICBsZXQgcG9pbnRzID0gW107XG4gICAgbGV0IHBvaW50Qm94O1xuICAgIGZvciAobGV0IHkgPSAwOyB5IDwgYmJveC5oZWlnaHQgLSBkOyB5ICs9IGQpIHtcbiAgICAgICAgZm9yIChsZXQgeCA9IDA7IHggPCBiYm94LndpZHRoIC0gZDsgeCArPSBkKSB7XG4gICAgICAgICAgICAvLyBMb2NhbCBiYm94IGZvciB0aGUgcG9pbnQgdG8gZ2VuZXJhdGUgaW5cbiAgICAgICAgICAgIGNvbnN0IGJveFBvcyA9IG5ldyBWZWN0b3IoeCAtIGQgKyBtLCB5IC0gZCArIG0pO1xuICAgICAgICAgICAgcG9pbnRCb3ggPSBuZXcgUmVjdGFuZ2xlKGJveFBvcywgeCAtIG0sIHkgLSBtKTtcbiAgICAgICAgICAgIHBvaW50cy5wdXNoKHJuZy52ZWN0b3IocG9pbnRCb3gpKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwb2ludHM7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIHBvaXNzb24sIG9yIGJsdWUgbm9pc2UgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXJcbiAqIGJvdW5kaW5nIGJveCB3aXRoIGEgcGFydGljdWxhciBhdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLiBUaGlzIGlzXG4gKiBkb25lIGJ5IHVzaW5nIHBvaXNzb24gZGlzayBzYW1wbGluZyB3aGljaCB0cmllcyB0byBjcmVhdGUgcG9pbnRzIHNvIHRoYXQgdGhlXG4gKiBkaXN0YW5jZSBiZXR3ZWVuIG5laWdoYm9ycyBpcyBhcyBjbG9zZSB0byBhIGZpeGVkIG51bWJlciAodGhlIGRpc3RhbmNlIGQpXG4gKiBhcyBwb3NzaWJsZS4gVGhpcyBhbGdvcml0aG0gaXMgaW1wbGVtZW50ZWQgdXNpbmcgdGhlIHBvaXNzb24gZGFydCB0aHJvd2luZ1xuICogYWxnb3JpdGhtLlxuICogIFxuICogQHN1bW1hcnkgQ3JlYXRlIGEgYmx1ZSBub2lzZSBkaXN0cmlidXRpb24gb2YgcG9pbnRzIHVzaW5nIHBvaXNzb24gZGlza1xuICogIHNhbXBsaW5nLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xuICogXG4gKiBAc2VlIHtAbGluayBodHRwczovL3d3dy5qYXNvbmRhdmllcy5jb20vcG9pc3Nvbi1kaXNjL31cbiAqIEBzZWUge0BsaW5rIGh0dHBzOi8vZ2l0aHViLmNvbS9qZWZmcmV5LWhlYXJuL3BvaXNzb24tZGlzay1zYW1wbGV9XG4gKiBAbWVtYmVyb2YgUG9pbnREaXN0cmlidXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBvaXNzb24oYmJveCwgZCkge1xuICAgIHZhciBzYW1wbGVyID0gbmV3IFBvaXNzb24oYmJveC53aWR0aCwgYmJveC5oZWlnaHQsIGQsIGQpO1xuICAgIHZhciBzb2x1dGlvbiA9IHNhbXBsZXIuc2FtcGxlVW50aWxTb2x1dGlvbigpO1xuICAgIHZhciBwb2ludHMgPSBzb2x1dGlvbi5tYXAocG9pbnQgPT4gbmV3IFZlY3Rvcihwb2ludCkpO1xuXG4gICAgcmV0dXJuIHBvaW50cztcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgYmx1ZSBub2lzZSBkaXN0cmlidXRpb24gb2YgcG9pbnRzIGluIGEgcGFydGljdWxhciBib3VuZGluZyBib3hcbiAqIHdpdGggYSBwYXJ0aWN1bGFyIGF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuIFRoaXMgaXMgZG9uZSBieSB1c2luZ1xuICogcmVjdXJzaXZlIHdhbmcgdGlsZXMgdG8gY3JlYXRlIHRoaXMgZGlzdHJpYnV0aW9uIG9mIHBvaW50cy5cbiAqIFxuICogQHN1bW1hcnkgTm90IEltcGxlbWVudGVkIFlldFxuICogXG4gKiBAZXhwb3J0XG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWN1cnNpdmVXYW5nKGJib3gsIGQpIHtcbiAgICB0aHJvdyBcIkVycm9yOiBOb3QgSW1wbGVtZW50ZWRcIjtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgY2lyY3VsYXIgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXIgYm91bmRpbmcgYm94XG4gKiB3aXRoIGEgcGFydGljdWxhciBhdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLlxuICogXG4gKiBAc3VtbWFyeSBOb3QgSW1wbGVtZW50ZWQgWWV0XG4gKiBcbiAqIEBleHBvcnRcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcbiAqIEByZXR1cm5zIHtWZWN0b3JbXX0gVGhlIGxpc3Qgb2YgcmFuZG9tbHkgZGlzdHJpYnV0ZWQgcG9pbnRzXG4gKiBAbWVtYmVyb2YgUG9pbnREaXN0cmlidXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNpcmN1bGFyKGJib3gsIGQpIHtcbiAgICB0aHJvdyBcIkVycm9yOiBOb3QgSW1wbGVtZW50ZWRcIjtcbn0iLCJcInVzZSBzdHJpY3RcIjtcblxuaW1wb3J0IHNlZWRSYW5kb20gZnJvbSBcInNlZWRSYW5kb21cIjtcbmltcG9ydCBWZWN0b3IgZnJvbSBcIi4uL2dlb21ldHJ5L1ZlY3RvclwiO1xuXG5jbGFzcyBSYW5kIHtcbiAgICAvKipcbiAgICAgKiBXcmFwcGVyIGxpYnJhcnkgZm9yIERhdmlkIEJhdSdzIHNlZWRlZCByYW5kb20gbnVtYmVyIGdlbmVyYXRvciB3aGljaCBpcyBhXG4gICAgICogd3JhcHBlciBmb3IgdGhlIE1hdGgucmFuZCgpIGZ1bmN0aW9uYWxpdHkuIFRoaXMgbGlicmFyeSBpcyBpbXBsZW1lbnRlZCB0b1xuICAgICAqIGZpbGwgb3V0IHRoZSBmdW5jdGlvbmFsaXR5IG9mIHRoZSByYW5kb20gY2FwYWJpbGl0aWVzIGFzIHdlbGwgYXMgYnVpbGRcbiAgICAgKiBvbiB0aGUgY2FwYWJpbGl0aWVzIGV4aXN0aW5nIGluIHRoZSBmcmFtZXdvcmsgY3VycmVudGx5LiBUaGlzIGNsYXNzIGNhblxuICAgICAqIGJlIHVzZWQgb24gYSBnbG9iYWwgb3IgbG9jYWwgc2NhbGUuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBSYW5kLnNlZWRSYW5kb20oMCk7ICAgICAgLy8gU2V0IHRoZSBnbG9iYWwgc2VlZFxuICAgICAqIFJhbmQucmFuZCgpOyAgICAgICAgICAgICAvLyBQcmVkaWN0YWJsZSBiYXNlZCBvZmYgc2VlZFxuICAgICAqIFxuICAgICAqIEBleGFtcGxlIFxuICAgICAqIHZhciBybmcgPSBuZXcgUmFuZCgwKTsgICAvLyBTZXQgdGhlIGxvY2FsIHJuZyBzZWVkXG4gICAgICogcm5nLnJhbmQoKTsgICAgICAgICAgICAgIC8vIFByZWRpY3RhYmxlIGJhc2VkIG9mZiBzZWVkXG4gICAgICogXG4gICAgICogUmFuZC5yYW5kKCk7ICAgICAgICAgICAgIC8vIFVucHJlZGljdGFibGUgc2luY2UgZ2xvYmFsIHNlZWQgaXMgbm90IHNldFxuICAgICAqIFxuICAgICAqIEBzZWUge0BsaW5rIGh0dHBzOi8vZ2l0aHViLmNvbS9kYXZpZGJhdS9zZWVkcmFuZG9tfVxuICAgICAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gW3NlZWQ9MF0gVGhlIHNlZWQgdG8gYmUgYXBwbGllZCB0byB0aGUgbG9jYWxcbiAgICAgKiAgcmFuZG9tIG51bWJlciBnZW5lcmF0b3JcbiAgICAgKiBAY2xhc3MgUmFuZFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHNlZWQgPSAwKSB7XG4gICAgICAgIHRoaXMucm5nID0gc2VlZFJhbmRvbShzZWVkKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXQgdGhlIGdsb2JhbCBzZWVkIGZvciB0aGUgc2VlZGVkIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9yLiBBZnRlciB0aGUgc2VlZCBoYXMgYmVlblxuICAgICAqIHNldC4gVGhlIHJhbmRvbSBudW1iZXJzIHdpbGwgYmUgcHJlZGljdGFibGUgYW5kIHJlcGVhdGFibGUgZ2l2ZW4gdGhlIHNhbWVcbiAgICAgKiBpbnB1dCBzZWVkLiBJZiBubyBzZWVkIGlzIHNwZWNpZmllZCwgdGhlbiBhIHJhbmRvbSBzZWVkIHdpbGwgYmUgYXNzaWduZWQgdG9cbiAgICAgKiB0aGUgcmFuZG9tIG51bWJlciBnZW5lcmF0b3IgdXNpbmcgYWRkZWQgc3lzdGVtIGVudHJvcHkuXG4gICAgICogXG4gICAgICogQGV4cG9ydFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gW3NlZWQ9MF0gVGhlIHNlZWQgdG8gYmUgYXBwbGllZCB0byB0aGUgZ2xvYmFsXG4gICAgICogIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9yXG4gICAgICogQG1lbWJlcm9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgc2V0U2VlZChzZWVkID0gMCkge1xuICAgICAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgICAgICAgZ2xvYmFsOiB0cnVlLFxuICAgICAgICAgICAgZW50cm9weTogc2VlZCA9PT0gdW5kZWZpbmVkXG4gICAgICAgIH07XG4gICAgICAgIHNlZWRSYW5kb20oc2VlZCwgb3B0aW9ucyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0IHRoZSBzZWVkIGZvciB0aGUgc2VlZGVkIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9yLiBBZnRlciB0aGUgc2VlZCBoYXMgYmVlblxuICAgICAqIHNldC4gVGhlIHJhbmRvbSBudW1iZXJzIHdpbGwgYmUgcHJlZGljdGFibGUgYW5kIHJlcGVhdGFibGUgZ2l2ZW4gdGhlIHNhbWVcbiAgICAgKiBpbnB1dCBzZWVkLiBJZiBubyBzZWVkIGlzIHNwZWNpZmllZCwgdGhlbiBhIHJhbmRvbSBzZWVkIHdpbGwgYmUgYXNzaWduZWQgdG9cbiAgICAgKiB0aGUgcmFuZG9tIG51bWJlciBnZW5lcmF0b3IgdXNpbmcgYWRkZWQgc3lzdGVtIGVudHJvcHkuXG4gICAgICogXG4gICAgICogQGV4cG9ydFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gW3NlZWQ9MF0gVGhlIHNlZWQgdG8gYmUgYXBwbGllZCB0byB0aGUgUk5HXG4gICAgICogXG4gICAgICogQG1lbWJlcm9mIFJhbmRcbiAgICAgKi9cbiAgICBzZXRTZWVkKHNlZWQpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgIGVudHJvcHk6IHNlZWQgPT09IHVuZGVmaW5lZFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnJuZyA9IHNlZWRSYW5kb20oc2VlZCwgb3B0aW9ucyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGEgcmFuZG9tIG51bWJlciBmcm9tIDAgdG8gMS4gXG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IHJhbmRvbSBudW1iZXIgZnJvbSAwIHRvIDFcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyb2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyByYW5kKCkge1xuICAgICAgICByZXR1cm4gTWF0aC5yYW5kb20oKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gbnVtYmVyIGZyb20gMCB0byAxLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IHJhbmRvbSBudW1iZXIgZnJvbSAwIHRvIDFcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyb2YgUmFuZFxuICAgICAqL1xuICAgIHJhbmQoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJuZygpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByaXZhdGUgaGVscGVyIGZ1bmN0aW9uOlxuICAgICAqIFxuICAgICAqIFJvbGwgZm9yIGEgYm9vbGVhbiB2YWx1ZSB0aGF0IGlzIHRydWUgQHBlcmNlbnQgYW1tb3VudCBvZiB0aGUgdGltZS5cbiAgICAgKiBJZiB0aGUgcm9sbCBmYWlscyB0aGVuIHJldHVybiBmYWxzZS4gRm9yIGV4YW1wbGUgY2FsbGluZyBjaGFuY2UoMC4zKVxuICAgICAqIHdpbGwgcmV0dXJuIHRydWUgMzAlIG9mIHRoZSB0aW1lLiBUaGUgaW5wdXQgcmFuZ2VcbiAgICAgKiBcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gcGVyY2VudCBQZXJjZW50IGNoYW5jZSB0byBnZXQgVHJ1ZS4gVmFsdWUgaXMgaW4gdGhlIHJhbmdlXG4gICAgICogIGZyb20gMCAtIDEuIFdpdGggMSByZXR1cm5pbmcgYWx3YXlzIHRydWUuXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgX2NoYW5jZShybmcsIHBlcmNlbnQpIHtcbiAgICAgICAgcmV0dXJuIHJuZy5yYW5kKCkgPCBwZXJjZW50O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJvbGwgZm9yIGEgYm9vbGVhbiB2YWx1ZSB0aGF0IGlzIHRydWUgQHBlcmNlbnQgYW1tb3VudCBvZiB0aGUgdGltZS5cbiAgICAgKiBJZiB0aGUgcm9sbCBmYWlscyB0aGVuIHJldHVybiBmYWxzZS4gRm9yIGV4YW1wbGUgY2FsbGluZyBjaGFuY2UoMC4zKVxuICAgICAqIHdpbGwgcmV0dXJuIHRydWUgMzAlIG9mIHRoZSB0aW1lLiBUaGUgaW5wdXQgcmFuZ2VcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHBlcmNlbnQgUGVyY2VudCBjaGFuY2UgdG8gZ2V0IFRydWUuIFZhbHVlIGlzIGluIHRoZSByYW5nZVxuICAgICAqICBmcm9tIDAgLSAxLiBXaXRoIDEgcmV0dXJuaW5nIGFsd2F5cyB0cnVlLlxuICAgICAqIEBtZW1iZXJPZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIGNoYW5jZShwZXJjZW50KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9jaGFuY2UodGhpcywgcGVyY2VudCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUm9sbCBmb3IgYSBib29sZWFuIHZhbHVlIHRoYXQgaXMgdHJ1ZSBAcGVyY2VudCBhbW1vdW50IG9mIHRoZSB0aW1lLlxuICAgICAqIElmIHRoZSByb2xsIGZhaWxzIHRoZW4gcmV0dXJuIGZhbHNlLiBGb3IgZXhhbXBsZSBjYWxsaW5nIGNoYW5jZSgwLjMpXG4gICAgICogd2lsbCByZXR1cm4gdHJ1ZSAzMCUgb2YgdGhlIHRpbWUuIFRoZSBpbnB1dCByYW5nZVxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBwZXJjZW50IFBlcmNlbnQgY2hhbmNlIHRvIGdldCBUcnVlLiBWYWx1ZSBpcyBpbiB0aGUgcmFuZ2VcbiAgICAgKiAgZnJvbSAwIC0gMS4gV2l0aCAxIHJldHVybmluZyBhbHdheXMgdHJ1ZS5cbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIGNoYW5jZShwZXJjZW50KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9jaGFuY2UoUmFuZCwgcGVyY2VudCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHJpdmF0ZSBIZWxwZXIgRnVuY3Rpb246XG4gICAgICogR2V0IGEgcmFuZG9tIGZsb2F0IHZhbHVlIGluIGEgcGFydGljdWxhciByYW5nZVxuICAgICAqIFxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7YW55fSBybmcgVGhlIGxvY2FsIG9yIGdsb2JhbCBybmcgdG8gdXNlIChSYW5kIG9yIHRoaXMpXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IG1pbiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWF4IFxuICAgICAqIFxuICAgICAqIEBtZW1iZXJvZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIF9yYW5kUmFuZ2Uocm5nLCBtaW4sIG1heCkge1xuICAgICAgICByZXR1cm4gcm5nLnJhbmQoKSAqIChtYXggLSBtaW4pICsgbWluO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHJhbmRvbSBmbG9hdCB2YWx1ZSBpbiBhIHBhcnRpY3VsYXIgcmFuZ2VcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IG1pbiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWF4IFxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFJhbmRvbSBmbG9hdCBudW1iZXIgZnJvbSBtaW4gKGluY2x1c2l2ZSkgXG4gICAgICogIHRvIG1heCAoZXhjbHVzaXZlKVxuICAgICAqIFxuICAgICAqIEBtZW1iZXJvZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIHJhbmRSYW5nZShtaW4sIG1heCkge1xuICAgICAgICByZXR1cm4gUmFuZC5fcmFuZFJhbmdlKFJhbmQsIG1pbiwgbWF4KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gZmxvYXQgdmFsdWUgaW4gYSBwYXJ0aWN1bGFyIHJhbmdlXG4gICAgICogXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IG1pbiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWF4IFxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFJhbmRvbSBmbG9hdCBudW1iZXIgZnJvbSBtaW4gKGluY2x1c2l2ZSkgXG4gICAgICogIHRvIG1heCAoZXhjbHVzaXZlKVxuICAgICAqIFxuICAgICAqIEBtZW1iZXJvZiBSYW5kXG4gICAgICovXG4gICAgcmFuZFJhbmdlKG1pbiwgbWF4KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kUmFuZ2UodGhpcywgbWluLCBtYXgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByaXZhdGUgSGVscGVyIEZ1bmN0aW9uOlxuICAgICAqIEdldCBhIHJhbmRvbSBpbnQgaW4gYSBwYXJ0aWN1bGFyIHJhbmdlIChtaW4gYW5kIG1heCBpbmNsdXNpdmUpXG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWluIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtYXggXG4gICAgICogQHJldHVybnMge251bWJlcn0gUmFuZG9tIGZsb2F0IG51bWJlciBmcm9tIG1pbiAoaW5jbHVzaXZlKSBcbiAgICAgKiAgdG8gbWF4IChleGNsdXNpdmUpXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgX3JhbmRJbnQocm5nLCBtaW4sIG1heCkge1xuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcihybmcucmFuZCgpICogKG1heCAtIG1pbiArIDEpKSArIG1pbjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gaW50IGluIGEgcGFydGljdWxhciByYW5nZSAobWluIGFuZCBtYXggaW5jbHVzaXZlKVxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWluIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtYXggXG4gICAgICogQHJldHVybnMge251bWJlcn0gUmFuZG9tIGZsb2F0IG51bWJlciBmcm9tIG1pbiAoaW5jbHVzaXZlKSBcbiAgICAgKiAgdG8gbWF4IChleGNsdXNpdmUpXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgcmFuZEludChtaW4sIG1heCkge1xuICAgICAgICByZXR1cm4gUmFuZC5fcmFuZEludChSYW5kLCBtaW4sIG1heCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGEgcmFuZG9tIGludCBpbiBhIHBhcnRpY3VsYXIgcmFuZ2UgKG1pbiBhbmQgbWF4IGluY2x1c2l2ZSlcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWluIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBtYXggXG4gICAgICogQHJldHVybnMge251bWJlcn0gUmFuZG9tIGZsb2F0IG51bWJlciBmcm9tIG1pbiAoaW5jbHVzaXZlKSBcbiAgICAgKiAgdG8gbWF4IChleGNsdXNpdmUpXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICByYW5kSW50KG1pbiwgbWF4KSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSW50KHRoaXMsIG1pbiwgbWF4KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQcml2YXRlIEhlbHBlciBGdW5jdGlvbjpcbiAgICAgKiBHZXQgdGhlIHJhbmRvbSBoZXggdmFsdWUgb2YgYSBjb2xvciByZXByZXNlbnRlZCBpbiB0aGUgaGV4aWRlY2ltYWwgZm9ybWF0XG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcbiAgICAgKiBAcmV0dXJucyB7aGV4fSBUaGUgcmFuZG9tIGhleCB2YWx1ZSBpbiB0aGUgY29sb3Igc3BlY3RydW1cbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyBfcmFuZEhleChybmcpIHtcbiAgICAgICAgcmV0dXJuIHJuZy5yYW5kSW50KDAsIDE2Nzc3MjE1KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHJhbmRvbSBoZXggdmFsdWUgb2YgYSBjb2xvciByZXByZXNlbnRlZCBpbiB0aGUgaGV4aWRlY2ltYWwgZm9ybWF0XG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEByZXR1cm5zIHtoZXh9IFxuICAgICAqIFxuICAgICAqIEBtZW1iZXJPZiBSYW5kXG4gICAgICovXG4gICAgc3RhdGljIHJhbmRIZXgoKSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSGV4KFJhbmQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgcmFuZG9tIGhleCB2YWx1ZSBvZiBhIGNvbG9yIHJlcHJlc2VudGVkIGluIHRoZSBoZXhpZGVjaW1hbCBmb3JtYXRcbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7aGV4fSBcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHJhbmRIZXgoKSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSGV4KHRoaXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByaXZhdGUgSGVscGVyIEZ1bmN0aW9uOlxuICAgICAqIEdldCBhIHJhbmRvbSBoZXggY29sb3Igc3RyaW5nIHJlcHJlc2VudGVkIGluIFwiI0hFWFNUUlwiIGZvcm1hdFxuICAgICAqIFxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7YW55fSBybmcgVGhlIGxvY2FsIG9yIGdsb2JhbCBybmcgdG8gdXNlIChSYW5kIG9yIHRoaXMpXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyBfcmFuZEhleENvbG9yKHJuZykge1xuICAgICAgICByZXR1cm4gXCIjXCIgKyBybmcucmFuZEhleCgpLnRvU3RyaW5nKDE2KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gaGV4IGNvbG9yIHN0cmluZyByZXByZXNlbnRlZCBpbiBcIiNIRVhTVFJcIiBmb3JtYXRcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyByYW5kSGV4Q29sb3IoKSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSGV4Q29sb3IoUmFuZCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGEgcmFuZG9tIGhleCBjb2xvciBzdHJpbmcgcmVwcmVzZW50ZWQgaW4gXCIjSEVYU1RSXCIgZm9ybWF0XG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICByYW5kSGV4Q29sb3IoKSB7XG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSGV4Q29sb3IodGhpcyk7XG4gICAgfVxuXG4gICAgLy8tLS0tIFJhbmRvbSBHZW9tZXRyeSAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gdmVjdG9yIGluIGEgYm91bmRpbmcgYm94XG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IG9mIHRoZSByYW5kb20gdmVjdG9yXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gQSByYW5kb20gdmVjdG9yXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICBzdGF0aWMgX3ZlY3RvcihybmcsIGJib3gpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoXG4gICAgICAgICAgICBSYW5kLnJhbmRSYW5nZShiYm94LngsIGJib3gueCArIGJib3gud2lkdGgpLFxuICAgICAgICAgICAgUmFuZC5yYW5kUmFuZ2UoYmJveC55LCBiYm94LnkgKyBiYm94LmhlaWdodClcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSByYW5kb20gdmVjdG9yIGluIGEgYm91bmRpbmcgYm94XG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggb2YgdGhlIHJhbmRvbSB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBBIHJhbmRvbSB2ZWN0b3JcbiAgICAgKiBcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxuICAgICAqL1xuICAgIHN0YXRpYyB2ZWN0b3IoYmJveCkge1xuICAgICAgICByZXR1cm4gUmFuZC5fdmVjdG9yKFJhbmQsIGJib3gpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHJhbmRvbSB2ZWN0b3IgaW4gYSBib3VuZGluZyBib3hcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IG9mIHRoZSByYW5kb20gdmVjdG9yXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gQSByYW5kb20gdmVjdG9yXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFJhbmRcbiAgICAgKi9cbiAgICB2ZWN0b3IoYmJveCkge1xuICAgICAgICByZXR1cm4gUmFuZC5fdmVjdG9yKHRoaXMsIGJib3gpO1xuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUmFuZDsiLCJpbXBvcnQgU2hhcGUgZnJvbSBcIi4vU2hhcGVcIjtcblxuY2xhc3MgTGluZSAge1xuICAgIC8qKlxuICAgICAqIEBjbGFzcyBMaW5lXG4gICAgICogQGV4dGVuZHMgU2hhcGVcbiAgICAgKiBcbiAgICAgKiBBIHNpbXBsZSBsaW5lIG9iamVjdCB0aGF0IGlzIGFuIGFycmF5IG9mIHR3byB2ZWN0b3IgcG9pbnRzLlxuICAgICAqIFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSBwMVxuICAgICAqIEBwcm9wZXJ0eSB7dmVjdG9yfSBwMlxuICAgICAqIFxuICAgICAqIEBzdW1tYXJ5IENyZWF0ZXMgYW4gaW5zdGFuY2Ugb2YgUG9seWdvbi5cbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gcDEgVGhlIGZpcnN0IHBvaW50XG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHAyIFRoZSBzZWNvbmQgcG9pbnRcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihwMSwgcDIpIHtcbiAgICAgICAgdGhpcy5wMSA9IHAxO1xuICAgICAgICB0aGlzLnAyID0gcDI7XG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBMaW5lOyIsImltcG9ydCBWZWN0b3IgZnJvbSBcIi4vVmVjdG9yXCI7XG5pbXBvcnQgU2hhcGUgZnJvbSBcIi4vU2hhcGVcIjtcblxuY2xhc3MgUG9seWdvbiBleHRlbmRzIEFycmF5IHtcbiAgICAvKipcbiAgICAgKiBAY2xhc3MgUG9seWdvblxuICAgICAqIEBleHRlbmRzIEFycmF5XG4gICAgICogXG4gICAgICogQ2xhc3MgdG8gc3RvcmUgcG9seWdvbiBpbmZvcm1hdGlvbiBpbiBhbiBhcnJheSBmb3JtYXQgdGhhdCBhbHNvIGdpdmVzIGl0XG4gICAgICogZXh0cmEgZnVuY3Rpb25hbGl0eSBvbiB0b3Agb2YgaXQuIFRoaXMgY2FuIGFsc28gc2VydmVyIGFzIGEgYmFzZSBjbGFzc1xuICAgICAqIGZvciBtb3JlIHNwZWNpZmljIGdlb21ldHJpYyBzaGFwZXMuXG4gICAgICogXG4gICAgICogQHN1bW1hcnkgQ3JlYXRlcyBhbiBpbnN0YW5jZSBvZiBQb2x5Z29uLlxuICAgICAqIFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSBjZW50ZXIgVGhlIGNlbnRlciBvZiB0aGUgcG9seWdvbi4gSWYgbm90IG90aGVyd2lzZVxuICAgICAqICBzdGF0ZWQsIHRoZSBjZW50ZXIgZGVmYXVsdHMgdG8gdGhlIGNlbnRyaW9kLiBBbnkgdHJhbnNmb3JtYXRpb25zIG9uXG4gICAgICogIHRoZSBwb2x5Z29uIGFyZSBkb25lIGFib3V0IHRoZSBjZW50ZXIgb2YgdGhlIHBvbHlnb24uXG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IFtjZW50ZXI9YXZlcmFnZSh2ZXJ0aWNpZXMpXSBUaGUgY2VudGVyIG9mIHRoZSBwb2x5Z29uLlxuICAgICAqICBJZiBhIHZhbHVlIGlzIG5vdCBwcm92aWRlZCB0aGUgZGVmYXVsdCB2YWx1ZSBiZWNvbWVzIHRoZSBjZW50cm9pZCBvZlxuICAgICAqICB0aGUgdmVydGljaWVzLlxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHZlcnRpY2llcyA9IG51bGwsIGNlbnRlciA9IG51bGwpIHtcbiAgICAgICAgaWYgKHZlcnRpY2llcykge1xuICAgICAgICAgICAgc3VwZXIoLi4udmVydGljaWVzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN1cGVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5jZW50ZXIgPSBjZW50ZXIgPyBjZW50ZXIgOiB0aGlzLmNlbnRyb2lkKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBjZW50cm9pZCBvZiB0aGUgcG9seWdvbi4gVGhpcyBpcyB0aGUgdmVjdG9yIGF2ZXJhZ2Ugb2YgYWxsIHRoZVxuICAgICAqIHBvaW50cyB0aGF0IG1ha2UgdXAgdGhlIHBvbHlnb24uXG4gICAgICogXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIGNlbnRyb2lkIG9mIHRoZSBwb2x5Z29uXG4gICAgICogXG4gICAgICogQG1lbWJlck9mIFBvbHlnb25cbiAgICAgKi9cbiAgICBjZW50cm9pZCgpIHtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5hdmcodGhpcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBwb2x5Z29uIGluc2V0IG9mIHRoZSBjdXJyZW50IHBvbHlnb24gYnkgdGhlIGlucHV0IGFtbW91bnRcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gYW1tb3VudFxuICAgICAqIEByZXR1cm5zIHtQb2x5Z29ufSBUaGUgaW5zZXQgb2YgdGhlIGN1cnJlbnQgcG9seWdvbiBieVxuICAgICAqIEBtZW1iZXJPZiBQb2x5Z29uXG4gICAgICovXG4gICAgaW5zZXQoYW1tb3VudCkge1xuICAgICAgICByZXR1cm4gYW1tb3VudDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHdoZWl0aGVyIG9yIG5vdCB0aGlzIHBvbHlnb24gaXMgYSBjb252ZXggcG9seWdvbi4gSWYgdGhpcyBpc1xuICAgICAqIG5vdCB0cnVlIHRoZW4gdGhlIHBvbHlnb24gaXMgY29udmFjZSBvciBtb3JlIGNvbXBsZXguXG4gICAgICogXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IElmIHRoZSBwb2x5Z29uIGlzIGNvbnZleFxuICAgICAqIEBtZW1iZXJPZiBQb2x5Z29uXG4gICAgICovXG4gICAgaXNDb252ZXgoKSB7XG5cbiAgICB9XG5cbiAgICByb3RhdGUoKSB7XG5cbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFBvbHlnb247IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi9WZWN0b3JcIjtcbmltcG9ydCBQb2x5Z29uIGZyb20gXCIuL1BvbHlnb25cIjtcblxuY2xhc3MgUmVjdGFuZ2xlIGV4dGVuZHMgUG9seWdvbiB7XG4gICAgLyoqIFxuICAgICAqIEBjbGFzcyBSZWN0YW5nbGVcbiAgICAgKiBAZXh0ZW5kcyBQb2x5Z29uXG4gICAgICogXG4gICAgICogQ2xhc3MgdG8gc3RvcmUgYXJyYXkgaW5mb3JtYXRpb24gYWJvdXQgYSByZWN0YW5nbGVcbiAgICAgKiBcbiAgICAgKiBAcHJvcGVydHkge1ZlY3Rvcn0gcG9zaXRpb25cbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0geFxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB5XG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IHdpZHRoXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IGhlaWdodFxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBwb3NpdGlvblxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSB3aWR0aFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBoZWlnaHRcbiAgICAgKi9cblxuICAgIGNvbnN0cnVjdG9yKHBvc2l0aW9uLCB3aWR0aCwgaGVpZ2h0KSB7XG4gICAgICAgIGNvbnN0IHBvaW50cyA9IFtwb3NpdGlvbixcbiAgICAgICAgICAgIFZlY3Rvci5hZGQocG9zaXRpb24sIG5ldyBWZWN0b3Iod2lkdGgsIDApKSxcbiAgICAgICAgICAgIFZlY3Rvci5hZGQocG9zaXRpb24sIG5ldyBWZWN0b3Iod2lkdGgsIGhlaWdodCkpLFxuICAgICAgICAgICAgVmVjdG9yLmFkZChwb3NpdGlvbiwgbmV3IFZlY3RvcigwLCBoZWlnaHQpKVxuICAgICAgICBdO1xuICAgICAgICBzdXBlcihwb2ludHMpO1xuXG4gICAgICAgIHRoaXMucG9zaXRpb24gPSBwb3NpdGlvbjtcbiAgICAgICAgdGhpcy54ID0gcG9zaXRpb24ueDtcbiAgICAgICAgdGhpcy55ID0gcG9zaXRpb24ueTtcbiAgICAgICAgdGhpcy53aWR0aCA9IHdpZHRoO1xuICAgICAgICB0aGlzLmhlaWdodCA9IGhlaWdodDtcbiAgICAgICAgdGhpcy5hcmVhID0gd2lkdGggKiBoZWlnaHQ7XG4gICAgfVxuXG4gICAgY29udGFpbnModmVjdG9yKSB7XG4gICAgICAgIHJldHVybiB2ZWN0b3IueCA+IHRoaXMucG9zaXRpb24ueCAmJlxuICAgICAgICAgICAgdmVjdG9yLnggPCB0aGlzLnBvc2l0aW9uLnggKyB0aGlzLndpZHRoICYmXG4gICAgICAgICAgICB2ZWN0b3IueSA+IHRoaXMucG9zaXRpb24ueSAmJlxuICAgICAgICAgICAgdmVjdG9yLnkgPCB0aGlzLnBvc2l0b2luLnkgKyB0aGlzLmhlaWdodDtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFJlY3RhbmdsZTsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuL1ZlY3RvclwiO1xuXG5jbGFzcyBTaGFwZSBleHRlbmRzIEFycmF5IHtcbiAgICAvKipcbiAgICAgKiBAY2xhc3MgU2hhcGVcbiAgICAgKiBcbiAgICAgKiBUaGlzIGlzIGFuIGFic3RyYWN0IGJhc2UgY2xhc3MgZm9yIHNoYXBlcy4gVGhlIHNoYXBlcyBhcmUgc3RvcmVkIGluIGFuIGFycmF5XG4gICAgICogZm9ybWF0IGFzIGEgbGlzdCBvZiBWZWN0b3JzLiBUaGlzIGFsbG93cyBmb3IgZWFzeSBtYW5pcHVsYXRpb24gYW5kIGFjY2VzcyB0b1xuICAgICAqIHRoZSBwb2ludHMgdGhhdCBtYWtlIHVwIHRoZSBzaGFwZS5cbiAgICAgKiBcbiAgICAgKiBAc3VtbWFyeSBDcmVhdGVzIGFuIGluc3RhbmNlIG9mIFNoYXBlLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yW119IFt2ZXJ0aWNpZXNdIFRoZSBzaGFwZXMgdmVjdG9yIHZlcnRpY2llc1xuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHZlcnRpY2llcykge1xuICAgICAgICBpZiAodmVydGljaWVzKSB7XG4gICAgICAgICAgICBzdXBlciguLi52ZXJ0aWNpZXMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgU2hhcGU7IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi9WZWN0b3JcIjtcbmltcG9ydCBQb2x5Z29uIGZyb20gXCIuL1BvbHlnb25cIjtcblxuY2xhc3MgVHJpYW5nbGUgZXh0ZW5kcyBQb2x5Z29uIHtcbiAgICAvKiogXG4gICAgICogQGNsYXNzIFRyaWFuZ2xlXG4gICAgICogQGV4dGVuZHMgUG9seWdvblxuICAgICAqIFxuICAgICAqIENsYXNzIHRvIHN0b3JlIGFycmF5IGluZm9ybWF0aW9uIGFib3V0IGEgcmVjdGFuZ2xlXG4gICAgICogXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IHZlcnRpY2llcyBUaGUgdGhyZWUgdmVydGljaWVzXG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYxIFRoZSBmaXJzdCBwb3NpdGlvblxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MiBUaGUgc2Vjb25kIHBvc2l0aW9uXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYzIFRoZSB0aGlyZCBwb3NpdGlvblxuICAgICAqL1xuXG4gICAgY29uc3RydWN0b3IodjEsIHYyLCB2Mykge1xuICAgICAgICB2YXIgdmVydGljaWVzID0gW3YxLCB2MiwgdjNdO1xuICAgICAgICBzdXBlcih2ZXJ0aWNpZXMpO1xuICAgICAgICB0aGlzLnYxID0gdjE7XG4gICAgICAgIHRoaXMudjIgPSB2MjtcbiAgICAgICAgdGhpcy52MyA9IHYzO1xuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgVHJpYW5nbGU7IiwiY2xhc3MgVmVjdG9yIHtcbiAgICAvKipcbiAgICAgKiBAY2xhc3MgVmVjdG9yXG4gICAgICogXG4gICAgICogVGhpcyBpcyBhIGJhc2ljIHZlY3RvciBjbGFzcyB0aGF0IGlzIHVzZWQgZm9yIGdlb21ldHJ5LCBwb3NpdGlvbiBpbmZvcmFtdGlvbixcbiAgICAgKiBtb3ZlbWVudCBpbmZvbWF0aW9uLCBhbmQgbW9yZSBjb21wbGV4IHN0cnVjdHVyZXMuXG4gICAgICogVGhlIHZlY3RvciBjbGFzcyBmb2xsb3dzIGEgaW1tdXRhYmxlIHBhcmFkaWdtIHdoZXJlIGNoYW5nZXMgYXJlIG5vdCBtYWRlIHRvIHRoZVxuICAgICAqIHZlY3RvcnMgdGhlbXNlbHZlcy4gQW55IGNoYW5nZSB0byBhIHZlY3RvciBpcyByZXR1cm5lZCBhcyBhIG5ldyB2ZWN0b3IgdGhhdFxuICAgICAqIG11c3QgYmUgY2FwdHVyZWQuIFxuICAgICAqIFxuICAgICAqIEBkZXNjcmlwdGlvbiBUaGlzIHZlY3RvciBjbGFzcyB3YXMgY29uc3RydWN0ZWQgc28gdGhhdCBpdCBjYW4gbWlycm9yIHR3byB0eXBlcyBvZiBjb21tb25cbiAgICAgKiBwb2ludC92ZWN0b3IgdHlwZSBvYmplY3RzLiBUaGlzIGlzIGhhdmluZyBvYmplY3QgcHJvcGVydGllcyBzdG9yZWQgYXMgb2JqZWN0XG4gICAgICogcHJvcGVydGllcyAoZWcuIHZlY3Rvci54LCB2ZWN0b3IueSkgb3IgYXMgbGlzdCBwcm9wZXJ0aWVzLCBbeCwgeV0gd2hpY2ggY2FuXG4gICAgICogYmUgYWNjZXNzZWQgYnkgdmVjdG9yWzBdLCBvciB2ZWN0b3JbMV0uXG4gICAgICogXG4gICAgICogQHN1bW1hcnkgQ3JlYXRlIGEgMkQgVmVjdG9yIG9iamVjdFxuICAgICAqIFxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB4IFRoZSB4IHZlY3RvciBjb21wb25lbnRcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0geSBUaGUgeSB2ZWN0b3IgY29tcG9uZW50XG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IDAgVGhlIHggdmVjdG9yIGNvbXBvbmVudFxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSAxIFRoZSB5IHZlY3RvciBjb21wb25lbnRcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge251bWJlcnxWZWN0b3J9IHggVGhlIHggY29tcG9uZW50IG9yIGFub3RoZXIgdmVjdG9yXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IFt5XSBUaGUgeSBjb21wb25lbnRcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcih4LCB5KSB7XG4gICAgICAgIGlmICh4IGluc3RhbmNlb2YgVmVjdG9yIHx8ICh4LnggJiYgeC55KSAmJiAheSkge1xuICAgICAgICAgICAgdGhpcy5fc2V0KHgueCwgeC55KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX3NldCh4LCB5KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vLS0tLSBIZWxwZXIgRnVuY3Rpb25zIC0tLS1cblxuICAgIC8qKlxuICAgICAqIEludGVybmFsIEhlbHBlciBGdW5jdGlvbiBmb3Igc2V0dGluZyB2YXJpYWJsZSBwcm9wZXJ0aWVzXG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAcGFyYW0ge251bWJlcn0geCBUaGUgeCBjb21wb25lbnRcbiAgICAgKiBAcGFyYW0ge251bWJlcn0geSBUaGUgeSBjb21wb25lbnRcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgX3NldCh4LCB5KSB7XG4gICAgICAgIHRoaXMuX19wcm90b19fWzBdID0geDtcbiAgICAgICAgdGhpcy5fX3Byb3RvX19bMV0gPSB5O1xuICAgICAgICB0aGlzLnggPSB4O1xuICAgICAgICB0aGlzLnkgPSB5O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdmVjdG9yIGtleTpTeW1ib2wgcmVwcmVzZW50YXRpb25cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7U3ltYm9sfSBUaGUgdmVjdG9yIGtleSBlbGVtZW50XG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIGtleSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubGlzdCgpO1xuICAgICAgICAvLyByZXR1cm4gU3ltYm9sKHRoaXMubGlzdCgpKTsgLy8gTm90IGN1cnJlbnRseSB3b3JraW5nIGFzIGEga2V5IHN5bWJvbFxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdmVjdG9yIGluIGxpc3QgZm9ybVxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtudW1iZXJbXX0gTGlzdCByZXByZXNlbnRhdGlvbiBvZiB0aGUgdmVjdG9yIG9mIGxlbmd0aCAyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIGxpc3QoKSB7XG4gICAgICAgIHJldHVybiBbdGhpcy54LCB0aGlzLnldO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIHZlY3RvciBhcyBhIHN0cmluZyBvZiAoeCwgeSlcbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgc3RyaW5nIHJlcHJlc2VudGF0aW9uIG9mIGEgdmVjdG9yIGluICh4LCB5KSBmb3JtXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gYCgke3RoaXMueH0sICR7dGhpcy55fSlgO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBhIGNvcHkgb2YgdGhlIGlucHV0IHZlY3RvclxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2IHRoZSB2ZWN0b3IgdG8gYmUgY29wcGllZFxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSB2ZWN0b3IgY29weVxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgY29weSh2KSB7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKHYueCwgdi55KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRydWUgaWYgdGhlIHR3byB2ZWN0b3IgcG9zaXRpb25zIGFyZSBlcXVhbFxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdjEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MiBUaGUgc2Vjb25kIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSB2ZWN0b3IgcG9zaXRpb25zIGFyZSBlcXVhbFxuICAgICAqIEBtZW1iZXJPZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZXF1YWxzKHYxLCB2Mikge1xuICAgICAgICByZXR1cm4gdjEueCA9PT0gdjIueCAmJiB2MS55ID09PSB2Mi55O1xuICAgIH1cblxuICAgIC8vLS0tLSBCYXNpYyBNYXRoIEZ1bmN0aW9ucyAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBBZGQgdHdvIHZlY3RvcnMgZWxlbWVudCB3aXNlXG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBhIFRoZSBmaXJzdCB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSB2ZWN0b3IgcmVzdWx0IG9mIGFkZGluZyB0aGUgdHdvIHZlY3RvcnNcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIGFkZChhLCBiKSB7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKGEueCArIGIueCwgYS55ICsgYi55KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBBZGQgdGhpcyB2ZWN0b3Igd2l0aCBhbm90aGVyIHZlY3RvciBlbGVtZW50IHdpc2VcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gb3RoZXIgVGhlIG90aGVyIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSB2ZWN0b3IgcmVzdWx0IG9mIGFkZGluZyB0aGUgdHdvIHZlY3RvcnNcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgYWRkKG90aGVyKSB7XG4gICAgICAgIHJldHVybiBWZWN0b3IuYWRkKHRoaXMsIG90aGVyKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTdWJ0cmFjdCB0d28gdmVjdG9ycyBlbGVtZW50IHdpc2VcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgVmVjdG9yXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIHZlY3RvciByZXN1bHQgb2Ygc3VidHJhY3RpbmcgdGhlIHR3byB2ZWN0b3JzXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBzdWJ0cmFjdChhLCBiKSB7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKGEueCAtIGIueCwgYS55IC0gYi55KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTdWJ0cmFjdCB0aGlzIHZlY3RvciB3aXRoIGFub3RoZXIgdmVjdG9yIGVsZW1lbnQgd2lzZVxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBvdGhlciBUaGUgb3RoZXIgdmVjdG9yXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIHZlY3RvciByZXN1bHQgb2Ygc3VidHJhY3RpbmcgdGhlIHR3byB2ZWN0b3JzXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN1YnRyYWN0KG90aGVyKSB7XG4gICAgICAgIHJldHVybiBWZWN0b3Iuc3VidHJhY3QodGhpcywgb3RoZXIpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE11bHRpcGx5IHRoZSB2ZWN0b3IgYnkgYSBzY2FsYXIgdmFsdWVcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gc2NhbGFyIFRoZSBudW1iZXIgdG8gbXVsdGlwbHkgdGhlIHZlY3RvciBieVxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSByZXN1bHQgb2YgbXVsdGlwbHlpbmcgdGhlIHZlY3RvciBieSBhIHNjYWxhclxuICAgICAqICBlbGVtZW50IHdpc2VcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgbXVsdGlwbHkoc2NhbGFyKSB7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKHRoaXMueCAqIHNjYWxhciwgdGhpcy55ICogc2NhbGFyKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEaXZpZGUgdGhlIHZlY3RvciBieSBhIHNjYWxhciB2YWx1ZVxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBzY2FsYXIgXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIHJlc3VsdCBvZiBtdWx0aXBseWluZyB0aGUgdmVjdG9yIGJ5IGEgc2NhbGFyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIGRpdmlkZShzY2FsYXIpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IodGhpcy54IC8gc2NhbGFyLCB0aGlzLnkgLyBzY2FsYXIpO1xuICAgIH1cblxuICAgIC8vLS0tLSBBZHZhbmNlZCBWZWN0b3IgRnVuY3Rpb25zIC0tLS1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgbWFnbml0dWRlIG9mIHRoZSB2ZWN0b3JcbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBUaGUgbWFnbml0dXJlIG9mIHRoZSB2ZWN0b3JcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgbWFnbml0dWRlKCkge1xuICAgICAgICByZXR1cm4gTWF0aC5zcXJ0KHRoaXMueCAqIHRoaXMueCArIHRoaXMueSAqIHRoaXMueSk7XG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSB1bml0IHZlY3RvclxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgbm9ybWFsIHZlY3RvciBvZiB0aGUgY3VycmVudCB2ZWN0b3IuXG4gICAgICogXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gQSB2ZWN0b3IgdGhhdCBpcyB0aGUgbm9ybWFsIGNvbXBlbmVudCBvZiB0aGUgdmVjdG9yXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIG5vcm1hbGl6ZSgpIHtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5kaXZpZGUodGhpcy5tYWduaXR1ZGUoKSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBnZXQgdGhlIGN1cnJlbnQgdmVjdG9yIHJvdGF0ZWQgYnkgYSBjZXJ0YWluIGFtbW91bnRcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gcmFkaWFucyBcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgdmVjdG9yIHRoYXQgcmVzdWx0cyBmcm9tIHJvdGF0aW5nIHRoZSBjdXJyZW50XG4gICAgICogIHZlY3RvciBieSBhIHBhcnRpY3VsYXIgYW1tb3VudFxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICByb3RhdGUocmFkaWFucykge1xuICAgICAgICBjb25zdCBjID0gTWF0aC5jb3MocmFkaWFucyk7XG4gICAgICAgIGNvbnN0IHMgPSBNYXRoLnNpbihyYWRpYW5zKTtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoYyAqIHRoaXMueCAtIHMgKiB0aGlzLnksIHMgKiB0aGlzLnggKyBjICogdGhpcy55KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIGRvdCBwcm9kdWN0IG9mIHR3byB2ZWN0b3JzXG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBhIFRoZSBmaXJzdCB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFRoZSBkb3QgcHJvZHVjdCBvZiB0aGUgdHdvIHZlY3RvcnNcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIGRvdChhLCBiKSB7XG4gICAgICAgIHJldHVybiBhLnggKiBiLnggKyBhLnkgKiBiLnk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBhdmVyYWdlIGxvY2F0aW9uIGJldHdlZW4gc2V2ZXJhbCB2ZWN0b3JzXG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3JbXX0gdmVjdG9ycyBUaGUgbGlzdCBvZiB2ZWN0b3JzIHRvIGF2ZXJhZ2VcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIGF2Zyh2ZWN0b3JzKSB7XG4gICAgICAgIGxldCBhdmVyYWdlID0gVmVjdG9yLnplcm8oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHZlY3RvciBvZiB2ZWN0b3JzKSB7XG4gICAgICAgICAgICBhdmVyYWdlID0gVmVjdG9yLmFkZChhdmVyYWdlLCB2ZWN0b3IpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBhdmVyYWdlLmRpdmlkZSh2ZWN0b3JzLmxlbmd0aCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBkb3QgcHJvZHVjdCBvZiB0aGlzIHZlY3RvciBhbmQgYW5vdGhlciB2ZWN0b3JcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gb3RoZXIgVGhlIG90aGVyIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFRoZSBkb3QgcHJvZHVjdCBvZiB0aGlzIGFuZCB0aGUgb3RoZXIgdmVjdG9yXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIGRvdChvdGhlcikge1xuICAgICAgICByZXR1cm4gVmVjdG9yLmRvdCh0aGlzLCBvdGhlcik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBjcm9zcyBwcm9kdWN0IG9mIHR3byB2ZWN0b3JzXG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBhIFRoZSBmaXJzdCB2ZWN0b3JcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFRoZSBjcm9zcyBwcm9kdWN0IG9mIHRoZSB0d28gdmVjdG9yc1xuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgY3Jvc3MoYSwgYikge1xuICAgICAgICByZXR1cm4gYS54ICogYi55IC0gYS55ICogYi54O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgY3Jvc3MgcHJvZHVjdCBvZiB0aGlzIGFuZCB0aGUgb3RoZXIgdmVjdG9yXG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IG90aGVyIFRoZSBvdGhlciB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBUaGUgY3Jvc3MgcHJvZHVjdCBvZiB0aGlzIGFuZCB0aGUgb3RoZXIgdmVjdG9yXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIGNyb3NzKG90aGVyKSB7XG4gICAgICAgIHJldHVybiBWZWN0b3IuY3Jvc3ModGhpcywgb3RoZXIpO1xuICAgIH1cblxuXG4gICAgLy8tLS0tIFB1cmVseSBTdGF0aWMgVmVjdG9yIEZ1bmN0aW9ucyAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIG1pZHBvaW50IGJldHdlZW4gdHdvIHZlY3RvcnNcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHJldHVybnMgVGhlIG1pZHBvaW50IG9mIHR3byB2ZWN0b3JzXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBtaWRwb2ludChhLCBiKSB7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKChhLnggKyBiLngpIC8gMiwgKGEueSArIGIueSkgLyAyKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHByb2plY3Rpb24gb2YgdmVjdG9yIGEgb250byB2ZWN0b3IgYlxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYSBUaGUgZmlyc3QgdmVjdG9yXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyBUaGUgcHJvamVjdGlvbiB2ZWN0b3Igb2YgYSBvbnRvIGJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICogXG4gICAgICogQHRvZG8gQWRkIGFzc2VydGlvbiBmb3Igbm9uLXplcm8gbGVuZ3RoIGIgdmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIHByb2ooYSwgYikge1xuXG4gICAgICAgIHJldHVybiBiLm11bHRpcGx5KFZlY3Rvci5kb3QoYSwgYikgLyBNYXRoLnBvdyhiLm1hZ25pdHVkZSgpLCAyKSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBhbmdsZSBiZXR3ZWVuIHR3byB2ZWN0b3JzXG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBhIFRoZSBmcmlzdCB2ZWN0b3IgXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3IgXG4gICAgICogQHJldHVybnMgVGhlIGFuZ2xlIGJldHdlZW4gdmVjdG9yIGEgYW5kIHZlY3RvciBiXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyBhbmdsZShhLCBiKSB7XG4gICAgICAgIHJldHVybiBNYXRoLmFjb3MoVmVjdG9yLmRvdChhLCBiKSAvIChhLm1hZ25pdHVkZSgpICogYi5tYWduaXR1ZGUoKSkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgZXVjbGlkZWFuIGRpc3RhbmNlIGJldHdlZW4gdHdvIHZlY3RvcnNcbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBiIFRoZSBzZWNvbmQgdmVjdG9yXG4gICAgICogQHJldHVybnMgVGhlIGV1Y2xpZGVhbiBkaXN0YW5jZSBiZXR3ZWVuIGEgYW5kIGJcbiAgICAgKiBAc2VlIHtAbGluayBkaXN0Mn1cbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIGRpc3RhbmNlKGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIE1hdGguc3FydChWZWN0b3IuZGlzdDIoYSwgYikpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgZXVjbGlkZWFuIGRpc3RuYWNlIHNxdWFyZWQgYmV0d2VlbiB0d28gdmVjdG9ycy5cbiAgICAgKiBUaGlzIGlzIHVzZWQgYXMgYSBoZWxwZXIgZm9yIHRoZSBkaXN0bmFjZSBmdW5jdGlvbiBidXQgY2FuIGJlIHVzZWRcbiAgICAgKiB0byBzYXZlIG9uIHNwZWVkIGJ5IG5vdCBkb2luZyB0aGUgc3F1YXJlIHJvb3Qgb3BlcmF0aW9uLlxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYSBUaGUgZmlyc3QgdmVjdG9yXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcbiAgICAgKiBAcmV0dXJucyBUaGUgZXVjbGlkZWFuIGRpc3RhbmNlIHNxdWFyZWQgYmV0d2VlbiB2ZWN0b3IgYSBhbmQgdmVjdG9yIGJcbiAgICAgKiBAc2VlIHtAbGluayBkaXN0bmFjZX1cbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIGRpc3QyKGEsIGIpIHtcbiAgICAgICAgY29uc3QgZHggPSBhLnggLSBiLng7XG4gICAgICAgIGNvbnN0IGR5ID0gYS55IC0gYi55O1xuICAgICAgICByZXR1cm4gZHggKiBkeCArIGR5ICogZHk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBzaG9ydGVzdCBkaXN0YW5jZSBiZXR3ZWVuIHRoZSBwb2ludCBwIGFuZCB0aGUgbGluZVxuICAgICAqIHNlZ21lbnQgdiB0byB3LlxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gcCBUaGUgdmVjdG9yIHBvaW50XG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYgVGhlIGZpcnN0IGxpbmUgc2VnbWVudCBlbmRwb2ludFxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB3IFRoZSBzZWNvbmQgbGluZSBzZWdtZW50IGVuZHBvaW50XG4gICAgICogQHJldHVybnMgVGhlIHNob3J0ZXN0IGV1Y2xpZGVhbiBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50XG4gICAgICogQHNlZSB7QGxpbmsgZGlzdFRvU2VnMn1cbiAgICAgKiBAc2VlIHtAbGluayBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzg0OTIxMS9zaG9ydGVzdC1kaXN0YW5jZS1iZXR3ZWVuLWEtcG9pbnQtYW5kLWEtbGluZS1zZWdtZW50fVxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZGlzdFRvU2VnKHAsIHYsIHcpIHtcbiAgICAgICAgcmV0dXJuIE1hdGguc3FydChWZWN0b3IuZGlzdFRvU2VnMihwLCB2LCB3KSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBzaG9ydGVzdCBkaXN0YW5jZSBzcXVhcmVkIGJldHdlZW4gdGhlIHBvaW50IHAgYW5kIHRoZSBsaW5lXG4gICAgICogc2VnbWVudCB2IHRvIHcuXG4gICAgICogXG4gICAgICogQHN0YXRpY1xuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBwIFRoZSB2ZWN0b3IgcG9pbnRcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdiBUaGUgZmlyc3QgbGluZSBzZWdtZW50IGVuZHBvaW50XG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHcgVGhlIHNlY29uZCBsaW5lIHNlZ21lbnQgZW5kcG9pbnRcbiAgICAgKiBAcmV0dXJucyBUaGUgc2hvcnRlc3QgZXVjbGlkZWFuIGRpc3RhbmNlIHNxdWFyZWQgYmV0d2VlbiBwb2ludFxuICAgICAqIEBzZWUge0BsaW5rIGRpc3RUb1NlZ31cbiAgICAgKiBAc2VlIHtAbGluayBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzg0OTIxMS9zaG9ydGVzdC1kaXN0YW5jZS1iZXR3ZWVuLWEtcG9pbnQtYW5kLWEtbGluZS1zZWdtZW50fVxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZGlzdFRvU2VnU3F1YXJlZChwLCB2LCB3KSB7XG4gICAgICAgIGNvbnN0IGwgPSBWZWN0b3IuZGlzdDIodiwgdyk7XG4gICAgICAgIGlmIChsID09PSAwKSB7IHJldHVybiBWZWN0b3IuZGlzdDIocCwgdik7IH1cbiAgICAgICAgbGV0IHQgPSAoKHAueCAtIHYueCkgKiAody54IC0gdi54KSArIChwLnkgLSB2LnkpICogKHcueSAtIHYueSkpIC8gbDtcbiAgICAgICAgdCA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEsIHQpKTtcbiAgICAgICAgcmV0dXJuIFZlY3Rvci5kaXN0MihwLCBuZXcgVmVjdG9yKHYueCArIHQgKiAody54IC0gdi54KSxcbiAgICAgICAgICAgIHYueSArIHQgKiAody55IC0gdi55KSkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgdHdvIG5vcm1hbCB2ZWN0b3JzIHRoYXQgYXJlIHBlcnBlbmRpY3VsYXIgdG8gdGhlIGN1cnJlbnQgdmVjdG9yXG4gICAgICogXG4gICAgICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgdHdvIG5vcm1hbCB2ZWN0b3JzIHRoYXQgYXJlIHBlcnBlbmRpY3VsYXJcbiAgICAgKiAgdG8gdGhlIHZlY3Rvci4gVGhlIGZpcnN0IHZlY3RvciBpcyB0aGUgbm9ybWFsIHZlY3RvciB0aGF0IGlzICs5MCBkZWcgb3JcbiAgICAgKiAgK1BJLzIgcmFkLiBUaGUgc2Vjb25kIHZlY3RvciBpcyB0aGUgbm9yYW1sIHZlY3RvciB0aGF0IGlzIC05MCBkZWcgb3JcbiAgICAgKiAgLVBJLzIgcmFkLlxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBwZXJwZW5kaWN1bGFycygpIHtcbiAgICAgICAgY29uc3QgcGx1czkwID0gbmV3IFZlY3RvcigtdGhpcy55LCB0aGlzLngpLm5vcm1hbGl6ZSgpO1xuICAgICAgICBjb25zdCBtaW51czkwID0gbmV3IFZlY3Rvcih0aGlzLnksIC10aGlzLngpLm5vcm1hbGl6ZSgpO1xuICAgICAgICByZXR1cm4gW3BsdXM5MCwgbWludXM5MF07XG4gICAgfVxuXG4gICAgLy8tLS0tIFN0YW5kYXJkIFN0YXRpYyBWZWN0b3IgT2JqZWN0cyAtLS0tXG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSB2ZWN0b3Igb2Ygbm8gbWFnbml0dWRlIGFuZCBubyBkaXJlY3Rpb25cbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQGZ1bmN0aW9uXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVmVjdG9yIG9mIG1hZ25pdHVkZSB6ZXJvXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxuICAgICAqL1xuICAgIHN0YXRpYyB6ZXJvKCkge1xuICAgICAgICBcInVzZSBzdHJpY3RcIjtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoMCwgMCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSB1bml0IHZlY3RvciBwb2ludGluZyBpbiB0aGUgcG9zaXRpdmUgeSBkaXJlY3Rpb25cbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQGZ1bmN0aW9uXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVW5pdCB2ZWN0b3IgcG9pbnRpbmcgdXBcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXG4gICAgICovXG4gICAgc3RhdGljIHVwKCkge1xuICAgICAgICBcInVzZSBzdHJpY3RcIjtcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoMCwgMSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSB1bml0IHZlY3RvciBwb2ludGluZyBpbiB0aGUgbmVnYXRpdmUgeSBkaXJlY3Rpb25cbiAgICAgKiBcbiAgICAgKiBAc3RhdGljXG4gICAgICogQGZ1bmN0aW9uXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVW5pdCB2ZWN0b3IgcG9pbnRpbmcgZG93blxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgZG93bigpIHtcbiAgICAgICAgXCJ1c2Ugc3RyaWN0XCI7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKDAsIC0xKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHVuaXQgdmVjdG9yIHBvaW50aW5nIGluIHRoZSBuZWdhdGl2ZSB4IGRpcmVjdGlvblxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAZnVuY3Rpb25cbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBVbml0IHZlY3RvciBwb2ludGluZyByaWdodFxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgbGVmdCgpIHtcbiAgICAgICAgXCJ1c2Ugc3RyaWN0XCI7XG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKC0xLCAwKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIHVuaXQgdmVjdG9yIHBvaW50aW5nIGluIHRoZSBwb3NpdGl2ZSB4IGRpcmVjdGlvblxuICAgICAqIFxuICAgICAqIEBzdGF0aWNcbiAgICAgKiBAZnVuY3Rpb25cbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBVbml0IHZlY3RvciBwb2ludGluZyByaWdodFxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcbiAgICAgKi9cbiAgICBzdGF0aWMgcmlnaHQoKSB7XG4gICAgICAgIFwidXNlIHN0cmljdFwiO1xuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcigxLCAwKTtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFZlY3RvcjsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcbmltcG9ydCBQb2x5Z29uIGZyb20gXCIuLi9nZW9tZXRyeS9Qb2x5Z29uXCI7XG5cbmNsYXNzIENlbnRlciBleHRlbmRzIFZlY3RvciB7XG4gICAgLyoqXG4gICAgICogQSBjZW50ZXIgY29ubmVjdGlvbiBhbmQgbG9jYXRpb24gaW4gYSBncmFwaCBvYmplY3RcbiAgICAgKiBcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0gaWQgVGhlIGlkIG9mIHRoZSBjZW50ZXIgaW4gdGhlIGdyYXBoIG9iamVjdFxuICAgICAqIEBwcm9wZXJ0eSB7UG9seWdvbn0gbmVpZ2hib3JzIFNldCBvZiBhZGphY2VudCBwb2x5Z29uIGNlbnRlcnNcbiAgICAgKiBAcHJvcGVydHkge0xpbmVbXX0gYm9yZGVycyBTZXQgb2YgYm9yZGVyaW5nIGVkZ2VzXG4gICAgICogQHByb3BlcnR5IHtQb2x5Z29ufSBjb3JuZXJzIFNldCBvZiBwb2x5Z29uIGNvcm5lcnNcbiAgICAgKiBAcHJvcGVydHkge2Jvb2xlYW59IGJvcmRlciBJcyB0aGlzIHBvbHlnb24gdG91Y2hpbmcgdGhlIGJvcmRlciBlZGdlXG4gICAgICogQHByb3BlcnR5IHtvYmplY3R9IGRhdGEgVGhlIGRhdGEgc3RvcmVkIGJ5IHRoZSBjZW50ZXIgb2JqZWN0LiBUaGlzIGlzIHRoZVxuICAgICAqICBkYXRhIHRoYXQgaXMgdG8gYmUgY2hhbmdlZCBieSB0aGUgdXNlclxuICAgICAqIEBwcm9wZXJ0eSB7Q2VudGVyfSBwYXJlbnQgVGhlIHBhcmVudCBvYmplY3QgdG8gdGhlIGN1cnJlbnQgb2JqZWN0LiBUaGVcbiAgICAgKiAgZGVmYXVsdCBpcyBudWxsLCB0aGVyZSBpcyBubyBwYXJlbnQuXG4gICAgICogQHByb3BlcnR5IHtDZW50ZXJbXX0gY2hpbGRyZW4gVGhlIGNoaWxkcmVuIG9iamVjdHMgdG8gdGhlIGN1cnJlbnQgb2JqZWN0LlxuICAgICAqICBUaGUgZGVmYXVsdCBpcyBhbiBlbXB0eSBsaXN0XG4gICAgICogXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHBvc2l0aW9uIFRoZSBsb2NhdGlvbiBvZiB0aGUgQ2VudGVyIG9iamVjdFxuICAgICAqIFxuICAgICAqIEBjbGFzcyBDZW50ZXJcbiAgICAgKiBAZXh0ZW5kcyB7VmVjdG9yfVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHBvc2l0aW9uLCBwYXJlbnQgPSBudWxsLCBjaGlsZHJlbiA9IG51bGwpIHtcbiAgICAgICAgc3VwZXIocG9zaXRpb24pO1xuXG4gICAgICAgIC8vIERpYWdyYW0gUHJvcGVydGllc1xuICAgICAgICB0aGlzLmlkID0gLTE7XG4gICAgICAgIHRoaXMubmVpZ2hib3JzID0gW107IC8vIG5ldyBQb2x5Z29uKCk7IC8vIENlbnRlcnNcbiAgICAgICAgdGhpcy5ib3JkZXJzID0gW107IC8vIEVkZ2VzXG4gICAgICAgIHRoaXMuY29ybmVycyA9IFtdOyAvL25ldyBQb2x5Z29uKCk7XG4gICAgICAgIHRoaXMuYm9yZGVyID0gZmFsc2U7XG5cbiAgICAgICAgLy8gSGlnaGVyIExldmVsIFByb3BlcnRpZXNcbiAgICAgICAgdGhpcy5kYXRhID0ge307XG5cbiAgICAgICAgLy8gUmVjdXJzaXZlIFBhcmFtZXRlcnNcbiAgICAgICAgdGhpcy5wYXJlbnQgPSBwYXJlbnQ7XG4gICAgICAgIHRoaXMuY2hpbGRyZW4gPSBjaGlsZHJlbiA/IGNoaWxkcmVuIDogW107XG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBDZW50ZXI7IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi4vZ2VvbWV0cnkvVmVjdG9yXCI7XG5pbXBvcnQgUG9seWdvbiBmcm9tIFwiLi4vZ2VvbWV0cnkvUG9seWdvblwiO1xuXG5jbGFzcyBDb3JuZXIgZXh0ZW5kcyBWZWN0b3Ige1xuICAgIC8qKlxuICAgICAqIEEgY29ybmVyIGNvbm5lY3Rpb24gYW5kIGxvY2F0aW9uIGluIGEgZ3JhcGggb2JqZWN0XG4gICAgICogXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IGlkIFRoZSBpZCBvZiB0aGUgY29ybmVyIGluIHRoZSBncmFwaCBvYmplY3RcbiAgICAgKiBAcHJvcGVydHkge1BvbHlnb259IHRvdWNoZXMgU2V0IG9mIHBvbHlnb24gY2VudGVycyB0b3VjaGluZyB0aGlzIG9iamVjeXRcbiAgICAgKiBAcHJvcGVydHkge0xpbmVbXX0gcHJvdHJ1ZGVzIFNldCBvZiBlZGdlcyB0aGF0IGFyZSBjb25uZWN0ZWQgdG8gdGhpcyBjb3JuZXJcbiAgICAgKiBAcHJvcGVydHkge1BvbHlnb259IGFkamFjZW50IFNldCBvZiBjb3JuZXJzIHRoYXQgY29ubmVjdGVkIHRvIHRoaXMgY29ybmVyXG4gICAgICogXG4gICAgICogQGNsYXNzIENvcm5lclxuICAgICAqIEBleHRlbmRzIHtWZWN0b3J9XG4gICAgICovXG4gICAgY29uc3RydWN0b3IocG9zaXRpb24pIHtcbiAgICAgICAgc3VwZXIocG9zaXRpb24pO1xuICAgICAgICB0aGlzLmlkID0gLTE7XG4gICAgICAgIHRoaXMudG91Y2hlcyA9IFtdOyAvL25ldyBQb2x5Z29uKCk7IC8vIENlbnRlcnNcbiAgICAgICAgdGhpcy5wcm90cnVkZXMgPSBbXTsgLy8gRWRnZXNcbiAgICAgICAgdGhpcy5hZGphY2VudCA9IFtdOyAvL25ldyBQb2x5Z29uKCk7IC8vIENvcm5lcnNcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IENvcm5lcjsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcbmltcG9ydCBDZW50ZXIgZnJvbSBcIi4vQ2VudGVyXCI7XG5pbXBvcnQgQ29ybmVyIGZyb20gXCIuL0Nvcm5lclwiO1xuaW1wb3J0IEVkZ2UgZnJvbSBcIi4vRWRnZVwiO1xuaW1wb3J0IHsgaGFzIH0gZnJvbSBcIi4uL3V0aWxpdGllcy9VdGlsXCI7XG5pbXBvcnQgVm9yb25vaSBmcm9tIFwiVm9yb25vaVwiO1xuXG5cInVzZSBzdHJpY3RcIjtcblxuLy8gTmVlZCB0byBFUzZpZnlcbmNsYXNzIERpYWdyYW0ge1xuICAgIC8qKlxuICAgICAqIFRoZSBEaWFncmFtIGNsYXNzIGlzIGFuIGV4dGVuc3Rpb24gb2YgdGhlIHZvcm9ub2kgRGlhZ3JhbS4gSXQgdHVybnMgdGhlXG4gICAgICogZGlhZ3JhbSBpbnRvIGEgbW9yZSB1c2VhYmxlIGZvcm1hdCB3aGVyZSBjZW50ZXJzLCBlZGdlcywgYW5kIGNvcm5lcnMgYXJlXG4gICAgICogYmV0dGVyIGNvbm5lY3RlZC4gVGhpcyBhbGxvd3MgZm9yIG1hbnkgZGlmZmVyZW50IHR5cGVzIG9mIHRyYXZlcnNhbCBvdmVyXG4gICAgICogdGhlIGdyYXBoLiBUaGlzIGNsYXNzIHVzZXMgdGhlIHJoaWxsLXZvcm9ub2kgbGlicmFyeSBmb3IgYnVpbGRpbmcgdGhlXG4gICAgICogdm9yb25vaSBncmFwaC4gVGhpcyBpcyB0ZXJtZWQgYSBQQU4gY29ubmVjdGVkIGdyYXBoLiBUaGlzIGNsYXNzIGNhbiBhbHNvIGJlXG4gICAgICogcmVsYXhlZCBtb3JlIGJ5IHVzaW5nIGxsb3lkIHJlbGF4YXRpb24gd2hpY2ggcmVydW5zIHRoZSBncmFwaCBzaW11bGF0aW9uXG4gICAgICogcHJvY2VzcyB3aXRoIGEgbGVzcyBwYWNrZWQgcG9pbnQgc2V0IHRvIGdyYWR1YWxseSBjcmVhdGUgYSBtb3JlIFwiYmx1ZVwiIG5vaXNlXG4gICAgICogZWZmZWN0LlxuICAgICAqXG4gICAgICogQHN1bW1hcnkgQ3JlYXRlcyBhIHZvcm9ub2kgZGlhZ3JhbSBvZiBhIGdpdmVuIHBvaW50IHNldCB0aGF0IGlzIGNyZWF0ZWRcbiAgICAgKiAgaW5zaWRlIGEgcGFydGl1Y2xhciBib3VuZGluZyBib3guIFRoZSBzZXQgb2YgcG9pbnRzIGNhbiBhbHNvIGJlIHJlbGF4ZWRcbiAgICAgKiAgY3JlYXRpbmcgYSBtb3JlIFwiYmx1ZVwiIG5vaXNlIGVmZmVjdCB1c2luZyBsb3lkIHJlbGF4YXRpb24uXG4gICAgICogXG4gICAgICogQHByb3BlcnR5IHtSZWN0YW5nbGV9IGJib3ggVGhlIGlucHV0IGJvdW5kaW5nIGJveFxuICAgICAqIEBwcm9wZXJ0eSB7Q2VudGVyW119IGNlbnRlcnMgQWxsIHRoZSBjZW50ZXIgb2JqZWN0cyBvZiB0aGUgZGlhZ3JhbVxuICAgICAqIEBwcm9wZXJ0eSB7Q29ybmVyW119IGNvcm5lcnMgQWxsIHRoZSBjb3JuZXIgb2JqZWN0cyBvZiB0aGUgZGlhZ3JhbVxuICAgICAqIEBwcm9wZXJ0eSB7RWRnZXNbXX0gZWRnZXMgQWxsIHRoZSBlZGdlIG9iamVjdHMgb2YgdGhlIGRpYWdyYW1cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ge1ZlY3RvcltdfSBwb2ludHMgVGhlIHZlY3RvciBsb2NhdGlvbiB0byBjcmVhdGUgdGhlIHZvcm9ub2kgZGlhZ3JhbSB3aXRoXG4gICAgICogQHBhcmFtIHtSZWN0YW5nbGV9IGJib3ggVGhlIGJvdW5kaW5nIGJveCBmb3IgdGhlIGNyZWF0aW9uIG9mIHRoZSB2b3Jvbm9pIGRpYWdyYW1cbiAgICAgKiBAcGFyYW0ge2ludGVnZXJ9IFtyZWxheGF0aW9ucz0wXSBUaGUgbnVtYmVyIG9mIGxsb3lkIHJlbGF4YXRpb25zIHRvIGRvLlxuICAgICAqICBUaGlzIHR1cm5zIGEgbm9pc3kgZGlhZ3JhbSBpbnRvIGEgbW9yZSB1bmlmb3JtIGRpYWdyYW0gaXRlcmF0aW9uIGJ5IGl0ZXJhdGlvbi5cbiAgICAgKiAgVGhpcyBoZWxwcyB0byBpbXByb3ZlIHRoZSBzcGFjaW5nIGJldHdlZW4gcG9pbnRzIGluIHRoZSBkaWFncmFtLlxuICAgICAqIEBwYXJhbSB7Ym9vbH0gW2ltcHJvdmVDb3JuZXJzPWZhbHNlXSBUaGlzIGltcHJvdmVzIHVuaWZvcm1pdHkgYW1vbmcgdGhlXG4gICAgICogIGNvcm5lcnMgYnkgc2V0dGluZyB0aGVtIHRvIHRoZSBhdmVyYWdlIG9mIHRoZWlyIG5laWdoYm9ycy4gVGhpcyBicmVha3NcbiAgICAgKiAgdGhlIHZvcm9ub2kgcHJvcGVydGllcyBvZiB0aGUgZGlhZ3JhbS5cbiAgICAgKiBcbiAgICAgKiBAY2xhc3MgRGlhZ3JhbVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHBvaW50cywgYmJveCwgcmVsYXhhdGlvbnMgPSAwLCBpbXByb3ZlQ29ybmVycyA9IGZhbHNlKSB7XG4gICAgICAgIHRoaXMuYmJveCA9IGJib3g7XG4gICAgICAgIHRoaXMuX3JoaWxsYmJveCA9IHtcbiAgICAgICAgICAgIHhsOiB0aGlzLmJib3gueCxcbiAgICAgICAgICAgIHhyOiB0aGlzLmJib3gueCArIHRoaXMuYmJveC53aWR0aCxcbiAgICAgICAgICAgIHl0OiB0aGlzLmJib3gueSxcbiAgICAgICAgICAgIHliOiB0aGlzLmJib3gueSArIHRoaXMuYmJveC5oZWlnaHRcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBDb21wdXRlIFZvcm9ub2kgZnJvbSBpbml0aWFsIHBvaW50c1xuICAgICAgICBjb25zdCByaGlsbFZvcm9ub2kgPSBuZXcgVm9yb25vaSgpO1xuICAgICAgICB0aGlzLl92b3Jvbm9pID0gcmhpbGxWb3Jvbm9pLmNvbXB1dGUocG9pbnRzLCB0aGlzLl9yaGlsbGJib3gpO1xuXG4gICAgICAgIC8vIExsb3lkcyBSZWxheGF0aW9uc1xuICAgICAgICB3aGlsZSAocmVsYXhhdGlvbnMtLSkge1xuICAgICAgICAgICAgY29uc3Qgc2l0ZXMgPSB0aGlzLnJlbGF4U2l0ZXModGhpcy5fdm9yb25vaSk7XG4gICAgICAgICAgICByaGlsbFZvcm9ub2kucmVjeWNsZSh0aGlzLl92b3Jvbm9pKTtcbiAgICAgICAgICAgIHRoaXMuX3Zvcm9ub2kgPSByaGlsbFZvcm9ub2kuY29tcHV0ZShzaXRlcywgdGhpcy5fcmhpbGxiYm94KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY29udmVydERpYWdyYW0odGhpcy5fdm9yb25vaSk7XG5cbiAgICAgICAgaWYgKGltcHJvdmVDb3JuZXJzKSB7XG4gICAgICAgICAgICB0aGlzLmltcHJvdmVDb3JuZXJzKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5zb3J0Q29ybmVycygpO1xuXG4gICAgfVxuXG4gICAgcmVsYXhTaXRlcyh2b3Jvbm9pKSB7XG4gICAgICAgIGNvbnN0IGNlbGxzID0gdm9yb25vaS5jZWxscztcbiAgICAgICAgbGV0IGlDZWxsID0gY2VsbHMubGVuZ3RoO1xuICAgICAgICBsZXQgY2VsbDtcbiAgICAgICAgbGV0IHNpdGU7XG4gICAgICAgIGNvbnN0IHNpdGVzID0gW107XG5cbiAgICAgICAgd2hpbGUgKGlDZWxsLS0pIHtcbiAgICAgICAgICAgIGNlbGwgPSBjZWxsc1tpQ2VsbF07XG4gICAgICAgICAgICBzaXRlID0gdGhpcy5jZWxsQ2VudHJvaWQoY2VsbCk7XG4gICAgICAgICAgICBzaXRlcy5wdXNoKG5ldyBWZWN0b3Ioc2l0ZS54LCBzaXRlLnkpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2l0ZXM7XG4gICAgfVxuXG4gICAgY2VsbEFyZWEoY2VsbCkge1xuICAgICAgICBsZXQgYXJlYSA9IDA7XG4gICAgICAgIGNvbnN0IGhhbGZlZGdlcyA9IGNlbGwuaGFsZmVkZ2VzO1xuICAgICAgICBsZXQgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aDtcbiAgICAgICAgbGV0IGhhbGZlZGdlLCBwMSwgcDI7XG4gICAgICAgIHdoaWxlIChpSGFsZmVkZ2UtLSkge1xuICAgICAgICAgICAgaGFsZmVkZ2UgPSBoYWxmZWRnZXNbaUhhbGZlZGdlXTtcbiAgICAgICAgICAgIHAxID0gaGFsZmVkZ2UuZ2V0U3RhcnRwb2ludCgpO1xuICAgICAgICAgICAgcDIgPSBoYWxmZWRnZS5nZXRFbmRwb2ludCgpO1xuICAgICAgICAgICAgYXJlYSArPSBwMS54ICogcDIueTtcbiAgICAgICAgICAgIGFyZWEgLT0gcDEueSAqIHAyLng7XG4gICAgICAgIH1cbiAgICAgICAgYXJlYSAvPSAyO1xuICAgICAgICByZXR1cm4gYXJlYTtcbiAgICB9XG5cbiAgICBjZWxsQ2VudHJvaWQoY2VsbCkge1xuICAgICAgICBsZXQgeCA9IDAsXG4gICAgICAgICAgICB5ID0gMDtcbiAgICAgICAgY29uc3QgaGFsZmVkZ2VzID0gY2VsbC5oYWxmZWRnZXM7XG4gICAgICAgIGxldCBpSGFsZmVkZ2UgPSBoYWxmZWRnZXMubGVuZ3RoO1xuICAgICAgICBsZXQgaGFsZmVkZ2U7XG4gICAgICAgIGxldCB2LCBwMSwgcDI7XG5cbiAgICAgICAgd2hpbGUgKGlIYWxmZWRnZS0tKSB7XG4gICAgICAgICAgICBoYWxmZWRnZSA9IGhhbGZlZGdlc1tpSGFsZmVkZ2VdO1xuXG4gICAgICAgICAgICBwMSA9IGhhbGZlZGdlLmdldFN0YXJ0cG9pbnQoKTtcbiAgICAgICAgICAgIHAyID0gaGFsZmVkZ2UuZ2V0RW5kcG9pbnQoKTtcblxuICAgICAgICAgICAgdiA9IHAxLnggKiBwMi55IC0gcDIueCAqIHAxLnk7XG5cbiAgICAgICAgICAgIHggKz0gKHAxLnggKyBwMi54KSAqIHY7XG4gICAgICAgICAgICB5ICs9IChwMS55ICsgcDIueSkgKiB2O1xuICAgICAgICB9XG5cbiAgICAgICAgdiA9IHRoaXMuY2VsbEFyZWEoY2VsbCkgKiA2O1xuXG4gICAgICAgIHJldHVybiB7IHg6IHggLyB2LCB5OiB5IC8gdiB9O1xuICAgIH1cblxuICAgIGNvbnZlcnREaWFncmFtKHZvcm9ub2kpIHtcbiAgICAgICAgY29uc3QgY2VudGVyTG9va3VwID0ge307XG4gICAgICAgIGNvbnN0IGNvcm5lckxvb2t1cCA9IHt9O1xuICAgICAgICB0aGlzLmNlbnRlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5jb3JuZXJzID0gW107XG4gICAgICAgIHRoaXMuZWRnZXMgPSBbXTtcblxuICAgICAgICBsZXQgY29ybmVySWQgPSAwO1xuICAgICAgICBsZXQgZWRnZUlkID0gMDtcblxuICAgICAgICAvLyBDb3B5IG92ZXIgYWxsIHRoZSBjZW50ZXIgbm9kZXNcbiAgICAgICAgZm9yIChjb25zdCBjZWxsIG9mIHZvcm9ub2kuY2VsbHMpIHtcbiAgICAgICAgICAgIGNvbnN0IHNpdGUgPSBjZWxsLnNpdGU7XG4gICAgICAgICAgICBjb25zdCBwb3MgPSBuZXcgVmVjdG9yKHNpdGUueCwgc2l0ZS55KTtcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG5ldyBDZW50ZXIocG9zKTtcbiAgICAgICAgICAgIGNlbnRlci5pZCA9IHNpdGUudm9yb25vaUlkO1xuICAgICAgICAgICAgY2VudGVyTG9va3VwW3Bvcy5rZXkoKV0gPSBjZW50ZXI7XG4gICAgICAgICAgICB0aGlzLmNlbnRlcnMucHVzaChjZW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGFuZCBjb3B5IG92ZXIgdGhlIGVkZ2VzIGFuZCBjb3JuZXJzXG4gICAgICAgIC8vIFRoaXMgcG9ydGlvbiBhbHNvIGNyZWF0ZXMgdGhlIGNvbm5lY3Rpb25zIGJldHdlZW4gYWxsIHRoZSBub2Rlc1xuICAgICAgICBmb3IgKGxldCBlZGdlIG9mIHZvcm9ub2kuZWRnZXMpIHtcblxuICAgICAgICAgICAgLy8gQ29udmVydCB2b3Jvbm9pIGVkZ2UgdG8gYSB1c2VhYmxlIGZvcm1cbiAgICAgICAgICAgIC8vIENvcm5lciBwb3NpdGlvbnNcbiAgICAgICAgICAgIGNvbnN0IHZhID0gbmV3IFZlY3RvcihNYXRoLnJvdW5kKGVkZ2UudmEueCksIE1hdGgucm91bmQoZWRnZS52YS55KSk7XG4gICAgICAgICAgICBjb25zdCB2YiA9IG5ldyBWZWN0b3IoTWF0aC5yb3VuZChlZGdlLnZiLngpLCBNYXRoLnJvdW5kKGVkZ2UudmIueSkpO1xuICAgICAgICAgICAgLy8gQ2VudGVyIHBvc2l0aW9uc1xuICAgICAgICAgICAgY29uc3Qgc2l0ZTEgPSBuZXcgVmVjdG9yKGVkZ2UubFNpdGUueCwgZWRnZS5sU2l0ZS55KTtcbiAgICAgICAgICAgIGNvbnN0IHNpdGUyID0gZWRnZS5yU2l0ZSA/IG5ldyBWZWN0b3IoZWRnZS5yU2l0ZS54LCBlZGdlLnJTaXRlLnkpIDogbnVsbDtcblxuICAgICAgICAgICAgLy8gTG9va3VwIHRoZSB0d28gY2VudGVyIG9iamVjdHNcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlcjEgPSBjZW50ZXJMb29rdXBbc2l0ZTEua2V5KCldO1xuICAgICAgICAgICAgY29uc3QgY2VudGVyMiA9IHNpdGUyID8gY2VudGVyTG9va3VwW3NpdGUyLmtleSgpXSA6IG51bGw7XG5cbiAgICAgICAgICAgIC8vIExvb2t1cCB0aGUgY29ybmVyIG9iamVjdHMgYW5kIGlmIG9uZSBpc24ndCBjcmVhdGVkXG4gICAgICAgICAgICAvLyBjcmVhdGUgb25lIGFuZCBhZGQgaXQgdG8gY29ybmVycyBzZXRcbiAgICAgICAgICAgIGxldCBjb3JuZXIxO1xuICAgICAgICAgICAgbGV0IGNvcm5lcjI7XG5cbiAgICAgICAgICAgIGNvbnN0IGlzQm9yZGVyID0gKHBvaW50LCBiYm94KSA9PiBwb2ludC54IDw9IGJib3gueGwgfHwgcG9pbnQueCA+PSBiYm94LnhyIHx8XG4gICAgICAgICAgICAgICAgcG9pbnQueSA8PSBiYm94Lnl0IHx8IHBvaW50LnkgPj0gYmJveC55YjtcblxuICAgICAgICAgICAgaWYgKCFoYXMoY29ybmVyTG9va3VwLCB2YS5rZXkoKSkpIHtcbiAgICAgICAgICAgICAgICBjb3JuZXIxID0gbmV3IENvcm5lcih2YSk7XG4gICAgICAgICAgICAgICAgY29ybmVyMS5pZCA9IGNvcm5lcklkKys7XG4gICAgICAgICAgICAgICAgY29ybmVyMS5ib3JkZXIgPSBpc0JvcmRlcih2YSwgdGhpcy5iYm94KTtcbiAgICAgICAgICAgICAgICBjb3JuZXJMb29rdXBbdmEua2V5KCldID0gY29ybmVyMTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvcm5lcnMucHVzaChjb3JuZXIxKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29ybmVyMSA9IGNvcm5lckxvb2t1cFt2YS5rZXkoKV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWhhcyhjb3JuZXJMb29rdXAsIHZiLmtleSgpKSkge1xuICAgICAgICAgICAgICAgIGNvcm5lcjIgPSBuZXcgQ29ybmVyKHZiKTtcbiAgICAgICAgICAgICAgICBjb3JuZXIyLmlkID0gY29ybmVySWQrKztcbiAgICAgICAgICAgICAgICBjb3JuZXIyLmJvcmRlciA9IGlzQm9yZGVyKHZiLCB0aGlzLmJib3gpO1xuICAgICAgICAgICAgICAgIGNvcm5lckxvb2t1cFt2Yi5rZXkoKV0gPSBjb3JuZXIyO1xuICAgICAgICAgICAgICAgIHRoaXMuY29ybmVycy5wdXNoKGNvcm5lcjIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb3JuZXIyID0gY29ybmVyTG9va3VwW3ZiLmtleSgpXTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBlZGdlIG9iamVjdHNcbiAgICAgICAgICAgIGNvbnN0IG5ld0VkZ2UgPSBuZXcgRWRnZSgpO1xuICAgICAgICAgICAgbmV3RWRnZS5pZCA9IGVkZ2VJZCsrO1xuICAgICAgICAgICAgbmV3RWRnZS5kMCA9IGNlbnRlcjE7XG4gICAgICAgICAgICBuZXdFZGdlLmQxID0gY2VudGVyMjtcbiAgICAgICAgICAgIG5ld0VkZ2UudjAgPSBjb3JuZXIxO1xuICAgICAgICAgICAgbmV3RWRnZS52MSA9IGNvcm5lcjI7XG4gICAgICAgICAgICBuZXdFZGdlLm1pZHBvaW50ID0gVmVjdG9yLm1pZHBvaW50KGNvcm5lcjEsIGNvcm5lcjIpO1xuXG4gICAgICAgICAgICAvLyBVcGRhdGUgdGhlIGNvcm5lciBvYmplY3RzXG4gICAgICAgICAgICBjb3JuZXIxLnByb3RydWRlcy5wdXNoKG5ld0VkZ2UpO1xuICAgICAgICAgICAgY29ybmVyMi5wcm90cnVkZXMucHVzaChuZXdFZGdlKTtcblxuICAgICAgICAgICAgaWYgKCFjb3JuZXIxLnRvdWNoZXMuaW5jbHVkZXMoY2VudGVyMSkpIHtcbiAgICAgICAgICAgICAgICBjb3JuZXIxLnRvdWNoZXMucHVzaChjZW50ZXIxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjZW50ZXIyICYmICFjb3JuZXIxLnRvdWNoZXMuaW5jbHVkZXMoY2VudGVyMikpIHtcbiAgICAgICAgICAgICAgICBjb3JuZXIxLnRvdWNoZXMucHVzaChjZW50ZXIyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghY29ybmVyMi50b3VjaGVzLmluY2x1ZGVzKGNlbnRlcjEpKSB7XG4gICAgICAgICAgICAgICAgY29ybmVyMi50b3VjaGVzLnB1c2goY2VudGVyMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY2VudGVyMiAmJiAhY29ybmVyMi50b3VjaGVzLmluY2x1ZGVzKGNlbnRlcjIpKSB7XG4gICAgICAgICAgICAgICAgY29ybmVyMi50b3VjaGVzLnB1c2goY2VudGVyMik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvcm5lcjEuYWRqYWNlbnQucHVzaChjb3JuZXIyKTtcbiAgICAgICAgICAgIGNvcm5lcjIuYWRqYWNlbnQucHVzaChjb3JuZXIxKTtcblxuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBjZW50ZXIgb2JqZWN0c1xuICAgICAgICAgICAgY2VudGVyMS5ib3JkZXJzLnB1c2gobmV3RWRnZSk7XG4gICAgICAgICAgICBpZiAoY2VudGVyMikge1xuICAgICAgICAgICAgICAgIGNlbnRlcjIuYm9yZGVycy5wdXNoKG5ld0VkZ2UpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWNlbnRlcjEuY29ybmVycy5pbmNsdWRlcyhjb3JuZXIxKSkge1xuICAgICAgICAgICAgICAgIGNlbnRlcjEuY29ybmVycy5wdXNoKGNvcm5lcjEpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFjZW50ZXIxLmNvcm5lcnMuaW5jbHVkZXMoY29ybmVyMikpIHtcbiAgICAgICAgICAgICAgICBjZW50ZXIxLmNvcm5lcnMucHVzaChjb3JuZXIyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjZW50ZXIyICYmICFjZW50ZXIyLmNvcm5lcnMuaW5jbHVkZXMoY29ybmVyMSkpIHtcbiAgICAgICAgICAgICAgICBjZW50ZXIyLmNvcm5lcnMucHVzaChjb3JuZXIxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjZW50ZXIyICYmICFjZW50ZXIyLmNvcm5lcnMuaW5jbHVkZXMoY29ybmVyMikpIHtcbiAgICAgICAgICAgICAgICBjZW50ZXIyLmNvcm5lcnMucHVzaChjb3JuZXIyKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNlbnRlcjIpIHtcbiAgICAgICAgICAgICAgICBjZW50ZXIxLm5laWdoYm9ycy5wdXNoKGNlbnRlcjIpO1xuICAgICAgICAgICAgICAgIGNlbnRlcjIubmVpZ2hib3JzLnB1c2goY2VudGVyMSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIElmIGVpdGhlciBjb3JuZXIgaXMgYSBib3JkZXIsIGJvdGggY2VudGVycyBhcmUgYm9yZGVyc1xuICAgICAgICAgICAgY2VudGVyMS5ib3JkZXIgPSBjZW50ZXIxLmJvcmRlciB8fCBjb3JuZXIxLmJvcmRlciB8fCBjb3JuZXIyLmJvcmRlcjtcbiAgICAgICAgICAgIGlmIChjZW50ZXIyKSB7XG4gICAgICAgICAgICAgICAgY2VudGVyMi5ib3JkZXIgPSBjZW50ZXIyLmJvcmRlciB8fCBjb3JuZXIxLmJvcmRlciB8fCBjb3JuZXIyLmJvcmRlcjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5lZGdlcy5wdXNoKG5ld0VkZ2UpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIGRpYWdyYW1cbiAgICAvL1xuICAgIC8vIExsb3lkIHJlbGF4YXRpb24gaGVscGVkIHRvIGNyZWF0ZSB1bmlmb3JtaXR5IGFtb25nIHBvbHlnb24gY29ybmVycyxcbiAgICAvLyBUaGlzIGZ1bmN0aW9uIGNyZWF0ZXMgdW5pZm9ybWl0eSBhbW9uZyBwb2x5Z29uIGNvcm5lcnMgYnkgc2V0dGluZyB0aGUgY29ybmVyc1xuICAgIC8vIHRvIHRoZSBhdmVyYWdlIG9mIHRoZWlyIG5laWdoYm9yc1xuICAgIC8vIFRoaXMgYnJlYWtlcyB0aGUgdm9yb25vaSBkaWFncmFtIHByb3BlcnRpZXNcbiAgICBpbXByb3ZlQ29ybmVycygpIHtcbiAgICAgICAgY29uc3QgbmV3Q29ybmVycyA9IFtdO1xuXG4gICAgICAgIC8vIENhbGN1bGF0ZSBuZXcgY29ybmVyIHBvc2l0aW9uc1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuY29ybmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgbGV0IGNvcm5lciA9IHRoaXMuY29ybmVyc1tpXTtcblxuICAgICAgICAgICAgaWYgKGNvcm5lci5ib3JkZXIpIHtcbiAgICAgICAgICAgICAgICBuZXdDb3JuZXJzW2ldID0gY29ybmVyO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsZXQgbmV3UG9zID0gVmVjdG9yLnplcm8oKTtcblxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgbmVpZ2hib3Igb2YgY29ybmVyLnRvdWNoZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgbmV3UG9zID0gVmVjdG9yLmFkZChuZXdQb3MsIG5laWdoYm9yKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBuZXdQb3MgPSBuZXdQb3MuZGl2aWRlKGNvcm5lci50b3VjaGVzLmxlbmd0aCk7XG4gICAgICAgICAgICAgICAgbmV3Q29ybmVyc1tpXSA9IG5ld1BvcztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFzc2lnbiBuZXcgY29ybmVyIHBvc2l0aW9uc1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuY29ybmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgbGV0IGNvcm5lciA9IHRoaXMuY29ybmVyc1tpXTtcbiAgICAgICAgICAgIGNvcm5lciA9IG5ld0Nvcm5lcnNbaV07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWNvbXB1dGUgZWRnZSBtaWRwb2ludHNcbiAgICAgICAgZm9yIChjb25zdCBlZGdlIG9mIHRoaXMuZWRnZXMpIHtcbiAgICAgICAgICAgIGlmIChlZGdlLnYwICYmIGVkZ2UudjEpIHtcbiAgICAgICAgICAgICAgICBlZGdlLm1pZHBvaW50ID0gVmVjdG9yLm1pZHBvaW50KGVkZ2UudjAsIGVkZ2UudjEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBTb3J0cyB0aGUgY29ybmVycyBpbiBjbG9ja3dpc2Ugb3JkZXIgc28gdGhhdCB0aGV5IGNhbiBiZSBwcmludGVkIHByb3Blcmx5XG4gICAgLy8gdXNpbmcgYSBzdGFuZGFyZCBwb2x5Z29uIGRyYXdpbmcgbWV0aG9kXG5cbiAgICBzb3J0Q29ybmVycygpIHtcbiAgICAgICAgZm9yIChjb25zdCBjZW50ZXIgb2YgdGhpcy5jZW50ZXJzKSB7XG4gICAgICAgICAgICBjb25zdCBjb21wID0gdGhpcy5jb21wYXJlUG9seVBvaW50cyhjZW50ZXIpO1xuICAgICAgICAgICAgY2VudGVyLmNvcm5lcnMuc29ydChjb21wKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gQ29tcGFyaXNvbiBmdW5jdGlvbiBmb3Igc29ydGluZyBwb2x5Z29uIHBvaW50cyBpbiBjbG9ja3dpc2Ugb3JkZXJcbiAgICAvLyBhc3N1bWluZyBhIGNvbnZleCBwb2x5Z29uXG4gICAgLy8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy82OTg5MTAwL3NvcnQtcG9pbnRzLWluLWNsb2Nrd2lzZS1vcmRlclxuICAgIGNvbXBhcmVQb2x5UG9pbnRzKGMpIHtcbiAgICAgICAgY29uc3QgY2VudGVyID0gYztcbiAgICAgICAgcmV0dXJuIChwMSwgcDIpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGEgPSBwMSxcbiAgICAgICAgICAgICAgICBiID0gcDI7XG5cbiAgICAgICAgICAgIGlmIChhLnggLSBjZW50ZXIueCA+PSAwICYmIGIueCAtIGNlbnRlci54IDwgMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAtMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChhLnggLSBjZW50ZXIueCA8IDAgJiYgYi54IC0gY2VudGVyLnggPj0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGEueCAtIGNlbnRlci54ID09PSAwICYmIGIueCAtIGNlbnRlci54ID09PSAwKSB7XG4gICAgICAgICAgICAgICAgaWYgKGEueSAtIGNlbnRlci55ID49IDAgfHwgYi55IC0gY2VudGVyLnkgPj0gMCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoYS55ID4gYi55KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gLTE7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoYi55ID4gYS55KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAtMTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGNvbXB1dGUgdGhlIGNyb3NzIHByb2R1Y3Qgb2YgdmVjdG9ycyAoY2VudGVyIC0+IGEpIHggKGNlbnRlciAtPiBiKVxuICAgICAgICAgICAgY29uc3QgZGV0ID0gKGEueCAtIGNlbnRlci54KSAqIChiLnkgLSBjZW50ZXIueSkgLSAoYi54IC0gY2VudGVyLngpICogKGEueSAtIGNlbnRlci55KTtcbiAgICAgICAgICAgIGlmIChkZXQgPCAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIC0xO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRldCA+IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gcG9pbnRzIGEgYW5kIGIgYXJlIG9uIHRoZSBzYW1lIGxpbmUgZnJvbSB0aGUgY2VudGVyXG4gICAgICAgICAgICAvLyBjaGVjayB3aGljaCBwb2ludCBpcyBjbG9zZXIgdG8gdGhlIGNlbnRlclxuICAgICAgICAgICAgY29uc3QgZDEgPSAoYS54IC0gY2VudGVyLngpICogKGEueCAtIGNlbnRlci54KSArIChhLnkgLSBjZW50ZXIueSkgKiAoYS55IC0gY2VudGVyLnkpO1xuICAgICAgICAgICAgY29uc3QgZDIgPSAoYi54IC0gY2VudGVyLngpICogKGIueCAtIGNlbnRlci54KSArIChiLnkgLSBjZW50ZXIueSkgKiAoYi55IC0gY2VudGVyLnkpO1xuICAgICAgICAgICAgaWYgKGQxID4gZDIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gLTE7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiAxO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH07XG4gICAgfVxuXG59XG5cbmV4cG9ydCBkZWZhdWx0IERpYWdyYW07IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi4vZ2VvbWV0cnkvVmVjdG9yXCI7XG5pbXBvcnQgTGluZSBmcm9tIFwiLi4vZ2VvbWV0cnkvTGluZVwiO1xuXG5jbGFzcyBFZGdlIGV4dGVuZHMgTGluZSB7XG4gICAgLyoqXG4gICAgICogRWRnZSBjb25uZWN0aW9ucyBiZXR3ZWVuIGNlbnRlcnMgYW5kIGNvcm5lcnMgaW4gdGhlIFZvcm9ub2kvRGVsYXVuYXlcbiAgICAgKiBncmFwaC5cbiAgICAgKiBcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0gaWQgVGhlIGlkIG9mIHRoZSBlZGdlIGluIHRoZSBncmFwaCBvYmplY3RcbiAgICAgKiBAcHJvcGVydHkge1ZlY3Rvcn0gZDAgVGhlIGZpcnN0IHBvbHlnb24gY2VudGVyIG9mIHRoZSBkZWxhdW5heSBncmFwaFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSBkMSBUaGUgc2Vjb25kIHBvbHlnb24gY2VudGVyIG9mIHRoZSBkZWxhdW5heSBncmFwaFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSB2MCBUaGUgZmlyc3QgY29ybmVyIG9iamVjdCBvZiB0aGUgdm9yb25vaSBncmFwaFxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSB2MSBUaGUgc2Vjb25kIGNvcm5lciBvYmplY3Qgb2YgdGhlIHZvcm9ub2kgZ3JhcGhcbiAgICAgKiBcbiAgICAgKiBAY2xhc3MgRWRnZVxuICAgICAqIEBleHRlbmRzIHtMaW5lfVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHYwLCB2MSkge1xuICAgICAgICBzdXBlcih2MCwgdjEpO1xuICAgICAgICB0aGlzLmlkID0gLTE7XG4gICAgICAgIC8vIFBvbHlnb24gY2VudGVyIG9iamVjdHMgY29ubmVjdGVkIGJ5IERlbGF1bmF5IGVkZ2VzXG4gICAgICAgIHRoaXMuZDAgPSBudWxsO1xuICAgICAgICB0aGlzLmQxID0gbnVsbDtcbiAgICAgICAgLy8gQ29ybmVyIG9iamVjdHMgY29ubmVjdGVkIGJ5IFZvcm9ub2kgZWRnZXNcbiAgICAgICAgdGhpcy52MCA9IG51bGw7XG4gICAgICAgIHRoaXMudjEgPSBudWxsO1xuICAgICAgICB0aGlzLm1pZHBvaW50ID0gbnVsbDtcbiAgICAgICAgdGhpcy5ib3JkZXIgPSBmYWxzZTtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IEVkZ2U7IiwiaW1wb3J0IERpYWdyYW0gZnJvbSBcIi4vRGlhZ3JhbVwiO1xyXG5cclxuY2xhc3MgTWFwIGV4dGVuZHMgRGlhZ3JhbSB7XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDcmVhdGVzIGFuIGluc3RhbmNlIG9mIE1hcC5cclxuICAgICAqIFxyXG4gICAgICogQHBhcmFtIHthbnl9IHBvaW50cyBcclxuICAgICAqIEBwYXJhbSB7YW55fSBiYm94IFxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IFtyZWxheGF0aW9ucz0wXSBcclxuICAgICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2ltcHJvdmVDb3JuZXJzPWZhbHNlXSBcclxuICAgICAqIFxyXG4gICAgICogQGNsYXNzIE1hcFxyXG4gICAgICogQGV4dGVuZHMgRGlhZ3JhbVxyXG4gICAgICovXHJcbiAgICBjb25zdHJ1Y3Rvcihwb2ludHMsIGJib3gsIHJlbGF4YXRpb25zID0gMCwgaW1wcm92ZUNvcm5lcnMgPSBmYWxzZSkge1xyXG4gICAgICAgIHN1cGVyKHBvaW50cywgYmJveCwgcmVsYXhhdGlvbnMgPSAwLCBpbXByb3ZlQ29ybmVycyA9IGZhbHNlKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFRoaXMgZnVuY3Rpb24gaXMgdXNlZCB0byBjYWxsIGNlbGx1bGFyIGF1dG9taXRhIG9uIHRoZSBncmFwaCBvYmplY3QuXHJcbiAgICAgKiBUaGUgcnVsZXNldCBmdW5jdGlvbiBzaG91bGQgZm9sbG93IHRoZSBmb2xsb3dpbmcgcHJvcGVydGllcyBzbyB0aGF0XHJcbiAgICAgKiB0aGUgYXV0b21hdGlvbiBjYW4gcnVuIHByb3Blcmx5LiBTZWUgdGhlIGV4YW1wbGUgZm9yIHRoZSBkZXRhaWxzXHJcbiAgICAgKiBcclxuICAgICAqIEBzdW1tYXJ5IFJ1biBhIGdlbmVyYXRpb24gb2YgY2VsbHVsYXIgYXV0b21hdGlvbiBhY2NvcmRpbmcgdG8gYSB1c2VyXHJcbiAgICAgKiAgc3BlY2lmaWVkIHJ1bGUgc2V0XHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSB7ZnVuY3Rpb259IHJ1bGVzZXQgVGhlXHJcbiAgICAgKiBcclxuICAgICAqIEBleGFtcGxlXHJcbiAgICAgKiBcclxuICAgICAqIHZhciBnYW1lT2ZMaWZlID0gZnVuY3Rpb24oY2VudGVyKSB7XHJcbiAgICAgKiAgIHZhciBuID0gY2VudGVyLm5laWdoYm9ycy5sZW5ndGg7XHJcbiAgICAgKiAgIHJldHVybiB7IFxyXG4gICAgICogICAgIGFsaXZlOiBjZW50ZXIuZGF0YS5hbGl2ZSAmJiAobiA9PT0gMiB8fCBuID09PSAzKSB8fFxyXG4gICAgICogICAgICAgICAgICFjZW50ZXIuZGF0YS5hbGl2ZSAmJiBuID09PSAzXHJcbiAgICAgKiAgIH07XHJcbiAgICAgKiB9XHJcbiAgICAgKiBcclxuICAgICAqIEB0b2RvIEZpbmQgYSBOZXcgTmFtZVxyXG4gICAgICogQG1lbWJlck9mIE1hcFxyXG4gICAgICovXHJcbiAgICBfZ2VuZXJhdGUocnVsZXNldCkge1xyXG4gICAgICAgIC8vIFJ1biBjZWxsdWxhciBhdXRvbWl0YVxyXG4gICAgICAgIGZvciAobGV0IGNlbnRlciBvZiB0aGlzLmNlbnRlcnMpIHtcclxuICAgICAgICAgICAgY2VudGVyLl9kYXRhID0gcnVsZXNldChjZW50ZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gVXBkYXRlIGF1dG9taXRhIGFjdGlvbnNcclxuICAgICAgICBmb3IgKGxldCBjZW50ZXIgb2YgdGhpcy5jZW50ZXJzKSB7XHJcbiAgICAgICAgICAgIC8vIFVwZGF0ZSBvbmx5IHRoZSBuZXcgZGF0YSB0aGF0IGhhcyBjaGFuZ2VkXHJcbiAgICAgICAgICAgIGZvciAobGV0IGtleSBpbiBjZW50ZXIuX2RhdGEpIHtcclxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXIuX2RhdGEuaGFzT3duUHJvcGVydHkoa2V5KSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNlbnRlci5kYXRhW2tleV0gPSBjZW50ZXIuX2RhdGFba2V5XTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBkZWxldGUgY2VudGVyLl9kYXRhO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpbml0aWFsaXplKHJ1bGVzZXQpIHtcclxuICAgICAgICB0aGlzLl9nZW5lcmF0ZShydWxlc2V0KTtcclxuICAgIH1cclxuXHJcbiAgICBpdGVyYXRlKHJ1bGVzZXQpIHtcclxuICAgICAgICB0aGlzLl9nZW5lcmF0ZShydWxlc2V0KTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgTWFwOyIsImltcG9ydCBWZWN0b3IgZnJvbSBcIi4vZ2VvbWV0cnkvVmVjdG9yXCI7XG5pbXBvcnQgU2hhcGUgZnJvbSBcIi4vZ2VvbWV0cnkvU2hhcGVcIjtcbmltcG9ydCBMaW5lIGZyb20gXCIuL2dlb21ldHJ5L0xpbmVcIjtcbmltcG9ydCBQb2x5Z29uIGZyb20gXCIuL2dlb21ldHJ5L1BvbHlnb25cIjtcbmltcG9ydCBSZWN0YW5nbGUgZnJvbSBcIi4vZ2VvbWV0cnkvUmVjdGFuZ2xlXCI7XG5pbXBvcnQgVHJpYW5nbGUgZnJvbSBcIi4vZ2VvbWV0cnkvVHJpYW5nbGVcIjtcbmltcG9ydCBDZW50ZXIgZnJvbSBcIi4vZ3JhcGgvQ2VudGVyXCI7XG5pbXBvcnQgQ29ybmVyIGZyb20gXCIuL2dyYXBoL0Nvcm5lclwiO1xuaW1wb3J0IEVkZ2UgZnJvbSBcIi4vZ3JhcGgvRWRnZVwiO1xuaW1wb3J0IERpYWdyYW0gZnJvbSBcIi4vZ3JhcGgvRGlhZ3JhbVwiO1xuaW1wb3J0IE1hcCBmcm9tIFwiLi9ncmFwaC9NYXBcIjtcbmltcG9ydCAqIGFzIFBvaW50RGlzdHJpYnV0aW9uIGZyb20gXCIuL1V0aWxpdGllcy9Qb2ludERpc3RyaWJ1dGlvblwiO1xuaW1wb3J0ICogYXMgUmVkaXN0IGZyb20gXCIuL3V0aWxpdGllcy9SZWRpc3RcIjtcbmltcG9ydCBSYW5kIGZyb20gXCIuL3V0aWxpdGllcy9SYW5kXCI7XG5cbi8qKlxuICogVGhlIEF0dW0gcHJvY2VkdXJhbCBncmFwaCBiYXNlZCBsaWJyYXJ5XG4gKiBcbiAqIEBleHBvcnRcbiAqIEBtb2R1bGUgQXR1bVxuICogQHNlZSB7QGxpbmsgaHR0cHM6Ly9naXRodWIuY29tL0V2ZWxpb3MvQXR1bX1cbiAqL1xuY29uc3QgQXR1bSA9IHtcbiAgICBHZW9tZXRyeToge1xuICAgICAgICBWZWN0b3IsXG4gICAgICAgIFNoYXBlLFxuICAgICAgICBMaW5lLFxuICAgICAgICBQb2x5Z29uLFxuICAgICAgICBSZWN0YW5nbGUsXG4gICAgICAgIFRyaWFuZ2xlXG4gICAgfSxcbiAgICBHcmFwaDoge1xuICAgICAgICBDZW50ZXIsXG4gICAgICAgIENvcm5lcixcbiAgICAgICAgRWRnZSxcbiAgICAgICAgRGlhZ3JhbSxcbiAgICAgICAgTWFwXG4gICAgfSxcbiAgICBVdGlsaXR5OiB7XG4gICAgICAgIFBvaW50RGlzdHJpYnV0aW9uLFxuICAgICAgICBSZWRpc3QsXG4gICAgICAgIFJhbmRcbiAgICB9XG59O1xuXG5leHBvcnQgZGVmYXVsdCBBdHVtOyIsIi8qKlxuICogVGhlc2VzIGZ1bmN0aW9uIGFyZSB1c2VkIHRvIHJlZGlzdHJpYnV0ZSBkYXRhIGxvY2F0ZWQgaW4gdGhlIHJhbmdlIDAtMVxuICogVGhleSB0YWtlIGFsbCB0aGUgZGF0YSBhbmQgcmVhcnJhbmdlIHRoZW0gYW5kIHB1cnR1cmJlIHRoZW0gc2xpZ2h0bHkgc28gdGhhdFxuICogdGhleSBmaXQgYSBwYXJ0aWN1bGFyIGRpc3RydWJ1dGlvbiBmdW5jdGlvbi4gRm9yIGV4YW1wbGUgeW91IGNhbiB1c2UgdGhlc2VcbiAqIHRvIHB1c2ggYWxsIHRoZSBkYXRhIHBvaW50cyBjbG9zZXIgdG8gMSBzbyB0aGF0IHRoZXJlIGFyZSBmZXcgcG9pbnRzIG5lYXIgMFxuICogZWFjaCByZWRpc3RyaWJ1dGlvbiBmdW5jdGlvbiBoYXMgZGlmZmVyZW50IHByb3BlcnRpZXMuXG4gKlxuICogUHJvcGVydGllcyBvZiB0aGVzZSBmdW5jdGlvbnNcbiAqIHRoZSBkb21haW4gaXMgKDAtMSkgZm9yIHRoZSByYW5nZSAoMC0xKVxuICogaW4gdGhpcyByYW5nZSB0aGUgZnVuY3Rpb24gaXMgb25lIHRvIG9uZVxuICogZigwKSA9PSAwIGFuZCBmKDEpID09IDFcbiAqIFxuICogQHN1bW1hcnkgRnVuY3Rpb25zIHVzZWQgdG8gcmVkaXN0cnVidXRlIHZhbHVlcyBpbiB0aGUgcmFuZ2UgMC0xXG4gKiBAY2xhc3MgUmVkaXN0XG4gKi9cblxuXCJ1c2Ugc3RyaWN0XCI7XG5cbi8qKlxuICogVGhlIGlkZW50aXR5IGZ1bmN0aW9uLiBJdCByZXR1cm5zIHRoZSBpbnB1dCB2YWx1ZSB4XG4gKiBcbiAqIEBleHBvcnRcbiAqIEBmdW5jdGlvblxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIGlucHV0IG51bWJlciBpbiB0aGUgcmFuZ2UgWzAtMV1cbiAqIEByZXR1cm5zIHtOdW1iZXJ9IElucHV0IHZhbHVlXG4gKiBAbWVtYmVyb2YgUmVkaXN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpZGVudGl0eSh4KSB7XG4gICAgcmV0dXJuIHg7XG59XG5cbi8qKlxuICogVGhlIGludmVyc2UgZnVjdGlvbi4gSXQgcmV0dXJucyB0aGUgb3Bwb3NpdGUgb2YgdGhlIGZ1bmN0aW9uIGluIHRoZSByYW5nZVxuICogZnJvbSBbMC0xXS4gVGhpcyBpcyBzaW1wbHkgMSAtIHguXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBmdW5jdGlvblxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIGlucHV0IG51bWJlciBpbiB0aGUgcmFuZ2UgWzAtMV1cbiAqIEByZXR1cm5zIHtOdW1iZXJ9IFRoZSByZWRpc3RyaWJ1dGVkIGlucHV0IHZhbHVlLCAxIC0geFxuICogQG1lbWJlcm9mIFJlZGlzdFxuICovXG5leHBvcnQgZnVuY3Rpb24gaW52ZXJzZSh4KSB7XG4gICAgcmV0dXJuIDEgLSB4O1xufVxuXG4vKipcbiAqIEV4cG9uZW50aWFsIHJlZGlzdHJpYnV0aW9uIGZ1bmN0aW9uLiBUaGlzIGZ1bmN0aW9uIHNrZXdzIHRoZSB2YWx1ZXMgZWl0aGVyXG4gKiB1cCBvciBkb3duIGJ5IGEgcGFydGljdWxhciBhbW1vdW50IGFjY29yZGluZyB0aGUgaW5wdXQgcGFyYW1ldGVycy4gVGhlXG4gKiBvdXRwdXQgZGlzdHJpYnV0aW9uIHdpbGwgYmUgc2xpZ2h0IGV4cG9uZW50aWFsIHNoYXBlZC5cbiAqIFxuICogQGV4cG9ydFxuICogQGZ1bmN0aW9uXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgaW5wdXQgbnVtYmVyIGluIHRoZSByYW5nZSBbMC0xXVxuICogQHBhcmFtIHtOdW1iZXJ9IFthbW09MV0gVGhlIHN0cmVuZ3RoIG9mIHRoZSByZWRpc3RyaWJ1dGlvblxuICogQHBhcmFtIHtCb29sZWFufSBbaW5jPXRydWVdIElmIHlvdSB3YW50IHRvIGluY3JlYXNlIG9yIGRlY3JlYXNlIHRoZSBpbnB1dFxuICogQHJldHVybnMge051bWJlcn0gVGhlIHJlZGlzdHJpYnV0ZWQgaW5wdXQgdmFsdWVcbiAqIEBtZW1iZXJvZiBSZWRpc3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4cCh4LCBhbW0gPSAxLCBpbmMgPSB0cnVlKSB7XG4gICAgbGV0IG5vbSwgZGVub207XG4gICAgaWYgKGluYykge1xuICAgICAgICBub20gPSAxIC0gTWF0aC5leHAoLWFtbSAqIHgpO1xuICAgICAgICBkZW5vbSA9IDEgLSBNYXRoLmV4cCgtYW1tKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBub20gPSBNYXRoLmV4cChhbW0gKiB4KSAtIDE7XG4gICAgICAgIGRlbm9tID0gTWF0aC5leHAoYW1tKSAtIDE7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5vbSAvIGRlbm9tO1xufVxuXG4vLyBQb3dlciBGdW5jdGlvbiBlZyBzcXJ0IHF1YnJ0XG4vKipcbiAqIFBvd2VyIHJlZGlzdHJpYnV0aW9uIGZ1bmN0aW9uLiBUaGlzIGZ1bmN0aW9uIHNrZXdzIHZhbHVlcyBlaXRoZXIgdXAgb3IgZG93blxuICogYnkgYSBwYXJ0aWN1bGFyIGFtbW91bnQgYWNjb3JkaW5nIHRvIHRoZSBpbnB1dCBwYXJhbWV0ZXJzLiBUaGUgcG93ZXIgXG4gKiBkaXN0cmlidXRpb24gYWxzbyBoYXMgYSBzbGlnaHQgc2tldyB1cCBvciBkb3duIG9uIHRvcCBvZiB0aGUgcmVkaXN0cmlidXRpb24uXG4gKiBcbiAqIEBleHBvcnRcbiAqIEBmdW5jdGlvblxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIGlucHV0IG51bWJlciBpbiB0aGUgcmFuZ2UgWzAtMV0gXG4gKiBAcGFyYW0ge051bWJlcn0gW2FtbT0yXSBUaGUgc3RyZW5ndGggb2YgdGhlIHJlZGlzdHJpYnV0aW9uXG4gKiBAcGFyYW0ge0Jvb2xlYW59IFtpbmM9dHJ1ZV0gSWYgeW91IHdhbnQgdG8gaW5jcmVhc2Ugb3IgZGVjcmVhc2UgdGhlIGlucHV0XG4gKiBAcGFyYW0ge0Jvb2xlYW59IFtza2V3RG93bj10cnVlXSBJZiB5b3Ugd2FudCB0byBza2V3IHRoZSBpbnB1dCB2YWx1ZSBkb3duXG4gKiAgdG93YXJkcyAwLCB0aGVuIHNrZXdEb3duPXRydWUuIElmIHlvdSB3YW50IHRvIHNrZXcgdGhlIGlucHV0IHZhbHVlIHVwIFxuICogIHRvd2FyZHMgMSwgdGhlbiBza2V3RG93bj1mYWxzZVxuICogQHJldHVybnMge051bWJlcn0gVGhlIHJlZGlzdHJpYnV0ZWQgaW5wdXQgdmFsdWVcbiAqIEBtZW1iZXJvZiBSZWRpc3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBvdyh4LCBhbW0gPSAyLCBpbmMgPSB0cnVlLCBza2V3RG93biA9IHRydWUpIHtcbiAgICBpZiAoaW5jKSB7XG4gICAgICAgIGlmIChza2V3RG93bikge1xuICAgICAgICAgICAgcmV0dXJuIE1hdGgucG93KHgsIDEgLyBhbW0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIDEgLSBNYXRoLnBvdygxIC0geCwgYW1tKTtcbiAgICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChza2V3RG93bikge1xuICAgICAgICAgICAgcmV0dXJuIE1hdGgucG93KHgsIGFtbSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gMSAtIE1hdGgucG93KDEgLSB4LCAxIC8gYW1tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLyoqXG4gKiBUdXJucyBhIGNvbnRpbmlvdXMgZnVuY3Rpb24gYW5kIHR1cm5zIGl0IGludG8gYSBkaXNjcmV0ZSBmdW5jdGlvbiB0aGF0IGhhc1xuICogYSBzcGVjaWZpYyBudW1iZXIgb2YgYmlucyB0byBidXQgdGhlIGRpc3RyaWJ1dGlvbiBpbnRvLlxuICogXG4gKiBAZXhwb3J0XG4gKiBAZnVuY3Rpb25cbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSBpbnB1dCBudW1iZXIgaW4gdGhlIHJhbmdlIFswLTFdXG4gKiBAcGFyYW0ge051bWJlcn0gW2JpbnM9MTBdIFRoZSBudW1iZXIgb2YgYmlucyBmb3IgdGhlIGRpc2NyaXRlIGRpc3RyaWJ1dGlvblxuICogQHJldHVybnMge051bWJlcn0gVGhlIGRpc2NyZXRpemVkIGlucHV0IHZhbHVlXG4gKiBAbWVtYmVyb2YgUmVkaXN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGVwKHgsIGJpbnMgPSAxMCkge1xuICAgIHJldHVybiBNYXRoLmZsb29yKGJpbnMgKiB4KSAvIGJpbnM7XG59IiwiLyoqXHJcbiAqIEEgdXRpbGl0eSBmaWxlIHdpdGggaGVscGVyIGZ1bmN0aW9ucyB0aGF0IGNhbiBiZSB1c2VkIHRvIGFpZCBpbiB0aGVcclxuICogZGV2ZWxvcG1lbnQgb2YgdGhlIHBhY2thZ2UuXHJcbiAqL1xyXG5cInVzZSBzdHJpY3RcIjtcclxuXHJcbi8vIFVzZWQgZm9yIHRlc3RpbmcgaWYgYW4gb2JqZWN0IGNvbnRhaW5zIGEgcGFydGljdWxhciBwcm9wZXJ0eVxyXG4vLyBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzcxNzQ3NDgvamF2YXNjcmlwdC1vYmplY3QtZGV0ZWN0aW9uLWRvdC1zeW50YXgtdmVyc3VzLWluLWtleXdvcmQvNzE3NDc3NSM3MTc0Nzc1XHJcbmV4cG9ydCBjb25zdCBoYXMgPSAob2JqLCBwcm9wKSA9PiB7IHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBwcm9wKTsgfTsiXX0=
