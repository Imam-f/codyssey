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
  Minimize2,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  GitBranch,
} from "lucide-react";

const NODES_PER_COLUMN = 6;

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
  const [connectionQuery, setConnectionQuery] = useState("");
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [direction, setDirection] = useState("both");
  const [expanded, setExpanded] = useState(false);
  const [showFunctions, setShowFunctions] = useState(true);
  const [activeEdge, setActiveEdge] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [layout, setLayout] = useState({ width: 0, height: 0, rects: {} });
  const canvasRef = useRef(null);
  const flowRef = useRef(null);
  const viewRef = useRef(view);
  const drag = useRef(null);
  viewRef.current = view;

  const byId = useMemo(
    () => new Map((graph?.nodes || []).map((n) => [n.id, n])),
    [graph],
  );
  const siteMap = useMemo(
    () => new Map((graph?.sites || []).map((s) => [s.id, s])),
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
  const filtered = choices.filter((n) =>
    `${n.label} ${n.path}`.toLowerCase().includes(query.toLowerCase()),
  );
  const matches = (id) => {
    const node = byId.get(id);
    return (
      node &&
      `${node.label} ${node.path || ""}`
        .toLowerCase()
        .includes(connectionQuery.toLowerCase())
    );
  };
  const callers = incoming.filter((e) => matches(e.from));
  const callees = outgoing.filter((e) => matches(e.to));
  const layoutKey = JSON.stringify([
    focus?.id,
    direction,
    callers.map((e) => e.from),
    callees.map((e) => e.to),
  ]);

  useEffect(() => {
    setActiveEdge(null);
  }, [focus?.id, connectionQuery, showUnresolved]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const clampZoom = (k) => Math.min(Math.max(k, 0.02), 2);
  function fit(size = layout, readable = false) {
    const canvas = canvasRef.current;
    if (
      !canvas?.clientWidth ||
      !canvas.clientHeight ||
      !size.width ||
      !size.height
    )
      return;
    const k = Math.min(
      1,
      Math.max(readable ? 0.75 : 0.02, (canvas.clientWidth - 40) / size.width),
      Math.max(
        readable ? 0.75 : 0.02,
        (canvas.clientHeight - 48) / size.height,
      ),
    );
    const selected = readable && size.rects[`center:${focus?.id}`];
    setView({
      k,
      x: selected
        ? canvas.clientWidth / 2 - ((selected.left + selected.right) / 2) * k
        : (canvas.clientWidth - size.width * k) / 2,
      y: selected
        ? canvas.clientHeight / 2 - selected.centerY * k
        : (canvas.clientHeight - size.height * k) / 2,
    });
  }

  useLayoutEffect(() => {
    const flow = flowRef.current;
    const canvas = canvasRef.current;
    if (!flow || !canvas) return;
    const measure = () => {
      if (!canvas.clientWidth || !canvas.clientHeight) return;
      const fr = flow.getBoundingClientRect();
      const k = viewRef.current.k;
      const rects = {};
      flow.querySelectorAll(".call-node").forEach((el) => {
        const r = el.getBoundingClientRect();
        rects[`${el.dataset.side}:${el.dataset.nodeId}`] = {
          left: (r.left - fr.left) / k,
          right: (r.right - fr.left) / k,
          top: (r.top - fr.top) / k,
          centerY: (r.top - fr.top + r.height / 2) / k,
        };
      });
      const next = {
        width: flow.offsetWidth,
        height: flow.offsetHeight,
        rects,
      };
      setLayout(next);
      // Keep large, continuous graphs readable; Fit explicitly shows everything.
      fit(next, true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [graph, layoutKey]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((v) => {
        const k = clampZoom(v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
        const x = e.clientX - rect.left,
          y = e.clientY - rect.top;
        return {
          k,
          x: x - ((x - v.x) * k) / v.k,
          y: y - ((y - v.y) * k) / v.k,
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [Boolean(focus)]);

  function setZoom(next) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const k = clampZoom(next),
      x = canvas.clientWidth / 2,
      y = canvas.clientHeight / 2;
    setView((v) => ({
      k,
      x: x - ((x - v.x) * k) / v.k,
      y: y - ((y - v.y) * k) / v.k,
    }));
  }
  function onPointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 0 && e.target.closest("button, a, input, label")) return;
    e.preventDefault();
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      ...view,
      id: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    setView((v) => ({
      ...v,
      x: d.x + e.clientX - d.startX,
      y: d.y + e.clientY - d.startY,
    }));
  }
  function onPointerUp(e) {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function openSite(site) {
    if (site) {
      setExpanded(false);
      onNavigate({ path: site.path, line: site.line, symbolId: site.callerId });
    }
  }
  function openDefinition(node) {
    setExpanded(false);
    onNavigate(node);
  }
  function nodeCard(node, edge, side) {
    if (!node) return null;
    const edgeKey = `${side}:${node.id}`;
    return (
      <div
        className={`call-node ${node.external ? "external" : ""} ${side === "center" ? "focused" : ""} ${activeEdge === edgeKey ? "highlighted" : ""}`}
        key={node.id}
        data-node-id={node.id}
        data-side={side}
        onMouseEnter={() => setActiveEdge(side === "center" ? null : edgeKey)}
        onMouseLeave={() => setActiveEdge(null)}
        onFocus={() => setActiveEdge(side === "center" ? null : edgeKey)}
        onBlur={() => setActiveEdge(null)}
      >
        <div className="call-node-kind">
          <span className="call-kind-dot" />
          {side === "center"
            ? "FOCUS"
            : node.external
              ? "EXTERNAL / DYNAMIC"
              : node.kind === "module"
                ? "MODULE"
                : "IN REPOSITORY"}
          {edge && (
            <span>
              {edge.sites.length} {edge.sites.length === 1 ? "call" : "calls"}
            </span>
          )}
        </div>
        <div className="call-node-header">
          <Braces size={16} />
          <button
            title={node.label}
            disabled={node.external}
            onClick={() => onFocus(node.id)}
          >
            {node.label.split(".").map((part, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <>
                    .<wbr />
                  </>
                )}
                {part}
              </React.Fragment>
            ))}
          </button>
          {!node.external && (
            <button
              title={`Open definition of ${node.label}`}
              onClick={() => openDefinition(node)}
            >
              <ArrowUpRight size={15} />
            </button>
          )}
        </div>
        <div
          className="call-node-location"
          title={
            node.external
              ? "No indexed definition for this target"
              : `${node.path}:${node.line}`
          }
        >
          {node.external
            ? "No indexed definition"
            : `${node.path}:${node.line}`}
        </div>
        {edge && (
          <div className="call-node-sites">
            <span>Call sites</span>
            <div className="call-site-buttons">
              {edge.sites.map((id) => {
                const site = siteMap.get(id);
                return (
                  site && (
                    <button
                      key={id}
                      title={`Open call site ${site.path}:${site.line}`}
                      onClick={() => openSite(site)}
                    >
                      L{site.line}
                      <ArrowUpRight size={10} />
                    </button>
                  )
                );
              })}
            </div>
          </div>
        )}
        {side === "center" && (
          <div className="call-focus-stats">
            <span>
              <b>{incoming.length}</b> callers
            </span>
            <ArrowRight size={14} />
            <span>
              <b>{outgoing.length}</b> targets
            </span>
          </div>
        )}
      </div>
    );
  }
  function relationColumn(side, edges, total) {
    const isLeft = side === "left";
    const columns = [];
    for (let i = 0; i < edges.length; i += NODES_PER_COLUMN) {
      columns.push(edges.slice(i, i + NODES_PER_COLUMN));
    }
    return (
      <section className={`call-side ${isLeft ? "callers" : "callees"}`}>
        <h3>
          {isLeft ? "Called by" : "Calls"}
          <span className="count">{total}</span>
        </h3>
        <div className="call-columns">
          {columns.map((column, i) => (
            <div className="call-column" key={i}>
              {column.map((edge) =>
                nodeCard(byId.get(isLeft ? edge.from : edge.to), edge, side),
              )}
            </div>
          ))}
        </div>
        {!edges.length && (
          <div className="call-empty-state">
            <GitBranch size={22} />
            <p>
              {connectionQuery
                ? "No matching connections"
                : isLeft
                  ? "No indexed callers"
                  : "No outgoing calls"}
            </p>
            <small>
              {connectionQuery
                ? "Try another name or file."
                : isLeft
                  ? "This is an entry point, or its callers are outside the index."
                  : "Try showing unresolved targets."}
            </small>
          </div>
        )}
      </section>
    );
  }

  const arrows = [];
  const center = layout.rects[`center:${focus?.id}`];
  if (center) {
    // Distant columns connect through the space above the cards. Their vertical
    // branches stay in column gutters rather than crossing intervening nodes.
    const railY =
      Math.min(...Object.values(layout.rects).map((r) => r.top)) - 48;
    const addArrow = (edge, side) => {
      const id = side === "left" ? edge.from : edge.to;
      const other = layout.rects[`${side}:${id}`];
      if (!other) return;
      const from = side === "left" ? other : center,
        to = side === "left" ? center : other;
      const mid = (from.right + to.left) / 2;
      const spansColumns = to.left - from.right > 100;
      arrows.push({
        key: `${side}:${id}`,
        external: !edge.resolved,
        d: spansColumns
          ? `M ${from.right} ${from.centerY} H ${from.right + 20} V ${railY} H ${to.left - 20} V ${to.centerY} H ${to.left}`
          : `M ${from.right} ${from.centerY} C ${mid} ${from.centerY}, ${mid} ${to.centerY}, ${to.left} ${to.centerY}`,
      });
    };
    if (direction !== "outgoing") callers.forEach((e) => addArrow(e, "left"));
    if (direction !== "incoming") callees.forEach((e) => addArrow(e, "right"));
  }

  return (
    <div className={`call-graph-view ${expanded ? "is-expanded" : ""}`}>
      <div className="graph-toolbar">
        <div className="call-graph-heading">
          <div className="call-graph-icon">
            <GitBranch size={21} />
          </div>
          <div>
            <h2>Function call graph</h2>
            <span>
              {choices.filter((n) => n.kind === "function").length} functions ·{" "}
              {graph?.sites.length || 0} call sites
            </span>
          </div>
        </div>
        <div className="call-toolbar-actions">
          <label className="scope-toggle">
            <input
              type="checkbox"
              checked={showUnresolved}
              onChange={(e) => setShowUnresolved(e.target.checked)}
            />
            Show unresolved
          </label>
          <button
            title={expanded ? "Exit fullscreen" : "Expand graph"}
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>
      <div className="call-workspace">
        {showFunctions && (
          <aside className="call-function-list">
            <div className="call-list-label">
              FUNCTIONS <span>{choices.length}</span>
            </div>
            <label className="filter">
              <Search size={14} />
              <input
                aria-label="Find function"
                placeholder="Find a function…"
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
                  <Braces size={13} />
                  <span>
                    {node.label}
                    <small>
                      {node.path}:{node.line}
                    </small>
                  </span>
                  {focus?.id === node.id && <ChevronRight size={12} />}
                </button>
              ))}
              {!filtered.length && (
                <p className="empty">No matching functions.</p>
              )}
            </div>
            <div className="call-list-footer">
              Select a function to explore its neighborhood.
            </div>
          </aside>
        )}
        <div className="call-graph-detail">
          <div className="call-controls">
            <button
              title={
                showFunctions ? "Hide function list" : "Show function list"
              }
              onClick={() => setShowFunctions((v) => !v)}
            >
              {showFunctions ? (
                <PanelLeftClose size={16} />
              ) : (
                <PanelLeftOpen size={16} />
              )}
            </button>
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
                  aria-pressed={direction === value}
                  key={value}
                  onClick={() => setDirection(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="call-connection-filter">
              <Search size={13} />
              <input
                aria-label="Filter connections"
                placeholder="Filter connections…"
                value={connectionQuery}
                onChange={(e) => setConnectionQuery(e.target.value)}
              />
            </label>
          </div>
          {focus ? (
            <div
              className="call-canvas"
              ref={canvasRef}
              onPointerDownCapture={onPointerDown}
              onMouseDownCapture={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
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
                  width={layout.width}
                  height={layout.height}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="call-arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path
                        d="M 1 1 L 9 5 L 1 9"
                        fill="none"
                        stroke="context-stroke"
                        strokeWidth="1.5"
                      />
                    </marker>
                  </defs>
                  {arrows.map((a) => (
                    <path
                      key={a.key}
                      className={`call-edge ${a.external ? "external" : ""} ${activeEdge === a.key ? "active" : activeEdge ? "muted" : ""}`}
                      d={a.d}
                      markerEnd="url(#call-arrow)"
                    />
                  ))}
                </svg>
                {direction !== "outgoing" &&
                  relationColumn("left", callers, incoming.length)}
                <section className="call-column selected-function">
                  <h3>
                    <Crosshair size={13} />
                    Selected function
                  </h3>
                  {nodeCard(focus, null, "center")}
                  {recursion && (
                    <button
                      className="recursion-link"
                      title="Open recursive call"
                      onClick={() => openSite(siteMap.get(recursion.sites[0]))}
                    >
                      <RotateCcw size={13} />
                      <span>Calls itself</span>
                      <span className="count">{recursion.sites.length}</span>
                    </button>
                  )}
                  <p className="call-focus-hint">
                    Follow a function to explore.
                    <br />
                    Open <ArrowUpRight size={11} /> to jump to source.
                  </p>
                </section>
                {direction !== "incoming" &&
                  relationColumn("right", callees, outgoing.length)}
              </div>
              <div className="call-canvas-hint">
                Left or middle drag to pan <span>·</span> Scroll to zoom
              </div>
            </div>
          ) : (
            <div className="call-no-graph">
              <GitBranch size={32} />
              <h3>No functions found</h3>
              <p>Open a repository with functions to explore their calls.</p>
            </div>
          )}
          <div className="graph-bottom">
            <div className="call-legend">
              <span className="call-legend-line" />
              Resolved
              <span className="call-legend-line unresolved" />
              Unresolved
            </div>
            <div className="call-zoom">
              <button title="Zoom out" onClick={() => setZoom(view.k / 1.15)}>
                <Minus size={14} />
              </button>
              <button title="Reset zoom to 100%" onClick={() => setZoom(1)}>
                {Math.round(view.k * 100)}%
              </button>
              <button title="Zoom in" onClick={() => setZoom(view.k * 1.15)}>
                <Plus size={14} />
              </button>
              <span className="call-control-divider" />
              <button
                title="Center on selected function"
                onClick={() => fit(layout, true)}
              >
                <Crosshair size={14} />
              </button>
              <button title="Fit in view" onClick={() => fit()}>
                <Maximize2 size={14} />
                <span>Fit</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
