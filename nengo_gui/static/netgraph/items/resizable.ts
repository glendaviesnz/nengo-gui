import * as interact from "interact.js";
import { dom, h, VNode } from "maquette";

import { config } from "../../config";
import { Menu } from "../../menu";
import { domCreateSvg, Shape } from "../../utils";
import { InteractableItem, InteractableItemArg } from "./interactable";
import { NetGraphItemArg } from "./item";

abstract class ResizableItem extends InteractableItem {
    area: SVGElement;
    dimensions: number;

    constructor(ngiArg: NetGraphItemArg, interArg: InteractableItemArg,
                dimensions) {
        super(ngiArg, interArg, dimensions);

        const area = h("rect", {fill: "transparent"});
        this.area = domCreateSvg(area);
        this.view.g.appendChild(this.area);

        interact(this.area).resizable({
                edges: {bottom: true, left: true, right: true, top: true},
                invert: "none",
                margin: 10,
            }).on("resizestart", (event) => {
                Menu.hideAll();
            }).on("resizemove", (event) => {
                const scale = this.scales;

                this.contSize(event, scale.hor, scale.vert);
                this.redraw();

                if (this.view.depth === 1) {
                    this.ng.scaleMiniMap();
                }
            }).on("resizeend", (event) => {
                this.constrainPosition();
                this.redraw();
                this.ng.notify("posSize", {
                    height: this.height,
                    uid: this.uid,
                    width: this.width,
                    x: this.x,
                    y: this.y,
                });
            });
    }

    contSize(event, hScale: number, vScale: number) {
        const dw = event.deltaRect.width / hScale / 2;
        const dh = event.deltaRect.height / vScale / 2;
        const offsetX = dw + event.deltaRect.left / hScale;
        const offsetY = dh + event.deltaRect.top / vScale;

        this.width += dw;
        this.height += dh;
        this.x += offsetX;
        this.y += offsetY;
    }

    redrawSize(): Shape {
        const screenD = super.redrawSize();

        const areaW = screenD.width;
        const areaH = screenD.height;
        this.area.setAttribute(
            "transform",
            `translate(-${areaW / 2}, -${areaH / 2})`,
        );
        this.area.setAttribute("width", String(areaW));
        this.area.setAttribute("height", String(areaH));

        this.view.shape.setAttribute("width", String(screenD.width));
        this.view.shape.setAttribute("height", String(screenD.height));

        return screenD;
    }
}

export class NodeItem extends ResizableItem {
    htmlNode;
    radiusScale: number;

    constructor(ngiArg: NetGraphItemArg, interArg: InteractableItemArg,
                dimensions, html) {
        super(ngiArg, interArg, dimensions);
        this.alias = "node";
        this.radiusScale = .1;
        this.htmlNode = html;
        this._renderShape();
    }

    _renderShape() {
        const screenD = this.view.displayedShape;
        const halfW = screenD.width / 2;
        const halfH = screenD.height / 2;
        const shape = h("rect.node", {
            transform: `translate(-${halfW}, -${halfH})`,
        });
        this.view.shape = domCreateSvg(shape);
        this.view.g.appendChild(this.view.shape);
        this.redraw();
    }

    addMenuItems() {
        this.menu.addAction("Slider", () => {
                this.createGraph("Slider");
            },
        );
        if (this.dimensions > 0) {
            this.menu.addAction("Value", () => {
                this.createGraph("Value");
            });
        }
        if (this.dimensions > 1) {
            this.menu.addAction("XY-value", () => {
                this.createGraph("XYValue");
            });
        }
        if (this.htmlNode) {
            this.menu.addAction("HTML", () => {
                this.createGraph("HTMLView");
            });
        }

        this.menu.addAction("Details ...", () => {
            this.createModal();
        });
    }

    redrawSize() {
        const screenD = super.redrawSize();

        const radius = Math.min(screenD.width, screenD.height);
        this.view.shape.setAttribute("rx", String(radius * this.radiusScale));
        this.view.shape.setAttribute("ry", String(radius * this.radiusScale));

        return screenD;
    }
}

export class NetItem extends ResizableItem {
    expanded: boolean;
    spTargets;
    defaultOutput;
    gClass: string[];
    gNetworks: SVGElement;

    constructor(ngiArg: NetGraphItemArg, interArg: InteractableItemArg,
                dimensions, expanded, spTargets, defaultOutput) {
        super(ngiArg, interArg, dimensions);
        this.alias = "net";

        // TODO: This use of gItems and gNetworks is definitely wrong
        this.gNetworks = this.ng.view.gNetworks;
        this.expanded = expanded;
        // TODO: what type is this supposed to be?
        this.spTargets = spTargets;
        this.defaultOutput = defaultOutput;

        // Set of NetGraphItems and NetGraphConnections that are inside
        // this network
        this.children = [];
        this.childConnections = [];

        this.computeFill();

        // If a network is flagged to expand on creation, then expand it
        if (expanded) {
            // Report to server but do not add to the undo stack
            this.expand(true, true);
        }

        // TODO: Is this the right way to override an interact method?
        interact(this.view.g).on("doubletap", (event) => {
                // Get rid of menus when clicking off
                if (event.button === 0) {
                    if (Menu.anyVisible()) {
                        Menu.hideAll();
                    } else {
                        if (this.expanded) {
                            this.collapse(true);
                        } else {
                            this.expand();
                        }
                    }
                }
            })
        .draggable({
            onstart: () => {
                Menu.hideAll();
                this.moveToFront();
            },
        });
    }

