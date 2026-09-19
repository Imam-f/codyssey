import {
  Code2,
  FolderOpen,
  ChevronDown,
  Search,
  RefreshCw,
  Download,
  CircleAlert,
  ExternalLink,
  House,
  X,
} from "lucide-react";
import { appVersion, isDesktop } from "../util";

export default function Toolbar({
  repo,
  busy,
  error,
  onOpen,
  onRefresh,
  onExport,
  onPalette,
  onDismissError,
  onClose,
  onOpenInVSCode,
}) {
  return (
    <>
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">
            <Code2 size={19} />
          </span>
          codyssey<span className="version">v{appVersion}</span>
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
        {repo && (
          <button
            onClick={onClose}
            disabled={busy}
            title="Close repository and return to welcome"
            aria-label="Close repository"
          >
            <House size={15} />
          </button>
        )}
        <button className="quick-open" onClick={onPalette} disabled={!repo}>
          <Search size={14} />
          <span>Go to file or symbol…</span>
          <kbd>Ctrl P</kbd>
        </button>
        <div className="toolbar-actions">
          {repo && (
            <button
              onClick={onOpenInVSCode}
              disabled={busy || !isDesktop}
              title={isDesktop
                ? "Open repository in a new Visual Studio Code window"
                : "Available in the desktop app"}
              aria-label="Open in VS Code"
            >
              <ExternalLink size={15} /><span>VS Code</span>
            </button>
          )}
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
          <span className="indexed" role="status">
            <i className={busy ? "busy-dot" : !repo ? "idle-dot" : ""} />
            {busy ? "Indexing" : repo ? "Indexed" : "Ready"}
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
