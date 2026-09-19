import { Search, ArrowUpRight } from "lucide-react";
import { Icon } from "../util";

export default function CommandPalette({
  repo,
  symbols,
  paletteQuery,
  setPaletteQuery,
  navigate,
  setPalette,
}) {
  return (
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
  );
}
