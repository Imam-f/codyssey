function indentWidth(line) {
  let width = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

export function computeFoldRanges(source) {
  const lines = source.split("\n");
  const isBlank = (line) => /^\s*$/.test(line);
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    if (isBlank(lines[i])) continue;
    const base = indentWidth(lines[i]);
    let next = i + 1;
    while (next < lines.length && isBlank(lines[next])) next++;
    if (next >= lines.length || indentWidth(lines[next]) <= base) continue;
    let end = next;
    while (end < lines.length) {
      if (!isBlank(lines[end]) && indentWidth(lines[end]) <= base) break;
      end++;
    }
    let last = end - 1;
    while (last > i && isBlank(lines[last])) last--;
    if (last > i) ranges.push({ start: i, end: last });
  }
  return ranges;
}
