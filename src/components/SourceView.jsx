import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileCode2,
  X,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Braces,
  Code2,
  FolderOpen,
  Search,
  CircleAlert,
  Check,
  ArrowUpRight,
  FileType2,
} from "lucide-react";
import { Icon, basename } from "../util";
import Resizer from "./Resizer";
import SourceMinimap from "./SourceMinimap";
import TypeEditor from "./TypeEditor";

function indentWidth(line) {
  let width = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

function computeFoldRanges(source) {
  const lines = source.split("\n");
  const isBlank = (line) => /^\s*$/.test(line);
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    if (isBlank(lines[i])) continue;
    const base = indentWidth(lines[i]);
    let next = i + 1;
    while (next < lines.length && isBlank(lines[next])) next++;
    if (next >= lines.length || indentWidth(lines[next]) <= base) continue;
    let end = next;
    while (end < lines.length) {
      if (!isBlank(lines[end]) && indentWidth(lines[end]) <= base) break;
      end++;
    }
    let last = end - 1;
    while (last > i && isBlank(lines[last])) last--;
    if (last > i) ranges.push({ start: i, end: last });
  }
  return ranges;
}

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
  typeErrors,
  findRef,
  symbolQuery,
  setSymbolQuery,
  navigate,
  selected,
  bottomHeight,
  setBottomHeight,
  load,
  busy,
  onScroll,
  clearTabState,
  saveTypes,
}) {
  const bottomRef = useRef(null);
  const [typeEditor, setTypeEditor] = useState(false);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    scrollHeight: 1,
    clientHeight: 1,
  });

  function syncViewport(element) {
    if (!element) return;
    setViewport({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    });
  }

  useEffect(() => {
    const element = codeRef.current;
    if (!element) return;
    syncViewport(element);
    const observer = new ResizeObserver(() => syncViewport(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, [codeRef, file, tokens]);

  const [collapsed, setCollapsed] = useState(new Set());
  const foldRanges = useMemo(
    () => (file ? computeFoldRanges(file.source) : []),
    [file],
  );
  const foldByStart = useMemo(
    () => new Map(foldRanges.map((r) => [r.start, r])),
    [foldRanges],
  );
  const hiddenLines = useMemo(() => {
    const hidden = new Set();
    for (const r of foldRanges) {
      if (collapsed.has(r.start)) {
        for (let i = r.start + 1; i <= r.end; i++) hidden.add(i);
      }
    }
    return hidden;
  }, [foldRanges, collapsed]);

  useEffect(() => {
    setCollapsed(new Set());
  }, [file?.path]);

  function toggleFold(start) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(start)) next.delete(start);
      else next.add(start);
      return next;
    });
  }
  function foldAll() {
    setCollapsed(new Set(foldRanges.map((r) => r.start)));
  }
  function unfoldAll() {
    setCollapsed(new Set());
  }

  const closeTab = (tab) => {
    clearTabState(tab);
    const next = tabs.filter((t) => t !== tab);
    setTabs(next);
    if (path === tab) {
      setPath(next.at(-1) || "");
      setSelectedId(null);
    }
  };

  return (
    <>
      <div className="file-tabs">
        {tabs.map((tab) => (
          <div
            key={tab}
            className={`file-tab ${tab === path ? "active" : ""}`}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                closeTab(tab);
              }
            }}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
          >
            <button onClick={() => navigate({ path: tab })}>
              <FileCode2 size={13} />
              {basename(tab)}
            </button>
            <button
              aria-label={`Close ${basename(tab)}`}
              onClick={() => closeTab(tab)}
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
        {file && foldRanges.length > 0 && (
          <span className="breadcrumb-folds">
            <button title="Fold all blocks" onClick={foldAll}>
              <ChevronsDownUp size={13} />
            </button>
            <button title="Unfold all blocks" onClick={unfoldAll}>
              <ChevronsUpDown size={13} />
            </button>
          </span>
        )}
        <span className="breadcrumb-end">{file?.lines || 0} lines</span>
        <button
          className={`types-toggle ${typeEditor ? "active" : ""}`}
          title="Edit the sidecar type declarations (.pxd)"
          onClick={() => setTypeEditor((v) => !v)}
        >
          <FileType2 size={13} />
          Types
        </button>
      </div>
      <div className="source-shell">
        <div
          className="source-area"
          ref={codeRef}
          onScroll={(event) => {
            onScroll(event);
            syncViewport(event.currentTarget);
          }}
        >
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
              if (hiddenLines.has(row)) return null;
              const rowRefs = referencesByLine.get(row + 1) || [];
              const lineRefs = rowRefs.filter(
                (r) => r.symbolId === selectedId,
              );
              const fold = foldByStart.get(row);
              return (
                <div
                  key={row}
                  data-line={row + 1}
                  className={`code-line ${line === row + 1 ? "current-line" : ""}`}
                >
                  <button
                    className={`fold-toggle ${fold ? "" : "fold-toggle-empty"}`}
                    aria-label={
                      fold
                        ? collapsed.has(row)
                          ? "Expand folded block"
                          : "Collapse block"
                        : undefined
                    }
                    aria-expanded={fold ? !collapsed.has(row) : undefined}
                    disabled={!fold}
                    onClick={() => toggleFold(row)}
                  >
                    {fold &&
                      (collapsed.has(row) ? (
                        <ChevronRight size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      ))}
                  </button>
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
        {file && !typeEditor && (
          <SourceMinimap
            file={file}
            path={path}
            tokens={tokens}
            sourceRef={codeRef}
            viewport={viewport}
            line={line}
            setLine={(nextLine) => {
              setLine(nextLine);
              setActiveReference(null);
            }}
            selected={selected}
            selectedId={selectedId}
            referencesByLine={referencesByLine}
            activeScope={activeScope}
            diagnostics={diagnostics}
          />
        )}
        {file && typeEditor && (
          <TypeEditor
            file={file}
            path={path}
            onSave={saveTypes}
            onClose={() => setTypeEditor(false)}
            busy={busy}
          />
        )}
      </div>
      <Resizer
        orientation="horizontal"
        label="Resize panel"
        targetRef={bottomRef}
        size={bottomHeight}
        min={120}
        max={Math.max(200, window.innerHeight - 220)}
        sign={-1}
        onResize={setBottomHeight}
      />
      <section className="bottom-panel" ref={bottomRef} style={{ height: bottomHeight }}>
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
            <span
              className={`count ${diagnostics.length || typeErrors.length ? "warn" : ""}`}
            >
              {diagnostics.length + typeErrors.length}
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
          ) : diagnostics.length || typeErrors.length ? (
            <>
              {typeErrors.map((d, i) => (
                <button
                  key={`t${i}`}
                  className="diagnostic"
                  onClick={() => navigate(d)}
                >
                  <CircleAlert size={14} />
                  <span>{d.message}</span>
                  <small>
                    {d.path}:{d.line}
                  </small>
                </button>
              ))}
              {diagnostics.map((d, i) => (
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
              ))}
            </>
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
