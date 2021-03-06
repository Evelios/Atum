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

},{"../geometry/Rectangle":19,"../geometry/Vector":21,"./Rand":13,"poisson-disk-sample":3}],13:[function(require,module,exports){
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
         * @memberof Rand
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
         * @memberof Rand
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
         * @memberof Rand
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
         * @memberof Rand
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
         * @memberof Rand
         */

    }, {
        key: "randHex",


        /**
         * Get the random hex value of a color represented in the hexidecimal format
         * 
         * @returns {hex} 
         * 
         * @memberof Rand
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
         * @memberof Rand
         */

    }, {
        key: "randHexColor",


        /**
         * Get a random hex color string represented in "#HEXSTR" format
         * 
         * @static
         * @returns {string}
         * 
         * @memberof Rand
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
         * @memberof Rand
         */

    }, {
        key: "vector",


        /**
         * Get a random vector in a bounding box
         * 
         * @param {Rectangle} bbox The bounding box of the random vector
         * @returns {Vector} A random vector
         * 
         * @memberof Rand
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
            if (percent === 0) {
                return false;
            } else {
                return rng.rand() < percent;
            }
        }

        /**
         * Roll for a boolean value that is true @percent ammount of the time.
         * If the roll fails then return false. For example calling chance(0.3)
         * will return true 30% of the time. The input range
         * 
         * @static
         * @param {number} percent Percent chance to get True. Value is in the range
         *  from 0 - 1. With 1 returning always true.
         * @memberof Rand
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
         * @memberof Rand
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
         * @memberof Rand
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
         * @memberof Rand
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
         * @memberof Rand
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

},{"../geometry/Vector":21,"seedRandom":4}],14:[function(require,module,exports){
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
 * @returns {Rect} The root node of the BSP Tree. The node has the properties
 *  {  
 *      leftNode: the left rect node in the tree
 *      rightNode: the right rect node in the tree
 *  }
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
    // This is a way of redistributing 2 > 100 (aka infinity) where the useable
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

        if (node.depth < params.depth) {
            frontier.push(leftNode);
            frontier.push(rightNode);
        }
    }

    return root;
}
module.exports = exports["default"];

},{"../geometry/Rectangle":19,"../geometry/Vector":21,"../utilities/Rand":30,"../utilities/Redist":31,"../utilities/Util":32}],15:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = polygonSubdivide;

var _Polygon = require("../geometry/Polygon");

var _Polygon2 = _interopRequireDefault(_Polygon);

var _Line = require("../geometry/Line");

var _Line2 = _interopRequireDefault(_Line);

var _Rand = require("../utilities/Rand");

var _Rand2 = _interopRequireDefault(_Rand);

var _Util = require("../utilities/Util");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Subdivide a polygon up into smaller polygons. The general principal of this
 * subdivision works by splitting up the polygon on its minor axis similar to
 * how a binary space partition would work.
 * 
 * @export
 * @param {Polygon} polygon 
 * @param {object} options The options that can be changed to control how the
 *  polygon subdivision works
 * 
 *  options = {
 *      depth {number}: The depth to which the subdivision occurs
 *      dropoutRate {number}: 0-1 The change a tile won't be subdivided
 *  }
 * 
 *  defaults = {
 *      depth: 3,
 *      dropoutRate: 0
 *  }
 * 
 *  @return {Polygon} The root note of the polygon subdivision tree
 */
function polygonSubdivide(polygon, options) {
    "use strict";

    var defaults = {
        depth: 3,
        dropoutRate: 0
    };

    var params = (0, _Util.setOptions)(options, defaults);

    var root = polygon;
    root.depth = 0;

    var frontier = [root];

    var _loop = function _loop() {
        var tile = frontier.pop();
        var minorAxis = tile.minorAxis();

        if (minorAxis === null || _Rand2.default.chance(params.dropoutRate)) {
            return "continue";
        }

        var corners1 = tile.corners.filter(function (corner) {
            return minorAxis.pointAboveLine(corner);
        });

        var corners2 = tile.corners.filter(function (corner) {
            return !minorAxis.pointAboveLine(corner);
        });

        corners1.push(minorAxis.p1, minorAxis.p2, minorAxis.midpoint());
        corners2.push(minorAxis.p1, minorAxis.p2, minorAxis.midpoint());

        var subpoly1 = new _Polygon2.default(corners1);
        var subpoly2 = new _Polygon2.default(corners2);

        subpoly1.depth = tile.depth + 1;
        subpoly2.depth = tile.depth + 1;

        tile.children = [subpoly1, subpoly2];

        if (subpoly1.depth <= params.depth) {
            frontier.push(subpoly1, subpoly2);
        }
    };

    while (frontier.length > 0) {
        var _ret = _loop();

        if (_ret === "continue") continue;
    }

    return root;
}
module.exports = exports["default"];

},{"../geometry/Line":17,"../geometry/Polygon":18,"../utilities/Rand":30,"../utilities/Util":32}],16:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = recursiveVoronoi;

