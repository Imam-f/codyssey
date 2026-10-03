import { useEffect, useMemo, useState } from "react";
import { marksStorageKey, parseMarks, resolveMarks } from "./marks";

export default function useMarks(repo, onError) {
  const key = repo ? marksStorageKey(repo.root) : null;
  const [saved, setSaved] = useState({ key: null, items: [] });

  useEffect(() => {
    let items = [];
    if (key) {
      try { items = parseMarks(localStorage.getItem(key)); }
      catch { onError("Saved marks could not be loaded. Local storage is unavailable."); }
    }
    setSaved({ key, items });
  }, [key, onError]);

  useEffect(() => {
    if (!key || saved.key !== key) return;
    try { localStorage.setItem(key, JSON.stringify(saved.items)); }
    catch { onError("Marks could not be saved. Local storage may be full or unavailable."); }
  }, [key, saved, onError]);

  const marks = useMemo(() => resolveMarks(
    saved.key === key ? saved.items : [], repo?.files || [],
  ), [saved, key, repo]);

  function toggleMark(path, line) {
    const file = repo?.files.find((file) => file.path === path);
    const lines = file?.source.split("\n");
    if (!Number.isSafeInteger(line) || line < 1 || !lines || line > lines.length) return;
    setSaved((prev) => {
      const items = prev.key === key ? prev.items : [];
      const exists = items.some((mark) => mark.path === path && mark.line === line);
      return { key, items: exists
        ? items.filter((mark) => mark.path !== path || mark.line !== line)
        : [...items, { path, line, note: "", preview: lines[line - 1].trim().slice(0, 240) }] };
    });
  }

  function removeMark(mark) {
    setSaved((prev) => prev.key !== key ? prev : ({ ...prev,
      items: prev.items.filter((item) => item.path !== mark.path || item.line !== mark.line),
    }));
  }

  function updateNote(mark, note) {
    setSaved((prev) => prev.key !== key ? prev : ({ ...prev,
      items: prev.items.map((item) => item.path === mark.path && item.line === mark.line
        ? { ...item, note: note.slice(0, 240) } : item),
    }));
  }

  return { marks, toggleMark, removeMark, updateNote };
}
