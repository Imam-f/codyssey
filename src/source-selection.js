// Read native text selection using rendered source rows, independent of token spans.
export function selectedSourceLines(root, selection = window.getSelection()) {
  if (!root || !selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const rows = [...root.querySelectorAll('.code-line[data-line]')];
  const selected = rows.filter((row) => {
    const content = row.querySelector('.line-content');
    if (!content) return false;
    const rowRange = document.createRange();
    rowRange.selectNodeContents(content);
    // Strict comparisons exclude a next row when selection ends at its start.
    return range.compareBoundaryPoints(Range.END_TO_START, rowRange) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, rowRange) > 0;
  });
  if (!selected.length) return null;
  return { start: Number(selected[0].dataset.line), end: Number(selected.at(-1).dataset.line), origin: 'text' };
}
