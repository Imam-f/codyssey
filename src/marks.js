export const marksStorageKey = (root) => `codyssey:marks:v1:${root}`;

export function parseMarks(value) {
  try {
    const data = JSON.parse(value);
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    return data.filter((mark) => {
      if (!mark || typeof mark.path !== "string" || !mark.path ||
          !Number.isSafeInteger(mark.line) || mark.line < 1) return false;
      const key = JSON.stringify([mark.path, mark.line]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(({ path, line, note, preview }) => ({
      path, line,
      note: typeof note === "string" ? note.slice(0, 240) : "",
      preview: typeof preview === "string" ? preview.slice(0, 240) : "",
    }));
  } catch {
    return [];
  }
}

export function resolveMarks(marks, files) {
  const markedPaths = new Set(marks.map((mark) => mark.path));
  const sources = new Map(files.filter((file) => markedPaths.has(file.path))
    .map((file) => [file.path, file.source.split("\n")]));
  return marks.map((mark) => {
    const lines = sources.get(mark.path);
    const available = Boolean(lines && mark.line <= lines.length);
    return { ...mark, available, preview: available ? lines[mark.line - 1].trim() : mark.preview };
  }).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

export function nextMark(marks, path, line, direction) {
  const available = marks.filter((mark) => mark.available);
  if (!available.length) return null;
  const compare = (mark) => mark.path.localeCompare(path) || mark.line - line;
  return direction > 0
    ? available.find((mark) => compare(mark) > 0) || available[0]
    : available.findLast((mark) => compare(mark) < 0) || available.at(-1);
}
