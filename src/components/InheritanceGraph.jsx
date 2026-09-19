import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import {
  Search,
  Box,
  ArrowUpRight,
  Pin,
  X,
  Minus,
  Plus,
  Maximize2,
} from "lucide-react";
import { basename } from "../util";

const NODE_W = 200;
const NODE_H = 95;
const GAP_X = 50;
const GAP_Y = 60;
const MAX_PER_LINE = 6;
const ASPECT_RATIO = 1.6;
const PAD_X = 80;
const TOP = 60;
const CURVE = 40;

export default function InheritanceGraph({ classes, onNavigate }) {
  const [query, setQuery] = useState(""),
    [view, setView] = useState({ x: 0, y: 0, k: 1 }),
    [pin, setPin] = useState(null),
    [edgeJump, setEdgeJump] = useState({});
  const canvasRef = useRef(null);
  const drag = useRef(null);
  const savedViewRef = useRef(null);
  const graph = useMemo(() => {
    const nodes = new Map(
      classes.map((c) => [c.id, { ...c, external: false }]),
    );
    const edges = [];
    for (const cls of classes)
      cls.bases.forEach((base, i) => {
        const id = cls.baseIds[i] || "external:" + base;
        if (!nodes.has(id))
          nodes.set(id, { id, name: base, external: true, methods: [] });
        edges.push({ from: id, to: cls.id });
      });
    let visible = new Set(nodes.keys());
    if (query || pin) {
      visible = new Set(
        [...nodes.values()]
          .filter((n) =>
            pin
              ? n.id === pin
              : n.name.toLowerCase().includes(query.toLowerCase()),
          )
          .map((n) => n.id),
      );
      // Include ancestors and descendants, but not unrelated siblings.
      for (const direction of ["up", "down"]) {
        let frontier = [...visible];
        const visited = new Set(frontier);
        while (frontier.length) {
          const next = [];
          for (const id of frontier)
            for (const e of edges) {
              const hit =
                direction === "up"
                  ? e.to === id
                    ? e.from
                    : null
                  : e.from === id
                    ? e.to
                    : null;
              if (hit && !visited.has(hit)) {
                visible.add(hit);
                visited.add(hit);
                next.push(hit);
              }
            }
          frontier = next;
        }
      }
    }
    const childrenOf = new Map();
    const parentsOf = new Map();
    for (const e of edges) {
      if (!visible.has(e.from) || !visible.has(e.to)) continue;
      if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
      childrenOf.get(e.from).push(e.to);
      if (!parentsOf.has(e.to)) parentsOf.set(e.to, []);
      parentsOf.get(e.to).push(e.from);
    }
    // The first listed base "owns" a node for layout; secondary bases only
    // draw an edge to it. This keeps each node placed exactly once.
    const ownedChildren = new Map();
    for (const [id, kids] of childrenOf) ownedChildren.set(id, [...kids]);
    for (const [id, parents] of parentsOf)
      for (const p of parents.slice(1)) {
        const list = ownedChildren.get(p);
        if (list) {
          const idx = list.indexOf(id);
          if (idx !== -1) list.splice(idx, 1);
        }
      }
    const roots = [...visible].filter((id) => !parentsOf.has(id));

    const size = new Map();
    const placing = new Set();
    function measure(id) {
      if (size.has(id)) return size.get(id);
      if (placing.has(id)) return { w: NODE_W, h: NODE_H };
      placing.add(id);
      const kids = ownedChildren.get(id) || [];
      let w = NODE_W;
      let h = NODE_H;
      if (kids.length) {
        const numCols = Math.min(MAX_PER_LINE, kids.length);
        const colW = new Array(numCols).fill(0);
        const colH = new Array(numCols).fill(0);
        for (let c = 0; c < numCols; c++)
          for (let i = c; i < kids.length; i += MAX_PER_LINE) {
            const d = measure(kids[i]);
            colW[c] = Math.max(colW[c], d.w);
            colH[c] += d.h + GAP_Y;
          }
        w = 0;
        for (let c = 0; c < numCols; c++) w += colW[c] + GAP_X;
        w = Math.max(NODE_W, w - GAP_X);
        h = NODE_H + Math.max(...colH);
      }
      placing.delete(id);
      size.set(id, { w, h });
      return size.get(id);
    }
    function place(id, x, y) {
      const dim = size.get(id) || { w: NODE_W, h: NODE_H };
      const node = nodes.get(id);
      node.x = x + (dim.w - NODE_W) / 2;
      node.y = y;
      const kids = ownedChildren.get(id) || [];
      if (!kids.length) return;
      const numCols = Math.min(MAX_PER_LINE, kids.length);
      const colW = new Array(numCols).fill(0);
      for (let c = 0; c < numCols; c++)
        for (let i = c; i < kids.length; i += MAX_PER_LINE)
          colW[c] = Math.max(colW[c], size.get(kids[i]).w);
      const totalW =
        colW.reduce((a, b) => a + b, 0) + (numCols - 1) * GAP_X;
      let colX = x + (dim.w - totalW) / 2;
      const top = y + NODE_H + GAP_Y;
      for (let c = 0; c < numCols; c++) {
        const cw = colW[c];
        let cy = top;
        for (let i = c; i < kids.length; i += MAX_PER_LINE) {
          const kid = kids[i];
          const kw = size.get(kid).w;
          place(kid, colX + (cw - kw) / 2, cy);
          cy += size.get(kid).h + GAP_Y;
        }
        colX += cw + GAP_X;
      }
    }
    const topLevel = [...roots];
    for (const id of topLevel) measure(id);
    for (const id of visible)
      if (!size.has(id)) {
        measure(id);
        topLevel.push(id);
      }
    const area = topLevel.reduce((a, id) => {
      const d = size.get(id);
      return a + (d.w + GAP_X) * (d.h + GAP_Y);
    }, 0);
    const targetWidth = Math.max(NODE_W, Math.sqrt(area * ASPECT_RATIO));
    let flowX = 0;
    let flowY = TOP;
    let rowH = 0;
    for (const id of topLevel) {
      const w = size.get(id).w;
      const h = size.get(id).h;
      if (flowX > 0 && flowX + w > targetWidth) {
        flowX = 0;
        flowY += rowH + GAP_Y;
        rowH = 0;
      }
      place(id, flowX, flowY);
      flowX += w + GAP_X;
      rowH = Math.max(rowH, h);
    }
    let minX = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const node of nodes.values())
      if (visible.has(node.id)) {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x + NODE_W);
        maxY = Math.max(maxY, node.y + NODE_H);
      }
    const shift = PAD_X - minX;
    for (const node of nodes.values())
      if (visible.has(node.id)) node.x += shift;
    const width = Math.max(740, maxX + shift + PAD_X);
    const height = Math.max(450, maxY + TOP);
    return {
      nodes: [...nodes.values()].filter((n) => visible.has(n.id)),
      edges: edges.filter((e) => visible.has(e.from) && visible.has(e.to)),
      map: nodes,
      width,
      height,
    };
  }, [classes, query, pin]);

  function onPointerDown(e) {
    if (e.target.closest("button, a, input, label")) return;
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      x: view.x,
      y: view.y,
      id: e.pointerId,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setView((v) => ({
      ...v,
      x: d.x + (e.clientX - d.startX),
      y: d.y + (e.clientY - d.startY),
    }));
  }
  function onPointerUp(e) {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {}
  }

  const clampZoom = (k) => Math.min(Math.max(k, 0.05), 2.5);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const rect = el.getBoundingClientRect();
      setView((v) => {
        const k = clampZoom(v.k * factor);
        const ox = e.clientX - rect.left;
        const oy = e.clientY - rect.top;
        const wx = (ox - v.x) / v.k;
        const wy = (oy - v.y) / v.k;
        return { k, x: ox - wx * k, y: oy - wy * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!pin) return;
    fitView();
  }, [pin]);

  function setZoom(next) {
    const k = clampZoom(next);
    const rect = canvasRef.current?.getBoundingClientRect();
    const ox = rect ? rect.width / 2 : 0;
    const oy = rect ? rect.height / 2 : 0;
    setView((v) => {
      const wx = (ox - v.x) / v.k;
      const wy = (oy - v.y) / v.k;
      return { k, x: ox - wx * k, y: oy - wy * k };
    });
  }

  function fitView() {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pad = 24;
    const k = clampZoom(
      Math.min(
        (rect.width - pad * 2) / graph.width,
        (rect.height - pad * 2) / graph.height,
      ),
    );
    setView({
      k,
      x: (rect.width - graph.width * k) / 2,
      y: (rect.height - graph.height * k) / 2,
    });
  }

  function jumpEdge(edge) {
    const key = `${edge.from}|${edge.to}`;
    const next = edgeJump[key] === "from" ? "to" : "from";
    setEdgeJump((prev) => ({ ...prev, [key]: next }));
    const node = graph.map.get(edge[next]);
    if (!node) return;
    if (node.external) pinNode(node.id);
    else onNavigate(node);
  }

  function pinNode(id) {
    if (pin === null) savedViewRef.current = view;
    setPin(id);
  }

  function unpin() {
    if (savedViewRef.current) {
      setView(savedViewRef.current);
      savedViewRef.current = null;
    }
    setPin(null);
  }

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <div>
          <h2>Class inheritance</h2>
          <span>
            {classes.length} classes · {graph.edges.length} visible
            relationships
          </span>
        </div>
        <label className="filter">
          <Search size={13} />
          <input
            aria-label="Find class"
            placeholder="Find a class…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              unpin();
            }}
          />
        </label>
      </div>
      <div
        className="graph-canvas"
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="graph-inner"
          style={{
            width: graph.width,
            height: graph.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          }}
        >
          <svg width={graph.width} height={graph.height}>
            <defs>
              <marker
                id="arrow"
                markerWidth="8"
                markerHeight="8"
                refX="8"
                refY="4"
                orient="auto"
              >
                <path d="M 0 0 L 8 4 L 0 8" fill="none" stroke="#8e9bab" />
              </marker>
            </defs>
            {graph.edges.map((edge, i) => {
              const from = graph.map.get(edge.from),
                to = graph.map.get(edge.to);
              const curve = Math.min(
                CURVE,
                Math.max(10, (to.y - from.y - NODE_H) / 2),
              );
              const d = `M ${to.x + NODE_W / 2} ${to.y} C ${to.x + NODE_W / 2} ${to.y - curve}, ${from.x + NODE_W / 2} ${from.y + NODE_H + curve}, ${from.x + NODE_W / 2} ${from.y + NODE_H}`;
              const jumpKey = `${edge.from}|${edge.to}`;
              const next = edgeJump[jumpKey] === "from" ? "to" : "from";
              const target = graph.map.get(edge[next]);
              return (
                <Fragment key={i}>
                  <path
                    d={d}
                    fill="none"
                    stroke="#52616c"
                    strokeWidth="1.3"
                    markerEnd="url(#arrow)"
                  />
                  <path
                    className="graph-edge-hit"
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="16"
                    onDoubleClick={() => jumpEdge(edge)}
                  >
                    <title>Go to {target?.name}</title>
                  </path>
                </Fragment>
              );
            })}
          </svg>
          {graph.nodes.map((node) => (
              <div
                key={node.id}
                className={`graph-node ${node.external ? "external" : ""} ${pin === node.id ? "pinned" : ""}`}
                style={{ left: node.x, top: node.y }}
              >
                <button
                  className="graph-node-title"
                  onClick={() => !node.external && onNavigate(node)}
                  disabled={node.external}
                >
                  <Box size={14} />
                  <b>{node.name}</b>
                  {!node.external && <ArrowUpRight size={12} />}
                </button>
                <div className="graph-node-meta">
                  {node.external
                    ? "external / unresolved"
                    : `${basename(node.path)}:${node.line}`}
                </div>
                <div className="graph-node-footer">
                  <span>{node.methods.length} methods</span>
                  <button
                    className="graph-node-pin"
                    title={`Pin ${node.name} — hide unrelated classes`}
                    onClick={() =>
                      pin === node.id ? unpin() : pinNode(node.id)
                    }
                  >
                    <Pin size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        {!graph.nodes.length && (
          <div className="empty">No matching classes.</div>
        )}
      </div>
      <div className="graph-bottom">
        <span>
          <span className="legend-line" />
          Child → parent
          <span className="external-key" />
          External / unresolved
        </span>
        <div>
          {pin && (
            <button onClick={unpin}>
              Clear pin
              <X size={12} />
            </button>
          )}
          <button
            title="Zoom out"
            onClick={() => setZoom(view.k / 1.12)}
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(view.k * 100)}%</span>
          <button
            title="Zoom in"
            onClick={() => setZoom(view.k * 1.12)}
          >
            <Plus size={14} />
          </button>
          <button title="Fit in view" onClick={fitView}>
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