    _renderShape() {
        const shape = h("rect.network");
        this.view.shape = dom.create(shape).domNode as SVGElement;
        this.view.g.appendChild(this.view.shape);
        this.redraw();
    }

    remove() {
        super.remove();
        if (this.expanded) {
            // Collapse the item, but don't tell the server since that would
            // update the server's config
            this.collapse(false);
        }
    }

    addMenuItems() {
        if (this.expanded) {
            this.menu.addAction("Collapse network", () => {
                this.collapse(true);
            });
            this.menu.addAction("Auto-layout", () => {
                this.requestFeedforwardLayout();
            });
        } else {
            this.menu.addAction("Expand network", () => {
                this.expand();
            });
        }

        if (this.defaultOutput && this.spTargets.length === 0) {
            this.menu.addAction("Output Value", () => {
                this.createGraph("Value");
            });
        }

        if (this.spTargets.length > 0) {
            this.menu.addAction("Semantic pointer cloud", () => {
                this.createGraph("Pointer", this.spTargets[0]);
            });
            this.menu.addAction("Semantic pointer plot", () => {
                this.createGraph("SpaSimilarity", this.spTargets[0]);
            });
        }

        this.menu.addAction("Details ...", () => {
            this.createModal();
        });
    }

    /**
     * Expand a collapsed network.
     */
    expand(returnToServer=true, auto=false) { // tslint:disable-line
        // Default to true if no parameter is specified
        if (typeof returnToServer !== "undefined") {
            returnToServer = true;
        }
        auto = typeof auto !== "undefined" ? auto : false;

        this.gClass.push("expanded");

        if (!this.expanded) {
            this.expanded = true;
            if (this.ng.transparentNets) {
                this.view.shape.setAttribute("style", "fill-opacity=0.0");
            }
            this.ng.view.gItems.removeChild(this.view.g);
            this.gNetworks.appendChild(this.view.g);
            if (!this.minimap) {
                this.miniItem.expand(returnToServer, auto);
            }
        } else {
            console.warn(
                "expanded a network that was already expanded: " + this);
        }

        if (returnToServer) {
            if (auto) {
                // Update the server, but do not place on the undo stack
                this.ng.notify("autoExpand", {uid: this.uid});
            } else {
                this.ng.notify("expand", {uid: this.uid});
            }
        }
    }

    /**
     * Collapse an expanded network.
     */
    collapse(reportToServer, auto=false) { // tslint:disable-line
        this.gClass.pop();

        // Remove child NetGraphItems and NetGraphConnections
        while (this.childConnections.length > 0) {
            this.childConnections[0].remove();
        }
        while (this.children.length > 0) {
            this.children[0].remove();
        }

        if (this.expanded) {
            this.expanded = false;
            if (this.ng.transparentNets) {
                this.view.shape.setAttribute("style", "fill-opacity=0.0");
            }
            this.gNetworks.removeChild(this.view.g);
            this.ng.view.gItems.appendChild(this.view.g);
            if (!this.minimap) {
                this.miniItem.collapse(reportToServer, auto);
            }
        } else {
            console.warn(
                "collapsed a network that was already collapsed: " + this);
        }

        if (reportToServer) {
            if (auto) {
                // Update the server, but do not place on the undo stack
                this.ng.notify("autoCollapse", {uid: this.uid});
            } else {
                this.ng.notify("collapse", {uid: this.uid});
            }
        }
    }

    get transparentNets(): boolean {
        return config.transparentNets;
    }

    // TODO: this feels like a weird level to manipulate all other
    // networks from
    set transparentNets(val: boolean) {
        if (val === config.transparentNets) {
            return;
        }
        config.transparentNets = val;
        Object.keys(this.ng.svgObjects.net).forEach((key) => {
            const ngi = this.ng.svgObjects.net[key];
            ngi.computeFill();
            if (ngi.expanded) {
                ngi.view.shape.setAttribute(
                    "style", `fill-opacity=${val}`,
                );
            }
        });
    }

    moveToFront() {
        this.view.parent.ng.view.gItems.appendChild(this.view.g);

        Object.keys(this.children).forEach((key) => {
            this.children[key].moveToFront();
        });
    }

    redraw() {
        super.redraw();
        this.redrawChildren();
        this.redrawChildConnections();
        this.redrawConnections();
    }

    redrawChildren() {
        // Update any children's positions
        for (const child of this.children) {
            child.redraw();
        }
    }

    redrawChildConnections() {
        // Update any children's positions
        for (const child of this.childConnections) {
            child.redraw();
        }
    }

