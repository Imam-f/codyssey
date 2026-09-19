import {
  FileCode2,
  X,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Braces,
  Code2,
  FolderOpen,
  Search,
  CircleAlert,
  Check,
  ArrowUpRight,
} from "lucide-react";
import { Icon, basename, clamp } from "../util";
import Resizer from "./Resizer";

export default function SourceView({
  file,
  path,
  tabs,
  setTabs,
  setPath,
  setSelectedId,
  historyIndex,
  history,
  travel,
  activeScope,
  codeRef,
  referencesByLine,
  selectedId,
  line,
  setLine,
  setActiveReference,
  tokens,
  goToDefinition,
  setInspector,
  bottom,
  setBottom,
  refs,
  fileSymbols,
  scopeFilter,
  setScopeFilter,
  diagnostics,
  findRef,
  symbolQuery,
  setSymbolQuery,
  navigate,
  selected,
  bottomHeight,
  setBottomHeight,
  load,
  busy,
}) {
  return (
    <>
      <div className="file-tabs">
        {tabs.map((tab) => (
          <div
            key={tab}
            className={`file-tab ${tab === path ? "active" : ""}`}
          >
            <button onClick={() => navigate({ path: tab })}>
              <FileCode2 size={13} />
              {basename(tab)}
            </button>
            <button
              aria-label={`Close ${basename(tab)}`}
              onClick={() => {
                const next = tabs.filter((t) => t !== tab);
                setTabs(next);
                if (path === tab) {
                  setPath(next.at(-1) || "");
                  setSelectedId(null);
                }
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="breadcrumb">
        <button
          disabled={historyIndex <= 0}
          title="Back"
          onClick={() => travel(-1)}
        >
          <ArrowLeft size={13} />
        </button>
        <button
          disabled={historyIndex >= history.length - 1}
          title="Forward"
          onClick={() => travel(1)}
        >
          <ArrowRight size={13} />
        </button>
        <span>{path.replaceAll("/", "  /  ")}</span>
        {activeScope && (
          <>
            <ChevronRight size={12} />
            <Braces size={12} />
            <b>{activeScope.name}</b>
          </>
        )}
        <span className="breadcrumb-end">{file?.lines || 0} lines</span>
      </div>
      <div className="source-area" ref={codeRef}>
        {!file ? (
          <div className="welcome">
            <Code2 size={30} />
            <h2>Open a Python repository</h2>
            <p>Inspect symbols, follow aliases, explore inheritance.</p>
            <button
              className="primary"
              onClick={() => load("open")}
              disabled={busy}
            >
              <FolderOpen size={14} />
              Open folder<kbd>Ctrl O</kbd>
            </button>
            <button onClick={() => load("sample")} disabled={busy}>
              Load example repository
            </button>
          </div>
        ) : (
          <div className="code" role="region" aria-label="Python source">
            {file.source.split("\n").map((text, row) => {
              const rowRefs = referencesByLine.get(row + 1) || [];
              const lineRefs = rowRefs.filter(
                (r) => r.symbolId === selectedId,
              );
              return (
                <div
                  key={row}
                  data-line={row + 1}
                  className={`code-line ${line === row + 1 ? "current-line" : ""}`}
                >
                  <button
                    className="line-number"
                    onClick={() => {
                      setLine(row + 1);
                      setActiveReference(null);
                    }}
                  >
                    {row + 1}
                  </button>
                  <span className="line-content">
                    {(
                      tokens[row] || [
                        {
                          text,
                          start: 0,
                          end: text.length,
                          kind: "plain",
                        },
                      ]
                    ).map((token, i) => {
                      const ref = rowRefs.find(
                        (r) =>
                          r.column === token.start && r.name === token.text,
                      );
                      return (
                        <span
                          key={i}
                          className={`syntax-${token.kind} ${lineRefs.some((r) => r.column === token.start && r.name === token.text) ? "occurrence" : ""} ${ref?.symbolId || ref?.definition ? "clickable-token" : ""}`}
                          title={
                            ref
                              ? `${ref.name} · ${ref.role}${ref.definition ? ` · ${ref.definition.path}:${ref.definition.line} · Ctrl+click or F12 to go to definition` : " · no indexed definition"}`
                              : undefined
                          }
                          onClick={(event) => {
                            setLine(row + 1);
                            if (ref) {
                              if (event.ctrlKey || event.metaKey) {
                                goToDefinition(ref);
                                return;
                              }
                              setSelectedId(
                                ref.symbolId || ref.definition?.id || null,
                              );
                              setActiveReference(ref);
                              setInspector("symbol");
                            } else {
                              setActiveReference(null);
                              setSelectedId(null);
                            }
                          }}
                          onDoubleClick={() => {
                            if (ref) goToDefinition(ref);
                          }}
                        >
                          {token.text}
                        </span>
                      );
                    })}
                    {text.length === 0 && " "}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Resizer
        orientation="horizontal"
        label="Resize panel"
        onResize={(d) =>
          setBottomHeight((h) =>
            clamp(h - d, 120, Math.max(200, window.innerHeight - 220)),
          )
        }
      />
      <section className="bottom-panel" style={{ height: bottomHeight }}>
        <div className="bottom-tabs">
          <button
            className={bottom === "references" ? "active" : ""}
            onClick={() => setBottom("references")}
          >
            References<span className="count">{refs.length}</span>
          </button>
          <button
            className={bottom === "symbols" ? "active" : ""}
            onClick={() => setBottom("symbols")}
          >
            Variables & symbols
            <span className="count">{fileSymbols.length}</span>
          </button>
          <button
            className={bottom === "diagnostics" ? "active" : ""}
            onClick={() => setBottom("diagnostics")}
          >
            Problems
            <span className={`count ${diagnostics.length ? "warn" : ""}`}>
              {diagnostics.length}
            </span>
          </button>
          <label className="scope-toggle">
            <input
              type="checkbox"
              checked={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.checked)}
            />
            Current function
          </label>
        </div>
        <div className="bottom-content">
          {bottom === "references" ? (
            <>
              <div className="table-caption">
                <span>
                  {selected ? (
                    <>
                      <b>{selected.name}</b>
                      <span className="muted">
                        {" "}
                        in{" "}
                        {scopeFilter && activeScope
                          ? activeScope.name + "()"
                          : basename(path)}
                      </span>
                    </>
                  ) : (
                    "Select a symbol in the source to inspect its usages."
                  )}
                </span>
                <span className="muted">{refs.length} usages</span>
              </div>
              {refs.map((ref, i) => (
                <button
                  className="reference-row"
                  key={i}
                  onClick={() => navigate(ref)}
                >
                  <span className={`role role-${ref.role}`}>{ref.role}</span>
                  <span className="ref-location">
                    {basename(ref.path)}:{ref.line}
                  </span>
                  <code>
                    {file.source.split("\n")[ref.line - 1]?.trim()}
                  </code>
                  <ArrowUpRight size={12} />
                </button>
              ))}
              {selected && !refs.length && (
                <p className="empty">No usages in this scope.</p>
              )}
            </>
          ) : bottom === "symbols" ? (
            <>
              <label className="filter symbol-filter">
                <Search size={12} />
                <input
                  ref={findRef}
                  aria-label="Filter symbols"
                  value={symbolQuery}
                  onChange={(e) => setSymbolQuery(e.target.value)}
                  placeholder="Filter symbols by name or type…"
                />
              </label>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Scope</th>
                    <th>Usages</th>
                    <th>Line</th>
                  </tr>
                </thead>
                <tbody>
                  {fileSymbols.map((s) => (
                    <tr
                      key={s.id}
                      tabIndex={0}
                      onClick={() => navigate(s)}
                      onKeyDown={(e) => e.key === "Enter" && navigate(s)}
                    >
                      <td>
                        <span className={`kind-${s.kind}`}>
                          <Icon kind={s.kind} />
                        </span>
                        {s.name}
                      </td>
                      <td className="type-text">{s.type}</td>
                      <td>{s.scopeName}</td>
                      <td>{s.references}</td>
                      <td>{s.line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : diagnostics.length ? (
            diagnostics.map((d, i) => (
              <button
                key={i}
                className="diagnostic"
                onClick={() => navigate(d)}
              >
                <CircleAlert size={14} />
                <span>{d.message}</span>
                <small>
                  {d.path}:{d.line}
                </small>
              </button>
            ))
          ) : (
            <div className="no-problems">
              <Check size={15} />
              No parse errors in indexed files.
            </div>
          )}
        </div>
      </section>
    </>
  );
}
