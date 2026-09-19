import { GitBranch, CircleAlert, Check } from "lucide-react";

export default function StatusBar({
  diagnostics,
  notice,
  highlightError,
  highlightReady,
  line,
}) {
  return (
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
          title={highlightError || "Syntax highlighting powered by Tree-sitter"}
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
  );
}