    /**
     * Determine the fill color based on the depth.
     */
    computeFill() {
        const depth = this.ng.transparentNets ? 1 : this.view.depth;

        let rgb = Math.round(255 * Math.pow(0.8, depth));
        const fill = `rgb(${rgb}, ${rgb}, ${rgb})`;

        rgb = Math.round(255 * Math.pow(0.8, depth + 2));
        const stroke = `rgb(${rgb}, ${rgb}, ${rgb})`;

        this.view.shape.setAttribute(
            "style", `fill=${fill}, stroke=${stroke}`,
        );
    }
}

export class EnsembleItem extends ResizableItem {
    aspect: number;
    radiusScale: number;

    constructor(ngiArg: NetGraphItemArg, interArg: InteractableItemArg,
                dimensions) {
        super(ngiArg, interArg, dimensions);
        this.alias = "ens";

        // the ensemble is the only thing with aspect
        this.aspect = 1.;
        this.radiusScale = 17.8;
        interact(this.area).resizable({
            invert: "reposition",
        });
    }

    /**
     * Function for drawing ensemble svg.
     */
    _renderShape() {
        const shape = h("g.ensemble");

        const dx = -1.25;
        const dy = 0.25;

        let circle: VNode;

        circle = h("circle", {cx: -11.157 + dx, cy: -7.481 + dy, r: "4.843"});
        shape.children.push(circle);
        circle = h("circle", {cx: 0.186 + dx, cy: -0.127 + dy, r: "4.843"});
        shape.children.push(circle);
        circle = h("circle", {cx: 5.012 + dx, cy: 12.56 + dy, r: "4.843"});
        shape.children.push(circle);
        circle = h("circle", {cx: 13.704 + dx, cy: -0.771 + dy, r: "4.843"});
        shape.children.push(circle);
        circle = h("circle", {cx: -10.353 + dx, cy: 8.413 + dy, r: "4.843"});
        shape.children.push(circle);
        circle = h("circle", {cx: 3.894 + dx, cy: -13.158 + dy, r: "4.843"});
        shape.children.push(circle);

        this.view.shape = dom.create(shape).domNode as SVGElement;
        this.view.g.appendChild(this.view.shape);
        this.redraw();
    }

    addMenuItems() {
        this.menu.addAction("Value", () => {
            this.createGraph("Value");
        });
        if (this.dimensions > 1) {
            this.menu.addAction("XY-value", () => {
                this.createGraph("XYValue");
            });
        }
        this.menu.addAction("Spikes", () => {
            this.createGraph("Raster");
        });
        this.menu.addAction("Voltages", () => {
            this.createGraph("Voltage");
        });
        this.menu.addAction("Firing pattern", () => {
            this.createGraph("SpikeGrid");
        });

        this.menu.addAction("Details ...", () => {
            this.createModal();
        });
    }

    contSize(event, hScale, vScale) {
        const pos = this.view.screenLocation;
        const verticalResize =
            event.edges.bottom || event.edges.top;
        const horizontalResize =
            event.edges.left || event.edges.right;

        let w = pos[0] - event.clientX + this.ng.offsetX;
        let h = pos[1] - event.clientY + this.ng.offsetY;

        if (event.edges.right) {
            w *= -1;
        }
        if (event.edges.bottom) {
            h *= -1;
        }
        if (w < 0) {
            w = 1;
        }
        if (h < 0) {
            h = 1;
        }

        const screenW = this.width * hScale;
        const screenH = this.height * vScale;

        if (horizontalResize && verticalResize) {
            const p = (screenW * w + screenH * h) / Math.sqrt(
                screenW * screenW + screenH * screenH);
            const norm = Math.sqrt(
                this.aspect * this.aspect + 1);
            h = p / (this.aspect / norm);
            w = p * (this.aspect / norm);
        } else if (horizontalResize) {
            h = w / this.aspect;
        } else {
            w = h * this.aspect;
        }

        this.width = w / hScale;
        this.height = h / vScale;
    }

    getDisplayedSize() {
        const hScale = this.ng.scaledWidth;
        const vScale = this.ng.scaledHeight;
        // TODO: get nested implemented
        // let w = this.nestedWidth * hScale;
        // let h = this.nestedHeight * vScale;
        let w = this.view.width * hScale;
        let h = this.view.height * vScale;

        if (h * this.aspect < w) {
            w = h * this.aspect;
        } else if (w / this.aspect < h) {
            h = w / this.aspect;
        }

        return [w / hScale, h / vScale];
    }

    redrawSize() {
        const screenD = super.redrawSize();

        if (screenD.height * this.aspect < screenD.width) {
            screenD.width = screenD.height * this.aspect;
        } else if (screenD.width / this.aspect < screenD.height) {
            screenD.height = screenD.width / this.aspect;
        }

        const width = screenD.width;
        const height = screenD.height;
        const scale = Math.sqrt(height * height + width * width) / Math.sqrt(2);

        this.view.shape.setAttribute(
            "transform",
            `scale(${scale / 2 / this.radiusScale})`,
        );
        this.view.shape.setAttribute(
            "style",  `stroke-width ${20 / scale}`,
        );

        this.area.setAttribute(
            "width", String(width * 0.97),
        );

        return screenD;
    }
}
