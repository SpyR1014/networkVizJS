"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
import AlignElemContainer from "./util/AlignElemContainer";
import updateColaLayout from "./updateColaLayout";
import createColorArrow from "./util/createColorArrow";
import * as cola from "webcola";
import {
    AlignConstraint,
    Constraint,
    Graph,
    Group,
    Id,
    InputAlignConstraint,
    InputSeparationConstraint,
    LayoutOptions,
    Node,
    SeparationConstraint
} from "interfaces";

import { addConstraintToNode, asArray, boundsOverlap, computeTextColor, isIE, nodePath } from "./util/utils";

// TODO fix the type errors
import type { Selection as d3Selection } from "d3";
// import * as d3 from "d3";
const d3 = require("d3");

const levelgraph = require("levelgraph");
const level = require("level");
const interact = require("interactjs");


function networkVizJS(documentId, userLayoutOptions): Graph {
    /**
     * Default options for webcola and graph
     */
    const defaultLayoutOptions: LayoutOptions = {
        databaseName: `Userdb-${Math.random() * 100}-${Math.random() * 100}-${Math.random() * 100}-${Math.random() * 100}`,
        layoutType: "flowLayout",
        jaccardModifier: 0.7,
        color_defs: [],
        avoidOverlaps: true,
        handleDisconnected: false,
        flowDirection: "y",
        enableEdgeRouting: true,
        edgeTextOrientWithPath: false,
        imageNodes: false,
        // groupCompactness: 5e-6,
        // convergenceThreshold: 0.1,
        nodeShape: "capsule",
        nodePath: nodePath,
        width: 900,
        height: 600,
        pad: 15,
        margin: 10,
        groupPad: 0,
        alignTimer: 2500,
        canDrag: () => true,
        easyConstrain: true,
        nodeDragStart: undefined,
        nodeDragged: undefined,
        nodeDragEnd: undefined,
        edgeLabelText: (edgeData) => edgeData?.text ?? "",
        // Both mouseout and mouseover take data AND the selection (arg1, arg2)
        mouseDownNode: undefined,
        mouseOverNode: undefined,
        mouseOutNode: undefined,
        mouseUpNode: undefined,
        mouseOverGroup: undefined,
        mouseOutGroup: undefined,
        mouseOverEdge: undefined,
        mouseOutEdge: undefined,
        clickGroup: undefined,
        dblclickGroup: () => undefined,
        clickNode: () => undefined,
        dblclickNode: () => undefined,
        clickEdge: () => undefined,
        dblclickEdge: () => undefined,
        clickAway: () => undefined,
        mouseOutConstraint: () => undefined,
        mouseOverConstraint: () => undefined,
        clickConstraint: () => undefined,
        clickConstraintGuide: () => undefined,
        // These are "live options"
        svgColor: "white",
        /** nodeToPin
         * 1st bit is user set, second bit is set by d3 whilst dragging.
         * hence check LSB if d.fixed is not bool
         */
        nodeToPin: d => (typeof d?.fixed === "boolean" && d.fixed === true) || d?.fixed % 2 === 1,
        nodeToColor: d => d.color ?? "#AADCDC",
        nodeOpacity: 1,
        nodeToText: d => d.shortname ?? d.id,
        nodeStrokeWidth: () => 1,
        nodeStrokeColor: () => "grey",
        nodeStrokeDash: "",
        nodeFontSize: () => "22px",
        edgeFontSize: () => "20px",
        groupFontSize: () => "22px",
        edgeColor: p => p?.stroke ?? "#000000",
        // edgeArrowhead: 0 - None, 1 - Right, -1 - Left, 2 - Bidirectional
        edgeArrowhead: p => (typeof p?.arrowhead === "number") ? p.arrowhead : 1,
        edgeStroke: p => p?.strokeWidth ?? 2,
        edgeStrokePad: 20,
        edgeDasharray: p => p?.strokeDasharray ?? 0,
        edgeLength: 150,
        edgeSmoothness: 15,
        edgeRemove: undefined,
        groupFillColor: g => g?.data?.color ?? "#F6ECAF",
        snapToAlignment: true,
        snapThreshold: 10,
        zoomScale: undefined,
        isSelect: () => false,
        nodeSizeChange: undefined,
        selection: undefined,
        imgResize: undefined,
        palette: undefined,
    };

    const internalOptions = {
        isDragging: false,
        isImgResize: false,
        lastAlign: undefined,
        draggedConstraintVisibility: [],
        draggedConstraintNodes: [],
    };
    /**
     * Create the layoutOptions object with the users options
     * overriding the default options.
     */
    const layoutOptions: LayoutOptions = Object.assign({}, defaultLayoutOptions, userLayoutOptions);
    /**
     * Check that the user has provided a valid documentId
     * and check that the id exists.
     */
    if (typeof documentId !== "string" || documentId === "") {
        throw new Error("Document Id passed into graph isn't a valid string.");
    }
    if (document.getElementById(documentId) === undefined) {
        throw new Error(`Can't find id '#${documentId}' on the page.`);
    }
    /**
     * In memory stores of the nodes and predicates.
     */
    const nodeMap = new Map<Id, Node>();
    const predicateTypeToColorMap = new Map();
    const predicateMap = new Map();
    const groupMap = new Map();
    /**
     * Todo: This is currently a hack. Create a random database on the client
     *  side to build the networks on top of.
     *  It's often better to just re-initialize a new db.
     */
    if (!layoutOptions.databaseName || typeof layoutOptions.databaseName !== "string") {
        console.error("Make sure databaseName property exists and is a string.");
        console.error("Choosing a default name for the database.");
        layoutOptions.databaseName = defaultLayoutOptions.databaseName;
    }
    const tripletsDB = levelgraph(level(layoutOptions.databaseName));
    /**
     * These represent the data that d3 will visualize.
     */
    const nodes: Node[] = [];
    const constraints: Constraint[] = [];
    let links = [];
    let groups: Group[] = [];

    /**
     * Create svg canvas that is responsive to the page.
     * This will try to fill the div that it's placed in.
     */
    const svg = d3.select(`#${documentId}`)
        .append("div")
        .classed("svg-container", true)
        .append("svg")
        .attr("preserveAspectRatio", "xMinYMin meet")
        .attr("viewBox", `0 0 ${layoutOptions.width} ${layoutOptions.height}`)
        .style("background-color", layoutOptions.svgColor)
        .classed("svg-content-responsive", true);
    svg.on("click", layoutOptions.clickAway);
    /**
     * Set up [webcola](http://marvl.infotech.monash.edu/webcola/).
     * The helper function updateColaLayout allows for restarting
     * the simulation whenever the layout is changed.
     */
    let simulation = updateColaLayout(layoutOptions)
        .nodes(nodes)
        .links(links)
        .constraints(constraints)
        .groups(groups)
        .start(10, 15, 20, 0, true, false);
    /**
     * Call nodeDragStart callback when drag event triggers.
     */
    const drag = simulation.drag();
    drag.filter(() => (layoutOptions.canDrag === undefined) || (layoutOptions.canDrag()));
    drag.on("start", (d, i, elements) => {
        layoutOptions.nodeDragStart && layoutOptions.nodeDragStart(d, elements[i]);
        internalOptions.isDragging = true;

        if (d.constraint) {
            // save dragged constraints and initial visibility
            // set them to be visible
            const alignConsts: AlignConstraint[] = d.constraint
                .filter(({ type }) => type === "alignment");
            internalOptions.draggedConstraintVisibility = alignConsts
                .map(c => ({ constraint: c, v: c.visible }));
            internalOptions.draggedConstraintVisibility
                .forEach(({ constraint }) => {
                    constraint.visible = true;
                });
            // unfix constrained nodes while dragging
            // const alignedIDs = alignConsts
            //     .map(({ nodeOffsets }) => nodeOffsets.map(({ id }) => id))
            //     .flat();
            // const uniqeAlignedIDs = [...new Set(alignedIDs)];
            // internalOptions.draggedConstraintNodes = uniqeAlignedIDs
            //     .filter(id => id !== d.id)
            //     .map(id => nodeMap.get(id))
            //     .map(d => ({ d, f: d.fixed }));
            // internalOptions.draggedConstraintNodes
            //     .forEach(({ d }) => {
            //         d.fixed = false;
            //     });
        }

        // TODO find permanent solution in vuegraph
        if (layoutOptions.isSelect && layoutOptions.isSelect()) {
            d.class += " highlight";
            updateStyles();
        }
    })
        .on("drag", dragged)
        .on("end", (d, i, elements) => {
            alignElements.endAlign();
            layoutOptions.nodeDragEnd && layoutOptions.nodeDragEnd(d, elements[i]);
            internalOptions.isDragging = false;
            internalOptions.draggedConstraintVisibility
                .forEach(({ constraint, v }) => {
                    constraint.visible = v;
                });
            internalOptions.draggedConstraintVisibility = [];
            internalOptions.draggedConstraintNodes.forEach(({ d, f }) => {
                d.fixed = f;
            });
            internalOptions.draggedConstraintNodes = [];
            updateStyles();
            if (layoutOptions.isSelect && layoutOptions.isSelect()) {
                d.class = d.class.replace(" highlight", "");
                updateStyles();
            }
        });

    /**
     * Create the defs element that stores the arrow heads.
     */
    const defs = svg.append("defs");
    defs.append("marker")
        .attr("id", "dimensionArrowEnd")
        .attr("viewBox", "0 0 50 40")
        .attr("refX", 50)
        .attr("refY", 20)
        .attr("markerWidth", 8)
        .attr("markerHeight", 8)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M 0 0 L 0 40 L 50 20 Z")
        .attr("fill", "rgb(150,150,150)");
    defs.append("marker")
        .attr("id", "dimensionArrowStart")
        .attr("viewBox", "0 0 50 40")
        .attr("refX", 0)
        .attr("refY", 20)
        .attr("markerWidth", 8)
        .attr("markerHeight", 8)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M 50 0 L 50 40 L 0 20 Z")
        .attr("fill", "rgb(150,150,150)");

    layoutOptions.color_defs.forEach(({ color, id }) => addColourDef(color, id));

    const arrowDefsDict = {};

    function addArrowDefs(defs: any, color: string, backwards: boolean) {
        const key = color + "-" + (backwards ? "start" : "end");
        if (!arrowDefsDict[key]) {
            arrowDefsDict[key] = true;
            createColorArrow(defs, "#" + color, backwards);
        }
        return "url(#arrow-" + color + (backwards ? "-start)" : "-end)");
    }

    // Define svg groups for storing the visuals.
    const g = svg.append("g")
        .classed("svg-graph", true);
    let group = g.append("g").attr("id", "group-container")
        .selectAll(".group");
    let link = g.append("g").attr("id", "link-container")
        .selectAll(".link");
    let constraint: d3Selection<SVGGElement, AlignConstraint, SVGGElement, unknown> = g.append("g")
        .attr("id", "constraint-container")
        .selectAll(".constraint");
    const alignmentLines = g.append("g");
    let node = g.append("g").attr("id", "node-container")
        .selectAll(".node");
    const alignElements = new AlignElemContainer(alignmentLines.node(), layoutOptions);
    /**
     * Zooming and panning behaviour.
     */
    const zoom = d3.zoom().scaleExtent([0.1, 5]).on("zoom", zoomed);
    zoom.filter(function () {
        // Prevent zoom when mouse over node.
        return d3.event.target.tagName.toLowerCase() === "svg" && !layoutOptions.isSelect();
    });
    svg.call(zoom).on("dblclick.zoom", undefined);

    function zoomed() {
        layoutOptions.clickAway();
        g.attr("transform", d3.event.transform);
        layoutOptions.zoomScale && layoutOptions.zoomScale(d3.event.transform.k);
    }


    /** Allow Image Resize Using Interact.js */
    if (layoutOptions.imageNodes) {
        interact(".img-node")
            .resizable({
                edges: { left: false, right: true, bottom: true, top: false },
                inertia: {
                    resistance: 1,
                    minSpeed: 1,
                    endSpeed: 1
                }
            })
            .on("resizeend", function (event) {
                layoutOptions.imgResize && layoutOptions.imgResize(false);
                internalOptions.isImgResize = false;
            })
            .on("resizestart", function (event) {
                layoutOptions.imgResize && layoutOptions.imgResize(true);
                internalOptions.isImgResize = true;
            })
            .on("resizemove", function (event) {
                // layoutOptions.imgResize && layoutOptions.imgResize(true);
                internalOptions.isImgResize = true;
                const target = event.target,
                    x = (parseFloat(target.getAttribute("data-x")) || 0),
                    y = (parseFloat(target.getAttribute("data-x")) || 0);

                target.style.width = event.rect.width + "px";
                target.style.height = event.rect.width + "px";
                target.style.webkitTransform = target.style.transform =
                    "translate(" + x + "px," + y + "px)";
                target.setAttribute("data-x", x);

                restart();
            });

        interact.maxInteractions(Infinity);
    }

    /**
     * Return nodes and edges within a boundary
     * @param {object} boundary - Bounds to search within
     * @param {number} boundary.x
     * @param {number} boundary.X
     * @param {number} boundary.y
     * @param {number} boundary.Y
     * @returns {{nodes: Node[]; edges: any[], groups:Groups[]}} - object containing node array and edge array
     */
    function getByCoords(boundary: { x: number; X: number; y: number; Y: number }) {
        const x = Math.min(boundary.x, boundary.X);
        const X = Math.max(boundary.x, boundary.X);
        const y = Math.min(boundary.y, boundary.Y);
        const Y = Math.max(boundary.y, boundary.Y);
        const boundsChecker = d => boundsOverlap(d.bounds, { x, X, y, Y });
        const nodeSelect = nodes.filter(d => boundsChecker(d));
        const groupSelect = groups.filter(d => boundsChecker(d));
        const edges = d3.selectAll(".line")
            .select(".line-front")
            .filter(function () {
                const len = this.getTotalLength();
                const p = len / 3;
                const p1 = this.getPointAtLength(p);
                const p2 = this.getPointAtLength(p * 2);
                const p1In = p1.x >= x && p1.x <= X && p1.y >= y && p1.y <= Y;
                const p2In = p2.x >= x && p2.x <= X && p2.y >= y && p2.y <= Y;
                return p1In && p2In;
            });
        return { nodes: nodeSelect, edges: edges.data(), groups: groupSelect };
    }

    /**
     * Resets width or radius of nodes.
     * Allows dynamically changing node sizes based on text.
     */
    function updatePathDimensions() {
        layoutOptions.nodeSizeChange && layoutOptions.nodeSizeChange();
        node.select("path")
            .attr("d", function (d) {
                return typeof layoutOptions.nodePath === "function" ? layoutOptions.nodePath(d) : layoutOptions.nodePath;
            })
            .attr("transform", function (d) {
                // Scale appropriately using http://stackoverflow.com/a/9877871/6421793
                const bbox = this.getBBox();
                const currentWidth = bbox.width;
                const w = d.width;
                const currentHeight = bbox.height;
                const h = d.height;
                const scaleW = (w - layoutOptions.margin) / currentWidth;
                const scaleH = (h - layoutOptions.margin) / currentHeight;
                if (isNaN(scaleW) || isNaN(scaleH) || isNaN(w) || isNaN(h)) {
                    return "";
                }
                return `translate(${-w / 2 + layoutOptions.margin},${-h / 2 + layoutOptions.margin}) scale(${scaleW},${scaleH})`;
            });
    }

    /**
     * This function re-centers the text.
     * This allows you to not change the text without restarting
     * jittering the text.
     * Must be run after updateStyles() to reposition on updated text.
     */
    function repositionText() {
        return Promise.resolve()
            .then(() => {
                node.selectAll("text")
                    .each(function (d) {
                        let img;
                        if (layoutOptions.imageNodes) {
                            img = d3.select(this.parentNode.parentNode.parentNode).select("image").node();
                        }
                        const imgWidth = img ? img.getBBox().width : 0;
                        const margin = layoutOptions.margin, pad = layoutOptions.pad;
                        const extra = 2 * pad + margin;

                        if (d.fixedWidth && imgWidth + extra < d.fixedWidth) {
                            d.width = d.fixedWidth;
                            return;
                        }
                        // The width must reset to allow the box to get smaller.
                        // Later we will set width based on the width of the line.
                        d.width = d.minWidth || 0;
                        if (!(d.width)) {
                            d.width = d.minWidth || 0;
                        }

                        const lineLength = this.offsetWidth;
                        const w = imgWidth > lineLength ? imgWidth : lineLength;
                        if (d.width < lineLength + extra) {
                            d.width = w + extra;
                        }

                    })
                    .each(function (d) {
                        // Only update the height, the width is calculated previously
                        let img;
                        if (layoutOptions.imageNodes) {
                            img = d3.select(this.parentNode.parentNode.parentNode).select("image").node();
                        }
                        const imgHeight = img ? img.getBBox().height : 0;
                        const height = this.offsetHeight;
                        const extra = 2 * layoutOptions.pad + layoutOptions.margin;
                        d.height = height === 0 ? 28 + extra + imgHeight : height + extra + imgHeight;
                    });
                if (layoutOptions.imageNodes) {
                    node.select(".img-node")
                        .attr("x", function (d) {
                            const imgWidth = d.img ? this.getBBox().width : 0;
                            return d.width / 2 - imgWidth / 2;
                        })
                        .attr("y", function (d) {
                            return d.img ? 18 : 0;
                        });
                }

                node.select(".node-HTML-content")
                    .attr("width", function (d) {
                        if (d.fixedWidth) {
                            return d.fixedWidth;
                        }
                        return d3.select(this).select("text").node().offsetWidth;
                    })
                    .attr("y", function (d) {
                        let img;
                        if (layoutOptions.imageNodes) {
                            img = d3.select(this.parentNode).select("image").node();
                        }
                        const imgHeight = img ? img.getBBox().height : 0;
                        const textHeight = d3.select(this).select("text").node().offsetHeight;
                        if (!d.img || !img) {
                            return d.height / 2 - textHeight / 2 - 2;
                        } else {
                            return d.height / 2 - textHeight / 2 + imgHeight / 2 + 5;
                        }
                    })
                    .attr("x", function (d) {
                        const textWidth = d3.select(this).select("text").node().offsetWidth;
                        return d.width / 2 - textWidth / 2;
                    });

                link.select(".edge-foreign-object")
                    .attr("width", function (d) {
                        return d3.select(this).select("text").node().offsetWidth;
                    });
                d3.selectAll("#graph .node").each(function (d) {
                    const node = d3.select(this);
                    const foOnNode = node.selectAll(".node-status-icons");
                    const pinned = (layoutOptions.nodeToPin &&
                        ((typeof layoutOptions.nodeToPin === "function" && layoutOptions.nodeToPin(d)) || layoutOptions.nodeToPin));
                    if (pinned) {
                        foOnNode
                            .attr("x", d => d.width / 2 || 0)
                            .attr("y", 0)
                            .style("opacity", 1);
                    } else {
                        foOnNode
                            .style("opacity", 0);
                    }
                });
            });
    }

    /**
     * center group text in group and adjust padding values to create text area.
     */
    function repositionGroupText() {
        group.select("text")
            .style("width", function (d) {
                return `${d.bounds.width()}px`;
            });
        group.select("foreignObject")
            .attr("x", function (d) {
                // center FO in middle of group
                const textWidth = d3.select(this).select("text").node().offsetWidth;
                if (d.bounds) {
                    return (d.bounds.width() - textWidth) / 2;
                }
                return 0;
            })
            .each(function (d) {
                const textNode = d3.select(this).select("text").node();
                const textHeight = textNode.innerText === "" ? 0 : textNode.offsetHeight;
                const pad = textHeight + 5;
                // TODO if padding is unsymmetrical by more than double the node size, things break. (default size 136)
                const opPad = Math.max(pad - 136, 0);
                switch (typeof d.padding) {
                    case "number": {
                        const padI = d.padding;
                        d.padding = { x: padI, X: padI, y: pad, Y: opPad };
                        break;
                    }
                    case "object": {
                        d.padding.y = pad;
                        d.padding.Y = opPad;
                        break;
                    }
                    default: {
                        const p = layoutOptions.groupPad ? layoutOptions.groupPad : 0;
                        d.padding = { x: p, X: p, y: pad, Y: opPad };
                    }
                }
            });
    }

    /**
     * Update the d3 visuals without layout changes.
     */
    function updateStyles(): Promise<void> {
        return new Promise((resolve, reject) => {
            // svg color
            svg.style("background-color", layoutOptions.svgColor);

            /** CONSTRAINTS */
            constraint = constraint.data(<AlignConstraint[]>(constraints.filter(({ type }) => type === "alignment")));
            constraint.exit().remove();
            const constraintEnter = constraint.enter()
                .append("g");
            // draw visible line
            constraintEnter
                .append("line")
                .attr("stroke", "rgb(64,158,255)")
                .attr("stroke-width", 2)
                .attr("shape-rendering", "crispEdges")
                .attr("stroke-dasharray", "10")
                .classed("cons-line", true);

            // create padded line to handle mouse events
            constraintEnter
                .append("line")
                .attr("stroke", "rgba(0,0,0,0)")
                .attr("stroke-width", 18);
            // attach mouse events
            constraintEnter
                .on("mouseenter", function (d) {
                    layoutOptions.mouseOverConstraint?.(d, d3.select(this), d3.event);
                })
                .on("mouseleave", function (d) {
                    layoutOptions.mouseOutConstraint?.(d, d3.select(this), d3.event);
                })
                .on("click", function (d) {
                    layoutOptions.clickConstraint?.(d, d3.select(this), d3.event);
                });
            constraint = constraint.merge(constraintEnter);
            // toggle visibility and update position only if constraint is visible
            // constraints will be hidden most of the time no need to compute each time
            constraint
                .attr("visibility", d => d.visible ? "visible" : "hidden")
                .filter(d => d.visible)
                .each(function (d) {
                    // only calculate bounds once per constraint
                    const consBounds = d.bounds();
                    d3.select(this)
                        .selectAll("line")
                        .attr("y1", consBounds.y)
                        .attr("y2", consBounds.Y)
                        .attr("x1", consBounds.x)
                        .attr("x2", consBounds.X);
                });
            /** GROUPS */
            group = group.data(groups);
            group.exit().remove();
            const groupEnter = group.enter()
                .append("g")
                .call(simulation.drag);
            groupEnter.append("rect")
                .attr("rx", 8)
                .attr("ry", 8)
                .attr("class", d => `group ${d.data.class}`)
                .attr("stroke", "black")
                .on("mouseover", function (d) {
                    layoutOptions.mouseOverGroup && layoutOptions.mouseOverGroup(d, d3.select(this), d3.event);
                })
                .on("mouseout", function (d) {
                    layoutOptions.mouseOutGroup && layoutOptions.mouseOutGroup(d, d3.select(this), d3.event);
                })
                .on("click", function (d) {
                    layoutOptions.clickGroup && layoutOptions.clickGroup(d, d3.select(this), d3.event);
                })
                .on("dblclick", function (d) {
                    layoutOptions.dblclickGroup && layoutOptions.dblclickGroup(d, d3.select(this), d3.event);
                });
            // add text to group
            groupEnter
                .append("foreignObject")
                .attr("y", 5)
                .attr("pointer-events", "none")
                .attr("width", 1)
                .attr("height", 1)
                .style("overflow", "visible")
                .append("xhtml:div")
                .attr("xmlns", "http://www.w3.org/1999/xhtml")
                .append("text")
                .attr("pointer-events", "none")
                .classed("editable", true)
                .attr("contenteditable", "true")
                .attr("tabindex", "-1")
                .style("display", "inline-block")
                .style("text-align", "center")
                .style("font-weight", "100")
                .style("font-family", "\"Source Sans Pro\", sans-serif")
                .style("white-space", "pre-wrap")
                .style("word-break", "break-word")
                .html((d) => d.data.text || "");
            group = group.merge(groupEnter);

            group.select(".group")
                .attr("fill", layoutOptions.groupFillColor)
                .attr("class", d => `group ${d.data.class}`);

            // allow for text updating
            group.select("text")
                .style("font-size", layoutOptions.groupFontSize)
                .style("color", d => computeTextColor(d.data.color))
                .html(d => d.data.text || "");

            // order groups correctly in DOM
            group.sort((a, b) => (a.data.level || 0) - (b.data.level || 0));

            // ///// NODE ///////
            node = node.data(nodes, d => d.index);
            node.exit().remove();
            const nodeEnter = node.enter()
                .append("g")
                .classed("node", true);
            nodeEnter
                .attr("cursor", "move")
                .call(drag); // Drag controlled by filter.


            /**
             * Append Text to Node
             * Here we add node beauty.
             * To fit nodes to the short-name calculate BBox
             * from https://bl.ocks.org/mbostock/1160929
             */
            const foBox = nodeEnter.append("foreignObject")
                .attr("pointer-events", "none")
                .classed("node-HTML-content", true)
                .attr("width", 1)
                .attr("height", 1)
                .style("overflow", "visible")
                .append("xhtml:div")
                .classed("fo-div", true)
                .attr("xmlns", "http://www.w3.org/1999/xhtml");

            foBox.append("text")
                .attr("tabindex", "-1")
                .attr("pointer-events", "none")
                .style("cursor", "text")
                .style("text-align", "center")
                .style("font-weight", "100")
                .style("font-family", "\"Source Sans Pro\", sans-serif")
                .classed("editable", true)
                .style("display", "inline-block");

            /** Choose the node shape and style. */
            const nodeShape = nodeEnter.insert("path", "foreignObject");
            nodeShape.attr("d", layoutOptions.nodePath);
            nodeShape
                .attr("vector-effect", "non-scaling-stroke")
                .classed("node-path", true);

            /** Append Image to Node */
            if (layoutOptions.imageNodes) {
                nodeEnter
                    .insert("image", "foreignObject")
                    .on("mouseover", function (d) {
                        nodeEnter.attr("cursor", "resize");
                        if (internalOptions.isDragging) {
                            return;
                        }
                        layoutOptions.mouseOverNode && layoutOptions.mouseOverNode(d, d3.select(this.parentNode).select("path"), d3.event);
                    })
                    .on("mouseout", function (d) {
                        nodeEnter.attr("cursor", "move");
                    });
            }

            /** Merge the entered nodes to the update nodes. */
            node = node.merge(nodeEnter)
                .classed("fixed", d => d.fixed || false);

            /** Update Node Image Src */
            if (layoutOptions.imageNodes) {
                node.select("image")
                    .attr("class", "img-node")
                    .attr("width", d => d.img ? d.img.width : 0)
                    .attr("height", d => d.img ? d.img.width : 0)
                    .attr("xlink:href", function (d) {
                        if (d.img) {
                            return "data:image/png;base64," + d.img.src;
                        }
                    });
            }
            /** Update the text property (allowing dynamically changing text) */
            node.select("text")
                .html(layoutOptions.nodeToText)
                .style("color", d => computeTextColor(d.color))
                .style("font-size", layoutOptions.nodeFontSize)
                .style("max-width", d => d.fixedWidth ? d.width - layoutOptions.pad * 2 + layoutOptions.margin + "px" : "none")
                .style("word-break", d => d.fixedWidth ? "break-word" : "normal")
                .style("white-space", d => d.fixedWidth ? "pre-wrap" : "pre");


            /**
             * Here we can update node properties that have already been attached.
             * When restart() is called, these are the properties that will be affected
             * by mutation.
             */
            const updateShapes = node.select("path")
                .attr("class", d => d.class);
            // These changes apply to both rect and circle
            updateShapes
                .attr("fill", layoutOptions.nodeToColor)
                .attr("opacity", layoutOptions.nodeOpacity)
                .attr("stroke", layoutOptions.nodeStrokeColor)
                .attr("stroke-width", layoutOptions.nodeStrokeWidth)
                .attr("stroke-dasharray", layoutOptions.nodeStrokeDash);
            // update size
            updatePathDimensions();
            // These CANNOT be arrow functions or 'this' context becomes wrong.
            updateShapes
                .on("mouseover", function (d) {
                    if (internalOptions.isDragging) {
                        return;
                    }
                    layoutOptions.mouseOverNode && layoutOptions.mouseOverNode(d, d3.select(this), d3.event);
                })
                .on("mouseout", function (d) {
                    if (internalOptions.isDragging) {
                        return;
                    }
                    layoutOptions.mouseOutNode && layoutOptions.mouseOutNode(d, d3.select(this));
                })
                .on("dblclick", function (d) {
                    layoutOptions.dblclickNode && layoutOptions.dblclickNode(d, d3.select(this), d3.event);
                })
                .on("click", function (d) {
                    layoutOptions.clickNode && layoutOptions.clickNode(d, d3.select(this), d3.event);
                })
                .on("mouseup", function (d) {
                    layoutOptions.mouseUpNode && layoutOptions.mouseUpNode(d, d3.select(this));
                })
                .on("mousedown", function (d) {
                    if ((layoutOptions.canDrag === undefined) || (layoutOptions.canDrag())) {
                        return;
                    }
                    layoutOptions.mouseDownNode && layoutOptions.mouseDownNode(d, d3.select(this));
                });


            /** LINK */
            link = link.data(links, d => d.source.index + "-" + d.target.index);
            link.exit().remove();
            const linkEnter = link.enter()
                .append("g")
                .classed("line", true);
            linkEnter.append("path") // transparent clickable area behind line
                .attr("stroke-width", layoutOptions.edgeStrokePad)
                .attr("stroke", "rgba(0, 0, 0, 0)")
                .attr("fill", "none");
            linkEnter.append("path")
                .attr("class", "line-front")
                .attr("stroke-width", layoutOptions.edgeStroke)
                .attr("stroke", layoutOptions.edgeColor)
                .attr("fill", "none");
            linkEnter
                .on("mouseenter", function (d) {
                    layoutOptions.mouseOverEdge && layoutOptions.mouseOverEdge(d, d3.select(this), d3.event);
                })
                .on("mouseleave", function (d) {
                    layoutOptions.mouseOutEdge && layoutOptions.mouseOutEdge();
                })
                .on("dblclick", function (d) {
                    const elem = d3.select(this);
                    const e = d3.event;
                    // IMPORTANT, without this vuegraph will crash in SWARM. bug caused by blur event handled by medium editor.
                    e.stopPropagation();
                    setTimeout(() => {
                        layoutOptions.dblclickEdge(d, elem, e);
                    }, 50);
                })
                .on("click", function (d) {
                    layoutOptions.clickEdge(d, d3.select(this), d3.event);
                });
            // Add an empty text field.
            linkEnter
                .append("foreignObject")
                .attr("pointer-events", "none")
                .classed("edge-foreign-object", true)
                .attr("width", 1)
                .attr("height", 1)
                .style("overflow", "visible")
                .append("xhtml:div")
                .attr("xmlns", "http://www.w3.org/1999/xhtml")
                .append("text")
                .attr("pointer-events", "none")
                .classed("editable", true)
                .attr("contenteditable", "true")
                .attr("tabindex", "-1")
                .style("display", "inline-block")
                .style("text-align", "center")
                .style("font-weight", "100")
                .style("font-family", "\"Source Sans Pro\", sans-serif")
                .style("white-space", "pre")
                .style("background-color", "rgba(255,255,255,0.85")
                .style("border-radius", "7px")
                .html(d => typeof layoutOptions.edgeLabelText === "function" ?
                    layoutOptions.edgeLabelText(d.predicate) : layoutOptions.edgeLabelText);
            link = link.merge(linkEnter);
            /** Optional label text */
            if (typeof layoutOptions.edgeLabelText === "function") {
                link.select("text")
                    .html((d) => {
                        if (typeof d.predicate.hash === "string") {
                            return typeof layoutOptions.edgeLabelText === "function" ?
                                layoutOptions.edgeLabelText(predicateMap.get(d.predicate.hash)) : layoutOptions.edgeLabelText;
                        }
                        return typeof layoutOptions.edgeLabelText === "function" ?
                            layoutOptions.edgeLabelText(d.predicate) : layoutOptions.edgeLabelText;
                    })
                    .style("font-size", layoutOptions.edgeFontSize);
            }
            link.select(".line-front")
                .attr("marker-start", d => {
                    const color = typeof layoutOptions.edgeColor == "string" ? layoutOptions.edgeColor : layoutOptions.edgeColor(d.predicate);
                    if (typeof layoutOptions.edgeArrowhead != "number") {
                        if (layoutOptions.edgeArrowhead(d.predicate) == -1 || layoutOptions.edgeArrowhead(d.predicate) == 2) {
                            if (d.predicate.class.includes("highlight")) {
                                return addArrowDefs(defs, "409EFF", true);
                            }
                            return addArrowDefs(defs, color, true);
                        }
                        return "none";
                    }
                    return addArrowDefs(defs, color, true);
                })
                .attr("marker-end", d => {
                    const color = typeof layoutOptions.edgeColor == "string" ? layoutOptions.edgeColor : layoutOptions.edgeColor(d.predicate);
                    if (typeof layoutOptions.edgeArrowhead != "number") {
                        if (layoutOptions.edgeArrowhead(d.predicate) == 1 || layoutOptions.edgeArrowhead(d.predicate) == 2) {
                            if (d.predicate.class.includes("highlight")) {
                                return addArrowDefs(defs, "409EFF", false);
                            }
                            return addArrowDefs(defs, color, false);
                        }
                        return "none";
                    }
                    return addArrowDefs(defs, color, false);
                })
                .attr("class", d => "line-front " + d.predicate.class.replace("highlight", "highlight-edge"))
                .attr("stroke-width", d => typeof layoutOptions.edgeStroke === "number" ? layoutOptions.edgeStroke : layoutOptions.edgeStroke(d.predicate))
                .attr("stroke-dasharray", d => typeof layoutOptions.edgeDasharray === "number" ? layoutOptions.edgeDasharray : layoutOptions.edgeDasharray(d.predicate))
                .attr("stroke", d => d.predicate.stroke ? d.predicate.stroke : "black");
            return resolve();
        });
    }

    /**
     * Helper function for drawing the lines.
     * Adds quadratic curve to smooth corners in line
     */
    const lineFunction = (points) => {
        if (points.length <= 2 || !layoutOptions.edgeSmoothness || layoutOptions.edgeSmoothness === 0) {
            // fall back on old method if no need to curve edges
            return d3.line().x(d => d.x).y(d => d.y)(points);
        }
        let path = "M" + points[0].x + "," + points[0].y; // move to start point
        let dy, dx;
        for (let n = 1; n < points.length - 1; n++) {
            const p0 = points[n - 1];
            const p1 = points[n];
            const p2 = points[n + 1];
            const v01 = { x: p1.x - p0.x, y: p1.y - p0.y }; // vector from point 0 to 1
            const v01abs = Math.sqrt(Math.pow(v01.x, 2) + Math.pow(v01.y, 2)); // |v01|
            const uv01 = { x: v01.x / v01abs, y: v01.y / v01abs }; // unit vector v01
            if ((layoutOptions.edgeSmoothness * 2 > v01abs)) {
                dx = v01.x / 2;
                dy = v01.y / 2;
            } else {
                dx = layoutOptions.edgeSmoothness * uv01.x;
                dy = layoutOptions.edgeSmoothness * uv01.y;
            }
            path += " L" + (p1.x - dx) + "," + (p1.y - dy); // straight line to layoutOptions.edgeSmoothness px before vertex
            const v12 = { x: p2.x - p1.x, y: p2.y - p1.y }; // vector from point 1 to 2
            const v12abs = Math.sqrt(Math.pow(v12.x, 2) + Math.pow(v12.y, 2)); // |v12|
            const uv12 = { x: v12.x / v12abs, y: v12.y / v12abs }; // unit vector v12
            if ((layoutOptions.edgeSmoothness * 2 > v12abs)) {
                dx = v12.x / 2;
                dy = v12.y / 2;
            } else {
                dx = layoutOptions.edgeSmoothness * uv12.x;
                dy = layoutOptions.edgeSmoothness * uv12.y;
            }
            path += " Q" + p1.x + "," + p1.y + " " + (p1.x + dx) + "," + (p1.y + dy); // quadratic curve with vertex as control point
        }
        path += " L" + points[points.length - 1].x + "," + points[points.length - 1].y; // straight line to end
        return path;
    };

    /**
     * Causes the links to bend around the rectangles.
     * Source: https://github.com/tgdwyer/WebCola/blob/master/WebCola/examples/unix.html#L140
     */
    const routeEdges = function () {
        if (links.length == 0 || !layoutOptions.enableEdgeRouting) {
            return;
        }
        try {
            simulation.prepareEdgeRouting();
        } catch (err) {
            console.error(err);
            return;
        }
        try {
            link.selectAll("path")
                .attr("d", d => lineFunction(simulation.routeEdge(d, undefined, undefined)));
        } catch (err) {
            console.error(err);
            return;
        }
        try {
            if (isIE())
                link.selectAll("path").each(function (d) {
                    this.parentNode.insertBefore(this, this);
                });
        } catch (err) {
            console.error(err);
            return;
        }
        link.select(".edge-foreign-object")
            .attr("x", function (d) {
                const thisSel = d3.select(this);
                const textWidth = thisSel.select("text").node().offsetWidth;
                const arrayX = simulation.routeEdge(d, undefined, undefined);
                const middleIndex = Math.floor(arrayX.length / 2) - 1;
                const midpoint = (arrayX[middleIndex].x + arrayX[middleIndex + 1].x - textWidth) / 2;
                // TODO temporary hack to reduce occurrence of edge text jitter
                const oldX = thisSel.attr("x");
                return Math.abs(midpoint - oldX) > 2.5 ? midpoint : oldX;
            })
            .attr("y", function (d) {
                const thisSel = d3.select(this);
                const textHeight = thisSel.select("text").node().offsetHeight;
                const arrayY = simulation.routeEdge(d, undefined, undefined);
                const middleIndex = Math.floor(arrayY.length / 2) - 1;
                const midpoint = (arrayY[middleIndex].y + arrayY[middleIndex + 1].y - textHeight) / 2;
                const oldY = thisSel.attr("y");
                return Math.abs(midpoint - oldY) > 2.5 ? midpoint : oldY;
            });
    };


    /**
     * restart function adds and removes nodes.
     * It also restarts the simulation.
     * This is where aesthetics can be changed.
     * @param callback
     * @param preventLayout
     * @param constraintIterations - number of additional constraint iterations to perform
     */
    function restart(callback?, preventLayout?, constraintIterations ?: number) {
        const ci = constraintIterations ?? 1;
        return Promise.resolve()
            .then(() => {
                if (!preventLayout) {
                    return updateStyles();
                }
            })
            .then(repositionText)
            .then(() => {
                // Restart the simulation.
                simulation
                    .links(links) // Required because we create new link lists
                    .groups(groups)
                    // TODO why iterate  - avoid iteration maybe if no new additions?
                    // .start(10, 15, 20, 0, true, false)
                    .start(ci, ci, ci, 0, true, false)
                    .on("tick", function () {
                        node.each((d) => {
                            if (d.bounds) {
                                // Initiate the innerBounds, and create it based on the width and height
                                // of the node.
                                d.innerBounds = d.bounds.inflate(0);
                                d.innerBounds.X = d.innerBounds.x + d.width;
                                d.innerBounds.Y = d.innerBounds.y + d.height;
                            }
                        });
                        node.attr("transform", d => d.innerBounds ?
                            `translate(${d.innerBounds.x},${d.innerBounds.y})`
                            : `translate(${d.x},${d.y})`);
                        updatePathDimensions();
                        link.selectAll("path").attr("d", function (d) {
                            let route;
                            try {
                                route = cola.makeEdgeBetween(d.source.innerBounds, d.target.innerBounds, 5);
                                if (layoutOptions.edgeTextOrientWithPath) {
                                    const e = route.sourceIntersection;
                                    const s = route.arrowStart;
                                    d3.select(this.parentNode)
                                        .select("text")
                                        .style("transform", () => `rotate(${Math.atan((e.y - s.y) / (e.x - s.x))}rad)`);
                                }
                            } catch (err) {
                                console.error(err);
                                return;
                            }
                            return lineFunction([route.sourceIntersection, route.arrowStart]);
                        });
                        if (isIE())
                            link.each(function (d) {
                                this.parentNode.insertBefore(this, this);
                            });
                        link.select(".edge-foreign-object")
                            .attr("x", function (d) {
                                const textWidth = d3.select(this).select("text").node().offsetWidth;
                                let route;
                                try {
                                    route = cola.makeEdgeBetween(d.source.innerBounds, d.target.innerBounds, 5);
                                } catch (err) {
                                    console.error(err);
                                    return 0;
                                }
                                return (route.sourceIntersection.x + route.targetIntersection.x - textWidth) / 2;
                            })
                            .attr("y", function (d) {
                                const textHeight = d3.select(this).select("text").node().offsetHeight;
                                let route;
                                try {
                                    route = cola.makeEdgeBetween(d.source.innerBounds, d.target.innerBounds, 5);
                                } catch (err) {
                                    console.error(err);
                                    return 0;
                                }
                                return (route.sourceIntersection.y + route.targetIntersection.y - textHeight) / 2;
                            });

                        group.attr("transform", d => `translate(${d.bounds.x},${d.bounds.y})`);
                        repositionGroupText();
                        group.select("rect")
                            .attr("width", function (d) {
                                return d.bounds.width();
                            })
                            .attr("height", function (d) {
                                return d.bounds.height();
                            });
                    }).on("end", routeEdges);


                // After a tick make sure to add translation to the nodes.
                // Sometimes it wasn"t added in a single tick.
                node.attr("transform", d => d.innerBounds ?
                    `translate(${d.innerBounds.x},${d.innerBounds.y})`
                    : `translate(${d.x},${d.y})`);
                repositionGroupText();
            })
            .then(() => typeof callback === "function" && callback());
    }

    /**
     * Handle layout of disconnected graph components.
     */
    function handleDisconnects() {
        simulation.handleDisconnected(true);
        restart().then(() => {
            simulation.handleDisconnected(false);
        });
    }

    /**
     * Helper function for updating links after node mutations.
     */
    function createNewLinks(preventLayout?: boolean) {
        return new Promise((resolve, reject) => tripletsDB.get({},
            (err, l) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(l);
                }
            })
        ).then((l) => {
            // Create edges based on LevelGraph triplets
            links = (<any[]>l).map(({ subject, object, predicate }) => {
                const source = nodeMap.get(subject);
                const target = nodeMap.get(object);
                predicateMap.set(predicate.hash, predicate); // update predicateMap to match new link object
                return { source, target, predicate };
            });
        }).catch((err) => {
            console.error(err);
        }).then(() => {
            if (!preventLayout) {
                return restart();
            }
        });

    }


    function reverseTriplets(): Promise<void> {
        return new Promise<{ subject: string, object: string, predicate: any }[]>((resolve, reject) => {
            // get all existing edges
            tripletsDB.get({}, (err, l) => {
                if (err) {
                    console.error(err);
                    reject(err);
                } else {
                    resolve(l);
                }
            });
        }).then((l) => {
            // delete edges from database
            return new Promise<{ subject: string, object: string, predicate: any }[]>((resolve, reject) => {
                tripletsDB.del(l, (err) => {
                    if (err) {
                        console.error(err);
                        reject(err);
                    }
                    resolve(l);
                });
            });
        }).then((l) => {
            // reverse the links
            const reversedLinks = l.map(({ subject, object, predicate }) => {
                predicate.subject = object;
                predicate.object = subject;
                return { subject: object, predicate, object: subject };
            });
            // update links array
            links = reversedLinks.map(({ subject, object, predicate }) => {
                const source = nodeMap.get(subject);
                const target = nodeMap.get(object);
                predicateMap.set(predicate.hash, predicate);
                return { source, target, predicate };
            });
            return reversedLinks;
        }).then((l) => {
            // repopulate database
            tripletsDB.put(l);
        });
    }

    /**
     * Take a node object or list of nodes and add them.
     * @param {object | object[]} nodeObjectOrArray
     * @param preventLayout
     */
    function addNode(nodeObjectOrArray, preventLayout?: boolean) {
        /** Define helper functions at the top */
        /**
         * Checks if object is an array:
         * http://stackoverflow.com/a/34116242/6421793
         * @param {object|Array} obj
         */
        function isArray(obj) {
            return !!obj && obj.constructor === Array;
        }

        function addNodeObjectHelper(nodeObject) {
            // Check that hash exists
            if (!(nodeObject.hash)) {
                throw new Error("Node requires a hash field.");
            }
            // //TODO hack improved. doesnt work with window resizing. check resizing on SWARM end before implementing fix
            // if (!(nodeObject.x && nodeObject.y)) {
            //     let point = transformCoordinates({
            //         x: layoutOptions.width / 2,
            //         y: layoutOptions.height / 2
            //     });
            //     if (!nodeObject.x) {
            //         nodeObject.x = point.x;
            //     }
            //     if (!nodeObject.y) {
            //         nodeObject.y = point.y;
            //     }
            // }
            // TODO: remove this hack
            if (!(nodeObject.x)) {
                nodeObject.x = layoutOptions.width / 2;
            }
            if (!(nodeObject.y)) {
                nodeObject.y = layoutOptions.height / 2;
            }
            // Add node to graph
            if (!nodeMap.has(nodeObject.hash)) {
                simulation.stop();
                // Set the node
                nodes.push(nodeObject);
                nodeMap.set(nodeObject.hash, nodeObject);
            }
        }

        /**
         * Check that the input is valid
         */
        if (typeof nodeObjectOrArray !== "object") {
            throw new Error("Parameter must be either an object or an array");
        }
        if (isArray(nodeObjectOrArray)) {
            // Run through the array adding the nodes
            nodeObjectOrArray.forEach(addNodeObjectHelper);
        } else {
            addNodeObjectHelper(nodeObjectOrArray);
        }
        // Draw the changes, and either fire callback or pass it on to restart.
        if (!preventLayout) {
            return restart();
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Validates triplets.
     * @param {object} tripletObject
     */
    function tripletValidation(tripletObject) {
        /**
         * Check that minimum requirements are met.
         */
        if (tripletObject === undefined) {
            throw new Error("TripletObject undefined");
        }
        // Node needs a unique hash associated with it.
        const subject = tripletObject.subject, predicate = tripletObject.predicate, object = tripletObject.object;
        if (!(subject && predicate && object)) {
            throw new Error("Triplets added need to include all three fields.");
        }
        // Check that hash exists
        if (!(subject.hash && object.hash)) {
            throw new Error("Subject and Object require a hash field.");
        }
        // Check that type field exists on predicate
        if (!predicate.type) {
            throw new Error("Predicate requires type field.");
        }
        // Check that type field is a string on predicate
        if (typeof predicate.type !== "string") {
            throw new Error("Predicate type field must be a string");
        }
        return true;
    }

    /**
     * Adds a triplet object. Adds the node if it's not already added.
     * Otherwise it just adds the edge
     * @param {object} tripletObject
     * @param preventLayout
     */
    function addTriplet(tripletObject, preventLayout?) {
        if (!tripletValidation(tripletObject)) {
            return Promise.reject("Invalid triplet");
        }
        // Node needs a unique hash associated with it.
        const subject = tripletObject.subject, predicate = tripletObject.predicate, object = tripletObject.object;
        // Check that predicate doesn't already exist
        return new Promise((resolve, reject) => tripletsDB.get({
            subject: subject.hash,
            predicate: predicate,
            object: object.hash
        }, function (err, list) {
            if (err)
                reject(err);
            resolve(list.length === 0);
        }))
            .then(doesntExist => {
                if (!doesntExist) {
                    return Promise.reject("Edge already exists");
                }
                /**
                 * If a predicate type already has a color,
                 * it is not redefined.
                 */
                const edgeColor = typeof layoutOptions.edgeColor == "string" ? layoutOptions.edgeColor : layoutOptions.edgeColor(predicate);
                // arrowhead change
                if (!predicateTypeToColorMap.has(edgeColor)) {
                    predicateTypeToColorMap.set(edgeColor, true);
                    // Create an arrow head for the new color
                    createColorArrow(defs, "#" + edgeColor);
                }
                /**
                 * Put the triplet into the LevelGraph database
                 * and mutates the d3 nodes and links list to
                 * visually pop on the node/s.
                 */
                const newTriplet = {
                    subject: subject.hash,
                    predicate: predicate,
                    object: object.hash
                };
                return new Promise((resolve, reject) => {
                    tripletsDB.put(newTriplet, (err) => {
                        err ? reject(err) : resolve();
                    });
                });
            })
            .then(() => {
                /**
                 * If the predicate has a hash, it is added to a Map.
                 * This way we can mutate the predicate to manipulate its
                 * properties.
                 * Basically we are saving a reference to the predicate object.
                 */
                if (predicate.hash) {
                    if (predicateMap.has(predicate.hash)) {
                        console.warn("Edge hash must be unique. There already exists a predicate with the hash: ", predicate.hash);
                    }
                    predicateMap.set(predicate.hash, predicate);
                }
                // Add nodes to graph
                simulation.stop();
                if (!nodeMap.has(subject.hash)) {
                    // Set the node
                    nodes.push(subject);
                    nodeMap.set(subject.hash, subject);
                }
                if (!nodeMap.has(object.hash)) {
                    nodes.push(object);
                    nodeMap.set(object.hash, object);
                }
                if (tripletObject.predicate.constraint) {
                    const nodePair = [tripletObject.predicate.constraint.leftIndex, tripletObject.predicate.constraint.rightIndex];
                    constrain(tripletObject.predicate.constraint, nodePair);
                }
                if (!preventLayout) {
                    return createNewLinks();
                }
                return Promise.resolve();
            })
            .catch((err) => {
                console.error(err);
                return Promise.reject(err);
            });
    }

    /**
     * Removes a triplet object. Silently fails if edge doesn't exist.
     * @param {object} tripletObject
     * @param preventLayout - prevent restart from occurring
     */
    function removeTriplet(tripletObject, preventLayout?: boolean) {
        if (!tripletValidation(tripletObject)) {
            return;
        }
        const subject = tripletObject.subject, predicate = tripletObject.predicate, object = tripletObject.object;
        return new Promise((resolve, reject) => tripletsDB.del({
            subject: subject.hash,
            predicate: predicate,
            object: object.hash
        }, function (err) {
            if (err)
                reject(err);
            resolve();
        })).then(() => {
            predicateMap.delete(predicate.hash);
            if (tripletObject.predicate.constraint) {
                removeConstraint(tripletObject.predicate.constraint);
            }
            simulation.stop();
            if (!preventLayout) {
                return createNewLinks();
            }
        });
    }

    /**
     * Update edge data. Fails silently if doesnt exist
     * @param {object} tripletObject
     */
    function updateTriplet(tripletObject) {
        if (!tripletValidation(tripletObject)) {
            return;
        }
        const subject = tripletObject.subject, predicate = tripletObject.predicate, object = tripletObject.object;
        tripletsDB.del({ subject: subject.hash, object: object.hash }, (err) => {
            if (err) {
                console.error(err);
            }
            tripletsDB.put({
                subject: subject.hash,
                predicate: predicate,
                object: object.hash
            }, (err) => {
                if (err) {
                    console.error(err);
                }
            });
        });
    }

    /**
     * Removes the node and all triplets associated with it.
     * @param {string} nodeHash hash of the node to remove.
     */
    function removeNode(nodeHash: Id) {
        tripletsDB.get({ subject: nodeHash }, function (err, l1) {
            if (err) {
                return console.error(err);
            }
            tripletsDB.get({ object: nodeHash }, function (err, l2) {
                if (err) {
                    return console.error(err);
                }
                // Check if the node exists
                if (l1.length + l2.length === 0) {
                    // Once the edges are deleted we can remove the node.
                    let nodeIndex = -1;
                    for (let i = 0; i < nodes.length; i++) {
                        if (nodes[i].hash === nodeHash) {
                            nodeIndex = i;
                            break;
                        }
                    }
                    if (nodeIndex === -1) {
                        return console.error("There is no node");
                    }
                    simulation.stop();
                    const node = nodeMap.get(nodeHash);
                    // constraints are based on node index constraint MUST be deleted first
                    if (node.constraint) {
                        unconstrain(nodeHash);
                    }
                    nodes.splice(nodeIndex, 1);
                    if (node.parent) {
                        unGroup({ nodes: [nodeHash] }, true);
                    }
                    nodeMap.delete(nodeHash);
                    createNewLinks();
                    updateConstraintIndexing();
                    return;
                }
                tripletsDB.del([...l1, ...l2], function (err) {
                    if (err) {
                        return err;
                    }
                    // Once the edges are deleted we can remove the node.
                    let nodeIndex = -1;
                    for (let i = 0; i < nodes.length; i++) {
                        if (nodes[i].hash === nodeHash) {
                            nodeIndex = i;
                            break;
                        }
                    }
                    if (nodeIndex === -1) {
                        return console.error("There is no node");
                    }
                    simulation.stop();
                    nodes.splice(nodeIndex, 1);
                    nodeMap.delete(nodeHash);
                    createNewLinks();
                });
            });
        });
    }

    /**
     * Function that fires when a node is clicked.
     * @param {Function} selectNodeFunc
     */
    function setClickNode(selectNodeFunc) {
        layoutOptions.clickNode = selectNodeFunc;
    }

    /**
     * Function that fires when a node is double clicked.
     * @param {Function} selectNodeFunc
     */
    function setDblClickNode(selectNodeFunc) {
        layoutOptions.dblclickNode = selectNodeFunc;
    }

    /**
     * Public function to mutate edge objects
     * can mutate single edges or multiple edges at once
     * can mutate multiple edges to have 1 value, or multiple edges to each have their own value
     * for multiple values, value array length==id array length, first value will be mapped to first id in array etc...
     * @param action {Object} action - action to be performed
     * @param action.property {string}: property to be mutated - string
     * @param action.id {(string|string[])}: hash(es) of edges to be mutated
     * @param action.value {(any|any[])}: new value to set property, single value or array of values.
     */
    function editEdge(action) {
        if (action === undefined || action.property === undefined || action.id === undefined) {
            return;
        }
        const prop = action.property;
        const idArray = Array.isArray(action.id) ? action.id : [action.id];
        const values = Array.isArray(action.value) ? action.value : [action.value];
        const multipleValues = (values.length > 1) && (idArray.length === values.length);
        const predicateArray = idArray.map(x => predicateMap.get(x));
        const editEdgeHelper = prop => {
            if (multipleValues) {
                predicateArray.forEach((d, i) => {
                    d[prop] = values[i];
                });
            } else {
                predicateArray.forEach(d => {
                    d[prop] = values[0];
                });
                updateStyles();
            }
        };
        switch (prop) {
            case "text": {
                editEdgeHelper("text");
                restart();
                break;
            }
            case "arrow": {
                editEdgeHelper("arrowhead");
                restart();
                break;
            }
            case "weight": {
                editEdgeHelper("strokeWidth");
                restart();
                break;
            }
            case "dash": {
                editEdgeHelper("strokeDasharray");
                restart();
                break;
            }
            case "color": {
                editEdgeHelper("stroke");
                restart();
                break;
            }
            default: {
                editEdgeHelper(prop);
                console.warn("Caution. You are modifying a new or unknown property: %s.", prop);
            }
        }
        // Update triplets DB with new predicate(s)
        const subObjArray = predicateArray.map(p => ({ subject: p.subject, object: p.object }));
        const newTripletsArray = predicateArray.map(p => ({ subject: p.subject, predicate: p, object: p.object }));
        tripletsDB.del(subObjArray, (err) => {
            if (err) {
                console.error(err);
            }
            tripletsDB.put(newTripletsArray, (err) => {
                if (err) {
                    console.error(err);
                }
            });
        });
    }

    /**
     * Public function to mutate node objects
     * can mutate single nodes or multiple nodes at once
     * can mutate multiple nodes to have 1 value, or multiple nodes to each have their own value
     * for multiple values, value array length==id Array length, first value will be mapped to first id in array etc...
     * @param action {Object} action - action to be performed
     * @param action.property {string}: property to be mutated - string
     * @param action.id {(string|string[])}: id(s) of nodes to be mutated
     * @param action.value {(any|any[])}: new value to set property, single value or array of values.
     */
    function editNode(action) {
        if (action === undefined || action.property === undefined || action.id === undefined) {
            return;
        }
        const prop = action.property;
        const idArray = Array.isArray(action.id) ? action.id : [action.id];
        const values = Array.isArray(action.value) ? action.value : [action.value];
        const multipleValues = (values.length > 1) && (idArray.length === values.length);
        const nodeArray = idArray.map(x => nodeMap.get(x));
        const editNodeHelper = (prop) => {
            if (multipleValues) {
                nodeArray.forEach((d, i) => {
                    d[prop] = values[i];
                });
            } else {
                nodeArray.forEach(d => {
                    d[prop] = values[0];
                });
            }
        };
        switch (prop) {
            case "color": {
                editNodeHelper(prop);
                idArray.forEach((id, i) => {
                    if (multipleValues) {
                        node.filter(d => d.id === id).select("path").attr("fill", values[i]);
                    } else {
                        node.filter(d => d.id === id).select("path").attr("fill", values[0]);
                    }
                });
                // TODO either make colour change +text here or in updatestyles, not both.
                updateStyles();
                break;
            }
            case "nodeShape": {
                editNodeHelper(prop);
                const shapePaths = idArray.map(id => typeof layoutOptions.nodePath === "function" ?
                    layoutOptions.nodePath(nodeMap.get(id)) : layoutOptions.nodePath);
                idArray.forEach((id, i) => {
                    if (multipleValues) {
                        node.filter(d => d.id === id).select("path").attr("d", shapePaths[i]);
                    } else {
                        node.filter(d => d.id === id).select("path").attr("d", shapePaths[0]);
                    }
                });
                updateStyles();
                break;
            }
            case "fixed": {
                editNodeHelper(prop);
                restart();
                break;
            }
            case "fixedWidth": {
                editNodeHelper(prop);
                restart();
                break;
            }
            case "shortname": {
                editNodeHelper(prop);
                restart();
                break;
            }
            case "img": {
                editNodeHelper(prop);
                restart();
                break;
            }
            default: {
                editNodeHelper(prop);
                restart();
                const list = ["x", "y"];
                if (!list.includes(prop)) {
                    console.warn("Caution. You are modifying a new or unknown property: %s.", action.property);
                }
            }
        }
    }

    /**
     * Invoking this function will recenter the graph.
     */
    // function recenterGraph(){
    //     svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1))
    // }
    /**
     * Function to call when mouse over registers on a node.
     * It takes a d3 mouse over event.
     * @param {Function} mouseOverCallback
     */
    function setMouseOver(mouseOverCallback) {
        layoutOptions.mouseOverNode = mouseOverCallback;
    }

    /**
     * Function to call when mouse out registers on a node.
     * It takes a d3 mouse over event.
     * @param {Function} mouseOutCallback
     */
    function setMouseOut(mouseOutCallback) {
        layoutOptions.mouseOutNode = mouseOutCallback;
    }

    /**
     * Function called when mousedown on node.
     * @param mouseDownCallback - callback function
     */
    function setMouseDown(mouseDownCallback) {
        layoutOptions.mouseDownNode = mouseDownCallback;
    }

    /**
     * Add a node or a group to a group
     * @param group - target group, either an existing group, or a new group to create
     * @param children - object containing nodes and/or groups property
     * @param children.nodes - list of node IDs
     * @param children.groups - list of group IDs
     * @param preventLayout - prevent layout restart from occurring
     */
    function addToGroup(group, children: { nodes?: Id[]; groups?: Id[] }, preventLayout?: boolean) {
        const nodeId = children.nodes || [];
        const subGroupId = children.groups || [];
        // check minimum size TODO: investigate min size ~ya
        // if (nodeId.length === 0 && (subGroupId && subGroupId.length <= 1)) {
        //     return Promise.reject(new Error("Minimum 1 node or two subgroups"));
        // }
        // check nodes
        const nodeIndices: number[] = nodeId.map(id => nodes.findIndex(d => d.id === id));
        if (!nodeIndices.every(i => i >= 0)) {
            return Promise.reject(new Error("One or more nodes do not exist. Check node hash is correct"));
        }
        // check subGroups
        const groupIndices = subGroupId.map(id => groups.findIndex(g => g.id === id));
        if (!groupIndices.every(i => i < groups.length && i >= 0)) {
            return Promise.reject(new Error("One or more groups do not exist."));
        }


        const nodesWithParentsID = nodeId.filter(id => nodeMap.get(id).parent);
        if (nodesWithParentsID.length > 0) {
            unGroup({ nodes: nodesWithParentsID }, true);
        }

        const groupsWithParentsID = subGroupId.filter(id => groupMap.get(id).parent);
        if (groupsWithParentsID.length > 0) {
            unGroup({ groups: groupsWithParentsID });
        }


        // get target group, if does not exist, create new group
        simulation.stop();
        const groupId = typeof (group) === "string" ? group : group.id;
        let groupObj = groupMap.get(groupId);
        const data = group.data
            ? group.data : {
                level: 0,
                color: typeof layoutOptions.groupFillColor === "function" && layoutOptions.groupFillColor() || layoutOptions.groupFillColor,
            };
        if (!groupObj) {
            groupObj = {
                id: groupId,
                leaves: [],
                groups: [],
                data,
            };
            groups.push(groupObj);
            groupMap.set(groupId, groupObj);
        } else {
            if (!groupObj.leaves) {
                groupObj.leaves = [];
            }
            if (!groupObj.groups) {
                groupObj.groups = [];
            }
        }
        groupObj.leaves = groupObj.leaves.concat(nodeIndices);
        groupObj.groups = groupObj.groups.concat(groupIndices);
        subGroupId.forEach((id) => {
            const g = groupMap.get(id);
            g.data.level = (groupObj.data.level || 0) + 1;
        });
        if (!preventLayout) {
            if (groupObj.data.text) {
                return restart().then(() => repositionGroupText());
            }
            return restart();
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Remove a group or node from a group
     * @param children - object containing nodes and/or groups property. they are arrays of ID values
     * @param preventLayout - prevent layout restart from occurring
     */
    function unGroup(children: { nodes?: Id[]; groups?: Id[] } | [{ nodes?: Id[]; groups?: Id[] }], preventLayout?: boolean) {
        simulation.stop();
        const childArray = Array.isArray(children) ? children : [children];
        childArray.forEach(child => {
            if (child.nodes) {
                // remove nodes from groups
                const leaves = child.nodes.map(id => nodeMap.get(id));
                leaves.forEach(d => {
                    if (d.parent) {
                        d.parent.leaves = d.parent.leaves.filter(leaf => leaf.id !== d.id);
                        delete d.parent;
                    }
                });
            }
            if (child.groups) {
                // remove groups from groups
                const subGroups = child.groups.map(id => {
                    const i = groups.findIndex(g => g.id === id);
                    return groups[i];
                });
                subGroups.forEach(g => {
                    if (g.parent) {
                        g.parent.groups = g.parent.groups.filter(sibling => sibling.id !== g.id);
                        delete g.parent;
                        g.data.level = 0;
                    }
                });
            }
        });

        // remove empty groups
        groups = groups.filter(g => {
            if (g.leaves.length === 0 && g.groups.length <= 1) {
                groupMap.delete(g.id);
                // empty group is a child of another group
                if (g.parent) {
                    g.parent.groups = g.parent.groups.filter(subgroup => subgroup.id !== g.id);
                }
                return false;
            } else {
                return true;
            }
        });
        if (!preventLayout) {
            return restart();
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Function to remove a constraint from simulation
     * Internal use only for removing constraints
     * requires restarting simulation after
     * @param constraint
     */
    function removeConstraint(constraint: Constraint) {
        const index = constraints.findIndex(c => c === constraint);
        if (index === -1) {
            console.warn("Cannot delete constraint, does not exist.", constraint);
            return;
        }
        let constrainedNodes;
        if (constraint.type === "separation") {
            constrainedNodes = [nodeMap.get(constraint.leftID), nodeMap.get(constraint.rightID)];
        } else {
            constrainedNodes = constraint.nodeOffsets.map(({ id }) => nodeMap.get(id));
        }
        // remove constraints from nodes
        constrainedNodes.forEach(d => {
            if (d.constraint) {
                d.constraint = d.constraint.filter(c => c !== constraint);
            }
        });
        constraints.splice(index, 1);
        simulation
            .constraints(constraints);
    }

    /**
     * Create a new constraint or add nodes to existing constraint
     * constraints between a pair of nodes e.g. separation constraint cannot be modified, only delete and create
     * see: https://github.com/tgdwyer/WebCola/wiki/Constraints for constraint documentation
     * note: 'left' and 'right' refer to left and right side of equality equations, not directions
     * requires restarting simulation after
     *
     * @param consData - constraint object. see interfaces.ts for structure, does not need to contain nodes for input
     * @param targets - array of node Ids to be added to constraint, either a tuple for separation constraints or object list for alignment
     */
    function constrain(consData: InputAlignConstraint | AlignConstraint, targets: { id: Id; offset: number }[]);
    function constrain(consData: InputSeparationConstraint, targets: [Id, Id]);
    function constrain(consData: InputAlignConstraint | AlignConstraint | InputSeparationConstraint,
                       targets: [Id, Id] | { id: Id; offset: number }[]) {
        if (consData.type === "separation") {
            const idPair = <[Id, Id]>targets;
            // separation constraint cannot be edited.
            if (idPair.length !== 2) {
                throw `Cannot create constraint ${consData}, incorrect number of nodes ${idPair}`;
            }

            const [leftID, rightID] = idPair;
            const [left, right] = idPair.map(id => nodes.findIndex(d => d.id === id));
            if (left === -1 || right === -1) {
                throw `Cannot create constraint ${consData}, Node does not exist. ${idPair}`;
            }

            // create constraint
            const constraint: SeparationConstraint = { ...consData, left, right, leftID, rightID };
            constraints.push(constraint);

            // add constraint property on nodes
            idPair
                .map(id => nodeMap.get(id))
                .forEach(node => addConstraintToNode(constraint, node));
        } else if (consData.type === "alignment") {
            // alignment constraint is either new constraint, or editing existing constraint

            const nodeOffsetsID = <Array<{ id: Id; offset: number }>>targets;
            // remove duplicate targets
            let nodeOffsets = [...new Set(nodeOffsetsID)];
            // remove targets already in constraint
            // check if constraint exists first
            if (constraints.includes(<AlignConstraint>consData)) {
                const initLen = nodeOffsets.length;
                // remove already constrained nodes
                nodeOffsets = nodeOffsets.filter(nO => !consData.nodeOffsets.includes(nO));
                // warn message if nodes excluded
                if (nodeOffsets.length < initLen) {
                    console.warn("Nodes already constrained", consData, targets);
                }
                // break if no nodes left
                if (nodeOffsets.length === 0) {
                    return;
                }
            }

            //  calculate node offset indices from node IDs
            const offsets = nodeOffsets.map(({ id, offset }) => {
                const i = nodes.findIndex(d => d.id === id);
                if (i === -1) {
                    console.warn(consData);
                    throw new Error("Cannot create constraint, Node does not exist.");
                }
                return { node: i, offset };
            });
            // modify consData object instead of creating new object because constraint might already exist
            // update constraint
            if (consData.offsets) {
                consData.offsets.push(...offsets);
                consData.nodeOffsets.push(...nodeOffsets);
            } else {
                consData.offsets = offsets;
                consData.nodeOffsets = nodeOffsets;
            }

            // if new constraint bind bounds method
            if (!(<AlignConstraint>consData).bounds) {
                (<AlignConstraint>consData).bounds = () => constraintBounds((<AlignConstraint>consData));
            }

            if (!constraints.includes(<AlignConstraint>consData)) {
                constraints.push(<AlignConstraint>consData);
            }

            // add reference to constraint on node
            nodeOffsets.forEach(({ id }) => {
                const node = nodeMap.get(id);
                if (node.constraint) {
                    node.constraint.push(<AlignConstraint>consData);
                } else {
                    node.constraint = [<AlignConstraint>consData];
                }
            });
        } else {
            console.warn("Unknown constraint type, default action executed.");
            constraints.push(consData);
        }
        simulation
            .constraints(constraints);
    }

    /**
     * Function to remove nodes from constraints
     * to delete a constraint, remove all its nodes
     * requires restarting simulation after
     *
     * @param nodeId - list of node IDs
     * @param [constraint] - optional remove node only from this constraint - default is to remove all constraints on node
     */
    function unconstrain(nodeId: Id | Id[], constraint?: Constraint) {
        const nodeIdArr = Array.isArray(nodeId) ? nodeId : [nodeId];
        const node = nodeIdArr.map(id => nodeMap.get(id));
        const nodeIndex = nodeIdArr.map(target => nodes.findIndex(({ id }) => id === target));
        let removeConst: Constraint[];

        if (constraint) {
            // in the case of a given constraint only constraint to remove is given one
            removeConst = [constraint];
        } else {
            // remove all constraints on nodes
            // get constraints, remove undefined, flatten, filter unique
            const removeSet = node.reduce((acc, cur) => {
                cur.constraint && cur.constraint.forEach(c => acc.add(c));
                return acc;
            }, new Set<Constraint>());
            // array of unique constraints that will have some/all nodes removed
            removeConst = [...removeSet];
        }
        // remove nodes from constraints
        removeConst.forEach(c => {
            if (c.type === "separation") {
                // removing a node from a separation constraint is the same as deleting the whole constraint
                removeConstraint(c);
            } else if (c.type === "alignment") {
                c.nodeOffsets = c.nodeOffsets.filter(idOffset => !nodeIdArr.includes(idOffset.id));
                c.offsets = c.offsets.filter(offset => !nodeIndex.includes(offset.node));
            }
        });

        // remove constraints from nodes
        node.forEach(d => {
            if (d.constraint) {
                d.constraint = d.constraint.filter(c => !removeConst.includes(c));
            }
        });

        // delete empty alignment constraints
        const emptyConst = removeConst.filter((c) => c.type === "alignment" && c.offsets.length <= 1);
        emptyConst.forEach(removeConstraint);
    }

    /**
     * Must be triggered on deleting nodes, or if nodes array is reordered
     * TODO: consider smart updating that only checks nodes that could have changed index
     */
    function updateConstraintIndexing() {
        constraints.forEach(c => {
            if (c.type === "separation") {
                const left = nodes.findIndex((d => d.id === c.leftID));
                const right = nodes.findIndex((d => d.id === c.rightID));
                if (left === -1 || right === -1) {
                    console.warn("Node went missing, deleting constraint", c);
                    removeConstraint(c);
                }
            } else {
                const missingNodes = [];
                c.nodeOffsets.forEach(({ id }, i) => {
                    const index = nodes.findIndex(d => d.id === id);
                    if (index === -1) {
                        missingNodes.push(id);
                    }
                    c.offsets[i].node = index;
                });
                if (missingNodes.length > 0) {
                    console.warn("Nodes went missing, removing constraints", missingNodes);
                    unconstrain(missingNodes);
                }
            }
        });
    }

    /**
     * Toggle constraint line visibility
     * @param value - boolean value of constraint visibility
     * @param constraint - constraint or list of constraints to toggle, leaving blank will toggle all constraints
     * @param preventUpdate - prevent visual update (updatestyles) from occuring - will need to be done manually
     */
    function constraintVisibility(value: boolean = false, constraint?: AlignConstraint | AlignConstraint[], preventUpdate?: boolean) {
        const consToToggle = constraint ?? <AlignConstraint[]>(constraints.filter(({ type }) => type === "alignment"));
        const cons = asArray(consToToggle);
        cons.forEach((c) => {
            c.visible = value;
        });
        if (!preventUpdate) {
            updateStyles();
        }
    }

    const constraintBounds = (cons: AlignConstraint) => {
        if (cons.type !== "alignment") {
            throw new Error("Only valid for align constraints");
        }
        const consNodes = cons.offsets.map(o => nodes[o.node]);
        if (cons.axis === "x") {
            return {
                x: consNodes[0].x,
                X: consNodes[0].x,
                y: Math.min(...consNodes.map(({ bounds }) => bounds.y)) - 4,
                Y: Math.max(...consNodes.map(({ bounds }) => bounds.Y)) + 4,
            };
        } else {
            return {
                x: Math.min(...consNodes.map(({ bounds }) => bounds.x)) - 4,
                X: Math.max(...consNodes.map(({ bounds }) => bounds.X)) - 4,
                y: consNodes[0].y,
                Y: consNodes[0].y,
            };
        }
    };

    /**
     * // TODO update this documentation
     * Serialize the graph.
     * scheme: triplets: subj:hash-predicateType-obj:hash[]
     *         nodes: hash[]
     */
    function saveGraph(): Promise<string> {
        d3.selectAll(".radial-menu").remove();
        const svg = d3.select(".svg-content-responsive");
        const t = d3.zoomIdentity.translate(0, 0).scale(1);
        svg.call(zoom.transform, t);
        layoutOptions.zoomScale(1);

        return new Promise((resolve, reject) => {
            tripletsDB.get({}, (err, l) => {
                if (err) {
                    reject(err);
                } else {
                    const saved = JSON.stringify({
                        triplets: l.map(v => ({ subject: v.subject, predicate: v.predicate, object: v.object })),
                        nodes: nodes.map(v => ({ hash: v.hash, x: v.x, y: v.y })),
                        groups: groups.map(v => ({
                            children: {
                                nodes: v.leaves.map(d => d.id),
                                groups: v.groups.map(g => g.id),
                            },
                            id: v.id,
                            data: v.data
                        })),
                    });
                    resolve(saved);
                }
            });
        });
    }

    function dragged(d) {
        const e = d3.event;
        // prevent drag whilst image resizing
        if (internalOptions.isImgResize) {
            d.py = d.y;
            d.px = d.x;
            return;
        }
        // toggle visibility and update position only if constraint is visible
        // constraints will be hidden most of the time no need to compute each time
        constraint
            .attr("visibility", d => d.visible ? "visible" : "hidden")
            .filter(d => d.visible)
            .each(function (d) {
                // only calculate bounds once per constraint
                const consBounds = d.bounds();
                d3.select(this)
                    .selectAll("line")
                    .attr("y1", consBounds.y)
                    .attr("y2", consBounds.Y)
                    .attr("x1", consBounds.x)
                    .attr("x2", consBounds.X);
            });
        // Multiple item drag
        if (layoutOptions.isSelect && layoutOptions.isSelect() && layoutOptions.selection().nodes.size > 1) {
            const { dx, dy } = e;
            [...layoutOptions.selection().nodes.values()]
                .forEach(x => {
                    if (x.id !== d.id) {
                        x.px += dx;
                        x.py += dy;
                    }
                });
            return;
        }
        // Snap to alignment
        if (layoutOptions.snapToAlignment &&
            ((typeof layoutOptions.nodeToPin === "function" && layoutOptions.nodeToPin(d)) || (typeof layoutOptions.nodeToPin === "boolean" && layoutOptions.nodeToPin))) {
            alignElements.remove();
            const threshold = layoutOptions.snapThreshold;
            const xOffset = d.width / 2;
            const yOffset = d.height / 2;
            const gridX = new Map();
            const gridY = new Map();
            const gridCX = new Map();
            const gridCY = new Map();
            const dBoundsInflate = d.bounds.inflate(1);
            const xOverlapNodes = [];
            const yOverlapNodes = [];
            const foundAlignment = {
                x: false,
                xDist: false,
                y: false,
                yDist: false,
            };

            const mapHelper = (mapObj, key, value) => {
                mapObj.has(key) ? mapObj.set(key, mapObj.get(key).concat([value])) : mapObj.set(key, [value]);
            };

            nodes
                .filter(({ id }) => id !== d.id) // exclude target node
                .filter(d => (typeof layoutOptions.nodeToPin === "function" && layoutOptions.nodeToPin(d))
                    && layoutOptions.nodeToPin) // filter unpinned nodes
                .filter((node) => {
                    // exclude nodes that have an alignment constraint to target node.
                    if (d.constraint) {
                        const alignedIDs: Id[] = d.constraint
                            .filter(cons => cons.type === "alignment")
                            .map(({ nodeOffsets }) =>
                                nodeOffsets.map(({ id }) => id))
                            .flat();
                        return !alignedIDs.includes(node.hash);
                    } else {
                        return true;
                    }
                })
                .forEach((node) => {
                    // create map of possible alignment coordinates
                    const yCoords = [node.bounds.y, node.bounds.Y];
                    const xCoords = [node.bounds.x, node.bounds.X];
                    xCoords.forEach(x => mapHelper(gridX, Math.round(x * 2) / 2, { id: node.hash, data: yCoords }));
                    yCoords.forEach(y => mapHelper(gridY, Math.round(y * 2) / 2, { id: node.hash, data: xCoords }));
                    mapHelper(gridCX, Math.round(node.bounds.cx() * 2) / 2, { id: node.hash, data: yCoords });
                    mapHelper(gridCY, Math.round(node.bounds.cy() * 2) / 2, { id: node.hash, data: xCoords });
                    // find all overlapping node boundaries
                    if (node.bounds.overlapX(dBoundsInflate) > 0) {
                        xOverlapNodes.push(node.bounds);
                    }
                    if (node.bounds.overlapY(dBoundsInflate) > 0) {
                        yOverlapNodes.push(node.bounds);
                    }
                });

            const findAligns = ({ centreMap, edgeMap, offset, threshold, position }) => {
                // check for centre alignments
                let alignments = [...centreMap.entries()].reduce((acc, curr) => {
                    if (curr[0] > position - threshold && curr[0] < position + threshold && curr[1].length > acc.array.length) {
                        return { coord: curr[0], array: curr[1], offset: 0 };
                    }
                    return acc;
                }, { coord: undefined, array: [], offset: undefined });
                // check for edge alignments
                alignments = [...edgeMap.entries()].reduce((acc, curr) => {
                    if (curr[0] > position + offset - threshold && curr[0] < position + offset + threshold && curr[1].length > acc.array.length) {
                        return { coord: curr[0], array: curr[1], offset: offset };
                    }
                    if (curr[0] > position - offset - threshold && curr[0] < position - offset + threshold && curr[1].length > acc.array.length) {
                        return { coord: curr[0], array: curr[1], offset: -offset };
                    }
                    return acc;

                }, alignments);
                return alignments;
            };
            const xAlign = findAligns({
                centreMap: gridCX,
                edgeMap: gridX,
                offset: xOffset,
                threshold,
                position: e.x
            });
            const yAlign = findAligns({
                centreMap: gridCY,
                edgeMap: gridY,
                offset: yOffset,
                threshold,
                position: e.y
            });
            if (xAlign.coord) { // if X alignment found
                const yarr = xAlign.array.reduce((acc, curr) => acc.concat(curr.data), []);
                const bounds = {
                    x: xAlign.coord,
                    X: xAlign.coord,
                    y: Math.min(...yarr, d.bounds.y) - 4,
                    Y: Math.max(...yarr, d.bounds.Y) + 4,
                };
                const centreAlign = xAlign.offset === 0;
                const alignedID = xAlign.array.map(({ id }) => id);
                const alignedNodes = alignedID.map(id => nodeMap.get(id));
                const target = d;
                alignElements.create("x", { bounds, centreAlign, alignedNodes, target });
                d.px = xAlign.coord - xAlign.offset;
                foundAlignment.x = true;
            }
            if (yAlign.coord) { // if Y alignment found
                const xarr = yAlign.array.reduce((acc, curr) => acc.concat(curr.data), []);
                const bounds = {
                    x: Math.min(...xarr, d.bounds.x) - 4,
                    X: Math.max(...xarr, d.bounds.X) + 4,
                    y: yAlign.coord,
                    Y: yAlign.coord,
                };
                const centreAlign = yAlign.offset === 0;
                const alignedID = yAlign.array.map(({ id }) => id);
                const alignedNodes = alignedID.map(id => nodeMap.get(id));
                const target = d;
                alignElements.create("y", { bounds, centreAlign, alignedNodes, target });
                // +1 required otherwise nodes collide.
                const offset = yAlign.offset === 0 ? 0 : yAlign.offset > 0 ? yAlign.offset + 1 : yAlign.offset - 1;
                d.py = yAlign.coord - offset;
                foundAlignment.y = true;
            }

            // only include found alignments
            const foundAligns = foundAlignment.y || foundAlignment.x ? {
                ...(foundAlignment.x && { x: xAlign }),
                ...(foundAlignment.y && { y: yAlign })
            } : false;
            layoutOptions?.nodeDragged?.(d, undefined, foundAligns);


            // Sort overlapping boundaries by position in increasing order
            xOverlapNodes.sort((a, b) => (a.y - b.y));
            yOverlapNodes.sort((a, b) => (a.x - b.x));

            const findOverlapGroups = ({ bounds, splitThreshold, axis }) => {
                const invAxis = axis === "X" ? "Y" : "X";
                const overlapGroups = [];
                let index = -1;
                const visited: boolean[] = new Array(bounds.length).fill(false);
                let tempArray = [];
                let newNode = false;
                for (let i = 0; i < bounds.length; i++) {
                    if (bounds[i][invAxis] < splitThreshold) {
                        index = i;
                    }
                    if (visited.every(v => v)) {
                        continue;
                    }
                    newNode = false;
                    if (!visited[i]) {
                        newNode = true;
                        visited[i] = true;
                    }
                    tempArray = [bounds[i]];
                    for (let j = i + 1; j < bounds.length; j++) {
                        if ((axis === "X" && bounds[i].overlapX(bounds[j]) > 0) || (axis === "Y" && bounds[i].overlapY(bounds[j]) > 0)) {
                            if (!visited[j]) {
                                newNode = true;
                                visited[j] = true;
                            }
                            tempArray.push(bounds[j]);
                        }
                    }
                    if (newNode && tempArray.length > 1) {
                        overlapGroups.push(tempArray);
                    }
                }
                return { overlapGroups, index };
            };

            const { overlapGroups: xOverlapGroups, index: xIndex } = findOverlapGroups({
                bounds: xOverlapNodes,
                splitThreshold: e.y - yOffset,
                axis: "X",
            });
            const { overlapGroups: yOverlapGroups, index: yIndex } = findOverlapGroups({
                bounds: yOverlapNodes,
                splitThreshold: e.x - xOffset,
                axis: "Y",
            });
            const dimensioningLines = {
                projection: [],
                dimension: [],
            };
            // If overlaps found in X axis

            if (xOverlapGroups.length > 0) {
                const xGaps = new Map();
                xOverlapGroups.forEach((group) => {
                    for (let i = 1; i < group.length; i++) {
                        mapHelper(xGaps, group[i].y - group[i - 1].Y, [group[i - 1], group[i]]);
                    }
                });

                const dimensionLineHelper = (pair) => {
                    const x = Math.max(...pair.reduce((acc, curr) => acc.concat(curr.X), []));
                    dimensioningLines.projection.push({
                        x: pair[0].X,
                        X: x + 12,
                        y: pair[0].Y,
                        Y: pair[0].Y,
                    });
                    dimensioningLines.projection.push({
                        x: pair[1].X,
                        X: x + 12,
                        y: pair[1].y,
                        Y: pair[1].y,
                    });
                    dimensioningLines.dimension.push({
                        x: x + 9,
                        X: x + 9,
                        y: pair[0].Y,
                        Y: pair[1].y,
                    });
                };

                const dimLinesBelow = (i, g) => {
                    const X = Math.max(d.bounds.X, xOverlapNodes[i].X);
                    // projection line on target node
                    dimensioningLines.projection.push({
                        x: d.bounds.X,
                        X: X + 12,
                        y: xOverlapNodes[i].y - g,
                        Y: xOverlapNodes[i].y - g,
                    });
                    // projection line on neighbour node
                    dimensioningLines.projection.push({
                        x: xOverlapNodes[i].X,
                        X: X + 12,
                        y: xOverlapNodes[i].y,
                        Y: xOverlapNodes[i].y,
                    });
                    // dimension line between projection lines
                    dimensioningLines.dimension.push({
                        x: X + 9,
                        X: X + 9,
                        y: xOverlapNodes[i].y - g,
                        Y: xOverlapNodes[i].y,
                    });
                };

                const dimLinesAbove = (i, g) => {
                    const X = Math.max(d.bounds.X, xOverlapNodes[i].X);
                    // projection line on target node
                    dimensioningLines.projection.push({
                        x: d.bounds.X,
                        X: X + 12,
                        y: xOverlapNodes[i].Y + g,
                        Y: xOverlapNodes[i].Y + g,
                    });
                    // projection line on neighbour node
                    dimensioningLines.projection.push({
                        x: xOverlapNodes[i].X,
                        X: X + 12,
                        y: xOverlapNodes[i].Y,
                        Y: xOverlapNodes[i].Y,
                    });
                    // dimension line between projection lines
                    dimensioningLines.dimension.push({
                        x: X + 9,
                        X: X + 9,
                        y: xOverlapNodes[i].Y + g,
                        Y: xOverlapNodes[i].Y,
                    });
                };

                xGaps.forEach((b, g) => {
                    let alignFound = false;
                    if (xIndex > -1) {
                        if (xOverlapNodes[xIndex].Y + g > e.y - yOffset - threshold && xOverlapNodes[xIndex].Y + g < e.y - yOffset + threshold) {
                            if (!foundAlignment.y || d.py === xOverlapNodes[xIndex].Y + g + yOffset) {
                                d.py = xOverlapNodes[xIndex].Y + g + yOffset;
                                dimLinesAbove(xIndex, g);
                                alignFound = true;
                                foundAlignment.yDist = true;
                            }

                        }
                    }
                    if (xIndex < xOverlapNodes.length - 1) {
                        if (xOverlapNodes[xIndex + 1].y - g > e.y + yOffset - threshold && xOverlapNodes[xIndex + 1].y - g < e.y + yOffset + threshold) {
                            if (!foundAlignment.y || d.py === xOverlapNodes[xIndex + 1].y - g - yOffset) {
                                d.py = xOverlapNodes[xIndex + 1].y - g - yOffset;
                                dimLinesBelow(xIndex + 1, g);
                                alignFound = true;
                                foundAlignment.yDist = true;
                            }
                        }
                    }
                    if (alignFound) {
                        b.forEach(pair => dimensionLineHelper(pair));
                        alignElements.create("yDist", dimensioningLines);
                    }
                });
                // if target node is in middle
                if (xIndex >= 0 && xIndex < xOverlapNodes.length - 1 && !foundAlignment.yDist) {
                    const midpoint = (xOverlapNodes[xIndex + 1].y + xOverlapNodes[xIndex].Y) / 2;
                    const y = midpoint - yOffset;
                    const Y = midpoint + yOffset;
                    if (midpoint > e.y - threshold && midpoint < e.y + threshold && (!foundAlignment.y || d.py === midpoint)) {
                        d.py = midpoint;
                        const X = Math.max(d.bounds.X, xOverlapNodes[xIndex].X, xOverlapNodes[xIndex + 1].X);
                        // projection line on target node bottom
                        dimensioningLines.projection.push({
                            x: d.bounds.X,
                            X: X + 12,
                            y: Y,
                            Y: Y,
                        });
                        // projection line on top neighbour node
                        dimensioningLines.projection.push({
                            x: xOverlapNodes[xIndex].X,
                            X: X + 12,
                            y: xOverlapNodes[xIndex].Y,
                            Y: xOverlapNodes[xIndex].Y,
                        });
                        // dimension node above
                        dimensioningLines.dimension.push({
                            x: X + 9,
                            X: X + 9,
                            y: y,
                            Y: xOverlapNodes[xIndex].Y,
                        });
                        // projection line on target node top
                        dimensioningLines.projection.push({
                            x: d.bounds.X,
                            X: X + 12,
                            y: y,
                            Y: y,
                        });
                        // projection line on bottom neighbour  node
                        dimensioningLines.projection.push({
                            x: xOverlapNodes[xIndex + 1].X,
                            X: X + 12,
                            y: xOverlapNodes[xIndex + 1].y,
                            Y: xOverlapNodes[xIndex + 1].y,
                        });
                        // dimension node below
                        dimensioningLines.dimension.push({
                            x: X + 9,
                            X: X + 9,
                            y: Y,
                            Y: xOverlapNodes[xIndex + 1].y,
                        });
                        alignElements.create("yDist", dimensioningLines);
                    }
                }

            }
            if (yOverlapGroups.length > 0) {
                const yGaps = new Map();
                yOverlapGroups.forEach((group) => {
                    for (let i = 1; i < group.length; i++) {
                        mapHelper(yGaps, group[i].x - group[i - 1].X, [group[i - 1], group[i]]);
                    }
                });

                const dimensionLineHelper = (pair) => {
                    const y = Math.max(...pair.reduce((acc, curr) => acc.concat(curr.Y), []));
                    dimensioningLines.projection.push({
                        y: pair[0].Y,
                        Y: y + 12,
                        x: pair[0].X,
                        X: pair[0].X,
                    });
                    dimensioningLines.projection.push({
                        y: pair[1].Y,
                        Y: y + 12,
                        x: pair[1].x,
                        X: pair[1].x,
                    });
                    dimensioningLines.dimension.push({
                        y: y + 9,
                        Y: y + 9,
                        x: pair[0].X,
                        X: pair[1].x,
                    });
                };

                const dimLinesRight = (i, g) => {
                    const Y = Math.max(d.bounds.Y, yOverlapNodes[i].Y);
                    // projection line on target node
                    dimensioningLines.projection.push({
                        y: d.bounds.Y,
                        Y: Y + 12,
                        x: yOverlapNodes[i].x - g,
                        X: yOverlapNodes[i].x - g,
                    });
                    // projection line on neighbour node
                    dimensioningLines.projection.push({
                        y: yOverlapNodes[i].Y,
                        Y: Y + 12,
                        x: yOverlapNodes[i].x,
                        X: yOverlapNodes[i].x,
                    });
                    // dimension line between projection lines
                    dimensioningLines.dimension.push({
                        y: Y + 9,
                        Y: Y + 9,
                        x: yOverlapNodes[i].x - g,
                        X: yOverlapNodes[i].x,
                    });
                };

                const dimLinesLeft = (i, g) => {
                    const Y = Math.max(d.bounds.Y, yOverlapNodes[i].Y);
                    // projection line on target node
                    dimensioningLines.projection.push({
                        y: d.bounds.Y,
                        Y: Y + 12,
                        x: yOverlapNodes[i].X + g,
                        X: yOverlapNodes[i].X + g,
                    });
                    // projection line on neighbour node
                    dimensioningLines.projection.push({
                        y: yOverlapNodes[i].Y,
                        Y: Y + 12,
                        x: yOverlapNodes[i].X,
                        X: yOverlapNodes[i].X,
                    });
                    // dimension line between projection lines
                    dimensioningLines.dimension.push({
                        y: Y + 9,
                        Y: Y + 9,
                        x: yOverlapNodes[i].X + g,
                        X: yOverlapNodes[i].X,
                    });
                };

                yGaps.forEach((b, g) => {
                    let alignFound = false;
                    if (yIndex > -1) {
                        if (yOverlapNodes[yIndex].X + g > e.x - xOffset - threshold && yOverlapNodes[yIndex].X + g < e.x - xOffset + threshold) {
                            if (!foundAlignment.x || d.px === yOverlapNodes[yIndex].X + g + xOffset) {
                                d.px = yOverlapNodes[yIndex].X + g + xOffset;
                                dimLinesLeft(yIndex, g);
                                alignFound = true;
                                foundAlignment.xDist = true;
                            }

                        }
                    }
                    if (yIndex < yOverlapNodes.length - 1) {
                        if (yOverlapNodes[yIndex + 1].x - g > e.x + xOffset - threshold && yOverlapNodes[yIndex + 1].x - g < e.x + xOffset + threshold) {
                            if (!foundAlignment.x || d.px === yOverlapNodes[yIndex + 1].x - g - xOffset) {
                                d.px = yOverlapNodes[yIndex + 1].x - g - xOffset;
                                dimLinesRight(yIndex + 1, g);
                                alignFound = true;
                                foundAlignment.xDist = true;
                            }
                        }
                    }
                    if (alignFound) {
                        b.forEach(pair => dimensionLineHelper(pair));
                        alignElements.create("xDist", dimensioningLines);
                    }
                });
                // if target node is in middle
                if (yIndex >= 0 && yIndex < yOverlapNodes.length - 1 && !foundAlignment.xDist) {
                    const midpoint = (yOverlapNodes[yIndex + 1].x + yOverlapNodes[yIndex].X) / 2;
                    const x = midpoint - xOffset;
                    const X = midpoint + xOffset;
                    if (midpoint > e.x - threshold && midpoint < e.x + threshold && (!foundAlignment.x || d.px === midpoint)) {
                        d.px = midpoint;
                        const Y = Math.max(d.bounds.Y, yOverlapNodes[yIndex].Y, yOverlapNodes[yIndex + 1].Y);
                        // projection line on target node bottom
                        dimensioningLines.projection.push({
                            y: d.bounds.Y,
                            Y: Y + 12,
                            x: X,
                            X: X,
                        });
                        // projection line on top neighbour node
                        dimensioningLines.projection.push({
                            y: yOverlapNodes[yIndex].Y,
                            Y: Y + 12,
                            x: yOverlapNodes[yIndex].X,
                            X: yOverlapNodes[yIndex].X,
                        });
                        // dimension node above
                        dimensioningLines.dimension.push({
                            y: Y + 9,
                            Y: Y + 9,
                            x: x,
                            X: yOverlapNodes[yIndex].X,
                        });
                        // projection line on target node top
                        dimensioningLines.projection.push({
                            y: d.bounds.Y,
                            Y: Y + 12,
                            x: x,
                            X: x,
                        });
                        // projection line on bottom neighbour  node
                        dimensioningLines.projection.push({
                            y: yOverlapNodes[yIndex + 1].Y,
                            Y: Y + 12,
                            x: yOverlapNodes[yIndex + 1].x,
                            X: yOverlapNodes[yIndex + 1].x,
                        });
                        // dimension node below
                        dimensioningLines.dimension.push({
                            y: Y + 9,
                            Y: Y + 9,
                            x: X,
                            X: yOverlapNodes[yIndex + 1].x,
                        });
                        alignElements.create("xDist", dimensioningLines);
                    }
                }
            }
        }
    }


    /**
     * creates temporary pop up for group text
     * Can be removed by passing show as false, or by restarting
     * @param show - true show text, false hide
     * @param groupId - id of group
     * @param text - dummy text defaults as "New"
     */
    function groupTextPreview(show: boolean, groupId: Id | Id[], text?: string) {
        const groupArr = Array.isArray(groupId) ? groupId : [groupId];
        let groupSel = group.select("text");
        if (groupId) {
            groupSel = groupSel.filter(d => groupArr.includes(d.id));
        }
        groupSel.html((d) => {
            if ((!d.data.text || d.data.text == "") && show) {
                return text || "New";
            } else {
                return d.data.text;
            }
        });
        return restart(undefined, true);
    }

    /**
     * Update classes of all elements without updating other properties.
     */
    function updateHighlighting() {
        group.select(".group")
            .attr("class", d => `group ${d.data.class}`);
        node.select("path")
            .attr("class", d => d.class);
        link.select(".line-front")
            .attr("marker-start", d => {
                const color = typeof layoutOptions.edgeColor == "string" ? layoutOptions.edgeColor : layoutOptions.edgeColor(d.predicate);
                if (typeof layoutOptions.edgeArrowhead === "function") {
                    if (layoutOptions.edgeArrowhead(d.predicate) == -1 || layoutOptions.edgeArrowhead(d.predicate) == 2) {
                        if (d.predicate.class.includes("highlight")) {
                            return addArrowDefs(defs, "409EFF", true);
                        }
                        return addArrowDefs(defs, color, true);
                    }
                    return "none";
                }
                return addArrowDefs(defs, color, true);
            })
            .attr("marker-end", d => {
                const color = typeof layoutOptions.edgeColor == "string" ? layoutOptions.edgeColor : layoutOptions.edgeColor(d.predicate);
                if (typeof layoutOptions.edgeArrowhead != "number") {
                    if (layoutOptions.edgeArrowhead(d.predicate) == 1 || layoutOptions.edgeArrowhead(d.predicate) == 2) {
                        if (d.predicate.class.includes("highlight")) {
                            return addArrowDefs(defs, "409EFF", false);
                        }
                        return addArrowDefs(defs, color, false);
                    }
                    return "none";
                }
                return addArrowDefs(defs, color, false);
            })
            .attr("class", d => "line-front " + d.predicate.class.replace("highlight", "highlight-edge"));
    }

    /**
     * These exist to prevent errors when the user
     * tabs away from the graph.
     */
    window.onfocus = function () {
        restart();
    };
    window.onblur = function () {
        simulation.stop();
    };

    function addColourDef(colours: string[], id: string) {
        const el = defs.append("linearGradient")
            .attr("id", id)
            .attr("gradientTransform", "rotate(5)");
        colours.forEach((c, index) => {
            el.append("stop")
                .attr("offset", String(index / colours.length))
                .attr("stop-color", c);

            el.append("stop")
                .attr("offset", String((index + 1) / colours.length))
                .attr("stop-color", c);
        });
    }

    function updateColourDef(colours: { color: string[], id: string }[]): void {
        defs.selectAll("linearGradient").remove();
        colours.forEach(({ color, id }) => addColourDef(color, id));
    }

    /**
     * Get node object
     * @param [id] - node id, leave blank for all nodes
     */
    function getNode(id?: Id) {
        return typeof id !== "undefined" ? nodeMap.get(id) : [...nodeMap.values()];
    }

    /**
     * Get group object
     * @param [id] - group id, leave blank for all groups
     */
    function getGroup(id?: Id) {
        return typeof id !== "undefined" ? groupMap.get(id) : [...groupMap.values()];
    }

    /**
     * Get edge  object
     * @param [id] - edge id, leave blank for all edges
     */
    function getPredicate(id?: Id) {
        return typeof id !== "undefined" ? predicateMap.get(id) : [...predicateMap.values()];
    }


    // Public api
    /**
     * TODO:
     * Allow reference to the graph in the options object.
     * Solutions?:
     * - Maybe have a "this" reference passed into the callbacks.
     */
    return {
        // Check if node is drawn.
        hasNode: (id: Id) => nodes.filter(v => v.hash == id).length === 1,
        // Public access to the levelgraph db.
        getDB: () => tripletsDB,
        // Get node from nodeMap
        getNode,
        // Get Group from groupMap
        getGroup,
        // Get nodes and edges by coordinates
        getByCoords,
        // Get edge from predicateMap
        getPredicate,
        // Get Layout options
        getLayoutOptions: () => layoutOptions,
        // Get SVG element. If you want the node use `graph.getSVGElement().node();`
        getSVGElement: () => svg,
        // Get Stringified representation of the graph.
        saveGraph,
        // add a directed edge
        addTriplet,
        // remove an edge
        removeTriplet,
        // update edge data in database
        updateTriplet,
        // remove a node and all edges connected to it.
        removeNode,
        // add a node or array of nodes.
        addNode,
        // edit node property
        editNode,
        // edit edge property
        editEdge,
        // Add nodes or groups to group
        addToGroup,
        // Remove nodes or groups from group
        unGroup,
        // Create new constraint or add nodes to an existing alignment constraint
        constrain,
        // remove nodes from an existing alignment constraint, remove all nodes to remove constraint
        unconstrain,
        // toggle constraint visibility
        constraintVisibility,
        // Show or hide group text popup
        groupTextPreview,
        // add gradient def
        addColourDef,
        // update color def
        updateColourDef,
        // Restart styles or layout.
        restart: {
            styles: updateStyles,
            textAlign: repositionText,
            redrawEdges: createNewLinks,
            layout: restart,
            handleDisconnects: handleDisconnects,
            repositionGroupText: repositionGroupText,
            highlight: updateHighlighting,
        },
        canvasOptions: {
            setWidth: (width) => {
                svg.attr("viewBox", `0 0 ${width} ${layoutOptions.height}`);
                layoutOptions.width = width;
            },
            setHeight: (height) => {
                svg.attr("viewBox", `0 0 ${layoutOptions.width} ${height}`);
                layoutOptions.height = height;
            },
        },
        // Set event handlers for node.
        nodeOptions: {
            setDblClickNode,
            setClickNode,
            setMouseOver,
            setMouseOut,
            setMouseDown,
        },
        // Handler for clicking on the edge.
        edgeOptions: {
            setClickEdge: (callback) => {
                layoutOptions.clickEdge = callback;
            },
            setDblClickEdge: (callback) => {
                layoutOptions.dblclickEdge = callback;
            }
        },
        groupOptions: {
            setDblClickGroup: (callback) => {
                layoutOptions.dblclickGroup = callback;
            }
        },
        // Change layouts on the fly.
        // May be a webcola memory leak if you change the layout too many times.
        colaOptions: {
            flowLayout: {
                down: (callback) => {
                    layoutOptions.flowDirection = "y";
                    if (layoutOptions.layoutType == "flowLayout") {
                        simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                    } else {
                        layoutOptions.layoutType = "flowLayout";
                        simulation.stop();
                        simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                    }
                    restart(callback);
                },
                right: (callback) => {
                    layoutOptions.flowDirection = "x";
                    if (layoutOptions.layoutType == "flowLayout") {
                        simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                    } else {
                        layoutOptions.layoutType = "flowLayout";
                        simulation.stop();
                        simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                    }
                    restart(callback);
                }
            },
            forceLayout: (callback) => {
                if (layoutOptions.layoutType !== "jaccardLinkLengths") {
                    layoutOptions.layoutType = "jaccardLinkLengths";
                    simulation.stop();
                    // @ts-ignore
                    simulation._directedLinkConstraints = null;
                    simulation.jaccardLinkLengths(layoutOptions.edgeLength, layoutOptions.jaccardModifier);
                }
                restart(callback);
            },
            edgeLength: (edgeLen, callback) => {
                layoutOptions.edgeLength = edgeLen;
                if (layoutOptions.layoutType === "jaccardLinkLengths") {
                    simulation.stop();
                    simulation.jaccardLinkLengths(layoutOptions.edgeLength, layoutOptions.jaccardModifier);
                } else if (layoutOptions.layoutType === "flowLayout") {
                    simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                } else {
                    simulation.linkDistance(layoutOptions.edgeLength);
                }
                restart(callback);
            },
            reverseTriplets,
        }
    };
}

exports.default = networkVizJS;
// # sourceMappingURL=networkViz.js.map
