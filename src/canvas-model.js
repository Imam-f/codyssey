import { declarationTarget } from './declaration.js';

export const uid = () => crypto.randomUUID();
export const emptyCanvas = () => ({ items: [], sources: {}, viewport: { x: 48, y: 48, zoom: 1 } });
export const isConnector = (item) => ['line', 'arrow', 'bend'].includes(item.type);
export function connectorPoints(item) {
  const world = (point) => ({ x: item.x + point.x * item.w, y: item.y + point.y * item.h });
  const start = world(item.startPoint || { x: item.flipX ? 1 : 0, y: item.flipY ? 1 : 0 });
  const end = world(item.endPoint || { x: item.flipX ? 0 : 1, y: item.flipY ? 0 : 1 });
  const middle = item.bendPoint ? world(item.bendPoint) : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return { start, end, middle };
}
export function connectorPath(item) {
  const { start, end, middle } = connectorPoints(item);
  const local = (point) => `${point.x - item.x} ${point.y - item.y}`;
  if (item.type !== 'bend') return `M ${local(start)} L ${local(end)}`;
  // The draggable middle point lies on the curve at t=0.5.
  const control = { x: 2 * middle.x - (start.x + end.x) / 2, y: 2 * middle.y - (start.y + end.y) / 2 };
  return `M ${local(start)} Q ${local(control)} ${local(end)}`;
}
export function reshapeConnector(item, points, curved = Boolean(item.bendPoint)) {
  const visible = [points.start, points.end];
  if (item.type === 'bend' && curved) {
    visible.push(points.middle);
    const control = { x: 2 * points.middle.x - (points.start.x + points.end.x) / 2, y: 2 * points.middle.y - (points.start.y + points.end.y) / 2 };
    // Include curve extrema so selection, frames, and fit cover the entire arrow.
    for (const axis of ['x', 'y']) {
      const denominator = points.start[axis] - 2 * control[axis] + points.end[axis];
      const t = denominator ? (points.start[axis] - control[axis]) / denominator : -1;
      if (t > 0 && t < 1) visible.push({
        x: (1 - t) ** 2 * points.start.x + 2 * (1 - t) * t * control.x + t ** 2 * points.end.x,
        y: (1 - t) ** 2 * points.start.y + 2 * (1 - t) * t * control.y + t ** 2 * points.end.y,
      });
    }
  }
  const x = Math.min(...visible.map((point) => point.x)), y = Math.min(...visible.map((point) => point.y));
  const w = Math.max(1, Math.max(...visible.map((point) => point.x)) - x), h = Math.max(1, Math.max(...visible.map((point) => point.y)) - y);
  const normalized = (point) => ({ x: (point.x - x) / w, y: (point.y - y) / h });
  return { ...item, x, y, w, h, startPoint: normalized(points.start), endPoint: normalized(points.end),
    bendPoint: curved && item.type === 'bend' ? normalized(points.middle) : undefined };
}
export function reflectConnector(item, axis) {
  const points = connectorPoints(item);
  for (const point of Object.values(points)) point[axis] = axis === 'x' ? 2 * item.x + item.w - point.x : 2 * item.y + item.h - point.y;
  return reshapeConnector(item, points);
}
export function bounds(items) {
  const x = Math.min(...items.map((item) => item.x));
  const y = Math.min(...items.map((item) => item.y));
  return { x, y, w: Math.max(...items.map((item) => item.x + item.w)) - x,
    h: Math.max(...items.map((item) => item.y + item.h)) - y };
}
export function codeItem(file, symbol, start = 1, end = start) {
  const target = symbol ? declarationTarget(file, symbol) : { path: file.path, line: start };
  if (symbol) { start = symbol.line; end = symbol.endLine; }
  return { id: uid(), type: 'code', x: 0, y: 0, w: 460, h: Math.min(420, Math.max(150, (end - start + 1) * 19 + 70)),
    color: '#89b4a2', thickness: 1, language: file.language, target: { ...target, endLine: end },
    title: symbol ? target.chain.map((part) => part.name).join('.') : 'Code lines',
    source: file.source.split('\n').slice(start - 1, end).join('\n'), status: 'found' };
}

// Map the two boundaries independently. Edits within a selection expand/shrink it;
// insertions immediately before or after it stay outside the selection.
export function mapRange(start, end, changes) {
  function boundary(value, right) {
    let delta = 0;
    for (const [kind, a, b, c, d] of changes) {
      if (kind === 'equal') continue;
      if (value < a || (value === a && !right)) break;
      if (value >= b) { delta = d - b; continue; }
      return right ? c : d;
    }
    return value + delta;
  }
  return [boundary(start - 1, true) + 1, boundary(end, false)];
}
export function applySnapshot(doc, path, snapshot) {
  const items = doc.items.map((item) => {
    if (item.type !== 'code' || item.target.path !== path) return item;
    if (snapshot.status !== 'found') return { ...item, status: snapshot.status, message: snapshot.message };
    let start, end;
    if (item.target.chain) {
      const matches = snapshot.declarations.filter((symbol) => JSON.stringify(symbol.chain) === JSON.stringify(item.target.chain));
      const match = matches.sort((a, b) => Math.abs(a.line - item.target.line) - Math.abs(b.line - item.target.line))[0];
      if (!match) return { ...item, status: 'missing', message: 'Declaration removed or renamed; showing the last version.' };
      start = match.line; end = match.endLine;
    } else {
      if (item.status === 'missing') return item;
      [start, end] = mapRange(item.target.line, item.target.endLine, snapshot.changes);
      if (end < start) return { ...item, status: 'missing', message: 'Tracked lines were deleted; showing the last version.' };
    }
    return { ...item, target: { ...item.target, line: start, endLine: end },
      source: snapshot.source.split('\n').slice(start - 1, end).join('\n'), status: 'found', message: '' };
  });
  return { ...doc, items, sources: snapshot.status === 'found' ? { ...doc.sources, [path]: snapshot.source } : doc.sources,
    declarations: snapshot.status === 'found' ? { ...doc.declarations, [path]: snapshot.declarations } : doc.declarations };
}
