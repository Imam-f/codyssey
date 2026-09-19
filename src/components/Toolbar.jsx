import {
  Code2,
  FolderOpen,
  ChevronDown,
  Search,
  RefreshCw,
  Download,
  CircleAlert,
  X,
} from "lucide-react";

export default function Toolbar({
  repo,
  busy,
  error,
  onOpen,
  onRefresh,
  onExport,
  onPalette,
  onDismissError,
}) {
  return (
    <>
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
          onClick={onOpen}
          disabled={busy}
          title="Open repository · Ctrl+O"
        >
          <FolderOpen size={15} />
          <span>{repo?.name || "Open repository"}</span>
          <ChevronDown size={12} />
        </button>
        <button className="quick-open" onClick={onPalette}>
          <Search size={14} />
          <span>Go to file or symbol…</span>
          <kbd>Ctrl P</kbd>
        </button>
        <div className="toolbar-actions">
          <button
            onClick={onRefresh}
            disabled={busy || !repo}
            title="Re-index repository · F5"
          >
            <RefreshCw size={15} className={busy ? "spin" : ""} />
          </button>
          <button
            onClick={onExport}
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
          <button onClick={onDismissError} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
