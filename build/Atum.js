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

},{"../geometry/Rectangle":16,"../geometry/Vector":18,"./Rand":13,"poisson-disk-sample":3}],13:[function(require,module,exports){
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
         * Private Helper Function:
         * Get a random float value in a particular range
         * 
         * @private
         * @static
         * @param {any} rng The local or global rng to use (Rand or this)
         * @param {any} min 
         * @param {any} max 
         * 
         * @memberof Rand
         */

    }, {
        key: "randRange",


        /**
         * Get a random float value in a particular range
         * 
         * @param {any} min 
         * @param {any} max 
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
         * @param {any} min 
         * @param {any} max 
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
         * @param {any} min 
         * @param {any} max 
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
        key: "_randRange",
        value: function _randRange(rng, min, max) {
            return rng.rand() * (max - min) + min;
        }

        /**
         * Get a random float value in a particular range
         * 
         * @static
         * @param {any} min 
         * @param {any} max 
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
         * @param {any} min 
         * @param {any} max 
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

},{"../geometry/Vector":18,"seedRandom":4}],14:[function(require,module,exports){
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

},{}],15:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Vector = require("./Vector");

var _Vector2 = _interopRequireDefault(_Vector);

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
     * @param {Vector[]} [verticies=[]] The corner verticies of the polygon
     * @param {Vector} [center=average(verticies)] The center of the polygon.
     *  If a value is not provided the default value becomes the centroid of
     *  the verticies.
     */
    function Polygon() {
        var verticies = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
        var center = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

        _classCallCheck(this, Polygon);

        this.corners = verticies ? verticies : [];
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
                    minY = Math.min(corner.y, miny);
                    maxY = Math.max(corner.y, maxy);
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

            this._bbox = new Rectangle(minx, miny, maxX - minX, maxY, minY);

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
    }]);

    return Polygon;
}();

exports.default = Polygon;
module.exports = exports["default"];

},{"./Vector":18}],16:[function(require,module,exports){
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


    _createClass(Rectangle, [{
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
         * @returns {boolean} True if the point is contained within 
         * @memberof Rectangle
         */

    }, {
        key: "contains",
        value: function contains(vector) {
            return vector.x > this.position.x && vector.x < this.position.x + this.width && vector.y > this.position.y && vector.y < this.positoin.y + this.height;
        }
    }], [{
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
}(_Polygon3.default);

exports.default = Rectangle;
module.exports = exports["default"];

},{"./Polygon":15,"./Vector":18}],17:[function(require,module,exports){
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

},{"./Polygon":15,"./Vector":18}],18:[function(require,module,exports){
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
        key: "toString",


        /**
         * Returns the vector as a string of (x, y)
         * 
         * @returns {string} The string representation of a vector in (x, y) form
         * @memberof Vector
         */
        value: function toString() {
            return "(" + this.x + ", " + this.y + ")";
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

},{}],19:[function(require,module,exports){
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

},{"../geometry/Polygon":15,"../geometry/Vector":18}],20:[function(require,module,exports){
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

},{"../geometry/Polygon":15,"../geometry/Vector":18}],21:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Graph2 = require("./Graph");

var _Graph3 = _interopRequireDefault(_Graph2);

var _Tile = require("./Tile");

var _Tile2 = _interopRequireDefault(_Tile);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

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

        var _this = _possibleConstructorReturn(this, (Diagram.__proto__ || Object.getPrototypeOf(Diagram)).call(this, points, bbox, relaxations = 0, improveCorners = false));

        _this.tiles = [];
        // _createTiles();
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

                    var tile = new tile(center, center.corners, center.borders);
                    this.centers.tile = tile;
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

                    this.tile.neighbors = _tile.center.neighbors.map(function (center) {
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
    }]);

    return Diagram;
}(_Graph3.default);

exports.default = Map;
module.exports = exports["default"];

},{"./Graph":23,"./Tile":24}],22:[function(require,module,exports){
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

},{"../geometry/Line":14,"../geometry/Vector":18}],23:[function(require,module,exports){
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

    return Graph;
}();

exports.default = Graph;
module.exports = exports["default"];

},{"../geometry/Vector":18,"../utilities/Util":28,"./Center":19,"./Corner":20,"./Edge":22,"Voronoi":1}],24:[function(require,module,exports){
"use strict";

var _Polygon2 = require("../geometry/Polygon");

var _Polygon3 = _interopRequireDefault(_Polygon2);

var _Graph = require("./Graph");

var _Graph2 = _interopRequireDefault(_Graph);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Tile = function (_Polygon) {
    _inherits(Tile, _Polygon);

    function Tile(center, corners, edges) {
        _classCallCheck(this, Tile);

        var _this = _possibleConstructorReturn(this, (Tile.__proto__ || Object.getPrototypeOf(Tile)).call(this, corners, center));

        ;
        _this.edges = edges;
        _this.neighbors = [];

        // Recursive Parameters
        _this.parent = parent;
        _this.children = children ? children : [];
        return _this;
    }

    return Tile;
}(_Polygon3.default);

},{"../geometry/Polygon":15,"./Graph":23}],25:[function(require,module,exports){
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
        Rand: _Rand2.default
    }
};

exports.default = Atum;
module.exports = exports["default"];

},{"./Utilities/PointDistribution":12,"./geometry/Line":14,"./geometry/Polygon":15,"./geometry/Rectangle":16,"./geometry/Triangle":17,"./geometry/Vector":18,"./graph/Center":19,"./graph/Corner":20,"./graph/Diagram":21,"./graph/Edge":22,"./graph/Graph":23,"./utilities/Rand":26,"./utilities/Redist":27}],26:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"../geometry/Vector":18,"dup":13,"seedRandom":4}],27:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvVm9yb25vaS9yaGlsbC12b3Jvbm9pLWNvcmUuanMiLCJub2RlX21vZHVsZXMvYnJvd3Nlci1yZXNvbHZlL2VtcHR5LmpzIiwibm9kZV9tb2R1bGVzL3BvaXNzb24tZGlzay1zYW1wbGUvcG9pc3Nvbi1kaXNrLmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vaW5kZXguanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIvYWxlYS5qcyIsIm5vZGVfbW9kdWxlcy9zZWVkUmFuZG9tL2xpYi90eWNoZWkuanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIveG9yMTI4LmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vbGliL3hvcjQwOTYuanMiLCJub2RlX21vZHVsZXMvc2VlZFJhbmRvbS9saWIveG9yc2hpZnQ3LmpzIiwibm9kZV9tb2R1bGVzL3NlZWRSYW5kb20vbGliL3hvcndvdy5qcyIsIm5vZGVfbW9kdWxlcy9zZWVkUmFuZG9tL3NlZWRyYW5kb20uanMiLCJzcmNcXFV0aWxpdGllc1xcUG9pbnREaXN0cmlidXRpb24uanMiLCJzcmNcXFV0aWxpdGllc1xcUmFuZC5qcyIsInNyY1xcZ2VvbWV0cnlcXExpbmUuanMiLCJzcmNcXGdlb21ldHJ5XFxQb2x5Z29uLmpzIiwic3JjXFxnZW9tZXRyeVxcUmVjdGFuZ2xlLmpzIiwic3JjXFxnZW9tZXRyeVxcVHJpYW5nbGUuanMiLCJzcmNcXGdlb21ldHJ5XFxWZWN0b3IuanMiLCJzcmNcXGdyYXBoXFxDZW50ZXIuanMiLCJzcmNcXGdyYXBoXFxDb3JuZXIuanMiLCJzcmNcXGdyYXBoXFxEaWFncmFtLmpzIiwic3JjXFxncmFwaFxcRWRnZS5qcyIsInNyY1xcZ3JhcGhcXEdyYXBoLmpzIiwic3JjXFxncmFwaFxcVGlsZS5qcyIsInNyY1xcbWFpbi5qcyIsInNyY1xcdXRpbGl0aWVzXFxSZWRpc3QuanMiLCJzcmNcXHV0aWxpdGllc1xcVXRpbC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1ckRBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdE5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtB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YyxDQUFkLEVBQTRCO0FBQUEsUUFBWCxJQUFXLHVFQUFKLEVBQUk7O0FBQy9CLFdBQU8sS0FBSyxLQUFMLENBQVcsT0FBTyxDQUFsQixJQUF1QixJQUE5QjtBQUNIOzs7QUNySEQ7Ozs7QUFJQTs7QUFFQTtBQUNBOzs7OztBQUNPLElBQU0sb0JBQU0sU0FBTixHQUFNLENBQUMsR0FBRCxFQUFNLElBQU4sRUFBZTtBQUFFLFNBQU8sT0FBTyxTQUFQLENBQWlCLGNBQWpCLENBQWdDLElBQWhDLENBQXFDLEdBQXJDLEVBQTBDLElBQTFDLENBQVA7QUFBeUQsQ0FBdEYiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyohXHJcbkNvcHlyaWdodCAoQykgMjAxMC0yMDEzIFJheW1vbmQgSGlsbDogaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pXHJcbk1JVCBMaWNlbnNlOiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL0xJQ0VOU0UubWRcclxuKi9cclxuLypcclxuQXV0aG9yOiBSYXltb25kIEhpbGwgKHJoaWxsQHJheW1vbmRoaWxsLm5ldClcclxuQ29udHJpYnV0b3I6IEplc3NlIE1vcmdhbiAobW9yZ2FqZWxAZ21haWwuY29tKVxyXG5GaWxlOiByaGlsbC12b3Jvbm9pLWNvcmUuanNcclxuVmVyc2lvbjogMC45OFxyXG5EYXRlOiBKYW51YXJ5IDIxLCAyMDEzXHJcbkRlc2NyaXB0aW9uOiBUaGlzIGlzIG15IHBlcnNvbmFsIEphdmFzY3JpcHQgaW1wbGVtZW50YXRpb24gb2ZcclxuU3RldmVuIEZvcnR1bmUncyBhbGdvcml0aG0gdG8gY29tcHV0ZSBWb3Jvbm9pIGRpYWdyYW1zLlxyXG5cclxuTGljZW5zZTogU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9nb3JoaWxsL0phdmFzY3JpcHQtVm9yb25vaS9MSUNFTlNFLm1kXHJcbkNyZWRpdHM6IFNlZSBodHRwczovL2dpdGh1Yi5jb20vZ29yaGlsbC9KYXZhc2NyaXB0LVZvcm9ub2kvQ1JFRElUUy5tZFxyXG5IaXN0b3J5OiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL0NIQU5HRUxPRy5tZFxyXG5cclxuIyMgVXNhZ2U6XHJcblxyXG4gIHZhciBzaXRlcyA9IFt7eDozMDAseTozMDB9LCB7eDoxMDAseToxMDB9LCB7eDoyMDAseTo1MDB9LCB7eDoyNTAseTo0NTB9LCB7eDo2MDAseToxNTB9XTtcclxuICAvLyB4bCwgeHIgbWVhbnMgeCBsZWZ0LCB4IHJpZ2h0XHJcbiAgLy8geXQsIHliIG1lYW5zIHkgdG9wLCB5IGJvdHRvbVxyXG4gIHZhciBiYm94ID0ge3hsOjAsIHhyOjgwMCwgeXQ6MCwgeWI6NjAwfTtcclxuICB2YXIgdm9yb25vaSA9IG5ldyBWb3Jvbm9pKCk7XHJcbiAgLy8gcGFzcyBhbiBvYmplY3Qgd2hpY2ggZXhoaWJpdHMgeGwsIHhyLCB5dCwgeWIgcHJvcGVydGllcy4gVGhlIGJvdW5kaW5nXHJcbiAgLy8gYm94IHdpbGwgYmUgdXNlZCB0byBjb25uZWN0IHVuYm91bmQgZWRnZXMsIGFuZCB0byBjbG9zZSBvcGVuIGNlbGxzXHJcbiAgcmVzdWx0ID0gdm9yb25vaS5jb21wdXRlKHNpdGVzLCBiYm94KTtcclxuICAvLyByZW5kZXIsIGZ1cnRoZXIgYW5hbHl6ZSwgZXRjLlxyXG5cclxuUmV0dXJuIHZhbHVlOlxyXG4gIEFuIG9iamVjdCB3aXRoIHRoZSBmb2xsb3dpbmcgcHJvcGVydGllczpcclxuXHJcbiAgcmVzdWx0LnZlcnRpY2VzID0gYW4gYXJyYXkgb2YgdW5vcmRlcmVkLCB1bmlxdWUgVm9yb25vaS5WZXJ0ZXggb2JqZWN0cyBtYWtpbmdcclxuICAgIHVwIHRoZSBWb3Jvbm9pIGRpYWdyYW0uXHJcbiAgcmVzdWx0LmVkZ2VzID0gYW4gYXJyYXkgb2YgdW5vcmRlcmVkLCB1bmlxdWUgVm9yb25vaS5FZGdlIG9iamVjdHMgbWFraW5nIHVwXHJcbiAgICB0aGUgVm9yb25vaSBkaWFncmFtLlxyXG4gIHJlc3VsdC5jZWxscyA9IGFuIGFycmF5IG9mIFZvcm9ub2kuQ2VsbCBvYmplY3QgbWFraW5nIHVwIHRoZSBWb3Jvbm9pIGRpYWdyYW0uXHJcbiAgICBBIENlbGwgb2JqZWN0IG1pZ2h0IGhhdmUgYW4gZW1wdHkgYXJyYXkgb2YgaGFsZmVkZ2VzLCBtZWFuaW5nIG5vIFZvcm9ub2lcclxuICAgIGNlbGwgY291bGQgYmUgY29tcHV0ZWQgZm9yIGEgcGFydGljdWxhciBjZWxsLlxyXG4gIHJlc3VsdC5leGVjVGltZSA9IHRoZSB0aW1lIGl0IHRvb2sgdG8gY29tcHV0ZSB0aGUgVm9yb25vaSBkaWFncmFtLCBpblxyXG4gICAgbWlsbGlzZWNvbmRzLlxyXG5cclxuVm9yb25vaS5WZXJ0ZXggb2JqZWN0OlxyXG4gIHg6IFRoZSB4IHBvc2l0aW9uIG9mIHRoZSB2ZXJ0ZXguXHJcbiAgeTogVGhlIHkgcG9zaXRpb24gb2YgdGhlIHZlcnRleC5cclxuXHJcblZvcm9ub2kuRWRnZSBvYmplY3Q6XHJcbiAgbFNpdGU6IHRoZSBWb3Jvbm9pIHNpdGUgb2JqZWN0IGF0IHRoZSBsZWZ0IG9mIHRoaXMgVm9yb25vaS5FZGdlIG9iamVjdC5cclxuICByU2l0ZTogdGhlIFZvcm9ub2kgc2l0ZSBvYmplY3QgYXQgdGhlIHJpZ2h0IG9mIHRoaXMgVm9yb25vaS5FZGdlIG9iamVjdCAoY2FuXHJcbiAgICBiZSBudWxsKS5cclxuICB2YTogYW4gb2JqZWN0IHdpdGggYW4gJ3gnIGFuZCBhICd5JyBwcm9wZXJ0eSBkZWZpbmluZyB0aGUgc3RhcnQgcG9pbnRcclxuICAgIChyZWxhdGl2ZSB0byB0aGUgVm9yb25vaSBzaXRlIG9uIHRoZSBsZWZ0KSBvZiB0aGlzIFZvcm9ub2kuRWRnZSBvYmplY3QuXHJcbiAgdmI6IGFuIG9iamVjdCB3aXRoIGFuICd4JyBhbmQgYSAneScgcHJvcGVydHkgZGVmaW5pbmcgdGhlIGVuZCBwb2ludFxyXG4gICAgKHJlbGF0aXZlIHRvIFZvcm9ub2kgc2l0ZSBvbiB0aGUgbGVmdCkgb2YgdGhpcyBWb3Jvbm9pLkVkZ2Ugb2JqZWN0LlxyXG5cclxuICBGb3IgZWRnZXMgd2hpY2ggYXJlIHVzZWQgdG8gY2xvc2Ugb3BlbiBjZWxscyAodXNpbmcgdGhlIHN1cHBsaWVkIGJvdW5kaW5nXHJcbiAgYm94KSwgdGhlIHJTaXRlIHByb3BlcnR5IHdpbGwgYmUgbnVsbC5cclxuXHJcblZvcm9ub2kuQ2VsbCBvYmplY3Q6XHJcbiAgc2l0ZTogdGhlIFZvcm9ub2kgc2l0ZSBvYmplY3QgYXNzb2NpYXRlZCB3aXRoIHRoZSBWb3Jvbm9pIGNlbGwuXHJcbiAgaGFsZmVkZ2VzOiBhbiBhcnJheSBvZiBWb3Jvbm9pLkhhbGZlZGdlIG9iamVjdHMsIG9yZGVyZWQgY291bnRlcmNsb2Nrd2lzZSxcclxuICAgIGRlZmluaW5nIHRoZSBwb2x5Z29uIGZvciB0aGlzIFZvcm9ub2kgY2VsbC5cclxuXHJcblZvcm9ub2kuSGFsZmVkZ2Ugb2JqZWN0OlxyXG4gIHNpdGU6IHRoZSBWb3Jvbm9pIHNpdGUgb2JqZWN0IG93bmluZyB0aGlzIFZvcm9ub2kuSGFsZmVkZ2Ugb2JqZWN0LlxyXG4gIGVkZ2U6IGEgcmVmZXJlbmNlIHRvIHRoZSB1bmlxdWUgVm9yb25vaS5FZGdlIG9iamVjdCB1bmRlcmx5aW5nIHRoaXNcclxuICAgIFZvcm9ub2kuSGFsZmVkZ2Ugb2JqZWN0LlxyXG4gIGdldFN0YXJ0cG9pbnQoKTogYSBtZXRob2QgcmV0dXJuaW5nIGFuIG9iamVjdCB3aXRoIGFuICd4JyBhbmQgYSAneScgcHJvcGVydHlcclxuICAgIGZvciB0aGUgc3RhcnQgcG9pbnQgb2YgdGhpcyBoYWxmZWRnZS4gS2VlcCBpbiBtaW5kIGhhbGZlZGdlcyBhcmUgYWx3YXlzXHJcbiAgICBjb3VudGVyY29ja3dpc2UuXHJcbiAgZ2V0RW5kcG9pbnQoKTogYSBtZXRob2QgcmV0dXJuaW5nIGFuIG9iamVjdCB3aXRoIGFuICd4JyBhbmQgYSAneScgcHJvcGVydHlcclxuICAgIGZvciB0aGUgZW5kIHBvaW50IG9mIHRoaXMgaGFsZmVkZ2UuIEtlZXAgaW4gbWluZCBoYWxmZWRnZXMgYXJlIGFsd2F5c1xyXG4gICAgY291bnRlcmNvY2t3aXNlLlxyXG5cclxuVE9ETzogSWRlbnRpZnkgb3Bwb3J0dW5pdGllcyBmb3IgcGVyZm9ybWFuY2UgaW1wcm92ZW1lbnQuXHJcblxyXG5UT0RPOiBMZXQgdGhlIHVzZXIgY2xvc2UgdGhlIFZvcm9ub2kgY2VsbHMsIGRvIG5vdCBkbyBpdCBhdXRvbWF0aWNhbGx5LiBOb3Qgb25seSBsZXRcclxuICAgICAgaGltIGNsb3NlIHRoZSBjZWxscywgYnV0IGFsc28gYWxsb3cgaGltIHRvIGNsb3NlIG1vcmUgdGhhbiBvbmNlIHVzaW5nIGEgZGlmZmVyZW50XHJcbiAgICAgIGJvdW5kaW5nIGJveCBmb3IgdGhlIHNhbWUgVm9yb25vaSBkaWFncmFtLlxyXG4qL1xyXG5cclxuLypnbG9iYWwgTWF0aCAqL1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5mdW5jdGlvbiBWb3Jvbm9pKCkge1xyXG4gICAgdGhpcy52ZXJ0aWNlcyA9IG51bGw7XHJcbiAgICB0aGlzLmVkZ2VzID0gbnVsbDtcclxuICAgIHRoaXMuY2VsbHMgPSBudWxsO1xyXG4gICAgdGhpcy50b1JlY3ljbGUgPSBudWxsO1xyXG4gICAgdGhpcy5iZWFjaHNlY3Rpb25KdW5reWFyZCA9IFtdO1xyXG4gICAgdGhpcy5jaXJjbGVFdmVudEp1bmt5YXJkID0gW107XHJcbiAgICB0aGlzLnZlcnRleEp1bmt5YXJkID0gW107XHJcbiAgICB0aGlzLmVkZ2VKdW5reWFyZCA9IFtdO1xyXG4gICAgdGhpcy5jZWxsSnVua3lhcmQgPSBbXTtcclxuICAgIH1cclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuVm9yb25vaS5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcclxuICAgIGlmICghdGhpcy5iZWFjaGxpbmUpIHtcclxuICAgICAgICB0aGlzLmJlYWNobGluZSA9IG5ldyB0aGlzLlJCVHJlZSgpO1xyXG4gICAgICAgIH1cclxuICAgIC8vIE1vdmUgbGVmdG92ZXIgYmVhY2hzZWN0aW9ucyB0byB0aGUgYmVhY2hzZWN0aW9uIGp1bmt5YXJkLlxyXG4gICAgaWYgKHRoaXMuYmVhY2hsaW5lLnJvb3QpIHtcclxuICAgICAgICB2YXIgYmVhY2hzZWN0aW9uID0gdGhpcy5iZWFjaGxpbmUuZ2V0Rmlyc3QodGhpcy5iZWFjaGxpbmUucm9vdCk7XHJcbiAgICAgICAgd2hpbGUgKGJlYWNoc2VjdGlvbikge1xyXG4gICAgICAgICAgICB0aGlzLmJlYWNoc2VjdGlvbkp1bmt5YXJkLnB1c2goYmVhY2hzZWN0aW9uKTsgLy8gbWFyayBmb3IgcmV1c2VcclxuICAgICAgICAgICAgYmVhY2hzZWN0aW9uID0gYmVhY2hzZWN0aW9uLnJiTmV4dDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIHRoaXMuYmVhY2hsaW5lLnJvb3QgPSBudWxsO1xyXG4gICAgaWYgKCF0aGlzLmNpcmNsZUV2ZW50cykge1xyXG4gICAgICAgIHRoaXMuY2lyY2xlRXZlbnRzID0gbmV3IHRoaXMuUkJUcmVlKCk7XHJcbiAgICAgICAgfVxyXG4gICAgdGhpcy5jaXJjbGVFdmVudHMucm9vdCA9IHRoaXMuZmlyc3RDaXJjbGVFdmVudCA9IG51bGw7XHJcbiAgICB0aGlzLnZlcnRpY2VzID0gW107XHJcbiAgICB0aGlzLmVkZ2VzID0gW107XHJcbiAgICB0aGlzLmNlbGxzID0gW107XHJcbiAgICB9O1xyXG5cclxuVm9yb25vaS5wcm90b3R5cGUuc3FydCA9IE1hdGguc3FydDtcclxuVm9yb25vaS5wcm90b3R5cGUuYWJzID0gTWF0aC5hYnM7XHJcblZvcm9ub2kucHJvdG90eXBlLs61ID0gVm9yb25vaS7OtSA9IDFlLTk7XHJcblZvcm9ub2kucHJvdG90eXBlLmluds61ID0gVm9yb25vaS5pbnbOtSA9IDEuMCAvIFZvcm9ub2kuzrU7XHJcblZvcm9ub2kucHJvdG90eXBlLmVxdWFsV2l0aEVwc2lsb24gPSBmdW5jdGlvbihhLGIpe3JldHVybiB0aGlzLmFicyhhLWIpPDFlLTk7fTtcclxuVm9yb25vaS5wcm90b3R5cGUuZ3JlYXRlclRoYW5XaXRoRXBzaWxvbiA9IGZ1bmN0aW9uKGEsYil7cmV0dXJuIGEtYj4xZS05O307XHJcblZvcm9ub2kucHJvdG90eXBlLmdyZWF0ZXJUaGFuT3JFcXVhbFdpdGhFcHNpbG9uID0gZnVuY3Rpb24oYSxiKXtyZXR1cm4gYi1hPDFlLTk7fTtcclxuVm9yb25vaS5wcm90b3R5cGUubGVzc1RoYW5XaXRoRXBzaWxvbiA9IGZ1bmN0aW9uKGEsYil7cmV0dXJuIGItYT4xZS05O307XHJcblZvcm9ub2kucHJvdG90eXBlLmxlc3NUaGFuT3JFcXVhbFdpdGhFcHNpbG9uID0gZnVuY3Rpb24oYSxiKXtyZXR1cm4gYS1iPDFlLTk7fTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBSZWQtQmxhY2sgdHJlZSBjb2RlIChiYXNlZCBvbiBDIHZlcnNpb24gb2YgXCJyYnRyZWVcIiBieSBGcmFuY2sgQnVpLUh1dVxyXG4vLyBodHRwczovL2dpdGh1Yi5jb20vZmJ1aWh1dS9saWJ0cmVlL2Jsb2IvbWFzdGVyL3JiLmNcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLlJCVHJlZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5yb290ID0gbnVsbDtcclxuICAgIH07XHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUucHJvdG90eXBlLnJiSW5zZXJ0U3VjY2Vzc29yID0gZnVuY3Rpb24obm9kZSwgc3VjY2Vzc29yKSB7XHJcbiAgICB2YXIgcGFyZW50O1xyXG4gICAgaWYgKG5vZGUpIHtcclxuICAgICAgICAvLyA+Pj4gcmhpbGwgMjAxMS0wNS0yNzogUGVyZm9ybWFuY2U6IGNhY2hlIHByZXZpb3VzL25leHQgbm9kZXNcclxuICAgICAgICBzdWNjZXNzb3IucmJQcmV2aW91cyA9IG5vZGU7XHJcbiAgICAgICAgc3VjY2Vzc29yLnJiTmV4dCA9IG5vZGUucmJOZXh0O1xyXG4gICAgICAgIGlmIChub2RlLnJiTmV4dCkge1xyXG4gICAgICAgICAgICBub2RlLnJiTmV4dC5yYlByZXZpb3VzID0gc3VjY2Vzc29yO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgbm9kZS5yYk5leHQgPSBzdWNjZXNzb3I7XHJcbiAgICAgICAgLy8gPDw8XHJcbiAgICAgICAgaWYgKG5vZGUucmJSaWdodCkge1xyXG4gICAgICAgICAgICAvLyBpbi1wbGFjZSBleHBhbnNpb24gb2Ygbm9kZS5yYlJpZ2h0LmdldEZpcnN0KCk7XHJcbiAgICAgICAgICAgIG5vZGUgPSBub2RlLnJiUmlnaHQ7XHJcbiAgICAgICAgICAgIHdoaWxlIChub2RlLnJiTGVmdCkge25vZGUgPSBub2RlLnJiTGVmdDt9XHJcbiAgICAgICAgICAgIG5vZGUucmJMZWZ0ID0gc3VjY2Vzc29yO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIG5vZGUucmJSaWdodCA9IHN1Y2Nlc3NvcjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIHBhcmVudCA9IG5vZGU7XHJcbiAgICAgICAgfVxyXG4gICAgLy8gcmhpbGwgMjAxMS0wNi0wNzogaWYgbm9kZSBpcyBudWxsLCBzdWNjZXNzb3IgbXVzdCBiZSBpbnNlcnRlZFxyXG4gICAgLy8gdG8gdGhlIGxlZnQtbW9zdCBwYXJ0IG9mIHRoZSB0cmVlXHJcbiAgICBlbHNlIGlmICh0aGlzLnJvb3QpIHtcclxuICAgICAgICBub2RlID0gdGhpcy5nZXRGaXJzdCh0aGlzLnJvb3QpO1xyXG4gICAgICAgIC8vID4+PiBQZXJmb3JtYW5jZTogY2FjaGUgcHJldmlvdXMvbmV4dCBub2Rlc1xyXG4gICAgICAgIHN1Y2Nlc3Nvci5yYlByZXZpb3VzID0gbnVsbDtcclxuICAgICAgICBzdWNjZXNzb3IucmJOZXh0ID0gbm9kZTtcclxuICAgICAgICBub2RlLnJiUHJldmlvdXMgPSBzdWNjZXNzb3I7XHJcbiAgICAgICAgLy8gPDw8XHJcbiAgICAgICAgbm9kZS5yYkxlZnQgPSBzdWNjZXNzb3I7XHJcbiAgICAgICAgcGFyZW50ID0gbm9kZTtcclxuICAgICAgICB9XHJcbiAgICBlbHNlIHtcclxuICAgICAgICAvLyA+Pj4gUGVyZm9ybWFuY2U6IGNhY2hlIHByZXZpb3VzL25leHQgbm9kZXNcclxuICAgICAgICBzdWNjZXNzb3IucmJQcmV2aW91cyA9IHN1Y2Nlc3Nvci5yYk5leHQgPSBudWxsO1xyXG4gICAgICAgIC8vIDw8PFxyXG4gICAgICAgIHRoaXMucm9vdCA9IHN1Y2Nlc3NvcjtcclxuICAgICAgICBwYXJlbnQgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIHN1Y2Nlc3Nvci5yYkxlZnQgPSBzdWNjZXNzb3IucmJSaWdodCA9IG51bGw7XHJcbiAgICBzdWNjZXNzb3IucmJQYXJlbnQgPSBwYXJlbnQ7XHJcbiAgICBzdWNjZXNzb3IucmJSZWQgPSB0cnVlO1xyXG4gICAgLy8gRml4dXAgdGhlIG1vZGlmaWVkIHRyZWUgYnkgcmVjb2xvcmluZyBub2RlcyBhbmQgcGVyZm9ybWluZ1xyXG4gICAgLy8gcm90YXRpb25zICgyIGF0IG1vc3QpIGhlbmNlIHRoZSByZWQtYmxhY2sgdHJlZSBwcm9wZXJ0aWVzIGFyZVxyXG4gICAgLy8gcHJlc2VydmVkLlxyXG4gICAgdmFyIGdyYW5kcGEsIHVuY2xlO1xyXG4gICAgbm9kZSA9IHN1Y2Nlc3NvcjtcclxuICAgIHdoaWxlIChwYXJlbnQgJiYgcGFyZW50LnJiUmVkKSB7XHJcbiAgICAgICAgZ3JhbmRwYSA9IHBhcmVudC5yYlBhcmVudDtcclxuICAgICAgICBpZiAocGFyZW50ID09PSBncmFuZHBhLnJiTGVmdCkge1xyXG4gICAgICAgICAgICB1bmNsZSA9IGdyYW5kcGEucmJSaWdodDtcclxuICAgICAgICAgICAgaWYgKHVuY2xlICYmIHVuY2xlLnJiUmVkKSB7XHJcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSB1bmNsZS5yYlJlZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgZ3JhbmRwYS5yYlJlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICBub2RlID0gZ3JhbmRwYTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBpZiAobm9kZSA9PT0gcGFyZW50LnJiUmlnaHQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlTGVmdChwYXJlbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIG5vZGUgPSBwYXJlbnQ7XHJcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50ID0gbm9kZS5yYlBhcmVudDtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGdyYW5kcGEucmJSZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZVJpZ2h0KGdyYW5kcGEpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIHVuY2xlID0gZ3JhbmRwYS5yYkxlZnQ7XHJcbiAgICAgICAgICAgIGlmICh1bmNsZSAmJiB1bmNsZS5yYlJlZCkge1xyXG4gICAgICAgICAgICAgICAgcGFyZW50LnJiUmVkID0gdW5jbGUucmJSZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGdyYW5kcGEucmJSZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgbm9kZSA9IGdyYW5kcGE7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgaWYgKG5vZGUgPT09IHBhcmVudC5yYkxlZnQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlUmlnaHQocGFyZW50KTtcclxuICAgICAgICAgICAgICAgICAgICBub2RlID0gcGFyZW50O1xyXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudCA9IG5vZGUucmJQYXJlbnQ7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgcGFyZW50LnJiUmVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBncmFuZHBhLnJiUmVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVMZWZ0KGdyYW5kcGEpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgcGFyZW50ID0gbm9kZS5yYlBhcmVudDtcclxuICAgICAgICB9XHJcbiAgICB0aGlzLnJvb3QucmJSZWQgPSBmYWxzZTtcclxuICAgIH07XHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUucHJvdG90eXBlLnJiUmVtb3ZlTm9kZSA9IGZ1bmN0aW9uKG5vZGUpIHtcclxuICAgIC8vID4+PiByaGlsbCAyMDExLTA1LTI3OiBQZXJmb3JtYW5jZTogY2FjaGUgcHJldmlvdXMvbmV4dCBub2Rlc1xyXG4gICAgaWYgKG5vZGUucmJOZXh0KSB7XHJcbiAgICAgICAgbm9kZS5yYk5leHQucmJQcmV2aW91cyA9IG5vZGUucmJQcmV2aW91cztcclxuICAgICAgICB9XHJcbiAgICBpZiAobm9kZS5yYlByZXZpb3VzKSB7XHJcbiAgICAgICAgbm9kZS5yYlByZXZpb3VzLnJiTmV4dCA9IG5vZGUucmJOZXh0O1xyXG4gICAgICAgIH1cclxuICAgIG5vZGUucmJOZXh0ID0gbm9kZS5yYlByZXZpb3VzID0gbnVsbDtcclxuICAgIC8vIDw8PFxyXG4gICAgdmFyIHBhcmVudCA9IG5vZGUucmJQYXJlbnQsXHJcbiAgICAgICAgbGVmdCA9IG5vZGUucmJMZWZ0LFxyXG4gICAgICAgIHJpZ2h0ID0gbm9kZS5yYlJpZ2h0LFxyXG4gICAgICAgIG5leHQ7XHJcbiAgICBpZiAoIWxlZnQpIHtcclxuICAgICAgICBuZXh0ID0gcmlnaHQ7XHJcbiAgICAgICAgfVxyXG4gICAgZWxzZSBpZiAoIXJpZ2h0KSB7XHJcbiAgICAgICAgbmV4dCA9IGxlZnQ7XHJcbiAgICAgICAgfVxyXG4gICAgZWxzZSB7XHJcbiAgICAgICAgbmV4dCA9IHRoaXMuZ2V0Rmlyc3QocmlnaHQpO1xyXG4gICAgICAgIH1cclxuICAgIGlmIChwYXJlbnQpIHtcclxuICAgICAgICBpZiAocGFyZW50LnJiTGVmdCA9PT0gbm9kZSkge1xyXG4gICAgICAgICAgICBwYXJlbnQucmJMZWZ0ID0gbmV4dDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICBwYXJlbnQucmJSaWdodCA9IG5leHQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICBlbHNlIHtcclxuICAgICAgICB0aGlzLnJvb3QgPSBuZXh0O1xyXG4gICAgICAgIH1cclxuICAgIC8vIGVuZm9yY2UgcmVkLWJsYWNrIHJ1bGVzXHJcbiAgICB2YXIgaXNSZWQ7XHJcbiAgICBpZiAobGVmdCAmJiByaWdodCkge1xyXG4gICAgICAgIGlzUmVkID0gbmV4dC5yYlJlZDtcclxuICAgICAgICBuZXh0LnJiUmVkID0gbm9kZS5yYlJlZDtcclxuICAgICAgICBuZXh0LnJiTGVmdCA9IGxlZnQ7XHJcbiAgICAgICAgbGVmdC5yYlBhcmVudCA9IG5leHQ7XHJcbiAgICAgICAgaWYgKG5leHQgIT09IHJpZ2h0KSB7XHJcbiAgICAgICAgICAgIHBhcmVudCA9IG5leHQucmJQYXJlbnQ7XHJcbiAgICAgICAgICAgIG5leHQucmJQYXJlbnQgPSBub2RlLnJiUGFyZW50O1xyXG4gICAgICAgICAgICBub2RlID0gbmV4dC5yYlJpZ2h0O1xyXG4gICAgICAgICAgICBwYXJlbnQucmJMZWZ0ID0gbm9kZTtcclxuICAgICAgICAgICAgbmV4dC5yYlJpZ2h0ID0gcmlnaHQ7XHJcbiAgICAgICAgICAgIHJpZ2h0LnJiUGFyZW50ID0gbmV4dDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICBuZXh0LnJiUGFyZW50ID0gcGFyZW50O1xyXG4gICAgICAgICAgICBwYXJlbnQgPSBuZXh0O1xyXG4gICAgICAgICAgICBub2RlID0gbmV4dC5yYlJpZ2h0O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgZWxzZSB7XHJcbiAgICAgICAgaXNSZWQgPSBub2RlLnJiUmVkO1xyXG4gICAgICAgIG5vZGUgPSBuZXh0O1xyXG4gICAgICAgIH1cclxuICAgIC8vICdub2RlJyBpcyBub3cgdGhlIHNvbGUgc3VjY2Vzc29yJ3MgY2hpbGQgYW5kICdwYXJlbnQnIGl0c1xyXG4gICAgLy8gbmV3IHBhcmVudCAoc2luY2UgdGhlIHN1Y2Nlc3NvciBjYW4gaGF2ZSBiZWVuIG1vdmVkKVxyXG4gICAgaWYgKG5vZGUpIHtcclxuICAgICAgICBub2RlLnJiUGFyZW50ID0gcGFyZW50O1xyXG4gICAgICAgIH1cclxuICAgIC8vIHRoZSAnZWFzeScgY2FzZXNcclxuICAgIGlmIChpc1JlZCkge3JldHVybjt9XHJcbiAgICBpZiAobm9kZSAmJiBub2RlLnJiUmVkKSB7XHJcbiAgICAgICAgbm9kZS5yYlJlZCA9IGZhbHNlO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAvLyB0aGUgb3RoZXIgY2FzZXNcclxuICAgIHZhciBzaWJsaW5nO1xyXG4gICAgZG8ge1xyXG4gICAgICAgIGlmIChub2RlID09PSB0aGlzLnJvb3QpIHtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBpZiAobm9kZSA9PT0gcGFyZW50LnJiTGVmdCkge1xyXG4gICAgICAgICAgICBzaWJsaW5nID0gcGFyZW50LnJiUmlnaHQ7XHJcbiAgICAgICAgICAgIGlmIChzaWJsaW5nLnJiUmVkKSB7XHJcbiAgICAgICAgICAgICAgICBzaWJsaW5nLnJiUmVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZUxlZnQocGFyZW50KTtcclxuICAgICAgICAgICAgICAgIHNpYmxpbmcgPSBwYXJlbnQucmJSaWdodDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKChzaWJsaW5nLnJiTGVmdCAmJiBzaWJsaW5nLnJiTGVmdC5yYlJlZCkgfHwgKHNpYmxpbmcucmJSaWdodCAmJiBzaWJsaW5nLnJiUmlnaHQucmJSZWQpKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXNpYmxpbmcucmJSaWdodCB8fCAhc2libGluZy5yYlJpZ2h0LnJiUmVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgc2libGluZy5yYkxlZnQucmJSZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICBzaWJsaW5nLnJiUmVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJiUm90YXRlUmlnaHQoc2libGluZyk7XHJcbiAgICAgICAgICAgICAgICAgICAgc2libGluZyA9IHBhcmVudC5yYlJpZ2h0O1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSZWQgPSBwYXJlbnQucmJSZWQ7XHJcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSBzaWJsaW5nLnJiUmlnaHQucmJSZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVMZWZ0KHBhcmVudCk7XHJcbiAgICAgICAgICAgICAgICBub2RlID0gdGhpcy5yb290O1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgc2libGluZyA9IHBhcmVudC5yYkxlZnQ7XHJcbiAgICAgICAgICAgIGlmIChzaWJsaW5nLnJiUmVkKSB7XHJcbiAgICAgICAgICAgICAgICBzaWJsaW5nLnJiUmVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZVJpZ2h0KHBhcmVudCk7XHJcbiAgICAgICAgICAgICAgICBzaWJsaW5nID0gcGFyZW50LnJiTGVmdDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKChzaWJsaW5nLnJiTGVmdCAmJiBzaWJsaW5nLnJiTGVmdC5yYlJlZCkgfHwgKHNpYmxpbmcucmJSaWdodCAmJiBzaWJsaW5nLnJiUmlnaHQucmJSZWQpKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXNpYmxpbmcucmJMZWZ0IHx8ICFzaWJsaW5nLnJiTGVmdC5yYlJlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSaWdodC5yYlJlZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmJSb3RhdGVMZWZ0KHNpYmxpbmcpO1xyXG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmcgPSBwYXJlbnQucmJMZWZ0O1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHNpYmxpbmcucmJSZWQgPSBwYXJlbnQucmJSZWQ7XHJcbiAgICAgICAgICAgICAgICBwYXJlbnQucmJSZWQgPSBzaWJsaW5nLnJiTGVmdC5yYlJlZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5yYlJvdGF0ZVJpZ2h0KHBhcmVudCk7XHJcbiAgICAgICAgICAgICAgICBub2RlID0gdGhpcy5yb290O1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBzaWJsaW5nLnJiUmVkID0gdHJ1ZTtcclxuICAgICAgICBub2RlID0gcGFyZW50O1xyXG4gICAgICAgIHBhcmVudCA9IHBhcmVudC5yYlBhcmVudDtcclxuICAgIH0gd2hpbGUgKCFub2RlLnJiUmVkKTtcclxuICAgIGlmIChub2RlKSB7bm9kZS5yYlJlZCA9IGZhbHNlO31cclxuICAgIH07XHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUucHJvdG90eXBlLnJiUm90YXRlTGVmdCA9IGZ1bmN0aW9uKG5vZGUpIHtcclxuICAgIHZhciBwID0gbm9kZSxcclxuICAgICAgICBxID0gbm9kZS5yYlJpZ2h0LCAvLyBjYW4ndCBiZSBudWxsXHJcbiAgICAgICAgcGFyZW50ID0gcC5yYlBhcmVudDtcclxuICAgIGlmIChwYXJlbnQpIHtcclxuICAgICAgICBpZiAocGFyZW50LnJiTGVmdCA9PT0gcCkge1xyXG4gICAgICAgICAgICBwYXJlbnQucmJMZWZ0ID0gcTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICBwYXJlbnQucmJSaWdodCA9IHE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICBlbHNlIHtcclxuICAgICAgICB0aGlzLnJvb3QgPSBxO1xyXG4gICAgICAgIH1cclxuICAgIHEucmJQYXJlbnQgPSBwYXJlbnQ7XHJcbiAgICBwLnJiUGFyZW50ID0gcTtcclxuICAgIHAucmJSaWdodCA9IHEucmJMZWZ0O1xyXG4gICAgaWYgKHAucmJSaWdodCkge1xyXG4gICAgICAgIHAucmJSaWdodC5yYlBhcmVudCA9IHA7XHJcbiAgICAgICAgfVxyXG4gICAgcS5yYkxlZnQgPSBwO1xyXG4gICAgfTtcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLlJCVHJlZS5wcm90b3R5cGUucmJSb3RhdGVSaWdodCA9IGZ1bmN0aW9uKG5vZGUpIHtcclxuICAgIHZhciBwID0gbm9kZSxcclxuICAgICAgICBxID0gbm9kZS5yYkxlZnQsIC8vIGNhbid0IGJlIG51bGxcclxuICAgICAgICBwYXJlbnQgPSBwLnJiUGFyZW50O1xyXG4gICAgaWYgKHBhcmVudCkge1xyXG4gICAgICAgIGlmIChwYXJlbnQucmJMZWZ0ID09PSBwKSB7XHJcbiAgICAgICAgICAgIHBhcmVudC5yYkxlZnQgPSBxO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIHBhcmVudC5yYlJpZ2h0ID0gcTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIGVsc2Uge1xyXG4gICAgICAgIHRoaXMucm9vdCA9IHE7XHJcbiAgICAgICAgfVxyXG4gICAgcS5yYlBhcmVudCA9IHBhcmVudDtcclxuICAgIHAucmJQYXJlbnQgPSBxO1xyXG4gICAgcC5yYkxlZnQgPSBxLnJiUmlnaHQ7XHJcbiAgICBpZiAocC5yYkxlZnQpIHtcclxuICAgICAgICBwLnJiTGVmdC5yYlBhcmVudCA9IHA7XHJcbiAgICAgICAgfVxyXG4gICAgcS5yYlJpZ2h0ID0gcDtcclxuICAgIH07XHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5SQlRyZWUucHJvdG90eXBlLmdldEZpcnN0ID0gZnVuY3Rpb24obm9kZSkge1xyXG4gICAgd2hpbGUgKG5vZGUucmJMZWZ0KSB7XHJcbiAgICAgICAgbm9kZSA9IG5vZGUucmJMZWZ0O1xyXG4gICAgICAgIH1cclxuICAgIHJldHVybiBub2RlO1xyXG4gICAgfTtcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLlJCVHJlZS5wcm90b3R5cGUuZ2V0TGFzdCA9IGZ1bmN0aW9uKG5vZGUpIHtcclxuICAgIHdoaWxlIChub2RlLnJiUmlnaHQpIHtcclxuICAgICAgICBub2RlID0gbm9kZS5yYlJpZ2h0O1xyXG4gICAgICAgIH1cclxuICAgIHJldHVybiBub2RlO1xyXG4gICAgfTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBEaWFncmFtIG1ldGhvZHNcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLkRpYWdyYW0gPSBmdW5jdGlvbihzaXRlKSB7XHJcbiAgICB0aGlzLnNpdGUgPSBzaXRlO1xyXG4gICAgfTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBDZWxsIG1ldGhvZHNcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLkNlbGwgPSBmdW5jdGlvbihzaXRlKSB7XHJcbiAgICB0aGlzLnNpdGUgPSBzaXRlO1xyXG4gICAgdGhpcy5oYWxmZWRnZXMgPSBbXTtcclxuICAgIHRoaXMuY2xvc2VNZSA9IGZhbHNlO1xyXG4gICAgfTtcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLkNlbGwucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbihzaXRlKSB7XHJcbiAgICB0aGlzLnNpdGUgPSBzaXRlO1xyXG4gICAgdGhpcy5oYWxmZWRnZXMgPSBbXTtcclxuICAgIHRoaXMuY2xvc2VNZSA9IGZhbHNlO1xyXG4gICAgcmV0dXJuIHRoaXM7XHJcbiAgICB9O1xyXG5cclxuVm9yb25vaS5wcm90b3R5cGUuY3JlYXRlQ2VsbCA9IGZ1bmN0aW9uKHNpdGUpIHtcclxuICAgIHZhciBjZWxsID0gdGhpcy5jZWxsSnVua3lhcmQucG9wKCk7XHJcbiAgICBpZiAoIGNlbGwgKSB7XHJcbiAgICAgICAgcmV0dXJuIGNlbGwuaW5pdChzaXRlKTtcclxuICAgICAgICB9XHJcbiAgICByZXR1cm4gbmV3IHRoaXMuQ2VsbChzaXRlKTtcclxuICAgIH07XHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5DZWxsLnByb3RvdHlwZS5wcmVwYXJlSGFsZmVkZ2VzID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgaGFsZmVkZ2VzID0gdGhpcy5oYWxmZWRnZXMsXHJcbiAgICAgICAgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aCxcclxuICAgICAgICBlZGdlO1xyXG4gICAgLy8gZ2V0IHJpZCBvZiB1bnVzZWQgaGFsZmVkZ2VzXHJcbiAgICAvLyByaGlsbCAyMDExLTA1LTI3OiBLZWVwIGl0IHNpbXBsZSwgbm8gcG9pbnQgaGVyZSBpbiB0cnlpbmdcclxuICAgIC8vIHRvIGJlIGZhbmN5OiBkYW5nbGluZyBlZGdlcyBhcmUgYSB0eXBpY2FsbHkgYSBtaW5vcml0eS5cclxuICAgIHdoaWxlIChpSGFsZmVkZ2UtLSkge1xyXG4gICAgICAgIGVkZ2UgPSBoYWxmZWRnZXNbaUhhbGZlZGdlXS5lZGdlO1xyXG4gICAgICAgIGlmICghZWRnZS52YiB8fCAhZWRnZS52YSkge1xyXG4gICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlIYWxmZWRnZSwxKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAvLyByaGlsbCAyMDExLTA1LTI2OiBJIHRyaWVkIHRvIHVzZSBhIGJpbmFyeSBzZWFyY2ggYXQgaW5zZXJ0aW9uXHJcbiAgICAvLyB0aW1lIHRvIGtlZXAgdGhlIGFycmF5IHNvcnRlZCBvbi10aGUtZmx5IChpbiBDZWxsLmFkZEhhbGZlZGdlKCkpLlxyXG4gICAgLy8gVGhlcmUgd2FzIG5vIHJlYWwgYmVuZWZpdHMgaW4gZG9pbmcgc28sIHBlcmZvcm1hbmNlIG9uXHJcbiAgICAvLyBGaXJlZm94IDMuNiB3YXMgaW1wcm92ZWQgbWFyZ2luYWxseSwgd2hpbGUgcGVyZm9ybWFuY2Ugb25cclxuICAgIC8vIE9wZXJhIDExIHdhcyBwZW5hbGl6ZWQgbWFyZ2luYWxseS5cclxuICAgIGhhbGZlZGdlcy5zb3J0KGZ1bmN0aW9uKGEsYil7cmV0dXJuIGIuYW5nbGUtYS5hbmdsZTt9KTtcclxuICAgIHJldHVybiBoYWxmZWRnZXMubGVuZ3RoO1xyXG4gICAgfTtcclxuXHJcbi8vIFJldHVybiBhIGxpc3Qgb2YgdGhlIG5laWdoYm9yIElkc1xyXG5Wb3Jvbm9pLnByb3RvdHlwZS5DZWxsLnByb3RvdHlwZS5nZXROZWlnaGJvcklkcyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdmFyIG5laWdoYm9ycyA9IFtdLFxyXG4gICAgICAgIGlIYWxmZWRnZSA9IHRoaXMuaGFsZmVkZ2VzLmxlbmd0aCxcclxuICAgICAgICBlZGdlO1xyXG4gICAgd2hpbGUgKGlIYWxmZWRnZS0tKXtcclxuICAgICAgICBlZGdlID0gdGhpcy5oYWxmZWRnZXNbaUhhbGZlZGdlXS5lZGdlO1xyXG4gICAgICAgIGlmIChlZGdlLmxTaXRlICE9PSBudWxsICYmIGVkZ2UubFNpdGUudm9yb25vaUlkICE9IHRoaXMuc2l0ZS52b3Jvbm9pSWQpIHtcclxuICAgICAgICAgICAgbmVpZ2hib3JzLnB1c2goZWRnZS5sU2l0ZS52b3Jvbm9pSWQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAoZWRnZS5yU2l0ZSAhPT0gbnVsbCAmJiBlZGdlLnJTaXRlLnZvcm9ub2lJZCAhPSB0aGlzLnNpdGUudm9yb25vaUlkKXtcclxuICAgICAgICAgICAgbmVpZ2hib3JzLnB1c2goZWRnZS5yU2l0ZS52b3Jvbm9pSWQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgcmV0dXJuIG5laWdoYm9ycztcclxuICAgIH07XHJcblxyXG4vLyBDb21wdXRlIGJvdW5kaW5nIGJveFxyXG4vL1xyXG5Wb3Jvbm9pLnByb3RvdHlwZS5DZWxsLnByb3RvdHlwZS5nZXRCYm94ID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgaGFsZmVkZ2VzID0gdGhpcy5oYWxmZWRnZXMsXHJcbiAgICAgICAgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aCxcclxuICAgICAgICB4bWluID0gSW5maW5pdHksXHJcbiAgICAgICAgeW1pbiA9IEluZmluaXR5LFxyXG4gICAgICAgIHhtYXggPSAtSW5maW5pdHksXHJcbiAgICAgICAgeW1heCA9IC1JbmZpbml0eSxcclxuICAgICAgICB2LCB2eCwgdnk7XHJcbiAgICB3aGlsZSAoaUhhbGZlZGdlLS0pIHtcclxuICAgICAgICB2ID0gaGFsZmVkZ2VzW2lIYWxmZWRnZV0uZ2V0U3RhcnRwb2ludCgpO1xyXG4gICAgICAgIHZ4ID0gdi54O1xyXG4gICAgICAgIHZ5ID0gdi55O1xyXG4gICAgICAgIGlmICh2eCA8IHhtaW4pIHt4bWluID0gdng7fVxyXG4gICAgICAgIGlmICh2eSA8IHltaW4pIHt5bWluID0gdnk7fVxyXG4gICAgICAgIGlmICh2eCA+IHhtYXgpIHt4bWF4ID0gdng7fVxyXG4gICAgICAgIGlmICh2eSA+IHltYXgpIHt5bWF4ID0gdnk7fVxyXG4gICAgICAgIC8vIHdlIGRvbnQgbmVlZCB0byB0YWtlIGludG8gYWNjb3VudCBlbmQgcG9pbnQsXHJcbiAgICAgICAgLy8gc2luY2UgZWFjaCBlbmQgcG9pbnQgbWF0Y2hlcyBhIHN0YXJ0IHBvaW50XHJcbiAgICAgICAgfVxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICB4OiB4bWluLFxyXG4gICAgICAgIHk6IHltaW4sXHJcbiAgICAgICAgd2lkdGg6IHhtYXgteG1pbixcclxuICAgICAgICBoZWlnaHQ6IHltYXgteW1pblxyXG4gICAgICAgIH07XHJcbiAgICB9O1xyXG5cclxuLy8gUmV0dXJuIHdoZXRoZXIgYSBwb2ludCBpcyBpbnNpZGUsIG9uLCBvciBvdXRzaWRlIHRoZSBjZWxsOlxyXG4vLyAgIC0xOiBwb2ludCBpcyBvdXRzaWRlIHRoZSBwZXJpbWV0ZXIgb2YgdGhlIGNlbGxcclxuLy8gICAgMDogcG9pbnQgaXMgb24gdGhlIHBlcmltZXRlciBvZiB0aGUgY2VsbFxyXG4vLyAgICAxOiBwb2ludCBpcyBpbnNpZGUgdGhlIHBlcmltZXRlciBvZiB0aGUgY2VsbFxyXG4vL1xyXG5Wb3Jvbm9pLnByb3RvdHlwZS5DZWxsLnByb3RvdHlwZS5wb2ludEludGVyc2VjdGlvbiA9IGZ1bmN0aW9uKHgsIHkpIHtcclxuICAgIC8vIENoZWNrIGlmIHBvaW50IGluIHBvbHlnb24uIFNpbmNlIGFsbCBwb2x5Z29ucyBvZiBhIFZvcm9ub2lcclxuICAgIC8vIGRpYWdyYW0gYXJlIGNvbnZleCwgdGhlbjpcclxuICAgIC8vIGh0dHA6Ly9wYXVsYm91cmtlLm5ldC9nZW9tZXRyeS9wb2x5Z29ubWVzaC9cclxuICAgIC8vIFNvbHV0aW9uIDMgKDJEKTpcclxuICAgIC8vICAgXCJJZiB0aGUgcG9seWdvbiBpcyBjb252ZXggdGhlbiBvbmUgY2FuIGNvbnNpZGVyIHRoZSBwb2x5Z29uXHJcbiAgICAvLyAgIFwiYXMgYSAncGF0aCcgZnJvbSB0aGUgZmlyc3QgdmVydGV4LiBBIHBvaW50IGlzIG9uIHRoZSBpbnRlcmlvclxyXG4gICAgLy8gICBcIm9mIHRoaXMgcG9seWdvbnMgaWYgaXQgaXMgYWx3YXlzIG9uIHRoZSBzYW1lIHNpZGUgb2YgYWxsIHRoZVxyXG4gICAgLy8gICBcImxpbmUgc2VnbWVudHMgbWFraW5nIHVwIHRoZSBwYXRoLiAuLi5cclxuICAgIC8vICAgXCIoeSAtIHkwKSAoeDEgLSB4MCkgLSAoeCAtIHgwKSAoeTEgLSB5MClcclxuICAgIC8vICAgXCJpZiBpdCBpcyBsZXNzIHRoYW4gMCB0aGVuIFAgaXMgdG8gdGhlIHJpZ2h0IG9mIHRoZSBsaW5lIHNlZ21lbnQsXHJcbiAgICAvLyAgIFwiaWYgZ3JlYXRlciB0aGFuIDAgaXQgaXMgdG8gdGhlIGxlZnQsIGlmIGVxdWFsIHRvIDAgdGhlbiBpdCBsaWVzXHJcbiAgICAvLyAgIFwib24gdGhlIGxpbmUgc2VnbWVudFwiXHJcbiAgICB2YXIgaGFsZmVkZ2VzID0gdGhpcy5oYWxmZWRnZXMsXHJcbiAgICAgICAgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aCxcclxuICAgICAgICBoYWxmZWRnZSxcclxuICAgICAgICBwMCwgcDEsIHI7XHJcbiAgICB3aGlsZSAoaUhhbGZlZGdlLS0pIHtcclxuICAgICAgICBoYWxmZWRnZSA9IGhhbGZlZGdlc1tpSGFsZmVkZ2VdO1xyXG4gICAgICAgIHAwID0gaGFsZmVkZ2UuZ2V0U3RhcnRwb2ludCgpO1xyXG4gICAgICAgIHAxID0gaGFsZmVkZ2UuZ2V0RW5kcG9pbnQoKTtcclxuICAgICAgICByID0gKHktcDAueSkqKHAxLngtcDAueCktKHgtcDAueCkqKHAxLnktcDAueSk7XHJcbiAgICAgICAgaWYgKCFyKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAwO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgaWYgKHIgPiAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAtMTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIHJldHVybiAxO1xyXG4gICAgfTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBFZGdlIG1ldGhvZHNcclxuLy9cclxuXHJcblZvcm9ub2kucHJvdG90eXBlLlZlcnRleCA9IGZ1bmN0aW9uKHgsIHkpIHtcclxuICAgIHRoaXMueCA9IHg7XHJcbiAgICB0aGlzLnkgPSB5O1xyXG4gICAgfTtcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLkVkZ2UgPSBmdW5jdGlvbihsU2l0ZSwgclNpdGUpIHtcclxuICAgIHRoaXMubFNpdGUgPSBsU2l0ZTtcclxuICAgIHRoaXMuclNpdGUgPSByU2l0ZTtcclxuICAgIHRoaXMudmEgPSB0aGlzLnZiID0gbnVsbDtcclxuICAgIH07XHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5IYWxmZWRnZSA9IGZ1bmN0aW9uKGVkZ2UsIGxTaXRlLCByU2l0ZSkge1xyXG4gICAgdGhpcy5zaXRlID0gbFNpdGU7XHJcbiAgICB0aGlzLmVkZ2UgPSBlZGdlO1xyXG4gICAgLy8gJ2FuZ2xlJyBpcyBhIHZhbHVlIHRvIGJlIHVzZWQgZm9yIHByb3Blcmx5IHNvcnRpbmcgdGhlXHJcbiAgICAvLyBoYWxmc2VnbWVudHMgY291bnRlcmNsb2Nrd2lzZS4gQnkgY29udmVudGlvbiwgd2Ugd2lsbFxyXG4gICAgLy8gdXNlIHRoZSBhbmdsZSBvZiB0aGUgbGluZSBkZWZpbmVkIGJ5IHRoZSAnc2l0ZSB0byB0aGUgbGVmdCdcclxuICAgIC8vIHRvIHRoZSAnc2l0ZSB0byB0aGUgcmlnaHQnLlxyXG4gICAgLy8gSG93ZXZlciwgYm9yZGVyIGVkZ2VzIGhhdmUgbm8gJ3NpdGUgdG8gdGhlIHJpZ2h0JzogdGh1cyB3ZVxyXG4gICAgLy8gdXNlIHRoZSBhbmdsZSBvZiBsaW5lIHBlcnBlbmRpY3VsYXIgdG8gdGhlIGhhbGZzZWdtZW50ICh0aGVcclxuICAgIC8vIGVkZ2Ugc2hvdWxkIGhhdmUgYm90aCBlbmQgcG9pbnRzIGRlZmluZWQgaW4gc3VjaCBjYXNlLilcclxuICAgIGlmIChyU2l0ZSkge1xyXG4gICAgICAgIHRoaXMuYW5nbGUgPSBNYXRoLmF0YW4yKHJTaXRlLnktbFNpdGUueSwgclNpdGUueC1sU2l0ZS54KTtcclxuICAgICAgICB9XHJcbiAgICBlbHNlIHtcclxuICAgICAgICB2YXIgdmEgPSBlZGdlLnZhLFxyXG4gICAgICAgICAgICB2YiA9IGVkZ2UudmI7XHJcbiAgICAgICAgLy8gcmhpbGwgMjAxMS0wNS0zMTogdXNlZCB0byBjYWxsIGdldFN0YXJ0cG9pbnQoKS9nZXRFbmRwb2ludCgpLFxyXG4gICAgICAgIC8vIGJ1dCBmb3IgcGVyZm9ybWFuY2UgcHVycG9zZSwgdGhlc2UgYXJlIGV4cGFuZGVkIGluIHBsYWNlIGhlcmUuXHJcbiAgICAgICAgdGhpcy5hbmdsZSA9IGVkZ2UubFNpdGUgPT09IGxTaXRlID9cclxuICAgICAgICAgICAgTWF0aC5hdGFuMih2Yi54LXZhLngsIHZhLnktdmIueSkgOlxyXG4gICAgICAgICAgICBNYXRoLmF0YW4yKHZhLngtdmIueCwgdmIueS12YS55KTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuVm9yb25vaS5wcm90b3R5cGUuY3JlYXRlSGFsZmVkZ2UgPSBmdW5jdGlvbihlZGdlLCBsU2l0ZSwgclNpdGUpIHtcclxuICAgIHJldHVybiBuZXcgdGhpcy5IYWxmZWRnZShlZGdlLCBsU2l0ZSwgclNpdGUpO1xyXG4gICAgfTtcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLkhhbGZlZGdlLnByb3RvdHlwZS5nZXRTdGFydHBvaW50ID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5lZGdlLmxTaXRlID09PSB0aGlzLnNpdGUgPyB0aGlzLmVkZ2UudmEgOiB0aGlzLmVkZ2UudmI7XHJcbiAgICB9O1xyXG5cclxuVm9yb25vaS5wcm90b3R5cGUuSGFsZmVkZ2UucHJvdG90eXBlLmdldEVuZHBvaW50ID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5lZGdlLmxTaXRlID09PSB0aGlzLnNpdGUgPyB0aGlzLmVkZ2UudmIgOiB0aGlzLmVkZ2UudmE7XHJcbiAgICB9O1xyXG5cclxuXHJcblxyXG4vLyB0aGlzIGNyZWF0ZSBhbmQgYWRkIGEgdmVydGV4IHRvIHRoZSBpbnRlcm5hbCBjb2xsZWN0aW9uXHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5jcmVhdGVWZXJ0ZXggPSBmdW5jdGlvbih4LCB5KSB7XHJcbiAgICB2YXIgdiA9IHRoaXMudmVydGV4SnVua3lhcmQucG9wKCk7XHJcbiAgICBpZiAoICF2ICkge1xyXG4gICAgICAgIHYgPSBuZXcgdGhpcy5WZXJ0ZXgoeCwgeSk7XHJcbiAgICAgICAgfVxyXG4gICAgZWxzZSB7XHJcbiAgICAgICAgdi54ID0geDtcclxuICAgICAgICB2LnkgPSB5O1xyXG4gICAgICAgIH1cclxuICAgIHRoaXMudmVydGljZXMucHVzaCh2KTtcclxuICAgIHJldHVybiB2O1xyXG4gICAgfTtcclxuXHJcbi8vIHRoaXMgY3JlYXRlIGFuZCBhZGQgYW4gZWRnZSB0byBpbnRlcm5hbCBjb2xsZWN0aW9uLCBhbmQgYWxzbyBjcmVhdGVcclxuLy8gdHdvIGhhbGZlZGdlcyB3aGljaCBhcmUgYWRkZWQgdG8gZWFjaCBzaXRlJ3MgY291bnRlcmNsb2Nrd2lzZSBhcnJheVxyXG4vLyBvZiBoYWxmZWRnZXMuXHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5jcmVhdGVFZGdlID0gZnVuY3Rpb24obFNpdGUsIHJTaXRlLCB2YSwgdmIpIHtcclxuICAgIHZhciBlZGdlID0gdGhpcy5lZGdlSnVua3lhcmQucG9wKCk7XHJcbiAgICBpZiAoICFlZGdlICkge1xyXG4gICAgICAgIGVkZ2UgPSBuZXcgdGhpcy5FZGdlKGxTaXRlLCByU2l0ZSk7XHJcbiAgICAgICAgfVxyXG4gICAgZWxzZSB7XHJcbiAgICAgICAgZWRnZS5sU2l0ZSA9IGxTaXRlO1xyXG4gICAgICAgIGVkZ2UuclNpdGUgPSByU2l0ZTtcclxuICAgICAgICBlZGdlLnZhID0gZWRnZS52YiA9IG51bGw7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIHRoaXMuZWRnZXMucHVzaChlZGdlKTtcclxuICAgIGlmICh2YSkge1xyXG4gICAgICAgIHRoaXMuc2V0RWRnZVN0YXJ0cG9pbnQoZWRnZSwgbFNpdGUsIHJTaXRlLCB2YSk7XHJcbiAgICAgICAgfVxyXG4gICAgaWYgKHZiKSB7XHJcbiAgICAgICAgdGhpcy5zZXRFZGdlRW5kcG9pbnQoZWRnZSwgbFNpdGUsIHJTaXRlLCB2Yik7XHJcbiAgICAgICAgfVxyXG4gICAgdGhpcy5jZWxsc1tsU2l0ZS52b3Jvbm9pSWRdLmhhbGZlZGdlcy5wdXNoKHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgbFNpdGUsIHJTaXRlKSk7XHJcbiAgICB0aGlzLmNlbGxzW3JTaXRlLnZvcm9ub2lJZF0uaGFsZmVkZ2VzLnB1c2godGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCByU2l0ZSwgbFNpdGUpKTtcclxuICAgIHJldHVybiBlZGdlO1xyXG4gICAgfTtcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLmNyZWF0ZUJvcmRlckVkZ2UgPSBmdW5jdGlvbihsU2l0ZSwgdmEsIHZiKSB7XHJcbiAgICB2YXIgZWRnZSA9IHRoaXMuZWRnZUp1bmt5YXJkLnBvcCgpO1xyXG4gICAgaWYgKCAhZWRnZSApIHtcclxuICAgICAgICBlZGdlID0gbmV3IHRoaXMuRWRnZShsU2l0ZSwgbnVsbCk7XHJcbiAgICAgICAgfVxyXG4gICAgZWxzZSB7XHJcbiAgICAgICAgZWRnZS5sU2l0ZSA9IGxTaXRlO1xyXG4gICAgICAgIGVkZ2UuclNpdGUgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIGVkZ2UudmEgPSB2YTtcclxuICAgIGVkZ2UudmIgPSB2YjtcclxuICAgIHRoaXMuZWRnZXMucHVzaChlZGdlKTtcclxuICAgIHJldHVybiBlZGdlO1xyXG4gICAgfTtcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLnNldEVkZ2VTdGFydHBvaW50ID0gZnVuY3Rpb24oZWRnZSwgbFNpdGUsIHJTaXRlLCB2ZXJ0ZXgpIHtcclxuICAgIGlmICghZWRnZS52YSAmJiAhZWRnZS52Yikge1xyXG4gICAgICAgIGVkZ2UudmEgPSB2ZXJ0ZXg7XHJcbiAgICAgICAgZWRnZS5sU2l0ZSA9IGxTaXRlO1xyXG4gICAgICAgIGVkZ2UuclNpdGUgPSByU2l0ZTtcclxuICAgICAgICB9XHJcbiAgICBlbHNlIGlmIChlZGdlLmxTaXRlID09PSByU2l0ZSkge1xyXG4gICAgICAgIGVkZ2UudmIgPSB2ZXJ0ZXg7XHJcbiAgICAgICAgfVxyXG4gICAgZWxzZSB7XHJcbiAgICAgICAgZWRnZS52YSA9IHZlcnRleDtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuVm9yb25vaS5wcm90b3R5cGUuc2V0RWRnZUVuZHBvaW50ID0gZnVuY3Rpb24oZWRnZSwgbFNpdGUsIHJTaXRlLCB2ZXJ0ZXgpIHtcclxuICAgIHRoaXMuc2V0RWRnZVN0YXJ0cG9pbnQoZWRnZSwgclNpdGUsIGxTaXRlLCB2ZXJ0ZXgpO1xyXG4gICAgfTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBCZWFjaGxpbmUgbWV0aG9kc1xyXG5cclxuLy8gcmhpbGwgMjAxMS0wNi0wNzogRm9yIHNvbWUgcmVhc29ucywgcGVyZm9ybWFuY2Ugc3VmZmVycyBzaWduaWZpY2FudGx5XHJcbi8vIHdoZW4gaW5zdGFuY2lhdGluZyBhIGxpdGVyYWwgb2JqZWN0IGluc3RlYWQgb2YgYW4gZW1wdHkgY3RvclxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5CZWFjaHNlY3Rpb24gPSBmdW5jdGlvbigpIHtcclxuICAgIH07XHJcblxyXG4vLyByaGlsbCAyMDExLTA2LTAyOiBBIGxvdCBvZiBCZWFjaHNlY3Rpb24gaW5zdGFuY2lhdGlvbnNcclxuLy8gb2NjdXIgZHVyaW5nIHRoZSBjb21wdXRhdGlvbiBvZiB0aGUgVm9yb25vaSBkaWFncmFtLFxyXG4vLyBzb21ld2hlcmUgYmV0d2VlbiB0aGUgbnVtYmVyIG9mIHNpdGVzIGFuZCB0d2ljZSB0aGVcclxuLy8gbnVtYmVyIG9mIHNpdGVzLCB3aGlsZSB0aGUgbnVtYmVyIG9mIEJlYWNoc2VjdGlvbnMgb24gdGhlXHJcbi8vIGJlYWNobGluZSBhdCBhbnkgZ2l2ZW4gdGltZSBpcyBjb21wYXJhdGl2ZWx5IGxvdy4gRm9yIHRoaXNcclxuLy8gcmVhc29uLCB3ZSByZXVzZSBhbHJlYWR5IGNyZWF0ZWQgQmVhY2hzZWN0aW9ucywgaW4gb3JkZXJcclxuLy8gdG8gYXZvaWQgbmV3IG1lbW9yeSBhbGxvY2F0aW9uLiBUaGlzIHJlc3VsdGVkIGluIGEgbWVhc3VyYWJsZVxyXG4vLyBwZXJmb3JtYW5jZSBnYWluLlxyXG5cclxuVm9yb25vaS5wcm90b3R5cGUuY3JlYXRlQmVhY2hzZWN0aW9uID0gZnVuY3Rpb24oc2l0ZSkge1xyXG4gICAgdmFyIGJlYWNoc2VjdGlvbiA9IHRoaXMuYmVhY2hzZWN0aW9uSnVua3lhcmQucG9wKCk7XHJcbiAgICBpZiAoIWJlYWNoc2VjdGlvbikge1xyXG4gICAgICAgIGJlYWNoc2VjdGlvbiA9IG5ldyB0aGlzLkJlYWNoc2VjdGlvbigpO1xyXG4gICAgICAgIH1cclxuICAgIGJlYWNoc2VjdGlvbi5zaXRlID0gc2l0ZTtcclxuICAgIHJldHVybiBiZWFjaHNlY3Rpb247XHJcbiAgICB9O1xyXG5cclxuLy8gY2FsY3VsYXRlIHRoZSBsZWZ0IGJyZWFrIHBvaW50IG9mIGEgcGFydGljdWxhciBiZWFjaCBzZWN0aW9uLFxyXG4vLyBnaXZlbiBhIHBhcnRpY3VsYXIgc3dlZXAgbGluZVxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5sZWZ0QnJlYWtQb2ludCA9IGZ1bmN0aW9uKGFyYywgZGlyZWN0cml4KSB7XHJcbiAgICAvLyBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL1BhcmFib2xhXHJcbiAgICAvLyBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL1F1YWRyYXRpY19lcXVhdGlvblxyXG4gICAgLy8gaDEgPSB4MSxcclxuICAgIC8vIGsxID0gKHkxK2RpcmVjdHJpeCkvMixcclxuICAgIC8vIGgyID0geDIsXHJcbiAgICAvLyBrMiA9ICh5MitkaXJlY3RyaXgpLzIsXHJcbiAgICAvLyBwMSA9IGsxLWRpcmVjdHJpeCxcclxuICAgIC8vIGExID0gMS8oNCpwMSksXHJcbiAgICAvLyBiMSA9IC1oMS8oMipwMSksXHJcbiAgICAvLyBjMSA9IGgxKmgxLyg0KnAxKStrMSxcclxuICAgIC8vIHAyID0gazItZGlyZWN0cml4LFxyXG4gICAgLy8gYTIgPSAxLyg0KnAyKSxcclxuICAgIC8vIGIyID0gLWgyLygyKnAyKSxcclxuICAgIC8vIGMyID0gaDIqaDIvKDQqcDIpK2syLFxyXG4gICAgLy8geCA9ICgtKGIyLWIxKSArIE1hdGguc3FydCgoYjItYjEpKihiMi1iMSkgLSA0KihhMi1hMSkqKGMyLWMxKSkpIC8gKDIqKGEyLWExKSlcclxuICAgIC8vIFdoZW4geDEgYmVjb21lIHRoZSB4LW9yaWdpbjpcclxuICAgIC8vIGgxID0gMCxcclxuICAgIC8vIGsxID0gKHkxK2RpcmVjdHJpeCkvMixcclxuICAgIC8vIGgyID0geDIteDEsXHJcbiAgICAvLyBrMiA9ICh5MitkaXJlY3RyaXgpLzIsXHJcbiAgICAvLyBwMSA9IGsxLWRpcmVjdHJpeCxcclxuICAgIC8vIGExID0gMS8oNCpwMSksXHJcbiAgICAvLyBiMSA9IDAsXHJcbiAgICAvLyBjMSA9IGsxLFxyXG4gICAgLy8gcDIgPSBrMi1kaXJlY3RyaXgsXHJcbiAgICAvLyBhMiA9IDEvKDQqcDIpLFxyXG4gICAgLy8gYjIgPSAtaDIvKDIqcDIpLFxyXG4gICAgLy8gYzIgPSBoMipoMi8oNCpwMikrazIsXHJcbiAgICAvLyB4ID0gKC1iMiArIE1hdGguc3FydChiMipiMiAtIDQqKGEyLWExKSooYzItazEpKSkgLyAoMiooYTItYTEpKSArIHgxXHJcblxyXG4gICAgLy8gY2hhbmdlIGNvZGUgYmVsb3cgYXQgeW91ciBvd24gcmlzazogY2FyZSBoYXMgYmVlbiB0YWtlbiB0b1xyXG4gICAgLy8gcmVkdWNlIGVycm9ycyBkdWUgdG8gY29tcHV0ZXJzJyBmaW5pdGUgYXJpdGhtZXRpYyBwcmVjaXNpb24uXHJcbiAgICAvLyBNYXliZSBjYW4gc3RpbGwgYmUgaW1wcm92ZWQsIHdpbGwgc2VlIGlmIGFueSBtb3JlIG9mIHRoaXNcclxuICAgIC8vIGtpbmQgb2YgZXJyb3JzIHBvcCB1cCBhZ2Fpbi5cclxuICAgIHZhciBzaXRlID0gYXJjLnNpdGUsXHJcbiAgICAgICAgcmZvY3ggPSBzaXRlLngsXHJcbiAgICAgICAgcmZvY3kgPSBzaXRlLnksXHJcbiAgICAgICAgcGJ5MiA9IHJmb2N5LWRpcmVjdHJpeDtcclxuICAgIC8vIHBhcmFib2xhIGluIGRlZ2VuZXJhdGUgY2FzZSB3aGVyZSBmb2N1cyBpcyBvbiBkaXJlY3RyaXhcclxuICAgIGlmICghcGJ5Mikge1xyXG4gICAgICAgIHJldHVybiByZm9jeDtcclxuICAgICAgICB9XHJcbiAgICB2YXIgbEFyYyA9IGFyYy5yYlByZXZpb3VzO1xyXG4gICAgaWYgKCFsQXJjKSB7XHJcbiAgICAgICAgcmV0dXJuIC1JbmZpbml0eTtcclxuICAgICAgICB9XHJcbiAgICBzaXRlID0gbEFyYy5zaXRlO1xyXG4gICAgdmFyIGxmb2N4ID0gc2l0ZS54LFxyXG4gICAgICAgIGxmb2N5ID0gc2l0ZS55LFxyXG4gICAgICAgIHBsYnkyID0gbGZvY3ktZGlyZWN0cml4O1xyXG4gICAgLy8gcGFyYWJvbGEgaW4gZGVnZW5lcmF0ZSBjYXNlIHdoZXJlIGZvY3VzIGlzIG9uIGRpcmVjdHJpeFxyXG4gICAgaWYgKCFwbGJ5Mikge1xyXG4gICAgICAgIHJldHVybiBsZm9jeDtcclxuICAgICAgICB9XHJcbiAgICB2YXIgaGwgPSBsZm9jeC1yZm9jeCxcclxuICAgICAgICBhYnkyID0gMS9wYnkyLTEvcGxieTIsXHJcbiAgICAgICAgYiA9IGhsL3BsYnkyO1xyXG4gICAgaWYgKGFieTIpIHtcclxuICAgICAgICByZXR1cm4gKC1iK3RoaXMuc3FydChiKmItMiphYnkyKihobCpobC8oLTIqcGxieTIpLWxmb2N5K3BsYnkyLzIrcmZvY3ktcGJ5Mi8yKSkpL2FieTIrcmZvY3g7XHJcbiAgICAgICAgfVxyXG4gICAgLy8gYm90aCBwYXJhYm9sYXMgaGF2ZSBzYW1lIGRpc3RhbmNlIHRvIGRpcmVjdHJpeCwgdGh1cyBicmVhayBwb2ludCBpcyBtaWR3YXlcclxuICAgIHJldHVybiAocmZvY3grbGZvY3gpLzI7XHJcbiAgICB9O1xyXG5cclxuLy8gY2FsY3VsYXRlIHRoZSByaWdodCBicmVhayBwb2ludCBvZiBhIHBhcnRpY3VsYXIgYmVhY2ggc2VjdGlvbixcclxuLy8gZ2l2ZW4gYSBwYXJ0aWN1bGFyIGRpcmVjdHJpeFxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5yaWdodEJyZWFrUG9pbnQgPSBmdW5jdGlvbihhcmMsIGRpcmVjdHJpeCkge1xyXG4gICAgdmFyIHJBcmMgPSBhcmMucmJOZXh0O1xyXG4gICAgaWYgKHJBcmMpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5sZWZ0QnJlYWtQb2ludChyQXJjLCBkaXJlY3RyaXgpO1xyXG4gICAgICAgIH1cclxuICAgIHZhciBzaXRlID0gYXJjLnNpdGU7XHJcbiAgICByZXR1cm4gc2l0ZS55ID09PSBkaXJlY3RyaXggPyBzaXRlLnggOiBJbmZpbml0eTtcclxuICAgIH07XHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5kZXRhY2hCZWFjaHNlY3Rpb24gPSBmdW5jdGlvbihiZWFjaHNlY3Rpb24pIHtcclxuICAgIHRoaXMuZGV0YWNoQ2lyY2xlRXZlbnQoYmVhY2hzZWN0aW9uKTsgLy8gZGV0YWNoIHBvdGVudGlhbGx5IGF0dGFjaGVkIGNpcmNsZSBldmVudFxyXG4gICAgdGhpcy5iZWFjaGxpbmUucmJSZW1vdmVOb2RlKGJlYWNoc2VjdGlvbik7IC8vIHJlbW92ZSBmcm9tIFJCLXRyZWVcclxuICAgIHRoaXMuYmVhY2hzZWN0aW9uSnVua3lhcmQucHVzaChiZWFjaHNlY3Rpb24pOyAvLyBtYXJrIGZvciByZXVzZVxyXG4gICAgfTtcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLnJlbW92ZUJlYWNoc2VjdGlvbiA9IGZ1bmN0aW9uKGJlYWNoc2VjdGlvbikge1xyXG4gICAgdmFyIGNpcmNsZSA9IGJlYWNoc2VjdGlvbi5jaXJjbGVFdmVudCxcclxuICAgICAgICB4ID0gY2lyY2xlLngsXHJcbiAgICAgICAgeSA9IGNpcmNsZS55Y2VudGVyLFxyXG4gICAgICAgIHZlcnRleCA9IHRoaXMuY3JlYXRlVmVydGV4KHgsIHkpLFxyXG4gICAgICAgIHByZXZpb3VzID0gYmVhY2hzZWN0aW9uLnJiUHJldmlvdXMsXHJcbiAgICAgICAgbmV4dCA9IGJlYWNoc2VjdGlvbi5yYk5leHQsXHJcbiAgICAgICAgZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnMgPSBbYmVhY2hzZWN0aW9uXSxcclxuICAgICAgICBhYnNfZm4gPSBNYXRoLmFicztcclxuXHJcbiAgICAvLyByZW1vdmUgY29sbGFwc2VkIGJlYWNoc2VjdGlvbiBmcm9tIGJlYWNobGluZVxyXG4gICAgdGhpcy5kZXRhY2hCZWFjaHNlY3Rpb24oYmVhY2hzZWN0aW9uKTtcclxuXHJcbiAgICAvLyB0aGVyZSBjb3VsZCBiZSBtb3JlIHRoYW4gb25lIGVtcHR5IGFyYyBhdCB0aGUgZGVsZXRpb24gcG9pbnQsIHRoaXNcclxuICAgIC8vIGhhcHBlbnMgd2hlbiBtb3JlIHRoYW4gdHdvIGVkZ2VzIGFyZSBsaW5rZWQgYnkgdGhlIHNhbWUgdmVydGV4LFxyXG4gICAgLy8gc28gd2Ugd2lsbCBjb2xsZWN0IGFsbCB0aG9zZSBlZGdlcyBieSBsb29raW5nIHVwIGJvdGggc2lkZXMgb2ZcclxuICAgIC8vIHRoZSBkZWxldGlvbiBwb2ludC5cclxuICAgIC8vIGJ5IHRoZSB3YXksIHRoZXJlIGlzICphbHdheXMqIGEgcHJlZGVjZXNzb3Ivc3VjY2Vzc29yIHRvIGFueSBjb2xsYXBzZWRcclxuICAgIC8vIGJlYWNoIHNlY3Rpb24sIGl0J3MganVzdCBpbXBvc3NpYmxlIHRvIGhhdmUgYSBjb2xsYXBzaW5nIGZpcnN0L2xhc3RcclxuICAgIC8vIGJlYWNoIHNlY3Rpb25zIG9uIHRoZSBiZWFjaGxpbmUsIHNpbmNlIHRoZXkgb2J2aW91c2x5IGFyZSB1bmNvbnN0cmFpbmVkXHJcbiAgICAvLyBvbiB0aGVpciBsZWZ0L3JpZ2h0IHNpZGUuXHJcblxyXG4gICAgLy8gbG9vayBsZWZ0XHJcbiAgICB2YXIgbEFyYyA9IHByZXZpb3VzO1xyXG4gICAgd2hpbGUgKGxBcmMuY2lyY2xlRXZlbnQgJiYgYWJzX2ZuKHgtbEFyYy5jaXJjbGVFdmVudC54KTwxZS05ICYmIGFic19mbih5LWxBcmMuY2lyY2xlRXZlbnQueWNlbnRlcik8MWUtOSkge1xyXG4gICAgICAgIHByZXZpb3VzID0gbEFyYy5yYlByZXZpb3VzO1xyXG4gICAgICAgIGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zLnVuc2hpZnQobEFyYyk7XHJcbiAgICAgICAgdGhpcy5kZXRhY2hCZWFjaHNlY3Rpb24obEFyYyk7IC8vIG1hcmsgZm9yIHJldXNlXHJcbiAgICAgICAgbEFyYyA9IHByZXZpb3VzO1xyXG4gICAgICAgIH1cclxuICAgIC8vIGV2ZW4gdGhvdWdoIGl0IGlzIG5vdCBkaXNhcHBlYXJpbmcsIEkgd2lsbCBhbHNvIGFkZCB0aGUgYmVhY2ggc2VjdGlvblxyXG4gICAgLy8gaW1tZWRpYXRlbHkgdG8gdGhlIGxlZnQgb2YgdGhlIGxlZnQtbW9zdCBjb2xsYXBzZWQgYmVhY2ggc2VjdGlvbiwgZm9yXHJcbiAgICAvLyBjb252ZW5pZW5jZSwgc2luY2Ugd2UgbmVlZCB0byByZWZlciB0byBpdCBsYXRlciBhcyB0aGlzIGJlYWNoIHNlY3Rpb25cclxuICAgIC8vIGlzIHRoZSAnbGVmdCcgc2l0ZSBvZiBhbiBlZGdlIGZvciB3aGljaCBhIHN0YXJ0IHBvaW50IGlzIHNldC5cclxuICAgIGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zLnVuc2hpZnQobEFyYyk7XHJcbiAgICB0aGlzLmRldGFjaENpcmNsZUV2ZW50KGxBcmMpO1xyXG5cclxuICAgIC8vIGxvb2sgcmlnaHRcclxuICAgIHZhciByQXJjID0gbmV4dDtcclxuICAgIHdoaWxlIChyQXJjLmNpcmNsZUV2ZW50ICYmIGFic19mbih4LXJBcmMuY2lyY2xlRXZlbnQueCk8MWUtOSAmJiBhYnNfZm4oeS1yQXJjLmNpcmNsZUV2ZW50LnljZW50ZXIpPDFlLTkpIHtcclxuICAgICAgICBuZXh0ID0gckFyYy5yYk5leHQ7XHJcbiAgICAgICAgZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnMucHVzaChyQXJjKTtcclxuICAgICAgICB0aGlzLmRldGFjaEJlYWNoc2VjdGlvbihyQXJjKTsgLy8gbWFyayBmb3IgcmV1c2VcclxuICAgICAgICByQXJjID0gbmV4dDtcclxuICAgICAgICB9XHJcbiAgICAvLyB3ZSBhbHNvIGhhdmUgdG8gYWRkIHRoZSBiZWFjaCBzZWN0aW9uIGltbWVkaWF0ZWx5IHRvIHRoZSByaWdodCBvZiB0aGVcclxuICAgIC8vIHJpZ2h0LW1vc3QgY29sbGFwc2VkIGJlYWNoIHNlY3Rpb24sIHNpbmNlIHRoZXJlIGlzIGFsc28gYSBkaXNhcHBlYXJpbmdcclxuICAgIC8vIHRyYW5zaXRpb24gcmVwcmVzZW50aW5nIGFuIGVkZ2UncyBzdGFydCBwb2ludCBvbiBpdHMgbGVmdC5cclxuICAgIGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zLnB1c2gockFyYyk7XHJcbiAgICB0aGlzLmRldGFjaENpcmNsZUV2ZW50KHJBcmMpO1xyXG5cclxuICAgIC8vIHdhbGsgdGhyb3VnaCBhbGwgdGhlIGRpc2FwcGVhcmluZyB0cmFuc2l0aW9ucyBiZXR3ZWVuIGJlYWNoIHNlY3Rpb25zIGFuZFxyXG4gICAgLy8gc2V0IHRoZSBzdGFydCBwb2ludCBvZiB0aGVpciAoaW1wbGllZCkgZWRnZS5cclxuICAgIHZhciBuQXJjcyA9IGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zLmxlbmd0aCxcclxuICAgICAgICBpQXJjO1xyXG4gICAgZm9yIChpQXJjPTE7IGlBcmM8bkFyY3M7IGlBcmMrKykge1xyXG4gICAgICAgIHJBcmMgPSBkaXNhcHBlYXJpbmdUcmFuc2l0aW9uc1tpQXJjXTtcclxuICAgICAgICBsQXJjID0gZGlzYXBwZWFyaW5nVHJhbnNpdGlvbnNbaUFyYy0xXTtcclxuICAgICAgICB0aGlzLnNldEVkZ2VTdGFydHBvaW50KHJBcmMuZWRnZSwgbEFyYy5zaXRlLCByQXJjLnNpdGUsIHZlcnRleCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIC8vIGNyZWF0ZSBhIG5ldyBlZGdlIGFzIHdlIGhhdmUgbm93IGEgbmV3IHRyYW5zaXRpb24gYmV0d2VlblxyXG4gICAgLy8gdHdvIGJlYWNoIHNlY3Rpb25zIHdoaWNoIHdlcmUgcHJldmlvdXNseSBub3QgYWRqYWNlbnQuXHJcbiAgICAvLyBzaW5jZSB0aGlzIGVkZ2UgYXBwZWFycyBhcyBhIG5ldyB2ZXJ0ZXggaXMgZGVmaW5lZCwgdGhlIHZlcnRleFxyXG4gICAgLy8gYWN0dWFsbHkgZGVmaW5lIGFuIGVuZCBwb2ludCBvZiB0aGUgZWRnZSAocmVsYXRpdmUgdG8gdGhlIHNpdGVcclxuICAgIC8vIG9uIHRoZSBsZWZ0KVxyXG4gICAgbEFyYyA9IGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zWzBdO1xyXG4gICAgckFyYyA9IGRpc2FwcGVhcmluZ1RyYW5zaXRpb25zW25BcmNzLTFdO1xyXG4gICAgckFyYy5lZGdlID0gdGhpcy5jcmVhdGVFZGdlKGxBcmMuc2l0ZSwgckFyYy5zaXRlLCB1bmRlZmluZWQsIHZlcnRleCk7XHJcblxyXG4gICAgLy8gY3JlYXRlIGNpcmNsZSBldmVudHMgaWYgYW55IGZvciBiZWFjaCBzZWN0aW9ucyBsZWZ0IGluIHRoZSBiZWFjaGxpbmVcclxuICAgIC8vIGFkamFjZW50IHRvIGNvbGxhcHNlZCBzZWN0aW9uc1xyXG4gICAgdGhpcy5hdHRhY2hDaXJjbGVFdmVudChsQXJjKTtcclxuICAgIHRoaXMuYXR0YWNoQ2lyY2xlRXZlbnQockFyYyk7XHJcbiAgICB9O1xyXG5cclxuVm9yb25vaS5wcm90b3R5cGUuYWRkQmVhY2hzZWN0aW9uID0gZnVuY3Rpb24oc2l0ZSkge1xyXG4gICAgdmFyIHggPSBzaXRlLngsXHJcbiAgICAgICAgZGlyZWN0cml4ID0gc2l0ZS55O1xyXG5cclxuICAgIC8vIGZpbmQgdGhlIGxlZnQgYW5kIHJpZ2h0IGJlYWNoIHNlY3Rpb25zIHdoaWNoIHdpbGwgc3Vycm91bmQgdGhlIG5ld2x5XHJcbiAgICAvLyBjcmVhdGVkIGJlYWNoIHNlY3Rpb24uXHJcbiAgICAvLyByaGlsbCAyMDExLTA2LTAxOiBUaGlzIGxvb3AgaXMgb25lIG9mIHRoZSBtb3N0IG9mdGVuIGV4ZWN1dGVkLFxyXG4gICAgLy8gaGVuY2Ugd2UgZXhwYW5kIGluLXBsYWNlIHRoZSBjb21wYXJpc29uLWFnYWluc3QtZXBzaWxvbiBjYWxscy5cclxuICAgIHZhciBsQXJjLCByQXJjLFxyXG4gICAgICAgIGR4bCwgZHhyLFxyXG4gICAgICAgIG5vZGUgPSB0aGlzLmJlYWNobGluZS5yb290O1xyXG5cclxuICAgIHdoaWxlIChub2RlKSB7XHJcbiAgICAgICAgZHhsID0gdGhpcy5sZWZ0QnJlYWtQb2ludChub2RlLGRpcmVjdHJpeCkteDtcclxuICAgICAgICAvLyB4IGxlc3NUaGFuV2l0aEVwc2lsb24geGwgPT4gZmFsbHMgc29tZXdoZXJlIGJlZm9yZSB0aGUgbGVmdCBlZGdlIG9mIHRoZSBiZWFjaHNlY3Rpb25cclxuICAgICAgICBpZiAoZHhsID4gMWUtOSkge1xyXG4gICAgICAgICAgICAvLyB0aGlzIGNhc2Ugc2hvdWxkIG5ldmVyIGhhcHBlblxyXG4gICAgICAgICAgICAvLyBpZiAoIW5vZGUucmJMZWZ0KSB7XHJcbiAgICAgICAgICAgIC8vICAgIHJBcmMgPSBub2RlLnJiTGVmdDtcclxuICAgICAgICAgICAgLy8gICAgYnJlYWs7XHJcbiAgICAgICAgICAgIC8vICAgIH1cclxuICAgICAgICAgICAgbm9kZSA9IG5vZGUucmJMZWZ0O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIGR4ciA9IHgtdGhpcy5yaWdodEJyZWFrUG9pbnQobm9kZSxkaXJlY3RyaXgpO1xyXG4gICAgICAgICAgICAvLyB4IGdyZWF0ZXJUaGFuV2l0aEVwc2lsb24geHIgPT4gZmFsbHMgc29tZXdoZXJlIGFmdGVyIHRoZSByaWdodCBlZGdlIG9mIHRoZSBiZWFjaHNlY3Rpb25cclxuICAgICAgICAgICAgaWYgKGR4ciA+IDFlLTkpIHtcclxuICAgICAgICAgICAgICAgIGlmICghbm9kZS5yYlJpZ2h0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbEFyYyA9IG5vZGU7XHJcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgbm9kZSA9IG5vZGUucmJSaWdodDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyB4IGVxdWFsV2l0aEVwc2lsb24geGwgPT4gZmFsbHMgZXhhY3RseSBvbiB0aGUgbGVmdCBlZGdlIG9mIHRoZSBiZWFjaHNlY3Rpb25cclxuICAgICAgICAgICAgICAgIGlmIChkeGwgPiAtMWUtOSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGxBcmMgPSBub2RlLnJiUHJldmlvdXM7XHJcbiAgICAgICAgICAgICAgICAgICAgckFyYyA9IG5vZGU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgLy8geCBlcXVhbFdpdGhFcHNpbG9uIHhyID0+IGZhbGxzIGV4YWN0bHkgb24gdGhlIHJpZ2h0IGVkZ2Ugb2YgdGhlIGJlYWNoc2VjdGlvblxyXG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoZHhyID4gLTFlLTkpIHtcclxuICAgICAgICAgICAgICAgICAgICBsQXJjID0gbm9kZTtcclxuICAgICAgICAgICAgICAgICAgICByQXJjID0gbm9kZS5yYk5leHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgLy8gZmFsbHMgZXhhY3RseSBzb21ld2hlcmUgaW4gdGhlIG1pZGRsZSBvZiB0aGUgYmVhY2hzZWN0aW9uXHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBsQXJjID0gckFyYyA9IG5vZGU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAvLyBhdCB0aGlzIHBvaW50LCBrZWVwIGluIG1pbmQgdGhhdCBsQXJjIGFuZC9vciByQXJjIGNvdWxkIGJlXHJcbiAgICAvLyB1bmRlZmluZWQgb3IgbnVsbC5cclxuXHJcbiAgICAvLyBjcmVhdGUgYSBuZXcgYmVhY2ggc2VjdGlvbiBvYmplY3QgZm9yIHRoZSBzaXRlIGFuZCBhZGQgaXQgdG8gUkItdHJlZVxyXG4gICAgdmFyIG5ld0FyYyA9IHRoaXMuY3JlYXRlQmVhY2hzZWN0aW9uKHNpdGUpO1xyXG4gICAgdGhpcy5iZWFjaGxpbmUucmJJbnNlcnRTdWNjZXNzb3IobEFyYywgbmV3QXJjKTtcclxuXHJcbiAgICAvLyBjYXNlczpcclxuICAgIC8vXHJcblxyXG4gICAgLy8gW251bGwsbnVsbF1cclxuICAgIC8vIGxlYXN0IGxpa2VseSBjYXNlOiBuZXcgYmVhY2ggc2VjdGlvbiBpcyB0aGUgZmlyc3QgYmVhY2ggc2VjdGlvbiBvbiB0aGVcclxuICAgIC8vIGJlYWNobGluZS5cclxuICAgIC8vIFRoaXMgY2FzZSBtZWFuczpcclxuICAgIC8vICAgbm8gbmV3IHRyYW5zaXRpb24gYXBwZWFyc1xyXG4gICAgLy8gICBubyBjb2xsYXBzaW5nIGJlYWNoIHNlY3Rpb25cclxuICAgIC8vICAgbmV3IGJlYWNoc2VjdGlvbiBiZWNvbWUgcm9vdCBvZiB0aGUgUkItdHJlZVxyXG4gICAgaWYgKCFsQXJjICYmICFyQXJjKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAvLyBbbEFyYyxyQXJjXSB3aGVyZSBsQXJjID09IHJBcmNcclxuICAgIC8vIG1vc3QgbGlrZWx5IGNhc2U6IG5ldyBiZWFjaCBzZWN0aW9uIHNwbGl0IGFuIGV4aXN0aW5nIGJlYWNoXHJcbiAgICAvLyBzZWN0aW9uLlxyXG4gICAgLy8gVGhpcyBjYXNlIG1lYW5zOlxyXG4gICAgLy8gICBvbmUgbmV3IHRyYW5zaXRpb24gYXBwZWFyc1xyXG4gICAgLy8gICB0aGUgbGVmdCBhbmQgcmlnaHQgYmVhY2ggc2VjdGlvbiBtaWdodCBiZSBjb2xsYXBzaW5nIGFzIGEgcmVzdWx0XHJcbiAgICAvLyAgIHR3byBuZXcgbm9kZXMgYWRkZWQgdG8gdGhlIFJCLXRyZWVcclxuICAgIGlmIChsQXJjID09PSByQXJjKSB7XHJcbiAgICAgICAgLy8gaW52YWxpZGF0ZSBjaXJjbGUgZXZlbnQgb2Ygc3BsaXQgYmVhY2ggc2VjdGlvblxyXG4gICAgICAgIHRoaXMuZGV0YWNoQ2lyY2xlRXZlbnQobEFyYyk7XHJcblxyXG4gICAgICAgIC8vIHNwbGl0IHRoZSBiZWFjaCBzZWN0aW9uIGludG8gdHdvIHNlcGFyYXRlIGJlYWNoIHNlY3Rpb25zXHJcbiAgICAgICAgckFyYyA9IHRoaXMuY3JlYXRlQmVhY2hzZWN0aW9uKGxBcmMuc2l0ZSk7XHJcbiAgICAgICAgdGhpcy5iZWFjaGxpbmUucmJJbnNlcnRTdWNjZXNzb3IobmV3QXJjLCByQXJjKTtcclxuXHJcbiAgICAgICAgLy8gc2luY2Ugd2UgaGF2ZSBhIG5ldyB0cmFuc2l0aW9uIGJldHdlZW4gdHdvIGJlYWNoIHNlY3Rpb25zLFxyXG4gICAgICAgIC8vIGEgbmV3IGVkZ2UgaXMgYm9yblxyXG4gICAgICAgIG5ld0FyYy5lZGdlID0gckFyYy5lZGdlID0gdGhpcy5jcmVhdGVFZGdlKGxBcmMuc2l0ZSwgbmV3QXJjLnNpdGUpO1xyXG5cclxuICAgICAgICAvLyBjaGVjayB3aGV0aGVyIHRoZSBsZWZ0IGFuZCByaWdodCBiZWFjaCBzZWN0aW9ucyBhcmUgY29sbGFwc2luZ1xyXG4gICAgICAgIC8vIGFuZCBpZiBzbyBjcmVhdGUgY2lyY2xlIGV2ZW50cywgdG8gYmUgbm90aWZpZWQgd2hlbiB0aGUgcG9pbnQgb2ZcclxuICAgICAgICAvLyBjb2xsYXBzZSBpcyByZWFjaGVkLlxyXG4gICAgICAgIHRoaXMuYXR0YWNoQ2lyY2xlRXZlbnQobEFyYyk7XHJcbiAgICAgICAgdGhpcy5hdHRhY2hDaXJjbGVFdmVudChyQXJjKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgIC8vIFtsQXJjLG51bGxdXHJcbiAgICAvLyBldmVuIGxlc3MgbGlrZWx5IGNhc2U6IG5ldyBiZWFjaCBzZWN0aW9uIGlzIHRoZSAqbGFzdCogYmVhY2ggc2VjdGlvblxyXG4gICAgLy8gb24gdGhlIGJlYWNobGluZSAtLSB0aGlzIGNhbiBoYXBwZW4gKm9ubHkqIGlmICphbGwqIHRoZSBwcmV2aW91cyBiZWFjaFxyXG4gICAgLy8gc2VjdGlvbnMgY3VycmVudGx5IG9uIHRoZSBiZWFjaGxpbmUgc2hhcmUgdGhlIHNhbWUgeSB2YWx1ZSBhc1xyXG4gICAgLy8gdGhlIG5ldyBiZWFjaCBzZWN0aW9uLlxyXG4gICAgLy8gVGhpcyBjYXNlIG1lYW5zOlxyXG4gICAgLy8gICBvbmUgbmV3IHRyYW5zaXRpb24gYXBwZWFyc1xyXG4gICAgLy8gICBubyBjb2xsYXBzaW5nIGJlYWNoIHNlY3Rpb24gYXMgYSByZXN1bHRcclxuICAgIC8vICAgbmV3IGJlYWNoIHNlY3Rpb24gYmVjb21lIHJpZ2h0LW1vc3Qgbm9kZSBvZiB0aGUgUkItdHJlZVxyXG4gICAgaWYgKGxBcmMgJiYgIXJBcmMpIHtcclxuICAgICAgICBuZXdBcmMuZWRnZSA9IHRoaXMuY3JlYXRlRWRnZShsQXJjLnNpdGUsbmV3QXJjLnNpdGUpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgLy8gW251bGwsckFyY11cclxuICAgIC8vIGltcG9zc2libGUgY2FzZTogYmVjYXVzZSBzaXRlcyBhcmUgc3RyaWN0bHkgcHJvY2Vzc2VkIGZyb20gdG9wIHRvIGJvdHRvbSxcclxuICAgIC8vIGFuZCBsZWZ0IHRvIHJpZ2h0LCB3aGljaCBndWFyYW50ZWVzIHRoYXQgdGhlcmUgd2lsbCBhbHdheXMgYmUgYSBiZWFjaCBzZWN0aW9uXHJcbiAgICAvLyBvbiB0aGUgbGVmdCAtLSBleGNlcHQgb2YgY291cnNlIHdoZW4gdGhlcmUgYXJlIG5vIGJlYWNoIHNlY3Rpb24gYXQgYWxsIG9uXHJcbiAgICAvLyB0aGUgYmVhY2ggbGluZSwgd2hpY2ggY2FzZSB3YXMgaGFuZGxlZCBhYm92ZS5cclxuICAgIC8vIHJoaWxsIDIwMTEtMDYtMDI6IE5vIHBvaW50IHRlc3RpbmcgaW4gbm9uLWRlYnVnIHZlcnNpb25cclxuICAgIC8vaWYgKCFsQXJjICYmIHJBcmMpIHtcclxuICAgIC8vICAgIHRocm93IFwiVm9yb25vaS5hZGRCZWFjaHNlY3Rpb24oKTogV2hhdCBpcyB0aGlzIEkgZG9uJ3QgZXZlblwiO1xyXG4gICAgLy8gICAgfVxyXG5cclxuICAgIC8vIFtsQXJjLHJBcmNdIHdoZXJlIGxBcmMgIT0gckFyY1xyXG4gICAgLy8gc29tZXdoYXQgbGVzcyBsaWtlbHkgY2FzZTogbmV3IGJlYWNoIHNlY3Rpb24gZmFsbHMgKmV4YWN0bHkqIGluIGJldHdlZW4gdHdvXHJcbiAgICAvLyBleGlzdGluZyBiZWFjaCBzZWN0aW9uc1xyXG4gICAgLy8gVGhpcyBjYXNlIG1lYW5zOlxyXG4gICAgLy8gICBvbmUgdHJhbnNpdGlvbiBkaXNhcHBlYXJzXHJcbiAgICAvLyAgIHR3byBuZXcgdHJhbnNpdGlvbnMgYXBwZWFyXHJcbiAgICAvLyAgIHRoZSBsZWZ0IGFuZCByaWdodCBiZWFjaCBzZWN0aW9uIG1pZ2h0IGJlIGNvbGxhcHNpbmcgYXMgYSByZXN1bHRcclxuICAgIC8vICAgb25seSBvbmUgbmV3IG5vZGUgYWRkZWQgdG8gdGhlIFJCLXRyZWVcclxuICAgIGlmIChsQXJjICE9PSByQXJjKSB7XHJcbiAgICAgICAgLy8gaW52YWxpZGF0ZSBjaXJjbGUgZXZlbnRzIG9mIGxlZnQgYW5kIHJpZ2h0IHNpdGVzXHJcbiAgICAgICAgdGhpcy5kZXRhY2hDaXJjbGVFdmVudChsQXJjKTtcclxuICAgICAgICB0aGlzLmRldGFjaENpcmNsZUV2ZW50KHJBcmMpO1xyXG5cclxuICAgICAgICAvLyBhbiBleGlzdGluZyB0cmFuc2l0aW9uIGRpc2FwcGVhcnMsIG1lYW5pbmcgYSB2ZXJ0ZXggaXMgZGVmaW5lZCBhdFxyXG4gICAgICAgIC8vIHRoZSBkaXNhcHBlYXJhbmNlIHBvaW50LlxyXG4gICAgICAgIC8vIHNpbmNlIHRoZSBkaXNhcHBlYXJhbmNlIGlzIGNhdXNlZCBieSB0aGUgbmV3IGJlYWNoc2VjdGlvbiwgdGhlXHJcbiAgICAgICAgLy8gdmVydGV4IGlzIGF0IHRoZSBjZW50ZXIgb2YgdGhlIGNpcmN1bXNjcmliZWQgY2lyY2xlIG9mIHRoZSBsZWZ0LFxyXG4gICAgICAgIC8vIG5ldyBhbmQgcmlnaHQgYmVhY2hzZWN0aW9ucy5cclxuICAgICAgICAvLyBodHRwOi8vbWF0aGZvcnVtLm9yZy9saWJyYXJ5L2RybWF0aC92aWV3LzU1MDAyLmh0bWxcclxuICAgICAgICAvLyBFeGNlcHQgdGhhdCBJIGJyaW5nIHRoZSBvcmlnaW4gYXQgQSB0byBzaW1wbGlmeVxyXG4gICAgICAgIC8vIGNhbGN1bGF0aW9uXHJcbiAgICAgICAgdmFyIGxTaXRlID0gbEFyYy5zaXRlLFxyXG4gICAgICAgICAgICBheCA9IGxTaXRlLngsXHJcbiAgICAgICAgICAgIGF5ID0gbFNpdGUueSxcclxuICAgICAgICAgICAgYng9c2l0ZS54LWF4LFxyXG4gICAgICAgICAgICBieT1zaXRlLnktYXksXHJcbiAgICAgICAgICAgIHJTaXRlID0gckFyYy5zaXRlLFxyXG4gICAgICAgICAgICBjeD1yU2l0ZS54LWF4LFxyXG4gICAgICAgICAgICBjeT1yU2l0ZS55LWF5LFxyXG4gICAgICAgICAgICBkPTIqKGJ4KmN5LWJ5KmN4KSxcclxuICAgICAgICAgICAgaGI9YngqYngrYnkqYnksXHJcbiAgICAgICAgICAgIGhjPWN4KmN4K2N5KmN5LFxyXG4gICAgICAgICAgICB2ZXJ0ZXggPSB0aGlzLmNyZWF0ZVZlcnRleCgoY3kqaGItYnkqaGMpL2QrYXgsIChieCpoYy1jeCpoYikvZCtheSk7XHJcblxyXG4gICAgICAgIC8vIG9uZSB0cmFuc2l0aW9uIGRpc2FwcGVhclxyXG4gICAgICAgIHRoaXMuc2V0RWRnZVN0YXJ0cG9pbnQockFyYy5lZGdlLCBsU2l0ZSwgclNpdGUsIHZlcnRleCk7XHJcblxyXG4gICAgICAgIC8vIHR3byBuZXcgdHJhbnNpdGlvbnMgYXBwZWFyIGF0IHRoZSBuZXcgdmVydGV4IGxvY2F0aW9uXHJcbiAgICAgICAgbmV3QXJjLmVkZ2UgPSB0aGlzLmNyZWF0ZUVkZ2UobFNpdGUsIHNpdGUsIHVuZGVmaW5lZCwgdmVydGV4KTtcclxuICAgICAgICByQXJjLmVkZ2UgPSB0aGlzLmNyZWF0ZUVkZ2Uoc2l0ZSwgclNpdGUsIHVuZGVmaW5lZCwgdmVydGV4KTtcclxuXHJcbiAgICAgICAgLy8gY2hlY2sgd2hldGhlciB0aGUgbGVmdCBhbmQgcmlnaHQgYmVhY2ggc2VjdGlvbnMgYXJlIGNvbGxhcHNpbmdcclxuICAgICAgICAvLyBhbmQgaWYgc28gY3JlYXRlIGNpcmNsZSBldmVudHMsIHRvIGhhbmRsZSB0aGUgcG9pbnQgb2YgY29sbGFwc2UuXHJcbiAgICAgICAgdGhpcy5hdHRhY2hDaXJjbGVFdmVudChsQXJjKTtcclxuICAgICAgICB0aGlzLmF0dGFjaENpcmNsZUV2ZW50KHJBcmMpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIENpcmNsZSBldmVudCBtZXRob2RzXHJcblxyXG4vLyByaGlsbCAyMDExLTA2LTA3OiBGb3Igc29tZSByZWFzb25zLCBwZXJmb3JtYW5jZSBzdWZmZXJzIHNpZ25pZmljYW50bHlcclxuLy8gd2hlbiBpbnN0YW5jaWF0aW5nIGEgbGl0ZXJhbCBvYmplY3QgaW5zdGVhZCBvZiBhbiBlbXB0eSBjdG9yXHJcblZvcm9ub2kucHJvdG90eXBlLkNpcmNsZUV2ZW50ID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyByaGlsbCAyMDEzLTEwLTEyOiBpdCBoZWxwcyB0byBzdGF0ZSBleGFjdGx5IHdoYXQgd2UgYXJlIGF0IGN0b3IgdGltZS5cclxuICAgIHRoaXMuYXJjID0gbnVsbDtcclxuICAgIHRoaXMucmJMZWZ0ID0gbnVsbDtcclxuICAgIHRoaXMucmJOZXh0ID0gbnVsbDtcclxuICAgIHRoaXMucmJQYXJlbnQgPSBudWxsO1xyXG4gICAgdGhpcy5yYlByZXZpb3VzID0gbnVsbDtcclxuICAgIHRoaXMucmJSZWQgPSBmYWxzZTtcclxuICAgIHRoaXMucmJSaWdodCA9IG51bGw7XHJcbiAgICB0aGlzLnNpdGUgPSBudWxsO1xyXG4gICAgdGhpcy54ID0gdGhpcy55ID0gdGhpcy55Y2VudGVyID0gMDtcclxuICAgIH07XHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5hdHRhY2hDaXJjbGVFdmVudCA9IGZ1bmN0aW9uKGFyYykge1xyXG4gICAgdmFyIGxBcmMgPSBhcmMucmJQcmV2aW91cyxcclxuICAgICAgICByQXJjID0gYXJjLnJiTmV4dDtcclxuICAgIGlmICghbEFyYyB8fCAhckFyYykge3JldHVybjt9IC8vIGRvZXMgdGhhdCBldmVyIGhhcHBlbj9cclxuICAgIHZhciBsU2l0ZSA9IGxBcmMuc2l0ZSxcclxuICAgICAgICBjU2l0ZSA9IGFyYy5zaXRlLFxyXG4gICAgICAgIHJTaXRlID0gckFyYy5zaXRlO1xyXG5cclxuICAgIC8vIElmIHNpdGUgb2YgbGVmdCBiZWFjaHNlY3Rpb24gaXMgc2FtZSBhcyBzaXRlIG9mXHJcbiAgICAvLyByaWdodCBiZWFjaHNlY3Rpb24sIHRoZXJlIGNhbid0IGJlIGNvbnZlcmdlbmNlXHJcbiAgICBpZiAobFNpdGU9PT1yU2l0ZSkge3JldHVybjt9XHJcblxyXG4gICAgLy8gRmluZCB0aGUgY2lyY3Vtc2NyaWJlZCBjaXJjbGUgZm9yIHRoZSB0aHJlZSBzaXRlcyBhc3NvY2lhdGVkXHJcbiAgICAvLyB3aXRoIHRoZSBiZWFjaHNlY3Rpb24gdHJpcGxldC5cclxuICAgIC8vIHJoaWxsIDIwMTEtMDUtMjY6IEl0IGlzIG1vcmUgZWZmaWNpZW50IHRvIGNhbGN1bGF0ZSBpbi1wbGFjZVxyXG4gICAgLy8gcmF0aGVyIHRoYW4gZ2V0dGluZyB0aGUgcmVzdWx0aW5nIGNpcmN1bXNjcmliZWQgY2lyY2xlIGZyb20gYW5cclxuICAgIC8vIG9iamVjdCByZXR1cm5lZCBieSBjYWxsaW5nIFZvcm9ub2kuY2lyY3VtY2lyY2xlKClcclxuICAgIC8vIGh0dHA6Ly9tYXRoZm9ydW0ub3JnL2xpYnJhcnkvZHJtYXRoL3ZpZXcvNTUwMDIuaHRtbFxyXG4gICAgLy8gRXhjZXB0IHRoYXQgSSBicmluZyB0aGUgb3JpZ2luIGF0IGNTaXRlIHRvIHNpbXBsaWZ5IGNhbGN1bGF0aW9ucy5cclxuICAgIC8vIFRoZSBib3R0b20tbW9zdCBwYXJ0IG9mIHRoZSBjaXJjdW1jaXJjbGUgaXMgb3VyIEZvcnR1bmUgJ2NpcmNsZVxyXG4gICAgLy8gZXZlbnQnLCBhbmQgaXRzIGNlbnRlciBpcyBhIHZlcnRleCBwb3RlbnRpYWxseSBwYXJ0IG9mIHRoZSBmaW5hbFxyXG4gICAgLy8gVm9yb25vaSBkaWFncmFtLlxyXG4gICAgdmFyIGJ4ID0gY1NpdGUueCxcclxuICAgICAgICBieSA9IGNTaXRlLnksXHJcbiAgICAgICAgYXggPSBsU2l0ZS54LWJ4LFxyXG4gICAgICAgIGF5ID0gbFNpdGUueS1ieSxcclxuICAgICAgICBjeCA9IHJTaXRlLngtYngsXHJcbiAgICAgICAgY3kgPSByU2l0ZS55LWJ5O1xyXG5cclxuICAgIC8vIElmIHBvaW50cyBsLT5jLT5yIGFyZSBjbG9ja3dpc2UsIHRoZW4gY2VudGVyIGJlYWNoIHNlY3Rpb24gZG9lcyBub3RcclxuICAgIC8vIGNvbGxhcHNlLCBoZW5jZSBpdCBjYW4ndCBlbmQgdXAgYXMgYSB2ZXJ0ZXggKHdlIHJldXNlICdkJyBoZXJlLCB3aGljaFxyXG4gICAgLy8gc2lnbiBpcyByZXZlcnNlIG9mIHRoZSBvcmllbnRhdGlvbiwgaGVuY2Ugd2UgcmV2ZXJzZSB0aGUgdGVzdC5cclxuICAgIC8vIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvQ3VydmVfb3JpZW50YXRpb24jT3JpZW50YXRpb25fb2ZfYV9zaW1wbGVfcG9seWdvblxyXG4gICAgLy8gcmhpbGwgMjAxMS0wNS0yMTogTmFzdHkgZmluaXRlIHByZWNpc2lvbiBlcnJvciB3aGljaCBjYXVzZWQgY2lyY3VtY2lyY2xlKCkgdG9cclxuICAgIC8vIHJldHVybiBpbmZpbml0ZXM6IDFlLTEyIHNlZW1zIHRvIGZpeCB0aGUgcHJvYmxlbS5cclxuICAgIHZhciBkID0gMiooYXgqY3ktYXkqY3gpO1xyXG4gICAgaWYgKGQgPj0gLTJlLTEyKXtyZXR1cm47fVxyXG5cclxuICAgIHZhciBoYSA9IGF4KmF4K2F5KmF5LFxyXG4gICAgICAgIGhjID0gY3gqY3grY3kqY3ksXHJcbiAgICAgICAgeCA9IChjeSpoYS1heSpoYykvZCxcclxuICAgICAgICB5ID0gKGF4KmhjLWN4KmhhKS9kLFxyXG4gICAgICAgIHljZW50ZXIgPSB5K2J5O1xyXG5cclxuICAgIC8vIEltcG9ydGFudDogeWJvdHRvbSBzaG91bGQgYWx3YXlzIGJlIHVuZGVyIG9yIGF0IHN3ZWVwLCBzbyBubyBuZWVkXHJcbiAgICAvLyB0byB3YXN0ZSBDUFUgY3ljbGVzIGJ5IGNoZWNraW5nXHJcblxyXG4gICAgLy8gcmVjeWNsZSBjaXJjbGUgZXZlbnQgb2JqZWN0IGlmIHBvc3NpYmxlXHJcbiAgICB2YXIgY2lyY2xlRXZlbnQgPSB0aGlzLmNpcmNsZUV2ZW50SnVua3lhcmQucG9wKCk7XHJcbiAgICBpZiAoIWNpcmNsZUV2ZW50KSB7XHJcbiAgICAgICAgY2lyY2xlRXZlbnQgPSBuZXcgdGhpcy5DaXJjbGVFdmVudCgpO1xyXG4gICAgICAgIH1cclxuICAgIGNpcmNsZUV2ZW50LmFyYyA9IGFyYztcclxuICAgIGNpcmNsZUV2ZW50LnNpdGUgPSBjU2l0ZTtcclxuICAgIGNpcmNsZUV2ZW50LnggPSB4K2J4O1xyXG4gICAgY2lyY2xlRXZlbnQueSA9IHljZW50ZXIrdGhpcy5zcXJ0KHgqeCt5KnkpOyAvLyB5IGJvdHRvbVxyXG4gICAgY2lyY2xlRXZlbnQueWNlbnRlciA9IHljZW50ZXI7XHJcbiAgICBhcmMuY2lyY2xlRXZlbnQgPSBjaXJjbGVFdmVudDtcclxuXHJcbiAgICAvLyBmaW5kIGluc2VydGlvbiBwb2ludCBpbiBSQi10cmVlOiBjaXJjbGUgZXZlbnRzIGFyZSBvcmRlcmVkIGZyb21cclxuICAgIC8vIHNtYWxsZXN0IHRvIGxhcmdlc3RcclxuICAgIHZhciBwcmVkZWNlc3NvciA9IG51bGwsXHJcbiAgICAgICAgbm9kZSA9IHRoaXMuY2lyY2xlRXZlbnRzLnJvb3Q7XHJcbiAgICB3aGlsZSAobm9kZSkge1xyXG4gICAgICAgIGlmIChjaXJjbGVFdmVudC55IDwgbm9kZS55IHx8IChjaXJjbGVFdmVudC55ID09PSBub2RlLnkgJiYgY2lyY2xlRXZlbnQueCA8PSBub2RlLngpKSB7XHJcbiAgICAgICAgICAgIGlmIChub2RlLnJiTGVmdCkge1xyXG4gICAgICAgICAgICAgICAgbm9kZSA9IG5vZGUucmJMZWZ0O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHByZWRlY2Vzc29yID0gbm9kZS5yYlByZXZpb3VzO1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgaWYgKG5vZGUucmJSaWdodCkge1xyXG4gICAgICAgICAgICAgICAgbm9kZSA9IG5vZGUucmJSaWdodDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBwcmVkZWNlc3NvciA9IG5vZGU7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIHRoaXMuY2lyY2xlRXZlbnRzLnJiSW5zZXJ0U3VjY2Vzc29yKHByZWRlY2Vzc29yLCBjaXJjbGVFdmVudCk7XHJcbiAgICBpZiAoIXByZWRlY2Vzc29yKSB7XHJcbiAgICAgICAgdGhpcy5maXJzdENpcmNsZUV2ZW50ID0gY2lyY2xlRXZlbnQ7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcblZvcm9ub2kucHJvdG90eXBlLmRldGFjaENpcmNsZUV2ZW50ID0gZnVuY3Rpb24oYXJjKSB7XHJcbiAgICB2YXIgY2lyY2xlRXZlbnQgPSBhcmMuY2lyY2xlRXZlbnQ7XHJcbiAgICBpZiAoY2lyY2xlRXZlbnQpIHtcclxuICAgICAgICBpZiAoIWNpcmNsZUV2ZW50LnJiUHJldmlvdXMpIHtcclxuICAgICAgICAgICAgdGhpcy5maXJzdENpcmNsZUV2ZW50ID0gY2lyY2xlRXZlbnQucmJOZXh0O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5jaXJjbGVFdmVudHMucmJSZW1vdmVOb2RlKGNpcmNsZUV2ZW50KTsgLy8gcmVtb3ZlIGZyb20gUkItdHJlZVxyXG4gICAgICAgIHRoaXMuY2lyY2xlRXZlbnRKdW5reWFyZC5wdXNoKGNpcmNsZUV2ZW50KTtcclxuICAgICAgICBhcmMuY2lyY2xlRXZlbnQgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcblxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRGlhZ3JhbSBjb21wbGV0aW9uIG1ldGhvZHNcclxuXHJcbi8vIGNvbm5lY3QgZGFuZ2xpbmcgZWRnZXMgKG5vdCBpZiBhIGN1cnNvcnkgdGVzdCB0ZWxscyB1c1xyXG4vLyBpdCBpcyBub3QgZ29pbmcgdG8gYmUgdmlzaWJsZS5cclxuLy8gcmV0dXJuIHZhbHVlOlxyXG4vLyAgIGZhbHNlOiB0aGUgZGFuZ2xpbmcgZW5kcG9pbnQgY291bGRuJ3QgYmUgY29ubmVjdGVkXHJcbi8vICAgdHJ1ZTogdGhlIGRhbmdsaW5nIGVuZHBvaW50IGNvdWxkIGJlIGNvbm5lY3RlZFxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5jb25uZWN0RWRnZSA9IGZ1bmN0aW9uKGVkZ2UsIGJib3gpIHtcclxuICAgIC8vIHNraXAgaWYgZW5kIHBvaW50IGFscmVhZHkgY29ubmVjdGVkXHJcbiAgICB2YXIgdmIgPSBlZGdlLnZiO1xyXG4gICAgaWYgKCEhdmIpIHtyZXR1cm4gdHJ1ZTt9XHJcblxyXG4gICAgLy8gbWFrZSBsb2NhbCBjb3B5IGZvciBwZXJmb3JtYW5jZSBwdXJwb3NlXHJcbiAgICB2YXIgdmEgPSBlZGdlLnZhLFxyXG4gICAgICAgIHhsID0gYmJveC54bCxcclxuICAgICAgICB4ciA9IGJib3gueHIsXHJcbiAgICAgICAgeXQgPSBiYm94Lnl0LFxyXG4gICAgICAgIHliID0gYmJveC55YixcclxuICAgICAgICBsU2l0ZSA9IGVkZ2UubFNpdGUsXHJcbiAgICAgICAgclNpdGUgPSBlZGdlLnJTaXRlLFxyXG4gICAgICAgIGx4ID0gbFNpdGUueCxcclxuICAgICAgICBseSA9IGxTaXRlLnksXHJcbiAgICAgICAgcnggPSByU2l0ZS54LFxyXG4gICAgICAgIHJ5ID0gclNpdGUueSxcclxuICAgICAgICBmeCA9IChseCtyeCkvMixcclxuICAgICAgICBmeSA9IChseStyeSkvMixcclxuICAgICAgICBmbSwgZmI7XHJcblxyXG4gICAgLy8gaWYgd2UgcmVhY2ggaGVyZSwgdGhpcyBtZWFucyBjZWxscyB3aGljaCB1c2UgdGhpcyBlZGdlIHdpbGwgbmVlZFxyXG4gICAgLy8gdG8gYmUgY2xvc2VkLCB3aGV0aGVyIGJlY2F1c2UgdGhlIGVkZ2Ugd2FzIHJlbW92ZWQsIG9yIGJlY2F1c2UgaXRcclxuICAgIC8vIHdhcyBjb25uZWN0ZWQgdG8gdGhlIGJvdW5kaW5nIGJveC5cclxuICAgIHRoaXMuY2VsbHNbbFNpdGUudm9yb25vaUlkXS5jbG9zZU1lID0gdHJ1ZTtcclxuICAgIHRoaXMuY2VsbHNbclNpdGUudm9yb25vaUlkXS5jbG9zZU1lID0gdHJ1ZTtcclxuXHJcbiAgICAvLyBnZXQgdGhlIGxpbmUgZXF1YXRpb24gb2YgdGhlIGJpc2VjdG9yIGlmIGxpbmUgaXMgbm90IHZlcnRpY2FsXHJcbiAgICBpZiAocnkgIT09IGx5KSB7XHJcbiAgICAgICAgZm0gPSAobHgtcngpLyhyeS1seSk7XHJcbiAgICAgICAgZmIgPSBmeS1mbSpmeDtcclxuICAgICAgICB9XHJcblxyXG4gICAgLy8gcmVtZW1iZXIsIGRpcmVjdGlvbiBvZiBsaW5lIChyZWxhdGl2ZSB0byBsZWZ0IHNpdGUpOlxyXG4gICAgLy8gdXB3YXJkOiBsZWZ0LnggPCByaWdodC54XHJcbiAgICAvLyBkb3dud2FyZDogbGVmdC54ID4gcmlnaHQueFxyXG4gICAgLy8gaG9yaXpvbnRhbDogbGVmdC54ID09IHJpZ2h0LnhcclxuICAgIC8vIHVwd2FyZDogbGVmdC54IDwgcmlnaHQueFxyXG4gICAgLy8gcmlnaHR3YXJkOiBsZWZ0LnkgPCByaWdodC55XHJcbiAgICAvLyBsZWZ0d2FyZDogbGVmdC55ID4gcmlnaHQueVxyXG4gICAgLy8gdmVydGljYWw6IGxlZnQueSA9PSByaWdodC55XHJcblxyXG4gICAgLy8gZGVwZW5kaW5nIG9uIHRoZSBkaXJlY3Rpb24sIGZpbmQgdGhlIGJlc3Qgc2lkZSBvZiB0aGVcclxuICAgIC8vIGJvdW5kaW5nIGJveCB0byB1c2UgdG8gZGV0ZXJtaW5lIGEgcmVhc29uYWJsZSBzdGFydCBwb2ludFxyXG5cclxuICAgIC8vIHJoaWxsIDIwMTMtMTItMDI6XHJcbiAgICAvLyBXaGlsZSBhdCBpdCwgc2luY2Ugd2UgaGF2ZSB0aGUgdmFsdWVzIHdoaWNoIGRlZmluZSB0aGUgbGluZSxcclxuICAgIC8vIGNsaXAgdGhlIGVuZCBvZiB2YSBpZiBpdCBpcyBvdXRzaWRlIHRoZSBiYm94LlxyXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL2lzc3Vlcy8xNVxyXG4gICAgLy8gVE9ETzogRG8gYWxsIHRoZSBjbGlwcGluZyBoZXJlIHJhdGhlciB0aGFuIHJlbHkgb24gTGlhbmctQmFyc2t5XHJcbiAgICAvLyB3aGljaCBkb2VzIG5vdCBkbyB3ZWxsIHNvbWV0aW1lcyBkdWUgdG8gbG9zcyBvZiBhcml0aG1ldGljXHJcbiAgICAvLyBwcmVjaXNpb24uIFRoZSBjb2RlIGhlcmUgZG9lc24ndCBkZWdyYWRlIGlmIG9uZSBvZiB0aGUgdmVydGV4IGlzXHJcbiAgICAvLyBhdCBhIGh1Z2UgZGlzdGFuY2UuXHJcblxyXG4gICAgLy8gc3BlY2lhbCBjYXNlOiB2ZXJ0aWNhbCBsaW5lXHJcbiAgICBpZiAoZm0gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIC8vIGRvZXNuJ3QgaW50ZXJzZWN0IHdpdGggdmlld3BvcnRcclxuICAgICAgICBpZiAoZnggPCB4bCB8fCBmeCA+PSB4cikge3JldHVybiBmYWxzZTt9XHJcbiAgICAgICAgLy8gZG93bndhcmRcclxuICAgICAgICBpZiAobHggPiByeCkge1xyXG4gICAgICAgICAgICBpZiAoIXZhIHx8IHZhLnkgPCB5dCkge1xyXG4gICAgICAgICAgICAgICAgdmEgPSB0aGlzLmNyZWF0ZVZlcnRleChmeCwgeXQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIGlmICh2YS55ID49IHliKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoZngsIHliKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIC8vIHVwd2FyZFxyXG4gICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICBpZiAoIXZhIHx8IHZhLnkgPiB5Yikge1xyXG4gICAgICAgICAgICAgICAgdmEgPSB0aGlzLmNyZWF0ZVZlcnRleChmeCwgeWIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIGlmICh2YS55IDwgeXQpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleChmeCwgeXQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgLy8gY2xvc2VyIHRvIHZlcnRpY2FsIHRoYW4gaG9yaXpvbnRhbCwgY29ubmVjdCBzdGFydCBwb2ludCB0byB0aGVcclxuICAgIC8vIHRvcCBvciBib3R0b20gc2lkZSBvZiB0aGUgYm91bmRpbmcgYm94XHJcbiAgICBlbHNlIGlmIChmbSA8IC0xIHx8IGZtID4gMSkge1xyXG4gICAgICAgIC8vIGRvd253YXJkXHJcbiAgICAgICAgaWYgKGx4ID4gcngpIHtcclxuICAgICAgICAgICAgaWYgKCF2YSB8fCB2YS55IDwgeXQpIHtcclxuICAgICAgICAgICAgICAgIHZhID0gdGhpcy5jcmVhdGVWZXJ0ZXgoKHl0LWZiKS9mbSwgeXQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIGlmICh2YS55ID49IHliKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoKHliLWZiKS9mbSwgeWIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgLy8gdXB3YXJkXHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIGlmICghdmEgfHwgdmEueSA+IHliKSB7XHJcbiAgICAgICAgICAgICAgICB2YSA9IHRoaXMuY3JlYXRlVmVydGV4KCh5Yi1mYikvZm0sIHliKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZSBpZiAodmEueSA8IHl0KSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoKHl0LWZiKS9mbSwgeXQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgLy8gY2xvc2VyIHRvIGhvcml6b250YWwgdGhhbiB2ZXJ0aWNhbCwgY29ubmVjdCBzdGFydCBwb2ludCB0byB0aGVcclxuICAgIC8vIGxlZnQgb3IgcmlnaHQgc2lkZSBvZiB0aGUgYm91bmRpbmcgYm94XHJcbiAgICBlbHNlIHtcclxuICAgICAgICAvLyByaWdodHdhcmRcclxuICAgICAgICBpZiAobHkgPCByeSkge1xyXG4gICAgICAgICAgICBpZiAoIXZhIHx8IHZhLnggPCB4bCkge1xyXG4gICAgICAgICAgICAgICAgdmEgPSB0aGlzLmNyZWF0ZVZlcnRleCh4bCwgZm0qeGwrZmIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIGlmICh2YS54ID49IHhyKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgoeHIsIGZtKnhyK2ZiKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIC8vIGxlZnR3YXJkXHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIGlmICghdmEgfHwgdmEueCA+IHhyKSB7XHJcbiAgICAgICAgICAgICAgICB2YSA9IHRoaXMuY3JlYXRlVmVydGV4KHhyLCBmbSp4citmYik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGVsc2UgaWYgKHZhLnggPCB4bCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KHhsLCBmbSp4bCtmYik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICBlZGdlLnZhID0gdmE7XHJcbiAgICBlZGdlLnZiID0gdmI7XHJcblxyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgICB9O1xyXG5cclxuLy8gbGluZS1jbGlwcGluZyBjb2RlIHRha2VuIGZyb206XHJcbi8vICAgTGlhbmctQmFyc2t5IGZ1bmN0aW9uIGJ5IERhbmllbCBXaGl0ZVxyXG4vLyAgIGh0dHA6Ly93d3cuc2t5dG9waWEuY29tL3Byb2plY3QvYXJ0aWNsZXMvY29tcHNjaS9jbGlwcGluZy5odG1sXHJcbi8vIFRoYW5rcyFcclxuLy8gQSBiaXQgbW9kaWZpZWQgdG8gbWluaW1pemUgY29kZSBwYXRoc1xyXG5Wb3Jvbm9pLnByb3RvdHlwZS5jbGlwRWRnZSA9IGZ1bmN0aW9uKGVkZ2UsIGJib3gpIHtcclxuICAgIHZhciBheCA9IGVkZ2UudmEueCxcclxuICAgICAgICBheSA9IGVkZ2UudmEueSxcclxuICAgICAgICBieCA9IGVkZ2UudmIueCxcclxuICAgICAgICBieSA9IGVkZ2UudmIueSxcclxuICAgICAgICB0MCA9IDAsXHJcbiAgICAgICAgdDEgPSAxLFxyXG4gICAgICAgIGR4ID0gYngtYXgsXHJcbiAgICAgICAgZHkgPSBieS1heTtcclxuICAgIC8vIGxlZnRcclxuICAgIHZhciBxID0gYXgtYmJveC54bDtcclxuICAgIGlmIChkeD09PTAgJiYgcTwwKSB7cmV0dXJuIGZhbHNlO31cclxuICAgIHZhciByID0gLXEvZHg7XHJcbiAgICBpZiAoZHg8MCkge1xyXG4gICAgICAgIGlmIChyPHQwKSB7cmV0dXJuIGZhbHNlO31cclxuICAgICAgICBpZiAocjx0MSkge3QxPXI7fVxyXG4gICAgICAgIH1cclxuICAgIGVsc2UgaWYgKGR4PjApIHtcclxuICAgICAgICBpZiAocj50MSkge3JldHVybiBmYWxzZTt9XHJcbiAgICAgICAgaWYgKHI+dDApIHt0MD1yO31cclxuICAgICAgICB9XHJcbiAgICAvLyByaWdodFxyXG4gICAgcSA9IGJib3gueHItYXg7XHJcbiAgICBpZiAoZHg9PT0wICYmIHE8MCkge3JldHVybiBmYWxzZTt9XHJcbiAgICByID0gcS9keDtcclxuICAgIGlmIChkeDwwKSB7XHJcbiAgICAgICAgaWYgKHI+dDEpIHtyZXR1cm4gZmFsc2U7fVxyXG4gICAgICAgIGlmIChyPnQwKSB7dDA9cjt9XHJcbiAgICAgICAgfVxyXG4gICAgZWxzZSBpZiAoZHg+MCkge1xyXG4gICAgICAgIGlmIChyPHQwKSB7cmV0dXJuIGZhbHNlO31cclxuICAgICAgICBpZiAocjx0MSkge3QxPXI7fVxyXG4gICAgICAgIH1cclxuICAgIC8vIHRvcFxyXG4gICAgcSA9IGF5LWJib3gueXQ7XHJcbiAgICBpZiAoZHk9PT0wICYmIHE8MCkge3JldHVybiBmYWxzZTt9XHJcbiAgICByID0gLXEvZHk7XHJcbiAgICBpZiAoZHk8MCkge1xyXG4gICAgICAgIGlmIChyPHQwKSB7cmV0dXJuIGZhbHNlO31cclxuICAgICAgICBpZiAocjx0MSkge3QxPXI7fVxyXG4gICAgICAgIH1cclxuICAgIGVsc2UgaWYgKGR5PjApIHtcclxuICAgICAgICBpZiAocj50MSkge3JldHVybiBmYWxzZTt9XHJcbiAgICAgICAgaWYgKHI+dDApIHt0MD1yO31cclxuICAgICAgICB9XHJcbiAgICAvLyBib3R0b20gICAgICAgIFxyXG4gICAgcSA9IGJib3gueWItYXk7XHJcbiAgICBpZiAoZHk9PT0wICYmIHE8MCkge3JldHVybiBmYWxzZTt9XHJcbiAgICByID0gcS9keTtcclxuICAgIGlmIChkeTwwKSB7XHJcbiAgICAgICAgaWYgKHI+dDEpIHtyZXR1cm4gZmFsc2U7fVxyXG4gICAgICAgIGlmIChyPnQwKSB7dDA9cjt9XHJcbiAgICAgICAgfVxyXG4gICAgZWxzZSBpZiAoZHk+MCkge1xyXG4gICAgICAgIGlmIChyPHQwKSB7cmV0dXJuIGZhbHNlO31cclxuICAgICAgICBpZiAocjx0MSkge3QxPXI7fVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAvLyBpZiB3ZSByZWFjaCB0aGlzIHBvaW50LCBWb3Jvbm9pIGVkZ2UgaXMgd2l0aGluIGJib3hcclxuXHJcbiAgICAvLyBpZiB0MCA+IDAsIHZhIG5lZWRzIHRvIGNoYW5nZVxyXG4gICAgLy8gcmhpbGwgMjAxMS0wNi0wMzogd2UgbmVlZCB0byBjcmVhdGUgYSBuZXcgdmVydGV4IHJhdGhlclxyXG4gICAgLy8gdGhhbiBtb2RpZnlpbmcgdGhlIGV4aXN0aW5nIG9uZSwgc2luY2UgdGhlIGV4aXN0aW5nXHJcbiAgICAvLyBvbmUgaXMgbGlrZWx5IHNoYXJlZCB3aXRoIGF0IGxlYXN0IGFub3RoZXIgZWRnZVxyXG4gICAgaWYgKHQwID4gMCkge1xyXG4gICAgICAgIGVkZ2UudmEgPSB0aGlzLmNyZWF0ZVZlcnRleChheCt0MCpkeCwgYXkrdDAqZHkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAvLyBpZiB0MSA8IDEsIHZiIG5lZWRzIHRvIGNoYW5nZVxyXG4gICAgLy8gcmhpbGwgMjAxMS0wNi0wMzogd2UgbmVlZCB0byBjcmVhdGUgYSBuZXcgdmVydGV4IHJhdGhlclxyXG4gICAgLy8gdGhhbiBtb2RpZnlpbmcgdGhlIGV4aXN0aW5nIG9uZSwgc2luY2UgdGhlIGV4aXN0aW5nXHJcbiAgICAvLyBvbmUgaXMgbGlrZWx5IHNoYXJlZCB3aXRoIGF0IGxlYXN0IGFub3RoZXIgZWRnZVxyXG4gICAgaWYgKHQxIDwgMSkge1xyXG4gICAgICAgIGVkZ2UudmIgPSB0aGlzLmNyZWF0ZVZlcnRleChheCt0MSpkeCwgYXkrdDEqZHkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAvLyB2YSBhbmQvb3IgdmIgd2VyZSBjbGlwcGVkLCB0aHVzIHdlIHdpbGwgbmVlZCB0byBjbG9zZVxyXG4gICAgLy8gY2VsbHMgd2hpY2ggdXNlIHRoaXMgZWRnZS5cclxuICAgIGlmICggdDAgPiAwIHx8IHQxIDwgMSApIHtcclxuICAgICAgICB0aGlzLmNlbGxzW2VkZ2UubFNpdGUudm9yb25vaUlkXS5jbG9zZU1lID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLmNlbGxzW2VkZ2UuclNpdGUudm9yb25vaUlkXS5jbG9zZU1lID0gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH07XHJcblxyXG4vLyBDb25uZWN0L2N1dCBlZGdlcyBhdCBib3VuZGluZyBib3hcclxuVm9yb25vaS5wcm90b3R5cGUuY2xpcEVkZ2VzID0gZnVuY3Rpb24oYmJveCkge1xyXG4gICAgLy8gY29ubmVjdCBhbGwgZGFuZ2xpbmcgZWRnZXMgdG8gYm91bmRpbmcgYm94XHJcbiAgICAvLyBvciBnZXQgcmlkIG9mIHRoZW0gaWYgaXQgY2FuJ3QgYmUgZG9uZVxyXG4gICAgdmFyIGVkZ2VzID0gdGhpcy5lZGdlcyxcclxuICAgICAgICBpRWRnZSA9IGVkZ2VzLmxlbmd0aCxcclxuICAgICAgICBlZGdlLFxyXG4gICAgICAgIGFic19mbiA9IE1hdGguYWJzO1xyXG5cclxuICAgIC8vIGl0ZXJhdGUgYmFja3dhcmQgc28gd2UgY2FuIHNwbGljZSBzYWZlbHlcclxuICAgIHdoaWxlIChpRWRnZS0tKSB7XHJcbiAgICAgICAgZWRnZSA9IGVkZ2VzW2lFZGdlXTtcclxuICAgICAgICAvLyBlZGdlIGlzIHJlbW92ZWQgaWY6XHJcbiAgICAgICAgLy8gICBpdCBpcyB3aG9sbHkgb3V0c2lkZSB0aGUgYm91bmRpbmcgYm94XHJcbiAgICAgICAgLy8gICBpdCBpcyBsb29raW5nIG1vcmUgbGlrZSBhIHBvaW50IHRoYW4gYSBsaW5lXHJcbiAgICAgICAgaWYgKCF0aGlzLmNvbm5lY3RFZGdlKGVkZ2UsIGJib3gpIHx8XHJcbiAgICAgICAgICAgICF0aGlzLmNsaXBFZGdlKGVkZ2UsIGJib3gpIHx8XHJcbiAgICAgICAgICAgIChhYnNfZm4oZWRnZS52YS54LWVkZ2UudmIueCk8MWUtOSAmJiBhYnNfZm4oZWRnZS52YS55LWVkZ2UudmIueSk8MWUtOSkpIHtcclxuICAgICAgICAgICAgZWRnZS52YSA9IGVkZ2UudmIgPSBudWxsO1xyXG4gICAgICAgICAgICBlZGdlcy5zcGxpY2UoaUVkZ2UsMSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuLy8gQ2xvc2UgdGhlIGNlbGxzLlxyXG4vLyBUaGUgY2VsbHMgYXJlIGJvdW5kIGJ5IHRoZSBzdXBwbGllZCBib3VuZGluZyBib3guXHJcbi8vIEVhY2ggY2VsbCByZWZlcnMgdG8gaXRzIGFzc29jaWF0ZWQgc2l0ZSwgYW5kIGEgbGlzdFxyXG4vLyBvZiBoYWxmZWRnZXMgb3JkZXJlZCBjb3VudGVyY2xvY2t3aXNlLlxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5jbG9zZUNlbGxzID0gZnVuY3Rpb24oYmJveCkge1xyXG4gICAgdmFyIHhsID0gYmJveC54bCxcclxuICAgICAgICB4ciA9IGJib3gueHIsXHJcbiAgICAgICAgeXQgPSBiYm94Lnl0LFxyXG4gICAgICAgIHliID0gYmJveC55YixcclxuICAgICAgICBjZWxscyA9IHRoaXMuY2VsbHMsXHJcbiAgICAgICAgaUNlbGwgPSBjZWxscy5sZW5ndGgsXHJcbiAgICAgICAgY2VsbCxcclxuICAgICAgICBpTGVmdCxcclxuICAgICAgICBoYWxmZWRnZXMsIG5IYWxmZWRnZXMsXHJcbiAgICAgICAgZWRnZSxcclxuICAgICAgICB2YSwgdmIsIHZ6LFxyXG4gICAgICAgIGxhc3RCb3JkZXJTZWdtZW50LFxyXG4gICAgICAgIGFic19mbiA9IE1hdGguYWJzO1xyXG5cclxuICAgIHdoaWxlIChpQ2VsbC0tKSB7XHJcbiAgICAgICAgY2VsbCA9IGNlbGxzW2lDZWxsXTtcclxuICAgICAgICAvLyBwcnVuZSwgb3JkZXIgaGFsZmVkZ2VzIGNvdW50ZXJjbG9ja3dpc2UsIHRoZW4gYWRkIG1pc3Npbmcgb25lc1xyXG4gICAgICAgIC8vIHJlcXVpcmVkIHRvIGNsb3NlIGNlbGxzXHJcbiAgICAgICAgaWYgKCFjZWxsLnByZXBhcmVIYWxmZWRnZXMoKSkge1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIGlmICghY2VsbC5jbG9zZU1lKSB7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgLy8gZmluZCBmaXJzdCAndW5jbG9zZWQnIHBvaW50LlxyXG4gICAgICAgIC8vIGFuICd1bmNsb3NlZCcgcG9pbnQgd2lsbCBiZSB0aGUgZW5kIHBvaW50IG9mIGEgaGFsZmVkZ2Ugd2hpY2hcclxuICAgICAgICAvLyBkb2VzIG5vdCBtYXRjaCB0aGUgc3RhcnQgcG9pbnQgb2YgdGhlIGZvbGxvd2luZyBoYWxmZWRnZVxyXG4gICAgICAgIGhhbGZlZGdlcyA9IGNlbGwuaGFsZmVkZ2VzO1xyXG4gICAgICAgIG5IYWxmZWRnZXMgPSBoYWxmZWRnZXMubGVuZ3RoO1xyXG4gICAgICAgIC8vIHNwZWNpYWwgY2FzZTogb25seSBvbmUgc2l0ZSwgaW4gd2hpY2ggY2FzZSwgdGhlIHZpZXdwb3J0IGlzIHRoZSBjZWxsXHJcbiAgICAgICAgLy8gLi4uXHJcblxyXG4gICAgICAgIC8vIGFsbCBvdGhlciBjYXNlc1xyXG4gICAgICAgIGlMZWZ0ID0gMDtcclxuICAgICAgICB3aGlsZSAoaUxlZnQgPCBuSGFsZmVkZ2VzKSB7XHJcbiAgICAgICAgICAgIHZhID0gaGFsZmVkZ2VzW2lMZWZ0XS5nZXRFbmRwb2ludCgpO1xyXG4gICAgICAgICAgICB2eiA9IGhhbGZlZGdlc1soaUxlZnQrMSkgJSBuSGFsZmVkZ2VzXS5nZXRTdGFydHBvaW50KCk7XHJcbiAgICAgICAgICAgIC8vIGlmIGVuZCBwb2ludCBpcyBub3QgZXF1YWwgdG8gc3RhcnQgcG9pbnQsIHdlIG5lZWQgdG8gYWRkIHRoZSBtaXNzaW5nXHJcbiAgICAgICAgICAgIC8vIGhhbGZlZGdlKHMpIHVwIHRvIHZ6XHJcbiAgICAgICAgICAgIGlmIChhYnNfZm4odmEueC12ei54KT49MWUtOSB8fCBhYnNfZm4odmEueS12ei55KT49MWUtOSkge1xyXG5cclxuICAgICAgICAgICAgICAgIC8vIHJoaWxsIDIwMTMtMTItMDI6XHJcbiAgICAgICAgICAgICAgICAvLyBcIkhvbGVzXCIgaW4gdGhlIGhhbGZlZGdlcyBhcmUgbm90IG5lY2Vzc2FyaWx5IGFsd2F5cyBhZGphY2VudC5cclxuICAgICAgICAgICAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9nb3JoaWxsL0phdmFzY3JpcHQtVm9yb25vaS9pc3N1ZXMvMTZcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBmaW5kIGVudHJ5IHBvaW50OlxyXG4gICAgICAgICAgICAgICAgc3dpdGNoICh0cnVlKSB7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIHdhbGsgZG93bndhcmQgYWxvbmcgbGVmdCBzaWRlXHJcbiAgICAgICAgICAgICAgICAgICAgY2FzZSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odmEueCx4bCkgJiYgdGhpcy5sZXNzVGhhbldpdGhFcHNpbG9uKHZhLnkseWIpOlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei54LHhsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCh4bCwgbGFzdEJvcmRlclNlZ21lbnQgPyB2ei55IDogeWIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YSA9IHZiO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gd2FsayByaWdodHdhcmQgYWxvbmcgYm90dG9tIHNpZGVcclxuICAgICAgICAgICAgICAgICAgICBjYXNlIHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2YS55LHliKSAmJiB0aGlzLmxlc3NUaGFuV2l0aEVwc2lsb24odmEueCx4cik6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RCb3JkZXJTZWdtZW50ID0gdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZ6LnkseWIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KGxhc3RCb3JkZXJTZWdtZW50ID8gdnoueCA6IHhyLCB5Yik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkZ2UgPSB0aGlzLmNyZWF0ZUJvcmRlckVkZ2UoY2VsbC5zaXRlLCB2YSwgdmIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpTGVmdCsrO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlMZWZ0LCAwLCB0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIGNlbGwuc2l0ZSwgbnVsbCkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBuSGFsZmVkZ2VzKys7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggbGFzdEJvcmRlclNlZ21lbnQgKSB7IGJyZWFrOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhID0gdmI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZhbGwgdGhyb3VnaFxyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyB3YWxrIHVwd2FyZCBhbG9uZyByaWdodCBzaWRlXHJcbiAgICAgICAgICAgICAgICAgICAgY2FzZSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odmEueCx4cikgJiYgdGhpcy5ncmVhdGVyVGhhbldpdGhFcHNpbG9uKHZhLnkseXQpOlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei54LHhyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCh4ciwgbGFzdEJvcmRlclNlZ21lbnQgPyB2ei55IDogeXQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YSA9IHZiO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gd2FsayBsZWZ0d2FyZCBhbG9uZyB0b3Agc2lkZVxyXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZhLnkseXQpICYmIHRoaXMuZ3JlYXRlclRoYW5XaXRoRXBzaWxvbih2YS54LHhsKTpcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGFzdEJvcmRlclNlZ21lbnQgPSB0aGlzLmVxdWFsV2l0aEVwc2lsb24odnoueSx5dCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZiID0gdGhpcy5jcmVhdGVWZXJ0ZXgobGFzdEJvcmRlclNlZ21lbnQgPyB2ei54IDogeGwsIHl0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZWRnZSA9IHRoaXMuY3JlYXRlQm9yZGVyRWRnZShjZWxsLnNpdGUsIHZhLCB2Yik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlMZWZ0Kys7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGZlZGdlcy5zcGxpY2UoaUxlZnQsIDAsIHRoaXMuY3JlYXRlSGFsZmVkZ2UoZWRnZSwgY2VsbC5zaXRlLCBudWxsKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5IYWxmZWRnZXMrKztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBsYXN0Qm9yZGVyU2VnbWVudCApIHsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgdmEgPSB2YjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZmFsbCB0aHJvdWdoXHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB3YWxrIGRvd253YXJkIGFsb25nIGxlZnQgc2lkZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei54LHhsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCh4bCwgbGFzdEJvcmRlclNlZ21lbnQgPyB2ei55IDogeWIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YSA9IHZiO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdhbGsgcmlnaHR3YXJkIGFsb25nIGJvdHRvbSBzaWRlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RCb3JkZXJTZWdtZW50ID0gdGhpcy5lcXVhbFdpdGhFcHNpbG9uKHZ6LnkseWIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YiA9IHRoaXMuY3JlYXRlVmVydGV4KGxhc3RCb3JkZXJTZWdtZW50ID8gdnoueCA6IHhyLCB5Yik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkZ2UgPSB0aGlzLmNyZWF0ZUJvcmRlckVkZ2UoY2VsbC5zaXRlLCB2YSwgdmIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpTGVmdCsrO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxmZWRnZXMuc3BsaWNlKGlMZWZ0LCAwLCB0aGlzLmNyZWF0ZUhhbGZlZGdlKGVkZ2UsIGNlbGwuc2l0ZSwgbnVsbCkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBuSGFsZmVkZ2VzKys7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggbGFzdEJvcmRlclNlZ21lbnQgKSB7IGJyZWFrOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhID0gdmI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZhbGwgdGhyb3VnaFxyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2FsayB1cHdhcmQgYWxvbmcgcmlnaHQgc2lkZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0Qm9yZGVyU2VnbWVudCA9IHRoaXMuZXF1YWxXaXRoRXBzaWxvbih2ei54LHhyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmIgPSB0aGlzLmNyZWF0ZVZlcnRleCh4ciwgbGFzdEJvcmRlclNlZ21lbnQgPyB2ei55IDogeXQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlZGdlID0gdGhpcy5jcmVhdGVCb3JkZXJFZGdlKGNlbGwuc2l0ZSwgdmEsIHZiKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaUxlZnQrKztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaGFsZmVkZ2VzLnNwbGljZShpTGVmdCwgMCwgdGhpcy5jcmVhdGVIYWxmZWRnZShlZGdlLCBjZWxsLnNpdGUsIG51bGwpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbkhhbGZlZGdlcysrO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIGxhc3RCb3JkZXJTZWdtZW50ICkgeyBicmVhazsgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBmYWxsIHRocm91Z2hcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgXCJWb3Jvbm9pLmNsb3NlQ2VsbHMoKSA+IHRoaXMgbWFrZXMgbm8gc2Vuc2UhXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpTGVmdCsrO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgY2VsbC5jbG9zZU1lID0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBEZWJ1Z2dpbmcgaGVscGVyXHJcbi8qXHJcblZvcm9ub2kucHJvdG90eXBlLmR1bXBCZWFjaGxpbmUgPSBmdW5jdGlvbih5KSB7XHJcbiAgICBjb25zb2xlLmxvZygnVm9yb25vaS5kdW1wQmVhY2hsaW5lKCVmKSA+IEJlYWNoc2VjdGlvbnMsIGZyb20gbGVmdCB0byByaWdodDonLCB5KTtcclxuICAgIGlmICggIXRoaXMuYmVhY2hsaW5lICkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCcgIE5vbmUnKTtcclxuICAgICAgICB9XHJcbiAgICBlbHNlIHtcclxuICAgICAgICB2YXIgYnMgPSB0aGlzLmJlYWNobGluZS5nZXRGaXJzdCh0aGlzLmJlYWNobGluZS5yb290KTtcclxuICAgICAgICB3aGlsZSAoIGJzICkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnICBzaXRlICVkOiB4bDogJWYsIHhyOiAlZicsIGJzLnNpdGUudm9yb25vaUlkLCB0aGlzLmxlZnRCcmVha1BvaW50KGJzLCB5KSwgdGhpcy5yaWdodEJyZWFrUG9pbnQoYnMsIHkpKTtcclxuICAgICAgICAgICAgYnMgPSBicy5yYk5leHQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4qL1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIEhlbHBlcjogUXVhbnRpemUgc2l0ZXNcclxuXHJcbi8vIHJoaWxsIDIwMTMtMTAtMTI6XHJcbi8vIFRoaXMgaXMgdG8gc29sdmUgaHR0cHM6Ly9naXRodWIuY29tL2dvcmhpbGwvSmF2YXNjcmlwdC1Wb3Jvbm9pL2lzc3Vlcy8xNVxyXG4vLyBTaW5jZSBub3QgYWxsIHVzZXJzIHdpbGwgZW5kIHVwIHVzaW5nIHRoZSBraW5kIG9mIGNvb3JkIHZhbHVlcyB3aGljaCB3b3VsZFxyXG4vLyBjYXVzZSB0aGUgaXNzdWUgdG8gYXJpc2UsIEkgY2hvc2UgdG8gbGV0IHRoZSB1c2VyIGRlY2lkZSB3aGV0aGVyIG9yIG5vdFxyXG4vLyBoZSBzaG91bGQgc2FuaXRpemUgaGlzIGNvb3JkIHZhbHVlcyB0aHJvdWdoIHRoaXMgaGVscGVyLiBUaGlzIHdheSwgZm9yXHJcbi8vIHRob3NlIHVzZXJzIHdobyB1c2VzIGNvb3JkIHZhbHVlcyB3aGljaCBhcmUga25vd24gdG8gYmUgZmluZSwgbm8gb3ZlcmhlYWQgaXNcclxuLy8gYWRkZWQuXHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5xdWFudGl6ZVNpdGVzID0gZnVuY3Rpb24oc2l0ZXMpIHtcclxuICAgIHZhciDOtSA9IHRoaXMuzrUsXHJcbiAgICAgICAgbiA9IHNpdGVzLmxlbmd0aCxcclxuICAgICAgICBzaXRlO1xyXG4gICAgd2hpbGUgKCBuLS0gKSB7XHJcbiAgICAgICAgc2l0ZSA9IHNpdGVzW25dO1xyXG4gICAgICAgIHNpdGUueCA9IE1hdGguZmxvb3Ioc2l0ZS54IC8gzrUpICogzrU7XHJcbiAgICAgICAgc2l0ZS55ID0gTWF0aC5mbG9vcihzaXRlLnkgLyDOtSkgKiDOtTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIEhlbHBlcjogUmVjeWNsZSBkaWFncmFtOiBhbGwgdmVydGV4LCBlZGdlIGFuZCBjZWxsIG9iamVjdHMgYXJlXHJcbi8vIFwic3VycmVuZGVyZWRcIiB0byB0aGUgVm9yb25vaSBvYmplY3QgZm9yIHJldXNlLlxyXG4vLyBUT0RPOiByaGlsbC12b3Jvbm9pLWNvcmUgdjI6IG1vcmUgcGVyZm9ybWFuY2UgdG8gYmUgZ2FpbmVkXHJcbi8vIHdoZW4gSSBjaGFuZ2UgdGhlIHNlbWFudGljIG9mIHdoYXQgaXMgcmV0dXJuZWQuXHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5yZWN5Y2xlID0gZnVuY3Rpb24oZGlhZ3JhbSkge1xyXG4gICAgaWYgKCBkaWFncmFtICkge1xyXG4gICAgICAgIGlmICggZGlhZ3JhbSBpbnN0YW5jZW9mIHRoaXMuRGlhZ3JhbSApIHtcclxuICAgICAgICAgICAgdGhpcy50b1JlY3ljbGUgPSBkaWFncmFtO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIHRocm93ICdWb3Jvbm9pLnJlY3ljbGVEaWFncmFtKCkgPiBOZWVkIGEgRGlhZ3JhbSBvYmplY3QuJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH07XHJcblxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gVG9wLWxldmVsIEZvcnR1bmUgbG9vcFxyXG5cclxuLy8gcmhpbGwgMjAxMS0wNS0xOTpcclxuLy8gICBWb3Jvbm9pIHNpdGVzIGFyZSBrZXB0IGNsaWVudC1zaWRlIG5vdywgdG8gYWxsb3dcclxuLy8gICB1c2VyIHRvIGZyZWVseSBtb2RpZnkgY29udGVudC4gQXQgY29tcHV0ZSB0aW1lLFxyXG4vLyAgICpyZWZlcmVuY2VzKiB0byBzaXRlcyBhcmUgY29waWVkIGxvY2FsbHkuXHJcblxyXG5Wb3Jvbm9pLnByb3RvdHlwZS5jb21wdXRlID0gZnVuY3Rpb24oc2l0ZXMsIGJib3gpIHtcclxuICAgIC8vIHRvIG1lYXN1cmUgZXhlY3V0aW9uIHRpbWVcclxuICAgIHZhciBzdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xyXG5cclxuICAgIC8vIGluaXQgaW50ZXJuYWwgc3RhdGVcclxuICAgIHRoaXMucmVzZXQoKTtcclxuXHJcbiAgICAvLyBhbnkgZGlhZ3JhbSBkYXRhIGF2YWlsYWJsZSBmb3IgcmVjeWNsaW5nP1xyXG4gICAgLy8gSSBkbyB0aGF0IGhlcmUgc28gdGhhdCB0aGlzIGlzIGluY2x1ZGVkIGluIGV4ZWN1dGlvbiB0aW1lXHJcbiAgICBpZiAoIHRoaXMudG9SZWN5Y2xlICkge1xyXG4gICAgICAgIHRoaXMudmVydGV4SnVua3lhcmQgPSB0aGlzLnZlcnRleEp1bmt5YXJkLmNvbmNhdCh0aGlzLnRvUmVjeWNsZS52ZXJ0aWNlcyk7XHJcbiAgICAgICAgdGhpcy5lZGdlSnVua3lhcmQgPSB0aGlzLmVkZ2VKdW5reWFyZC5jb25jYXQodGhpcy50b1JlY3ljbGUuZWRnZXMpO1xyXG4gICAgICAgIHRoaXMuY2VsbEp1bmt5YXJkID0gdGhpcy5jZWxsSnVua3lhcmQuY29uY2F0KHRoaXMudG9SZWN5Y2xlLmNlbGxzKTtcclxuICAgICAgICB0aGlzLnRvUmVjeWNsZSA9IG51bGw7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIC8vIEluaXRpYWxpemUgc2l0ZSBldmVudCBxdWV1ZVxyXG4gICAgdmFyIHNpdGVFdmVudHMgPSBzaXRlcy5zbGljZSgwKTtcclxuICAgIHNpdGVFdmVudHMuc29ydChmdW5jdGlvbihhLGIpe1xyXG4gICAgICAgIHZhciByID0gYi55IC0gYS55O1xyXG4gICAgICAgIGlmIChyKSB7cmV0dXJuIHI7fVxyXG4gICAgICAgIHJldHVybiBiLnggLSBhLng7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgLy8gcHJvY2VzcyBxdWV1ZVxyXG4gICAgdmFyIHNpdGUgPSBzaXRlRXZlbnRzLnBvcCgpLFxyXG4gICAgICAgIHNpdGVpZCA9IDAsXHJcbiAgICAgICAgeHNpdGV4LCAvLyB0byBhdm9pZCBkdXBsaWNhdGUgc2l0ZXNcclxuICAgICAgICB4c2l0ZXksXHJcbiAgICAgICAgY2VsbHMgPSB0aGlzLmNlbGxzLFxyXG4gICAgICAgIGNpcmNsZTtcclxuXHJcbiAgICAvLyBtYWluIGxvb3BcclxuICAgIGZvciAoOzspIHtcclxuICAgICAgICAvLyB3ZSBuZWVkIHRvIGZpZ3VyZSB3aGV0aGVyIHdlIGhhbmRsZSBhIHNpdGUgb3IgY2lyY2xlIGV2ZW50XHJcbiAgICAgICAgLy8gZm9yIHRoaXMgd2UgZmluZCBvdXQgaWYgdGhlcmUgaXMgYSBzaXRlIGV2ZW50IGFuZCBpdCBpc1xyXG4gICAgICAgIC8vICdlYXJsaWVyJyB0aGFuIHRoZSBjaXJjbGUgZXZlbnRcclxuICAgICAgICBjaXJjbGUgPSB0aGlzLmZpcnN0Q2lyY2xlRXZlbnQ7XHJcblxyXG4gICAgICAgIC8vIGFkZCBiZWFjaCBzZWN0aW9uXHJcbiAgICAgICAgaWYgKHNpdGUgJiYgKCFjaXJjbGUgfHwgc2l0ZS55IDwgY2lyY2xlLnkgfHwgKHNpdGUueSA9PT0gY2lyY2xlLnkgJiYgc2l0ZS54IDwgY2lyY2xlLngpKSkge1xyXG4gICAgICAgICAgICAvLyBvbmx5IGlmIHNpdGUgaXMgbm90IGEgZHVwbGljYXRlXHJcbiAgICAgICAgICAgIGlmIChzaXRlLnggIT09IHhzaXRleCB8fCBzaXRlLnkgIT09IHhzaXRleSkge1xyXG4gICAgICAgICAgICAgICAgLy8gZmlyc3QgY3JlYXRlIGNlbGwgZm9yIG5ldyBzaXRlXHJcbiAgICAgICAgICAgICAgICBjZWxsc1tzaXRlaWRdID0gdGhpcy5jcmVhdGVDZWxsKHNpdGUpO1xyXG4gICAgICAgICAgICAgICAgc2l0ZS52b3Jvbm9pSWQgPSBzaXRlaWQrKztcclxuICAgICAgICAgICAgICAgIC8vIHRoZW4gY3JlYXRlIGEgYmVhY2hzZWN0aW9uIGZvciB0aGF0IHNpdGVcclxuICAgICAgICAgICAgICAgIHRoaXMuYWRkQmVhY2hzZWN0aW9uKHNpdGUpO1xyXG4gICAgICAgICAgICAgICAgLy8gcmVtZW1iZXIgbGFzdCBzaXRlIGNvb3JkcyB0byBkZXRlY3QgZHVwbGljYXRlXHJcbiAgICAgICAgICAgICAgICB4c2l0ZXkgPSBzaXRlLnk7XHJcbiAgICAgICAgICAgICAgICB4c2l0ZXggPSBzaXRlLng7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHNpdGUgPSBzaXRlRXZlbnRzLnBvcCgpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIHJlbW92ZSBiZWFjaCBzZWN0aW9uXHJcbiAgICAgICAgZWxzZSBpZiAoY2lyY2xlKSB7XHJcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlQmVhY2hzZWN0aW9uKGNpcmNsZS5hcmMpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIGFsbCBkb25lLCBxdWl0XHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgIC8vIHdyYXBwaW5nLXVwOlxyXG4gICAgLy8gICBjb25uZWN0IGRhbmdsaW5nIGVkZ2VzIHRvIGJvdW5kaW5nIGJveFxyXG4gICAgLy8gICBjdXQgZWRnZXMgYXMgcGVyIGJvdW5kaW5nIGJveFxyXG4gICAgLy8gICBkaXNjYXJkIGVkZ2VzIGNvbXBsZXRlbHkgb3V0c2lkZSBib3VuZGluZyBib3hcclxuICAgIC8vICAgZGlzY2FyZCBlZGdlcyB3aGljaCBhcmUgcG9pbnQtbGlrZVxyXG4gICAgdGhpcy5jbGlwRWRnZXMoYmJveCk7XHJcblxyXG4gICAgLy8gICBhZGQgbWlzc2luZyBlZGdlcyBpbiBvcmRlciB0byBjbG9zZSBvcGVuZWQgY2VsbHNcclxuICAgIHRoaXMuY2xvc2VDZWxscyhiYm94KTtcclxuXHJcbiAgICAvLyB0byBtZWFzdXJlIGV4ZWN1dGlvbiB0aW1lXHJcbiAgICB2YXIgc3RvcFRpbWUgPSBuZXcgRGF0ZSgpO1xyXG5cclxuICAgIC8vIHByZXBhcmUgcmV0dXJuIHZhbHVlc1xyXG4gICAgdmFyIGRpYWdyYW0gPSBuZXcgdGhpcy5EaWFncmFtKCk7XHJcbiAgICBkaWFncmFtLmNlbGxzID0gdGhpcy5jZWxscztcclxuICAgIGRpYWdyYW0uZWRnZXMgPSB0aGlzLmVkZ2VzO1xyXG4gICAgZGlhZ3JhbS52ZXJ0aWNlcyA9IHRoaXMudmVydGljZXM7XHJcbiAgICBkaWFncmFtLmV4ZWNUaW1lID0gc3RvcFRpbWUuZ2V0VGltZSgpLXN0YXJ0VGltZS5nZXRUaW1lKCk7XHJcblxyXG4gICAgLy8gY2xlYW4gdXBcclxuICAgIHRoaXMucmVzZXQoKTtcclxuXHJcbiAgICByZXR1cm4gZGlhZ3JhbTtcclxuICAgIH07XHJcblxyXG4vKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xyXG5cclxuaWYgKCB0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJyApIHtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gVm9yb25vaTtcclxufVxyXG4iLCIiLCIvKlxyXG5wb2lzc29uLWRpc2stc2FtcGxlXHJcblxyXG5odHRwczovL2dpdGh1Yi5jb20vamVmZnJleS1oZWFybi9wb2lzc29uLWRpc2stc2FtcGxlXHJcblxyXG5NSVQgTGljZW5zZVxyXG4qL1xyXG5cclxuZnVuY3Rpb24gUG9pc3NvbkRpc2tTYW1wbGVyKHdpZHRoLCBoZWlnaHQsIG1pbkRpc3RhbmNlLCBzYW1wbGVGcmVxdWVuY3kpIHtcclxuICAgIHRoaXMud2lkdGggPSB3aWR0aDtcclxuICAgIHRoaXMuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgdGhpcy5taW5EaXN0YW5jZSA9IG1pbkRpc3RhbmNlO1xyXG4gICAgdGhpcy5zYW1wbGVGcmVxdWVuY3kgPSBzYW1wbGVGcmVxdWVuY3k7XHJcbiAgICB0aGlzLnJlc2V0KCk7XHJcbn1cclxuXHJcblBvaXNzb25EaXNrU2FtcGxlci5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcclxuICAgIHRoaXMuZ3JpZCA9IG5ldyBHcmlkKHRoaXMud2lkdGgsIHRoaXMuaGVpZ2h0LCB0aGlzLm1pbkRpc3RhbmNlKTtcclxuICAgIHRoaXMub3V0cHV0TGlzdCA9IG5ldyBBcnJheSgpO1xyXG4gICAgdGhpcy5wcm9jZXNzaW5nUXVldWUgPSBuZXcgUmFuZG9tUXVldWUoKTtcclxufVxyXG5cclxuUG9pc3NvbkRpc2tTYW1wbGVyLnByb3RvdHlwZS5zYW1wbGVVbnRpbFNvbHV0aW9uID0gZnVuY3Rpb24oKSB7XHJcbiAgICB3aGlsZSAodGhpcy5zYW1wbGUoKSkge307XHJcbiAgICByZXR1cm4gdGhpcy5vdXRwdXRMaXN0O1xyXG59XHJcblxyXG5Qb2lzc29uRGlza1NhbXBsZXIucHJvdG90eXBlLnNhbXBsZSA9IGZ1bmN0aW9uKCkge1xyXG5cclxuICAgIC8vIElmIHRoaXMgaXMgdGhlIGZpcnN0IHNhbXBsZVxyXG4gICAgaWYgKDAgPT0gdGhpcy5vdXRwdXRMaXN0Lmxlbmd0aCkge1xyXG4gICAgICAgIC8vIEdlbmVyYXRlIGZpcnN0IHBvaW50XHJcbiAgICAgICAgdGhpcy5xdWV1ZVRvQWxsKHRoaXMuZ3JpZC5yYW5kb21Qb2ludCgpKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcHJvY2Vzc1BvaW50ID0gdGhpcy5wcm9jZXNzaW5nUXVldWUucG9wKCk7XHJcblxyXG4gICAgLy8gUHJvY2Vzc2luZyBxdWV1ZSBpcyBlbXB0eSwgcmV0dXJuIGZhaWx1cmVcclxuICAgIGlmIChwcm9jZXNzUG9pbnQgPT0gbnVsbClcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcblxyXG4gICAgLy8gR2VuZXJhdGUgc2FtcGxlIHBvaW50cyBhcm91bmQgdGhlIHByb2Nlc3NpbmcgcG9pbnRcclxuICAgIC8vIEFuZCBjaGVjayBpZiB0aGV5IGhhdmUgYW55IG5laWdoYm9ycyBvbiB0aGUgZ3JpZFxyXG4gICAgLy8gSWYgbm90LCBhZGQgdGhlbSB0byB0aGUgcXVldWVzXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuc2FtcGxlRnJlcXVlbmN5OyBpKyspIHtcclxuICAgICAgICBzYW1wbGVQb2ludCA9IHRoaXMuZ3JpZC5yYW5kb21Qb2ludEFyb3VuZChwcm9jZXNzUG9pbnQpO1xyXG4gICAgICAgIGlmICghdGhpcy5ncmlkLmluTmVpZ2hib3Job29kKHNhbXBsZVBvaW50KSkge1xyXG4gICAgICAgICAgICAvLyBObyBvbiBpbiBuZWlnaGJvcmhvb2QsIHdlbGNvbWUgdG8gdGhlIGNsdWJcclxuICAgICAgICAgICAgdGhpcy5xdWV1ZVRvQWxsKHNhbXBsZVBvaW50KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICAvLyBTYW1wbGUgc3VjY2Vzc2Z1bCBzaW5jZSB0aGUgcHJvY2Vzc2luZyBxdWV1ZSBpc24ndCBlbXB0eVxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcblBvaXNzb25EaXNrU2FtcGxlci5wcm90b3R5cGUucXVldWVUb0FsbCA9IGZ1bmN0aW9uKHBvaW50KSB7XHJcbiAgICB2YXIgdmFsaWQgPSB0aGlzLmdyaWQuYWRkUG9pbnRUb0dyaWQocG9pbnQsIHRoaXMuZ3JpZC5waXhlbHNUb0dyaWRDb29yZHMocG9pbnQpKTtcclxuICAgIGlmICghdmFsaWQpXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgdGhpcy5wcm9jZXNzaW5nUXVldWUucHVzaChwb2ludCk7XHJcbiAgICB0aGlzLm91dHB1dExpc3QucHVzaChwb2ludCk7XHJcbn1cclxuXHJcblxyXG5cclxuZnVuY3Rpb24gR3JpZCh3aWR0aCwgaGVpZ2h0LCBtaW5EaXN0YW5jZSkge1xyXG4gICAgdGhpcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgdGhpcy5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICB0aGlzLm1pbkRpc3RhbmNlID0gbWluRGlzdGFuY2U7XHJcbiAgICB0aGlzLmNlbGxTaXplID0gdGhpcy5taW5EaXN0YW5jZSAvIE1hdGguU1FSVDI7XHJcbiAgICAvL2NvbnNvbGUubG9nKCB0aGlzLmNlbGxTaXplICk7XHJcbiAgICB0aGlzLnBvaW50U2l6ZSA9IDI7XHJcblxyXG4gICAgdGhpcy5jZWxsc1dpZGUgPSBNYXRoLmNlaWwodGhpcy53aWR0aCAvIHRoaXMuY2VsbFNpemUpO1xyXG4gICAgdGhpcy5jZWxsc0hpZ2ggPSBNYXRoLmNlaWwodGhpcy5oZWlnaHQgLyB0aGlzLmNlbGxTaXplKTtcclxuXHJcbiAgICAvLyBJbml0aWFsaXplIGdyaWRcclxuICAgIHRoaXMuZ3JpZCA9IFtdO1xyXG4gICAgZm9yICh2YXIgeCA9IDA7IHggPCB0aGlzLmNlbGxzV2lkZTsgeCsrKSB7XHJcbiAgICAgICAgdGhpcy5ncmlkW3hdID0gW107XHJcbiAgICAgICAgZm9yICh2YXIgeSA9IDA7IHkgPCB0aGlzLmNlbGxzSGlnaDsgeSsrKSB7XHJcbiAgICAgICAgICAgIHRoaXMuZ3JpZFt4XVt5XSA9IG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG5HcmlkLnByb3RvdHlwZS5waXhlbHNUb0dyaWRDb29yZHMgPSBmdW5jdGlvbihwb2ludCkge1xyXG4gICAgdmFyIGdyaWRYID0gTWF0aC5mbG9vcihwb2ludC54IC8gdGhpcy5jZWxsU2l6ZSk7XHJcbiAgICB2YXIgZ3JpZFkgPSBNYXRoLmZsb29yKHBvaW50LnkgLyB0aGlzLmNlbGxTaXplKTtcclxuICAgIHJldHVybiB7IHg6IGdyaWRYLCB5OiBncmlkWSB9O1xyXG59XHJcblxyXG5HcmlkLnByb3RvdHlwZS5hZGRQb2ludFRvR3JpZCA9IGZ1bmN0aW9uKHBvaW50Q29vcmRzLCBncmlkQ29vcmRzKSB7XHJcbiAgICAvLyBDaGVjayB0aGF0IHRoZSBjb29yZGluYXRlIG1ha2VzIHNlbnNlXHJcbiAgICBpZiAoZ3JpZENvb3Jkcy54IDwgMCB8fCBncmlkQ29vcmRzLnggPiB0aGlzLmdyaWQubGVuZ3RoIC0gMSlcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoZ3JpZENvb3Jkcy55IDwgMCB8fCBncmlkQ29vcmRzLnkgPiB0aGlzLmdyaWRbZ3JpZENvb3Jkcy54XS5sZW5ndGggLSAxKVxyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIHRoaXMuZ3JpZFtncmlkQ29vcmRzLnhdW2dyaWRDb29yZHMueV0gPSBwb2ludENvb3JkcztcclxuICAgIC8vY29uc29sZS5sb2coIFwiQWRkaW5nIChcIitwb2ludENvb3Jkcy54K1wiLFwiK3BvaW50Q29vcmRzLnkrXCIgdG8gZ3JpZCBbXCIrZ3JpZENvb3Jkcy54K1wiLFwiK2dyaWRDb29yZHMueStcIl1cIiApO1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbkdyaWQucHJvdG90eXBlLnJhbmRvbVBvaW50ID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4geyB4OiBnZXRSYW5kb21BcmJpdHJhcnkoMCwgdGhpcy53aWR0aCksIHk6IGdldFJhbmRvbUFyYml0cmFyeSgwLCB0aGlzLmhlaWdodCkgfTtcclxufVxyXG5cclxuR3JpZC5wcm90b3R5cGUucmFuZG9tUG9pbnRBcm91bmQgPSBmdW5jdGlvbihwb2ludCkge1xyXG4gICAgdmFyIHIxID0gTWF0aC5yYW5kb20oKTtcclxuICAgIHZhciByMiA9IE1hdGgucmFuZG9tKCk7XHJcbiAgICAvLyBnZXQgYSByYW5kb20gcmFkaXVzIGJldHdlZW4gdGhlIG1pbiBkaXN0YW5jZSBhbmQgMiBYIG1pbmRpc3RcclxuICAgIHZhciByYWRpdXMgPSB0aGlzLm1pbkRpc3RhbmNlICogKHIxICsgMSk7XHJcbiAgICAvLyBnZXQgcmFuZG9tIGFuZ2xlIGFyb3VuZCB0aGUgY2lyY2xlXHJcbiAgICB2YXIgYW5nbGUgPSAyICogTWF0aC5QSSAqIHIyO1xyXG4gICAgLy8gZ2V0IHggYW5kIHkgY29vcmRzIGJhc2VkIG9uIGFuZ2xlIGFuZCByYWRpdXNcclxuICAgIHZhciB4ID0gcG9pbnQueCArIHJhZGl1cyAqIE1hdGguY29zKGFuZ2xlKTtcclxuICAgIHZhciB5ID0gcG9pbnQueSArIHJhZGl1cyAqIE1hdGguc2luKGFuZ2xlKTtcclxuICAgIHJldHVybiB7IHg6IHgsIHk6IHkgfTtcclxufVxyXG5cclxuR3JpZC5wcm90b3R5cGUuaW5OZWlnaGJvcmhvb2QgPSBmdW5jdGlvbihwb2ludCkge1xyXG4gICAgdmFyIGdyaWRQb2ludCA9IHRoaXMucGl4ZWxzVG9HcmlkQ29vcmRzKHBvaW50KTtcclxuXHJcbiAgICB2YXIgY2VsbHNBcm91bmRQb2ludCA9IHRoaXMuY2VsbHNBcm91bmRQb2ludChwb2ludCk7XHJcblxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjZWxsc0Fyb3VuZFBvaW50Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgaWYgKGNlbGxzQXJvdW5kUG9pbnRbaV0gIT0gbnVsbCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5jYWxjRGlzdGFuY2UoY2VsbHNBcm91bmRQb2ludFtpXSwgcG9pbnQpIDwgdGhpcy5taW5EaXN0YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbkdyaWQucHJvdG90eXBlLmNlbGxzQXJvdW5kUG9pbnQgPSBmdW5jdGlvbihwb2ludCkge1xyXG4gICAgdmFyIGdyaWRDb29yZHMgPSB0aGlzLnBpeGVsc1RvR3JpZENvb3Jkcyhwb2ludCk7XHJcbiAgICB2YXIgbmVpZ2hib3JzID0gbmV3IEFycmF5KCk7XHJcblxyXG4gICAgZm9yICh2YXIgeCA9IC0yOyB4IDwgMzsgeCsrKSB7XHJcbiAgICAgICAgdmFyIHRhcmdldFggPSBncmlkQ29vcmRzLnggKyB4O1xyXG4gICAgICAgIC8vIG1ha2Ugc3VyZSBsb3dlcmJvdW5kIGFuZCB1cHBlcmJvdW5kIG1ha2Ugc2Vuc2VcclxuICAgICAgICBpZiAodGFyZ2V0WCA8IDApXHJcbiAgICAgICAgICAgIHRhcmdldFggPSAwO1xyXG4gICAgICAgIGlmICh0YXJnZXRYID4gdGhpcy5ncmlkLmxlbmd0aCAtIDEpXHJcbiAgICAgICAgICAgIHRhcmdldFggPSB0aGlzLmdyaWQubGVuZ3RoIC0gMTtcclxuXHJcbiAgICAgICAgZm9yICh2YXIgeSA9IC0yOyB5IDwgMzsgeSsrKSB7XHJcbiAgICAgICAgICAgIHZhciB0YXJnZXRZID0gZ3JpZENvb3Jkcy55ICsgeTtcclxuICAgICAgICAgICAgLy8gbWFrZSBzdXJlIGxvd2VyYm91bmQgYW5kIHVwcGVyYm91bmQgbWFrZSBzZW5zZVxyXG4gICAgICAgICAgICBpZiAodGFyZ2V0WSA8IDApXHJcbiAgICAgICAgICAgICAgICB0YXJnZXRZID0gMDtcclxuICAgICAgICAgICAgaWYgKHRhcmdldFkgPiB0aGlzLmdyaWRbdGFyZ2V0WF0ubGVuZ3RoIC0gMSlcclxuICAgICAgICAgICAgICAgIHRhcmdldFkgPSB0aGlzLmdyaWRbdGFyZ2V0WF0ubGVuZ3RoIC0gMTtcclxuICAgICAgICAgICAgbmVpZ2hib3JzLnB1c2godGhpcy5ncmlkW3RhcmdldFhdW3RhcmdldFldKVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBuZWlnaGJvcnM7XHJcbn1cclxuXHJcbkdyaWQucHJvdG90eXBlLmNhbGNEaXN0YW5jZSA9IGZ1bmN0aW9uKHBvaW50SW5DZWxsLCBwb2ludCkge1xyXG4gICAgcmV0dXJuIE1hdGguc3FydCgocG9pbnQueCAtIHBvaW50SW5DZWxsLngpICogKHBvaW50LnggLSBwb2ludEluQ2VsbC54KSArXHJcbiAgICAgICAgKHBvaW50LnkgLSBwb2ludEluQ2VsbC55KSAqIChwb2ludC55IC0gcG9pbnRJbkNlbGwueSkpO1xyXG59XHJcblxyXG5cclxuZnVuY3Rpb24gUmFuZG9tUXVldWUoYSkge1xyXG4gICAgdGhpcy5xdWV1ZSA9IGEgfHwgbmV3IEFycmF5KCk7XHJcbn1cclxuXHJcblJhbmRvbVF1ZXVlLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oZWxlbWVudCkge1xyXG4gICAgdGhpcy5xdWV1ZS5wdXNoKGVsZW1lbnQpO1xyXG59XHJcblxyXG5SYW5kb21RdWV1ZS5wcm90b3R5cGUucG9wID0gZnVuY3Rpb24oKSB7XHJcblxyXG4gICAgcmFuZG9tSW5kZXggPSBnZXRSYW5kb21JbnQoMCwgdGhpcy5xdWV1ZS5sZW5ndGgpO1xyXG4gICAgd2hpbGUgKHRoaXMucXVldWVbcmFuZG9tSW5kZXhdID09PSB1bmRlZmluZWQpIHtcclxuXHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHF1ZXVlIGlzIGVtcHR5XHJcbiAgICAgICAgdmFyIGVtcHR5ID0gdHJ1ZTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMucXVldWUubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgaWYgKHRoaXMucXVldWVbaV0gIT09IHVuZGVmaW5lZClcclxuICAgICAgICAgICAgICAgIGVtcHR5ID0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChlbXB0eSlcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgICAgIHJhbmRvbUluZGV4ID0gZ2V0UmFuZG9tSW50KDAsIHRoaXMucXVldWUubGVuZ3RoKTtcclxuICAgIH1cclxuXHJcbiAgICBlbGVtZW50ID0gdGhpcy5xdWV1ZVtyYW5kb21JbmRleF07XHJcbiAgICB0aGlzLnF1ZXVlLnJlbW92ZShyYW5kb21JbmRleCk7XHJcbiAgICByZXR1cm4gZWxlbWVudDtcclxufVxyXG5cclxuLy8gQXJyYXkgUmVtb3ZlIC0gQnkgSm9obiBSZXNpZyAoTUlUIExpY2Vuc2VkKVxyXG5BcnJheS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oZnJvbSwgdG8pIHtcclxuICAgIHZhciByZXN0ID0gdGhpcy5zbGljZSgodG8gfHwgZnJvbSkgKyAxIHx8IHRoaXMubGVuZ3RoKTtcclxuICAgIHRoaXMubGVuZ3RoID0gZnJvbSA8IDAgPyB0aGlzLmxlbmd0aCArIGZyb20gOiBmcm9tO1xyXG4gICAgcmV0dXJuIHRoaXMucHVzaC5hcHBseSh0aGlzLCByZXN0KTtcclxufTtcclxuXHJcbi8vIE1ETiBSYW5kb20gTnVtYmVyIEZ1bmN0aW9uc1xyXG4vLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL0phdmFTY3JpcHQvUmVmZXJlbmNlL0dsb2JhbF9PYmplY3RzL01hdGgvcmFuZG9tXHJcbmZ1bmN0aW9uIGdldFJhbmRvbUFyYml0cmFyeShtaW4sIG1heCkge1xyXG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgKiAobWF4IC0gbWluKSArIG1pbjtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0UmFuZG9tSW50KG1pbiwgbWF4KSB7XHJcbiAgICByZXR1cm4gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKG1heCAtIG1pbiArIDEpKSArIG1pbjtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBQb2lzc29uRGlza1NhbXBsZXI7IiwiLy8gQSBsaWJyYXJ5IG9mIHNlZWRhYmxlIFJOR3MgaW1wbGVtZW50ZWQgaW4gSmF2YXNjcmlwdC5cbi8vXG4vLyBVc2FnZTpcbi8vXG4vLyB2YXIgc2VlZHJhbmRvbSA9IHJlcXVpcmUoJ3NlZWRyYW5kb20nKTtcbi8vIHZhciByYW5kb20gPSBzZWVkcmFuZG9tKDEpOyAvLyBvciBhbnkgc2VlZC5cbi8vIHZhciB4ID0gcmFuZG9tKCk7ICAgICAgIC8vIDAgPD0geCA8IDEuICBFdmVyeSBiaXQgaXMgcmFuZG9tLlxuLy8gdmFyIHggPSByYW5kb20ucXVpY2soKTsgLy8gMCA8PSB4IDwgMS4gIDMyIGJpdHMgb2YgcmFuZG9tbmVzcy5cblxuLy8gYWxlYSwgYSA1My1iaXQgbXVsdGlwbHktd2l0aC1jYXJyeSBnZW5lcmF0b3IgYnkgSm9oYW5uZXMgQmFhZ8O4ZS5cbi8vIFBlcmlvZDogfjJeMTE2XG4vLyBSZXBvcnRlZCB0byBwYXNzIGFsbCBCaWdDcnVzaCB0ZXN0cy5cbnZhciBhbGVhID0gcmVxdWlyZSgnLi9saWIvYWxlYScpO1xuXG4vLyB4b3IxMjgsIGEgcHVyZSB4b3Itc2hpZnQgZ2VuZXJhdG9yIGJ5IEdlb3JnZSBNYXJzYWdsaWEuXG4vLyBQZXJpb2Q6IDJeMTI4LTEuXG4vLyBSZXBvcnRlZCB0byBmYWlsOiBNYXRyaXhSYW5rIGFuZCBMaW5lYXJDb21wLlxudmFyIHhvcjEyOCA9IHJlcXVpcmUoJy4vbGliL3hvcjEyOCcpO1xuXG4vLyB4b3J3b3csIEdlb3JnZSBNYXJzYWdsaWEncyAxNjAtYml0IHhvci1zaGlmdCBjb21iaW5lZCBwbHVzIHdleWwuXG4vLyBQZXJpb2Q6IDJeMTkyLTJeMzJcbi8vIFJlcG9ydGVkIHRvIGZhaWw6IENvbGxpc2lvbk92ZXIsIFNpbXBQb2tlciwgYW5kIExpbmVhckNvbXAuXG52YXIgeG9yd293ID0gcmVxdWlyZSgnLi9saWIveG9yd293Jyk7XG5cbi8vIHhvcnNoaWZ0NywgYnkgRnJhbsOnb2lzIFBhbm5ldG9uIGFuZCBQaWVycmUgTCdlY3V5ZXIsIHRha2VzXG4vLyBhIGRpZmZlcmVudCBhcHByb2FjaDogaXQgYWRkcyByb2J1c3RuZXNzIGJ5IGFsbG93aW5nIG1vcmUgc2hpZnRzXG4vLyB0aGFuIE1hcnNhZ2xpYSdzIG9yaWdpbmFsIHRocmVlLiAgSXQgaXMgYSA3LXNoaWZ0IGdlbmVyYXRvclxuLy8gd2l0aCAyNTYgYml0cywgdGhhdCBwYXNzZXMgQmlnQ3J1c2ggd2l0aCBubyBzeXN0bWF0aWMgZmFpbHVyZXMuXG4vLyBQZXJpb2QgMl4yNTYtMS5cbi8vIE5vIHN5c3RlbWF0aWMgQmlnQ3J1c2ggZmFpbHVyZXMgcmVwb3J0ZWQuXG52YXIgeG9yc2hpZnQ3ID0gcmVxdWlyZSgnLi9saWIveG9yc2hpZnQ3Jyk7XG5cbi8vIHhvcjQwOTYsIGJ5IFJpY2hhcmQgQnJlbnQsIGlzIGEgNDA5Ni1iaXQgeG9yLXNoaWZ0IHdpdGggYVxuLy8gdmVyeSBsb25nIHBlcmlvZCB0aGF0IGFsc28gYWRkcyBhIFdleWwgZ2VuZXJhdG9yLiBJdCBhbHNvIHBhc3Nlc1xuLy8gQmlnQ3J1c2ggd2l0aCBubyBzeXN0ZW1hdGljIGZhaWx1cmVzLiAgSXRzIGxvbmcgcGVyaW9kIG1heVxuLy8gYmUgdXNlZnVsIGlmIHlvdSBoYXZlIG1hbnkgZ2VuZXJhdG9ycyBhbmQgbmVlZCB0byBhdm9pZFxuLy8gY29sbGlzaW9ucy5cbi8vIFBlcmlvZDogMl40MTI4LTJeMzIuXG4vLyBObyBzeXN0ZW1hdGljIEJpZ0NydXNoIGZhaWx1cmVzIHJlcG9ydGVkLlxudmFyIHhvcjQwOTYgPSByZXF1aXJlKCcuL2xpYi94b3I0MDk2Jyk7XG5cbi8vIFR5Y2hlLWksIGJ5IFNhbXVlbCBOZXZlcyBhbmQgRmlsaXBlIEFyYXVqbywgaXMgYSBiaXQtc2hpZnRpbmcgcmFuZG9tXG4vLyBudW1iZXIgZ2VuZXJhdG9yIGRlcml2ZWQgZnJvbSBDaGFDaGEsIGEgbW9kZXJuIHN0cmVhbSBjaXBoZXIuXG4vLyBodHRwczovL2VkZW4uZGVpLnVjLnB0L35zbmV2ZXMvcHVicy8yMDExLXNuZmEyLnBkZlxuLy8gUGVyaW9kOiB+Ml4xMjdcbi8vIE5vIHN5c3RlbWF0aWMgQmlnQ3J1c2ggZmFpbHVyZXMgcmVwb3J0ZWQuXG52YXIgdHljaGVpID0gcmVxdWlyZSgnLi9saWIvdHljaGVpJyk7XG5cbi8vIFRoZSBvcmlnaW5hbCBBUkM0LWJhc2VkIHBybmcgaW5jbHVkZWQgaW4gdGhpcyBsaWJyYXJ5LlxuLy8gUGVyaW9kOiB+Ml4xNjAwXG52YXIgc3IgPSByZXF1aXJlKCcuL3NlZWRyYW5kb20nKTtcblxuc3IuYWxlYSA9IGFsZWE7XG5zci54b3IxMjggPSB4b3IxMjg7XG5zci54b3J3b3cgPSB4b3J3b3c7XG5zci54b3JzaGlmdDcgPSB4b3JzaGlmdDc7XG5zci54b3I0MDk2ID0geG9yNDA5NjtcbnNyLnR5Y2hlaSA9IHR5Y2hlaTtcblxubW9kdWxlLmV4cG9ydHMgPSBzcjtcbiIsIi8vIEEgcG9ydCBvZiBhbiBhbGdvcml0aG0gYnkgSm9oYW5uZXMgQmFhZ8O4ZSA8YmFhZ29lQGJhYWdvZS5jb20+LCAyMDEwXG4vLyBodHRwOi8vYmFhZ29lLmNvbS9lbi9SYW5kb21NdXNpbmdzL2phdmFzY3JpcHQvXG4vLyBodHRwczovL2dpdGh1Yi5jb20vbnF1aW5sYW4vYmV0dGVyLXJhbmRvbS1udW1iZXJzLWZvci1qYXZhc2NyaXB0LW1pcnJvclxuLy8gT3JpZ2luYWwgd29yayBpcyB1bmRlciBNSVQgbGljZW5zZSAtXG5cbi8vIENvcHlyaWdodCAoQykgMjAxMCBieSBKb2hhbm5lcyBCYWFnw7hlIDxiYWFnb2VAYmFhZ29lLm9yZz5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4vLyBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4vLyBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4vLyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4vLyBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbi8vIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vLyBcbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4vLyBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vIFxuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuLy8gSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4vLyBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbi8vIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbi8vIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG4vLyBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG4vLyBUSEUgU09GVFdBUkUuXG5cblxuXG4oZnVuY3Rpb24oZ2xvYmFsLCBtb2R1bGUsIGRlZmluZSkge1xuXG5mdW5jdGlvbiBBbGVhKHNlZWQpIHtcbiAgdmFyIG1lID0gdGhpcywgbWFzaCA9IE1hc2goKTtcblxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHQgPSAyMDkxNjM5ICogbWUuczAgKyBtZS5jICogMi4zMjgzMDY0MzY1Mzg2OTYzZS0xMDsgLy8gMl4tMzJcbiAgICBtZS5zMCA9IG1lLnMxO1xuICAgIG1lLnMxID0gbWUuczI7XG4gICAgcmV0dXJuIG1lLnMyID0gdCAtIChtZS5jID0gdCB8IDApO1xuICB9O1xuXG4gIC8vIEFwcGx5IHRoZSBzZWVkaW5nIGFsZ29yaXRobSBmcm9tIEJhYWdvZS5cbiAgbWUuYyA9IDE7XG4gIG1lLnMwID0gbWFzaCgnICcpO1xuICBtZS5zMSA9IG1hc2goJyAnKTtcbiAgbWUuczIgPSBtYXNoKCcgJyk7XG4gIG1lLnMwIC09IG1hc2goc2VlZCk7XG4gIGlmIChtZS5zMCA8IDApIHsgbWUuczAgKz0gMTsgfVxuICBtZS5zMSAtPSBtYXNoKHNlZWQpO1xuICBpZiAobWUuczEgPCAwKSB7IG1lLnMxICs9IDE7IH1cbiAgbWUuczIgLT0gbWFzaChzZWVkKTtcbiAgaWYgKG1lLnMyIDwgMCkgeyBtZS5zMiArPSAxOyB9XG4gIG1hc2ggPSBudWxsO1xufVxuXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC5jID0gZi5jO1xuICB0LnMwID0gZi5zMDtcbiAgdC5zMSA9IGYuczE7XG4gIHQuczIgPSBmLnMyO1xuICByZXR1cm4gdDtcbn1cblxuZnVuY3Rpb24gaW1wbChzZWVkLCBvcHRzKSB7XG4gIHZhciB4ZyA9IG5ldyBBbGVhKHNlZWQpLFxuICAgICAgc3RhdGUgPSBvcHRzICYmIG9wdHMuc3RhdGUsXG4gICAgICBwcm5nID0geGcubmV4dDtcbiAgcHJuZy5pbnQzMiA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gKHhnLm5leHQoKSAqIDB4MTAwMDAwMDAwKSB8IDA7IH1cbiAgcHJuZy5kb3VibGUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gcHJuZygpICsgKHBybmcoKSAqIDB4MjAwMDAwIHwgMCkgKiAxLjExMDIyMzAyNDYyNTE1NjVlLTE2OyAvLyAyXi01M1xuICB9O1xuICBwcm5nLnF1aWNrID0gcHJuZztcbiAgaWYgKHN0YXRlKSB7XG4gICAgaWYgKHR5cGVvZihzdGF0ZSkgPT0gJ29iamVjdCcpIGNvcHkoc3RhdGUsIHhnKTtcbiAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KHhnLCB7fSk7IH1cbiAgfVxuICByZXR1cm4gcHJuZztcbn1cblxuZnVuY3Rpb24gTWFzaCgpIHtcbiAgdmFyIG4gPSAweGVmYzgyNDlkO1xuXG4gIHZhciBtYXNoID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIGRhdGEgPSBkYXRhLnRvU3RyaW5nKCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkYXRhLmxlbmd0aDsgaSsrKSB7XG4gICAgICBuICs9IGRhdGEuY2hhckNvZGVBdChpKTtcbiAgICAgIHZhciBoID0gMC4wMjUxOTYwMzI4MjQxNjkzOCAqIG47XG4gICAgICBuID0gaCA+Pj4gMDtcbiAgICAgIGggLT0gbjtcbiAgICAgIGggKj0gbjtcbiAgICAgIG4gPSBoID4+PiAwO1xuICAgICAgaCAtPSBuO1xuICAgICAgbiArPSBoICogMHgxMDAwMDAwMDA7IC8vIDJeMzJcbiAgICB9XG4gICAgcmV0dXJuIChuID4+PiAwKSAqIDIuMzI4MzA2NDM2NTM4Njk2M2UtMTA7IC8vIDJeLTMyXG4gIH07XG5cbiAgcmV0dXJuIG1hc2g7XG59XG5cblxuaWYgKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IGltcGw7XG59IGVsc2UgaWYgKGRlZmluZSAmJiBkZWZpbmUuYW1kKSB7XG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIGltcGw7IH0pO1xufSBlbHNlIHtcbiAgdGhpcy5hbGVhID0gaW1wbDtcbn1cblxufSkoXG4gIHRoaXMsXG4gICh0eXBlb2YgbW9kdWxlKSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUsICAgIC8vIHByZXNlbnQgaW4gbm9kZS5qc1xuICAodHlwZW9mIGRlZmluZSkgPT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUgICAvLyBwcmVzZW50IHdpdGggYW4gQU1EIGxvYWRlclxuKTtcblxuXG4iLCIvLyBBIEphdmFzY3JpcHQgaW1wbGVtZW50YWlvbiBvZiB0aGUgXCJUeWNoZS1pXCIgcHJuZyBhbGdvcml0aG0gYnlcbi8vIFNhbXVlbCBOZXZlcyBhbmQgRmlsaXBlIEFyYXVqby5cbi8vIFNlZSBodHRwczovL2VkZW4uZGVpLnVjLnB0L35zbmV2ZXMvcHVicy8yMDExLXNuZmEyLnBkZlxuXG4oZnVuY3Rpb24oZ2xvYmFsLCBtb2R1bGUsIGRlZmluZSkge1xuXG5mdW5jdGlvbiBYb3JHZW4oc2VlZCkge1xuICB2YXIgbWUgPSB0aGlzLCBzdHJzZWVkID0gJyc7XG5cbiAgLy8gU2V0IHVwIGdlbmVyYXRvciBmdW5jdGlvbi5cbiAgbWUubmV4dCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBiID0gbWUuYiwgYyA9IG1lLmMsIGQgPSBtZS5kLCBhID0gbWUuYTtcbiAgICBiID0gKGIgPDwgMjUpIF4gKGIgPj4+IDcpIF4gYztcbiAgICBjID0gKGMgLSBkKSB8IDA7XG4gICAgZCA9IChkIDw8IDI0KSBeIChkID4+PiA4KSBeIGE7XG4gICAgYSA9IChhIC0gYikgfCAwO1xuICAgIG1lLmIgPSBiID0gKGIgPDwgMjApIF4gKGIgPj4+IDEyKSBeIGM7XG4gICAgbWUuYyA9IGMgPSAoYyAtIGQpIHwgMDtcbiAgICBtZS5kID0gKGQgPDwgMTYpIF4gKGMgPj4+IDE2KSBeIGE7XG4gICAgcmV0dXJuIG1lLmEgPSAoYSAtIGIpIHwgMDtcbiAgfTtcblxuICAvKiBUaGUgZm9sbG93aW5nIGlzIG5vbi1pbnZlcnRlZCB0eWNoZSwgd2hpY2ggaGFzIGJldHRlciBpbnRlcm5hbFxuICAgKiBiaXQgZGlmZnVzaW9uLCBidXQgd2hpY2ggaXMgYWJvdXQgMjUlIHNsb3dlciB0aGFuIHR5Y2hlLWkgaW4gSlMuXG4gIG1lLm5leHQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYSA9IG1lLmEsIGIgPSBtZS5iLCBjID0gbWUuYywgZCA9IG1lLmQ7XG4gICAgYSA9IChtZS5hICsgbWUuYiB8IDApID4+PiAwO1xuICAgIGQgPSBtZS5kIF4gYTsgZCA9IGQgPDwgMTYgXiBkID4+PiAxNjtcbiAgICBjID0gbWUuYyArIGQgfCAwO1xuICAgIGIgPSBtZS5iIF4gYzsgYiA9IGIgPDwgMTIgXiBkID4+PiAyMDtcbiAgICBtZS5hID0gYSA9IGEgKyBiIHwgMDtcbiAgICBkID0gZCBeIGE7IG1lLmQgPSBkID0gZCA8PCA4IF4gZCA+Pj4gMjQ7XG4gICAgbWUuYyA9IGMgPSBjICsgZCB8IDA7XG4gICAgYiA9IGIgXiBjO1xuICAgIHJldHVybiBtZS5iID0gKGIgPDwgNyBeIGIgPj4+IDI1KTtcbiAgfVxuICAqL1xuXG4gIG1lLmEgPSAwO1xuICBtZS5iID0gMDtcbiAgbWUuYyA9IDI2NTQ0MzU3NjkgfCAwO1xuICBtZS5kID0gMTM2NzEzMDU1MTtcblxuICBpZiAoc2VlZCA9PT0gTWF0aC5mbG9vcihzZWVkKSkge1xuICAgIC8vIEludGVnZXIgc2VlZC5cbiAgICBtZS5hID0gKHNlZWQgLyAweDEwMDAwMDAwMCkgfCAwO1xuICAgIG1lLmIgPSBzZWVkIHwgMDtcbiAgfSBlbHNlIHtcbiAgICAvLyBTdHJpbmcgc2VlZC5cbiAgICBzdHJzZWVkICs9IHNlZWQ7XG4gIH1cblxuICAvLyBNaXggaW4gc3RyaW5nIHNlZWQsIHRoZW4gZGlzY2FyZCBhbiBpbml0aWFsIGJhdGNoIG9mIDY0IHZhbHVlcy5cbiAgZm9yICh2YXIgayA9IDA7IGsgPCBzdHJzZWVkLmxlbmd0aCArIDIwOyBrKyspIHtcbiAgICBtZS5iIF49IHN0cnNlZWQuY2hhckNvZGVBdChrKSB8IDA7XG4gICAgbWUubmV4dCgpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvcHkoZiwgdCkge1xuICB0LmEgPSBmLmE7XG4gIHQuYiA9IGYuYjtcbiAgdC5jID0gZi5jO1xuICB0LmQgPSBmLmQ7XG4gIHJldHVybiB0O1xufTtcblxuZnVuY3Rpb24gaW1wbChzZWVkLCBvcHRzKSB7XG4gIHZhciB4ZyA9IG5ldyBYb3JHZW4oc2VlZCksXG4gICAgICBzdGF0ZSA9IG9wdHMgJiYgb3B0cy5zdGF0ZSxcbiAgICAgIHBybmcgPSBmdW5jdGlvbigpIHsgcmV0dXJuICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDA7IH07XG4gIHBybmcuZG91YmxlID0gZnVuY3Rpb24oKSB7XG4gICAgZG8ge1xuICAgICAgdmFyIHRvcCA9IHhnLm5leHQoKSA+Pj4gMTEsXG4gICAgICAgICAgYm90ID0gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMCxcbiAgICAgICAgICByZXN1bHQgPSAodG9wICsgYm90KSAvICgxIDw8IDIxKTtcbiAgICB9IHdoaWxlIChyZXN1bHQgPT09IDApO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG4gIHBybmcuaW50MzIgPSB4Zy5uZXh0O1xuICBwcm5nLnF1aWNrID0gcHJuZztcbiAgaWYgKHN0YXRlKSB7XG4gICAgaWYgKHR5cGVvZihzdGF0ZSkgPT0gJ29iamVjdCcpIGNvcHkoc3RhdGUsIHhnKTtcbiAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KHhnLCB7fSk7IH1cbiAgfVxuICByZXR1cm4gcHJuZztcbn1cblxuaWYgKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IGltcGw7XG59IGVsc2UgaWYgKGRlZmluZSAmJiBkZWZpbmUuYW1kKSB7XG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIGltcGw7IH0pO1xufSBlbHNlIHtcbiAgdGhpcy50eWNoZWkgPSBpbXBsO1xufVxuXG59KShcbiAgdGhpcyxcbiAgKHR5cGVvZiBtb2R1bGUpID09ICdvYmplY3QnICYmIG1vZHVsZSwgICAgLy8gcHJlc2VudCBpbiBub2RlLmpzXG4gICh0eXBlb2YgZGVmaW5lKSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZSAgIC8vIHByZXNlbnQgd2l0aCBhbiBBTUQgbG9hZGVyXG4pO1xuXG5cbiIsIi8vIEEgSmF2YXNjcmlwdCBpbXBsZW1lbnRhaW9uIG9mIHRoZSBcInhvcjEyOFwiIHBybmcgYWxnb3JpdGhtIGJ5XG4vLyBHZW9yZ2UgTWFyc2FnbGlhLiAgU2VlIGh0dHA6Ly93d3cuanN0YXRzb2Z0Lm9yZy92MDgvaTE0L3BhcGVyXG5cbihmdW5jdGlvbihnbG9iYWwsIG1vZHVsZSwgZGVmaW5lKSB7XG5cbmZ1bmN0aW9uIFhvckdlbihzZWVkKSB7XG4gIHZhciBtZSA9IHRoaXMsIHN0cnNlZWQgPSAnJztcblxuICBtZS54ID0gMDtcbiAgbWUueSA9IDA7XG4gIG1lLnogPSAwO1xuICBtZS53ID0gMDtcblxuICAvLyBTZXQgdXAgZ2VuZXJhdG9yIGZ1bmN0aW9uLlxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHQgPSBtZS54IF4gKG1lLnggPDwgMTEpO1xuICAgIG1lLnggPSBtZS55O1xuICAgIG1lLnkgPSBtZS56O1xuICAgIG1lLnogPSBtZS53O1xuICAgIHJldHVybiBtZS53IF49IChtZS53ID4+PiAxOSkgXiB0IF4gKHQgPj4+IDgpO1xuICB9O1xuXG4gIGlmIChzZWVkID09PSAoc2VlZCB8IDApKSB7XG4gICAgLy8gSW50ZWdlciBzZWVkLlxuICAgIG1lLnggPSBzZWVkO1xuICB9IGVsc2Uge1xuICAgIC8vIFN0cmluZyBzZWVkLlxuICAgIHN0cnNlZWQgKz0gc2VlZDtcbiAgfVxuXG4gIC8vIE1peCBpbiBzdHJpbmcgc2VlZCwgdGhlbiBkaXNjYXJkIGFuIGluaXRpYWwgYmF0Y2ggb2YgNjQgdmFsdWVzLlxuICBmb3IgKHZhciBrID0gMDsgayA8IHN0cnNlZWQubGVuZ3RoICsgNjQ7IGsrKykge1xuICAgIG1lLnggXj0gc3Ryc2VlZC5jaGFyQ29kZUF0KGspIHwgMDtcbiAgICBtZS5uZXh0KCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gY29weShmLCB0KSB7XG4gIHQueCA9IGYueDtcbiAgdC55ID0gZi55O1xuICB0LnogPSBmLno7XG4gIHQudyA9IGYudztcbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGltcGwoc2VlZCwgb3B0cykge1xuICB2YXIgeGcgPSBuZXcgWG9yR2VuKHNlZWQpLFxuICAgICAgc3RhdGUgPSBvcHRzICYmIG9wdHMuc3RhdGUsXG4gICAgICBwcm5nID0gZnVuY3Rpb24oKSB7IHJldHVybiAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwOyB9O1xuICBwcm5nLmRvdWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIGRvIHtcbiAgICAgIHZhciB0b3AgPSB4Zy5uZXh0KCkgPj4+IDExLFxuICAgICAgICAgIGJvdCA9ICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDAsXG4gICAgICAgICAgcmVzdWx0ID0gKHRvcCArIGJvdCkgLyAoMSA8PCAyMSk7XG4gICAgfSB3aGlsZSAocmVzdWx0ID09PSAwKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuICBwcm5nLmludDMyID0geGcubmV4dDtcbiAgcHJuZy5xdWljayA9IHBybmc7XG4gIGlmIChzdGF0ZSkge1xuICAgIGlmICh0eXBlb2Yoc3RhdGUpID09ICdvYmplY3QnKSBjb3B5KHN0YXRlLCB4Zyk7XG4gICAgcHJuZy5zdGF0ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gY29weSh4Zywge30pOyB9XG4gIH1cbiAgcmV0dXJuIHBybmc7XG59XG5cbmlmIChtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBpbXBsO1xufSBlbHNlIGlmIChkZWZpbmUgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBpbXBsOyB9KTtcbn0gZWxzZSB7XG4gIHRoaXMueG9yMTI4ID0gaW1wbDtcbn1cblxufSkoXG4gIHRoaXMsXG4gICh0eXBlb2YgbW9kdWxlKSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUsICAgIC8vIHByZXNlbnQgaW4gbm9kZS5qc1xuICAodHlwZW9mIGRlZmluZSkgPT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUgICAvLyBwcmVzZW50IHdpdGggYW4gQU1EIGxvYWRlclxuKTtcblxuXG4iLCIvLyBBIEphdmFzY3JpcHQgaW1wbGVtZW50YWlvbiBvZiBSaWNoYXJkIEJyZW50J3MgWG9yZ2VucyB4b3I0MDk2IGFsZ29yaXRobS5cbi8vXG4vLyBUaGlzIGZhc3Qgbm9uLWNyeXB0b2dyYXBoaWMgcmFuZG9tIG51bWJlciBnZW5lcmF0b3IgaXMgZGVzaWduZWQgZm9yXG4vLyB1c2UgaW4gTW9udGUtQ2FybG8gYWxnb3JpdGhtcy4gSXQgY29tYmluZXMgYSBsb25nLXBlcmlvZCB4b3JzaGlmdFxuLy8gZ2VuZXJhdG9yIHdpdGggYSBXZXlsIGdlbmVyYXRvciwgYW5kIGl0IHBhc3NlcyBhbGwgY29tbW9uIGJhdHRlcmllc1xuLy8gb2Ygc3Rhc3RpY2lhbCB0ZXN0cyBmb3IgcmFuZG9tbmVzcyB3aGlsZSBjb25zdW1pbmcgb25seSBhIGZldyBuYW5vc2Vjb25kc1xuLy8gZm9yIGVhY2ggcHJuZyBnZW5lcmF0ZWQuICBGb3IgYmFja2dyb3VuZCBvbiB0aGUgZ2VuZXJhdG9yLCBzZWUgQnJlbnQnc1xuLy8gcGFwZXI6IFwiU29tZSBsb25nLXBlcmlvZCByYW5kb20gbnVtYmVyIGdlbmVyYXRvcnMgdXNpbmcgc2hpZnRzIGFuZCB4b3JzLlwiXG4vLyBodHRwOi8vYXJ4aXYub3JnL3BkZi8xMDA0LjMxMTV2MS5wZGZcbi8vXG4vLyBVc2FnZTpcbi8vXG4vLyB2YXIgeG9yNDA5NiA9IHJlcXVpcmUoJ3hvcjQwOTYnKTtcbi8vIHJhbmRvbSA9IHhvcjQwOTYoMSk7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2VlZCB3aXRoIGludDMyIG9yIHN0cmluZy5cbi8vIGFzc2VydC5lcXVhbChyYW5kb20oKSwgMC4xNTIwNDM2NDUwNTM4NTQ3KTsgLy8gKDAsIDEpIHJhbmdlLCA1MyBiaXRzLlxuLy8gYXNzZXJ0LmVxdWFsKHJhbmRvbS5pbnQzMigpLCAxODA2NTM0ODk3KTsgICAvLyBzaWduZWQgaW50MzIsIDMyIGJpdHMuXG4vL1xuLy8gRm9yIG5vbnplcm8gbnVtZXJpYyBrZXlzLCB0aGlzIGltcGVsZW1lbnRhdGlvbiBwcm92aWRlcyBhIHNlcXVlbmNlXG4vLyBpZGVudGljYWwgdG8gdGhhdCBieSBCcmVudCdzIHhvcmdlbnMgMyBpbXBsZW1lbnRhaW9uIGluIEMuICBUaGlzXG4vLyBpbXBsZW1lbnRhdGlvbiBhbHNvIHByb3ZpZGVzIGZvciBpbml0YWxpemluZyB0aGUgZ2VuZXJhdG9yIHdpdGhcbi8vIHN0cmluZyBzZWVkcywgb3IgZm9yIHNhdmluZyBhbmQgcmVzdG9yaW5nIHRoZSBzdGF0ZSBvZiB0aGUgZ2VuZXJhdG9yLlxuLy9cbi8vIE9uIENocm9tZSwgdGhpcyBwcm5nIGJlbmNobWFya3MgYWJvdXQgMi4xIHRpbWVzIHNsb3dlciB0aGFuXG4vLyBKYXZhc2NyaXB0J3MgYnVpbHQtaW4gTWF0aC5yYW5kb20oKS5cblxuKGZ1bmN0aW9uKGdsb2JhbCwgbW9kdWxlLCBkZWZpbmUpIHtcblxuZnVuY3Rpb24gWG9yR2VuKHNlZWQpIHtcbiAgdmFyIG1lID0gdGhpcztcblxuICAvLyBTZXQgdXAgZ2VuZXJhdG9yIGZ1bmN0aW9uLlxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHcgPSBtZS53LFxuICAgICAgICBYID0gbWUuWCwgaSA9IG1lLmksIHQsIHY7XG4gICAgLy8gVXBkYXRlIFdleWwgZ2VuZXJhdG9yLlxuICAgIG1lLncgPSB3ID0gKHcgKyAweDYxYzg4NjQ3KSB8IDA7XG4gICAgLy8gVXBkYXRlIHhvciBnZW5lcmF0b3IuXG4gICAgdiA9IFhbKGkgKyAzNCkgJiAxMjddO1xuICAgIHQgPSBYW2kgPSAoKGkgKyAxKSAmIDEyNyldO1xuICAgIHYgXj0gdiA8PCAxMztcbiAgICB0IF49IHQgPDwgMTc7XG4gICAgdiBePSB2ID4+PiAxNTtcbiAgICB0IF49IHQgPj4+IDEyO1xuICAgIC8vIFVwZGF0ZSBYb3IgZ2VuZXJhdG9yIGFycmF5IHN0YXRlLlxuICAgIHYgPSBYW2ldID0gdiBeIHQ7XG4gICAgbWUuaSA9IGk7XG4gICAgLy8gUmVzdWx0IGlzIHRoZSBjb21iaW5hdGlvbi5cbiAgICByZXR1cm4gKHYgKyAodyBeICh3ID4+PiAxNikpKSB8IDA7XG4gIH07XG5cbiAgZnVuY3Rpb24gaW5pdChtZSwgc2VlZCkge1xuICAgIHZhciB0LCB2LCBpLCBqLCB3LCBYID0gW10sIGxpbWl0ID0gMTI4O1xuICAgIGlmIChzZWVkID09PSAoc2VlZCB8IDApKSB7XG4gICAgICAvLyBOdW1lcmljIHNlZWRzIGluaXRpYWxpemUgdiwgd2hpY2ggaXMgdXNlZCB0byBnZW5lcmF0ZXMgWC5cbiAgICAgIHYgPSBzZWVkO1xuICAgICAgc2VlZCA9IG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFN0cmluZyBzZWVkcyBhcmUgbWl4ZWQgaW50byB2IGFuZCBYIG9uZSBjaGFyYWN0ZXIgYXQgYSB0aW1lLlxuICAgICAgc2VlZCA9IHNlZWQgKyAnXFwwJztcbiAgICAgIHYgPSAwO1xuICAgICAgbGltaXQgPSBNYXRoLm1heChsaW1pdCwgc2VlZC5sZW5ndGgpO1xuICAgIH1cbiAgICAvLyBJbml0aWFsaXplIGNpcmN1bGFyIGFycmF5IGFuZCB3ZXlsIHZhbHVlLlxuICAgIGZvciAoaSA9IDAsIGogPSAtMzI7IGogPCBsaW1pdDsgKytqKSB7XG4gICAgICAvLyBQdXQgdGhlIHVuaWNvZGUgY2hhcmFjdGVycyBpbnRvIHRoZSBhcnJheSwgYW5kIHNodWZmbGUgdGhlbS5cbiAgICAgIGlmIChzZWVkKSB2IF49IHNlZWQuY2hhckNvZGVBdCgoaiArIDMyKSAlIHNlZWQubGVuZ3RoKTtcbiAgICAgIC8vIEFmdGVyIDMyIHNodWZmbGVzLCB0YWtlIHYgYXMgdGhlIHN0YXJ0aW5nIHcgdmFsdWUuXG4gICAgICBpZiAoaiA9PT0gMCkgdyA9IHY7XG4gICAgICB2IF49IHYgPDwgMTA7XG4gICAgICB2IF49IHYgPj4+IDE1O1xuICAgICAgdiBePSB2IDw8IDQ7XG4gICAgICB2IF49IHYgPj4+IDEzO1xuICAgICAgaWYgKGogPj0gMCkge1xuICAgICAgICB3ID0gKHcgKyAweDYxYzg4NjQ3KSB8IDA7ICAgICAvLyBXZXlsLlxuICAgICAgICB0ID0gKFhbaiAmIDEyN10gXj0gKHYgKyB3KSk7ICAvLyBDb21iaW5lIHhvciBhbmQgd2V5bCB0byBpbml0IGFycmF5LlxuICAgICAgICBpID0gKDAgPT0gdCkgPyBpICsgMSA6IDA7ICAgICAvLyBDb3VudCB6ZXJvZXMuXG4gICAgICB9XG4gICAgfVxuICAgIC8vIFdlIGhhdmUgZGV0ZWN0ZWQgYWxsIHplcm9lczsgbWFrZSB0aGUga2V5IG5vbnplcm8uXG4gICAgaWYgKGkgPj0gMTI4KSB7XG4gICAgICBYWyhzZWVkICYmIHNlZWQubGVuZ3RoIHx8IDApICYgMTI3XSA9IC0xO1xuICAgIH1cbiAgICAvLyBSdW4gdGhlIGdlbmVyYXRvciA1MTIgdGltZXMgdG8gZnVydGhlciBtaXggdGhlIHN0YXRlIGJlZm9yZSB1c2luZyBpdC5cbiAgICAvLyBGYWN0b3JpbmcgdGhpcyBhcyBhIGZ1bmN0aW9uIHNsb3dzIHRoZSBtYWluIGdlbmVyYXRvciwgc28gaXQgaXMganVzdFxuICAgIC8vIHVucm9sbGVkIGhlcmUuICBUaGUgd2V5bCBnZW5lcmF0b3IgaXMgbm90IGFkdmFuY2VkIHdoaWxlIHdhcm1pbmcgdXAuXG4gICAgaSA9IDEyNztcbiAgICBmb3IgKGogPSA0ICogMTI4OyBqID4gMDsgLS1qKSB7XG4gICAgICB2ID0gWFsoaSArIDM0KSAmIDEyN107XG4gICAgICB0ID0gWFtpID0gKChpICsgMSkgJiAxMjcpXTtcbiAgICAgIHYgXj0gdiA8PCAxMztcbiAgICAgIHQgXj0gdCA8PCAxNztcbiAgICAgIHYgXj0gdiA+Pj4gMTU7XG4gICAgICB0IF49IHQgPj4+IDEyO1xuICAgICAgWFtpXSA9IHYgXiB0O1xuICAgIH1cbiAgICAvLyBTdG9yaW5nIHN0YXRlIGFzIG9iamVjdCBtZW1iZXJzIGlzIGZhc3RlciB0aGFuIHVzaW5nIGNsb3N1cmUgdmFyaWFibGVzLlxuICAgIG1lLncgPSB3O1xuICAgIG1lLlggPSBYO1xuICAgIG1lLmkgPSBpO1xuICB9XG5cbiAgaW5pdChtZSwgc2VlZCk7XG59XG5cbmZ1bmN0aW9uIGNvcHkoZiwgdCkge1xuICB0LmkgPSBmLmk7XG4gIHQudyA9IGYudztcbiAgdC5YID0gZi5YLnNsaWNlKCk7XG4gIHJldHVybiB0O1xufTtcblxuZnVuY3Rpb24gaW1wbChzZWVkLCBvcHRzKSB7XG4gIGlmIChzZWVkID09IG51bGwpIHNlZWQgPSArKG5ldyBEYXRlKTtcbiAgdmFyIHhnID0gbmV3IFhvckdlbihzZWVkKSxcbiAgICAgIHN0YXRlID0gb3B0cyAmJiBvcHRzLnN0YXRlLFxuICAgICAgcHJuZyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMDsgfTtcbiAgcHJuZy5kb3VibGUgPSBmdW5jdGlvbigpIHtcbiAgICBkbyB7XG4gICAgICB2YXIgdG9wID0geGcubmV4dCgpID4+PiAxMSxcbiAgICAgICAgICBib3QgPSAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwLFxuICAgICAgICAgIHJlc3VsdCA9ICh0b3AgKyBib3QpIC8gKDEgPDwgMjEpO1xuICAgIH0gd2hpbGUgKHJlc3VsdCA9PT0gMCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcbiAgcHJuZy5pbnQzMiA9IHhnLm5leHQ7XG4gIHBybmcucXVpY2sgPSBwcm5nO1xuICBpZiAoc3RhdGUpIHtcbiAgICBpZiAoc3RhdGUuWCkgY29weShzdGF0ZSwgeGcpO1xuICAgIHBybmcuc3RhdGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGNvcHkoeGcsIHt9KTsgfVxuICB9XG4gIHJldHVybiBwcm5nO1xufVxuXG5pZiAobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gaW1wbDtcbn0gZWxzZSBpZiAoZGVmaW5lICYmIGRlZmluZS5hbWQpIHtcbiAgZGVmaW5lKGZ1bmN0aW9uKCkgeyByZXR1cm4gaW1wbDsgfSk7XG59IGVsc2Uge1xuICB0aGlzLnhvcjQwOTYgPSBpbXBsO1xufVxuXG59KShcbiAgdGhpcywgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2luZG93IG9iamVjdCBvciBnbG9iYWxcbiAgKHR5cGVvZiBtb2R1bGUpID09ICdvYmplY3QnICYmIG1vZHVsZSwgICAgLy8gcHJlc2VudCBpbiBub2RlLmpzXG4gICh0eXBlb2YgZGVmaW5lKSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZSAgIC8vIHByZXNlbnQgd2l0aCBhbiBBTUQgbG9hZGVyXG4pO1xuIiwiLy8gQSBKYXZhc2NyaXB0IGltcGxlbWVudGFpb24gb2YgdGhlIFwieG9yc2hpZnQ3XCIgYWxnb3JpdGhtIGJ5XG4vLyBGcmFuw6dvaXMgUGFubmV0b24gYW5kIFBpZXJyZSBMJ2VjdXllcjpcbi8vIFwiT24gdGhlIFhvcmdzaGlmdCBSYW5kb20gTnVtYmVyIEdlbmVyYXRvcnNcIlxuLy8gaHR0cDovL3NhbHVjLmVuZ3IudWNvbm4uZWR1L3JlZnMvY3J5cHRvL3JuZy9wYW5uZXRvbjA1b250aGV4b3JzaGlmdC5wZGZcblxuKGZ1bmN0aW9uKGdsb2JhbCwgbW9kdWxlLCBkZWZpbmUpIHtcblxuZnVuY3Rpb24gWG9yR2VuKHNlZWQpIHtcbiAgdmFyIG1lID0gdGhpcztcblxuICAvLyBTZXQgdXAgZ2VuZXJhdG9yIGZ1bmN0aW9uLlxuICBtZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgLy8gVXBkYXRlIHhvciBnZW5lcmF0b3IuXG4gICAgdmFyIFggPSBtZS54LCBpID0gbWUuaSwgdCwgdiwgdztcbiAgICB0ID0gWFtpXTsgdCBePSAodCA+Pj4gNyk7IHYgPSB0IF4gKHQgPDwgMjQpO1xuICAgIHQgPSBYWyhpICsgMSkgJiA3XTsgdiBePSB0IF4gKHQgPj4+IDEwKTtcbiAgICB0ID0gWFsoaSArIDMpICYgN107IHYgXj0gdCBeICh0ID4+PiAzKTtcbiAgICB0ID0gWFsoaSArIDQpICYgN107IHYgXj0gdCBeICh0IDw8IDcpO1xuICAgIHQgPSBYWyhpICsgNykgJiA3XTsgdCA9IHQgXiAodCA8PCAxMyk7IHYgXj0gdCBeICh0IDw8IDkpO1xuICAgIFhbaV0gPSB2O1xuICAgIG1lLmkgPSAoaSArIDEpICYgNztcbiAgICByZXR1cm4gdjtcbiAgfTtcblxuICBmdW5jdGlvbiBpbml0KG1lLCBzZWVkKSB7XG4gICAgdmFyIGosIHcsIFggPSBbXTtcblxuICAgIGlmIChzZWVkID09PSAoc2VlZCB8IDApKSB7XG4gICAgICAvLyBTZWVkIHN0YXRlIGFycmF5IHVzaW5nIGEgMzItYml0IGludGVnZXIuXG4gICAgICB3ID0gWFswXSA9IHNlZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNlZWQgc3RhdGUgdXNpbmcgYSBzdHJpbmcuXG4gICAgICBzZWVkID0gJycgKyBzZWVkO1xuICAgICAgZm9yIChqID0gMDsgaiA8IHNlZWQubGVuZ3RoOyArK2opIHtcbiAgICAgICAgWFtqICYgN10gPSAoWFtqICYgN10gPDwgMTUpIF5cbiAgICAgICAgICAgIChzZWVkLmNoYXJDb2RlQXQoaikgKyBYWyhqICsgMSkgJiA3XSA8PCAxMyk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEVuZm9yY2UgYW4gYXJyYXkgbGVuZ3RoIG9mIDgsIG5vdCBhbGwgemVyb2VzLlxuICAgIHdoaWxlIChYLmxlbmd0aCA8IDgpIFgucHVzaCgwKTtcbiAgICBmb3IgKGogPSAwOyBqIDwgOCAmJiBYW2pdID09PSAwOyArK2opO1xuICAgIGlmIChqID09IDgpIHcgPSBYWzddID0gLTE7IGVsc2UgdyA9IFhbal07XG5cbiAgICBtZS54ID0gWDtcbiAgICBtZS5pID0gMDtcblxuICAgIC8vIERpc2NhcmQgYW4gaW5pdGlhbCAyNTYgdmFsdWVzLlxuICAgIGZvciAoaiA9IDI1NjsgaiA+IDA7IC0taikge1xuICAgICAgbWUubmV4dCgpO1xuICAgIH1cbiAgfVxuXG4gIGluaXQobWUsIHNlZWQpO1xufVxuXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC54ID0gZi54LnNsaWNlKCk7XG4gIHQuaSA9IGYuaTtcbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGltcGwoc2VlZCwgb3B0cykge1xuICBpZiAoc2VlZCA9PSBudWxsKSBzZWVkID0gKyhuZXcgRGF0ZSk7XG4gIHZhciB4ZyA9IG5ldyBYb3JHZW4oc2VlZCksXG4gICAgICBzdGF0ZSA9IG9wdHMgJiYgb3B0cy5zdGF0ZSxcbiAgICAgIHBybmcgPSBmdW5jdGlvbigpIHsgcmV0dXJuICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDA7IH07XG4gIHBybmcuZG91YmxlID0gZnVuY3Rpb24oKSB7XG4gICAgZG8ge1xuICAgICAgdmFyIHRvcCA9IHhnLm5leHQoKSA+Pj4gMTEsXG4gICAgICAgICAgYm90ID0gKHhnLm5leHQoKSA+Pj4gMCkgLyAweDEwMDAwMDAwMCxcbiAgICAgICAgICByZXN1bHQgPSAodG9wICsgYm90KSAvICgxIDw8IDIxKTtcbiAgICB9IHdoaWxlIChyZXN1bHQgPT09IDApO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG4gIHBybmcuaW50MzIgPSB4Zy5uZXh0O1xuICBwcm5nLnF1aWNrID0gcHJuZztcbiAgaWYgKHN0YXRlKSB7XG4gICAgaWYgKHN0YXRlLngpIGNvcHkoc3RhdGUsIHhnKTtcbiAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KHhnLCB7fSk7IH1cbiAgfVxuICByZXR1cm4gcHJuZztcbn1cblxuaWYgKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IGltcGw7XG59IGVsc2UgaWYgKGRlZmluZSAmJiBkZWZpbmUuYW1kKSB7XG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIGltcGw7IH0pO1xufSBlbHNlIHtcbiAgdGhpcy54b3JzaGlmdDcgPSBpbXBsO1xufVxuXG59KShcbiAgdGhpcyxcbiAgKHR5cGVvZiBtb2R1bGUpID09ICdvYmplY3QnICYmIG1vZHVsZSwgICAgLy8gcHJlc2VudCBpbiBub2RlLmpzXG4gICh0eXBlb2YgZGVmaW5lKSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZSAgIC8vIHByZXNlbnQgd2l0aCBhbiBBTUQgbG9hZGVyXG4pO1xuXG4iLCIvLyBBIEphdmFzY3JpcHQgaW1wbGVtZW50YWlvbiBvZiB0aGUgXCJ4b3J3b3dcIiBwcm5nIGFsZ29yaXRobSBieVxuLy8gR2VvcmdlIE1hcnNhZ2xpYS4gIFNlZSBodHRwOi8vd3d3LmpzdGF0c29mdC5vcmcvdjA4L2kxNC9wYXBlclxuXG4oZnVuY3Rpb24oZ2xvYmFsLCBtb2R1bGUsIGRlZmluZSkge1xuXG5mdW5jdGlvbiBYb3JHZW4oc2VlZCkge1xuICB2YXIgbWUgPSB0aGlzLCBzdHJzZWVkID0gJyc7XG5cbiAgLy8gU2V0IHVwIGdlbmVyYXRvciBmdW5jdGlvbi5cbiAgbWUubmV4dCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB0ID0gKG1lLnggXiAobWUueCA+Pj4gMikpO1xuICAgIG1lLnggPSBtZS55OyBtZS55ID0gbWUuejsgbWUueiA9IG1lLnc7IG1lLncgPSBtZS52O1xuICAgIHJldHVybiAobWUuZCA9IChtZS5kICsgMzYyNDM3IHwgMCkpICtcbiAgICAgICAobWUudiA9IChtZS52IF4gKG1lLnYgPDwgNCkpIF4gKHQgXiAodCA8PCAxKSkpIHwgMDtcbiAgfTtcblxuICBtZS54ID0gMDtcbiAgbWUueSA9IDA7XG4gIG1lLnogPSAwO1xuICBtZS53ID0gMDtcbiAgbWUudiA9IDA7XG5cbiAgaWYgKHNlZWQgPT09IChzZWVkIHwgMCkpIHtcbiAgICAvLyBJbnRlZ2VyIHNlZWQuXG4gICAgbWUueCA9IHNlZWQ7XG4gIH0gZWxzZSB7XG4gICAgLy8gU3RyaW5nIHNlZWQuXG4gICAgc3Ryc2VlZCArPSBzZWVkO1xuICB9XG5cbiAgLy8gTWl4IGluIHN0cmluZyBzZWVkLCB0aGVuIGRpc2NhcmQgYW4gaW5pdGlhbCBiYXRjaCBvZiA2NCB2YWx1ZXMuXG4gIGZvciAodmFyIGsgPSAwOyBrIDwgc3Ryc2VlZC5sZW5ndGggKyA2NDsgaysrKSB7XG4gICAgbWUueCBePSBzdHJzZWVkLmNoYXJDb2RlQXQoaykgfCAwO1xuICAgIGlmIChrID09IHN0cnNlZWQubGVuZ3RoKSB7XG4gICAgICBtZS5kID0gbWUueCA8PCAxMCBeIG1lLnggPj4+IDQ7XG4gICAgfVxuICAgIG1lLm5leHQoKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC54ID0gZi54O1xuICB0LnkgPSBmLnk7XG4gIHQueiA9IGYuejtcbiAgdC53ID0gZi53O1xuICB0LnYgPSBmLnY7XG4gIHQuZCA9IGYuZDtcbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGltcGwoc2VlZCwgb3B0cykge1xuICB2YXIgeGcgPSBuZXcgWG9yR2VuKHNlZWQpLFxuICAgICAgc3RhdGUgPSBvcHRzICYmIG9wdHMuc3RhdGUsXG4gICAgICBwcm5nID0gZnVuY3Rpb24oKSB7IHJldHVybiAoeGcubmV4dCgpID4+PiAwKSAvIDB4MTAwMDAwMDAwOyB9O1xuICBwcm5nLmRvdWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIGRvIHtcbiAgICAgIHZhciB0b3AgPSB4Zy5uZXh0KCkgPj4+IDExLFxuICAgICAgICAgIGJvdCA9ICh4Zy5uZXh0KCkgPj4+IDApIC8gMHgxMDAwMDAwMDAsXG4gICAgICAgICAgcmVzdWx0ID0gKHRvcCArIGJvdCkgLyAoMSA8PCAyMSk7XG4gICAgfSB3aGlsZSAocmVzdWx0ID09PSAwKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuICBwcm5nLmludDMyID0geGcubmV4dDtcbiAgcHJuZy5xdWljayA9IHBybmc7XG4gIGlmIChzdGF0ZSkge1xuICAgIGlmICh0eXBlb2Yoc3RhdGUpID09ICdvYmplY3QnKSBjb3B5KHN0YXRlLCB4Zyk7XG4gICAgcHJuZy5zdGF0ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gY29weSh4Zywge30pOyB9XG4gIH1cbiAgcmV0dXJuIHBybmc7XG59XG5cbmlmIChtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBpbXBsO1xufSBlbHNlIGlmIChkZWZpbmUgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBpbXBsOyB9KTtcbn0gZWxzZSB7XG4gIHRoaXMueG9yd293ID0gaW1wbDtcbn1cblxufSkoXG4gIHRoaXMsXG4gICh0eXBlb2YgbW9kdWxlKSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUsICAgIC8vIHByZXNlbnQgaW4gbm9kZS5qc1xuICAodHlwZW9mIGRlZmluZSkgPT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUgICAvLyBwcmVzZW50IHdpdGggYW4gQU1EIGxvYWRlclxuKTtcblxuXG4iLCIvKlxuQ29weXJpZ2h0IDIwMTQgRGF2aWQgQmF1LlxuXG5QZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmdcbmEgY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG53aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG5kaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG9cbnBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0b1xudGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuXG5UaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZVxuaW5jbHVkZWQgaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG5cblRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsXG5FWFBSRVNTIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbk1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC5cbklOIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZXG5DTEFJTSwgREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULFxuVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEVcblNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG4qL1xuXG4oZnVuY3Rpb24gKHBvb2wsIG1hdGgpIHtcbi8vXG4vLyBUaGUgZm9sbG93aW5nIGNvbnN0YW50cyBhcmUgcmVsYXRlZCB0byBJRUVFIDc1NCBsaW1pdHMuXG4vL1xudmFyIGdsb2JhbCA9IHRoaXMsXG4gICAgd2lkdGggPSAyNTYsICAgICAgICAvLyBlYWNoIFJDNCBvdXRwdXQgaXMgMCA8PSB4IDwgMjU2XG4gICAgY2h1bmtzID0gNiwgICAgICAgICAvLyBhdCBsZWFzdCBzaXggUkM0IG91dHB1dHMgZm9yIGVhY2ggZG91YmxlXG4gICAgZGlnaXRzID0gNTIsICAgICAgICAvLyB0aGVyZSBhcmUgNTIgc2lnbmlmaWNhbnQgZGlnaXRzIGluIGEgZG91YmxlXG4gICAgcm5nbmFtZSA9ICdyYW5kb20nLCAvLyBybmduYW1lOiBuYW1lIGZvciBNYXRoLnJhbmRvbSBhbmQgTWF0aC5zZWVkcmFuZG9tXG4gICAgc3RhcnRkZW5vbSA9IG1hdGgucG93KHdpZHRoLCBjaHVua3MpLFxuICAgIHNpZ25pZmljYW5jZSA9IG1hdGgucG93KDIsIGRpZ2l0cyksXG4gICAgb3ZlcmZsb3cgPSBzaWduaWZpY2FuY2UgKiAyLFxuICAgIG1hc2sgPSB3aWR0aCAtIDEsXG4gICAgbm9kZWNyeXB0bzsgICAgICAgICAvLyBub2RlLmpzIGNyeXB0byBtb2R1bGUsIGluaXRpYWxpemVkIGF0IHRoZSBib3R0b20uXG5cbi8vXG4vLyBzZWVkcmFuZG9tKClcbi8vIFRoaXMgaXMgdGhlIHNlZWRyYW5kb20gZnVuY3Rpb24gZGVzY3JpYmVkIGFib3ZlLlxuLy9cbmZ1bmN0aW9uIHNlZWRyYW5kb20oc2VlZCwgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgdmFyIGtleSA9IFtdO1xuICBvcHRpb25zID0gKG9wdGlvbnMgPT0gdHJ1ZSkgPyB7IGVudHJvcHk6IHRydWUgfSA6IChvcHRpb25zIHx8IHt9KTtcblxuICAvLyBGbGF0dGVuIHRoZSBzZWVkIHN0cmluZyBvciBidWlsZCBvbmUgZnJvbSBsb2NhbCBlbnRyb3B5IGlmIG5lZWRlZC5cbiAgdmFyIHNob3J0c2VlZCA9IG1peGtleShmbGF0dGVuKFxuICAgIG9wdGlvbnMuZW50cm9weSA/IFtzZWVkLCB0b3N0cmluZyhwb29sKV0gOlxuICAgIChzZWVkID09IG51bGwpID8gYXV0b3NlZWQoKSA6IHNlZWQsIDMpLCBrZXkpO1xuXG4gIC8vIFVzZSB0aGUgc2VlZCB0byBpbml0aWFsaXplIGFuIEFSQzQgZ2VuZXJhdG9yLlxuICB2YXIgYXJjNCA9IG5ldyBBUkM0KGtleSk7XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiByZXR1cm5zIGEgcmFuZG9tIGRvdWJsZSBpbiBbMCwgMSkgdGhhdCBjb250YWluc1xuICAvLyByYW5kb21uZXNzIGluIGV2ZXJ5IGJpdCBvZiB0aGUgbWFudGlzc2Egb2YgdGhlIElFRUUgNzU0IHZhbHVlLlxuICB2YXIgcHJuZyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBuID0gYXJjNC5nKGNodW5rcyksICAgICAgICAgICAgIC8vIFN0YXJ0IHdpdGggYSBudW1lcmF0b3IgbiA8IDIgXiA0OFxuICAgICAgICBkID0gc3RhcnRkZW5vbSwgICAgICAgICAgICAgICAgIC8vICAgYW5kIGRlbm9taW5hdG9yIGQgPSAyIF4gNDguXG4gICAgICAgIHggPSAwOyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gICBhbmQgbm8gJ2V4dHJhIGxhc3QgYnl0ZScuXG4gICAgd2hpbGUgKG4gPCBzaWduaWZpY2FuY2UpIHsgICAgICAgICAgLy8gRmlsbCB1cCBhbGwgc2lnbmlmaWNhbnQgZGlnaXRzIGJ5XG4gICAgICBuID0gKG4gKyB4KSAqIHdpZHRoOyAgICAgICAgICAgICAgLy8gICBzaGlmdGluZyBudW1lcmF0b3IgYW5kXG4gICAgICBkICo9IHdpZHRoOyAgICAgICAgICAgICAgICAgICAgICAgLy8gICBkZW5vbWluYXRvciBhbmQgZ2VuZXJhdGluZyBhXG4gICAgICB4ID0gYXJjNC5nKDEpOyAgICAgICAgICAgICAgICAgICAgLy8gICBuZXcgbGVhc3Qtc2lnbmlmaWNhbnQtYnl0ZS5cbiAgICB9XG4gICAgd2hpbGUgKG4gPj0gb3ZlcmZsb3cpIHsgICAgICAgICAgICAgLy8gVG8gYXZvaWQgcm91bmRpbmcgdXAsIGJlZm9yZSBhZGRpbmdcbiAgICAgIG4gLz0gMjsgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAgIGxhc3QgYnl0ZSwgc2hpZnQgZXZlcnl0aGluZ1xuICAgICAgZCAvPSAyOyAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgcmlnaHQgdXNpbmcgaW50ZWdlciBtYXRoIHVudGlsXG4gICAgICB4ID4+Pj0gMTsgICAgICAgICAgICAgICAgICAgICAgICAgLy8gICB3ZSBoYXZlIGV4YWN0bHkgdGhlIGRlc2lyZWQgYml0cy5cbiAgICB9XG4gICAgcmV0dXJuIChuICsgeCkgLyBkOyAgICAgICAgICAgICAgICAgLy8gRm9ybSB0aGUgbnVtYmVyIHdpdGhpbiBbMCwgMSkuXG4gIH07XG5cbiAgcHJuZy5pbnQzMiA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gYXJjNC5nKDQpIHwgMDsgfVxuICBwcm5nLnF1aWNrID0gZnVuY3Rpb24oKSB7IHJldHVybiBhcmM0LmcoNCkgLyAweDEwMDAwMDAwMDsgfVxuICBwcm5nLmRvdWJsZSA9IHBybmc7XG5cbiAgLy8gTWl4IHRoZSByYW5kb21uZXNzIGludG8gYWNjdW11bGF0ZWQgZW50cm9weS5cbiAgbWl4a2V5KHRvc3RyaW5nKGFyYzQuUyksIHBvb2wpO1xuXG4gIC8vIENhbGxpbmcgY29udmVudGlvbjogd2hhdCB0byByZXR1cm4gYXMgYSBmdW5jdGlvbiBvZiBwcm5nLCBzZWVkLCBpc19tYXRoLlxuICByZXR1cm4gKG9wdGlvbnMucGFzcyB8fCBjYWxsYmFjayB8fFxuICAgICAgZnVuY3Rpb24ocHJuZywgc2VlZCwgaXNfbWF0aF9jYWxsLCBzdGF0ZSkge1xuICAgICAgICBpZiAoc3RhdGUpIHtcbiAgICAgICAgICAvLyBMb2FkIHRoZSBhcmM0IHN0YXRlIGZyb20gdGhlIGdpdmVuIHN0YXRlIGlmIGl0IGhhcyBhbiBTIGFycmF5LlxuICAgICAgICAgIGlmIChzdGF0ZS5TKSB7IGNvcHkoc3RhdGUsIGFyYzQpOyB9XG4gICAgICAgICAgLy8gT25seSBwcm92aWRlIHRoZSAuc3RhdGUgbWV0aG9kIGlmIHJlcXVlc3RlZCB2aWEgb3B0aW9ucy5zdGF0ZS5cbiAgICAgICAgICBwcm5nLnN0YXRlID0gZnVuY3Rpb24oKSB7IHJldHVybiBjb3B5KGFyYzQsIHt9KTsgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgY2FsbGVkIGFzIGEgbWV0aG9kIG9mIE1hdGggKE1hdGguc2VlZHJhbmRvbSgpKSwgbXV0YXRlXG4gICAgICAgIC8vIE1hdGgucmFuZG9tIGJlY2F1c2UgdGhhdCBpcyBob3cgc2VlZHJhbmRvbS5qcyBoYXMgd29ya2VkIHNpbmNlIHYxLjAuXG4gICAgICAgIGlmIChpc19tYXRoX2NhbGwpIHsgbWF0aFtybmduYW1lXSA9IHBybmc7IHJldHVybiBzZWVkOyB9XG5cbiAgICAgICAgLy8gT3RoZXJ3aXNlLCBpdCBpcyBhIG5ld2VyIGNhbGxpbmcgY29udmVudGlvbiwgc28gcmV0dXJuIHRoZVxuICAgICAgICAvLyBwcm5nIGRpcmVjdGx5LlxuICAgICAgICBlbHNlIHJldHVybiBwcm5nO1xuICAgICAgfSkoXG4gIHBybmcsXG4gIHNob3J0c2VlZCxcbiAgJ2dsb2JhbCcgaW4gb3B0aW9ucyA/IG9wdGlvbnMuZ2xvYmFsIDogKHRoaXMgPT0gbWF0aCksXG4gIG9wdGlvbnMuc3RhdGUpO1xufVxubWF0aFsnc2VlZCcgKyBybmduYW1lXSA9IHNlZWRyYW5kb207XG5cbi8vXG4vLyBBUkM0XG4vL1xuLy8gQW4gQVJDNCBpbXBsZW1lbnRhdGlvbi4gIFRoZSBjb25zdHJ1Y3RvciB0YWtlcyBhIGtleSBpbiB0aGUgZm9ybSBvZlxuLy8gYW4gYXJyYXkgb2YgYXQgbW9zdCAod2lkdGgpIGludGVnZXJzIHRoYXQgc2hvdWxkIGJlIDAgPD0geCA8ICh3aWR0aCkuXG4vL1xuLy8gVGhlIGcoY291bnQpIG1ldGhvZCByZXR1cm5zIGEgcHNldWRvcmFuZG9tIGludGVnZXIgdGhhdCBjb25jYXRlbmF0ZXNcbi8vIHRoZSBuZXh0IChjb3VudCkgb3V0cHV0cyBmcm9tIEFSQzQuICBJdHMgcmV0dXJuIHZhbHVlIGlzIGEgbnVtYmVyIHhcbi8vIHRoYXQgaXMgaW4gdGhlIHJhbmdlIDAgPD0geCA8ICh3aWR0aCBeIGNvdW50KS5cbi8vXG5mdW5jdGlvbiBBUkM0KGtleSkge1xuICB2YXIgdCwga2V5bGVuID0ga2V5Lmxlbmd0aCxcbiAgICAgIG1lID0gdGhpcywgaSA9IDAsIGogPSBtZS5pID0gbWUuaiA9IDAsIHMgPSBtZS5TID0gW107XG5cbiAgLy8gVGhlIGVtcHR5IGtleSBbXSBpcyB0cmVhdGVkIGFzIFswXS5cbiAgaWYgKCFrZXlsZW4pIHsga2V5ID0gW2tleWxlbisrXTsgfVxuXG4gIC8vIFNldCB1cCBTIHVzaW5nIHRoZSBzdGFuZGFyZCBrZXkgc2NoZWR1bGluZyBhbGdvcml0aG0uXG4gIHdoaWxlIChpIDwgd2lkdGgpIHtcbiAgICBzW2ldID0gaSsrO1xuICB9XG4gIGZvciAoaSA9IDA7IGkgPCB3aWR0aDsgaSsrKSB7XG4gICAgc1tpXSA9IHNbaiA9IG1hc2sgJiAoaiArIGtleVtpICUga2V5bGVuXSArICh0ID0gc1tpXSkpXTtcbiAgICBzW2pdID0gdDtcbiAgfVxuXG4gIC8vIFRoZSBcImdcIiBtZXRob2QgcmV0dXJucyB0aGUgbmV4dCAoY291bnQpIG91dHB1dHMgYXMgb25lIG51bWJlci5cbiAgKG1lLmcgPSBmdW5jdGlvbihjb3VudCkge1xuICAgIC8vIFVzaW5nIGluc3RhbmNlIG1lbWJlcnMgaW5zdGVhZCBvZiBjbG9zdXJlIHN0YXRlIG5lYXJseSBkb3VibGVzIHNwZWVkLlxuICAgIHZhciB0LCByID0gMCxcbiAgICAgICAgaSA9IG1lLmksIGogPSBtZS5qLCBzID0gbWUuUztcbiAgICB3aGlsZSAoY291bnQtLSkge1xuICAgICAgdCA9IHNbaSA9IG1hc2sgJiAoaSArIDEpXTtcbiAgICAgIHIgPSByICogd2lkdGggKyBzW21hc2sgJiAoKHNbaV0gPSBzW2ogPSBtYXNrICYgKGogKyB0KV0pICsgKHNbal0gPSB0KSldO1xuICAgIH1cbiAgICBtZS5pID0gaTsgbWUuaiA9IGo7XG4gICAgcmV0dXJuIHI7XG4gICAgLy8gRm9yIHJvYnVzdCB1bnByZWRpY3RhYmlsaXR5LCB0aGUgZnVuY3Rpb24gY2FsbCBiZWxvdyBhdXRvbWF0aWNhbGx5XG4gICAgLy8gZGlzY2FyZHMgYW4gaW5pdGlhbCBiYXRjaCBvZiB2YWx1ZXMuICBUaGlzIGlzIGNhbGxlZCBSQzQtZHJvcFsyNTZdLlxuICAgIC8vIFNlZSBodHRwOi8vZ29vZ2xlLmNvbS9zZWFyY2g/cT1yc2ErZmx1aHJlcityZXNwb25zZSZidG5JXG4gIH0pKHdpZHRoKTtcbn1cblxuLy9cbi8vIGNvcHkoKVxuLy8gQ29waWVzIGludGVybmFsIHN0YXRlIG9mIEFSQzQgdG8gb3IgZnJvbSBhIHBsYWluIG9iamVjdC5cbi8vXG5mdW5jdGlvbiBjb3B5KGYsIHQpIHtcbiAgdC5pID0gZi5pO1xuICB0LmogPSBmLmo7XG4gIHQuUyA9IGYuUy5zbGljZSgpO1xuICByZXR1cm4gdDtcbn07XG5cbi8vXG4vLyBmbGF0dGVuKClcbi8vIENvbnZlcnRzIGFuIG9iamVjdCB0cmVlIHRvIG5lc3RlZCBhcnJheXMgb2Ygc3RyaW5ncy5cbi8vXG5mdW5jdGlvbiBmbGF0dGVuKG9iaiwgZGVwdGgpIHtcbiAgdmFyIHJlc3VsdCA9IFtdLCB0eXAgPSAodHlwZW9mIG9iaiksIHByb3A7XG4gIGlmIChkZXB0aCAmJiB0eXAgPT0gJ29iamVjdCcpIHtcbiAgICBmb3IgKHByb3AgaW4gb2JqKSB7XG4gICAgICB0cnkgeyByZXN1bHQucHVzaChmbGF0dGVuKG9ialtwcm9wXSwgZGVwdGggLSAxKSk7IH0gY2F0Y2ggKGUpIHt9XG4gICAgfVxuICB9XG4gIHJldHVybiAocmVzdWx0Lmxlbmd0aCA/IHJlc3VsdCA6IHR5cCA9PSAnc3RyaW5nJyA/IG9iaiA6IG9iaiArICdcXDAnKTtcbn1cblxuLy9cbi8vIG1peGtleSgpXG4vLyBNaXhlcyBhIHN0cmluZyBzZWVkIGludG8gYSBrZXkgdGhhdCBpcyBhbiBhcnJheSBvZiBpbnRlZ2VycywgYW5kXG4vLyByZXR1cm5zIGEgc2hvcnRlbmVkIHN0cmluZyBzZWVkIHRoYXQgaXMgZXF1aXZhbGVudCB0byB0aGUgcmVzdWx0IGtleS5cbi8vXG5mdW5jdGlvbiBtaXhrZXkoc2VlZCwga2V5KSB7XG4gIHZhciBzdHJpbmdzZWVkID0gc2VlZCArICcnLCBzbWVhciwgaiA9IDA7XG4gIHdoaWxlIChqIDwgc3RyaW5nc2VlZC5sZW5ndGgpIHtcbiAgICBrZXlbbWFzayAmIGpdID1cbiAgICAgIG1hc2sgJiAoKHNtZWFyIF49IGtleVttYXNrICYgal0gKiAxOSkgKyBzdHJpbmdzZWVkLmNoYXJDb2RlQXQoaisrKSk7XG4gIH1cbiAgcmV0dXJuIHRvc3RyaW5nKGtleSk7XG59XG5cbi8vXG4vLyBhdXRvc2VlZCgpXG4vLyBSZXR1cm5zIGFuIG9iamVjdCBmb3IgYXV0b3NlZWRpbmcsIHVzaW5nIHdpbmRvdy5jcnlwdG8gYW5kIE5vZGUgY3J5cHRvXG4vLyBtb2R1bGUgaWYgYXZhaWxhYmxlLlxuLy9cbmZ1bmN0aW9uIGF1dG9zZWVkKCkge1xuICB0cnkge1xuICAgIHZhciBvdXQ7XG4gICAgaWYgKG5vZGVjcnlwdG8gJiYgKG91dCA9IG5vZGVjcnlwdG8ucmFuZG9tQnl0ZXMpKSB7XG4gICAgICAvLyBUaGUgdXNlIG9mICdvdXQnIHRvIHJlbWVtYmVyIHJhbmRvbUJ5dGVzIG1ha2VzIHRpZ2h0IG1pbmlmaWVkIGNvZGUuXG4gICAgICBvdXQgPSBvdXQod2lkdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvdXQgPSBuZXcgVWludDhBcnJheSh3aWR0aCk7XG4gICAgICAoZ2xvYmFsLmNyeXB0byB8fCBnbG9iYWwubXNDcnlwdG8pLmdldFJhbmRvbVZhbHVlcyhvdXQpO1xuICAgIH1cbiAgICByZXR1cm4gdG9zdHJpbmcob3V0KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHZhciBicm93c2VyID0gZ2xvYmFsLm5hdmlnYXRvcixcbiAgICAgICAgcGx1Z2lucyA9IGJyb3dzZXIgJiYgYnJvd3Nlci5wbHVnaW5zO1xuICAgIHJldHVybiBbK25ldyBEYXRlLCBnbG9iYWwsIHBsdWdpbnMsIGdsb2JhbC5zY3JlZW4sIHRvc3RyaW5nKHBvb2wpXTtcbiAgfVxufVxuXG4vL1xuLy8gdG9zdHJpbmcoKVxuLy8gQ29udmVydHMgYW4gYXJyYXkgb2YgY2hhcmNvZGVzIHRvIGEgc3RyaW5nXG4vL1xuZnVuY3Rpb24gdG9zdHJpbmcoYSkge1xuICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseSgwLCBhKTtcbn1cblxuLy9cbi8vIFdoZW4gc2VlZHJhbmRvbS5qcyBpcyBsb2FkZWQsIHdlIGltbWVkaWF0ZWx5IG1peCBhIGZldyBiaXRzXG4vLyBmcm9tIHRoZSBidWlsdC1pbiBSTkcgaW50byB0aGUgZW50cm9weSBwb29sLiAgQmVjYXVzZSB3ZSBkb1xuLy8gbm90IHdhbnQgdG8gaW50ZXJmZXJlIHdpdGggZGV0ZXJtaW5pc3RpYyBQUk5HIHN0YXRlIGxhdGVyLFxuLy8gc2VlZHJhbmRvbSB3aWxsIG5vdCBjYWxsIG1hdGgucmFuZG9tIG9uIGl0cyBvd24gYWdhaW4gYWZ0ZXJcbi8vIGluaXRpYWxpemF0aW9uLlxuLy9cbm1peGtleShtYXRoLnJhbmRvbSgpLCBwb29sKTtcblxuLy9cbi8vIE5vZGVqcyBhbmQgQU1EIHN1cHBvcnQ6IGV4cG9ydCB0aGUgaW1wbGVtZW50YXRpb24gYXMgYSBtb2R1bGUgdXNpbmdcbi8vIGVpdGhlciBjb252ZW50aW9uLlxuLy9cbmlmICgodHlwZW9mIG1vZHVsZSkgPT0gJ29iamVjdCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBzZWVkcmFuZG9tO1xuICAvLyBXaGVuIGluIG5vZGUuanMsIHRyeSB1c2luZyBjcnlwdG8gcGFja2FnZSBmb3IgYXV0b3NlZWRpbmcuXG4gIHRyeSB7XG4gICAgbm9kZWNyeXB0byA9IHJlcXVpcmUoJ2NyeXB0bycpO1xuICB9IGNhdGNoIChleCkge31cbn0gZWxzZSBpZiAoKHR5cGVvZiBkZWZpbmUpID09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBzZWVkcmFuZG9tOyB9KTtcbn1cblxuLy8gRW5kIGFub255bW91cyBzY29wZSwgYW5kIHBhc3MgaW5pdGlhbCB2YWx1ZXMuXG59KShcbiAgW10sICAgICAvLyBwb29sOiBlbnRyb3B5IHBvb2wgc3RhcnRzIGVtcHR5XG4gIE1hdGggICAgLy8gbWF0aDogcGFja2FnZSBjb250YWluaW5nIHJhbmRvbSwgcG93LCBhbmQgc2VlZHJhbmRvbVxuKTtcbiIsIi8qKlxyXG4gKiBUaGlzIG1vZHVsZSBpcyB1c2VkIHRvIGNyZWF0ZSBkaWZmZXJlbnQgcG9pbnQgZGlzdHJpYnV0aW9ucyB0aGF0IGNhbiBiZVxyXG4gKiB0dXJuZWQgaW50byBkaWZmZXJlbnQgdGlsZSBzZXRzIHdoZW4gbWFkZSBpbnRvIGEgZ3JhcGggZm9ybWF0LiBUaGVyZSBhcmVcclxuICogdmFyaW91cyBkaWZmZXJlbnQgZGlzdHJpYnV0aW9ucyB0aGF0IGNhbiBiZSB1c2VkIHRvIGNyZWF0ZSBpbnRlcmVzdGluZ1xyXG4gKiB0aWxlIHBhdHRlcm5zIHdoZW4gdHVybmVkIGludG8gYSB2b3Jvbm9pIGRpYWdyYW0uIFxyXG4gKiBcclxuICogQGNsYXNzIFBvaW50RGlzdHJpYnV0aW9uXHJcbiAqL1xyXG5cclxuXCJ1c2Ugc3RyaWN0XCI7XHJcblxyXG5pbXBvcnQgUG9pc3NvbiBmcm9tIFwicG9pc3Nvbi1kaXNrLXNhbXBsZVwiO1xyXG5pbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcclxuaW1wb3J0IFJlY3RhbmdsZSBmcm9tIFwiLi4vZ2VvbWV0cnkvUmVjdGFuZ2xlXCI7XHJcbmltcG9ydCBSYW5kIGZyb20gXCIuL1JhbmRcIjtcclxuXHJcbi8qKlxyXG4gKiBDcmVhdGVzIGEgcmFuZG9tIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMgaW4gYSBwYXJ0aWN1bGFyIGJvdW5kaW5nIGJveFxyXG4gKiB3aXRoIGEgcGFydGljdWxhciBhdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLlxyXG4gKiBcclxuICogQGV4cG9ydFxyXG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcclxuICogQHBhcmFtIHtudW1iZXJ9IFtzZWVkPW51bGxdIElmIHNwZWNpZmllZCB1c2UgYSBsb2NhbCBzZWVkIGZvciBjcmVhdGluZyB0aGUgcG9pbnRcclxuICogIGRpc3RyaWJ1dGlvbi4gT3RoZXJ3aXNlLCB1c2UgdGhlIGN1cnJlbnQgZ2xvYmFsIHNlZWQgZm9yIGdlbmVyYXRpb25cclxuICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgbGlzdCBvZiByYW5kb21seSBkaXN0cmlidXRlZCBwb2ludHNcclxuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gcmFuZG9tKGJib3gsIGQsIHNlZWQgPSBudWxsKSB7XHJcbiAgICBjb25zdCBybmcgPSBzZWVkID8gbmV3IFJhbmQoc2VlZCkgOiBSYW5kO1xyXG4gICAgY29uc3QgblBvaW50cyA9IGJib3guYXJlYSAvIChkICogZCk7XHJcblxyXG4gICAgbGV0IHBvaW50cyA9IFtdO1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuUG9pbnRzOyBpKyspIHtcclxuICAgICAgICBwb2ludHMucHVzaChybmcudmVjdG9yKGJib3gpKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcG9pbnRzO1xyXG59XHJcblxyXG4vKipcclxuICogQ3JlYXRlcyBhIHNxdWFyZSBncmlkIGxpa2UgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXIgYm91bmRpbmdcclxuICogYm94IHdpdGggYSBwYXJ0aWN1bGFyIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLlxyXG4gKiBcclxuICogQGV4cG9ydFxyXG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcclxuICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgbGlzdCBvZiByYW5kb21seSBkaXN0cmlidXRlZCBwb2ludHNcclxuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gc3F1YXJlKGJib3gsIGQpIHtcclxuICAgIGNvbnN0IGR4ID0gZCAvIDI7XHJcbiAgICBjb25zdCBkeSA9IGR4O1xyXG4gICAgbGV0IHBvaW50cyA9IFtdO1xyXG5cclxuICAgIGZvciAobGV0IHkgPSAwOyB5IDwgYmJveC5oZWlnaHQ7IHkgKz0gZCkge1xyXG4gICAgICAgIGZvciAobGV0IHggPSAwOyB4IDwgYmJveC53aWR0aDsgeCArPSBkKSB7XHJcbiAgICAgICAgICAgIHBvaW50cy5wdXNoKG5ldyBWZWN0b3IoZHggKyB4LCBkeSArIHkpKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHBvaW50cztcclxufVxyXG5cclxuLyoqXHJcbiAqIENyZWF0ZXMgYSB1bmlmb3JtIGhleGFnb25hbCBkaXN0cmlidXRpb24gb2YgcG9pbnRzIGluIGEgcGFydGljdWxhciBib3VuZGluZ1xyXG4gKiBib3ggd2l0aCBhIHBhcnRpY3VsYXIgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuIFRoZSBoZXhhZ29ucyBjYW4gYWxzbyBiZVxyXG4gKiBzcGVjaWZpZWQgdG8gaGF2ZSBhIHBhcnRpY3VsYXIgd2lkdGggb3IgaGVpZ2h0IGFzIHdlbGwgYXMgY3JlYXRpbmcgaGV4YWdvbnNcclxuICogdGhhdCBoYXZlIFwicG9pbnR5XCIgdG9wcyBvciBcImZsYXRcIiB0b3BzLiBCeSBkZWZhdWx0IGl0IG1ha2VzIGZsYXQgdG9wcy5cclxuICogXHJcbiAqIEBleHBvcnRcclxuICogQHBhcmFtIHtSZWN0YW5nbGV9IGJib3ggVGhlIGJvdW5kaW5nIGJveCB0byBjcmVhdGUgdGhlIHBvaW50cyBpblxyXG4gKiBAcGFyYW0ge251bWJlcn0gZCBBdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzXHJcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2ZsYXRUb3A9dHJ1ZV0gQ3JlYXRlIGhlY2Fnb25zIHdpdGggZmxhdCB0b3BzIGJ5IGRlZmF1bHQuXHJcbiAqICBPdGhlcndpc2UgZ28gd2l0aCB0aGUgcG9pbnR5IHRvcCBoZXhhZ29ucy5cclxuICogQHBhcmFtIHtudW1iZXJ9IHcgVGhlIHdpZHRoIG9mIHRoZSBoZXhhZ29uIHRpbGVzXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSBoIFRoZSBoZWlnaHQgb2YgdGhlIGhleGFnb24gdGlsZXNcclxuICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgbGlzdCBvZiByYW5kb21seSBkaXN0cmlidXRlZCBwb2ludHNcclxuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaGV4YWdvbihiYm94LCBkLCBmbGF0VG9wID0gdHJ1ZSwgdywgaCkge1xyXG4gICAgLy8gTmVlZCB0byBhbGxvdyBmb3IgdGhlIGNoYW5nZSBvZiBoZWlnaHQgYW5kIHdpZHRoXHJcbiAgICAvLyBSdW5uaW5nIGludG8gXCJVbmNhdWdodCBWb3Jvbm9pLmNsb3NlQ2VsbHMoKSA+IHRoaXMgbWFrZXMgbm8gc2Vuc2UhXCJcclxuXHJcbiAgICBjb25zdCBkeCA9IGQgLyAyO1xyXG4gICAgY29uc3QgZHkgPSBkeDtcclxuICAgIGxldCBwb2ludHMgPSBbXTtcclxuICAgIGNvbnN0IGFsdGl0dWRlID0gTWF0aC5zcXJ0KDMpIC8gMiAqIGQ7XHJcbiAgICB2YXIgTiA9IE1hdGguc3FydChiYm94LmFyZWEgLyAoZCAqIGQpKTtcclxuICAgIGZvciAobGV0IHkgPSAwOyB5IDwgTjsgeSsrKSB7XHJcbiAgICAgICAgZm9yIChsZXQgeCA9IDA7IHggPCBOOyB4KyspIHtcclxuICAgICAgICAgICAgcG9pbnRzLnB1c2gobmV3IFZlY3RvcigoMC41ICsgeCkgLyBOICogYmJveC53aWR0aCxcclxuICAgICAgICAgICAgICAgICgwLjI1ICsgMC41ICogeCAlIDIgKyB5KSAvIE4gKiBiYm94LmhlaWdodCkpO1xyXG4gICAgICAgICAgICAvLyBwb2ludHMucHVzaChuZXcgVmVjdG9yKCh5ICUgMikgKiBkeCArIHggKiBkICsgZHgsIHkgKiBkICsgZHkpKTsgLy8gUG9pbnR5IFRvcFxyXG4gICAgICAgICAgICAvLyBwb2ludHMucHVzaChuZXcgVmVjdG9yKHggKiBkLCAoeCAlIDIpICogZHggKyB5ICogZCkpOyAvLyBGbGF0IFRvcFxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcG9pbnRzO1xyXG59XHJcblxyXG4vKipcclxuICogQ3JlYXRlcyBhIGJsdWUgbm9pc2UgZGlzdHJpYnV0aW9uIG9mIHBvaW50cyBpbiBhIHBhcnRpY3VsYXIgYm91bmRpbmcgYm94XHJcbiAqIHdpdGggYSBwYXJ0aWN1bGFyIGF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHMuIFRoaXMgaXMgZG9uZSBieVxyXG4gKiBjcmVhdGluZyBhIGdyaWQgc3lzdGVtIGFuZCBwaWNraW5nIGEgcmFuZG9tIHBvaW50IGluIGVhY2ggZ3JpZC4gVGhpcyBoYXNcclxuICogdGhlIGVmZmVjdCBvZiBjcmVhdGluZyBhIGxlc3MgcmFuZG9tIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMuIFRoZSBzZWNvbmRcclxuICogcGFyYW1ldGVyIG0gZGV0ZXJtaW5zIHRoZSBzcGFjaW5nIGJldHdlZW4gcG9pbnRzIGluIHRoZSBncmlkLiBUaGlzIGVuc3VyZXNcclxuICogdGhhdCBubyB0d28gcG9pbnRzIGFyZSBpbiB0aGUgc2FtZSBncmlkLlxyXG4gKiBcclxuICogQHN1bW1hcnkgQ3JlYXRlIGEgaml0dGVyZWQgZ3JpZCBiYXNlZCByYW5kb20gYmx1ZSBub2lzZSBwb2ludCBkaXN0cmlidXRpb24uXHJcbiAqIFxyXG4gKiBAZXhwb3J0XHJcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cclxuICogQHBhcmFtIHtudW1iZXJ9IGQgQXZlcmFnZSBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50c1xyXG4gKiBAcGFyYW0ge251bWJlcn0gW3NlZWQ9bnVsbF0gSWYgc3BlY2lmaWVkIHVzZSBhIGxvY2FsIHNlZWQgZm9yIGNyZWF0aW5nIHRoZSBwb2ludFxyXG4gKiAgZGlzdHJpYnV0aW9uLiBPdGhlcndpc2UsIHVzZSB0aGUgY3VycmVudCBnbG9iYWwgc2VlZCBmb3IgZ2VuZXJhdGlvblxyXG4gKiBAcGFyYW0ge251bWJlcn0gW209MF0gTWF4aW11bSBkaXN0YW5jZSBhd2F5IGZyb20gdGhlIGVkZ2Ugb2YgdGhlIGdyaWQgdGhhdCBhXHJcbiAqICBwb2ludCBjYW4gYmUgcGxhY2VkLiBUaGlzIGFjdHMgdG8gaW5jcmVhc2UgdGhlIHBhZGRpbmcgYmV0d2VlbiBwb2ludHMuIFxyXG4gKiAgVGhpcyBtYWtlcyB0aGUgbm9pc2UgbGVzcyByYW5kb20uIFRoaXMgbnVtYmVyIG11c3QgYmUgc21hbGxlciB0aGFuIGQuXHJcbiAqIEByZXR1cm5zIHtWZWN0b3JbXX0gVGhlIGxpc3Qgb2YgcmFuZG9tbHkgZGlzdHJpYnV0ZWQgcG9pbnRzXHJcbiAqIEBtZW1iZXJvZiBQb2ludERpc3RyaWJ1dGlvblxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGppdHRlcmVkR3JpZChiYm94LCBkLCBzZWVkID0gbnVsbCwgbSA9IDApIHtcclxuICAgIGNvbnN0IHJuZyA9IHNlZWQgPyBuZXcgUmFuZChzZWVkKSA6IFJhbmQ7XHJcblxyXG4gICAgbGV0IHBvaW50cyA9IFtdO1xyXG4gICAgbGV0IHBvaW50Qm94O1xyXG4gICAgZm9yIChsZXQgeSA9IDA7IHkgPCBiYm94LmhlaWdodCAtIGQ7IHkgKz0gZCkge1xyXG4gICAgICAgIGZvciAobGV0IHggPSAwOyB4IDwgYmJveC53aWR0aCAtIGQ7IHggKz0gZCkge1xyXG4gICAgICAgICAgICAvLyBMb2NhbCBiYm94IGZvciB0aGUgcG9pbnQgdG8gZ2VuZXJhdGUgaW5cclxuICAgICAgICAgICAgY29uc3QgYm94UG9zID0gbmV3IFZlY3Rvcih4IC0gZCArIG0sIHkgLSBkICsgbSk7XHJcbiAgICAgICAgICAgIHBvaW50Qm94ID0gbmV3IFJlY3RhbmdsZShib3hQb3MsIHggLSBtLCB5IC0gbSk7XHJcbiAgICAgICAgICAgIHBvaW50cy5wdXNoKHJuZy52ZWN0b3IocG9pbnRCb3gpKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHBvaW50cztcclxufVxyXG5cclxuLyoqXHJcbiAqIENyZWF0ZXMgYSBwb2lzc29uLCBvciBibHVlIG5vaXNlIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMgaW4gYSBwYXJ0aWN1bGFyXHJcbiAqIGJvdW5kaW5nIGJveCB3aXRoIGEgcGFydGljdWxhciBhdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLiBUaGlzIGlzXHJcbiAqIGRvbmUgYnkgdXNpbmcgcG9pc3NvbiBkaXNrIHNhbXBsaW5nIHdoaWNoIHRyaWVzIHRvIGNyZWF0ZSBwb2ludHMgc28gdGhhdCB0aGVcclxuICogZGlzdGFuY2UgYmV0d2VlbiBuZWlnaGJvcnMgaXMgYXMgY2xvc2UgdG8gYSBmaXhlZCBudW1iZXIgKHRoZSBkaXN0YW5jZSBkKVxyXG4gKiBhcyBwb3NzaWJsZS4gVGhpcyBhbGdvcml0aG0gaXMgaW1wbGVtZW50ZWQgdXNpbmcgdGhlIHBvaXNzb24gZGFydCB0aHJvd2luZ1xyXG4gKiBhbGdvcml0aG0uXHJcbiAqICBcclxuICogQHN1bW1hcnkgQ3JlYXRlIGEgYmx1ZSBub2lzZSBkaXN0cmlidXRpb24gb2YgcG9pbnRzIHVzaW5nIHBvaXNzb24gZGlza1xyXG4gKiAgc2FtcGxpbmcuXHJcbiAqIFxyXG4gKiBAZXhwb3J0XHJcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cclxuICogQHBhcmFtIHtudW1iZXJ9IGQgQXZlcmFnZSBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50c1xyXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xyXG4gKiBcclxuICogQHNlZSB7QGxpbmsgaHR0cHM6Ly93d3cuamFzb25kYXZpZXMuY29tL3BvaXNzb24tZGlzYy99XHJcbiAqIEBzZWUge0BsaW5rIGh0dHBzOi8vZ2l0aHViLmNvbS9qZWZmcmV5LWhlYXJuL3BvaXNzb24tZGlzay1zYW1wbGV9XHJcbiAqIEBtZW1iZXJvZiBQb2ludERpc3RyaWJ1dGlvblxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHBvaXNzb24oYmJveCwgZCkge1xyXG4gICAgdmFyIHNhbXBsZXIgPSBuZXcgUG9pc3NvbihiYm94LndpZHRoLCBiYm94LmhlaWdodCwgZCwgZCk7XHJcbiAgICB2YXIgc29sdXRpb24gPSBzYW1wbGVyLnNhbXBsZVVudGlsU29sdXRpb24oKTtcclxuICAgIHZhciBwb2ludHMgPSBzb2x1dGlvbi5tYXAocG9pbnQgPT4gbmV3IFZlY3Rvcihwb2ludCkpO1xyXG5cclxuICAgIHJldHVybiBwb2ludHM7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDcmVhdGVzIGEgYmx1ZSBub2lzZSBkaXN0cmlidXRpb24gb2YgcG9pbnRzIGluIGEgcGFydGljdWxhciBib3VuZGluZyBib3hcclxuICogd2l0aCBhIHBhcnRpY3VsYXIgYXZlcmFnZSBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50cy4gVGhpcyBpcyBkb25lIGJ5IHVzaW5nXHJcbiAqIHJlY3Vyc2l2ZSB3YW5nIHRpbGVzIHRvIGNyZWF0ZSB0aGlzIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMuXHJcbiAqIFxyXG4gKiBAc3VtbWFyeSBOb3QgSW1wbGVtZW50ZWQgWWV0XHJcbiAqIFxyXG4gKiBAZXhwb3J0XHJcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggdG8gY3JlYXRlIHRoZSBwb2ludHMgaW5cclxuICogQHBhcmFtIHtudW1iZXJ9IGQgQXZlcmFnZSBkaXN0YW5jZSBiZXR3ZWVuIHBvaW50c1xyXG4gKiBAcmV0dXJucyB7VmVjdG9yW119IFRoZSBsaXN0IG9mIHJhbmRvbWx5IGRpc3RyaWJ1dGVkIHBvaW50c1xyXG4gKiBAbWVtYmVyb2YgUG9pbnREaXN0cmlidXRpb25cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiByZWN1cnNpdmVXYW5nKGJib3gsIGQpIHtcclxuICAgIHRocm93IFwiRXJyb3I6IE5vdCBJbXBsZW1lbnRlZFwiO1xyXG59XHJcblxyXG4vKipcclxuICogQ3JlYXRlcyBhIGNpcmN1bGFyIGRpc3RyaWJ1dGlvbiBvZiBwb2ludHMgaW4gYSBwYXJ0aWN1bGFyIGJvdW5kaW5nIGJveFxyXG4gKiB3aXRoIGEgcGFydGljdWxhciBhdmVyYWdlIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRzLlxyXG4gKiBcclxuICogQHN1bW1hcnkgTm90IEltcGxlbWVudGVkIFlldFxyXG4gKiBcclxuICogQGV4cG9ydFxyXG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IHRvIGNyZWF0ZSB0aGUgcG9pbnRzIGluXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSBkIEF2ZXJhZ2UgZGlzdGFuY2UgYmV0d2VlbiBwb2ludHNcclxuICogQHJldHVybnMge1ZlY3RvcltdfSBUaGUgbGlzdCBvZiByYW5kb21seSBkaXN0cmlidXRlZCBwb2ludHNcclxuICogQG1lbWJlcm9mIFBvaW50RGlzdHJpYnV0aW9uXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gY2lyY3VsYXIoYmJveCwgZCkge1xyXG4gICAgdGhyb3cgXCJFcnJvcjogTm90IEltcGxlbWVudGVkXCI7XHJcbn0iLCJcInVzZSBzdHJpY3RcIjtcclxuXHJcbmltcG9ydCBzZWVkUmFuZG9tIGZyb20gXCJzZWVkUmFuZG9tXCI7XHJcbmltcG9ydCBWZWN0b3IgZnJvbSBcIi4uL2dlb21ldHJ5L1ZlY3RvclwiO1xyXG5cclxuY2xhc3MgUmFuZCB7XHJcbiAgICAvKipcclxuICAgICAqIFdyYXBwZXIgbGlicmFyeSBmb3IgRGF2aWQgQmF1J3Mgc2VlZGVkIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9yIHdoaWNoIGlzIGFcclxuICAgICAqIHdyYXBwZXIgZm9yIHRoZSBNYXRoLnJhbmQoKSBmdW5jdGlvbmFsaXR5LiBUaGlzIGxpYnJhcnkgaXMgaW1wbGVtZW50ZWQgdG9cclxuICAgICAqIGZpbGwgb3V0IHRoZSBmdW5jdGlvbmFsaXR5IG9mIHRoZSByYW5kb20gY2FwYWJpbGl0aWVzIGFzIHdlbGwgYXMgYnVpbGRcclxuICAgICAqIG9uIHRoZSBjYXBhYmlsaXRpZXMgZXhpc3RpbmcgaW4gdGhlIGZyYW1ld29yayBjdXJyZW50bHkuIFRoaXMgY2xhc3MgY2FuXHJcbiAgICAgKiBiZSB1c2VkIG9uIGEgZ2xvYmFsIG9yIGxvY2FsIHNjYWxlLlxyXG4gICAgICogXHJcbiAgICAgKiBAZXhhbXBsZVxyXG4gICAgICogUmFuZC5zZWVkUmFuZG9tKDApOyAgICAgIC8vIFNldCB0aGUgZ2xvYmFsIHNlZWRcclxuICAgICAqIFJhbmQucmFuZCgpOyAgICAgICAgICAgICAvLyBQcmVkaWN0YWJsZSBiYXNlZCBvZmYgc2VlZFxyXG4gICAgICogXHJcbiAgICAgKiBAZXhhbXBsZSBcclxuICAgICAqIHZhciBybmcgPSBuZXcgUmFuZCgwKTsgICAvLyBTZXQgdGhlIGxvY2FsIHJuZyBzZWVkXHJcbiAgICAgKiBybmcucmFuZCgpOyAgICAgICAgICAgICAgLy8gUHJlZGljdGFibGUgYmFzZWQgb2ZmIHNlZWRcclxuICAgICAqIFxyXG4gICAgICogUmFuZC5yYW5kKCk7ICAgICAgICAgICAgIC8vIFVucHJlZGljdGFibGUgc2luY2UgZ2xvYmFsIHNlZWQgaXMgbm90IHNldFxyXG4gICAgICogXHJcbiAgICAgKiBAc2VlIHtAbGluayBodHRwczovL2dpdGh1Yi5jb20vZGF2aWRiYXUvc2VlZHJhbmRvbX1cclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gW3NlZWQ9MF0gVGhlIHNlZWQgdG8gYmUgYXBwbGllZCB0byB0aGUgbG9jYWxcclxuICAgICAqICByYW5kb20gbnVtYmVyIGdlbmVyYXRvclxyXG4gICAgICogQGNsYXNzIFJhbmRcclxuICAgICAqL1xyXG4gICAgY29uc3RydWN0b3Ioc2VlZCA9IDApIHtcclxuICAgICAgICB0aGlzLnJuZyA9IHNlZWRSYW5kb20oc2VlZCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTZXQgdGhlIGdsb2JhbCBzZWVkIGZvciB0aGUgc2VlZGVkIHJhbmRvbSBudW1iZXIgZ2VuZXJhdG9yLiBBZnRlciB0aGUgc2VlZCBoYXMgYmVlblxyXG4gICAgICogc2V0LiBUaGUgcmFuZG9tIG51bWJlcnMgd2lsbCBiZSBwcmVkaWN0YWJsZSBhbmQgcmVwZWF0YWJsZSBnaXZlbiB0aGUgc2FtZVxyXG4gICAgICogaW5wdXQgc2VlZC4gSWYgbm8gc2VlZCBpcyBzcGVjaWZpZWQsIHRoZW4gYSByYW5kb20gc2VlZCB3aWxsIGJlIGFzc2lnbmVkIHRvXHJcbiAgICAgKiB0aGUgcmFuZG9tIG51bWJlciBnZW5lcmF0b3IgdXNpbmcgYWRkZWQgc3lzdGVtIGVudHJvcHkuXHJcbiAgICAgKiBcclxuICAgICAqIEBleHBvcnRcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gW3NlZWQ9MF0gVGhlIHNlZWQgdG8gYmUgYXBwbGllZCB0byB0aGUgZ2xvYmFsXHJcbiAgICAgKiAgcmFuZG9tIG51bWJlciBnZW5lcmF0b3JcclxuICAgICAqIEBtZW1iZXJvZiBSYW5kXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBzZXRTZWVkKHNlZWQgPSAwKSB7XHJcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgZ2xvYmFsOiB0cnVlLFxyXG4gICAgICAgICAgICBlbnRyb3B5OiBzZWVkID09PSB1bmRlZmluZWRcclxuICAgICAgICB9O1xyXG4gICAgICAgIHNlZWRSYW5kb20oc2VlZCwgb3B0aW9ucyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTZXQgdGhlIHNlZWQgZm9yIHRoZSBzZWVkZWQgcmFuZG9tIG51bWJlciBnZW5lcmF0b3IuIEFmdGVyIHRoZSBzZWVkIGhhcyBiZWVuXHJcbiAgICAgKiBzZXQuIFRoZSByYW5kb20gbnVtYmVycyB3aWxsIGJlIHByZWRpY3RhYmxlIGFuZCByZXBlYXRhYmxlIGdpdmVuIHRoZSBzYW1lXHJcbiAgICAgKiBpbnB1dCBzZWVkLiBJZiBubyBzZWVkIGlzIHNwZWNpZmllZCwgdGhlbiBhIHJhbmRvbSBzZWVkIHdpbGwgYmUgYXNzaWduZWQgdG9cclxuICAgICAqIHRoZSByYW5kb20gbnVtYmVyIGdlbmVyYXRvciB1c2luZyBhZGRlZCBzeXN0ZW0gZW50cm9weS5cclxuICAgICAqIFxyXG4gICAgICogQGV4cG9ydFxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ8c3RyaW5nfSBbc2VlZD0wXSBUaGUgc2VlZCB0byBiZSBhcHBsaWVkIHRvIHRoZSBSTkdcclxuICAgICAqIFxyXG4gICAgICogQG1lbWJlcm9mIFJhbmRcclxuICAgICAqL1xyXG4gICAgc2V0U2VlZChzZWVkKSB7XHJcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgZW50cm9weTogc2VlZCA9PT0gdW5kZWZpbmVkXHJcbiAgICAgICAgfTtcclxuICAgICAgICB0aGlzLnJuZyA9IHNlZWRSYW5kb20oc2VlZCwgb3B0aW9ucyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgYSByYW5kb20gbnVtYmVyIGZyb20gMCB0byAxLiBcclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHJldHVybnMge251bWJlcn0gcmFuZG9tIG51bWJlciBmcm9tIDAgdG8gMVxyXG4gICAgICogXHJcbiAgICAgKiBAbWVtYmVyb2YgUmFuZFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgcmFuZCgpIHtcclxuICAgICAgICByZXR1cm4gTWF0aC5yYW5kb20oKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBhIHJhbmRvbSBudW1iZXIgZnJvbSAwIHRvIDEuXHJcbiAgICAgKiBcclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IHJhbmRvbSBudW1iZXIgZnJvbSAwIHRvIDFcclxuICAgICAqIFxyXG4gICAgICogQG1lbWJlcm9mIFJhbmRcclxuICAgICAqL1xyXG4gICAgcmFuZCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5ybmcoKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByaXZhdGUgSGVscGVyIEZ1bmN0aW9uOlxyXG4gICAgICogR2V0IGEgcmFuZG9tIGZsb2F0IHZhbHVlIGluIGEgcGFydGljdWxhciByYW5nZVxyXG4gICAgICogXHJcbiAgICAgKiBAcHJpdmF0ZVxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcclxuICAgICAqIEBwYXJhbSB7YW55fSBtaW4gXHJcbiAgICAgKiBAcGFyYW0ge2FueX0gbWF4IFxyXG4gICAgICogXHJcbiAgICAgKiBAbWVtYmVyb2YgUmFuZFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgX3JhbmRSYW5nZShybmcsIG1pbiwgbWF4KSB7XHJcbiAgICAgICAgcmV0dXJuIHJuZy5yYW5kKCkgKiAobWF4IC0gbWluKSArIG1pbjtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBhIHJhbmRvbSBmbG9hdCB2YWx1ZSBpbiBhIHBhcnRpY3VsYXIgcmFuZ2VcclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHthbnl9IG1pbiBcclxuICAgICAqIEBwYXJhbSB7YW55fSBtYXggXHJcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBSYW5kb20gZmxvYXQgbnVtYmVyIGZyb20gbWluIChpbmNsdXNpdmUpIFxyXG4gICAgICogIHRvIG1heCAoZXhjbHVzaXZlKVxyXG4gICAgICogXHJcbiAgICAgKiBAbWVtYmVyb2YgUmFuZFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgcmFuZFJhbmdlKG1pbiwgbWF4KSB7XHJcbiAgICAgICAgcmV0dXJuIFJhbmQuX3JhbmRSYW5nZShSYW5kLCBtaW4sIG1heCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgYSByYW5kb20gZmxvYXQgdmFsdWUgaW4gYSBwYXJ0aWN1bGFyIHJhbmdlXHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSB7YW55fSBtaW4gXHJcbiAgICAgKiBAcGFyYW0ge2FueX0gbWF4IFxyXG4gICAgICogQHJldHVybnMge251bWJlcn0gUmFuZG9tIGZsb2F0IG51bWJlciBmcm9tIG1pbiAoaW5jbHVzaXZlKSBcclxuICAgICAqICB0byBtYXggKGV4Y2x1c2l2ZSlcclxuICAgICAqIFxyXG4gICAgICogQG1lbWJlcm9mIFJhbmRcclxuICAgICAqL1xyXG4gICAgcmFuZFJhbmdlKG1pbiwgbWF4KSB7XHJcbiAgICAgICAgcmV0dXJuIFJhbmQuX3JhbmRSYW5nZSh0aGlzLCBtaW4sIG1heCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBQcml2YXRlIEhlbHBlciBGdW5jdGlvbjpcclxuICAgICAqIEdldCBhIHJhbmRvbSBpbnQgaW4gYSBwYXJ0aWN1bGFyIHJhbmdlIChtaW4gYW5kIG1heCBpbmNsdXNpdmUpXHJcbiAgICAgKiBcclxuICAgICAqIEBwcml2YXRlXHJcbiAgICAgKiBAc3RhdGljXHJcbiAgICAgKiBAcGFyYW0ge2FueX0gcm5nIFRoZSBsb2NhbCBvciBnbG9iYWwgcm5nIHRvIHVzZSAoUmFuZCBvciB0aGlzKVxyXG4gICAgICogQHBhcmFtIHthbnl9IG1pbiBcclxuICAgICAqIEBwYXJhbSB7YW55fSBtYXggXHJcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBSYW5kb20gZmxvYXQgbnVtYmVyIGZyb20gbWluIChpbmNsdXNpdmUpIFxyXG4gICAgICogIHRvIG1heCAoZXhjbHVzaXZlKVxyXG4gICAgICogXHJcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgX3JhbmRJbnQocm5nLCBtaW4sIG1heCkge1xyXG4gICAgICAgIHJldHVybiBNYXRoLmZsb29yKHJuZy5yYW5kKCkgKiAobWF4IC0gbWluICsgMSkpICsgbWluO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGEgcmFuZG9tIGludCBpbiBhIHBhcnRpY3VsYXIgcmFuZ2UgKG1pbiBhbmQgbWF4IGluY2x1c2l2ZSlcclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHthbnl9IG1pbiBcclxuICAgICAqIEBwYXJhbSB7YW55fSBtYXggXHJcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBSYW5kb20gZmxvYXQgbnVtYmVyIGZyb20gbWluIChpbmNsdXNpdmUpIFxyXG4gICAgICogIHRvIG1heCAoZXhjbHVzaXZlKVxyXG4gICAgICogXHJcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgcmFuZEludChtaW4sIG1heCkge1xyXG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSW50KFJhbmQsIG1pbiwgbWF4KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBhIHJhbmRvbSBpbnQgaW4gYSBwYXJ0aWN1bGFyIHJhbmdlIChtaW4gYW5kIG1heCBpbmNsdXNpdmUpXHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSB7YW55fSBtaW4gXHJcbiAgICAgKiBAcGFyYW0ge2FueX0gbWF4IFxyXG4gICAgICogQHJldHVybnMge251bWJlcn0gUmFuZG9tIGZsb2F0IG51bWJlciBmcm9tIG1pbiAoaW5jbHVzaXZlKSBcclxuICAgICAqICB0byBtYXggKGV4Y2x1c2l2ZSlcclxuICAgICAqIFxyXG4gICAgICogQG1lbWJlck9mIFJhbmRcclxuICAgICAqL1xyXG4gICAgcmFuZEludChtaW4sIG1heCkge1xyXG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSW50KHRoaXMsIG1pbiwgbWF4KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByaXZhdGUgSGVscGVyIEZ1bmN0aW9uOlxyXG4gICAgICogR2V0IHRoZSByYW5kb20gaGV4IHZhbHVlIG9mIGEgY29sb3IgcmVwcmVzZW50ZWQgaW4gdGhlIGhleGlkZWNpbWFsIGZvcm1hdFxyXG4gICAgICogXHJcbiAgICAgKiBAcHJpdmF0ZVxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcclxuICAgICAqIEByZXR1cm5zIHtoZXh9IFRoZSByYW5kb20gaGV4IHZhbHVlIGluIHRoZSBjb2xvciBzcGVjdHJ1bVxyXG4gICAgICogXHJcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgX3JhbmRIZXgocm5nKSB7XHJcbiAgICAgICAgcmV0dXJuIHJuZy5yYW5kSW50KDAsIDE2Nzc3MjE1KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCB0aGUgcmFuZG9tIGhleCB2YWx1ZSBvZiBhIGNvbG9yIHJlcHJlc2VudGVkIGluIHRoZSBoZXhpZGVjaW1hbCBmb3JtYXRcclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHJldHVybnMge2hleH0gXHJcbiAgICAgKiBcclxuICAgICAqIEBtZW1iZXJPZiBSYW5kXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyByYW5kSGV4KCkge1xyXG4gICAgICAgIHJldHVybiBSYW5kLl9yYW5kSGV4KFJhbmQpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IHRoZSByYW5kb20gaGV4IHZhbHVlIG9mIGEgY29sb3IgcmVwcmVzZW50ZWQgaW4gdGhlIGhleGlkZWNpbWFsIGZvcm1hdFxyXG4gICAgICogXHJcbiAgICAgKiBAcmV0dXJucyB7aGV4fSBcclxuICAgICAqIFxyXG4gICAgICogQG1lbWJlck9mIFJhbmRcclxuICAgICAqL1xyXG4gICAgcmFuZEhleCgpIHtcclxuICAgICAgICByZXR1cm4gUmFuZC5fcmFuZEhleCh0aGlzKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByaXZhdGUgSGVscGVyIEZ1bmN0aW9uOlxyXG4gICAgICogR2V0IGEgcmFuZG9tIGhleCBjb2xvciBzdHJpbmcgcmVwcmVzZW50ZWQgaW4gXCIjSEVYU1RSXCIgZm9ybWF0XHJcbiAgICAgKiBcclxuICAgICAqIEBwcml2YXRlXHJcbiAgICAgKiBAc3RhdGljXHJcbiAgICAgKiBAcGFyYW0ge2FueX0gcm5nIFRoZSBsb2NhbCBvciBnbG9iYWwgcm5nIHRvIHVzZSAoUmFuZCBvciB0aGlzKVxyXG4gICAgICogQHJldHVybnMge3N0cmluZ31cclxuICAgICAqIFxyXG4gICAgICogQG1lbWJlck9mIFJhbmRcclxuICAgICAqL1xyXG4gICAgc3RhdGljIF9yYW5kSGV4Q29sb3Iocm5nKSB7XHJcbiAgICAgICAgcmV0dXJuIFwiI1wiICsgcm5nLnJhbmRIZXgoKS50b1N0cmluZygxNik7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgYSByYW5kb20gaGV4IGNvbG9yIHN0cmluZyByZXByZXNlbnRlZCBpbiBcIiNIRVhTVFJcIiBmb3JtYXRcclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ31cclxuICAgICAqIFxyXG4gICAgICogQG1lbWJlck9mIFJhbmRcclxuICAgICAqL1xyXG4gICAgc3RhdGljIHJhbmRIZXhDb2xvcigpIHtcclxuICAgICAgICByZXR1cm4gUmFuZC5fcmFuZEhleENvbG9yKFJhbmQpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGEgcmFuZG9tIGhleCBjb2xvciBzdHJpbmcgcmVwcmVzZW50ZWQgaW4gXCIjSEVYU1RSXCIgZm9ybWF0XHJcbiAgICAgKiBcclxuICAgICAqIEBzdGF0aWNcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9XHJcbiAgICAgKiBcclxuICAgICAqIEBtZW1iZXJPZiBSYW5kXHJcbiAgICAgKi9cclxuICAgIHJhbmRIZXhDb2xvcigpIHtcclxuICAgICAgICByZXR1cm4gUmFuZC5fcmFuZEhleENvbG9yKHRoaXMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vLS0tLSBSYW5kb20gR2VvbWV0cnkgLS0tLVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGEgcmFuZG9tIHZlY3RvciBpbiBhIGJvdW5kaW5nIGJveFxyXG4gICAgICogXHJcbiAgICAgKiBAcHJpdmF0ZVxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHthbnl9IHJuZyBUaGUgbG9jYWwgb3IgZ2xvYmFsIHJuZyB0byB1c2UgKFJhbmQgb3IgdGhpcylcclxuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggb2YgdGhlIHJhbmRvbSB2ZWN0b3JcclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IEEgcmFuZG9tIHZlY3RvclxyXG4gICAgICogXHJcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgX3ZlY3RvcihybmcsIGJib3gpIHtcclxuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcihSYW5kLnJhbmRSYW5nZShiYm94LngsIGJib3gueCArIGJib3gud2lkdGgpLFxyXG4gICAgICAgICAgICBSYW5kLnJhbmRSYW5nZShiYm94LnksIGJib3gueSArIGJib3guaGVpZ2h0KSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgYSByYW5kb20gdmVjdG9yIGluIGEgYm91bmRpbmcgYm94XHJcbiAgICAgKiBcclxuICAgICAqIEBzdGF0aWNcclxuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggb2YgdGhlIHJhbmRvbSB2ZWN0b3JcclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IEEgcmFuZG9tIHZlY3RvclxyXG4gICAgICogXHJcbiAgICAgKiBAbWVtYmVyT2YgUmFuZFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgdmVjdG9yKGJib3gpIHtcclxuICAgICAgICByZXR1cm4gUmFuZC5fdmVjdG9yKFJhbmQsIGJib3gpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGEgcmFuZG9tIHZlY3RvciBpbiBhIGJvdW5kaW5nIGJveFxyXG4gICAgICogXHJcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gYmJveCBUaGUgYm91bmRpbmcgYm94IG9mIHRoZSByYW5kb20gdmVjdG9yXHJcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBBIHJhbmRvbSB2ZWN0b3JcclxuICAgICAqIFxyXG4gICAgICogQG1lbWJlck9mIFJhbmRcclxuICAgICAqL1xyXG4gICAgdmVjdG9yKGJib3gpIHtcclxuICAgICAgICByZXR1cm4gUmFuZC5fdmVjdG9yKHRoaXMsIGJib3gpO1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBSYW5kOyIsImNsYXNzIExpbmUgIHtcclxuICAgIC8qKlxyXG4gICAgICogQGNsYXNzIExpbmVcclxuICAgICAqIFxyXG4gICAgICogQSBzaW1wbGUgbGluZSBvYmplY3QgdGhhdCBpcyBhbiBhcnJheSBvZiB0d28gdmVjdG9yIHBvaW50cy5cclxuICAgICAqIFxyXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IHAxXHJcbiAgICAgKiBAcHJvcGVydHkge3ZlY3Rvcn0gcDJcclxuICAgICAqIFxyXG4gICAgICogQHN1bW1hcnkgQ3JlYXRlcyBhbiBpbnN0YW5jZSBvZiBQb2x5Z29uLlxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHAxIFRoZSBmaXJzdCBwb2ludFxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHAyIFRoZSBzZWNvbmQgcG9pbnRcclxuICAgICAqL1xyXG4gICAgY29uc3RydWN0b3IocDEsIHAyKSB7XHJcbiAgICAgICAgdGhpcy5wMSA9IHAxO1xyXG4gICAgICAgIHRoaXMucDIgPSBwMjtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIERldGVybWluZSB0aGUgb3JpZW50YXRpb24gb2YgdGhlIHRocmVlIGlucHV0IHZlY3RvcnMuIFRoZSBvdXRwdXQgd2lsbCBiZVxyXG4gICAgICogb25lIG9mIHRoZSBmb2xsb3dpbmc6XHJcbiAgICAgKiBjb3VudGVyY2xvY2t3aXNlLCBjbG9ja3dpc2UsIG9yIGNvbGxpbmVhclxyXG4gICAgICogXHJcbiAgICAgKiBAcHJpdmF0ZVxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYxIFRoZSBmaXJzdCB2ZWN0b3JcclxuICAgICAqIEBwYXJhbSB7VmVjb3RyfSB2MiBUaGUgc2Vjb25kIHZlY3RvclxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYzIFRoZSB0aGlyZCB2ZWN0b3JcclxuICAgICAqIEByZXR1cm4ge3N0cmluZ30gVGhlIG9yaWVudGF0aW9uIG9mIHRoZSB0aHJlZSBwb2ludHNcclxuICAgICAqICBcImNvdW50ZXJjbG9ja3dpc2VcIiwgXCJjbG9ja3dpc2VcIiwgXCJjb2xsaW5lYXJcIiBcclxuICAgICAqIEBtZW1iZXJvZiBMaW5lXHJcbiAgICAgKiBAc2VlIHtAbGluayBodHRwOi8vd3d3LmdlZWtzZm9yZ2Vla3Mub3JnL2NoZWNrLWlmLXR3by1naXZlbi1saW5lLXNlZ21lbnRzLWludGVyc2VjdC99XHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBfb3JpZW50YXRpb24odjEsIHYyLCB2Mykge1xyXG4gICAgICAgIGNvbnN0IHZhbCA9ICh2Mi55IC0gdjEueSkgKiAodjMueCAtIHYyLngpIC1cclxuICAgICAgICAgICAgKHYyLnggLSB2MS54KSAqICh2My55IC0gdjIueSk7XHJcblxyXG4gICAgICAgIGlmICh2YWwgPT09IDApIHtcclxuICAgICAgICAgICAgcmV0dXJuIFwiQ29sbGluZWFyXCJcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHZhbCA+IDAgPyBcImNsb2Nrd2lzZVwiIDogXCJjb3VudGVyY2xvY2t3aXNlXCI7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBQcml2YXRlIGhlbHBlciBmdW5jdGlvbiB0byBpbnRlcnNlY3RzIGZ1bmN0aW9uLlxyXG4gICAgICogXHJcbiAgICAgKiBHaXZlbiB0aHJlZSBjb2xpbmVhciBwb2ludHMgdGhpcyBmdW5jdGlvbiBjaGVja3MgaWYgdjIgaXMgb24gdGhlIGxpbmUgc2VnbWVudFxyXG4gICAgICogdjEtdjMuXHJcbiAgICAgKiBcclxuICAgICAqIEBwcml2YXRlXHJcbiAgICAgKiBAc3RhdGljXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdjEgVGhlIGZpcnN0IHBvaW50IGluIHRoZSBsaW5lIHNlZ21lbnRcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MiBUaGUgcG9pbnQgdG8gdGVzdCBpZiBpdCBpcyBpbiB0aGUgbWlkZGxlXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdjMgVGhlIHNlY29uZCBwb2ludCBpbiB0aGUgbGluZSBzZWdtZW50XHJcbiAgICAgKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHYyIGxpZXMgb24gdGhlIHNlZ21lbnQgY3JlYXRlZCBieSB2MSAmIHYzXHJcbiAgICAgKiBAbWVtYmVyb2YgTGluZVxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgX29uU2VnbWVudCh2MSwgdjIsIHYzKSB7XHJcbiAgICAgICAgcmV0dXJuIHYyLnggPD0gTWF0aC5tYXgodjEueCwgdjMueCkgJiYgdjIueCA+PSBNYXRoLm1pbih2MS54LCB2My54KSAmJlxyXG4gICAgICAgICAgICB2Mi55IDw9IE1hdGgubWF4KHYxLnksIHYzLnkpICYmIHYyLnkgPj0gTWF0aC5taW4odjEueSwgdjMueSlcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIERldGVybWluZSBpZiB0d28gbGluZSBzZWdtZW50cyBpbnRlcnNlY1xyXG4gICAgICogXHJcbiAgICAgKiBAc3RhdGljXHJcbiAgICAgKiBAcGFyYW0ge0xpbmV9IGxpbmUxIFxyXG4gICAgICogQHBhcmFtIHtMaW5lfSBsaW5lMiBcclxuICAgICAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIGxpbmVzIGludGVyc2VjdFxyXG4gICAgICogQG1lbWJlcm9mIExpbmVcclxuICAgICAqIEBzZWUge0BsaW5rIGh0dHA6Ly93d3cuZ2Vla3Nmb3JnZWVrcy5vcmcvY2hlY2staWYtdHdvLWdpdmVuLWxpbmUtc2VnbWVudHMtaW50ZXJzZWN0L31cclxuICAgICAqL1xyXG4gICAgc3RhdGljIGludGVyc2VjdHMobGluZTEsIGxpbmUyKSB7XHJcbiAgICAgICAgLy8gRmluZCB0aGUgZm91ciBvcmllbnRhdGlvbnMgdGhhdCBhcmUgbmVlZGVkIGZvciBnZW5lcmFsIGFuZFxyXG4gICAgICAgIC8vIHNwZWNpYWwgY2FzZXNcclxuICAgICAgICBjb25zdCBvMSA9IExpbmUuX29yaWVudGF0aW9uKGxpbmUxLnAxLCBsaW5lMS5wMiwgbGluZTIucDEpO1xyXG4gICAgICAgIGNvbnN0IG8yID0gTGluZS5fb3JpZW50YXRpb24obGluZTEucDEsIGxpbmUxLnAyLCBsaW5lMi5wMik7XHJcbiAgICAgICAgY29uc3QgbzMgPSBMaW5lLl9vcmllbnRhdGlvbihsaW5lMi5wMSwgbGluZTIucDIsIGxpbmUxLnAxKTtcclxuICAgICAgICBjb25zdCBvNCA9IExpbmUuX29yaWVudGF0aW9uKGxpbmUyLnAxLCBsaW5lMi5wMiwgbGluZTEucDIpO1xyXG5cclxuICAgICAgICAvLyBHZW5lcmFsIENhc2VcclxuICAgICAgICBpZiAobzEgIT0gbzIgJiYgbzMgIT0gbzQpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBTcGVjaWFsIENhc2VzXHJcbiAgICAgICAgLy8gbGluZTEueCwgbGluZTEueSBhbmQgbGluZTIueCBhcmUgY29saW5lYXIgYW5kXHJcbiAgICAgICAgLy8gbGluZTIueCBsaWVzIG9uIHNlZ21lbnQgbGluZTEueGxpbmUxLnlcclxuICAgICAgICBpZiAobzEgPT0gXCJDb2xsaW5lYXJcIiAmJiBMaW5lLl9vblNlZ21lbnQobGluZTEucDEsIGxpbmUyLnAxLCBsaW5lMS5wMikpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBsaW5lMS54LCBsaW5lMS55IGFuZCBsaW5lMi54IGFyZSBjb2xpbmVhciBhbmRcclxuICAgICAgICAvLyBsaW5lMi55IGxpZXMgb24gc2VnbWVudCBsaW5lMS54bGluZTEueVxyXG4gICAgICAgIGlmIChvMiA9PSBcIkNvbGxpbmVhclwiICYmIExpbmUuX29uU2VnbWVudChsaW5lMS5wMSwgbGluZTIucDIsIGxpbmUxLnAyKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIGxpbmUyLngsIGxpbmUyLnkgYW5kIGxpbmUxLnggYXJlIGNvbGluZWFyIGFuZFxyXG4gICAgICAgIC8vIGxpbmUxLnggbGllcyBvbiBzZWdtZW50IGxpbmUyLnhsaW5lMi55XHJcbiAgICAgICAgaWYgKG8zID09IFwiQ29sbGluZWFyXCIgJiYgTGluZS5fb25TZWdtZW50KGxpbmUyLnAxLCBsaW5lMS5wMSwgbGluZTIucDIpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gbGluZTIueCwgbGluZTIueSBhbmQgbGluZTEueSBhcmUgY29saW5lYXIgYW5kXHJcbiAgICAgICAgLy8gbGluZTEueSBsaWVzIG9uIHNlZ21lbnQgbGluZTIueGxpbmUyLnlcclxuICAgICAgICBpZiAobzQgPT0gXCJDb2xsaW5lYXJcIiAmJiBMaW5lLl9vblNlZ21lbnQobGluZTIucDEsIGxpbmUxLnAyLCBsaW5lMi5wMikpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gZmFsc2U7IC8vIERvZXNuJ3QgZmFsbCBpbiBhbnkgb2YgdGhlIGFib3ZlIGNhc2VzXHJcblxyXG4gICAgfVxyXG5cclxuICAgIGludGVyc2VjdHMobGluZTEsIGxpbmUyKSB7XHJcbiAgICAgICAgcmV0dXJuIExpbmUuaW50ZXJzZWN0cyhsaW5lMSwgbGluZTIpO1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBMaW5lOyIsImltcG9ydCBWZWN0b3IgZnJvbSBcIi4vVmVjdG9yXCI7XHJcblxyXG5jbGFzcyBQb2x5Z29uIHtcclxuICAgIC8qKlxyXG4gICAgICogQGNsYXNzIFBvbHlnb25cclxuICAgICAqIFxyXG4gICAgICogQ2xhc3MgdG8gc3RvcmUgcG9seWdvbiBpbmZvcm1hdGlvbiBpbiBhbiBhcnJheSBmb3JtYXQgdGhhdCBhbHNvIGdpdmVzIGl0XHJcbiAgICAgKiBleHRyYSBmdW5jdGlvbmFsaXR5IG9uIHRvcCBvZiBpdC4gVGhpcyBjYW4gYWxzbyBzZXJ2ZXIgYXMgYSBiYXNlIGNsYXNzXHJcbiAgICAgKiBmb3IgbW9yZSBzcGVjaWZpYyBnZW9tZXRyaWMgc2hhcGVzLiBBdCB0aGUgbW9tZW50IHRoaXMgY2xhc3MgYXNzdW1lcyBvbmx5XHJcbiAgICAgKiBjb252ZXggcG9seWdvbnMgZm9yIHNpbXBsaWNpdHkuXHJcbiAgICAgKiBcclxuICAgICAqIEBzdW1tYXJ5IENyZWF0ZXMgYW4gaW5zdGFuY2Ugb2YgUG9seWdvbi5cclxuICAgICAqIFxyXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IGNlbnRlciBUaGUgY2VudGVyIG9mIHRoZSBwb2x5Z29uLiBJZiBub3Qgb3RoZXJ3aXNlXHJcbiAgICAgKiAgc3RhdGVkLCB0aGUgY2VudGVyIGRlZmF1bHRzIHRvIHRoZSBjZW50cmlvZC4gQW55IHRyYW5zZm9ybWF0aW9ucyBvblxyXG4gICAgICogIHRoZSBwb2x5Z29uIGFyZSBkb25lIGFib3V0IHRoZSBjZW50ZXIgb2YgdGhlIHBvbHlnb24uXHJcbiAgICAgKiBAcHJvcGVydHkge1ZlY3RvcltdfSBjb3JuZXJzIFRoZSBjb3JuZXIgdmVjdG9ycyBvZiB0aGUgcG9seWdvblxyXG4gICAgICogXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3RvcltdfSBbdmVydGljaWVzPVtdXSBUaGUgY29ybmVyIHZlcnRpY2llcyBvZiB0aGUgcG9seWdvblxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IFtjZW50ZXI9YXZlcmFnZSh2ZXJ0aWNpZXMpXSBUaGUgY2VudGVyIG9mIHRoZSBwb2x5Z29uLlxyXG4gICAgICogIElmIGEgdmFsdWUgaXMgbm90IHByb3ZpZGVkIHRoZSBkZWZhdWx0IHZhbHVlIGJlY29tZXMgdGhlIGNlbnRyb2lkIG9mXHJcbiAgICAgKiAgdGhlIHZlcnRpY2llcy5cclxuICAgICAqL1xyXG4gICAgY29uc3RydWN0b3IodmVydGljaWVzID0gbnVsbCwgY2VudGVyID0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuY29ybmVycyA9IHZlcnRpY2llcyA/IHZlcnRpY2llcyA6IFtdO1xyXG4gICAgICAgIHRoaXMuY2VudGVyID0gY2VudGVyID8gY2VudGVyIDogdGhpcy5jZW50cm9pZCgpO1xyXG4gICAgICAgIHRoaXMuX2Jib3ggPSBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IHRoZSBjZW50cm9pZCBvZiB0aGUgcG9seWdvbi4gVGhpcyBpcyB0aGUgdmVjdG9yIGF2ZXJhZ2Ugb2YgYWxsIHRoZVxyXG4gICAgICogcG9pbnRzIHRoYXQgbWFrZSB1cCB0aGUgcG9seWdvbi5cclxuICAgICAqIFxyXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIGNlbnRyb2lkIG9mIHRoZSBwb2x5Z29uXHJcbiAgICAgKiBcclxuICAgICAqIEBtZW1iZXJPZiBQb2x5Z29uXHJcbiAgICAgKi9cclxuICAgIGNlbnRyb2lkKCkge1xyXG4gICAgICAgIHJldHVybiBWZWN0b3IuYXZnKHRoaXMuY29ybmVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgdGhlIGJvdW5kaW5nIGJveCBvZiB0aGUgcG9seWdvbi4gVGhhdCBpcyB0aGUgcmVjdGFuZ2xlIHRoYXQgd2lsbFxyXG4gICAgICogbWluaW1hbGx5IGVuY2xvc2UgdGhlIHBvbHlnb24uXHJcbiAgICAgKiBcclxuICAgICAqIEByZXR1cm5zIHtSZWN0YW5nbGV9IFRoZSBib3VuZGluZyBib3ggb2YgdGhlIHBvbHlnb25cclxuICAgICAqIEBtZW1iZXJvZiBQb2x5Z29uXHJcbiAgICAgKi9cclxuICAgIGJib3goKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2Jib3gpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2Jib3g7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBsZXQgbWluWCA9IEluZmluaXR5O1xyXG4gICAgICAgIGxldCBtYXhYID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5ZID0gSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1heFkgPSAtSW5maW5pdHk7XHJcblxyXG4gICAgICAgIGZvciAoY29uc3QgY29ybmVyIG9mIHRoaXMuY29ybmVycykge1xyXG4gICAgICAgICAgICBtaW5YID0gTWF0aC5taW4oY29ybmVyLngsIG1pblgpO1xyXG4gICAgICAgICAgICBtYXhYID0gTWF0aC5tYXgoY29ybmVyLngsIG1heFgpO1xyXG4gICAgICAgICAgICBtaW5ZID0gTWF0aC5taW4oY29ybmVyLnksIG1pbnkpO1xyXG4gICAgICAgICAgICBtYXhZID0gTWF0aC5tYXgoY29ybmVyLnksIG1heHkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy5fYmJveCA9IG5ldyBSZWN0YW5nbGUobWlueCwgbWlueSwgbWF4WCAtIG1pblgsIG1heFksIG1pblkpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fYmJveDtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCB0aGUgcG9seWdvbiBpbnNldCBvZiB0aGUgY3VycmVudCBwb2x5Z29uIGJ5IHRoZSBpbnB1dCBhbW1vdW50XHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSBhbW1vdW50XHJcbiAgICAgKiBAcmV0dXJucyB7UG9seWdvbn0gVGhlIGluc2V0IG9mIHRoZSBjdXJyZW50IHBvbHlnb24gYnlcclxuICAgICAqIEBtZW1iZXJPZiBQb2x5Z29uXHJcbiAgICAgKi9cclxuICAgIGluc2V0KGFtbW91bnQpIHtcclxuICAgICAgICByZXR1cm4gYW1tb3VudDtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFJldHVybnMgd2hlaXRoZXIgb3Igbm90IHRoaXMgcG9seWdvbiBpcyBhIGNvbnZleCBwb2x5Z29uLiBJZiB0aGlzIGlzXHJcbiAgICAgKiBub3QgdHJ1ZSB0aGVuIHRoZSBwb2x5Z29uIGlzIGNvbnZhY2Ugb3IgbW9yZSBjb21wbGV4LlxyXG4gICAgICogXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gSWYgdGhlIHBvbHlnb24gaXMgY29udmV4XHJcbiAgICAgKiBAbWVtYmVyT2YgUG9seWdvblxyXG4gICAgICovXHJcbiAgICBpc0NvbnZleCgpIHtcclxuXHJcbiAgICB9XHJcblxyXG4gICAgcm90YXRlKCkge1xyXG5cclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgUG9seWdvbjsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuL1ZlY3RvclwiO1xyXG5pbXBvcnQgUG9seWdvbiBmcm9tIFwiLi9Qb2x5Z29uXCI7XHJcblxyXG5jbGFzcyBSZWN0YW5nbGUgZXh0ZW5kcyBQb2x5Z29uIHtcclxuICAgIC8qKiBcclxuICAgICAqIEBjbGFzcyBSZWN0YW5nbGVcclxuICAgICAqIEBleHRlbmRzIFBvbHlnb25cclxuICAgICAqIFxyXG4gICAgICogQ2xhc3MgdG8gc3RvcmUgYXJyYXkgaW5mb3JtYXRpb24gYWJvdXQgYSByZWN0YW5nbGVcclxuICAgICAqIFxyXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IHBvc2l0aW9uXHJcbiAgICAgKiBAcHJvcGVydHkge251bWJlcn0geFxyXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IHlcclxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB3aWR0aFxyXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IGhlaWdodFxyXG4gICAgICogXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gcG9zaXRpb25cclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSB3aWR0aFxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IGhlaWdodFxyXG4gICAgICovXHJcblxyXG4gICAgY29uc3RydWN0b3IocG9zaXRpb24sIHdpZHRoLCBoZWlnaHQpIHtcclxuICAgICAgICBjb25zdCBwb2ludHMgPSBbcG9zaXRpb24sXHJcbiAgICAgICAgICAgIFZlY3Rvci5hZGQocG9zaXRpb24sIG5ldyBWZWN0b3Iod2lkdGgsIDApKSxcclxuICAgICAgICAgICAgVmVjdG9yLmFkZChwb3NpdGlvbiwgbmV3IFZlY3Rvcih3aWR0aCwgaGVpZ2h0KSksXHJcbiAgICAgICAgICAgIFZlY3Rvci5hZGQocG9zaXRpb24sIG5ldyBWZWN0b3IoMCwgaGVpZ2h0KSlcclxuICAgICAgICBdO1xyXG4gICAgICAgIHN1cGVyKHBvaW50cyk7XHJcblxyXG4gICAgICAgIHRoaXMucG9zaXRpb24gPSBwb3NpdGlvbjtcclxuICAgICAgICB0aGlzLnggPSBwb3NpdGlvbi54O1xyXG4gICAgICAgIHRoaXMueSA9IHBvc2l0aW9uLnk7XHJcbiAgICAgICAgdGhpcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgICAgIHRoaXMuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgICAgIHRoaXMuYXJlYSA9IHdpZHRoICogaGVpZ2h0O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRGV0ZXJtaW5lIGlmIHRoZSB0d28gcmVjdGFuZ2xlcyBhcmUgaW50ZXJzZWN0aW5nLCBpZiB0aGUgc2VnbWVudHMgb3ZlcmxhcFxyXG4gICAgICogZWFjaG90aGVyLlxyXG4gICAgICogXHJcbiAgICAgKiBAc3RhdGljXHJcbiAgICAgKiBAcGFyYW0ge2FueX0gcmVjdDEgVGhlIGZpcnN0IHJlY3RhbmdsZVxyXG4gICAgICogQHBhcmFtIHthbnl9IHJlY3QyIFRoZSBzZWNvbmQgcmVjdGFuZ2xlXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgdHdvIHJlY3RhbmdsZXMgaW50ZXJzZWN0XHJcbiAgICAgKiBAbWVtYmVyb2YgUmVjdGFuZ2xlXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBpbnRlcnNlY3RzKHJlY3QxLCByZWN0Mikge1xyXG4gICAgICAgIHJldHVybiByZWN0MS54IDw9IHJlY3QyLnggKyByZWN0Mi53aWR0aCAmJlxyXG4gICAgICAgICAgICAgICByZWN0Mi54IDw9IHJlY3QxLnggKyByZWN0MS53aWR0aCAmJlxyXG4gICAgICAgICAgICAgICByZWN0MS55IDw9IHJlY3QyLnkgKyByZWN0Mi5oZWlnaHQgJiZcclxuICAgICAgICAgICAgICAgcmVjdDIueSA8PSByZWN0MS55ICsgcmVjdDEuaGVpZ2h0O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRGV0ZXJtaW5lIGlmIHRoaXMgcmVjdGFuZ2xlIGlzIGludGVyc2VjdGluZyB0aGUgb3RoZXIgcmVjdGFuZ2xlLlxyXG4gICAgICogRGV0ZXJtaW5lcyBpZiB0aGUgcmVjdGFuZ2xlcyBzZWdtZW50cyBvdmVybGFwIGVhY2hvdGhlci5cclxuICAgICAqIFxyXG4gICAgICogQHBhcmFtIHtSZWN0YW5nbGV9IG90aGVyIFRoZSBvdGhlciByZWN0YW5nbGVcclxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSByZWN0YW5nbGVzIGFyZSBpbnRlcnNlY3RpbmdcclxuICAgICAqIEBtZW1iZXJvZiBSZWN0YW5nbGVcclxuICAgICAqL1xyXG4gICAgaW50ZXJzZWN0cyhvdGhlcikge1xyXG4gICAgICAgIHJldHVybiBSZWN0YW5nbGUuaW50ZXJzZWN0cyh0aGlzLCBvdGhlcik7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBEZXRlcm1pbmUgaWYgdHdvIHJlY3RhbmdsZXMgY29sbGlkZSB3aXRoIGVhY2hvdGhlci4gVGhpcyBpcyB0cnVlIHdoZW4gdHdvXHJcbiAgICAgKiByZWN0YW5nbGVzIGludGVyc2VjdCBlYWNob3RoZXIgb3Igb25lIG9mIHRoZSByZWN0YW5nbGVzIGlzIGNvbnRhaW5lZFxyXG4gICAgICogd2l0aW4gYW5vdGhlciByZWN0YW5nbGUuXHJcbiAgICAgKiBcclxuICAgICAqIEBzdGF0aWNcclxuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSByZWN0MSBUaGUgZmlyc3QgcmVjdGFuZ2xlXHJcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gcmVjdDIgVGhlIHNlY29uZCByZWN0YW5nbGVcclxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSB0d28gcmVjdGFuZ2xlcyBjb2xsaWRlIHdpdGggZWFjaG90aGVyXHJcbiAgICAgKiBAbWVtYmVyb2YgUmVjdGFuZ2xlXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBjb2xsaWRlcyhyZWN0MSwgcmVjdDIpIHtcclxuICAgICAgICByZXR1cm4gcmVjdDEueCA8IHJlY3QyLnggKyByZWN0Mi53aWR0aCAmJlxyXG4gICAgICAgICAgICAgICByZWN0MS54ICsgcmVjdDEud2lkdGggPiByZWN0Mi54ICYmXHJcbiAgICAgICAgICAgICAgIHJlY3QxLnkgPCByZWN0Mi55ICsgcmVjdDIuaGVpZ2h0ICYmXHJcbiAgICAgICAgICAgICAgIHJlY3QxLmhlaWdodCArIHJlY3QxLnkgPiByZWN0Mi55XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBEZXRlcm1pbmUgaWYgdGhpcyByZWN0YW5nbGUgY29sbGlkZXMgd2l0aCBhbm90aGVyIHJlY3RhbmdsZS4gVGhpcyBpcyB0cnVlXHJcbiAgICAgKiB3aGVuIHR3byByZWN0YW5nbGVzIGludGVyc2VjdCBlYWNob3RoZXIgb3Igb25lIG9mIHRoZSByZWN0YW5nbGVzIGlzIFxyXG4gICAgICogY29udGFpbmVkIHdpdGluIGFub3RoZXIgcmVjdGFuZ2xlLlxyXG4gICAgICogXHJcbiAgICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gb3RoZXIgVGhlIG90aGVyIHJlY3RhbmdsZVxyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdGhlIHR3byByZWN0YW5nbGVzIGNvbGxpZGUgd2l0aCBlYWNob3RoZXJcclxuICAgICAqIEBtZW1iZXJvZiBSZWN0YW5nbGVcclxuICAgICAqL1xyXG4gICAgY29sbGlkZXMob3RoZXIpIHtcclxuICAgICAgICByZXR1cm4gUmVjdGFuZ2xlLmNvbGxpZGVzKHRoaXMsIG90aGVyKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIERldGVybWluZSBpZiBhIHBvaW50IGlzIGNvbnRhaW5lZCB3aXRoaW4gdGhlIHJlY3RhbmdsZS5cclxuICAgICAqIFxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHZlY3RvciBUaGUgcG9pbnQgdG8gYmUgdGVzdGVkXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcG9pbnQgaXMgY29udGFpbmVkIHdpdGhpbiBcclxuICAgICAqIEBtZW1iZXJvZiBSZWN0YW5nbGVcclxuICAgICAqL1xyXG4gICAgY29udGFpbnModmVjdG9yKSB7XHJcbiAgICAgICAgcmV0dXJuIHZlY3Rvci54ID4gdGhpcy5wb3NpdGlvbi54ICYmXHJcbiAgICAgICAgICAgICAgIHZlY3Rvci54IDwgdGhpcy5wb3NpdGlvbi54ICsgdGhpcy53aWR0aCAmJlxyXG4gICAgICAgICAgICAgICB2ZWN0b3IueSA+IHRoaXMucG9zaXRpb24ueSAmJlxyXG4gICAgICAgICAgICAgICB2ZWN0b3IueSA8IHRoaXMucG9zaXRvaW4ueSArIHRoaXMuaGVpZ2h0O1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBSZWN0YW5nbGU7IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi9WZWN0b3JcIjtcclxuaW1wb3J0IFBvbHlnb24gZnJvbSBcIi4vUG9seWdvblwiO1xyXG5cclxuY2xhc3MgVHJpYW5nbGUgZXh0ZW5kcyBQb2x5Z29uIHtcclxuICAgIC8qKiBcclxuICAgICAqIEBjbGFzcyBUcmlhbmdsZVxyXG4gICAgICogQGV4dGVuZHMgUG9seWdvblxyXG4gICAgICogXHJcbiAgICAgKiBDbGFzcyB0byBzdG9yZSBhcnJheSBpbmZvcm1hdGlvbiBhYm91dCBhIHJlY3RhbmdsZVxyXG4gICAgICogXHJcbiAgICAgKiBAcHJvcGVydHkge1ZlY3Rvcn0gdmVydGljaWVzIFRoZSB0aHJlZSB2ZXJ0aWNpZXNcclxuICAgICAqIFxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYxIFRoZSBmaXJzdCBwb3NpdGlvblxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IHYyIFRoZSBzZWNvbmQgcG9zaXRpb25cclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2MyBUaGUgdGhpcmQgcG9zaXRpb25cclxuICAgICAqL1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKHYxLCB2MiwgdjMpIHtcclxuICAgICAgICB2YXIgdmVydGljaWVzID0gW3YxLCB2MiwgdjNdO1xyXG4gICAgICAgIHN1cGVyKHZlcnRpY2llcyk7XHJcbiAgICAgICAgdGhpcy52MSA9IHYxO1xyXG4gICAgICAgIHRoaXMudjIgPSB2MjtcclxuICAgICAgICB0aGlzLnYzID0gdjM7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IFRyaWFuZ2xlOyIsImNsYXNzIFZlY3RvciB7XHJcbiAgICAvKipcclxuICAgICAqIEBjbGFzcyBWZWN0b3JcclxuICAgICAqIFxyXG4gICAgICogVGhpcyBpcyBhIGJhc2ljIHZlY3RvciBjbGFzcyB0aGF0IGlzIHVzZWQgZm9yIGdlb21ldHJ5LCBwb3NpdGlvbiBpbmZvcmFtdGlvbixcclxuICAgICAqIG1vdmVtZW50IGluZm9tYXRpb24sIGFuZCBtb3JlIGNvbXBsZXggc3RydWN0dXJlcy5cclxuICAgICAqIFRoZSB2ZWN0b3IgY2xhc3MgZm9sbG93cyBhIGltbXV0YWJsZSBwYXJhZGlnbSB3aGVyZSBjaGFuZ2VzIGFyZSBub3QgbWFkZSB0byB0aGVcclxuICAgICAqIHZlY3RvcnMgdGhlbXNlbHZlcy4gQW55IGNoYW5nZSB0byBhIHZlY3RvciBpcyByZXR1cm5lZCBhcyBhIG5ldyB2ZWN0b3IgdGhhdFxyXG4gICAgICogbXVzdCBiZSBjYXB0dXJlZC4gXHJcbiAgICAgKiBcclxuICAgICAqIEBkZXNjcmlwdGlvbiBUaGlzIHZlY3RvciBjbGFzcyB3YXMgY29uc3RydWN0ZWQgc28gdGhhdCBpdCBjYW4gbWlycm9yIHR3byB0eXBlcyBvZiBjb21tb25cclxuICAgICAqIHBvaW50L3ZlY3RvciB0eXBlIG9iamVjdHMuIFRoaXMgaXMgaGF2aW5nIG9iamVjdCBwcm9wZXJ0aWVzIHN0b3JlZCBhcyBvYmplY3RcclxuICAgICAqIHByb3BlcnRpZXMgKGVnLiB2ZWN0b3IueCwgdmVjdG9yLnkpIG9yIGFzIGxpc3QgcHJvcGVydGllcywgW3gsIHldIHdoaWNoIGNhblxyXG4gICAgICogYmUgYWNjZXNzZWQgYnkgdmVjdG9yWzBdLCBvciB2ZWN0b3JbMV0uXHJcbiAgICAgKiBcclxuICAgICAqIEBzdW1tYXJ5IENyZWF0ZSBhIDJEIFZlY3RvciBvYmplY3RcclxuICAgICAqIFxyXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IHggVGhlIHggdmVjdG9yIGNvbXBvbmVudFxyXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IHkgVGhlIHkgdmVjdG9yIGNvbXBvbmVudFxyXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IDAgVGhlIHggdmVjdG9yIGNvbXBvbmVudFxyXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IDEgVGhlIHkgdmVjdG9yIGNvbXBvbmVudFxyXG4gICAgICogXHJcbiAgICAgKiBAcGFyYW0ge251bWJlcnxWZWN0b3J9IHggVGhlIHggY29tcG9uZW50IG9yIGFub3RoZXIgdmVjdG9yXHJcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gW3ldIFRoZSB5IGNvbXBvbmVudFxyXG4gICAgICovXHJcbiAgICBjb25zdHJ1Y3Rvcih4LCB5KSB7XHJcbiAgICAgICAgaWYgKHggaW5zdGFuY2VvZiBWZWN0b3IgfHwgKHgueCAmJiB4LnkpICYmICF5KSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3NldCh4LngsIHgueSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5fc2V0KHgsIHkpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLy0tLS0gSGVscGVyIEZ1bmN0aW9ucyAtLS0tXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBJbnRlcm5hbCBIZWxwZXIgRnVuY3Rpb24gZm9yIHNldHRpbmcgdmFyaWFibGUgcHJvcGVydGllc1xyXG4gICAgICogXHJcbiAgICAgKiBAcHJpdmF0ZVxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHggVGhlIHggY29tcG9uZW50XHJcbiAgICAgKiBAcGFyYW0ge251bWJlcn0geSBUaGUgeSBjb21wb25lbnRcclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcclxuICAgICAqL1xyXG4gICAgX3NldCh4LCB5KSB7XHJcbiAgICAgICAgdGhpcy5fX3Byb3RvX19bMF0gPSB4O1xyXG4gICAgICAgIHRoaXMuX19wcm90b19fWzFdID0geTtcclxuICAgICAgICB0aGlzLnggPSB4O1xyXG4gICAgICAgIHRoaXMueSA9IHk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgdGhlIHZlY3RvciBrZXk6U3ltYm9sIHJlcHJlc2VudGF0aW9uXHJcbiAgICAgKiBcclxuICAgICAqIEByZXR1cm5zIHtTeW1ib2x9IFRoZSB2ZWN0b3Iga2V5IGVsZW1lbnRcclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcclxuICAgICAqL1xyXG4gICAga2V5KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLmxpc3QoKTtcclxuICAgICAgICAvLyByZXR1cm4gU3ltYm9sKHRoaXMubGlzdCgpKTsgLy8gTm90IGN1cnJlbnRseSB3b3JraW5nIGFzIGEga2V5IHN5bWJvbFxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IHRoZSB2ZWN0b3IgaW4gbGlzdCBmb3JtXHJcbiAgICAgKiBcclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJbXX0gTGlzdCByZXByZXNlbnRhdGlvbiBvZiB0aGUgdmVjdG9yIG9mIGxlbmd0aCAyXHJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXHJcbiAgICAgKi9cclxuICAgIGxpc3QoKSB7XHJcbiAgICAgICAgcmV0dXJuIFt0aGlzLngsIHRoaXMueV07XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBSZXR1cm5zIHRoZSB2ZWN0b3IgYXMgYSBzdHJpbmcgb2YgKHgsIHkpXHJcbiAgICAgKiBcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSBzdHJpbmcgcmVwcmVzZW50YXRpb24gb2YgYSB2ZWN0b3IgaW4gKHgsIHkpIGZvcm1cclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcclxuICAgICAqL1xyXG4gICAgdG9TdHJpbmcoKSB7XHJcbiAgICAgICAgcmV0dXJuIGAoJHt0aGlzLnh9LCAke3RoaXMueX0pYDtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBhIGNvcHkgb2YgdGhlIGlucHV0IHZlY3RvclxyXG4gICAgICogXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gdiB0aGUgdmVjdG9yIHRvIGJlIGNvcHBpZWRcclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSB2ZWN0b3IgY29weVxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgY29weSh2KSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3Iodi54LCB2LnkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUmV0dXJucyB0aGUgdmVjdG9yIGFzIGEgc3RyaW5nIG9mICh4LCB5KVxyXG4gICAgICogXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgc3RyaW5nIHJlcHJlc2VudGF0aW9uIG9mIGEgdmVjdG9yIGluICh4LCB5KSBmb3JtXHJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXHJcbiAgICAgKi9cclxuICAgIHRvU3RyaW5nKCkge1xyXG4gICAgICAgIHJldHVybiBgKCR7dGhpcy54fSwgJHt0aGlzLnl9KWA7XHJcbiAgICB9XHJcblxyXG4gICAgLy8tLS0tIEJhc2ljIE1hdGggRnVuY3Rpb25zIC0tLS1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEFkZCB0d28gdmVjdG9ycyBlbGVtZW50IHdpc2VcclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSB2ZWN0b3IgcmVzdWx0IG9mIGFkZGluZyB0aGUgdHdvIHZlY3RvcnNcclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcclxuICAgICAqL1xyXG4gICAgc3RhdGljIGFkZChhLCBiKSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoYS54ICsgYi54LCBhLnkgKyBiLnkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQWRkIHRoaXMgdmVjdG9yIHdpdGggYW5vdGhlciB2ZWN0b3IgZWxlbWVudCB3aXNlXHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBvdGhlciBUaGUgb3RoZXIgdmVjdG9yXHJcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgdmVjdG9yIHJlc3VsdCBvZiBhZGRpbmcgdGhlIHR3byB2ZWN0b3JzXHJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXHJcbiAgICAgKi9cclxuICAgIGFkZChvdGhlcikge1xyXG4gICAgICAgIHJldHVybiBWZWN0b3IuYWRkKHRoaXMsIG90aGVyKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFN1YnRyYWN0IHR3byB2ZWN0b3JzIGVsZW1lbnQgd2lzZVxyXG4gICAgICogXHJcbiAgICAgKiBAc3RhdGljXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYSBUaGUgZmlyc3QgdmVjdG9yXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIFZlY3RvclxyXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIHZlY3RvciByZXN1bHQgb2Ygc3VidHJhY3RpbmcgdGhlIHR3byB2ZWN0b3JzXHJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBzdWJ0cmFjdChhLCBiKSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoYS54IC0gYi54LCBhLnkgLSBiLnkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU3VidHJhY3QgdGhpcyB2ZWN0b3Igd2l0aCBhbm90aGVyIHZlY3RvciBlbGVtZW50IHdpc2VcclxuICAgICAqIFxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IG90aGVyIFRoZSBvdGhlciB2ZWN0b3JcclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFRoZSB2ZWN0b3IgcmVzdWx0IG9mIHN1YnRyYWN0aW5nIHRoZSB0d28gdmVjdG9yc1xyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBzdWJ0cmFjdChvdGhlcikge1xyXG4gICAgICAgIHJldHVybiBWZWN0b3Iuc3VidHJhY3QodGhpcywgb3RoZXIpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogTXVsdGlwbHkgdGhlIHZlY3RvciBieSBhIHNjYWxhciB2YWx1ZVxyXG4gICAgICogXHJcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gc2NhbGFyIFRoZSBudW1iZXIgdG8gbXVsdGlwbHkgdGhlIHZlY3RvciBieVxyXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIHJlc3VsdCBvZiBtdWx0aXBseWluZyB0aGUgdmVjdG9yIGJ5IGEgc2NhbGFyXHJcbiAgICAgKiAgZWxlbWVudCB3aXNlXHJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXHJcbiAgICAgKi9cclxuICAgIG11bHRpcGx5KHNjYWxhcikge1xyXG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKHRoaXMueCAqIHNjYWxhciwgdGhpcy55ICogc2NhbGFyKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIERpdmlkZSB0aGUgdmVjdG9yIGJ5IGEgc2NhbGFyIHZhbHVlXHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBzY2FsYXIgXHJcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBUaGUgcmVzdWx0IG9mIG11bHRpcGx5aW5nIHRoZSB2ZWN0b3IgYnkgYSBzY2FsYXJcclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcclxuICAgICAqL1xyXG4gICAgZGl2aWRlKHNjYWxhcikge1xyXG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKHRoaXMueCAvIHNjYWxhciwgdGhpcy55IC8gc2NhbGFyKTtcclxuICAgIH1cclxuXHJcbiAgICAvLy0tLS0gQWR2YW5jZWQgVmVjdG9yIEZ1bmN0aW9ucyAtLS0tXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgdGhlIG1hZ25pdHVkZSBvZiB0aGUgdmVjdG9yXHJcbiAgICAgKiBcclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFRoZSBtYWduaXR1cmUgb2YgdGhlIHZlY3RvclxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBtYWduaXR1ZGUoKSB7XHJcbiAgICAgICAgcmV0dXJuIE1hdGguc3FydCh0aGlzLnggKiB0aGlzLnggKyB0aGlzLnkgKiB0aGlzLnkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEdldCB0aGUgdW5pdCB2ZWN0b3JcclxuICAgIC8qKlxyXG4gICAgICogR2V0IHRoZSBub3JtYWwgdmVjdG9yIG9mIHRoZSBjdXJyZW50IHZlY3Rvci5cclxuICAgICAqIFxyXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gQSB2ZWN0b3IgdGhhdCBpcyB0aGUgbm9ybWFsIGNvbXBlbmVudCBvZiB0aGUgdmVjdG9yXHJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXHJcbiAgICAgKi9cclxuICAgIG5vcm1hbGl6ZSgpIHtcclxuICAgICAgICByZXR1cm4gVmVjdG9yLmRpdmlkZSh0aGlzLm1hZ25pdHVkZSgpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCB0aGUgZ2V0IHRoZSBjdXJyZW50IHZlY3RvciByb3RhdGVkIGJ5IGEgY2VydGFpbiBhbW1vdW50XHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSByYWRpYW5zIFxyXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVGhlIHZlY3RvciB0aGF0IHJlc3VsdHMgZnJvbSByb3RhdGluZyB0aGUgY3VycmVudFxyXG4gICAgICogIHZlY3RvciBieSBhIHBhcnRpY3VsYXIgYW1tb3VudFxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICByb3RhdGUocmFkaWFucykge1xyXG4gICAgICAgIGNvbnN0IGMgPSBNYXRoLmNvcyhyYWRpYW5zKTtcclxuICAgICAgICBjb25zdCBzID0gTWF0aC5zaW4ocmFkaWFucyk7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoYyAqIHRoaXMueCAtIHMgKiB0aGlzLnksIHMgKiB0aGlzLnggKyBjICogdGhpcy55KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCB0aGUgZG90IHByb2R1Y3Qgb2YgdHdvIHZlY3RvcnNcclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFRoZSBkb3QgcHJvZHVjdCBvZiB0aGUgdHdvIHZlY3RvcnNcclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcclxuICAgICAqL1xyXG4gICAgc3RhdGljIGRvdChhLCBiKSB7XHJcbiAgICAgICAgcmV0dXJuIGEueCAqIGIueCArIGEueSAqIGIueTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCB0aGUgYXZlcmFnZSBsb2NhdGlvbiBiZXR3ZWVuIHNldmVyYWwgdmVjdG9yc1xyXG4gICAgICogXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3RvcltdfSB2ZWN0b3JzIFRoZSBsaXN0IG9mIHZlY3RvcnMgdG8gYXZlcmFnZVxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgYXZnKHZlY3RvcnMpIHtcclxuICAgICAgICBsZXQgYXZlcmFnZSA9IFZlY3Rvci56ZXJvKCk7XHJcblxyXG4gICAgICAgIGZvciAoY29uc3QgdmVjdG9yIG9mIHZlY3RvcnMpIHtcclxuICAgICAgICAgICAgYXZlcmFnZSA9IFZlY3Rvci5hZGQoYXZlcmFnZSwgdmVjdG9yKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGF2ZXJhZ2UuZGl2aWRlKHZlY3RvcnMubGVuZ3RoKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCB0aGUgZG90IHByb2R1Y3Qgb2YgdGhpcyB2ZWN0b3IgYW5kIGFub3RoZXIgdmVjdG9yXHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBvdGhlciBUaGUgb3RoZXIgdmVjdG9yXHJcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBUaGUgZG90IHByb2R1Y3Qgb2YgdGhpcyBhbmQgdGhlIG90aGVyIHZlY3RvclxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBkb3Qob3RoZXIpIHtcclxuICAgICAgICByZXR1cm4gVmVjdG9yLmRvdCh0aGlzLCBvdGhlcik7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgdGhlIGNyb3NzIHByb2R1Y3Qgb2YgdHdvIHZlY3RvcnNcclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcclxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9IFRoZSBjcm9zcyBwcm9kdWN0IG9mIHRoZSB0d28gdmVjdG9yc1xyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgY3Jvc3MoYSwgYikge1xyXG4gICAgICAgIHJldHVybiBhLnggKiBiLnkgLSBhLnkgKiBiLng7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgdGhlIGNyb3NzIHByb2R1Y3Qgb2YgdGhpcyBhbmQgdGhlIG90aGVyIHZlY3RvclxyXG4gICAgICogXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gb3RoZXIgVGhlIG90aGVyIHZlY3RvclxyXG4gICAgICogQHJldHVybnMge251bWJlcn0gVGhlIGNyb3NzIHByb2R1Y3Qgb2YgdGhpcyBhbmQgdGhlIG90aGVyIHZlY3RvclxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBjcm9zcyhvdGhlcikge1xyXG4gICAgICAgIHJldHVybiBWZWN0b3IuY3Jvc3ModGhpcywgb3RoZXIpO1xyXG4gICAgfVxyXG5cclxuXHJcbiAgICAvLy0tLS0gUHVyZWx5IFN0YXRpYyBWZWN0b3IgRnVuY3Rpb25zIC0tLS1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCB0aGUgbWlkcG9pbnQgYmV0d2VlbiB0d28gdmVjdG9yc1xyXG4gICAgICogXHJcbiAgICAgKiBAc3RhdGljXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYSBUaGUgZmlyc3QgdmVjdG9yXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvclxyXG4gICAgICogQHJldHVybnMgVGhlIG1pZHBvaW50IG9mIHR3byB2ZWN0b3JzXHJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBtaWRwb2ludChhLCBiKSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoKGEueCArIGIueCkgLyAyLCAoYS55ICsgYi55KSAvIDIpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IHRoZSBwcm9qZWN0aW9uIG9mIHZlY3RvciBhIG9udG8gdmVjdG9yIGJcclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcclxuICAgICAqIEByZXR1cm5zIFRoZSBwcm9qZWN0aW9uIHZlY3RvciBvZiBhIG9udG8gYlxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICogXHJcbiAgICAgKiBAdG9kbyBBZGQgYXNzZXJ0aW9uIGZvciBub24temVybyBsZW5ndGggYiB2ZWN0b3JcclxuICAgICAqL1xyXG4gICAgc3RhdGljIHByb2ooYSwgYikge1xyXG5cclxuICAgICAgICByZXR1cm4gYi5tdWx0aXBseShWZWN0b3IuZG90KGEsIGIpIC8gTWF0aC5wb3coYi5tYWduaXR1ZGUoKSwgMikpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IHRoZSBhbmdsZSBiZXR3ZWVuIHR3byB2ZWN0b3JzXHJcbiAgICAgKiBcclxuICAgICAqIEBzdGF0aWNcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBhIFRoZSBmcmlzdCB2ZWN0b3IgXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvciBcclxuICAgICAqIEByZXR1cm5zIFRoZSBhbmdsZSBiZXR3ZWVuIHZlY3RvciBhIGFuZCB2ZWN0b3IgYlxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgYW5nbGUoYSwgYikge1xyXG4gICAgICAgIHJldHVybiBNYXRoLmFjb3MoVmVjdG9yLmRvdChhLCBiKSAvIChhLm1hZ25pdHVkZSgpICogYi5tYWduaXR1ZGUoKSkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IHRoZSBldWNsaWRlYW4gZGlzdGFuY2UgYmV0d2VlbiB0d28gdmVjdG9yc1xyXG4gICAgICogXHJcbiAgICAgKiBAc3RhdGljXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYSBUaGUgZmlyc3QgdmVjdG9yXHJcbiAgICAgKiBAcGFyYW0ge1ZlY3Rvcn0gYiBUaGUgc2Vjb25kIHZlY3RvclxyXG4gICAgICogQHJldHVybnMgVGhlIGV1Y2xpZGVhbiBkaXN0YW5jZSBiZXR3ZWVuIGEgYW5kIGJcclxuICAgICAqIEBzZWUge0BsaW5rIGRpc3QyfVxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgZGlzdGFuY2UoYSwgYikge1xyXG4gICAgICAgIHJldHVybiBNYXRoLnNxcnQoVmVjdG9yLmRpc3QyKGEsIGIpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCB0aGUgZXVjbGlkZWFuIGRpc3RuYWNlIHNxdWFyZWQgYmV0d2VlbiB0d28gdmVjdG9ycy5cclxuICAgICAqIFRoaXMgaXMgdXNlZCBhcyBhIGhlbHBlciBmb3IgdGhlIGRpc3RuYWNlIGZ1bmN0aW9uIGJ1dCBjYW4gYmUgdXNlZFxyXG4gICAgICogdG8gc2F2ZSBvbiBzcGVlZCBieSBub3QgZG9pbmcgdGhlIHNxdWFyZSByb290IG9wZXJhdGlvbi5cclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGEgVGhlIGZpcnN0IHZlY3RvclxyXG4gICAgICogQHBhcmFtIHtWZWN0b3J9IGIgVGhlIHNlY29uZCB2ZWN0b3JcclxuICAgICAqIEByZXR1cm5zIFRoZSBldWNsaWRlYW4gZGlzdGFuY2Ugc3F1YXJlZCBiZXR3ZWVuIHZlY3RvciBhIGFuZCB2ZWN0b3IgYlxyXG4gICAgICogQHNlZSB7QGxpbmsgZGlzdG5hY2V9XHJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBkaXN0MihhLCBiKSB7XHJcbiAgICAgICAgY29uc3QgZHggPSBhLnggLSBiLng7XHJcbiAgICAgICAgY29uc3QgZHkgPSBhLnkgLSBiLnk7XHJcbiAgICAgICAgcmV0dXJuIGR4ICogZHggKyBkeSAqIGR5O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IHRoZSBzaG9ydGVzdCBkaXN0YW5jZSBiZXR3ZWVuIHRoZSBwb2ludCBwIGFuZCB0aGUgbGluZVxyXG4gICAgICogc2VnbWVudCB2IHRvIHcuXHJcbiAgICAgKiBcclxuICAgICAqIEBzdGF0aWNcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBwIFRoZSB2ZWN0b3IgcG9pbnRcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2IFRoZSBmaXJzdCBsaW5lIHNlZ21lbnQgZW5kcG9pbnRcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB3IFRoZSBzZWNvbmQgbGluZSBzZWdtZW50IGVuZHBvaW50XHJcbiAgICAgKiBAcmV0dXJucyBUaGUgc2hvcnRlc3QgZXVjbGlkZWFuIGRpc3RhbmNlIGJldHdlZW4gcG9pbnRcclxuICAgICAqIEBzZWUge0BsaW5rIGRpc3RUb1NlZzJ9XHJcbiAgICAgKiBAc2VlIHtAbGluayBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzg0OTIxMS9zaG9ydGVzdC1kaXN0YW5jZS1iZXR3ZWVuLWEtcG9pbnQtYW5kLWEtbGluZS1zZWdtZW50fVxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgZGlzdFRvU2VnKHAsIHYsIHcpIHtcclxuICAgICAgICByZXR1cm4gTWF0aC5zcXJ0KFZlY3Rvci5kaXN0VG9TZWcyKHAsIHYsIHcpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCB0aGUgc2hvcnRlc3QgZGlzdGFuY2Ugc3F1YXJlZCBiZXR3ZWVuIHRoZSBwb2ludCBwIGFuZCB0aGUgbGluZVxyXG4gICAgICogc2VnbWVudCB2IHRvIHcuXHJcbiAgICAgKiBcclxuICAgICAqIEBzdGF0aWNcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBwIFRoZSB2ZWN0b3IgcG9pbnRcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB2IFRoZSBmaXJzdCBsaW5lIHNlZ21lbnQgZW5kcG9pbnRcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSB3IFRoZSBzZWNvbmQgbGluZSBzZWdtZW50IGVuZHBvaW50XHJcbiAgICAgKiBAcmV0dXJucyBUaGUgc2hvcnRlc3QgZXVjbGlkZWFuIGRpc3RhbmNlIHNxdWFyZWQgYmV0d2VlbiBwb2ludFxyXG4gICAgICogQHNlZSB7QGxpbmsgZGlzdFRvU2VnfVxyXG4gICAgICogQHNlZSB7QGxpbmsgaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy84NDkyMTEvc2hvcnRlc3QtZGlzdGFuY2UtYmV0d2Vlbi1hLXBvaW50LWFuZC1hLWxpbmUtc2VnbWVudH1cclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcclxuICAgICAqL1xyXG4gICAgc3RhdGljIGRpc3RUb1NlZ1NxdWFyZWQocCwgdiwgdykge1xyXG4gICAgICAgIGNvbnN0IGwgPSBWZWN0b3IuZGlzdDIodiwgdyk7XHJcbiAgICAgICAgaWYgKGwgPT09IDApIHsgcmV0dXJuIFZlY3Rvci5kaXN0MihwLCB2KTsgfVxyXG4gICAgICAgIGxldCB0ID0gKChwLnggLSB2LngpICogKHcueCAtIHYueCkgKyAocC55IC0gdi55KSAqICh3LnkgLSB2LnkpKSAvIGw7XHJcbiAgICAgICAgdCA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEsIHQpKTtcclxuICAgICAgICByZXR1cm4gVmVjdG9yLmRpc3QyKHAsIG5ldyBWZWN0b3Iodi54ICsgdCAqICh3LnggLSB2LngpLFxyXG4gICAgICAgICAgICB2LnkgKyB0ICogKHcueSAtIHYueSkpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCB0aGUgdHdvIG5vcm1hbCB2ZWN0b3JzIHRoYXQgYXJlIHBlcnBlbmRpY3VsYXIgdG8gdGhlIGN1cnJlbnQgdmVjdG9yXHJcbiAgICAgKiBcclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3JbXX0gVGhlIHR3byBub3JtYWwgdmVjdG9ycyB0aGF0IGFyZSBwZXJwZW5kaWN1bGFyXHJcbiAgICAgKiAgdG8gdGhlIHZlY3Rvci4gVGhlIGZpcnN0IHZlY3RvciBpcyB0aGUgbm9ybWFsIHZlY3RvciB0aGF0IGlzICs5MCBkZWcgb3JcclxuICAgICAqICArUEkvMiByYWQuIFRoZSBzZWNvbmQgdmVjdG9yIGlzIHRoZSBub3JhbWwgdmVjdG9yIHRoYXQgaXMgLTkwIGRlZyBvclxyXG4gICAgICogIC1QSS8yIHJhZC5cclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcclxuICAgICAqL1xyXG4gICAgcGVycGVuZGljdWxhcnMoKSB7XHJcbiAgICAgICAgY29uc3QgcGx1czkwID0gbmV3IFZlY3RvcigtdGhpcy55LCB0aGlzLngpLm5vcm1hbGl6ZSgpO1xyXG4gICAgICAgIGNvbnN0IG1pbnVzOTAgPSBuZXcgVmVjdG9yKHRoaXMueSwgLXRoaXMueCkubm9ybWFsaXplKCk7XHJcbiAgICAgICAgcmV0dXJuIFtwbHVzOTAsIG1pbnVzOTBdO1xyXG4gICAgfVxyXG5cclxuICAgIC8vLS0tLSBTdGFuZGFyZCBTdGF0aWMgVmVjdG9yIE9iamVjdHMgLS0tLVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGEgdmVjdG9yIG9mIG5vIG1hZ25pdHVkZSBhbmQgbm8gZGlyZWN0aW9uXHJcbiAgICAgKiBcclxuICAgICAqIEBzdGF0aWNcclxuICAgICAqIEBmdW5jdGlvblxyXG4gICAgICogQHJldHVybnMge1ZlY3Rvcn0gVmVjdG9yIG9mIG1hZ25pdHVkZSB6ZXJvXHJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyB6ZXJvKCkge1xyXG4gICAgICAgIFwidXNlIHN0cmljdFwiO1xyXG4gICAgICAgIHJldHVybiBuZXcgVmVjdG9yKDAsIDApO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IHRoZSB1bml0IHZlY3RvciBwb2ludGluZyBpbiB0aGUgcG9zaXRpdmUgeSBkaXJlY3Rpb25cclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQGZ1bmN0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBVbml0IHZlY3RvciBwb2ludGluZyB1cFxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgdXAoKSB7XHJcbiAgICAgICAgXCJ1c2Ugc3RyaWN0XCI7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoMCwgMSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgdGhlIHVuaXQgdmVjdG9yIHBvaW50aW5nIGluIHRoZSBuZWdhdGl2ZSB5IGRpcmVjdGlvblxyXG4gICAgICogXHJcbiAgICAgKiBAc3RhdGljXHJcbiAgICAgKiBAZnVuY3Rpb25cclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFVuaXQgdmVjdG9yIHBvaW50aW5nIGRvd25cclxuICAgICAqIEBtZW1iZXJvZiBWZWN0b3JcclxuICAgICAqL1xyXG4gICAgc3RhdGljIGRvd24oKSB7XHJcbiAgICAgICAgXCJ1c2Ugc3RyaWN0XCI7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBWZWN0b3IoMCwgLTEpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IHRoZSB1bml0IHZlY3RvciBwb2ludGluZyBpbiB0aGUgbmVnYXRpdmUgeCBkaXJlY3Rpb25cclxuICAgICAqIFxyXG4gICAgICogQHN0YXRpY1xyXG4gICAgICogQGZ1bmN0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7VmVjdG9yfSBVbml0IHZlY3RvciBwb2ludGluZyByaWdodFxyXG4gICAgICogQG1lbWJlcm9mIFZlY3RvclxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgbGVmdCgpIHtcclxuICAgICAgICBcInVzZSBzdHJpY3RcIjtcclxuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcigtMSwgMCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgdGhlIHVuaXQgdmVjdG9yIHBvaW50aW5nIGluIHRoZSBwb3NpdGl2ZSB4IGRpcmVjdGlvblxyXG4gICAgICogXHJcbiAgICAgKiBAc3RhdGljXHJcbiAgICAgKiBAZnVuY3Rpb25cclxuICAgICAqIEByZXR1cm5zIHtWZWN0b3J9IFVuaXQgdmVjdG9yIHBvaW50aW5nIHJpZ2h0XHJcbiAgICAgKiBAbWVtYmVyb2YgVmVjdG9yXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyByaWdodCgpIHtcclxuICAgICAgICBcInVzZSBzdHJpY3RcIjtcclxuICAgICAgICByZXR1cm4gbmV3IFZlY3RvcigxLCAwKTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgVmVjdG9yOyIsImltcG9ydCBWZWN0b3IgZnJvbSBcIi4uL2dlb21ldHJ5L1ZlY3RvclwiO1xyXG5pbXBvcnQgUG9seWdvbiBmcm9tIFwiLi4vZ2VvbWV0cnkvUG9seWdvblwiO1xyXG5cclxuY2xhc3MgQ2VudGVyIGV4dGVuZHMgVmVjdG9yIHtcclxuICAgIC8qKlxyXG4gICAgICogQSBjZW50ZXIgY29ubmVjdGlvbiBhbmQgbG9jYXRpb24gaW4gYSBncmFwaCBvYmplY3RcclxuICAgICAqIFxyXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IGlkIFRoZSBpZCBvZiB0aGUgY2VudGVyIGluIHRoZSBncmFwaCBvYmplY3RcclxuICAgICAqIEBwcm9wZXJ0eSB7UG9seWdvbn0gbmVpZ2hib3JzIFNldCBvZiBhZGphY2VudCBwb2x5Z29uIGNlbnRlcnNcclxuICAgICAqIEBwcm9wZXJ0eSB7TGluZVtdfSBib3JkZXJzIFNldCBvZiBib3JkZXJpbmcgZWRnZXNcclxuICAgICAqIEBwcm9wZXJ0eSB7UG9seWdvbn0gY29ybmVycyBTZXQgb2YgcG9seWdvbiBjb3JuZXJzXHJcbiAgICAgKiBAcHJvcGVydHkge2Jvb2xlYW59IGJvcmRlciBJcyB0aGlzIHBvbHlnb24gdG91Y2hpbmcgdGhlIGJvcmRlciBlZGdlXHJcbiAgICAgKiBAcHJvcGVydHkge29iamVjdH0gZGF0YSBUaGUgZGF0YSBzdG9yZWQgYnkgdGhlIGNlbnRlciBvYmplY3QuIFRoaXMgaXMgdGhlXHJcbiAgICAgKiAgZGF0YSB0aGF0IGlzIHRvIGJlIGNoYW5nZWQgYnkgdGhlIHVzZXJcclxuICAgICAqIEBwcm9wZXJ0eSB7Q2VudGVyfSBwYXJlbnQgVGhlIHBhcmVudCBvYmplY3QgdG8gdGhlIGN1cnJlbnQgb2JqZWN0LiBUaGVcclxuICAgICAqICBkZWZhdWx0IGlzIG51bGwsIHRoZXJlIGlzIG5vIHBhcmVudC5cclxuICAgICAqIEBwcm9wZXJ0eSB7Q2VudGVyW119IGNoaWxkcmVuIFRoZSBjaGlsZHJlbiBvYmplY3RzIHRvIHRoZSBjdXJyZW50IG9iamVjdC5cclxuICAgICAqICBUaGUgZGVmYXVsdCBpcyBhbiBlbXB0eSBsaXN0XHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yfSBwb3NpdGlvbiBUaGUgbG9jYXRpb24gb2YgdGhlIENlbnRlciBvYmplY3RcclxuICAgICAqIFxyXG4gICAgICogQGNsYXNzIENlbnRlclxyXG4gICAgICogQGV4dGVuZHMge1ZlY3Rvcn1cclxuICAgICAqL1xyXG4gICAgY29uc3RydWN0b3IocG9zaXRpb24sIHBhcmVudCA9IG51bGwsIGNoaWxkcmVuID0gbnVsbCkge1xyXG4gICAgICAgIHN1cGVyKHBvc2l0aW9uKTtcclxuXHJcbiAgICAgICAgLy8gRGlhZ3JhbSBQcm9wZXJ0aWVzXHJcbiAgICAgICAgdGhpcy5pZCA9IC0xO1xyXG4gICAgICAgIHRoaXMubmVpZ2hib3JzID0gW107IC8vIENlbnRlcnNcclxuICAgICAgICB0aGlzLmJvcmRlcnMgPSBbXTsgLy8gRWRnZXNcclxuICAgICAgICB0aGlzLmNvcm5lcnMgPSBbXTtcclxuICAgICAgICB0aGlzLmJvcmRlciA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMudGlsZSA9IG51bGw7XHJcblxyXG4gICAgICAgIC8vIEhpZ2hlciBMZXZlbCBQcm9wZXJ0aWVzXHJcbiAgICAgICAgdGhpcy5kYXRhID0ge307XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IENlbnRlcjsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcclxuaW1wb3J0IFBvbHlnb24gZnJvbSBcIi4uL2dlb21ldHJ5L1BvbHlnb25cIjtcclxuXHJcbmNsYXNzIENvcm5lciBleHRlbmRzIFZlY3RvciB7XHJcbiAgICAvKipcclxuICAgICAqIEEgY29ybmVyIGNvbm5lY3Rpb24gYW5kIGxvY2F0aW9uIGluIGEgZ3JhcGggb2JqZWN0XHJcbiAgICAgKiBcclxuICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBpZCBUaGUgaWQgb2YgdGhlIGNvcm5lciBpbiB0aGUgZ3JhcGggb2JqZWN0XHJcbiAgICAgKiBAcHJvcGVydHkge1BvbHlnb259IHRvdWNoZXMgU2V0IG9mIHBvbHlnb24gY2VudGVycyB0b3VjaGluZyB0aGlzIG9iamVjeXRcclxuICAgICAqIEBwcm9wZXJ0eSB7TGluZVtdfSBwcm90cnVkZXMgU2V0IG9mIGVkZ2VzIHRoYXQgYXJlIGNvbm5lY3RlZCB0byB0aGlzIGNvcm5lclxyXG4gICAgICogQHByb3BlcnR5IHtQb2x5Z29ufSBhZGphY2VudCBTZXQgb2YgY29ybmVycyB0aGF0IGNvbm5lY3RlZCB0byB0aGlzIGNvcm5lclxyXG4gICAgICogXHJcbiAgICAgKiBAY2xhc3MgQ29ybmVyXHJcbiAgICAgKiBAZXh0ZW5kcyB7VmVjdG9yfVxyXG4gICAgICovXHJcbiAgICBjb25zdHJ1Y3Rvcihwb3NpdGlvbikge1xyXG4gICAgICAgIHN1cGVyKHBvc2l0aW9uKTtcclxuICAgICAgICB0aGlzLmlkID0gLTE7XHJcbiAgICAgICAgdGhpcy50b3VjaGVzID0gW107IC8vIENlbnRlcnNcclxuICAgICAgICB0aGlzLnByb3RydWRlcyA9IFtdOyAvLyBFZGdlc1xyXG4gICAgICAgIHRoaXMuYWRqYWNlbnQgPSBbXTsgLy8gQ29ybmVyc1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBDb3JuZXI7IiwiaW1wb3J0IEdyYXBoIGZyb20gXCIuL0dyYXBoXCI7XHJcbmltcG9ydCBUaWxlIGZyb20gXCIuL1RpbGVcIjtcclxuXHJcbmNsYXNzIERpYWdyYW0gZXh0ZW5kcyBHcmFwaCB7XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDcmVhdGVzIGFuIGluc3RhbmNlIG9mIERpYWdyYW0uXHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSB7YW55fSBwb2ludHMgXHJcbiAgICAgKiBAcGFyYW0ge2FueX0gYmJveCBcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBbcmVsYXhhdGlvbnM9MF0gXHJcbiAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtpbXByb3ZlQ29ybmVycz1mYWxzZV0gXHJcbiAgICAgKiBcclxuICAgICAqIEBjbGFzcyBEaWFncmFtXHJcbiAgICAgKiBAZXh0ZW5kcyBHcmFwaFxyXG4gICAgICovXHJcbiAgICBjb25zdHJ1Y3Rvcihwb2ludHMsIGJib3gsIHJlbGF4YXRpb25zID0gMCwgaW1wcm92ZUNvcm5lcnMgPSBmYWxzZSkge1xyXG4gICAgICAgIHN1cGVyKHBvaW50cywgYmJveCwgcmVsYXhhdGlvbnMgPSAwLCBpbXByb3ZlQ29ybmVycyA9IGZhbHNlKTtcclxuXHJcbiAgICAgICAgdGhpcy50aWxlcyA9IFtdO1xyXG4gICAgICAgIC8vIF9jcmVhdGVUaWxlcygpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogXHJcbiAgICAgKiBcclxuICAgICAqIEBtZW1iZXJvZiBEaWFncmFtXHJcbiAgICAgKi9cclxuICAgIF9jcmVhdGVUaWxlcygpIHtcclxuICAgICAgICBmb3IgKGNvbnN0IGNlbnRlciBvZiB0aGlzLmNlbnRlcnMpIHtcclxuICAgICAgICAgICAgY29uc3QgdGlsZSA9IG5ldyB0aWxlKGNlbnRlciwgY2VudGVyLmNvcm5lcnMsIGNlbnRlci5ib3JkZXJzKTtcclxuICAgICAgICAgICAgdGhpcy5jZW50ZXJzLnRpbGUgPSB0aWxlO1xyXG4gICAgICAgICAgICB0aGlzLnRpbGVzLnB1c2godGlsZSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDb25uZWN0IHRvZ2V0aGVyIHRoZSB0aWxlIG9iamVjdHMgYXMgbmVpZ2hib3JzXHJcbiAgICAgICAgZm9yIChjb25zdCB0aWxlIG9mIHRoaXMudGlsZXMpIHtcclxuICAgICAgICAgICAgdGhpcy50aWxlLm5laWdoYm9ycyA9IHRpbGUuY2VudGVyLm5laWdoYm9ycy5tYXAoXHJcbiAgICAgICAgICAgICAgICBjZW50ZXIgPT4gY2VudGVyLnRpbGVcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBUaGlzIGZ1bmN0aW9uIGlzIHVzZWQgdG8gY2FsbCBjZWxsdWxhciBhdXRvbWl0YSBvbiB0aGUgZ3JhcGggb2JqZWN0LlxyXG4gICAgICogVGhlIHJ1bGVzZXQgZnVuY3Rpb24gc2hvdWxkIGZvbGxvdyB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXMgc28gdGhhdFxyXG4gICAgICogdGhlIGF1dG9tYXRpb24gY2FuIHJ1biBwcm9wZXJseS4gU2VlIHRoZSBleGFtcGxlIGZvciB0aGUgZGV0YWlsc1xyXG4gICAgICogXHJcbiAgICAgKiBAc3VtbWFyeSBSdW4gYSBnZW5lcmF0aW9uIG9mIGNlbGx1bGFyIGF1dG9tYXRpb24gYWNjb3JkaW5nIHRvIGEgdXNlclxyXG4gICAgICogIHNwZWNpZmllZCBydWxlIHNldFxyXG4gICAgICogXHJcbiAgICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSBydWxlc2V0IFRoZVxyXG4gICAgICogXHJcbiAgICAgKiBAZXhhbXBsZVxyXG4gICAgICogXHJcbiAgICAgKiB2YXIgZ2FtZU9mTGlmZSA9IGZ1bmN0aW9uKGNlbnRlcikge1xyXG4gICAgICogICB2YXIgbiA9IGNlbnRlci5uZWlnaGJvcnMubGVuZ3RoO1xyXG4gICAgICogICByZXR1cm4geyBcclxuICAgICAqICAgICBhbGl2ZTogY2VudGVyLmRhdGEuYWxpdmUgJiYgKG4gPT09IDIgfHwgbiA9PT0gMykgfHxcclxuICAgICAqICAgICAgICAgICAhY2VudGVyLmRhdGEuYWxpdmUgJiYgbiA9PT0gM1xyXG4gICAgICogICB9O1xyXG4gICAgICogfVxyXG4gICAgICogXHJcbiAgICAgKiBAdG9kbyBGaW5kIGEgTmV3IE5hbWVcclxuICAgICAqIEBtZW1iZXJPZiBEaWFncmFtXHJcbiAgICAgKi9cclxuICAgIF9nZW5lcmF0ZShydWxlc2V0KSB7XHJcbiAgICAgICAgLy8gUnVuIGNlbGx1bGFyIGF1dG9taXRhXHJcbiAgICAgICAgZm9yIChsZXQgY2VudGVyIG9mIHRoaXMuY2VudGVycykge1xyXG4gICAgICAgICAgICBjZW50ZXIuX2RhdGEgPSBydWxlc2V0KGNlbnRlcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBVcGRhdGUgYXV0b21pdGEgYWN0aW9uc1xyXG4gICAgICAgIGZvciAobGV0IGNlbnRlciBvZiB0aGlzLmNlbnRlcnMpIHtcclxuICAgICAgICAgICAgLy8gVXBkYXRlIG9ubHkgdGhlIG5ldyBkYXRhIHRoYXQgaGFzIGNoYW5nZWRcclxuICAgICAgICAgICAgZm9yIChsZXQga2V5IGluIGNlbnRlci5fZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlci5fZGF0YS5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2VudGVyLmRhdGFba2V5XSA9IGNlbnRlci5fZGF0YVtrZXldO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGRlbGV0ZSBjZW50ZXIuX2RhdGE7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGluaXRpYWxpemUocnVsZXNldCkge1xyXG4gICAgICAgIHRoaXMuX2dlbmVyYXRlKHJ1bGVzZXQpO1xyXG4gICAgfVxyXG5cclxuICAgIGl0ZXJhdGUocnVsZXNldCkge1xyXG4gICAgICAgIHRoaXMuX2dlbmVyYXRlKHJ1bGVzZXQpO1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBNYXA7IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi4vZ2VvbWV0cnkvVmVjdG9yXCI7XHJcbmltcG9ydCBMaW5lIGZyb20gXCIuLi9nZW9tZXRyeS9MaW5lXCI7XHJcblxyXG5jbGFzcyBFZGdlIGV4dGVuZHMgTGluZSB7XHJcbiAgICAvKipcclxuICAgICAqIEVkZ2UgY29ubmVjdGlvbnMgYmV0d2VlbiBjZW50ZXJzIGFuZCBjb3JuZXJzIGluIHRoZSBWb3Jvbm9pL0RlbGF1bmF5XHJcbiAgICAgKiBncmFwaC5cclxuICAgICAqIFxyXG4gICAgICogQHByb3BlcnR5IHtudW1iZXJ9IGlkIFRoZSBpZCBvZiB0aGUgZWRnZSBpbiB0aGUgZ3JhcGggb2JqZWN0XHJcbiAgICAgKiBAcHJvcGVydHkge1ZlY3Rvcn0gZDAgVGhlIGZpcnN0IHBvbHlnb24gY2VudGVyIG9mIHRoZSBkZWxhdW5heSBncmFwaFxyXG4gICAgICogQHByb3BlcnR5IHtWZWN0b3J9IGQxIFRoZSBzZWNvbmQgcG9seWdvbiBjZW50ZXIgb2YgdGhlIGRlbGF1bmF5IGdyYXBoXHJcbiAgICAgKiBAcHJvcGVydHkge1ZlY3Rvcn0gdjAgVGhlIGZpcnN0IGNvcm5lciBvYmplY3Qgb2YgdGhlIHZvcm9ub2kgZ3JhcGhcclxuICAgICAqIEBwcm9wZXJ0eSB7VmVjdG9yfSB2MSBUaGUgc2Vjb25kIGNvcm5lciBvYmplY3Qgb2YgdGhlIHZvcm9ub2kgZ3JhcGhcclxuICAgICAqIFxyXG4gICAgICogQGNsYXNzIEVkZ2VcclxuICAgICAqIEBleHRlbmRzIHtMaW5lfVxyXG4gICAgICovXHJcbiAgICBjb25zdHJ1Y3Rvcih2MCwgdjEpIHtcclxuICAgICAgICBzdXBlcih2MCwgdjEpO1xyXG4gICAgICAgIHRoaXMuaWQgPSAtMTtcclxuICAgICAgICAvLyBQb2x5Z29uIGNlbnRlciBvYmplY3RzIGNvbm5lY3RlZCBieSBEZWxhdW5heSBlZGdlc1xyXG4gICAgICAgIHRoaXMuZDAgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuZDEgPSBudWxsO1xyXG4gICAgICAgIC8vIENvcm5lciBvYmplY3RzIGNvbm5lY3RlZCBieSBWb3Jvbm9pIGVkZ2VzXHJcbiAgICAgICAgdGhpcy52MCA9IG51bGw7XHJcbiAgICAgICAgdGhpcy52MSA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5taWRwb2ludCA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5ib3JkZXIgPSBmYWxzZTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgRWRnZTsiLCJpbXBvcnQgVmVjdG9yIGZyb20gXCIuLi9nZW9tZXRyeS9WZWN0b3JcIjtcclxuaW1wb3J0IENlbnRlciBmcm9tIFwiLi9DZW50ZXJcIjtcclxuaW1wb3J0IENvcm5lciBmcm9tIFwiLi9Db3JuZXJcIjtcclxuaW1wb3J0IEVkZ2UgZnJvbSBcIi4vRWRnZVwiO1xyXG5pbXBvcnQgeyBoYXMgfSBmcm9tIFwiLi4vdXRpbGl0aWVzL1V0aWxcIjtcclxuaW1wb3J0IFZvcm9ub2kgZnJvbSBcIlZvcm9ub2lcIjtcclxuXHJcblwidXNlIHN0cmljdFwiO1xyXG5cclxuLy8gTmVlZCB0byBFUzZpZnlcclxuY2xhc3MgR3JhcGgge1xyXG4gICAgLyoqXHJcbiAgICAgKiBUaGUgR3JhcGggY2xhc3MgaXMgYW4gZXh0ZW5zdGlvbiBvZiB0aGUgdm9yb25vaSBkaWFncmFtLiBJdCB0dXJucyB0aGVcclxuICAgICAqIGRpYWdyYW0gaW50byBhIG1vcmUgdXNlYWJsZSBmb3JtYXQgd2hlcmUgY2VudGVycywgZWRnZXMsIGFuZCBjb3JuZXJzIGFyZVxyXG4gICAgICogYmV0dGVyIGNvbm5lY3RlZC4gVGhpcyBhbGxvd3MgZm9yIG1hbnkgZGlmZmVyZW50IHR5cGVzIG9mIHRyYXZlcnNhbCBvdmVyXHJcbiAgICAgKiB0aGUgZ3JhcGguIFRoaXMgY2xhc3MgdXNlcyB0aGUgcmhpbGwtdm9yb25vaSBsaWJyYXJ5IGZvciBidWlsZGluZyB0aGVcclxuICAgICAqIHZvcm9ub2kgZ3JhcGguIFRoaXMgaXMgdGVybWVkIGEgUEFOIGNvbm5lY3RlZCBncmFwaC4gVGhpcyBjbGFzcyBjYW4gYWxzbyBiZVxyXG4gICAgICogcmVsYXhlZCBtb3JlIGJ5IHVzaW5nIGxsb3lkIHJlbGF4YXRpb24gd2hpY2ggcmVydW5zIHRoZSBncmFwaCBzaW11bGF0aW9uXHJcbiAgICAgKiBwcm9jZXNzIHdpdGggYSBsZXNzIHBhY2tlZCBwb2ludCBzZXQgdG8gZ3JhZHVhbGx5IGNyZWF0ZSBhIG1vcmUgXCJibHVlXCIgbm9pc2VcclxuICAgICAqIGVmZmVjdC5cclxuICAgICAqXHJcbiAgICAgKiBAc3VtbWFyeSBDcmVhdGVzIGEgdm9yb25vaSBkaWFncmFtIG9mIGEgZ2l2ZW4gcG9pbnQgc2V0IHRoYXQgaXMgY3JlYXRlZFxyXG4gICAgICogIGluc2lkZSBhIHBhcnRpdWNsYXIgYm91bmRpbmcgYm94LiBUaGUgc2V0IG9mIHBvaW50cyBjYW4gYWxzbyBiZSByZWxheGVkXHJcbiAgICAgKiAgY3JlYXRpbmcgYSBtb3JlIFwiYmx1ZVwiIG5vaXNlIGVmZmVjdCB1c2luZyBsb3lkIHJlbGF4YXRpb24uXHJcbiAgICAgKiBcclxuICAgICAqIEBwcm9wZXJ0eSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBpbnB1dCBib3VuZGluZyBib3hcclxuICAgICAqIEBwcm9wZXJ0eSB7Q2VudGVyW119IGNlbnRlcnMgQWxsIHRoZSBjZW50ZXIgb2JqZWN0cyBvZiB0aGUgZ3JhcGhcclxuICAgICAqIEBwcm9wZXJ0eSB7Q29ybmVyW119IGNvcm5lcnMgQWxsIHRoZSBjb3JuZXIgb2JqZWN0cyBvZiB0aGUgZ3JhcGhcclxuICAgICAqIEBwcm9wZXJ0eSB7RWRnZXNbXX0gZWRnZXMgQWxsIHRoZSBlZGdlIG9iamVjdHMgb2YgdGhlIGdyYXBoXHJcbiAgICAgKiBcclxuICAgICAqIEBwYXJhbSB7VmVjdG9yW119IHBvaW50cyBUaGUgdmVjdG9yIGxvY2F0aW9uIHRvIGNyZWF0ZSB0aGUgdm9yb25vaSBkaWFncmFtIHdpdGhcclxuICAgICAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBiYm94IFRoZSBib3VuZGluZyBib3ggZm9yIHRoZSBjcmVhdGlvbiBvZiB0aGUgdm9yb25vaSBkaWFncmFtXHJcbiAgICAgKiBAcGFyYW0ge2ludGVnZXJ9IFtyZWxheGF0aW9ucz0wXSBUaGUgbnVtYmVyIG9mIGxsb3lkIHJlbGF4YXRpb25zIHRvIGRvLlxyXG4gICAgICogIFRoaXMgdHVybnMgYSBub2lzeSBncmFwaCBpbnRvIGEgbW9yZSB1bmlmb3JtIGdyYXBoIGl0ZXJhdGlvbiBieSBpdGVyYXRpb24uXHJcbiAgICAgKiAgVGhpcyBoZWxwcyB0byBpbXByb3ZlIHRoZSBzcGFjaW5nIGJldHdlZW4gcG9pbnRzIGluIHRoZSBncmFwaC5cclxuICAgICAqIEBwYXJhbSB7Ym9vbH0gW2ltcHJvdmVDb3JuZXJzPWZhbHNlXSBUaGlzIGltcHJvdmVzIHVuaWZvcm1pdHkgYW1vbmcgdGhlXHJcbiAgICAgKiAgY29ybmVycyBieSBzZXR0aW5nIHRoZW0gdG8gdGhlIGF2ZXJhZ2Ugb2YgdGhlaXIgbmVpZ2hib3JzLiBUaGlzIGJyZWFrc1xyXG4gICAgICogIHRoZSB2b3Jvbm9pIHByb3BlcnRpZXMgb2YgdGhlIGdyYXBoLlxyXG4gICAgICogXHJcbiAgICAgKiBAY2xhc3MgR3JhcGhcclxuICAgICAqL1xyXG4gICAgY29uc3RydWN0b3IocG9pbnRzLCBiYm94LCByZWxheGF0aW9ucyA9IDAsIGltcHJvdmVDb3JuZXJzID0gZmFsc2UpIHtcclxuICAgICAgICB0aGlzLmJib3ggPSBiYm94O1xyXG4gICAgICAgIHRoaXMuX3JoaWxsYmJveCA9IHtcclxuICAgICAgICAgICAgeGw6IHRoaXMuYmJveC54LFxyXG4gICAgICAgICAgICB4cjogdGhpcy5iYm94LnggKyB0aGlzLmJib3gud2lkdGgsXHJcbiAgICAgICAgICAgIHl0OiB0aGlzLmJib3gueSxcclxuICAgICAgICAgICAgeWI6IHRoaXMuYmJveC55ICsgdGhpcy5iYm94LmhlaWdodFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIENvbXB1dGUgVm9yb25vaSBmcm9tIGluaXRpYWwgcG9pbnRzXHJcbiAgICAgICAgY29uc3QgcmhpbGxWb3Jvbm9pID0gbmV3IFZvcm9ub2koKTtcclxuICAgICAgICB0aGlzLl92b3Jvbm9pID0gcmhpbGxWb3Jvbm9pLmNvbXB1dGUocG9pbnRzLCB0aGlzLl9yaGlsbGJib3gpO1xyXG5cclxuICAgICAgICAvLyBMbG95ZHMgUmVsYXhhdGlvbnNcclxuICAgICAgICB3aGlsZSAocmVsYXhhdGlvbnMtLSkge1xyXG4gICAgICAgICAgICBjb25zdCBzaXRlcyA9IHRoaXMucmVsYXhTaXRlcyh0aGlzLl92b3Jvbm9pKTtcclxuICAgICAgICAgICAgcmhpbGxWb3Jvbm9pLnJlY3ljbGUodGhpcy5fdm9yb25vaSk7XHJcbiAgICAgICAgICAgIHRoaXMuX3Zvcm9ub2kgPSByaGlsbFZvcm9ub2kuY29tcHV0ZShzaXRlcywgdGhpcy5fcmhpbGxiYm94KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRoaXMuY29udmVydERpYWdyYW0odGhpcy5fdm9yb25vaSk7XHJcblxyXG4gICAgICAgIGlmIChpbXByb3ZlQ29ybmVycykge1xyXG4gICAgICAgICAgICB0aGlzLmltcHJvdmVDb3JuZXJzKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuc29ydENvcm5lcnMoKTtcclxuXHJcbiAgICB9XHJcblxyXG4gICAgcmVsYXhTaXRlcyh2b3Jvbm9pKSB7XHJcbiAgICAgICAgY29uc3QgY2VsbHMgPSB2b3Jvbm9pLmNlbGxzO1xyXG4gICAgICAgIGxldCBpQ2VsbCA9IGNlbGxzLmxlbmd0aDtcclxuICAgICAgICBsZXQgY2VsbDtcclxuICAgICAgICBsZXQgc2l0ZTtcclxuICAgICAgICBjb25zdCBzaXRlcyA9IFtdO1xyXG5cclxuICAgICAgICB3aGlsZSAoaUNlbGwtLSkge1xyXG4gICAgICAgICAgICBjZWxsID0gY2VsbHNbaUNlbGxdO1xyXG4gICAgICAgICAgICBzaXRlID0gdGhpcy5jZWxsQ2VudHJvaWQoY2VsbCk7XHJcbiAgICAgICAgICAgIHNpdGVzLnB1c2gobmV3IFZlY3RvcihzaXRlLngsIHNpdGUueSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gc2l0ZXM7XHJcbiAgICB9XHJcblxyXG4gICAgY2VsbEFyZWEoY2VsbCkge1xyXG4gICAgICAgIGxldCBhcmVhID0gMDtcclxuICAgICAgICBjb25zdCBoYWxmZWRnZXMgPSBjZWxsLmhhbGZlZGdlcztcclxuICAgICAgICBsZXQgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aDtcclxuICAgICAgICBsZXQgaGFsZmVkZ2UsIHAxLCBwMjtcclxuICAgICAgICB3aGlsZSAoaUhhbGZlZGdlLS0pIHtcclxuICAgICAgICAgICAgaGFsZmVkZ2UgPSBoYWxmZWRnZXNbaUhhbGZlZGdlXTtcclxuICAgICAgICAgICAgcDEgPSBoYWxmZWRnZS5nZXRTdGFydHBvaW50KCk7XHJcbiAgICAgICAgICAgIHAyID0gaGFsZmVkZ2UuZ2V0RW5kcG9pbnQoKTtcclxuICAgICAgICAgICAgYXJlYSArPSBwMS54ICogcDIueTtcclxuICAgICAgICAgICAgYXJlYSAtPSBwMS55ICogcDIueDtcclxuICAgICAgICB9XHJcbiAgICAgICAgYXJlYSAvPSAyO1xyXG4gICAgICAgIHJldHVybiBhcmVhO1xyXG4gICAgfVxyXG5cclxuICAgIGNlbGxDZW50cm9pZChjZWxsKSB7XHJcbiAgICAgICAgbGV0IHggPSAwLFxyXG4gICAgICAgICAgICB5ID0gMDtcclxuICAgICAgICBjb25zdCBoYWxmZWRnZXMgPSBjZWxsLmhhbGZlZGdlcztcclxuICAgICAgICBsZXQgaUhhbGZlZGdlID0gaGFsZmVkZ2VzLmxlbmd0aDtcclxuICAgICAgICBsZXQgaGFsZmVkZ2U7XHJcbiAgICAgICAgbGV0IHYsIHAxLCBwMjtcclxuXHJcbiAgICAgICAgd2hpbGUgKGlIYWxmZWRnZS0tKSB7XHJcbiAgICAgICAgICAgIGhhbGZlZGdlID0gaGFsZmVkZ2VzW2lIYWxmZWRnZV07XHJcblxyXG4gICAgICAgICAgICBwMSA9IGhhbGZlZGdlLmdldFN0YXJ0cG9pbnQoKTtcclxuICAgICAgICAgICAgcDIgPSBoYWxmZWRnZS5nZXRFbmRwb2ludCgpO1xyXG5cclxuICAgICAgICAgICAgdiA9IHAxLnggKiBwMi55IC0gcDIueCAqIHAxLnk7XHJcblxyXG4gICAgICAgICAgICB4ICs9IChwMS54ICsgcDIueCkgKiB2O1xyXG4gICAgICAgICAgICB5ICs9IChwMS55ICsgcDIueSkgKiB2O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdiA9IHRoaXMuY2VsbEFyZWEoY2VsbCkgKiA2O1xyXG5cclxuICAgICAgICByZXR1cm4geyB4OiB4IC8gdiwgeTogeSAvIHYgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb252ZXJ0RGlhZ3JhbSh2b3Jvbm9pKSB7XHJcbiAgICAgICAgY29uc3QgY2VudGVyTG9va3VwID0ge307XHJcbiAgICAgICAgY29uc3QgY29ybmVyTG9va3VwID0ge307XHJcbiAgICAgICAgdGhpcy5jZW50ZXJzID0gW107XHJcbiAgICAgICAgdGhpcy5jb3JuZXJzID0gW107XHJcbiAgICAgICAgdGhpcy5lZGdlcyA9IFtdO1xyXG5cclxuICAgICAgICBsZXQgY29ybmVySWQgPSAwO1xyXG4gICAgICAgIGxldCBlZGdlSWQgPSAwO1xyXG5cclxuICAgICAgICAvLyBDb3B5IG92ZXIgYWxsIHRoZSBjZW50ZXIgbm9kZXNcclxuICAgICAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygdm9yb25vaS5jZWxscykge1xyXG4gICAgICAgICAgICBjb25zdCBzaXRlID0gY2VsbC5zaXRlO1xyXG4gICAgICAgICAgICBjb25zdCBwb3MgPSBuZXcgVmVjdG9yKHNpdGUueCwgc2l0ZS55KTtcclxuICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbmV3IENlbnRlcihwb3MpO1xyXG4gICAgICAgICAgICBjZW50ZXIuaWQgPSBzaXRlLnZvcm9ub2lJZDtcclxuICAgICAgICAgICAgY2VudGVyTG9va3VwW3Bvcy5rZXkoKV0gPSBjZW50ZXI7XHJcbiAgICAgICAgICAgIHRoaXMuY2VudGVycy5wdXNoKGNlbnRlcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDcmVhdGUgYW5kIGNvcHkgb3ZlciB0aGUgZWRnZXMgYW5kIGNvcm5lcnNcclxuICAgICAgICAvLyBUaGlzIHBvcnRpb24gYWxzbyBjcmVhdGVzIHRoZSBjb25uZWN0aW9ucyBiZXR3ZWVuIGFsbCB0aGUgbm9kZXNcclxuICAgICAgICBmb3IgKGxldCBlZGdlIG9mIHZvcm9ub2kuZWRnZXMpIHtcclxuXHJcbiAgICAgICAgICAgIC8vIENvbnZlcnQgdm9yb25vaSBlZGdlIHRvIGEgdXNlYWJsZSBmb3JtXHJcbiAgICAgICAgICAgIC8vIENvcm5lciBwb3NpdGlvbnNcclxuICAgICAgICAgICAgY29uc3QgdmEgPSBuZXcgVmVjdG9yKE1hdGgucm91bmQoZWRnZS52YS54KSwgTWF0aC5yb3VuZChlZGdlLnZhLnkpKTtcclxuICAgICAgICAgICAgY29uc3QgdmIgPSBuZXcgVmVjdG9yKE1hdGgucm91bmQoZWRnZS52Yi54KSwgTWF0aC5yb3VuZChlZGdlLnZiLnkpKTtcclxuICAgICAgICAgICAgLy8gQ2VudGVyIHBvc2l0aW9uc1xyXG4gICAgICAgICAgICBjb25zdCBzaXRlMSA9IG5ldyBWZWN0b3IoZWRnZS5sU2l0ZS54LCBlZGdlLmxTaXRlLnkpO1xyXG4gICAgICAgICAgICBjb25zdCBzaXRlMiA9IGVkZ2UuclNpdGUgPyBuZXcgVmVjdG9yKGVkZ2UuclNpdGUueCwgZWRnZS5yU2l0ZS55KSA6IG51bGw7XHJcblxyXG4gICAgICAgICAgICAvLyBMb29rdXAgdGhlIHR3byBjZW50ZXIgb2JqZWN0c1xyXG4gICAgICAgICAgICBjb25zdCBjZW50ZXIxID0gY2VudGVyTG9va3VwW3NpdGUxLmtleSgpXTtcclxuICAgICAgICAgICAgY29uc3QgY2VudGVyMiA9IHNpdGUyID8gY2VudGVyTG9va3VwW3NpdGUyLmtleSgpXSA6IG51bGw7XHJcblxyXG4gICAgICAgICAgICAvLyBMb29rdXAgdGhlIGNvcm5lciBvYmplY3RzIGFuZCBpZiBvbmUgaXNuJ3QgY3JlYXRlZFxyXG4gICAgICAgICAgICAvLyBjcmVhdGUgb25lIGFuZCBhZGQgaXQgdG8gY29ybmVycyBzZXRcclxuICAgICAgICAgICAgbGV0IGNvcm5lcjE7XHJcbiAgICAgICAgICAgIGxldCBjb3JuZXIyO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgaXNCb3JkZXIgPSAocG9pbnQsIGJib3gpID0+IHBvaW50LnggPD0gYmJveC54bCB8fCBwb2ludC54ID49IGJib3gueHIgfHxcclxuICAgICAgICAgICAgICAgIHBvaW50LnkgPD0gYmJveC55dCB8fCBwb2ludC55ID49IGJib3gueWI7XHJcblxyXG4gICAgICAgICAgICBpZiAoIWhhcyhjb3JuZXJMb29rdXAsIHZhLmtleSgpKSkge1xyXG4gICAgICAgICAgICAgICAgY29ybmVyMSA9IG5ldyBDb3JuZXIodmEpO1xyXG4gICAgICAgICAgICAgICAgY29ybmVyMS5pZCA9IGNvcm5lcklkKys7XHJcbiAgICAgICAgICAgICAgICBjb3JuZXIxLmJvcmRlciA9IGlzQm9yZGVyKHZhLCB0aGlzLmJib3gpO1xyXG4gICAgICAgICAgICAgICAgY29ybmVyTG9va3VwW3ZhLmtleSgpXSA9IGNvcm5lcjE7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmNvcm5lcnMucHVzaChjb3JuZXIxKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGNvcm5lcjEgPSBjb3JuZXJMb29rdXBbdmEua2V5KCldO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICghaGFzKGNvcm5lckxvb2t1cCwgdmIua2V5KCkpKSB7XHJcbiAgICAgICAgICAgICAgICBjb3JuZXIyID0gbmV3IENvcm5lcih2Yik7XHJcbiAgICAgICAgICAgICAgICBjb3JuZXIyLmlkID0gY29ybmVySWQrKztcclxuICAgICAgICAgICAgICAgIGNvcm5lcjIuYm9yZGVyID0gaXNCb3JkZXIodmIsIHRoaXMuYmJveCk7XHJcbiAgICAgICAgICAgICAgICBjb3JuZXJMb29rdXBbdmIua2V5KCldID0gY29ybmVyMjtcclxuICAgICAgICAgICAgICAgIHRoaXMuY29ybmVycy5wdXNoKGNvcm5lcjIpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgY29ybmVyMiA9IGNvcm5lckxvb2t1cFt2Yi5rZXkoKV07XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgZWRnZSBvYmplY3RzXHJcbiAgICAgICAgICAgIGNvbnN0IG5ld0VkZ2UgPSBuZXcgRWRnZSgpO1xyXG4gICAgICAgICAgICBuZXdFZGdlLmlkID0gZWRnZUlkKys7XHJcbiAgICAgICAgICAgIG5ld0VkZ2UuZDAgPSBjZW50ZXIxO1xyXG4gICAgICAgICAgICBuZXdFZGdlLmQxID0gY2VudGVyMjtcclxuICAgICAgICAgICAgbmV3RWRnZS52MCA9IGNvcm5lcjE7XHJcbiAgICAgICAgICAgIG5ld0VkZ2UudjEgPSBjb3JuZXIyO1xyXG4gICAgICAgICAgICBuZXdFZGdlLm1pZHBvaW50ID0gVmVjdG9yLm1pZHBvaW50KGNvcm5lcjEsIGNvcm5lcjIpO1xyXG5cclxuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBjb3JuZXIgb2JqZWN0c1xyXG4gICAgICAgICAgICBjb3JuZXIxLnByb3RydWRlcy5wdXNoKG5ld0VkZ2UpO1xyXG4gICAgICAgICAgICBjb3JuZXIyLnByb3RydWRlcy5wdXNoKG5ld0VkZ2UpO1xyXG5cclxuICAgICAgICAgICAgaWYgKCFjb3JuZXIxLnRvdWNoZXMuaW5jbHVkZXMoY2VudGVyMSkpIHtcclxuICAgICAgICAgICAgICAgIGNvcm5lcjEudG91Y2hlcy5wdXNoKGNlbnRlcjEpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChjZW50ZXIyICYmICFjb3JuZXIxLnRvdWNoZXMuaW5jbHVkZXMoY2VudGVyMikpIHtcclxuICAgICAgICAgICAgICAgIGNvcm5lcjEudG91Y2hlcy5wdXNoKGNlbnRlcjIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICghY29ybmVyMi50b3VjaGVzLmluY2x1ZGVzKGNlbnRlcjEpKSB7XHJcbiAgICAgICAgICAgICAgICBjb3JuZXIyLnRvdWNoZXMucHVzaChjZW50ZXIxKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoY2VudGVyMiAmJiAhY29ybmVyMi50b3VjaGVzLmluY2x1ZGVzKGNlbnRlcjIpKSB7XHJcbiAgICAgICAgICAgICAgICBjb3JuZXIyLnRvdWNoZXMucHVzaChjZW50ZXIyKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29ybmVyMS5hZGphY2VudC5wdXNoKGNvcm5lcjIpO1xyXG4gICAgICAgICAgICBjb3JuZXIyLmFkamFjZW50LnB1c2goY29ybmVyMSk7XHJcblxyXG4gICAgICAgICAgICAvLyBVcGRhdGUgdGhlIGNlbnRlciBvYmplY3RzXHJcbiAgICAgICAgICAgIGNlbnRlcjEuYm9yZGVycy5wdXNoKG5ld0VkZ2UpO1xyXG4gICAgICAgICAgICBpZiAoY2VudGVyMikge1xyXG4gICAgICAgICAgICAgICAgY2VudGVyMi5ib3JkZXJzLnB1c2gobmV3RWRnZSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmICghY2VudGVyMS5jb3JuZXJzLmluY2x1ZGVzKGNvcm5lcjEpKSB7XHJcbiAgICAgICAgICAgICAgICBjZW50ZXIxLmNvcm5lcnMucHVzaChjb3JuZXIxKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoIWNlbnRlcjEuY29ybmVycy5pbmNsdWRlcyhjb3JuZXIyKSkge1xyXG4gICAgICAgICAgICAgICAgY2VudGVyMS5jb3JuZXJzLnB1c2goY29ybmVyMik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGNlbnRlcjIgJiYgIWNlbnRlcjIuY29ybmVycy5pbmNsdWRlcyhjb3JuZXIxKSkge1xyXG4gICAgICAgICAgICAgICAgY2VudGVyMi5jb3JuZXJzLnB1c2goY29ybmVyMSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGNlbnRlcjIgJiYgIWNlbnRlcjIuY29ybmVycy5pbmNsdWRlcyhjb3JuZXIyKSkge1xyXG4gICAgICAgICAgICAgICAgY2VudGVyMi5jb3JuZXJzLnB1c2goY29ybmVyMik7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChjZW50ZXIyKSB7XHJcbiAgICAgICAgICAgICAgICBjZW50ZXIxLm5laWdoYm9ycy5wdXNoKGNlbnRlcjIpO1xyXG4gICAgICAgICAgICAgICAgY2VudGVyMi5uZWlnaGJvcnMucHVzaChjZW50ZXIxKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gSWYgZWl0aGVyIGNvcm5lciBpcyBhIGJvcmRlciwgYm90aCBjZW50ZXJzIGFyZSBib3JkZXJzXHJcbiAgICAgICAgICAgIGNlbnRlcjEuYm9yZGVyID0gY2VudGVyMS5ib3JkZXIgfHwgY29ybmVyMS5ib3JkZXIgfHwgY29ybmVyMi5ib3JkZXI7XHJcbiAgICAgICAgICAgIGlmIChjZW50ZXIyKSB7XHJcbiAgICAgICAgICAgICAgICBjZW50ZXIyLmJvcmRlciA9IGNlbnRlcjIuYm9yZGVyIHx8IGNvcm5lcjEuYm9yZGVyIHx8IGNvcm5lcjIuYm9yZGVyO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB0aGlzLmVkZ2VzLnB1c2gobmV3RWRnZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIGdyYXBoXHJcbiAgICAvL1xyXG4gICAgLy8gTGxveWQgcmVsYXhhdGlvbiBoZWxwZWQgdG8gY3JlYXRlIHVuaWZvcm1pdHkgYW1vbmcgcG9seWdvbiBjb3JuZXJzLFxyXG4gICAgLy8gVGhpcyBmdW5jdGlvbiBjcmVhdGVzIHVuaWZvcm1pdHkgYW1vbmcgcG9seWdvbiBjb3JuZXJzIGJ5IHNldHRpbmcgdGhlIGNvcm5lcnNcclxuICAgIC8vIHRvIHRoZSBhdmVyYWdlIG9mIHRoZWlyIG5laWdoYm9yc1xyXG4gICAgLy8gVGhpcyBicmVha2VzIHRoZSB2b3Jvbm9pIGRpYWdyYW0gcHJvcGVydGllc1xyXG4gICAgaW1wcm92ZUNvcm5lcnMoKSB7XHJcbiAgICAgICAgY29uc3QgbmV3Q29ybmVycyA9IFtdO1xyXG5cclxuICAgICAgICAvLyBDYWxjdWxhdGUgbmV3IGNvcm5lciBwb3NpdGlvbnNcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuY29ybmVycy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICBsZXQgY29ybmVyID0gdGhpcy5jb3JuZXJzW2ldO1xyXG5cclxuICAgICAgICAgICAgaWYgKGNvcm5lci5ib3JkZXIpIHtcclxuICAgICAgICAgICAgICAgIG5ld0Nvcm5lcnNbaV0gPSBjb3JuZXI7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBsZXQgbmV3UG9zID0gVmVjdG9yLnplcm8oKTtcclxuXHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IG5laWdoYm9yIG9mIGNvcm5lci50b3VjaGVzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmV3UG9zID0gVmVjdG9yLmFkZChuZXdQb3MsIG5laWdoYm9yKTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBuZXdQb3MgPSBuZXdQb3MuZGl2aWRlKGNvcm5lci50b3VjaGVzLmxlbmd0aCk7XHJcbiAgICAgICAgICAgICAgICBuZXdDb3JuZXJzW2ldID0gbmV3UG9zO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBBc3NpZ24gbmV3IGNvcm5lciBwb3NpdGlvbnNcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuY29ybmVycy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICBsZXQgY29ybmVyID0gdGhpcy5jb3JuZXJzW2ldO1xyXG4gICAgICAgICAgICBjb3JuZXIgPSBuZXdDb3JuZXJzW2ldO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gUmVjb21wdXRlIGVkZ2UgbWlkcG9pbnRzXHJcbiAgICAgICAgZm9yIChjb25zdCBlZGdlIG9mIHRoaXMuZWRnZXMpIHtcclxuICAgICAgICAgICAgaWYgKGVkZ2UudjAgJiYgZWRnZS52MSkge1xyXG4gICAgICAgICAgICAgICAgZWRnZS5taWRwb2ludCA9IFZlY3Rvci5taWRwb2ludChlZGdlLnYwLCBlZGdlLnYxKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gU29ydHMgdGhlIGNvcm5lcnMgaW4gY2xvY2t3aXNlIG9yZGVyIHNvIHRoYXQgdGhleSBjYW4gYmUgcHJpbnRlZCBwcm9wZXJseVxyXG4gICAgLy8gdXNpbmcgYSBzdGFuZGFyZCBwb2x5Z29uIGRyYXdpbmcgbWV0aG9kXHJcblxyXG4gICAgc29ydENvcm5lcnMoKSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBjZW50ZXIgb2YgdGhpcy5jZW50ZXJzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbXAgPSB0aGlzLmNvbXBhcmVQb2x5UG9pbnRzKGNlbnRlcik7XHJcbiAgICAgICAgICAgIGNlbnRlci5jb3JuZXJzLnNvcnQoY29tcCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBDb21wYXJpc29uIGZ1bmN0aW9uIGZvciBzb3J0aW5nIHBvbHlnb24gcG9pbnRzIGluIGNsb2Nrd2lzZSBvcmRlclxyXG4gICAgLy8gYXNzdW1pbmcgYSBjb252ZXggcG9seWdvblxyXG4gICAgLy8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy82OTg5MTAwL3NvcnQtcG9pbnRzLWluLWNsb2Nrd2lzZS1vcmRlclxyXG4gICAgY29tcGFyZVBvbHlQb2ludHMoYykge1xyXG4gICAgICAgIGNvbnN0IGNlbnRlciA9IGM7XHJcbiAgICAgICAgcmV0dXJuIChwMSwgcDIpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYSA9IHAxLFxyXG4gICAgICAgICAgICAgICAgYiA9IHAyO1xyXG5cclxuICAgICAgICAgICAgaWYgKGEueCAtIGNlbnRlci54ID49IDAgJiYgYi54IC0gY2VudGVyLnggPCAwKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gLTE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGEueCAtIGNlbnRlci54IDwgMCAmJiBiLnggLSBjZW50ZXIueCA+PSAwKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gMTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoYS54IC0gY2VudGVyLnggPT09IDAgJiYgYi54IC0gY2VudGVyLnggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIGlmIChhLnkgLSBjZW50ZXIueSA+PSAwIHx8IGIueSAtIGNlbnRlci55ID49IDApIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYS55ID4gYi55KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAtMTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gMTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAoYi55ID4gYS55KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIC0xO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gMTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gY29tcHV0ZSB0aGUgY3Jvc3MgcHJvZHVjdCBvZiB2ZWN0b3JzIChjZW50ZXIgLT4gYSkgeCAoY2VudGVyIC0+IGIpXHJcbiAgICAgICAgICAgIGNvbnN0IGRldCA9IChhLnggLSBjZW50ZXIueCkgKiAoYi55IC0gY2VudGVyLnkpIC0gKGIueCAtIGNlbnRlci54KSAqIChhLnkgLSBjZW50ZXIueSk7XHJcbiAgICAgICAgICAgIGlmIChkZXQgPCAwKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gLTE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGRldCA+IDApIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiAxO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBwb2ludHMgYSBhbmQgYiBhcmUgb24gdGhlIHNhbWUgbGluZSBmcm9tIHRoZSBjZW50ZXJcclxuICAgICAgICAgICAgLy8gY2hlY2sgd2hpY2ggcG9pbnQgaXMgY2xvc2VyIHRvIHRoZSBjZW50ZXJcclxuICAgICAgICAgICAgY29uc3QgZDEgPSAoYS54IC0gY2VudGVyLngpICogKGEueCAtIGNlbnRlci54KSArIChhLnkgLSBjZW50ZXIueSkgKiAoYS55IC0gY2VudGVyLnkpO1xyXG4gICAgICAgICAgICBjb25zdCBkMiA9IChiLnggLSBjZW50ZXIueCkgKiAoYi54IC0gY2VudGVyLngpICsgKGIueSAtIGNlbnRlci55KSAqIChiLnkgLSBjZW50ZXIueSk7XHJcbiAgICAgICAgICAgIGlmIChkMSA+IGQyKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gLTE7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gMTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgR3JhcGg7IiwiaW1wb3J0IFBvbHlnb24gZnJvbSBcIi4uL2dlb21ldHJ5L1BvbHlnb25cIlxyXG5pbXBvcnQgR3JhcGggZnJvbSBcIi4vR3JhcGhcIjtcclxuXHJcbmNsYXNzIFRpbGUgZXh0ZW5kcyBQb2x5Z29uIHtcclxuICAgIGNvbnN0cnVjdG9yKGNlbnRlciwgY29ybmVycywgZWRnZXMpIHtcclxuICAgICAgICBcclxuICAgICAgICBzdXBlcihjb3JuZXJzLCBjZW50ZXIpOztcclxuICAgICAgICB0aGlzLmVkZ2VzID0gZWRnZXM7XHJcbiAgICAgICAgdGhpcy5uZWlnaGJvcnMgPSBbXTtcclxuXHJcbiAgICAgICAgLy8gUmVjdXJzaXZlIFBhcmFtZXRlcnNcclxuICAgICAgICB0aGlzLnBhcmVudCA9IHBhcmVudDtcclxuICAgICAgICB0aGlzLmNoaWxkcmVuID0gY2hpbGRyZW4gPyBjaGlsZHJlbiA6IFtdO1xyXG4gICAgfVxyXG59IiwiaW1wb3J0IFZlY3RvciBmcm9tIFwiLi9nZW9tZXRyeS9WZWN0b3JcIjtcclxuaW1wb3J0IExpbmUgZnJvbSBcIi4vZ2VvbWV0cnkvTGluZVwiO1xyXG5pbXBvcnQgUG9seWdvbiBmcm9tIFwiLi9nZW9tZXRyeS9Qb2x5Z29uXCI7XHJcbmltcG9ydCBSZWN0YW5nbGUgZnJvbSBcIi4vZ2VvbWV0cnkvUmVjdGFuZ2xlXCI7XHJcbmltcG9ydCBUcmlhbmdsZSBmcm9tIFwiLi9nZW9tZXRyeS9UcmlhbmdsZVwiO1xyXG5pbXBvcnQgQ2VudGVyIGZyb20gXCIuL2dyYXBoL0NlbnRlclwiO1xyXG5pbXBvcnQgQ29ybmVyIGZyb20gXCIuL2dyYXBoL0Nvcm5lclwiO1xyXG5pbXBvcnQgRWRnZSBmcm9tIFwiLi9ncmFwaC9FZGdlXCI7XHJcbmltcG9ydCBHcmFwaCBmcm9tIFwiLi9ncmFwaC9HcmFwaFwiO1xyXG5pbXBvcnQgRGlhZ3JhbSBmcm9tIFwiLi9ncmFwaC9EaWFncmFtXCI7XHJcbmltcG9ydCAqIGFzIFBvaW50RGlzdHJpYnV0aW9uIGZyb20gXCIuL1V0aWxpdGllcy9Qb2ludERpc3RyaWJ1dGlvblwiO1xyXG5pbXBvcnQgKiBhcyBSZWRpc3QgZnJvbSBcIi4vdXRpbGl0aWVzL1JlZGlzdFwiO1xyXG5pbXBvcnQgUmFuZCBmcm9tIFwiLi91dGlsaXRpZXMvUmFuZFwiO1xyXG5cclxuLyoqXHJcbiAqIFRoZSBBdHVtIHByb2NlZHVyYWwgZ3JhcGggYmFzZWQgbGlicmFyeVxyXG4gKiBcclxuICogQGV4cG9ydFxyXG4gKiBAbW9kdWxlIEF0dW1cclxuICogQHNlZSB7QGxpbmsgaHR0cHM6Ly9naXRodWIuY29tL0V2ZWxpb3MvQXR1bX1cclxuICovXHJcbmNvbnN0IEF0dW0gPSB7XHJcbiAgICBHZW9tZXRyeToge1xyXG4gICAgICAgIFZlY3RvcixcclxuICAgICAgICBMaW5lLFxyXG4gICAgICAgIFBvbHlnb24sXHJcbiAgICAgICAgUmVjdGFuZ2xlLFxyXG4gICAgICAgIFRyaWFuZ2xlXHJcbiAgICB9LFxyXG4gICAgR3JhcGg6IHtcclxuICAgICAgICBDZW50ZXIsXHJcbiAgICAgICAgQ29ybmVyLFxyXG4gICAgICAgIEVkZ2UsXHJcbiAgICAgICAgR3JhcGgsXHJcbiAgICAgICAgRGlhZ3JhbVxyXG4gICAgfSxcclxuICAgIFV0aWxpdHk6IHtcclxuICAgICAgICBQb2ludERpc3RyaWJ1dGlvbixcclxuICAgICAgICBSZWRpc3QsXHJcbiAgICAgICAgUmFuZFxyXG4gICAgfVxyXG59O1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgQXR1bTsiLCIvKipcclxuICogVGhlc2VzIGZ1bmN0aW9uIGFyZSB1c2VkIHRvIHJlZGlzdHJpYnV0ZSBkYXRhIGxvY2F0ZWQgaW4gdGhlIHJhbmdlIDAtMVxyXG4gKiBUaGV5IHRha2UgYWxsIHRoZSBkYXRhIGFuZCByZWFycmFuZ2UgdGhlbSBhbmQgcHVydHVyYmUgdGhlbSBzbGlnaHRseSBzbyB0aGF0XHJcbiAqIHRoZXkgZml0IGEgcGFydGljdWxhciBkaXN0cnVidXRpb24gZnVuY3Rpb24uIEZvciBleGFtcGxlIHlvdSBjYW4gdXNlIHRoZXNlXHJcbiAqIHRvIHB1c2ggYWxsIHRoZSBkYXRhIHBvaW50cyBjbG9zZXIgdG8gMSBzbyB0aGF0IHRoZXJlIGFyZSBmZXcgcG9pbnRzIG5lYXIgMFxyXG4gKiBlYWNoIHJlZGlzdHJpYnV0aW9uIGZ1bmN0aW9uIGhhcyBkaWZmZXJlbnQgcHJvcGVydGllcy5cclxuICpcclxuICogUHJvcGVydGllcyBvZiB0aGVzZSBmdW5jdGlvbnNcclxuICogdGhlIGRvbWFpbiBpcyAoMC0xKSBmb3IgdGhlIHJhbmdlICgwLTEpXHJcbiAqIGluIHRoaXMgcmFuZ2UgdGhlIGZ1bmN0aW9uIGlzIG9uZSB0byBvbmVcclxuICogZigwKSA9PSAwIGFuZCBmKDEpID09IDFcclxuICogXHJcbiAqIEBzdW1tYXJ5IEZ1bmN0aW9ucyB1c2VkIHRvIHJlZGlzdHJ1YnV0ZSB2YWx1ZXMgaW4gdGhlIHJhbmdlIDAtMVxyXG4gKiBAY2xhc3MgUmVkaXN0XHJcbiAqL1xyXG5cclxuXCJ1c2Ugc3RyaWN0XCI7XHJcblxyXG4vKipcclxuICogVGhlIGlkZW50aXR5IGZ1bmN0aW9uLiBJdCByZXR1cm5zIHRoZSBpbnB1dCB2YWx1ZSB4XHJcbiAqIFxyXG4gKiBAZXhwb3J0XHJcbiAqIEBmdW5jdGlvblxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgaW5wdXQgbnVtYmVyIGluIHRoZSByYW5nZSBbMC0xXVxyXG4gKiBAcmV0dXJucyB7TnVtYmVyfSBJbnB1dCB2YWx1ZVxyXG4gKiBAbWVtYmVyb2YgUmVkaXN0XHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaWRlbnRpdHkoeCkge1xyXG4gICAgcmV0dXJuIHg7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBUaGUgaW52ZXJzZSBmdWN0aW9uLiBJdCByZXR1cm5zIHRoZSBvcHBvc2l0ZSBvZiB0aGUgZnVuY3Rpb24gaW4gdGhlIHJhbmdlXHJcbiAqIGZyb20gWzAtMV0uIFRoaXMgaXMgc2ltcGx5IDEgLSB4LlxyXG4gKiBcclxuICogQGV4cG9ydFxyXG4gKiBAZnVuY3Rpb25cclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIGlucHV0IG51bWJlciBpbiB0aGUgcmFuZ2UgWzAtMV1cclxuICogQHJldHVybnMge051bWJlcn0gVGhlIHJlZGlzdHJpYnV0ZWQgaW5wdXQgdmFsdWUsIDEgLSB4XHJcbiAqIEBtZW1iZXJvZiBSZWRpc3RcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpbnZlcnNlKHgpIHtcclxuICAgIHJldHVybiAxIC0geDtcclxufVxyXG5cclxuLyoqXHJcbiAqIEV4cG9uZW50aWFsIHJlZGlzdHJpYnV0aW9uIGZ1bmN0aW9uLiBUaGlzIGZ1bmN0aW9uIHNrZXdzIHRoZSB2YWx1ZXMgZWl0aGVyXHJcbiAqIHVwIG9yIGRvd24gYnkgYSBwYXJ0aWN1bGFyIGFtbW91bnQgYWNjb3JkaW5nIHRoZSBpbnB1dCBwYXJhbWV0ZXJzLiBUaGVcclxuICogb3V0cHV0IGRpc3RyaWJ1dGlvbiB3aWxsIGJlIHNsaWdodCBleHBvbmVudGlhbCBzaGFwZWQuXHJcbiAqIFxyXG4gKiBAZXhwb3J0XHJcbiAqIEBmdW5jdGlvblxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgaW5wdXQgbnVtYmVyIGluIHRoZSByYW5nZSBbMC0xXVxyXG4gKiBAcGFyYW0ge051bWJlcn0gW2FtbT0xXSBUaGUgc3RyZW5ndGggb2YgdGhlIHJlZGlzdHJpYnV0aW9uXHJcbiAqIEBwYXJhbSB7Qm9vbGVhbn0gW2luYz10cnVlXSBJZiB5b3Ugd2FudCB0byBpbmNyZWFzZSBvciBkZWNyZWFzZSB0aGUgaW5wdXRcclxuICogQHJldHVybnMge051bWJlcn0gVGhlIHJlZGlzdHJpYnV0ZWQgaW5wdXQgdmFsdWVcclxuICogQG1lbWJlcm9mIFJlZGlzdFxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGV4cCh4LCBhbW0gPSAxLCBpbmMgPSB0cnVlKSB7XHJcbiAgICBsZXQgbm9tLCBkZW5vbTtcclxuICAgIGlmIChpbmMpIHtcclxuICAgICAgICBub20gPSAxIC0gTWF0aC5leHAoLWFtbSAqIHgpO1xyXG4gICAgICAgIGRlbm9tID0gMSAtIE1hdGguZXhwKC1hbW0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBub20gPSBNYXRoLmV4cChhbW0gKiB4KSAtIDE7XHJcbiAgICAgICAgZGVub20gPSBNYXRoLmV4cChhbW0pIC0gMTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbm9tIC8gZGVub207XHJcbn1cclxuXHJcbi8vIFBvd2VyIEZ1bmN0aW9uIGVnIHNxcnQgcXVicnRcclxuLyoqXHJcbiAqIFBvd2VyIHJlZGlzdHJpYnV0aW9uIGZ1bmN0aW9uLiBUaGlzIGZ1bmN0aW9uIHNrZXdzIHZhbHVlcyBlaXRoZXIgdXAgb3IgZG93blxyXG4gKiBieSBhIHBhcnRpY3VsYXIgYW1tb3VudCBhY2NvcmRpbmcgdG8gdGhlIGlucHV0IHBhcmFtZXRlcnMuIFRoZSBwb3dlciBcclxuICogZGlzdHJpYnV0aW9uIGFsc28gaGFzIGEgc2xpZ2h0IHNrZXcgdXAgb3IgZG93biBvbiB0b3Agb2YgdGhlIHJlZGlzdHJpYnV0aW9uLlxyXG4gKiBcclxuICogQGV4cG9ydFxyXG4gKiBAZnVuY3Rpb25cclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIGlucHV0IG51bWJlciBpbiB0aGUgcmFuZ2UgWzAtMV0gXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBbYW1tPTJdIFRoZSBzdHJlbmd0aCBvZiB0aGUgcmVkaXN0cmlidXRpb25cclxuICogQHBhcmFtIHtCb29sZWFufSBbaW5jPXRydWVdIElmIHlvdSB3YW50IHRvIGluY3JlYXNlIG9yIGRlY3JlYXNlIHRoZSBpbnB1dFxyXG4gKiBAcGFyYW0ge0Jvb2xlYW59IFtza2V3RG93bj10cnVlXSBJZiB5b3Ugd2FudCB0byBza2V3IHRoZSBpbnB1dCB2YWx1ZSBkb3duXHJcbiAqICB0b3dhcmRzIDAsIHRoZW4gc2tld0Rvd249dHJ1ZS4gSWYgeW91IHdhbnQgdG8gc2tldyB0aGUgaW5wdXQgdmFsdWUgdXAgXHJcbiAqICB0b3dhcmRzIDEsIHRoZW4gc2tld0Rvd249ZmFsc2VcclxuICogQHJldHVybnMge051bWJlcn0gVGhlIHJlZGlzdHJpYnV0ZWQgaW5wdXQgdmFsdWVcclxuICogQG1lbWJlcm9mIFJlZGlzdFxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHBvdyh4LCBhbW0gPSAyLCBpbmMgPSB0cnVlLCBza2V3RG93biA9IHRydWUpIHtcclxuICAgIGlmIChpbmMpIHtcclxuICAgICAgICBpZiAoc2tld0Rvd24pIHtcclxuICAgICAgICAgICAgcmV0dXJuIE1hdGgucG93KHgsIDEgLyBhbW0pO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJldHVybiAxIC0gTWF0aC5wb3coMSAtIHgsIGFtbSk7XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBpZiAoc2tld0Rvd24pIHtcclxuICAgICAgICAgICAgcmV0dXJuIE1hdGgucG93KHgsIGFtbSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmV0dXJuIDEgLSBNYXRoLnBvdygxIC0geCwgMSAvIGFtbSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogVHVybnMgYSBjb250aW5pb3VzIGZ1bmN0aW9uIGFuZCB0dXJucyBpdCBpbnRvIGEgZGlzY3JldGUgZnVuY3Rpb24gdGhhdCBoYXNcclxuICogYSBzcGVjaWZpYyBudW1iZXIgb2YgYmlucyB0byBidXQgdGhlIGRpc3RyaWJ1dGlvbiBpbnRvLlxyXG4gKiBcclxuICogQGV4cG9ydFxyXG4gKiBAZnVuY3Rpb25cclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIGlucHV0IG51bWJlciBpbiB0aGUgcmFuZ2UgWzAtMV1cclxuICogQHBhcmFtIHtOdW1iZXJ9IFtiaW5zPTEwXSBUaGUgbnVtYmVyIG9mIGJpbnMgZm9yIHRoZSBkaXNjcml0ZSBkaXN0cmlidXRpb25cclxuICogQHJldHVybnMge051bWJlcn0gVGhlIGRpc2NyZXRpemVkIGlucHV0IHZhbHVlXHJcbiAqIEBtZW1iZXJvZiBSZWRpc3RcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBzdGVwKHgsIGJpbnMgPSAxMCkge1xyXG4gICAgcmV0dXJuIE1hdGguZmxvb3IoYmlucyAqIHgpIC8gYmlucztcclxufSIsIi8qKlxyXG4gKiBBIHV0aWxpdHkgZmlsZSB3aXRoIGhlbHBlciBmdW5jdGlvbnMgdGhhdCBjYW4gYmUgdXNlZCB0byBhaWQgaW4gdGhlXHJcbiAqIGRldmVsb3BtZW50IG9mIHRoZSBwYWNrYWdlLlxyXG4gKi9cclxuXCJ1c2Ugc3RyaWN0XCI7XHJcblxyXG4vLyBVc2VkIGZvciB0ZXN0aW5nIGlmIGFuIG9iamVjdCBjb250YWlucyBhIHBhcnRpY3VsYXIgcHJvcGVydHlcclxuLy8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy83MTc0NzQ4L2phdmFzY3JpcHQtb2JqZWN0LWRldGVjdGlvbi1kb3Qtc3ludGF4LXZlcnN1cy1pbi1rZXl3b3JkLzcxNzQ3NzUjNzE3NDc3NVxyXG5leHBvcnQgY29uc3QgaGFzID0gKG9iaiwgcHJvcCkgPT4geyByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iaiwgcHJvcCk7IH07Il19
