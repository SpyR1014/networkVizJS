# Easy, interactive graphs with networkVizJS

<p align="center">
<img src="https://media.giphy.com/media/xUA7b6EQrHg94qkynC/giphy.gif" alt="Interacting with diagram">
</p>

## Examples

- [Easy Dynamically changing graph](https://bl.ocks.org/SpyR1014/d82570c509028e6b0a519ef885ab58f0)
- [Very simple graph editor](http://mind-map-prototype.surge.sh/)

## Why this project exists

Force directed graphs can be a mighty headache especially when trying to dynamically update nodes.

This project aims to abstract away much of the process of drawing a graph leaving you to focus on the
things that matter.

### Features

 - Dragging.
 - Panning and zooming.
 - Avoid overlapping nodes.
 - Easy interface for adding / removing nodes.
 - Routing the edge lines around nodes.

<p align="center">
<img src="https://media.giphy.com/media/xUPGciVhMEBSWGN94c/giphy.gif" alt="Interacting with diagram">
</p>

 - Very stable using [Webcola](http://marvl.infotech.monash.edu/webcola/) as the layout.
 - Easy handlers that allow you to finely tune the experience for the user.
 - Various layouts supported out of the box:
    - Flow layout for force directed graph (horizontally and vertically)
    - Jaccard layout (where denser node regions spread out)
    - Regular layout allowing a fixed or dynamic edge length.
 - An intuitive API which lets you do what you want.


>> Adding a node is as easy as `graph.addNode(<your node object>)`!


## Quickstart using Webpack or another bundler

```shell
npm install --save networkvizjs
```

Import the module:

```javascript
// ES6
import networkVizJS from "networkVizJS";
// commonjs
var networkVizJS = require('networkVizJS').default;
```

Given we have an div with id `graph1`, we can initiate
a graph in that div using:

```javascript
const graph = networkVizJS('graph1', options?);
```

Node must have at least these two properties:
Optionally you can define `x` and `y`.

```javascript
var node = {
    hash: "uniqueString", // Hash must be unique
    shortname: "Node1",
}
```

To define an edge you use a triplet with the shape:

```javascript
var someEdge = {
    subject: { /* Node to start at */ }
    predicate: { type: "someType", hash: 'uniqueString' } // Type allows different coloured edges. Hash must be unique
    object: { /* Node to finish at */ }
}
```

With the node shape and edge shape we can now add and remove nodes and edges.

### Adding and removing nodes

`addNode` takes a node object or a list of nodes.
They'll be immediately drawn to the svg canvas!

```javascript
let node = {
    hash: "2",
    shortname: "a fun node!",
}
graph.addNode(node);
```

`removeNode` just takes a node hash.
It deletes the node and all edges that include that node.
It also takes an optional callback which triggers when the node is deleted.

```javascript
// Called after the node with the hash "2" is deleted.
const afterDelete = () => console.log("Node deleted!");
graph.removeNode("2", afterDelete);
```

### Adding and removing triplets (or edges between nodes)

```javascript
graph.addTriplet(triplet);
graph.removeTriplet(triplet);
```

You're pretty much good to go!
Below is the rest of the API.

## Options object:

These options are all optional.
Just pass in the ones you want.

```javascript
interface OptionsObject {
    databaseName: string;       // Force the database name
    layoutType: string;         // "linkDistance" | "flowLayout" | "jaccardLinkLengths"
    jaccardModifier: number;    // Modifier for jaccardLinkLengths, number between 0 and 1
    avoidOverlaps: boolean;     // True: No overlaps, False: Overlaps
    handleDisconnected: boolean;// False by default, clumps disconnected nodes
    flowDirection: string;      // If flowLayout: "x" | "y"
    enableEdgeRouting: boolean; // Edges route around nodes
    nodeShape: string;          // Set default node shape: "rect" | "circle"
    width: number;              // SVG width
    height: number;             // SVG height
    pad: number;                // Padding outside of nodes 
    margin: number;             // Margin inside of nodes
    canDrag: boolean;           // True: You can drag nodes, False: You can't
    nodeDragStart(): void;      // Called when drag event triggers
    nodeDragEnd(): void;      // Called when drag event ends
    edgeLabelText: string | {(d?: any, i?: number): string};

    // mouse handlers on nodes.
    mouseDownNode(nodeObject?: any, d3Selection?: Selection): void;
    mouseOverNode(nodeObject?: any, d3Selection?: Selection): void;
    mouseOutNode(nodeObject?: any, d3Selection?: Selection): void;
    mouseUpNode(nodeObject?: any, d3Selection?: Selection): void;
    clickNode(nodeObject?: any, d3Selection?: Selection): void;

    clickEdge(edgeObject?: any, d3Selection?: Selection): void;
    
    clickAway(): void;          // Triggers on zooming or clicking on the svg canvas.
    

    // These options allow you to define a selector to create dynamic attributes
    // based on the nodes properties.
    nodeToPin: boolean | {(d?: any, i?: number): boolean};
    nodeToColor: string | {(d?: any, i?: number): string};     // Return a valid css colour.
    nodeStrokeWidth: number | {(d?: any, i?: number): number};
    nodeStrokeColor: string | {(d?: any, i?: number): string};


    edgeColor: string | {(d?: any, i?: number): string};
    edgeStroke: number | {(d?: any, i?: number): number};
    edgeStrokePad: number | {(d?: any, i?: number): number}; // size of clickable area behind edge
    edgeLength: number | {(d?: any, i?: number): number};
    edgeSmoothness: number | {(d?: any, i?: number): number}; // amount of smoothing applied to vertices in edges
    
    mouseOverRadial()   // To be depreceated
    mouseOutRadial()    // To be depreceated
    
     snapToAlignment: boolean;          // Enable snap to alignment whilst dragging
     snapThreshold: number;             // Snap to alignment threshold
     zoomScale(scale: number): void;    // Triggered when zooming
     isSelect(): boolean;               // Is tool in selection mode
     nodeSizeChange(): void;            // Triggers when node dimensions update
     selection(): any;                  // Returns current selection from select tool
     imgResize(bool: boolean): void;    // Toggle when resizing image
}
```

## Methods on graph object

```javascript
// Check if node is drawn.
hasNode(nodeHash: string): Boolean
// Public access to the levelgraph db.
getDB(): levelGraphDB
// Get node from nodeMap
getNode(nodeHash): Object
// Get nodes and edges by coordinates
selectByCoords(boundary: { x: number, X: number, y: number, Y: number }): {nodes:[] edges:[]}
// Get edge predicate from predicateMap
getPredicate(edgeHash): Object
// Get Layout options
getLayoutOptions: () => layoutOptions,
// Get SVG element. If you want the node use `graph.getSVGElement().node();`
getSVGElement(): d3SVGSelection
// Get Stringified representation of the graph.
saveGraph(): string
// add a directed edge
addTriplet(tripletObject, preventLayout?: Boolean)
// remove an edge
removeTriplet(tripletObject),
// update edge data in database
updateTriplet(tripletObject),
// EXPERIMENTAL - DON'T USE YET.
mergeNodeToGroup,
// remove a node and all edges connected to it.
removeNode(node),
// add a node or array of nodes.
addNode(node | nodeArray, preventLayout?: Boolean);
// edit node property
editNode({ property: string, id:(string|string[]), value: (any|any[]) });
// edit edge property
editEdge({ property: string, id:(string|string[]), value: (any|any[]) });
// Restart styles or layout.
restart.styles()
restart.layout()
restart.textAlign()     // Aligns text to centre of node
restart.redrawEdges()     // Redraw the edges
restart.handleDisconnects()     // Handle disconnected graph components

```

## Todo

- [ ] Batch node and edge updates without layout refreshing
- [ ] Stabilise API (need help / guidance)
- [ ] Add svg tests (need help / guidance)
- [ ] Document full api