var _Diagram = require("../graph/Diagram");

var _Diagram2 = _interopRequireDefault(_Diagram);

var _Tile = require("../graph/Tile");

var _Tile2 = _interopRequireDefault(_Tile);

var _Polygon = require("../geometry/Polygon");

var _Polygon2 = _interopRequireDefault(_Polygon);

var _PointDistribution = require("../utilities/PointDistribution");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function recursiveVoronoi(bbox, depth, density) {
    "use strict";

    var diagram = new _Diagram2.default((0, _PointDistribution.poisson)(bbox, density), bbox);

    if (depth > 0) {
        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
            for (var _iterator = diagram.tiles[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                var tile = _step.value;

                tile.depth = 0;

                generateInPolygon(tile, density / 3, 1, depth);
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
    }

    return diagram;
}

function generateInPolygon(poly, density, currentDepth, maxDepth) {
    "use strict";

    var subdiagram = new _Diagram2.default((0, _PointDistribution.poisson)(poly.bbox(), density), poly.bbox());
    var subTiles = clipToRegion(subdiagram, poly);
    subTiles = subTiles.map(function (tile) {
        return _Tile2.default.fromPolygon(_Polygon2.default.intersection(poly, tile));
    });
    subTiles.forEach(function (tile) {
        return tile.depth = currentDepth + 1;
    });
    poly.children = subTiles;

    if (currentDepth !== maxDepth) {
        var _iteratorNormalCompletion2 = true;
        var _didIteratorError2 = false;
        var _iteratorError2 = undefined;

        try {
            for (var _iterator2 = subTiles[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                var tile = _step2.value;

                generateInPolygon(tile, density / 3, currentDepth + 1, maxDepth);
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
}

// Return just the tiles that remain in that region
function clipToRegion(diagram, poly) {
    "use strict";

    var internalPolys = [];
    var contains = void 0;
    var _iteratorNormalCompletion3 = true;
    var _didIteratorError3 = false;
    var _iteratorError3 = undefined;

    try {
        for (var _iterator3 = diagram.tiles[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
            var tile = _step3.value;

            contains = tile.corners.reduce(function (p, c) {
                return p || poly.contains(c);
            }, false);

            // contains = contains || poly.contains(poly.center);

            if (contains) {
                internalPolys.push(tile);
            }
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

    return internalPolys;
}
module.exports = exports["default"];

},{"../geometry/Polygon":18,"../graph/Diagram":24,"../graph/Tile":27,"../utilities/PointDistribution":29}],17:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Vector = require("./Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Util = require("../utilities/Util");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

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

    //---- Property Functions -------------------------------------------------

    /**
     * Compare the two lines for equality. Two segments are equal if they share
     * the same two endpoints.
     * 
     * @static
     * @param {any} line1 The first line
     * @param {any} line2 The second line
     * @returns {boolean} True if the two lines are equal 
     * @memberof Line
     */


    _createClass(Line, [{
        key: "equals",


        /**
         * Compare this line with the other line for equality. Two segments are
         * equal if they share the same two endpoints.
         * 
         * @param {Line} other The other line to test against
         * @returns {boolean} True if the two lines are equal 
         * @memberof Line
         */
        value: function equals(other) {
            return Line.equals(this, other);
        }

        /**
         * Get the midpoint of the line segment.
         * 
         * @return {Vector} The midpoint of the line segment
         * @memberof Line
         */

    }, {
        key: "midpoint",
        value: function midpoint() {
            return _Vector2.default.midpoint(this.p1, this.p2);
        }

        /**
         * Get the length of the line segment
         * 
         * @return {numeric} The length of the segment
         * @memberof Line
         */

    }, {
        key: "length",
        value: function length() {
            return _Vector2.default.distance(this.p1, this.p2);
        }

        /**
         * Get the slope of the line segment
         * 
         * @return {numeric} The slope of the segment
         * @memberOf Line
         */

    }, {
        key: "slope",
        value: function slope() {
            if (!this._slope) {
                this._slope = (this.p2.y - this.p1.y) / (this.p2.x - this.p1.x);
            }
            return this._slope;
        }

        //---- Member Functions ---------------------------------------------------

        /**
         * Get the perpendicular line segment to a particular line segment that
         * has a given length. The segment will be placed at the midpoint of the
         * imput line and will have the given input length.
         * 
         * @static
         * @param {Line} line The input line segment
         * @param {numeric} length The length of the output segment
         * @return {Line} The perpendicular line segment
         * @memberof Line
         */

    }, {
        key: "perpendicular",


        /**
         * Get the perpendicular line segment to this line has a given length.
         * The segment will be placed at the midpoint of the imput line and
         * will have the given input length.
         * 
         * @param {numeric} length The length of the output segment
         * @return {Line} The perpendicular line segment
         * @memberof Line
         */
        value: function perpendicular(length) {
            return Line.perpendicular(this, length);
        }

        /**
         * Returns the intersection of two line segments. If there is no
         * intersection, then the function returns null
         * 
         * @static
         * @param {Line} line1 The first line
         * @param {Line} line2 The second line
         * @return {Vector | null} The vector intersection point or null if there
         *   is no intersection point
         * @memberof Line
         * @see {@link https://www.swtestacademy.com/intersection-convex-polygons-algorithm/}
         */

    }, {
        key: "intersection",


        /**
         * Returns the intersection of this and the other segment. If there is no
         * intersection, then the function returns null
         * 
         * @param {Line} other The other line
         * @return {Vector | null} The vector intersection point or null if there
         *   is no intersection point
         * @memberof Line
         * @see {@link https://www.swtestacademy.com/intersection-convex-polygons-algorithm/}
         */
        value: function intersection(other) {
            return Line.intersection(this, other);
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

    }, {
        key: "intersects",


        /**
         * Determine this line segment intersects with the other line segment
         * 
         * @param {Line} other The other line segment
         * @return {boolean} True if the lines intersect
         * @memberof Line
         * @see {@link http://www.geeksforgeeks.org/check-if-two-given-line-segments-intersect/}
         */
        value: function intersects(other) {
            return Line.intersects(this, other);
        }

        /**
         * Test if a vector is above a particular line segment. A point is above
         * if the point is geometrically greater than a particular line segment.
         * 
         * @static
         * @param {Line} line 
         * @param {Vector} point 
         * 
         * @returns {boolean} True if the point is greater than (above) the line
         *  segment
         * @memberof Line
         */

    }, {
        key: "pointAboveLine",


        /**
         * Test if a vector is above this line segment. A point is above if
         * the point is geometrically greater than a particular line segment.
         * 
         * @param {Vector} point 
         * 
         * @returns {boolean} True if the point is greater than (above) the line
         *  segment
         * @memberof Line
         */
        value: function pointAboveLine(point) {
            return Line.pointAboveLine(this, point);
        }

        //---- Default Lines ------------------------------------------------------

    }], [{
        key: "equals",
        value: function equals(line1, line2) {
            return _Vector2.default.equals(line1.p1, line2.p1) && _Vector2.default.equals(line1.p2, line2.p2);
        }
    }, {
        key: "perpendicular",
        value: function perpendicular(line, length) {
            var midpoint = line.midpoint();
            var theta = Math.atan((line.p2.y - line.p1.y) / (line.p2.x - line.p1.x));
            var xoffset = length / 2 * Math.sin(theta);
            var yoffset = length / 2 * Math.cos(theta);

            var p1 = _Vector2.default.add(midpoint, new _Vector2.default(-xoffset, yoffset));
            var p2 = _Vector2.default.add(midpoint, new _Vector2.default(xoffset, -yoffset));

            return new Line(p1, p2);
        }
    }, {
        key: "intersection",
        value: function intersection(line1, line2) {
            var A1 = line1.p2.y - line1.p1.y;
            var B1 = line1.p1.x - line1.p2.x;
            var C1 = A1 * line1.p1.x + B1 * line1.p1.y;

            var A2 = line2.p2.y - line2.p1.y;
            var B2 = line2.p1.x - line2.p2.x;
            var C2 = A2 * line2.p1.x + B2 * line2.p1.y;

            var det = A1 * B2 - A2 * B1;
            if ((0, _Util.fequals)(det, 0)) {
                return null;
            } else {
                var x = (B2 * C1 - B1 * C2) / det;
                var y = (A1 * C2 - A2 * C1) / det;

                var onLine1 = (Math.min(line1.p1.x, line1.p2.x) < x || (0, _Util.fequals)(Math.min(line1.p1.x, line1.p2.x), x)) && (Math.max(line1.p1.x, line1.p2.x) > x || (0, _Util.fequals)(Math.max(line1.p1.x, line1.p2.x), x)) && (Math.min(line1.p1.y, line1.p2.y) < y || (0, _Util.fequals)(Math.min(line1.p1.y, line1.p2.y), y)) && (Math.max(line1.p1.y, line1.p2.y) > y || (0, _Util.fequals)(Math.max(line1.p1.y, line1.p2.y), y));

                var onLine2 = (Math.min(line2.p1.x, line2.p2.x) < x || (0, _Util.fequals)(Math.min(line2.p1.x, line2.p2.x), x)) && (Math.max(line2.p1.x, line2.p2.x) > x || (0, _Util.fequals)(Math.max(line2.p1.x, line2.p2.x), x)) && (Math.min(line2.p1.y, line2.p2.y) < y || (0, _Util.fequals)(Math.min(line2.p1.y, line2.p2.y), y)) && (Math.max(line2.p1.y, line2.p2.y) > y || (0, _Util.fequals)(Math.max(line2.p1.y, line2.p2.y), y));

                if (onLine1 && onLine2) {
                    return new _Vector2.default(x, y);
                }
            }
            return null;
        }
    }, {
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
         * @param {Line} line1 The first line to test
         * @param {Line} line2 The second line to test
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
            if (o1 === "Collinear" && Line._onSegment(line1.p1, line2.p1, line1.p2)) {
                return true;
            }

            // line1.x, line1.y and line2.x are colinear and
            // line2.y lies on segment line1.xline1.y
            if (o2 === "Collinear" && Line._onSegment(line1.p1, line2.p2, line1.p2)) {
                return true;
            }

            // line2.x, line2.y and line1.x are colinear and
            // line1.x lies on segment line2.xline2.y
            if (o3 === "Collinear" && Line._onSegment(line2.p1, line1.p1, line2.p2)) {
                return true;
            }

            // line2.x, line2.y and line1.y are colinear and
            // line1.y lies on segment line2.xline2.y
            if (o4 === "Collinear" && Line._onSegment(line2.p1, line1.p2, line2.p2)) {
                return true;
            }

            return false; // Doesn't fall in any of the above cases
        }
    }, {
        key: "pointAboveLine",
        value: function pointAboveLine(line, point) {
            var m = line.slope();
            var b = line.p1.y - m * line.p1.x;
            return point.y > m * point.x + b;
        }
    }, {
        key: "zero",
        value: function zero() {
            return new Line(_Vector2.default.zero(), _Vector2.default.zero());
        }
    }]);

    return Line;
}();

exports.default = Line;
module.exports = exports["default"];

},{"../utilities/Util":32,"./Vector":21}],18:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Vector = require("./Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Line = require("./Line");

var _Line2 = _interopRequireDefault(_Line);

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

        this.corners = corners ? Polygon._orderClockwise(corners) : [];
        this.center = center ? center : this.centroid();
        this._bbox = null;
    }

    //---- Private Polygon Helper Functions -----------------------------------

    /**
     * Private Polygon Helper Funciton:
     *   Order a list of points in clockwise order for proper polygon rendering
     * 
     * @private
     * @static
     * @param {Vector[]} points The list of points to sort clockwise
     * @return {Vector[]} The ordered list of points
     * @memberof Polygon
     */


    _createClass(Polygon, [{
        key: "centroid",


        //---- Polygon Property Functions -----------------------------------------

        /**
         * Get the centroid of the polygon. This is the vector average of all the
         * points that make up the polygon.
         * 
         * @returns {Vector} The centroid of the polygon
         * 
         * @memberof Polygon
         */
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
         * Get the edge lines of the polygon
         * 
         * @return {Line[]} The edges of the polygon
         * @memberof Polygon
         */

    }, {
        key: "inset",


        /**
         * Get the polygon inset of the current polygon by the input ammount
         * 
         * @param ammount
         * @returns {Polygon} The inset of the current polygon by
         * @memberof Polygon
         */
        value: function inset(ammount) {
            return ammount;
        }

        /**
         * Returns wheither or not this polygon is a convex polygon. If this is
         * not true then the polygon is convace or more complex.
         * 
         * @return {boolean} If the polygon is convex
         * @memberof Polygon
         */

    }, {
        key: "isConvex",
        value: function isConvex() {}

        /**
         * Get the major axis of this polygon. The major axis is the two verticies
         * of the polygon that are the furthest appart from eachother
         * 
         * @return {Line} The major axis of the polygon
         * @memberof Polygon
         */

    }, {
        key: "majorAxis",
        value: function majorAxis() {
            var v1 = null;
            var v2 = null;
            var maxDist = 0;
            var dist = void 0;

            var _iteratorNormalCompletion2 = true;
            var _didIteratorError2 = false;
            var _iteratorError2 = undefined;

            try {
                for (var _iterator2 = this.corners[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                    var c1 = _step2.value;
                    var _iteratorNormalCompletion3 = true;
                    var _didIteratorError3 = false;
                    var _iteratorError3 = undefined;

                    try {
                        for (var _iterator3 = this.corners[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
                            var c2 = _step3.value;

                            if (!_Vector2.default.equals(c1, c2)) {
                                dist = _Vector2.default.dist2(c1, c2);
                                if (dist > maxDist) {
                                    maxDist = dist;
                                    v1 = c1;
                                    v2 = c2;
                                }
                            }
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

            return new _Line2.default(v1, v2);
        }

        /**
         * Get the minor axis of the polygon. The minor axis is considered to be
         * the perpendicular to the major axis. This is not the two verticies
         * that are closest to eachother. This insures that the polygon is more
         * evenly divided in half along what should be the shorter portion of the
         * polygon.
         * 
         * @return {Line | null} The minor axis of the polygon, if there was a
         *  problem null is returned
         * @memberof Polygon
         * @todo Fix line intersection bug. Line intersection should always return 2
         *  segments but is sometimes returning 1 or 0.
         */

    }, {
        key: "minorAxis",
        value: function minorAxis() {
            var majorAxis = this.majorAxis();
            var minorSegment = _Line2.default.perpendicular(majorAxis, majorAxis.length() * 2);
            var clippedList = this.lineIntersection(minorSegment);

            // Temporary
            if (clippedList.length < 2) {
                return null;
            }

            return new _Line2.default(clippedList[0], clippedList[1]);
        }

        //---- Member Functions ---------------------------------------------------

    }, {
        key: "rotate",
        value: function rotate() {}

        /**
         * Determine if the point is contained within the polygon
         * 
         * @param {Vector} vector The position to check containment within
         *   the polygon
         * 
         * @return {bool} True if the vector is contained within the polygon
         * 
         * @see {@link https://github.com/substack/point-in-polygon/blob/master/index.js}
         * @memberof Polygon
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

        /**
         * Get all the intersection points between this polygon and a line segment
         * 
         * @param {Line} line The line to check for intersection points
         * 
         * @returns {Vector[]} The list of all the intersection points between this
         *   polygon and the line segment
         * @memberof Polygon
         */

    }, {
        key: "lineIntersection",
        value: function lineIntersection(line) {
            var intersectPoints = [];
            var len = this.corners.length;
            for (var i = 0; i < len; i++) {
                var edge = new _Line2.default(this.corners[i], this.corners[(i + 1) % len]);
                var intersect = _Line2.default.intersection(edge, line);

                if (intersect !== null) {
                    Polygon._addPoint(intersectPoints, intersect);
                }
            }
            return intersectPoints;
        }

        /**
         * Private Helper Function For intersection:
         *   This function adds a point to the list if the point is not already
         * contained within that list.
         * 
         * @static
         * @private
         * @param {Vector[]} list List of vector points
         * @param {Vector} vector The Vector to try to add to the list
         * 
         * @memberof Polygon
         */

    }, {
        key: "intersection",


        /**
         * Get the intersection between this and another polygon. The result is
         * a new polygon that represents the geometric boolean AND operation on
         * the two polygons. The result is a new polygon of this intersection. 
         * 
         * @param {Polygon} other The other polygon to intersect with
         * 
         * @return {Polygon} The intersection between the two polygons
         * @memberof Polygon
         */
        value: function intersection(other) {
            return Polygon.intersection(this, other);
        }
    }, {
        key: "edges",
        get: function get() {
            if (this._edges) {
                return this._edges;
            }

            var edges = [];
            var len = this.corners.length;
            for (var i = 0; i < len; i++) {
                var c1 = this.corners[i];
                var c2 = this.corners[(i + 1) % len];
                edges.push(new _Line2.default(c1, c2));
            }
            this._edges = edges;
            return this._edges;
        }

        /**
         * Set the edge lines of a polygon.
         * Note: This does not change the corners of the polygons,
         *   only use this if you know what you are doing
         * 
         * @memberof Polygon
         */
        ,
        set: function set(edges) {
            this._edges = edges;
        }
    }], [{
        key: "_orderClockwise",
        value: function _orderClockwise(points) {
            var center = _Vector2.default.avg(points);
            points.sort(function (a, b) {
                return Math.atan2(b.y - center.y, b.x - center.x) - Math.atan2(a.y - center.y, a.x - center.x);
            });

            return points;
        }
    }, {
        key: "_addPoint",
        value: function _addPoint(list, vector) {
            var contains = false;
            var _iteratorNormalCompletion4 = true;
            var _didIteratorError4 = false;
            var _iteratorError4 = undefined;

            try {
                for (var _iterator4 = list[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
                    var v = _step4.value;

                    if (v.equals(vector)) {
                        contains = true;
                        break;
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

            if (!contains) {
                list.push(vector);
            }
        }

        /**
         * Get the intersection between this and another polygon. The result is
         * a new polygon that represents the geometric boolean AND operation on
         * the two polygons. The result is a new polygon of this intersection. 
         * 
         * @static
         * @param {Polygon} other The other polygon to intersect with
         * 
         * @return {Polygon} The intersection between the two polygons
         * @memberof Polygon
         */

    }, {
        key: "intersection",
        value: function intersection(poly1, poly2) {
            var clippedCorners = [];

            // Iterage through poly1 for collisions
            var _iteratorNormalCompletion5 = true;
            var _didIteratorError5 = false;
            var _iteratorError5 = undefined;

            try {
                for (var _iterator5 = poly1.corners[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
                    var corner = _step5.value;

                    if (poly2.contains(corner)) {
                        Polygon._addPoint(clippedCorners, corner);
                    }
                }

                // Iterate through poly2 polygon for collisions
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

            var _iteratorNormalCompletion6 = true;
            var _didIteratorError6 = false;
            var _iteratorError6 = undefined;

            try {
                for (var _iterator6 = poly2.corners[Symbol.iterator](), _step6; !(_iteratorNormalCompletion6 = (_step6 = _iterator6.next()).done); _iteratorNormalCompletion6 = true) {
                    var _corner = _step6.value;

                    if (poly1.contains(_corner)) {
                        Polygon._addPoint(clippedCorners, _corner);
                    }
                }
            } catch (err) {
                _didIteratorError6 = true;
                _iteratorError6 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion6 && _iterator6.return) {
                        _iterator6.return();
                    }
                } finally {
                    if (_didIteratorError6) {
                        throw _iteratorError6;
                    }
                }
            }

            var len = poly1.corners.length;
            for (var i = 0; i < len; i++) {
                var next = i + 1 === len ? 0 : i + 1;
                var edge = new _Line2.default(poly1.corners[i], poly1.corners[next]);
                var intersectPts = poly2.lineIntersection(edge);

                var _iteratorNormalCompletion7 = true;
                var _didIteratorError7 = false;
                var _iteratorError7 = undefined;

                try {
                    for (var _iterator7 = intersectPts[Symbol.iterator](), _step7; !(_iteratorNormalCompletion7 = (_step7 = _iterator7.next()).done); _iteratorNormalCompletion7 = true) {
                        var v = _step7.value;

                        Polygon._addPoint(clippedCorners, v);
                    }
                } catch (err) {
                    _didIteratorError7 = true;
                    _iteratorError7 = err;
                } finally {
                    try {
                        if (!_iteratorNormalCompletion7 && _iterator7.return) {
                            _iterator7.return();
                        }
                    } finally {
                        if (_didIteratorError7) {
                            throw _iteratorError7;
                        }
                    }
                }
            }

            return new Polygon(clippedCorners);
        }
    }]);

    return Polygon;
}();

exports.default = Polygon;
module.exports = exports["default"];

},{"./Line":17,"./Rectangle":19,"./Vector":21}],19:[function(require,module,exports){
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
     * @property {Vector} center
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
        this.center = _Vector2.default.add(position, new _Vector2.default(width / 2, height / 2));
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

},{"./Vector":21}],20:[function(require,module,exports){
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

},{"./Polygon":18,"./Vector":21}],21:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Util = require("../utilities/Util");

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
     * @memberof Vector
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
        key: "equals",


        /**
         * Returns true if this vectors position is equal to the other vector
         *
         * @param {Vector} other The other vector to compare to
         * @returns {boolean} True if the vector positions are equal
         * @memberof Vector
         */
        value: function equals(other) {
            return Vector.equals(this, other);
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
         * @memberof Vector
         */

    }, {
        key: "equals",
        value: function equals(v1, v2) {
            return (0, _Util.fequals)(v1.x, v2.x) && (0, _Util.fequals)(v1.y, v2.y);
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

},{"../utilities/Util":32}],22:[function(require,module,exports){
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

},{"../geometry/Polygon":18,"../geometry/Vector":21}],23:[function(require,module,exports){
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

},{"../geometry/Polygon":18,"../geometry/Vector":21}],24:[function(require,module,exports){
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
         * @memberof Diagram
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
         * @memberof Diagram
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
         * @memberof Diagram
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

},{"../geometry/Vector":21,"./Graph":26,"./Tile":27}],25:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

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
        _this._v0 = null;
        _this._v1 = null;
        _this.midpoint = null;
        _this.border = false;
        return _this;
    }

    _createClass(Edge, [{
        key: "v0",
        get: function get() {
            return this._v0;
        },
        set: function set(corner) {
            this.p1 = corner;
            this._v0 = corner;
        }
    }, {
        key: "v1",
        get: function get() {
            return this._v1;
        },
        set: function set(corner) {
            this.p2 = corner;
            this._v1 = corner;
        }
    }]);

    return Edge;
}(_Line3.default);

exports.default = Edge;
module.exports = exports["default"];

},{"../geometry/Line":17,"../geometry/Vector":21}],26:[function(require,module,exports){
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

},{"../geometry/Vector":21,"../utilities/Util":32,"./Center":22,"./Corner":23,"./Edge":25,"Voronoi":1}],27:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Vector = require("../geometry/Vector");

var _Vector2 = _interopRequireDefault(_Vector);

var _Polygon2 = require("../geometry/Polygon");

var _Polygon3 = _interopRequireDefault(_Polygon2);

var _Center = require("../graph/Center");

var _Center2 = _interopRequireDefault(_Center);

var _Corner = require("../graph/Corner");

var _Corner2 = _interopRequireDefault(_Corner);

var _Edge = require("../graph/Edge");

var _Edge2 = _interopRequireDefault(_Edge);

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
     * Get a tile object from a polygon object
     * 
     * @static
     * @param {Polygon} poly The input polygon
     * @returns {Tile} The tile converted from the polygon
     * 
     * @memberOf Tile
     */


    _createClass(Tile, [{
        key: "getNeighbor",


        /**
         * Get the neighboring tile closest to a particular direction
         * 
         * @param {Vector} direction The direction from the current tile to the
         *  neighboring tile. (Directions are assumed to start from the origin)
         * 
         * @return {Tile} The neighboring tile which is closest to the input
         *  direction.
         * 
         * @memberof Tile
         */
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
    }], [{
        key: "fromPolygon",
        value: function fromPolygon(poly) {
            var center = new _Center2.default(poly.center);
            var corners = poly.corners.map(function (c) {
                return new _Corner2.default(c);
            });
            var edges = [];
            var len = poly.corners.length;
            for (var i = 0; i < len; i++) {
                var next = i + 1 === len ? 0 : i + 1;
                var edge = new _Edge2.default(poly.corners[i], poly.corners[next]);
                edge.v0 = poly.corners[i];
                edge.v1 = poly.corners[next];
                edges.push(edge);
            }
            return new Tile(center, corners, edges);
        }
    }]);

    return Tile;
}(_Polygon3.default);

exports.default = Tile;
module.exports = exports["default"];

},{"../geometry/Polygon":18,"../geometry/Vector":21,"../graph/Center":22,"../graph/Corner":23,"../graph/Edge":25}],28:[function(require,module,exports){
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

var _PolygonSubdivide = require("./algorithms/PolygonSubdivide");

var _PolygonSubdivide2 = _interopRequireDefault(_PolygonSubdivide);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * The Atum procedural graph based library
 * 
 * @export
 * @module Atum
 * @see {@link https://github.com/Evelios/Atum}
 */


// Graph
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
        recursiveVoronoi: _RecursiveVoronoi2.default,
        polygonSubdivide: _PolygonSubdivide2.default
    }
};

// Algorithms


// Utilities
// Geometry
exports.default = Atum;
module.exports = exports["default"];

},{"./Utilities/PointDistribution":12,"./algorithms/BinarySpacePartition":14,"./algorithms/PolygonSubdivide":15,"./algorithms/RecursiveVoronoi":16,"./geometry/Line":17,"./geometry/Polygon":18,"./geometry/Rectangle":19,"./geometry/Triangle":20,"./geometry/Vector":21,"./graph/Center":22,"./graph/Corner":23,"./graph/Diagram":24,"./graph/Edge":25,"./graph/Graph":26,"./utilities/Rand":30,"./utilities/Redist":31,"./utilities/Util":32}],29:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"../geometry/Rectangle":19,"../geometry/Vector":21,"./Rand":30,"dup":12,"poisson-disk-sample":3}],30:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"../geometry/Vector":21,"dup":13,"seedRandom":4}],31:[function(require,module,exports){
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

},{}],32:[function(require,module,exports){
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
exports.fequals = fequals;
function has(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
};

function setOptions(options, defaults) {
    var out = {};
    for (var v in defaults) {
        out[v] = options[v] !== undefined ? options[v] : defaults[v];
    }
    return out;
}

/**
 * Compare two floating point numbers for equality
 * 
 * @export
 * @param {numeric} float1 First floating point number
 * @param {numeric} float2 Second floating point number
 * @return {bool} True if the two points are (almost) equal
 */
function fequals(float1, float2) {
    return Math.abs(float1 - float2) < Number.EPSILON;
}

// Number map from one range to another range
// https://gist.github.com/xposedbones/75ebaef3c10060a3ee3b246166caab56
Number.prototype.map = function (in_min, in_max, out_min, out_max) {
    return (this - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
};

},{}]},{},[28])(28)
});