import { Fragment, forwardRef } from "react";
import {
  Box,
  ArrowUpRight,
  FileCode2,
  Braces,
  Link2,
  ArrowRight,
  Crosshair,
  CircleAlert,
} from "lucide-react";
import { Icon, basename } from "../util";
import { CallRelations } from "../CallGraph";

const Inspector = forwardRef(function Inspector(
  {
    inspector,
    setInspector,
    inspectorWidth,
    selected,
    definition,
    aliases,
    symbols,
    navigate,
    goToDefinition,
    repo,
    refs,
    callContext,
    callGraph,
    focusCall,
    path,
  },
  ref,
) {
  return (
    <aside className="inspector" ref={ref} style={{ width: inspectorWidth }}>
      <div className="inspector-tabs">
        <button
          className={inspector === "symbol" ? "active" : ""}
          onClick={() => setInspector("symbol")}
        >
          Inspect
        </button>
        <button
          className={inspector === "aliases" ? "active" : ""}
          onClick={() => setInspector("aliases")}
        >
          Aliases<span className="count">{aliases.length}</span>
        </button>
      </div>
      {inspector === "symbol" ? (
        selected ? (
          <>
            <div className="symbol-title">
              <span className={`symbol-icon kind-${selected.kind}`}>
                <Icon kind={selected.kind} size={20} />
              </span>
              <div>
                <h2>{selected.name}</h2>
                <span>
                  {selected.kind} ·{" "}
                  {selected.scopeName === "<module>"
                    ? "module scope"
                    : selected.scopeName + "()"}
                </span>
              </div>
            </div>
            <div className="detail-section">
              <div className="section-label">TYPE</div>
              <div className="type-value">{selected.type}</div>
              <div className="type-source">
                {selected.typeSource === "annotation"
                  ? "Explicit annotation"
                  : selected.typeSource === "inferred"
                    ? "Inferred from expression"
                    : "No static type available"}
              </div>
              {selected.typeTargets?.length > 0 &&
                selected.typeTargets.map((id) => {
                  const target = symbols.find((s) => s.id === id);
                  return (
                    target && (
                      <button
                        key={id}
                        className="detail-link"
                        onClick={() => navigate(target)}
                      >
                        <Box size={13} />
                        {target.name}
                        <ArrowUpRight size={12} />
                      </button>
                    )
                  );
                })}
            </div>
            <div className="detail-section">
              <div className="section-label">DECLARATION</div>
              <button
                className="declaration-link"
                onClick={() => navigate(selected)}
              >
                <FileCode2 size={13} />
                <span>{selected.path}</span>
                <b>:{selected.line}</b>
                <ArrowUpRight size={13} />
              </button>
              <code className="declaration-preview">
                {repo.files
                  .find((f) => f.path === selected.path)
                  ?.source.split("\n")
                  [selected.line - 1]?.trim()}
              </code>
            </div>
            {definition &&
              (definition.path !== selected.path ||
                definition.line !== selected.line) && (
                <div className="detail-section definition-section">
                  <div className="section-label">
                    DEFINITION<kbd>F12</kbd>
                  </div>
                  <button
                    className="declaration-link"
                    title="Go to definition"
                    onClick={() => goToDefinition()}
                  >
                    <FileCode2 size={13} />
                    <span>{definition.path}</span>
                    <b>:{definition.line}</b>
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              )}
            <div className="detail-section">
              <div className="section-label">SCOPE</div>
              <div className="scope-name">
                <Braces size={13} />
                {selected.scopeName}
              </div>
              <div className="scope-stats">
                <span>
                  <b>{selected.references}</b> usages in file
                </span>
                <span>
                  <b>{refs.length}</b> in view
                </span>
              </div>
            </div>
            <CallRelations
              graph={callGraph}
              focusId={callContext}
              onNavigate={navigate}
              onFocus={focusCall}
            />
            {aliases.some(
              (a) => a.symbolId === selected.id || a.targetId === selected.id,
            ) && (
              <div className="detail-section">
                <div className="section-label">RELATED ALIASES</div>
                {aliases
                  .filter(
                    (a) =>
                      a.symbolId === selected.id || a.targetId === selected.id,
                  )
                  .map((a, i) => (
                    <button
                      className="related-alias"
                      key={i}
                      onClick={() => {
                        setInspector("aliases");
                      }}
                    >
                      <Link2 size={12} />
                      {a.name}
                      <ArrowRight size={11} />
                      {a.target}
                    </button>
                  ))}
              </div>
            )}
            <div className="inspector-help">
              <Crosshair size={13} />
              <span>
                Click a name to inspect.
                <br />
                Double-click to go to declaration.
              </span>
            </div>
          </>
        ) : (
          <div className="empty inspector-empty">
            <Crosshair size={24} />
            <p>Select a symbol in the source or outline.</p>
          </div>
        )
      ) : (
        <>
          <div className="alias-heading">
            <h3>Alias tracking</h3>
            <span>{basename(path)}</span>
          </div>
          <p className="alias-note">
            Import and assignment chains, with scope and reassignment
            boundaries.
          </p>
          <div className="alias-list">
            {aliases.map((alias, i) => (
              <div className="alias-card" key={i}>
                <div className="alias-card-top">
                  <button
                    onClick={() =>
                      navigate({
                        path: alias.path,
                        line: alias.line,
                        id: alias.symbolId,
                      })
                    }
                  >
                    <Link2 size={13} />
                    <b>{alias.name}</b>
                  </button>
                  <span>{alias.kind}</span>
                </div>
                <div className="alias-chain">
                  {alias.chain.map((part, j) => (
                    <Fragment key={j}>
                      {j > 0 && <ArrowRight size={11} />}
                      <span>{part}</span>
                    </Fragment>
                  ))}
                </div>
                <div className="alias-card-bottom">
                  <span>{alias.scopeName}</span>
                  <button
                    onClick={() =>
                      navigate({
                        path: alias.path,
                        line: alias.line,
                        id: alias.symbolId,
                      })
                    }
                  >
                    L{alias.line}
                    {alias.endLine ? `–${alias.endLine - 1}` : "+"}
                  </button>
                  {alias.targetId && (
                    <button
                      title="Go to alias target"
                      onClick={() =>
                        navigate(symbols.find((s) => s.id === alias.targetId))
                      }
                    >
                      <ArrowUpRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!aliases.length && (
              <p className="empty">
                No import or assignment aliases in this file.
              </p>
            )}
          </div>
          <div className="inspector-help">
            <CircleAlert size={13} />
            <span>
              Static chains. Conditional assignments and runtime rebinding may
              differ.
            </span>
          </div>
        </>
      )}
    </aside>
  );
});

export default Inspector;
