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
const LINE_GAP = 60;
const GEN_GAP = 80;
const FAN_GAP = 30;
const MAX_PER_LINE = 4;
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
    const depthOf = (id, seen = new Set()) => {
      if (seen.has(id)) return 0;
      const next = new Set(seen).add(id);
      return Math.max(
        0,
        ...edges
          .filter((e) => e.to === id && visible.has(e.from))
          .map((e) => depthOf(e.from, next) + 1),
      );
    };
    const parentX = (node) => {
      const parents = edges
        .filter((e) => e.to === node.id)
        .map((e) => nodes.get(e.from)?.x ?? 0);
      return parents.reduce((a, b) => a + b, 0) / (parents.length || 1);
    };
    const levels = new Map();
    let maxDepth = 0;
    for (const node of nodes.values())
      if (visible.has(node.id)) {
        const d = depthOf(node.id);
        if (d > maxDepth) maxDepth = d;
        if (!levels.has(d)) levels.set(d, []);
        levels.get(d).push(node);
      }
    const linesByLevel = [];
    for (let d = 0; d <= maxDepth; d++) {
      const level = levels.get(d) || [];
      level.sort((a, b) => parentX(a) - parentX(b));
      const lines = [];
      for (let i = 0; i < level.length; i += MAX_PER_LINE)
        lines.push(level.slice(i, i + MAX_PER_LINE));
      linesByLevel.push(lines);
      let flowX = 0;
      for (const line of lines) {
        const w = line.length * NODE_W + (line.length - 1) * GAP_X;
        const center =
          d === 0
            ? flowX + w / 2
            : line.reduce((s, n) => s + parentX(n), 0) / line.length;
        if (d === 0) flowX += w + GAP_X;
        const start = center - w / 2;
        line.forEach((n, i) => {
          n.x = start + i * (NODE_W + GAP_X);
        });
      }
    }
    let minX = Infinity,
      maxX = -Infinity;
    for (const node of nodes.values())
      if (visible.has(node.id)) {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x + NODE_W);
      }
    const shift = PAD_X - minX;
    for (const node of nodes.values())
      if (visible.has(node.id)) node.x += shift;
    const width = Math.max(740, maxX + shift + PAD_X);
    let yCursor = TOP;
    let height = 450;
    for (let d = 0; d <= maxDepth; d++) {
      const lines = linesByLevel[d];
      for (const line of lines) {
        for (const n of line) {
          n.y = yCursor;
          height = Math.max(height, n.y + NODE_H + TOP);
        }
        yCursor += NODE_H + LINE_GAP;
      }
      const nextLines = linesByLevel[d + 1] || [];
      yCursor += GEN_GAP + Math.max(0, nextLines.length - 1) * FAN_GAP;
    }
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
    const el = canvasRef.current;
    const node = graph.nodes.find((n) => n.id === pin);
    if (!el || !node) return;
    const rect = el.getBoundingClientRect();
    const k = view.k;
    setView({
      k,
      x: rect.width / 2 - (node.x + NODE_W / 2) * k,
      y: rect.height / 2 - (node.y + NODE_H / 2) * k,
    });
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
