import { useRef } from "react";

export default function Resizer({ orientation, onResize, label }) {
  const dragging = useRef(false);
  const last = useRef(0);
  const axis = orientation === "vertical" ? "clientX" : "clientY";
  const onPointerDown = (e) => {
    dragging.current = true;
    last.current = e[axis];
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    document.body.style.cursor =
      orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    const delta = e[axis] - last.current;
    last.current = e[axis];
    onResize(delta);
  };
  const stop = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {}
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
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
