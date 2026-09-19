import { forwardRef } from "react";
import { Search, ChevronDown, FolderOpen } from "lucide-react";
import { Icon, basename } from "../util";
import FileTree from "./FileTree";

const Sidebar = forwardRef(function Sidebar(
  {
    sidebarWidth,
    repo,
    fileQuery,
    setFileQuery,
    path,
    selectedId,
    navigate,
    file,
  },
  ref,
) {
  return (
    <aside className="sidebar" ref={ref} style={{ width: sidebarWidth }}>
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
  );
});

export default Sidebar;
