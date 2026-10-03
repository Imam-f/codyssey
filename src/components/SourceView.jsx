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
  Maximize2,
  Frame,
} from "lucide-react";
import { Icon, basename } from "../util";
import Resizer from "./Resizer";
import SourceMinimap from "./SourceMinimap";
import { declarationAtLine } from "../declaration";
import { computeFoldRanges } from "../folding";
import { selectedSourceLines } from '../source-selection';

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
  onScroll,
  clearTabState,
  onPopDeclaration,
  onAddToCanvas,
  marks,
  onToggleMark,
  navigationId,
}) {
  const bottomRef = useRef(null);
  const pendingRevealRef = useRef(null);
  const [canvasLines, setCanvasLines] = useState(null);
  const lineAnchor = useRef(null);
  useEffect(() => {
    setCanvasLines(null); lineAnchor.current = null;
  }, [file?.path, file?.source]);
  useEffect(() => {
    const update = () => {
      const range = selectedSourceLines(codeRef.current);
      setCanvasLines((previous) => {
        if (!range) return previous?.origin === 'gutter' ? previous : null;
        return previous?.start === range.start && previous?.end === range.end && previous?.origin === 'text' ? previous : range;
      });
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [codeRef]);
  function addSourceToCanvas() {
    const range = selectedSourceLines(codeRef.current) || canvasLines;
    if (range) onAddToCanvas(null, range.start, range.end);
    else if (declarationAtCursor) onAddToCanvas(declarationAtCursor);
    else onAddToCanvas(null, line);
    window.getSelection()?.removeAllRanges();
    setCanvasLines(null);
  }
  const marksByLine = useMemo(() => new Map(marks.map((mark) => [mark.line, mark])), [marks]);
  const declarationAtCursor = declarationAtLine(file, line);
  const declarationsByLine = useMemo(() => new Map(
    (file?.symbols || [])
      .filter((symbol) => ["class", "function"].includes(symbol.kind))
      .map((symbol) => [symbol.line, symbol]),
  ), [file]);
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

  useEffect(() => {
    if (!foldRanges.some((range) => collapsed.has(range.start) && range.start < line - 1 && range.end >= line - 1)) return;
    pendingRevealRef.current = line;
    setCollapsed((prev) => {
      const containing = foldRanges.filter((range) => range.start < line - 1 && range.end >= line - 1);
      if (!containing.some((range) => prev.has(range.start))) return prev;
      const next = new Set(prev);
      containing.forEach((range) => next.delete(range.start));
      return next;
    });
  }, [path, line, foldRanges, codeRef, navigationId]);

  useEffect(() => {
    if (pendingRevealRef.current !== line || hiddenLines.has(line - 1)) return;
    codeRef.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: "nearest" });
    syncViewport(codeRef.current);
    pendingRevealRef.current = null;
  }, [hiddenLines, line, codeRef]);

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
        {declarationAtCursor && (
            <button title={`Pop ${declarationAtCursor.name} into an always-on-top window`} aria-label={`Pop ${declarationAtCursor.name}`} onClick={() => onPopDeclaration(declarationAtCursor)}>
              <Maximize2 size={13} />
            </button>
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
        {file && <button
          title={canvasLines ? `Add selected lines ${canvasLines.start}–${canvasLines.end} to canvas` : declarationAtCursor ? `Add ${declarationAtCursor.name} to canvas` : `Add line ${line} to canvas`}
          aria-label="Add to canvas"
          onPointerDown={(event) => event.preventDefault()}
          onClick={addSourceToCanvas}
        ><Frame size={13} />Add to canvas{canvasLines && <small> · {canvasLines.start}–{canvasLines.end}</small>}</button>}
        <span className="breadcrumb-end">{file?.lines || 0} lines</span>
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
              <h2>Open a Python or Cython repository</h2>
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
            <div className="code" role="region" aria-label={file.language === "cython" ? "Cython source" : "Python source"}>
            {file.source.split("\n").map((text, row) => {
              if (hiddenLines.has(row)) return null;
              const rowRefs = referencesByLine.get(row + 1) || [];
              const lineRefs = rowRefs.filter(
                (r) => r.symbolId === selectedId,
              );
              const fold = foldByStart.get(row);
              const declaration = declarationsByLine.get(row + 1);
              const mark = marksByLine.get(row + 1);
              return (
                <div
                  key={row}
                  data-line={row + 1}
                  className={`code-line ${line === row + 1 ? "current-line" : ""} ${mark ? "marked-line" : ""} ${canvasLines && row + 1 >= canvasLines.start && row + 1 <= canvasLines.end ? 'canvas-selected-line' : ''}`}
                >
                  <button
                    className={`mark-toggle ${mark ? "is-marked" : ""}`}
                    aria-label={`${mark ? "Remove" : "Add"} mark at line ${row + 1}`}
                    aria-pressed={Boolean(mark)}
                    title={mark?.note || `${mark ? "Remove" : "Add"} mark · line ${row + 1}`}
                    onClick={() => onToggleMark(path, row + 1)}
                  ><span className="mark-dot" /></button>
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
                  <span className="declaration-slot">
                    {declaration && (
                      <button className="declaration-pop" title={`Pop ${declaration.name}`} aria-label={`Pop ${declaration.name}`} onClick={() => onPopDeclaration(declaration)}>
                        <Maximize2 size={11} />
                      </button>
                    )}
                  </span>
                  <button
                    className="line-number"
                    onClick={(event) => {
                      if (event.shiftKey) {
                        const anchor = lineAnchor.current ?? line;
                        setCanvasLines({ start: Math.min(anchor, row + 1), end: Math.max(anchor, row + 1), origin: 'gutter' });
                      } else {
                        lineAnchor.current = row + 1;
                        setCanvasLines(null);
                      }
                      setLine(row + 1);
                      setActiveReference(null);
                    }}
                  >
                    {row + 1}
                  </button>
                  <span className="line-content" onPointerDown={() => setCanvasLines(null)}>
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
                            if (selectedSourceLines(codeRef.current)) return;
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
        {file && (
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
            marks={marks}
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
