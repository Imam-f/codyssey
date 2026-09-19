import React, { useMemo, useState } from "react";
import {
  Search,
  Braces,
  ArrowUpRight,
  ArrowRight,
  Crosshair,
  RotateCcw,
  CircleAlert,
} from "lucide-react";

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

  function nodeCard(node, edge, side) {
    return (
      <div
        className={`call-node ${node.external ? "external" : ""} ${side === "center" ? "focused" : ""}`}
        key={node.id}
        data-node-id={node.id}
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
            <div className={`call-flow ${direction}`}>
              {direction !== "outgoing" && (
                <section className="call-column callers">
                  <h3>
                    CALLED BY <span className="count">{incoming.length}</span>
                  </h3>
                  {incoming.map((edge) =>
                    nodeCard(byId.get(edge.from), edge, "left"),
                  )}
                  {!incoming.length && (
                    <p className="call-empty">No indexed callers</p>
                  )}
                </section>
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
                <section className="call-column callees">
                  <h3>
                    CALLS <span className="count">{outgoing.length}</span>
                  </h3>
                  {outgoing.map((edge) =>
                    nodeCard(byId.get(edge.to), edge, "right"),
                  )}
                  {!outgoing.length && (
                    <p className="call-empty">
                      No {showUnresolved ? "" : "resolved "}outgoing calls
                    </p>
                  )}
                </section>
              )}
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
        <span>Static resolution; runtime dispatch may differ.</span>
      </div>
    </div>
  );
}
