import React, {
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import {
  Search,
  Braces,
  ArrowUpRight,
  ArrowRight,
  Crosshair,
  RotateCcw,
  CircleAlert,
  Minus,
  Plus,
  Maximize2,
} from "lucide-react";

const MAX_PER_COLUMN = 8;

export function CallRelations({ graph, focusId, onNavigate, onFocus }) {
  const node = graph?.nodes.find((n) => n.id === focusId);
  if (!node || node.external) return null;
  return (
    <div className="detail-section call-relations">
      <div className="section-label">
        FUNCTION CALLS
        <button
          title="View function call graph"
          onClick={() => onFocus(node.id)}
        >
          <Crosshair size={13} />
        </button>
      </div>
      <div className="call-context">{node.label}</div>
      {["outgoing", "incoming"].map((direction) => {
        const sites = graph.sites.filter((s) =>
          direction === "outgoing"
            ? s.callerId === node.id
            : s.targetId === node.id,
        );
        return (
          <div className="call-relation-group" key={direction}>
            <h4>
              {direction === "outgoing" ? "Calls" : "Called by"}{" "}
              <span className="count">{sites.length}</span>
            </h4>
            {sites.map((site) => {
              const other = graph.nodes.find(
                (n) =>
                  n.id ===
                  (direction === "outgoing" ? site.targetId : site.callerId),
              );
              return (
                <div className="call-relation" key={site.id}>
                  <button
                    disabled={other.external}
                    title={
                      other.external
                        ? "External or dynamic target; no indexed definition"
                        : `Inspect ${other.label}`
                    }
                    onClick={() => onFocus(other.id)}
                  >
                    <span>{other.label}</span>
                    {other.external && <CircleAlert size={11} />}
                  </button>
                  <button
                    className="call-site-link"
                    title={`Open call site ${site.path}:${site.line}`}
                    onClick={() =>
                      onNavigate({
                        path: site.path,
                        line: site.line,
                        symbolId: site.callerId,
                      })
                    }
                  >
                    {site.path.split("/").pop()}:{site.line}
                    <ArrowUpRight size={11} />
                  </button>
                </div>
              );
            })}
            {!sites.length && (
              <p className="call-empty">
                {direction === "outgoing"
                  ? "No direct calls found."
                  : "No indexed callers found."}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CallGraph({ graph, focusId, onFocus, onNavigate }) {
  const [query, setQuery] = useState("");
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [direction, setDirection] = useState("both");
  const byId = useMemo(
    () => new Map((graph?.nodes || []).map((n) => [n.id, n])),
    [graph],
  );
  const choices = (graph?.nodes || []).filter((n) => !n.external);
  const focus =
    byId.get(focusId) ||
    choices.find((n) => n.kind === "function") ||
    choices[0];
  const incoming = (graph?.edges || []).filter(
    (e) => e.to === focus?.id && e.from !== focus?.id,
  );
  const outgoing = (graph?.edges || []).filter(
    (e) =>
      e.from === focus?.id &&
      e.to !== focus?.id &&
      (showUnresolved || e.resolved),
  );
  const recursion = graph?.edges.find(
    (e) => e.from === focus?.id && e.to === focus?.id,
  );
  const siteMap = useMemo(
    () => new Map((graph?.sites || []).map((s) => [s.id, s])),
    [graph],
  );
  const filtered = choices.filter((n) =>
    `${n.label} ${n.path}`.toLowerCase().includes(query.toLowerCase()),
  );
  const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };
  const callerColumns = chunk(incoming, MAX_PER_COLUMN);
  const calleeColumns = chunk(outgoing, MAX_PER_COLUMN);

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [flowSize, setFlowSize] = useState({ width: 0, height: 0 });
  const [nodeRects, setNodeRects] = useState({});
  const canvasRef = useRef(null);
  const flowRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef(null);

  const clampZoom = (k) => Math.min(Math.max(k, 0.05), 2.5);

  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    const measure = () => {
      const k = viewRef.current.k || 1;
      const fr = flow.getBoundingClientRect();
      const rects = {};
      let maxRight = 0;
      let maxBottom = 0;
      flow.querySelectorAll(".call-node").forEach((el) => {
        const id = el.dataset.nodeId;
        const side = el.dataset.side;
        if (!id || !side) return;
        const r = el.getBoundingClientRect();
        const rect = {
          left: (r.left - fr.left) / k,
          top: (r.top - fr.top) / k,
          right: (r.right - fr.left) / k,
          bottom: (r.bottom - fr.top) / k,
          centerY: (r.top - fr.top + r.height / 2) / k,
        };
        rects[`${side}:${id}`] = rect;
        if (rect.right > maxRight) maxRight = rect.right;
        if (rect.bottom > maxBottom) maxBottom = rect.bottom;
      });
      setNodeRects(rects);
      setFlowSize({
        width: Math.max(flow.offsetWidth, maxRight + 18),
        height: Math.max(flow.offsetHeight, maxBottom + 40),
      });
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(flow);
      return () => ro.disconnect();
    }
  }, [graph, focus?.id, direction, showUnresolved]);

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
    if (!rect || !flowSize.width || !flowSize.height) return;
    const pad = 24;
    const k = clampZoom(
      Math.min(
        (rect.width - pad * 2) / flowSize.width,
        (rect.height - pad * 2) / flowSize.height,
      ),
    );
    setView({
      k,
      x: (rect.width - flowSize.width * k) / 2,
      y: (rect.height - flowSize.height * k) / 2,
    });
  }

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

  function arrowPath(from, to) {
    const busY = flowSize.height - 20;
    const hop = 10;
    return `M ${from.right} ${from.centerY} H ${from.right + hop} V ${busY} H ${to.left - hop} V ${to.centerY} H ${to.left}`;
  }

  const arrows = [];
  if (focus) {
    const center = nodeRects[`center:${focus.id}`];
    if (center) {
      if (direction !== "outgoing")
        for (const edge of incoming) {
          const from = nodeRects[`left:${edge.from}`];
          if (from) arrows.push({ d: arrowPath(from, center), key: `i:${edge.from}` });
        }
      if (direction !== "incoming")
        for (const edge of outgoing) {
          const to = nodeRects[`right:${edge.to}`];
          if (to) arrows.push({ d: arrowPath(center, to), key: `o:${edge.to}` });
        }
    }
  }

  function nodeCard(node, edge, side) {
    return (
      <div
        className={`call-node ${node.external ? "external" : ""} ${side === "center" ? "focused" : ""}`}
        key={node.id}
        data-node-id={node.id}
        data-side={side}
      >
        <div className="call-node-header">
          <Braces size={14} />
          <button
            title={node.label}
            disabled={node.external}
            onClick={() => onFocus(node.id)}
          >
            {node.label}
          </button>
          {!node.external && (
            <button
              title={`Open definition of ${node.label}`}
              onClick={() => onNavigate(node)}
            >
              <ArrowUpRight size={13} />
            </button>
          )}
        </div>
        <div className="call-node-location">
          {node.external
            ? "external / dynamic · unresolved"
            : `${node.path}:${node.line}`}
        </div>
        {edge && (
          <div className="call-node-sites">
            {edge.sites.map((id) => {
              const site = siteMap.get(id);
              return (
                <button
                  key={id}
                  title={`Open call site ${site.path}:${site.line}`}
                  onClick={() =>
                    onNavigate({
                      path: site.path,
                      line: site.line,
                      symbolId: site.callerId,
                    })
                  }
                >
                  L{site.line}
                  <ArrowUpRight size={10} />
                </button>
              );
            })}
            <span>
              {edge.sites.length}{" "}
              {edge.sites.length === 1 ? "call site" : "call sites"}
            </span>
          </div>
        )}
        {side === "center" && (
          <div className="call-node-sites">
            <span>
              {incoming.length} callers · {outgoing.length} targets
            </span>
            {recursion && (
              <button
                title="Open recursive call"
                onClick={() => {
                  const site = siteMap.get(recursion.sites[0]);
                  onNavigate({
                    path: site.path,
                    line: site.line,
                    symbolId: site.callerId,
                  });
                }}
              >
                <RotateCcw size={11} />
                Recursive · {recursion.sites.length}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="call-graph-view">
      <div className="graph-toolbar">
        <div>
          <h2>Function call graph</h2>
          <span>
            {choices.filter((n) => n.kind === "function").length} functions ·{" "}
            {graph?.sites.length || 0} call sites ·{" "}
            {graph?.sites.filter((s) => !s.resolved).length || 0} unresolved
          </span>
        </div>
        <label className="scope-toggle">
          <input
            type="checkbox"
            checked={showUnresolved}
            onChange={(e) => setShowUnresolved(e.target.checked)}
          />
          Show unresolved
        </label>
      </div>
      <div className="call-workspace">
        <aside className="call-function-list">
          <label className="filter">
            <Search size={13} />
            <input
              aria-label="Find function"
              placeholder="Find function…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="call-function-results">
            {filtered.map((node) => (
              <button
                className={focus?.id === node.id ? "active" : ""}
                key={node.id}
                title={`${node.label} · ${node.path}:${node.line}`}
                onClick={() => onFocus(node.id)}
              >
                <Braces size={12} />
                <span>
                  {node.label}
                  <small>
                    {node.path}:{node.line}
                  </small>
                </span>
              </button>
            ))}
            {!filtered.length && (
              <p className="empty">No matching functions.</p>
            )}
          </div>
        </aside>
        <div className="call-graph-detail">
          <div
            className="call-direction"
            role="group"
            aria-label="Call graph direction"
          >
            {[
              ["both", "Both directions"],
              ["incoming", "Called by"],
              ["outgoing", "Calls"],
            ].map(([value, label]) => (
              <button
                className={direction === value ? "active" : ""}
                key={value}
                onClick={() => setDirection(value)}
              >
                {label}
              </button>
            ))}
            <span>Click a node to follow its calls</span>
          </div>
          {focus ? (
            <div
              className="call-canvas"
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div
                className={`call-flow ${direction}`}
                ref={flowRef}
                style={{
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
                }}
              >
                <svg
                  className="call-arrows"
                  width={flowSize.width}
                  height={flowSize.height}
                >
                  <defs>
                    <marker
                      id="call-arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 Z" fill="#778f81" />
                    </marker>
                  </defs>
                  {arrows.map((a) => (
                    <path
                      key={a.key}
                      d={a.d}
                      fill="none"
                      stroke="#778f81"
                      strokeWidth="1.3"
                      markerEnd="url(#call-arrow)"
                    />
                  ))}
                </svg>
                {direction !== "outgoing" && (
                  <div className="call-side callers">
                    <h3>
                      CALLED BY <span className="count">{incoming.length}</span>
                    </h3>
                    <div className="call-side-columns">
                      {callerColumns.map((edges, i) => (
                        <div className="call-column" key={`callers-${i}`}>
                          {edges.map((edge) =>
                            nodeCard(byId.get(edge.from), edge, "left"),
                          )}
                        </div>
                      ))}
                      {!incoming.length && (
                        <p className="call-empty">No indexed callers</p>
                      )}
                    </div>
                  </div>
                )}
                <section className="call-column selected-function">
                  <h3>SELECTED FUNCTION</h3>
                  {nodeCard(focus, null, "center")}
                  {recursion && (
                    <div className="recursion-link">
                      <RotateCcw size={13} />
                      Calls itself
                    </div>
                  )}
                </section>
                {direction !== "incoming" && (
                  <div className="call-side callees">
                    <h3>
                      CALLS <span className="count">{outgoing.length}</span>
                    </h3>
                    <div className="call-side-columns">
                      {calleeColumns.map((edges, i) => (
                        <div className="call-column" key={`callees-${i}`}>
                          {edges.map((edge) =>
                            nodeCard(byId.get(edge.to), edge, "right"),
                          )}
                        </div>
                      ))}
                      {!outgoing.length && (
                        <p className="call-empty">
                          No {showUnresolved ? "" : "resolved "}outgoing calls
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="empty">
              No functions or call sites found in this repository.
            </p>
          )}
        </div>
      </div>
      <div className="graph-bottom">
        <span>
          Caller <ArrowRight size={12} /> callee · Direct calls only
        </span>
        <div>
          <button title="Zoom out" onClick={() => setZoom(view.k / 1.12)}>
            <Minus size={14} />
          </button>
          <span>{Math.round(view.k * 100)}%</span>
          <button title="Zoom in" onClick={() => setZoom(view.k * 1.12)}>
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
