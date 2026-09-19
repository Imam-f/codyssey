import { useState, useMemo } from "react";
import {
  Search,
  Box,
  ArrowUpRight,
  Crosshair,
  X,
  Minus,
  Plus,
  Maximize2,
} from "lucide-react";
import { basename } from "../util";

export default function InheritanceGraph({ classes, onNavigate }) {
  const [query, setQuery] = useState(""),
    [zoom, setZoom] = useState(1),
    [focus, setFocus] = useState(null);
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
    if (query || focus) {
      visible = new Set(
        [...nodes.values()]
          .filter((n) =>
            focus
              ? n.id === focus
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
    const rank = (id, seen = new Set()) => {
      if (seen.has(id)) return 0;
      const next = new Set(seen).add(id);
      return Math.max(
        0,
        ...edges
          .filter((e) => e.to === id && visible.has(e.from))
          .map((e) => rank(e.from, next) + 1),
      );
    };
    const rows = new Map();
    for (const node of nodes.values())
      if (visible.has(node.id)) {
        const level = rank(node.id);
        if (!rows.has(level)) rows.set(level, []);
        rows.get(level).push(node);
      }
    const width = Math.max(
      740,
      ...[...rows.values()].map((r) => r.length * 230 + 60),
    );
    for (const [level, row] of [...rows].sort((a, b) => a[0] - b[0])) {
      const parentX = (node) => {
        const parents = edges
          .filter((e) => e.to === node.id)
          .map((e) => nodes.get(e.from)?.x ?? 0);
        return parents.reduce((a, b) => a + b, 0) / (parents.length || 1);
      };
      row.sort((a, b) => parentX(a) - parentX(b));
      row.forEach((node, i) => {
        node.x = (width - row.length * 230) / 2 + i * 230 + 15;
        node.y = 50 + level * 170;
      });
    }
    return {
      nodes: [...nodes.values()].filter((n) => visible.has(n.id)),
      edges: edges.filter((e) => visible.has(e.from) && visible.has(e.to)),
      map: nodes,
      width,
      height: Math.max(450, rows.size * 170 + 80),
    };
  }, [classes, query, focus]);
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
              setFocus(null);
            }}
          />
        </label>
      </div>
      <div className="graph-canvas">
        <div
          style={{
            width: graph.width * zoom,
            height: graph.height * zoom,
            minWidth: "100%",
          }}
        >
          <div
            className="graph-inner"
            style={{
              width: graph.width,
              height: graph.height,
              transform: `scale(${zoom})`,
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
                return (
                  <path
                    key={i}
                    d={`M ${to.x + 100} ${to.y} C ${to.x + 100} ${to.y - 40}, ${from.x + 100} ${from.y + 135}, ${from.x + 100} ${from.y + 95}`}
                    fill="none"
                    stroke="#52616c"
                    strokeWidth="1.3"
                    markerEnd="url(#arrow)"
                  />
                );
              })}
            </svg>
            {graph.nodes.map((node) => (
              <div
                key={node.id}
                className={`graph-node ${node.external ? "external" : ""} ${focus === node.id ? "focused" : ""}`}
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
                    title={`Focus ${node.name} hierarchy`}
                    onClick={() => setFocus(focus === node.id ? null : node.id)}
                  >
                    <Crosshair size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
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
          {focus && (
            <button onClick={() => setFocus(null)}>
              Clear focus
              <X size={12} />
            </button>
          )}
          <button
            title="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            title="Zoom in"
            onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}
          >
            <Plus size={14} />
          </button>
          <button
            title="Reset zoom"
            onClick={() => {
              setZoom(1);
              setQuery("");
              setFocus(null);
            }}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
