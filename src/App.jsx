import { useState, useEffect, useMemo, useRef } from "react";
import {
  Box,
  FileCode2,
  GitBranch,
  LayoutDashboard,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { initHighlighter } from "./highlight";
import CallGraph from "./CallGraph";
import { api } from "./util";
import Resizer from "./components/Resizer";
import InheritanceGraph from "./components/InheritanceGraph";
import ClassTracker from "./components/ClassTracker";
import Overview from "./components/Overview";
import Toolbar from "./components/Toolbar";
import Sidebar from "./components/Sidebar";
import SourceView from "./components/SourceView";
import Inspector from "./components/Inspector";
import CommandPalette from "./components/CommandPalette";
import StatusBar from "./components/StatusBar";
import Welcome from "./components/Welcome";

function App() {
  const [repo, setRepo] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [recent, setRecent] = useState([]),
    [recentLoading, setRecentLoading] = useState(true);
  const loadingRef = useRef(false);
  const [callFocus, setCallFocus] = useState(null);
  const [activeReference, setActiveReference] = useState(null);
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
    findRef = useRef(null),
    tabStateRef = useRef({}),
    pendingScrollRef = useRef(null),
    sidebarRef = useRef(null),
    inspectorRef = useRef(null);
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
  const definition = activeReference
    ? activeReference.definition
    : selected?.definition || (selected?.kind !== "import" ? selected : null);
  const activeScope = file?.scopes
    .filter((s) => s.kind === "function" && s.line <= line && s.endLine >= line)
    .sort((a, b) => b.line - a.line)[0];
  const callContext =
    selected?.kind === "function"
      ? selected.id
      : symbols.find((s) => s.bodyScopeId === activeScope?.id)?.id;
  function focusCall(id) {
    setActiveReference(null);
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

  async function load(method, ...args) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await api[method](...args);
      if (!data) return;
      setRepo(data);
      setNotice("");
      setPalette(false);
      if (method !== "refresh") {
        setView("source");
        setInspector("symbol");
        setBottom("references");
        setFileQuery("");
        setSymbolQuery("");
      }
      setActiveReference(null);
      setCallFocus(null);
      tabStateRef.current = {};
      pendingScrollRef.current = null;
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
      setRecent(await api.recent());
    } catch (e) {
      setError(e.message);
    } finally {
      loadingRef.current = false;
      setBusy(false);
    }
  }
  async function closeRepository() {
    if (loadingRef.current) return;
    try {
      await api.close();
      setRepo(null);
      setPath("");
      setSelectedId(null);
      setActiveReference(null);
      setCallFocus(null);
      setTabs([]);
      setHistory([]);
      setHistoryIndex(-1);
      setPalette(false);
      setError("");
      setNotice("");
      tabStateRef.current = {};
      pendingScrollRef.current = null;
    } catch (e) {
      setError(e.message);
    }
  }
  async function removeRecent(root) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setBusy(true);
    try {
      setRecent(await api.removeRecent(root));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      loadingRef.current = false;
      setBusy(false);
    }
  }
  async function openInVSCode() {
    try {
      await api.openInVSCode();
      setNotice("Repository sent to VS Code");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    api.recent()
      .then(setRecent)
      .catch((e) => setError(e.message))
      .finally(() => setRecentLoading(false));
  }, []);
  useEffect(() => {
    let canceled = false;
    setTokens([]);
    setHighlightReady(false);
    setHighlightError("");
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
    const el = codeRef.current;
    if (!el) return;
    if (pendingScrollRef.current != null) {
      el.scrollTop = pendingScrollRef.current;
      pendingScrollRef.current = null;
      return;
    }
    el.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: "nearest" });
  }, [line, path, tokens, view]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [notice]);

  function saveTabState() {
    if (!path) return;
    const prev = tabStateRef.current[path] || {};
    tabStateRef.current[path] = {
      line,
      id: selectedId,
      reference: activeReference,
      scrollTop: codeRef.current
        ? codeRef.current.scrollTop
        : (prev.scrollTop ?? 0),
    };
  }
  function clearTabState(p) {
    delete tabStateRef.current[p];
  }
  function handleSourceScroll(e) {
    const st = tabStateRef.current[path] || {
      line,
      id: selectedId,
      reference: activeReference,
    };
    st.scrollTop = e.currentTarget.scrollTop;
    tabStateRef.current[path] = st;
  }

  function navigate(target, remember = true, origin = null) {
    if (!target) return;
    saveTabState();
    const switching =
      !target.line && !target.id && !target.symbolId && !target.reference;
    const saved = switching ? tabStateRef.current[target.path || path] : null;
    const dest = {
      path: target.path || path,
      line: (switching && saved?.line) || target.line || 1,
      id: (switching && saved?.id) || target.id || target.symbolId || null,
      reference: (switching && saved?.reference) || target.reference || null,
    };
    if (switching && saved) pendingScrollRef.current = saved.scrollTop;
    if (remember) {
      const next = history.slice(0, historyIndex + 1);
      next.push(
        origin || { path, line, id: selectedId, reference: activeReference },
        dest,
      );
      setHistory(next);
      setHistoryIndex(next.length - 1);
    }
    setPath(dest.path);
    setLine(dest.line);
    setSelectedId(dest.id);
    setActiveReference(dest.reference);
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
  function goToDefinition(ref = null) {
    const target = ref ? ref.definition : definition;
    if (target)
      navigate(
        target,
        true,
        ref
          ? {
              path: ref.path,
              line: ref.line,
              id: ref.symbolId || ref.definition?.id || null,
              reference: ref,
            }
          : null,
      );
    else setNotice("No definition found in the indexed repository");
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
      if (repo && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPalette((v) => !v);
        setPaletteQuery("");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        if (!busy) load("open");
      }
      if (repo && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setView("source");
        setBottom("symbols");
        requestAnimationFrame(() => findRef.current?.focus());
      }
      if (e.key === "Escape") setPalette(false);
      if (repo && e.key === "F12") {
        e.preventDefault();
        if (e.ctrlKey) jumpType();
        else goToDefinition();
      }
      if (e.key === "F5") {
        e.preventDefault();
        if (!busy && repo) load("refresh");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  return (
    <div className="app">
      <Toolbar
        repo={repo}
        busy={busy}
        error={error}
        onOpen={() => load("open")}
        onRefresh={() => load("refresh")}
        onExport={exportReport}
        onPalette={() => setPalette(true)}
        onDismissError={() => setError("")}
        onClose={closeRepository}
        onOpenInVSCode={openInVSCode}
      />
      {!repo ? (
        <Welcome
          busy={busy}
          recent={recent}
          recentLoading={recentLoading}
          onOpen={() => load("open")}
          onSample={() => load("sample")}
          onOpenRecent={(root) => load("openRecent", root)}
          onRemoveRecent={removeRecent}
        />
      ) : (
      <div className="workspace">
        {sidebar && (
          <Sidebar
            ref={sidebarRef}
            sidebarWidth={sidebarWidth}
            repo={repo}
            fileQuery={fileQuery}
            setFileQuery={setFileQuery}
            path={path}
            selectedId={selectedId}
            navigate={navigate}
            file={file}
          />
        )}
        {sidebar && (
          <Resizer
            orientation="vertical"
            label="Resize explorer"
            targetRef={sidebarRef}
            size={sidebarWidth}
            min={160}
            max={520}
            onResize={setSidebarWidth}
          />
        )}
        <main className="main">
          <div className="view-bar">
            <div className="view-tabs">
              <button
                className={view === "overview" ? "active" : ""}
                onClick={() => setView("overview")}
              >
                <LayoutDashboard size={14} />
                Overview
              </button>
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
                className={view === "classes" ? "active" : ""}
                onClick={() => setView("classes")}
              >
                <Box size={14} />
                Class tracker
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
          <div
            className="view-pane"
            style={{ display: view === "overview" ? undefined : "none" }}
          >
            <Overview repo={repo} onNavigate={navigate} />
          </div>
          <div
            className="view-pane"
            style={{ display: view === "source" ? undefined : "none" }}
          >
            <SourceView
              file={file}
              path={path}
              tabs={tabs}
              setTabs={setTabs}
              setPath={setPath}
              setSelectedId={setSelectedId}
              historyIndex={historyIndex}
              history={history}
              travel={travel}
              activeScope={activeScope}
              codeRef={codeRef}
              referencesByLine={referencesByLine}
              selectedId={selectedId}
              line={line}
              setLine={setLine}
              setActiveReference={setActiveReference}
              tokens={tokens}
              goToDefinition={goToDefinition}
              setInspector={setInspector}
              bottom={bottom}
              setBottom={setBottom}
              refs={refs}
              fileSymbols={fileSymbols}
              scopeFilter={scopeFilter}
              setScopeFilter={setScopeFilter}
              diagnostics={diagnostics}
              findRef={findRef}
              symbolQuery={symbolQuery}
              setSymbolQuery={setSymbolQuery}
              navigate={navigate}
              selected={selected}
              bottomHeight={bottomHeight}
              setBottomHeight={setBottomHeight}
              load={load}
              busy={busy}
              onScroll={handleSourceScroll}
              clearTabState={clearTabState}
            />
          </div>
          <div
            className="view-pane"
            style={{ display: view === "classes" ? undefined : "none" }}
          >
            <ClassTracker classes={classes} onNavigate={navigate} />
          </div>
          <div
            className="view-pane"
            style={{ display: view === "calls" ? undefined : "none" }}
          >
            <CallGraph
              graph={repo?.callGraph}
              focusId={callFocus}
              onFocus={focusCall}
              onNavigate={navigate}
            />
          </div>
          <div
            className="view-pane"
            style={{ display: view === "graph" ? undefined : "none" }}
          >
            <InheritanceGraph classes={classes} onNavigate={navigate} />
          </div>
        </main>
        {view !== "calls" && (
          <>
            <Resizer
              orientation="vertical"
              label="Resize inspector"
              targetRef={inspectorRef}
              size={inspectorWidth}
              min={200}
              max={560}
              sign={-1}
              onResize={setInspectorWidth}
            />
            <Inspector
              ref={inspectorRef}
              inspector={inspector}
              setInspector={setInspector}
              inspectorWidth={inspectorWidth}
              selected={selected}
              definition={definition}
              aliases={aliases}
              symbols={symbols}
              navigate={navigate}
              goToDefinition={goToDefinition}
              repo={repo}
              refs={refs}
              callContext={callContext}
              callGraph={repo?.callGraph}
              focusCall={focusCall}
              path={path}
            />
          </>
        )}
      </div>
      )}
      <StatusBar
        repo={repo}
        file={file}
        diagnostics={diagnostics}
        notice={notice}
        highlightError={highlightError}
        highlightReady={highlightReady}
        line={line}
      />
      {palette && repo && (
        <CommandPalette
          repo={repo}
          symbols={symbols}
          paletteQuery={paletteQuery}
          setPaletteQuery={setPaletteQuery}
          navigate={navigate}
          setPalette={setPalette}
        />
      )}
    </div>
  );
}

export default App;
