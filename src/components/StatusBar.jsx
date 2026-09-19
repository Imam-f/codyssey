import { GitBranch, CircleAlert, Check } from "lucide-react";
import { appVersion } from "../util";

export default function StatusBar({
  repo,
  file,
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
          {repo ? "local workspace" : "No repository open"}
        </span>
        {repo && (
          <span title="Parse errors">
            <CircleAlert size={12} />
            {diagnostics.length}
          </span>
        )}
      </div>
      <div>
        {notice && (
          <span className="notice">
            <Check size={12} />
            {notice}
          </span>
        )}
        {repo ? (
          <>
            {file && (
              <span title={highlightError || "Syntax highlighting powered by Tree-sitter"}>
                <i className={highlightReady ? "" : "busy-dot"} />
                {highlightError
                  ? "Highlighting unavailable"
                  : highlightReady
                    ? "Tree-sitter"
                    : "Loading parser"}
              </span>
            )}
            <span>Python AST</span>
            {file && (
              <>
                <span>UTF-8</span>
                <span>Ln {line}</span>
              </>
            )}
          </>
        ) : (
          <>
            <span>v{appVersion}</span>
            <span>MIT License</span>
          </>
        )}
      </div>
    </footer>
  );
}
