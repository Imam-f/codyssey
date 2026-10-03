import { useState } from "react";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, Pencil, X } from "lucide-react";
import { basename } from "../util";

export default function MarksPanel({ marks, path, line, canMark, onToggle, onNavigate, onTravel, onRemove, onNote }) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const currentMarked = marks.some((mark) => mark.path === path && mark.line === line);
  const groups = Map.groupBy(marks, (mark) => mark.path);
  const canTravel = marks.some((mark) => mark.available);

  function saveNote(mark) {
    onNote(mark, draft.trim());
    setEditing(null);
  }

  return (
    <section className="marks-section" aria-label="Marks">
      <div className="panel-heading marks-heading">
        <button className="marks-disclosure" aria-expanded={expanded} aria-controls="marks-list" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          MARKS <span className="marks-count">{marks.length}</span>
        </button>
        <div className="marks-actions">
          <button aria-label="Previous mark" title="Previous mark · Shift+F2" disabled={!canTravel} onClick={() => onTravel(-1)}><ArrowUp size={12} /></button>
          <button aria-label="Next mark" title="Next mark · F2" disabled={!canTravel} onClick={() => onTravel(1)}><ArrowDown size={12} /></button>
          <button className={`mark-current ${currentMarked ? "is-marked" : ""}`} aria-label="Toggle mark at current line" aria-pressed={currentMarked} title="Toggle mark at current line · F9" disabled={!canMark} onClick={onToggle}><span className="mark-dot" /></button>
        </div>
      </div>
      {expanded && <div className="marks-list" id="marks-list">
        {!marks.length && <p className="marks-empty">Keep a spot to return to.<br /><span>Click the source gutter or press <kbd>F9</kbd>.</span></p>}
        {[...groups].map(([filePath, items]) => <div className="marks-group" key={filePath}>
          <div className="marks-file" title={filePath}><span>{basename(filePath)}</span><small>{items.length}</small></div>
          {items.map((mark) => {
            const key = JSON.stringify([mark.path, mark.line]);
            const active = mark.path === path && mark.line === line;
            return <div className={`mark-row ${active ? "active" : ""}`} key={key}>
              <div className="mark-row-main">
                <button className="mark-location" disabled={!mark.available} title={`${mark.path}:${mark.line}${mark.available ? `\n${mark.note || mark.preview}` : " · Location unavailable; re-index or remove this mark"}`} aria-label={`Go to mark ${mark.path}:${mark.line}`} aria-current={active ? "location" : undefined} onClick={() => onNavigate(mark)}>
                  <span className="mark-dot" /><span className="mark-line">{mark.line}</span><span className="mark-label">{mark.note || mark.preview || "Blank line"}</span>
                </button>
                <button className="mark-edit" aria-label={`Edit note for ${mark.path}:${mark.line}`} title="Edit mark note" onClick={() => { setEditing(key); setDraft(mark.note); }}><Pencil size={11} /></button>
                <button className="mark-remove" aria-label={`Remove mark ${mark.path}:${mark.line}`} title="Remove mark" onClick={() => onRemove(mark)}><X size={12} /></button>
              </div>
              {!mark.available && <small className="mark-unavailable">Location unavailable</small>}
              {editing === key && <form className="mark-note" onSubmit={(event) => { event.preventDefault(); saveNote(mark); }}>
                <input autoFocus aria-label={`Note for ${mark.path}:${mark.line}`} placeholder="Add a note…" maxLength={240} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setEditing(null); } }} />
                <button type="submit">Save</button>
                <button type="button" aria-label="Cancel note editing" onClick={() => setEditing(null)}><X size={11} /></button>
              </form>}
            </div>;
          })}
        </div>)}
      </div>}
    </section>
  );
}
