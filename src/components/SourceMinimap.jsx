import { useEffect, useRef, useState } from "react";

const COLORS = {
  plain: "#53606c",
  comment: "#47564f",
  keyword: "#887697",
  string: "#76886b",
  function: "#938d6f",
  type: "#678b88",
};

export default function SourceMinimap({
  file,
  path,
  tokens,
  sourceRef,
  viewport,
  line,
  setLine,
  selected,
  selectedId,
  referencesByLine,
  activeScope,
  diagnostics,
}) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const lines = file?.source.split("\n") || [];
  const lineCount = Math.max(1, file?.lines || lines.length);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const { width, height } = size;
    if (!canvas || !width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const topInset = 5;
    const bottomInset = 5;
    const drawHeight = Math.max(1, height - topInset - bottomInset);
    const yForLine = (lineNumber) =>
      topInset + ((lineNumber - 0.5) / lineCount) * drawHeight;

    if (activeScope) {
      const top = yForLine(activeScope.line);
      const bottom = yForLine(activeScope.endLine + 1);
      ctx.fillStyle = "rgba(137, 180, 162, 0.075)";
      ctx.fillRect(0, top, width, Math.max(2, bottom - top));
    }

    const maxChars = 92;
    const codeWidth = width - 12;
    const charWidth = codeWidth / maxChars;
    const rowHeight = Math.max(0.7, Math.min(1.5, drawHeight / lineCount - 0.25));
    lines.forEach((text, index) => {
      const trimmed = text.trimEnd();
      if (!trimmed.trim()) return;
      const indent = Math.min(28, trimmed.length - trimmed.trimStart().length);
      const length = Math.min(maxChars - indent, trimmed.length - indent);
      const kind = tokens[index]?.find((token) => token.text.trim())?.kind || "plain";
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = COLORS[kind] || COLORS.plain;
      ctx.fillRect(
        3 + indent * charWidth,
        yForLine(index + 1),
        Math.max(1.5, length * charWidth),
        rowHeight,
      );
    });
    ctx.globalAlpha = 1;

    const selectedLines = new Set();
    if (selectedId) {
      for (const [lineNumber, refs] of referencesByLine) {
        if (refs.some((ref) => ref.symbolId === selectedId)) {
          selectedLines.add(lineNumber);
        }
      }
      if (selected?.path === path && selected.line) selectedLines.add(selected.line);
    }
    ctx.fillStyle = "#b6a7df";
    for (const lineNumber of selectedLines) {
      ctx.fillRect(width - 7, yForLine(lineNumber) - 1, 5, 2);
    }

    ctx.fillStyle = "#d49a6a";
    for (const diagnostic of diagnostics) {
      if (diagnostic.path === path) {
        ctx.fillRect(width - 7, yForLine(diagnostic.line) - 1, 5, 2);
      }
    }

    const scrollHeight = Math.max(viewport.scrollHeight || 1, 1);
    const viewportTop =
      topInset + ((viewport.scrollTop || 0) / scrollHeight) * drawHeight;
    const viewportHeight = Math.max(
      18,
      ((viewport.clientHeight || scrollHeight) / scrollHeight) * drawHeight,
    );
    ctx.fillStyle = "rgba(166, 181, 192, 0.07)";
    ctx.strokeStyle = "rgba(166, 181, 192, 0.28)";
    ctx.lineWidth = 1;
    ctx.fillRect(0.5, viewportTop, width - 1, viewportHeight);
    ctx.strokeRect(0.5, viewportTop + 0.5, width - 1, viewportHeight - 1);

    const currentY = yForLine(line);
    ctx.fillStyle = "#9bc7b4";
    ctx.fillRect(0, currentY - 1, width, 2);
    ctx.fillStyle = "#d5eee2";
    ctx.fillRect(width - 7, currentY - 2, 7, 4);
  }, [
    activeScope,
    diagnostics,
    file,
    line,
    lines,
    path,
    referencesByLine,
    selected,
    selectedId,
    size,
    tokens,
    viewport,
  ]);

  function jumpToLine(nextLine) {
    const targetLine = Math.max(1, Math.min(lineCount, nextLine));
    const scroller = sourceRef.current;
    if (scroller) {
      const ratio = (targetLine - 0.5) / lineCount;
      const target = ratio * scroller.scrollHeight - scroller.clientHeight / 2;
      scroller.scrollTop = Math.max(
        0,
        Math.min(scroller.scrollHeight - scroller.clientHeight, target),
      );
    }
    setLine(targetLine);
  }

  function jumpFromPointer(event) {
    const rect = rootRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    jumpToLine(Math.round(ratio * (lineCount - 1)) + 1);
  }

  return (
    <div
      ref={rootRef}
      className="source-minimap"
      role="scrollbar"
      aria-label="Code minimap"
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={lineCount}
      aria-valuenow={line}
      aria-valuetext={`Line ${line} of ${lineCount}`}
      tabIndex={0}
      title="Code minimap · click or drag to jump"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        jumpFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          jumpFromPointer(event);
        }
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onKeyDown={(event) => {
        let nextLine = line;
        if (event.key === "ArrowUp") nextLine -= 1;
        else if (event.key === "ArrowDown") nextLine += 1;
        else if (event.key === "PageUp") nextLine -= 10;
        else if (event.key === "PageDown") nextLine += 10;
        else if (event.key === "Home") nextLine = 1;
        else if (event.key === "End") nextLine = lineCount;
        else return;
        event.preventDefault();
        jumpToLine(nextLine);
      }}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
