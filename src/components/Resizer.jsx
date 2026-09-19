import { useRef } from "react";

export default function Resizer({
  orientation,
  onResize,
  label,
  targetRef,
  size,
  min = 0,
  max = Infinity,
  sign = 1,
}) {
  const drag = useRef(null);
  const frame = useRef(0);
  const latest = useRef(0);
  const axis = orientation === "vertical" ? "clientX" : "clientY";
  const dimension = orientation === "vertical" ? "width" : "height";

  const paint = () => {
    frame.current = 0;
    const el = targetRef?.current;
    if (el) el.style[dimension] = `${latest.current}px`;
  };
  const onPointerDown = (e) => {
    const el = targetRef?.current;
    const start =
      size ?? (el ? parseFloat(getComputedStyle(el)[dimension]) || 0 : 0);
    drag.current = { id: e.pointerId, origin: e[axis], size: start };
    latest.current = start;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    document.body.style.cursor =
      orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    const next = Math.min(
      max,
      Math.max(min, d.size + sign * (e[axis] - d.origin)),
    );
    if (next === latest.current) return;
    latest.current = next;
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };
  const stop = (e) => {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    drag.current = null;
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {}
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (latest.current !== d.size) onResize(latest.current);
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
