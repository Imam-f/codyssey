import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  FolderOpen,
  Search,
  RefreshCw,
  Download,
  ChevronRight,
  ChevronDown,
  FileCode2,
  Braces,
  Box,
  Variable,
  GitBranch,
  ArrowUpRight,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ListTree,
  Command,
  CircleAlert,
  Check,
  ArrowLeft,
  ArrowRight,
  SlidersHorizontal,
  Maximize2,
  Minus,
  Plus,
  Crosshair,
  Link2,
  Code2,
} from "lucide-react";
import { initHighlighter } from "./highlight";
import CallGraph, { CallRelations } from "./CallGraph";
import "./styles.css";
import "./calls.css";

const Icon = ({ kind, size = 13 }) =>
  kind === "class" ? (
    <Box size={size} />
  ) : kind === "function" ? (
    <Braces size={size} />
  ) : kind === "import" ? (
    <ArrowUpRight size={size} />
  ) : (
    <Variable size={size} />
  );
const basename = (path) => path.split("/").pop();
const api = window.codyssey || {
  sample: () =>
    fetch("./sample-index.json").then((r) => {
      if (!r.ok)
        throw new Error("Sample index unavailable. Run npm run sample.");
      return r.json();
    }),
  open: async () => {
    throw new Error(
      "Open the Electron desktop app with npm run dev to choose a local repository.",
    );
  },
  refresh: () => api.sample(),
  export: async (data) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([data], { type: "application/json" }),
    );
    a.download = "codyssey-analysis.json";
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  },
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function Resizer({ orientation, onResize, label }) {
  const dragging = useRef(false);
  const last = useRef(0);
  const axis = orientation === "vertical" ? "clientX" : "clientY";
  const onPointerDown = (e) => {
    dragging.current = true;
    last.current = e[axis];
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    document.body.style.cursor =
      orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    const delta = e[axis] - last.current;
    last.current = e[axis];
    onResize(delta);
  };
  const stop = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {}
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  return (
    <div
      className={`resizer resizer-${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
    />
  );
}

function App() {
  const [repo, setRepo] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [callFocus, setCallFocus] = useState(null);
  const [path, setPath] = useState(""),
    [selectedId, setSelectedId] = useState(null),
    [line, setLine] = useState(1);
  const [view, setView] = useState("source"),
    [inspector, setInspector] = useState("symbol"),
    [bottom, setBottom] = useState("references");
  const [fileQuery, setFileQuery] = useState(""),
    [symbolQuery, setSymbolQuery] = useState(""),
    [scopeFilter, setScopeFilter] = useState(true);
  const [palette, setPalette] = useState(false),
    [paletteQuery, setPaletteQuery] = useState(""),
    [sidebar, setSidebar] = useState(true);
  const [tokens, setTokens] = useState([]),
    [highlightReady, setHighlightReady] = useState(false),
    [highlightError, setHighlightError] = useState("");
  const [tabs, setTabs] = useState([]),
    [history, setHistory] = useState([]),
    [historyIndex, setHistoryIndex] = useState(-1),
    [notice, setNotice] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(226),
    [inspectorWidth, setInspectorWidth] = useState(284),
    [bottomHeight, setBottomHeight] = useState(226);
  const codeRef = useRef(null),
    findRef = useRef(null);
  const file = repo?.files.find((f) => f.path === path);
  const referencesByLine = useMemo(() => {
    const map = new Map();
    for (const ref of file?.references || []) {
      if (!map.has(ref.line)) map.set(ref.line, []);
      map.get(ref.line).push(ref);
    }
    return map;
  }, [file]);
  const symbols = useMemo(
    () => repo?.files.flatMap((f) => f.symbols) || [],
    [repo],
  );
  const classes = useMemo(
    () => repo?.files.flatMap((f) => f.classes) || [],
    [repo],
  );
  const selected = symbols.find((s) => s.id === selectedId);
  const activeScope = file?.scopes
    .filter((s) => s.kind === "function" && s.line <= line && s.endLine >= line)
    .sort((a, b) => b.line - a.line)[0];
  const callContext =
    selected?.kind === "function"
      ? selected.id
      : symbols.find((s) => s.bodyScopeId === activeScope?.id)?.id;
  function focusCall(id) {
    setCallFocus(id);
    setView("calls");
    const node = repo?.callGraph?.nodes.find((n) => n.id === id);
    if (node && !node.external) {
      setPath(node.path);
      setLine(node.line);
      setSelectedId(node.id);
      setInspector("symbol");
    }
  }
  const refs = (file?.references || []).filter(
    (r) =>
      r.symbolId === selectedId &&
      r.role !== "declaration" &&
      (!scopeFilter || !activeScope || r.scopeId === activeScope.id),
  );
  const fileSymbols = (file?.symbols || []).filter(
    (s) =>
      (!symbolQuery ||
        `${s.name} ${s.type}`
          .toLowerCase()
          .includes(symbolQuery.toLowerCase())) &&
      (!scopeFilter ||
        !activeScope ||
        s.scopeId === activeScope.id ||
        s.bodyScopeId === activeScope.id),
  );
  const aliases = file?.aliases || [];
  const diagnostics = repo?.diagnostics || [];

  async function load(method) {
    setBusy(true);
    setError("");
    try {
      const data = await api[method]();
      if (!data) return;
      setRepo(data);
      setCallFocus(null);
      const next =
        data.files.find((f) => f.path === path) ||
        data.files.find((f) => f.path.endsWith("service.py")) ||
        data.files[0];
      setPath(next?.path || "");
      setTabs(next ? [next.path] : []);
      const initial =
        next?.symbols.find(
          (s) => s.name === "user" && s.scopeName === "update_email",
        ) || next?.symbols[0];
      setSelectedId(initial?.id || null);
      setLine(initial?.line || 1);
      setHistory([]);
      setHistoryIndex(-1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load("sample");
  }, []);
  useEffect(() => {
    let canceled = false;
    setTokens([]);
    if (file)
      initHighlighter()
        .then((highlight) => {
          if (!canceled) {
            setTokens(highlight(file.source));
            setHighlightReady(true);
          }
        })
        .catch((e) => {
          if (!canceled) setHighlightError(e.message);
        });
    return () => {
      canceled = true;
    };
  }, [file]);
  useEffect(() => {
    codeRef.current
      ?.querySelector(`[data-line="${line}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [line, path, tokens, view]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [notice]);

  function navigate(target, remember = true) {
    if (!target) return;
    const dest = {
      path: target.path || path,
      line: target.line || 1,
      id: target.id || target.symbolId || null,
    };
    if (remember) {
      const next = history.slice(0, historyIndex + 1);
      next.push({ path, line, id: selectedId }, dest);
      setHistory(next);
      setHistoryIndex(next.length - 1);
    }
    setPath(dest.path);
    setLine(dest.line);
    setSelectedId(dest.id);
    setView("source");
    setTabs((prev) => (prev.includes(dest.path) ? prev : [...prev, dest.path]));
  }
  function travel(delta) {
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    setHistoryIndex(next);
    navigate(history[next], false);
  }
  function jumpType() {
    const target = symbols.find((s) => s.id === selected?.typeTargets?.[0]);
    if (target) navigate(target);
  }
  async function exportReport() {
    try {
      if (await api.export(JSON.stringify(repo, null, 2)))
        setNotice("Analysis exported");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    const keydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPalette((v) => !v);
        setPaletteQuery("");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        if (!busy) load("open");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setView("source");
        setBottom("symbols");
        requestAnimationFrame(() => findRef.current?.focus());
      }
      if (e.key === "Escape") setPalette(false);
      if (e.key === "F12") {
        e.preventDefault();
        if (e.ctrlKey) jumpType();
        else if (selected) navigate(selected);
      }
      if (e.key === "F5") {
        e.preventDefault();
        if (!busy) load("refresh");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">
            <Code2 size={19} />
          </span>
          codyssey<span className="version">PYTHON</span>
        </div>
        <div className="toolbar-divider" />
        <button
          className="repo-button"
          onClick={() => load("open")}
          disabled={busy}
          title="Open repository · Ctrl+O"
        >
          <FolderOpen size={15} />
          <span>{repo?.name || "Open repository"}</span>
          <ChevronDown size={12} />
        </button>
        <button className="quick-open" onClick={() => setPalette(true)}>
          <Search size={14} />
          <span>Go to file or symbol…</span>
          <kbd>Ctrl P</kbd>
        </button>
        <div className="toolbar-actions">
          <button
            onClick={() => load("refresh")}
            disabled={busy || !repo}
            title="Re-index repository · F5"
          >
            <RefreshCw size={15} className={busy ? "spin" : ""} />
          </button>
          <button
            onClick={exportReport}
            disabled={!repo || busy}
            title="Export analysis as JSON"
          >
            <Download size={15} />
          </button>
          <span className="indexed">
            <i className={busy ? "busy-dot" : ""} />
            {busy ? "Indexing" : "Indexed"}
          </span>
        </div>
      </header>
      {error && (
        <div role="alert" className="error-bar">
          <CircleAlert size={14} />
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="workspace">
        {sidebar && (
          <aside className="sidebar" style={{ width: sidebarWidth }}>
            <div className="panel-heading">
              <span>EXPLORER</span>
              <span className="muted">{repo?.stats.files ?? 0} files</span>
            </div>
            <label className="filter">
              <Search size={13} />
              <input
                aria-label="Filter files"
                placeholder="Filter files…"
                value={fileQuery}
                onChange={(e) => setFileQuery(e.target.value)}
              />
              <kbd>/</kbd>
            </label>
            <div className="file-tree">
              <div className="tree-root">
                <ChevronDown size={13} />
                <FolderOpen size={14} />
                <b>{repo?.name || "repository"}</b>
              </div>
              <FileTree
                files={(repo?.files || []).filter((f) =>
                  f.path.toLowerCase().includes(fileQuery.toLowerCase()),
                )}
                selected={path}
                onSelect={(f) => navigate({ path: f.path })}
              />
              {repo && !repo.files.length && (
                <p className="empty">No Python files found.</p>
              )}
            </div>
            <div className="panel-heading outline-heading">
              <span>OUTLINE</span>
              <span className="muted">{basename(path)}</span>
            </div>
            <div className="outline">
              {file?.symbols
                .filter((s) => ["class", "function", "type"].includes(s.kind))
                .map((s) => (
                  <button
                    key={s.id}
                    className={`outline-row ${selectedId === s.id ? "selected" : ""}`}
                    style={{
                      paddingLeft: s.scopeName === "<module>" ? 15 : 29,
                    }}
                    onClick={() => navigate(s)}
                  >
                    <span className={`kind-${s.kind}`}>
                      <Icon kind={s.kind} />
                    </span>
                    <span>{s.name}</span>
                    <small>{s.line}</small>
                  </button>
                ))}
            </div>
            <div className="repo-summary">
              <span>
                <b>{repo?.stats.lines.toLocaleString() || 0}</b> lines
              </span>
              <span>
                <b>{repo?.stats.symbols || 0}</b> symbols
              </span>
              <span>
                <b>{repo?.stats.classes || 0}</b> classes
              </span>
            </div>
          </aside>
        )}
        {sidebar && (
          <Resizer
            orientation="vertical"
            label="Resize explorer"
            onResize={(d) =>
              setSidebarWidth((w) => clamp(w + d, 160, 520))
            }
          />
        )}
        <main className="main">
          <div className="view-bar">
            <div className="view-tabs">
              <button
                className={view === "source" ? "active" : ""}
                onClick={() => setView("source")}
              >
                <FileCode2 size={14} />
                Source
              </button>
              <button
                className={view === "graph" ? "active" : ""}
                onClick={() => setView("graph")}
              >
                <GitBranch size={14} />
                Inheritance<span className="count">{classes.length}</span>
              </button>
              <button
                className={view === "calls" ? "active" : ""}
                onClick={() => {
                  setCallFocus(callContext || callFocus);
                  setView("calls");
                }}
              >
                <ListTree size={14} />
                Call graph
                <span className="count">{repo?.stats.calls || 0}</span>
              </button>
            </div>
            <button
              title="Toggle explorer"
              onClick={() => setSidebar((v) => !v)}
            >
              {sidebar ? (
                <PanelLeftClose size={15} />
              ) : (
                <PanelLeftOpen size={15} />
              )}
            </button>
          </div>
          {view === "source" ? (
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
                  <div
                    className="code"
                    role="region"
                    aria-label="Python source"
                  >
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
                            onClick={() => setLine(row + 1)}
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
                                  r.column === token.start &&
                                  r.name === token.text,
                              );
                              return (
                                <span
                                  key={i}
                                  className={`syntax-${token.kind} ${lineRefs.some((r) => r.column === token.start && r.name === token.text) ? "occurrence" : ""} ${ref?.symbolId ? "clickable-token" : ""}`}
                                  title={
                                    ref?.symbolId
                                      ? `${ref.name} · ${ref.role} · click to inspect`
                                      : undefined
                                  }
                                  onClick={() => {
                                    setLine(row + 1);
                                    if (ref?.symbolId) {
                                      setSelectedId(ref.symbolId);
                                      setInspector("symbol");
                                    }
                                  }}
                                  onDoubleClick={() => {
                                    if (ref?.symbolId)
                                      navigate(
                                        symbols.find(
                                          (s) => s.id === ref.symbolId,
                                        ),
                                      );
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
                    <span
                      className={`count ${diagnostics.length ? "warn" : ""}`}
                    >
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
                          <span className={`role role-${ref.role}`}>
                            {ref.role}
                          </span>
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
                              onKeyDown={(e) =>
                                e.key === "Enter" && navigate(s)
                              }
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
          ) : view === "calls" ? (
            <CallGraph
              graph={repo?.callGraph}
              focusId={callFocus}
              onFocus={focusCall}
              onNavigate={navigate}
            />
          ) : (
            <InheritanceGraph classes={classes} onNavigate={navigate} />
          )}
        </main>
        <Resizer
          orientation="vertical"
          label="Resize inspector"
          onResize={(d) => setInspectorWidth((w) => clamp(w - d, 200, 560))}
        />
        <aside className="inspector" style={{ width: inspectorWidth }}>
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
                  <div className="section-label">
                    DECLARATION<kbd>F12</kbd>
                  </div>
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
                  graph={repo?.callGraph}
                  focusId={callContext}
                  onNavigate={navigate}
                  onFocus={focusCall}
                />
                {aliases.some(
                  (a) =>
                    a.symbolId === selected.id || a.targetId === selected.id,
                ) && (
                  <div className="detail-section">
                    <div className="section-label">RELATED ALIASES</div>
                    {aliases
                      .filter(
                        (a) =>
                          a.symbolId === selected.id ||
                          a.targetId === selected.id,
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
                        <React.Fragment key={j}>
                          {j > 0 && <ArrowRight size={11} />}
                          <span>{part}</span>
                        </React.Fragment>
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
                            navigate(
                              symbols.find((s) => s.id === alias.targetId),
                            )
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
                  Static chains. Conditional assignments and runtime rebinding
                  may differ.
                </span>
              </div>
            </>
          )}
        </aside>
      </div>
      <footer className="statusbar">
        <div>
          <span className="status-branch">
            <GitBranch size={12} />
            local workspace
          </span>
          <span title="Parse errors">
            <CircleAlert size={12} />
            {diagnostics.length}
          </span>
        </div>
        <div>
          {notice && (
            <span className="notice">
              <Check size={12} />
              {notice}
            </span>
          )}
          <span
            title={
              highlightError || "Syntax highlighting powered by Tree-sitter"
            }
          >
            <i className={highlightReady ? "" : "busy-dot"} />
            {highlightError
              ? "Highlighting unavailable"
              : highlightReady
                ? "Tree-sitter"
                : "Loading parser"}
          </span>
          <span>Python AST</span>
          <span>UTF-8</span>
          <span>Ln {line}</span>
        </div>
      </footer>
      {palette && (
        <div className="modal-backdrop" onClick={() => setPalette(false)}>
          <div
            className="command-palette"
            role="dialog"
            aria-label="Go to file or symbol"
            onClick={(e) => e.stopPropagation()}
          >
            <label>
              <Search size={17} />
              <input
                autoFocus
                aria-label="Search files and symbols"
                placeholder="Search files and symbols…"
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
              />
              <kbd>esc</kbd>
            </label>
            <div className="palette-results">
              {[
                ...(repo?.files || []).map((f) => ({
                  name: f.path,
                  path: f.path,
                  kind: "file",
                })),
                ...symbols.filter((s) =>
                  ["class", "function", "type"].includes(s.kind),
                ),
              ]
                .filter((s) =>
                  `${s.name} ${s.path}`
                    .toLowerCase()
                    .includes(paletteQuery.toLowerCase()),
                )
                .slice(0, 60)
                .map((item, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      navigate(item);
                      setPalette(false);
                    }}
                  >
                    <Icon kind={item.kind} />
                    <b>{item.name}</b>
                    <span>
                      {item.kind === "file"
                        ? "file"
                        : `${item.path}:${item.line}`}
                    </span>
                    <ArrowUpRight size={12} />
                  </button>
                ))}
            </div>
            <div className="palette-footer">
              Files, classes, functions & type definitions
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FileTree({ files, selected, onSelect }) {
  const [collapsed, setCollapsed] = useState({});
  const tree = {};
  for (const file of files) {
    let branch = tree;
    const parts = file.path.split("/");
    parts.forEach((part, i) => {
      if (i === parts.length - 1) branch[part] = file;
      else branch = branch[part] ||= {};
    });
  }
  function render(branch, depth = 0, parent = "") {
    return Object.entries(branch)
      .sort(
        (a, b) =>
          Boolean(a[1].source !== undefined) -
            Boolean(b[1].source !== undefined) || a[0].localeCompare(b[0]),
      )
      .map(([name, value]) => {
        const key = parent + "/" + name;
        if (value.source !== undefined)
          return (
            <button
              key={key}
              className={`tree-file ${selected === value.path ? "active" : ""}`}
              style={{ paddingLeft: 23 + depth * 13 }}
              onClick={() => onSelect(value)}
            >
              <FileCode2 size={13} />
              <span>{name}</span>
              <small>{value.symbols.length}</small>
            </button>
          );
        return (
          <React.Fragment key={key}>
            <button
              className="tree-folder"
              style={{ paddingLeft: 12 + depth * 13 }}
              onClick={() => setCollapsed((v) => ({ ...v, [key]: !v[key] }))}
            >
              {collapsed[key] ? (
                <ChevronRight size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
              <FolderOpen size={13} />
              {name}
            </button>
            {!collapsed[key] && render(value, depth + 1, key)}
          </React.Fragment>
        );
      });
  }
  return render(tree);
}

function InheritanceGraph({ classes, onNavigate }) {
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

createRoot(document.getElementById("root")).render(<App />);
