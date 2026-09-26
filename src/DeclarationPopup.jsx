import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Info, X } from "lucide-react";
import { initHighlighter } from "./highlight";
import { computeFoldRanges } from "./folding";
import "./declaration-popup.css";

export default function DeclarationPopup() {
  const [data, setData] = useState(null);
  const [highlighted, setHighlighted] = useState({ source: null, tokens: [] });
  const [collapsed, setCollapsed] = useState(new Set());
  const codeBodyRef = useRef(null);
  useEffect(() => {
    let alive = true;
    window.codyssey.declarationState().then((value) => {
      if (alive) setData(value);
    });
    const unsubscribe = window.codyssey.onDeclarationUpdate((current) => {
      setData((previous) => previous && { ...previous, current });
    });
    return () => { alive = false; unsubscribe(); };
  }, []);
  const target = data?.target;
  const current = data?.current;
  const source = current?.source || "";
  const lines = useMemo(() => source.split("\n"), [source]);
  const foldRanges = useMemo(() => {
    const counts = new Map();
    return computeFoldRanges(source).map((range) => {
      const header = lines[range.start];
      const ordinal = counts.get(header) || 0;
      counts.set(header, ordinal + 1);
      return { ...range, id: `${header}:${ordinal}` };
    });
  }, [source, lines]);
  const foldByStart = useMemo(
    () => new Map(foldRanges.map((range) => [range.start, range])),
    [foldRanges],
  );
  const hiddenLines = useMemo(() => {
    const hidden = new Set();
    for (const range of foldRanges) {
      if (!collapsed.has(range.id)) continue;
      for (let row = range.start + 1; row <= range.end; row++) hidden.add(row);
    }
    return hidden;
  }, [foldRanges, collapsed]);
  const allFolded = foldRanges.length > 0 && foldRanges.every((range) => collapsed.has(range.id));
  const numberWidth = Math.max(32, String(current?.endLine || 1).length * 8 + 6);
  useEffect(() => {
    if (!source) return;
    let active = true;
    initHighlighter()
      .then((highlight) => {
        if (active) setHighlighted({ source, tokens: highlight(source) });
      })
      .catch(() => {
        if (active) setHighlighted({ source, tokens: [] });
      });
    return () => { active = false; };
  }, [source]);
  const tokens = highlighted.source === source ? highlighted.tokens : [];
  useLayoutEffect(() => {
    if (!current || current.status === "loading") return;
    const frame = requestAnimationFrame(() => {
      const body = codeBodyRef.current;
      if (!body) {
        window.codyssey.fitDeclaration({ width: 360, height: 180 }).catch(() => {});
        return;
      }
      const code = body.parentElement;
      const style = getComputedStyle(code);
      const height = body.getBoundingClientRect().height +
        (code.querySelector(".popup-stale-message")?.getBoundingClientRect().height || 0) +
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const width = body.getBoundingClientRect().width + (height > 520 ? 18 : 0);
      window.codyssey.fitDeclaration({ width, height }).catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, [source, collapsed, current?.status, current?.line]);
  function toggleFold(id) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <div className="declaration-popup">
      <div className="popup-top-strip">
        {source && foldRanges.length > 0 && (
          <div className="popup-fold-actions">
            <button
              title={allFolded ? "Unfold all blocks" : "Fold all blocks"}
              aria-label={allFolded ? "Unfold all blocks" : "Fold all blocks"}
              onClick={() => setCollapsed(allFolded ? new Set() : new Set(foldRanges.map((range) => range.id)))}
            >
              {allFolded ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
            </button>
          </div>
        )}
        <div className="popup-window-actions">
          <div className="popup-info-wrap">
            <button className="popup-window-button" aria-label="Declaration information" aria-describedby="popup-information">
              <Info size={15} />
            </button>
            <div id="popup-information" className="popup-info-popover" role="tooltip">
              <span className="popup-info-kind">{target?.chain.at(-1).kind || "declaration"}</span>
              <strong>{target?.chain.map((part) => part.name).join(".") || "Loading…"}</strong>
              <span className="popup-info-path">{target?.path || ""}{current?.line ? `:${current.line}–${current.endLine}` : ""}</span>
              {current?.status === "found" && <span className="popup-info-status">Live</span>}
              {current?.status === "stale" && <span className="popup-info-status stale">Waiting for valid Python</span>}
            </div>
          </div>
          <button className="popup-window-button popup-close-button" aria-label="Close declaration window" title="Close" onClick={() => window.codyssey.closeDeclaration()}>
            <X size={15} />
          </button>
        </div>
      </div>
      {["found", "stale"].includes(current?.status) ? (
        <div className="popup-code" role="region" aria-label="Declaration source" style={{ "--popup-number-width": `${numberWidth}px` }}>
          {current?.status === "stale" && <div className="popup-stale-message">{current.message}</div>}
          <div className="popup-code-body" ref={codeBodyRef}>
          {lines.map((line, index) => {
            if (hiddenLines.has(index)) return null;
            const fold = foldByStart.get(index);
            return (
              <div className="popup-code-line" key={index}>
                <span className="popup-line-number">{current.line + index}</span>
                <button
                  className="popup-fold-toggle"
                  aria-label={fold ? (collapsed.has(fold.id) ? "Expand folded block" : "Collapse block") : undefined}
                  aria-expanded={fold ? !collapsed.has(fold.id) : undefined}
                  disabled={!fold}
                  onClick={() => toggleFold(fold.id)}
                >
                  {fold && (collapsed.has(fold.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />)}
                </button>
                <code>
                  {(tokens[index] || [{ text: line, kind: "plain" }]).map((token, part) => (
                    <span key={part} className={`syntax-${token.kind}`}>{token.text}</span>
                  ))}
                  {!line && " "}
                </code>
                {fold && collapsed.has(fold.id) && (
                  <span className="popup-fold-summary">… {fold.end - fold.start} lines</span>
                )}
              </div>
            );
          })}
          </div>
        </div>
      ) : (
        <div className="popup-message">{current?.message || "Loading declaration…"}</div>
      )}
    </div>
  );
}
