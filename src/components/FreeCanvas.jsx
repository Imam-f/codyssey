import { useEffect, useMemo, useRef, useState } from 'react';
import { MousePointer2, Hand, Square, Minus, ArrowUpRight, CornerDownRight, Type, Frame, Code2, Group, Ungroup, BringToFront, SendToBack, Trash2, Undo2, Redo2, Plus, ZoomIn, ZoomOut, Scan, X, ExternalLink } from 'lucide-react';
import { api, isDesktop } from '../util';
import { initHighlighter } from '../highlight';
import { applySnapshot, bounds, codeItem, connectorPath, connectorPoints, emptyCanvas, isConnector, reflectConnector, reshapeConnector, uid } from '../canvas-model';
import '../free-canvas.css';

const tools = [['select', MousePointer2, 'Select'], ['hand', Hand, 'Pan'], ['box', Square, 'Box'], ['line', Minus, 'Line'], ['arrow', ArrowUpRight, 'Arrow'], ['bend', CornerDownRight, 'Bend arrow'], ['text', Type, 'Text'], ['frame', Frame, 'Frame']];
const colors = ['#89b4a2', '#b4a4df', '#79b8e8', '#e9b872', '#e88a94', '#c5cbd3'];
const fonts = {
  sans: { label: 'Sans · Arial', family: 'Arial, Helvetica, sans-serif' },
  rounded: { label: 'Rounded · Trebuchet', family: '"Trebuchet MS", Arial, sans-serif' },
  serif: { label: 'Serif · Georgia', family: 'Georgia, "Times New Roman", serif' },
  mono: { label: 'Mono · Cascadia', family: '"Cascadia Code", Consolas, monospace' },
};
const storageKey = (repo) => `codyssey:canvas:v1:${repo.root}`;
function readCanvas(repo) {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(repo)));
    if (Array.isArray(value?.items) && value.sources && value.viewport && Number.isFinite(value.viewport.zoom)) return value;
  } catch { /* Use an empty canvas if storage is unavailable. */ }
  return emptyCanvas();
}
function CodeContent({ item, marks, onToggleMark, onSourceLocation }) {
  const [highlighted, setHighlighted] = useState({ source: null, tokens: [] });
  useEffect(() => {
    let active = true;
    initHighlighter().then((highlight) => { if (active) setHighlighted({ source: item.source, tokens: highlight(item.source, item.language) }); }).catch(() => {});
    return () => { active = false; };
  }, [item.source, item.language]);
  return <div className="canvas-code-body" onPointerDown={(e) => e.stopPropagation()}>
    {item.message && <div className="canvas-tracking-message">{item.message}</div>}
    {item.source.split('\n').map((line, index) => {
      const lineNumber = item.target.line + index;
      const mark = marks.find((mark) => mark.path === item.target.path && mark.line === lineNumber);
      const location = { path: item.target.path, line: lineNumber };
      return <div className="canvas-code-line" key={index} onClick={() => onSourceLocation(location)}>
      <button className={`canvas-mark-toggle ${mark ? 'is-marked' : ''}`} aria-label={`${mark ? 'Remove' : 'Add'} mark at ${item.target.path}:${lineNumber}`} aria-pressed={Boolean(mark)} title={mark?.note || `Toggle mark at ${item.target.path}:${lineNumber}`} onClick={() => onToggleMark(item.target.path, lineNumber)}><span className="mark-dot" /></button>
      <span>{lineNumber}</span><code>
      {(highlighted.source === item.source ? highlighted.tokens[index] : null)?.map((token, part) => <span key={part} className={`syntax-${token.kind}`}>{token.text}</span>) || line || ' '}
    </code></div>;
    })}
  </div>;
}

export default function FreeCanvas({ repo, active, onNavigate, request, marks, onToggleMark, onSourceLocation, marksPanel }) {
  const [doc, setDoc] = useState(() => readCanvas(repo));
  const docRef = useRef(doc); docRef.current = doc;
  const [selection, setSelection] = useState([]);
  const [tool, setTool] = useState('select');
  const [style, setStyle] = useState({ color: colors[0], thickness: 2, fontFamily: 'sans', fontWeight: 400 });
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('function');
  const [filePath, setFilePath] = useState(repo.files[0]?.path || '');
  const [start, setStart] = useState(1), [end, setEnd] = useState(1);
  const [message, setMessage] = useState('');
  const [marquee, setMarquee] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [watchVersion, setWatchVersion] = useState(0);
  const history = useRef({ past: [], future: [] });
  const gesture = useRef(null), surface = useRef(null), seenRequest = useRef(null);
  const selected = doc.items.filter((item) => selection.includes(item.id));
  const selectedBounds = selected.length ? bounds(selected) : null;
  const single = selected.length === 1 ? selected[0] : null;
  const watchPaths = [...new Set(doc.items.filter((item) => item.type === 'code').map((item) => item.target.path))].sort();
  const watchKey = JSON.stringify(watchPaths);

  useEffect(() => {
    const save = () => {
      try { localStorage.setItem(storageKey(repo), JSON.stringify(docRef.current)); }
      catch { /* The debounced save reports storage failures in the UI. */ }
    };
    window.addEventListener('beforeunload', save);
    return () => { save(); window.removeEventListener('beforeunload', save); };
  }, [repo.root]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(storageKey(repo), JSON.stringify(doc)); }
      catch { setMessage('Canvas could not be saved. Local storage may be full.'); }
    }, 300);
    return () => clearTimeout(timer);
  }, [doc, repo.root]);
  useEffect(() => {
    if (!isDesktop) return;
    const unsubscribe = api.onCanvasUpdate((snapshot) => setDoc((previous) => applySnapshot(previous, snapshot.path, snapshot)));
    api.watchCanvas(watchPaths.map((path) => ({ path, source: docRef.current.sources[path] || '' }))).catch((error) => setMessage(error.message));
    return unsubscribe;
  }, [watchKey, repo, watchVersion]);
  useEffect(() => {
    // A browser preview follows the supplied sample index on refresh.
    if (isDesktop) return;
    setDoc((previous) => ({ ...previous, items: previous.items.map((item) => {
      if (item.type !== 'code' || !item.target.chain) return item;
      const file = repo.files.find((file) => file.path === item.target.path);
      const symbol = file?.symbols.find((symbol) => {
        if (!['class', 'function'].includes(symbol.kind)) return false;
        return JSON.stringify(codeItem(file, symbol).target.chain) === JSON.stringify(item.target.chain);
      });
      return symbol ? { ...item, source: codeItem(file, symbol).source, target: codeItem(file, symbol).target } : item;
    }) }));
  }, [repo]);
  useEffect(() => {
    if (!request || request.id === seenRequest.current) return;
    seenRequest.current = request.id;
    addCode(request.file, request.symbol, request.start, request.end);
  }, [request]);

  function checkpoint() {
    history.current.past.push(docRef.current);
    if (history.current.past.length > 60) history.current.past.shift();
    history.current.future = []; setHistoryVersion((value) => value + 1);
  }
  function undo(redo = false) {
    const from = redo ? history.current.future : history.current.past;
    const to = redo ? history.current.past : history.current.future;
    if (!from.length) return;
    to.push(docRef.current);
    const restored = from.pop();
    setDoc((previous) => ({ ...restored, viewport: previous.viewport })); setSelection([]); setHistoryVersion((value) => value + 1); setWatchVersion((value) => value + 1);
  }
  function changeSelected(patch) {
    checkpoint();
    setDoc((previous) => ({ ...previous, items: previous.items.map((item) => selection.includes(item.id) ? { ...item, ...patch } : item) }));
  }
  function point(event) {
    const rect = surface.current.getBoundingClientRect(), view = docRef.current.viewport;
    return { x: (event.clientX - rect.left - view.x) / view.zoom, y: (event.clientY - rect.top - view.y) / view.zoom };
  }
  function center() {
    const view = docRef.current.viewport, rect = surface.current?.getBoundingClientRect();
    return { x: ((rect?.width || 800) / 2 - view.x) / view.zoom - 230, y: ((rect?.height || 600) / 2 - view.y) / view.zoom - 140 };
  }
  function addCode(file, symbol, first = 1, last = first) {
    if (!file) return;
    let item = codeItem(file, symbol, first, last);
    const currentSource = docRef.current.sources[file.path];
    if (currentSource !== undefined) {
      const declaration = symbol && docRef.current.declarations?.[file.path]?.find((entry) => JSON.stringify(entry.chain) === JSON.stringify(item.target.chain));
      if (declaration) item.target = { ...item.target, line: declaration.line, endLine: declaration.endLine };
      item.source = currentSource.split('\n').slice(item.target.line - 1, item.target.endLine).join('\n');
    }
    item = { ...item, ...center() };
    checkpoint();
    setDoc((previous) => ({ ...previous, items: [...previous.items, item], sources: { ...previous.sources, [file.path]: previous.sources[file.path] ?? file.source } }));
    setSelection([item.id]); setPicker(false); setTool('select');
  }
  function expanded(ids, items = docRef.current.items, includeFrames = true) {
    const groups = new Set(items.filter((item) => ids.includes(item.id) && item.group).map((item) => item.group));
    const frames = includeFrames ? items.filter((item) => ids.includes(item.id) && item.type === 'frame') : [];
    return items.filter((item) => ids.includes(item.id) || (item.group && groups.has(item.group)) || frames.some((frame) => item.x >= frame.x && item.y >= frame.y && item.x + item.w <= frame.x + frame.w && item.y + item.h <= frame.y + frame.h)).map((item) => item.id);
  }
  function beginConnector(event, handle) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    surface.current.focus(); surface.current.setPointerCapture(event.pointerId);
    checkpoint();
    gesture.current = { type: 'connector', handle, item: single, points: connectorPoints(single), p: point(event) };
  }
  function moveConnectorHandle(item, handle, destination) {
    const points = connectorPoints(item);
    points[handle] = destination;
    return reshapeConnector(item, points, handle === 'middle' || Boolean(item.bendPoint));
  }
  function begin(event, item = null, resize = false, moveSelection = false) {
    if (event.target.closest('button,input,textarea,select') && !resize) return;
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault(); event.stopPropagation();
    surface.current.focus(); surface.current.setPointerCapture(event.pointerId);
    const p = point(event), original = docRef.current;
    if (tool === 'hand' || event.button === 1 || event.altKey) {
      gesture.current = { type: 'pan', x: event.clientX, y: event.clientY, view: original.viewport }; return;
    }
    if (tool !== 'select' && !resize) item = null;
    if (item || resize || moveSelection) {
      let ids = resize || moveSelection ? selection : expanded([item.id], original.items, false);
      if (!resize && !moveSelection && event.shiftKey) {
        const next = selection.includes(item.id) ? selection.filter((id) => !ids.includes(id)) : [...new Set([...selection, ...ids])];
        setSelection(next); return;
      }
      if (!resize && !moveSelection && selection.includes(item.id)) ids = expanded(selection, original.items, false);
      setSelection(ids); checkpoint();
      const movingIds = resize ? ids : expanded(ids);
      const moving = original.items.filter((node) => movingIds.includes(node.id));
      gesture.current = { type: resize ? 'resize' : 'move', p, items: original.items, ids: movingIds, bounds: bounds(moving) }; return;
    }
    if (tool === 'select') {
      if (!event.shiftKey) setSelection([]);
      gesture.current = { type: 'marquee', p, selection: event.shiftKey ? selection : [] }; setMarquee({ x: p.x, y: p.y, w: 0, h: 0 }); return;
    }
    checkpoint();
    const itemToAdd = { id: uid(), type: tool, ...p, w: 1, h: 1, ...style, text: tool === 'frame' ? 'Frame' : tool === 'text' ? 'Text' : '', bend: 0.5 };
    setDoc((previous) => ({ ...previous, items: tool === 'frame' ? [itemToAdd, ...previous.items] : [...previous.items, itemToAdd] }));
    setSelection([itemToAdd.id]); gesture.current = { type: 'draw', p, id: itemToAdd.id };
  }
  function beginSelection(event) {
    if (!event.shiftKey) { begin(event, null, false, true); return; }
    // Shift+click still reaches the item underneath the group drag area.
    const hit = document.elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest('.canvas-item'))
      .find((element) => element && surface.current.contains(element));
    const item = docRef.current.items.find((item) => item.id === hit?.dataset.canvasId);
    begin(event, item || null);
  }
  function move(event) {
    const action = gesture.current;
    if (!action) return;
    const p = point(event), dx = p.x - action.p?.x, dy = p.y - action.p?.y;
    if (action.type === 'pan') {
      setDoc((previous) => ({ ...previous, viewport: { ...action.view, x: action.view.x + event.clientX - action.x, y: action.view.y + event.clientY - action.y } })); return;
    }
    if (action.type === 'marquee') { setMarquee({ x: Math.min(action.p.x, p.x), y: Math.min(action.p.y, p.y), w: Math.abs(dx), h: Math.abs(dy) }); return; }
    if (action.type === 'connector') {
      const original = action.points[action.handle];
      const changed = moveConnectorHandle(action.item, action.handle, { x: original.x + dx, y: original.y + dy });
      setDoc((previous) => ({ ...previous, items: previous.items.map((item) => item.id === changed.id ? changed : item) })); return;
    }
    if (action.type === 'draw') {
      setDoc((previous) => ({ ...previous, items: previous.items.map((item) => item.id === action.id ? { ...item, x: Math.min(action.p.x, p.x), y: Math.min(action.p.y, p.y), w: Math.max(1, Math.abs(dx)), h: Math.max(1, Math.abs(dy)), flipX: dx < 0, flipY: dy < 0 } : item) })); return;
    }
    const box = action.bounds;
    const sx = Math.max(24, box.w + dx) / Math.max(1, box.w), sy = Math.max(24, box.h + dy) / Math.max(1, box.h);
    setDoc((previous) => ({ ...previous, items: previous.items.map((current) => {
      const item = action.items.find((original) => original.id === current.id);
      if (!item || !action.ids.includes(item.id)) return current;
      return action.type === 'move' ? { ...current, x: item.x + dx, y: item.y + dy } :
        { ...current, x: box.x + (item.x - box.x) * sx, y: box.y + (item.y - box.y) * sy, w: item.w * sx, h: item.h * sy };
    }) }));
  }
  function finish() {
    const action = gesture.current;
    if (action?.type === 'marquee' && marquee) {
      const enclosed = (item) => marquee.w > 0 && marquee.h > 0 && item.x >= marquee.x && item.y >= marquee.y && item.x + item.w <= marquee.x + marquee.w && item.y + item.h <= marquee.y + marquee.h;
      const outsideGroups = new Set(docRef.current.items.filter((item) => item.group && !enclosed(item)).map((item) => item.group));
      const ids = docRef.current.items.filter((item) => enclosed(item) && !outsideGroups.has(item.group)).map((item) => item.id);
      setSelection([...new Set([...action.selection, ...ids])]);
    }
    if (action?.type === 'draw') {
      setDoc((previous) => ({ ...previous, items: previous.items.map((item) => item.id === action.id && item.w < 5 && item.h < 5 ? { ...item, w: item.type === 'frame' ? 560 : 220, h: item.type === 'text' ? 70 : isConnector(item) ? 80 : 160 } : item) }));
      setTool('select');
    }
    gesture.current = null; setMarquee(null);
  }
  function remove() {
    if (!selection.length) return;
    checkpoint(); setDoc((previous) => ({ ...previous, items: previous.items.filter((item) => !selection.includes(item.id)) })); setSelection([]);
  }
  function group() { if (selected.length > 1) changeSelected({ group: uid() }); }
  function changeLayer(front) {
    if (!selection.length) return;
    const ids = new Set(expanded(selection));
    const items = docRef.current.items;
    const moving = items.filter((item) => ids.has(item.id));
    const remaining = items.filter((item) => !ids.has(item.id));
    const reordered = front ? [...remaining, ...moving] : [...moving, ...remaining];
    if (reordered.every((item, index) => item === items[index])) return;
    checkpoint();
    setDoc((previous) => ({ ...previous, items: reordered }));
  }
  function frameSelection() {
    if (!selectedBounds) { setTool('frame'); return; }
    checkpoint(); const box = selectedBounds;
    const frame = { id: uid(), type: 'frame', x: box.x - 24, y: box.y - 42, w: box.w + 48, h: box.h + 66, text: 'Frame', ...style };
    setDoc((previous) => ({ ...previous, items: [frame, ...previous.items] })); setSelection([frame.id]);
  }
  function zoom(factor) {
    setDoc((previous) => {
      const view = previous.viewport, rect = surface.current.getBoundingClientRect();
      const next = Math.min(3, Math.max(0.2, view.zoom * factor)), ratio = next / view.zoom;
      return { ...previous, viewport: { zoom: next, x: rect.width / 2 - (rect.width / 2 - view.x) * ratio, y: rect.height / 2 - (rect.height / 2 - view.y) * ratio } };
    });
  }
  function fit() {
    if (!doc.items.length) return;
    const box = bounds(doc.items), rect = surface.current.getBoundingClientRect();
    const zoom = Math.min(1.5, Math.max(0.2, Math.min((rect.width - 80) / Math.max(1, box.w), (rect.height - 80) / Math.max(1, box.h))));
    setDoc((previous) => ({ ...previous, viewport: { zoom, x: (rect.width - box.w * zoom) / 2 - box.x * zoom, y: (rect.height - box.h * zoom) / 2 - box.y * zoom } }));
  }
  useEffect(() => {
    if (!active) return;
    const keydown = (event) => {
      if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); }
      if (event.key === 'Escape') { setPicker(false); setSelection([]); setTool('select'); }
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'z') { event.preventDefault(); undo(event.shiftKey); }
        if (key === 'y') { event.preventDefault(); undo(true); }
        if (key === 'g') { event.preventDefault(); event.shiftKey ? changeSelected({ group: null }) : group(); }
        if (key === 'a') { event.preventDefault(); setSelection(doc.items.map((item) => item.id)); }
        if (event.code === 'BracketRight' && event.shiftKey) { event.preventDefault(); changeLayer(true); }
        if (event.code === 'BracketLeft' && event.shiftKey) { event.preventDefault(); changeLayer(false); }
      }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });
  const candidates = useMemo(() => repo.files.flatMap((file) => file.symbols.filter((symbol) => symbol.kind === kind).map((symbol) => ({ file, symbol }))).filter(({ file, symbol }) => `${file.path} ${symbol.scopeName} ${symbol.name}`.toLowerCase().includes(query.toLowerCase())), [repo, kind, query]);
  const indexedRangeFile = repo.files.find((file) => file.path === filePath);
  const rangeFile = indexedRangeFile && { ...indexedRangeFile, source: doc.sources[filePath] ?? indexedRangeFile.source };
  const rangeValid = rangeFile && Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= rangeFile.source.split('\n').length;

  return <div className="free-canvas" data-history-version={historyVersion}>
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
      {tools.map(([id, Icon, label]) => <button key={id} className={tool === id ? 'active' : ''} aria-label={label} title={label} aria-pressed={tool === id} onClick={() => setTool(id)}><Icon size={16} /></button>)}
      <span className="canvas-divider" />
      <button onClick={() => setPicker(true)}><Code2 size={15} />Add code</button>
      <button aria-label="Group selection" title="Group · Ctrl+G" disabled={selected.length < 2} onClick={group}><Group size={15} /></button>
      <button aria-label="Ungroup selection" disabled={!selected.some((item) => item.group)} onClick={() => changeSelected({ group: null })}><Ungroup size={15} /></button>
      <button aria-label="Frame selection" title="Frame selection" onClick={frameSelection}><Frame size={15} /><Plus size={10} /></button>
      <button aria-label="Bring to front" title="Bring to front · Ctrl+Shift+]" disabled={!selected.length} onClick={() => changeLayer(true)}><BringToFront size={15} /></button>
      <button aria-label="Send to back" title="Send to back · Ctrl+Shift+[" disabled={!selected.length} onClick={() => changeLayer(false)}><SendToBack size={15} /></button>
      <button aria-label="Delete selection" disabled={!selection.length} onClick={remove}><Trash2 size={15} /></button>
      <span className="canvas-divider" />
      <button aria-label="Undo canvas change" disabled={!history.current.past.length} onClick={() => undo()}><Undo2 size={15} /></button>
      <button aria-label="Redo canvas change" disabled={!history.current.future.length} onClick={() => undo(true)}><Redo2 size={15} /></button>
    </div>
    <div className="canvas-workarea">
      <div ref={surface} className={`canvas-surface tool-${tool}`} role="region" aria-label="Free canvas" tabIndex={0}
        onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
        onWheel={(event) => { if (event.ctrlKey || event.metaKey) zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); else setDoc((previous) => ({ ...previous, viewport: { ...previous.viewport, x: previous.viewport.x - event.deltaX, y: previous.viewport.y - event.deltaY } })); }}>
        <div className="canvas-world" style={{ transform: `translate(${doc.viewport.x}px, ${doc.viewport.y}px) scale(${doc.viewport.zoom})` }}>
          {doc.items.map((item) => {
            const connector = isConnector(item);
            const path = connector ? connectorPath(item) : null;
            return <div key={item.id} data-canvas-id={item.id} data-type={item.type} className={`canvas-item canvas-${item.type} ${selection.includes(item.id) ? 'selected' : ''}`}
              style={{ left: item.x, top: item.y, width: item.w, height: item.h, '--item-color': item.color, '--item-thickness': `${item.thickness}px` }} onPointerDown={connector ? undefined : (event) => begin(event, item)}>
              {connector ? <svg width={item.w} height={item.h} style={{ overflow: 'visible', pointerEvents: 'none' }}>
                <defs><marker id={`tip-${item.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={item.color} strokeWidth="1.5" /></marker></defs>
                <path d={path} fill="none" stroke="transparent" strokeWidth={Math.max(12 / doc.viewport.zoom, item.thickness + 4 / doc.viewport.zoom)} className="canvas-connector-hit" onPointerDown={(event) => begin(event, item)} />
                <path d={path} fill="none" stroke={item.color} strokeWidth={item.thickness} markerEnd={item.type !== 'line' ? `url(#tip-${item.id})` : undefined} pointerEvents="none" />
              </svg> : item.type === 'code' ? <>
                <div className="canvas-code-header"><Code2 size={13} /><strong>{item.title}</strong><span className={`canvas-live ${item.status !== 'found' ? 'stale' : ''}`}>{item.status === 'found' ? isDesktop ? 'Live' : 'Indexed' : item.status}</span><button aria-label={`Open source for ${item.title}`} onClick={() => onNavigate({ path: item.target.path, line: item.target.line })}><ExternalLink size={12} /></button></div>
                <div className="canvas-code-location">{item.target.path}:{item.target.line}–{item.target.endLine}</div><CodeContent item={item} marks={marks} onToggleMark={onToggleMark} onSourceLocation={onSourceLocation} />
              </> : item.type === 'frame' ? <span className="canvas-frame-title">{item.text || 'Frame'}</span> : <div className="canvas-item-text" style={{ fontSize: item.fontSize || 18, fontFamily: (fonts[item.fontFamily] || fonts.sans).family, fontWeight: item.fontWeight || 400 }}>{item.text}</div>}
            </div>;
          })}
          {selectedBounds && !(single && isConnector(single)) && <div className={`canvas-selection ${selected.length > 1 ? 'canvas-selection-multiple' : ''}`} style={{ left: selectedBounds.x - 4, top: selectedBounds.y - 4, width: selectedBounds.w + 8, height: selectedBounds.h + 8 }} onPointerDown={selected.length > 1 ? beginSelection : undefined}><button className="canvas-resize" aria-label="Resize selection" onPointerDown={(event) => begin(event, null, true)} /></div>}
          {single && isConnector(single) && Object.entries(connectorPoints(single)).filter(([handle]) => handle !== 'middle' || single.type === 'bend').map(([handle, point]) => <button
            key={handle} className={`canvas-point-handle ${handle === 'middle' ? 'canvas-bend-handle' : ''}`}
            aria-label={handle === 'middle' ? 'Move arrow curve point' : `Move ${single.type === 'line' ? 'line' : 'arrow'} ${handle} point`}
            title={handle === 'middle' ? 'Drag to curve the arrow' : `Drag ${handle} point`}
            style={{ left: point.x, top: point.y, transform: `translate(-50%, -50%) scale(${1 / doc.viewport.zoom})` }}
            onPointerDown={(event) => beginConnector(event, handle)}
            onKeyDown={(event) => {
              const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
              if (!delta) return;
              event.preventDefault(); event.stopPropagation();
              const distance = event.shiftKey ? 10 : 1;
              changeSelected(moveConnectorHandle(single, handle, { x: point.x + delta[0] * distance, y: point.y + delta[1] * distance }));
            }} />)}
          {marquee && <div className="canvas-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>
        {!doc.items.length && <div className="canvas-empty"><Frame size={30} /><h2>Your code, in context</h2><p>Add a class, function, or a few lines. Draw connections and organize your ideas.</p><button className="primary" onClick={() => setPicker(true)}><Code2 size={14} />Add your first code block</button></div>}
        <div className="canvas-hint">Drag to draw · Shift+click to select more · Alt+drag to pan</div>
        <div className="canvas-zoom"><button aria-label="Zoom out canvas" onClick={() => zoom(1 / 1.2)}><ZoomOut size={14} /></button><span>{Math.round(doc.viewport.zoom * 100)}%</span><button aria-label="Zoom in canvas" onClick={() => zoom(1.2)}><ZoomIn size={14} /></button><button aria-label="Fit canvas" onClick={fit}><Scan size={14} /></button></div>
      </div>
      <aside className="canvas-properties" aria-label="Canvas properties">
        <div className="canvas-properties-content">
        <h3>{selected.length ? `${selected.length} selected` : 'Drawing style'}</h3>
        <label>Color<input type="color" aria-label="Canvas color" value={single?.color || style.color} onChange={(event) => { setStyle((value) => ({ ...value, color: event.target.value })); if (selected.length) changeSelected({ color: event.target.value }); }} /></label>
        <div className="canvas-swatches">{colors.map((color) => <button key={color} aria-label={`Use color ${color}`} style={{ background: color }} onClick={() => { setStyle((value) => ({ ...value, color })); if (selected.length) changeSelected({ color }); }} />)}</div>
        {single?.type !== 'text' && <label>Thickness<input type="number" min="1" max="16" aria-label="Canvas thickness" value={single?.thickness || style.thickness} onChange={(event) => { const thickness = Math.min(16, Math.max(1, Number(event.target.value))); setStyle((value) => ({ ...value, thickness })); if (selected.length) changeSelected({ thickness }); }} /></label>}
        {single && <>
          <div className="canvas-property-grid">{['x', 'y', 'w', 'h'].map((key) => <label key={key}>{({ x: 'X', y: 'Y', w: 'Width', h: 'Height' })[key]}<input aria-label={`Canvas ${key}`} type="number" value={Math.round(single[key])} onChange={(event) => changeSelected({ [key]: key === 'w' || key === 'h' ? Math.max(1, Number(event.target.value)) : Number(event.target.value) })} /></label>)}</div>
          {single.type !== 'code' && !isConnector(single) && <label className="canvas-text-property">{single.type === 'frame' ? 'Frame name' : 'Text'}<textarea aria-label="Canvas text" value={single.text || ''} onChange={(event) => changeSelected({ text: event.target.value })} /></label>}
          {['text', 'box'].includes(single.type) && <>
            <label>Font<select aria-label="Canvas font" value={fonts[single.fontFamily] ? single.fontFamily : 'sans'} onChange={(event) => { const fontFamily = event.target.value; setStyle((value) => ({ ...value, fontFamily })); changeSelected({ fontFamily }); }}>{Object.entries(fonts).map(([key, font]) => <option key={key} value={key}>{font.label}</option>)}</select></label>
            <label>Weight<select aria-label="Canvas font weight" value={single.fontWeight || 400} onChange={(event) => { const fontWeight = Number(event.target.value); setStyle((value) => ({ ...value, fontWeight })); changeSelected({ fontWeight }); }}><option value="400">Regular</option><option value="500">Medium</option><option value="700">Bold</option></select></label>
            <label>Font size<input type="number" min="8" max="120" aria-label="Canvas font size" value={single.fontSize || 18} onChange={(event) => changeSelected({ fontSize: Math.min(120, Math.max(8, Number(event.target.value))) })} /></label>
          </>}
          {isConnector(single) && <><button onClick={() => changeSelected(reflectConnector(single, 'x'))}>Reverse horizontal</button><button onClick={() => changeSelected(reflectConnector(single, 'y'))}>Reverse vertical</button><p className="canvas-property-note">Drag either endpoint to move it.{single.type === 'bend' && ' Drag the middle point to curve the arrow.'}</p></>}
          {single.type === 'code' && <p className="canvas-property-note">{isDesktop ? 'Follows saved edits to the source file. Edit code in your editor.' : 'Sample code updates when you refresh the index. Live file tracking is available in the desktop app.'}</p>}
        </>}
        <p className="canvas-property-note">Canvas layouts save automatically for this repository. Drag a frame to move the elements inside it.</p>
        {message && <div role="alert" className="canvas-tracking-message">{message}<button aria-label="Dismiss canvas message" onClick={() => setMessage('')}><X size={12} /></button></div>}
        </div>
        {marksPanel}
      </aside>
    </div>
    {picker && <div className="canvas-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setPicker(false); }}><section className="canvas-code-picker" role="dialog" aria-modal="true" aria-label="Add code to canvas">
      <header><h3>Add tracked code</h3><button aria-label="Close code picker" onClick={() => setPicker(false)}><X size={16} /></button></header>
      <div className="canvas-picker-tabs">{[['class', 'Whole class'], ['function', 'Whole function'], ['lines', 'Code lines']].map(([value, label]) => <button key={value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{label}</button>)}</div>
      {kind === 'lines' ? <div className="canvas-range-picker"><label>File<select aria-label="Code file" value={filePath} onChange={(event) => { setFilePath(event.target.value); setStart(1); setEnd(1); }}>{repo.files.map((file) => <option key={file.path}>{file.path}</option>)}</select></label>
        <div><label>From line<input aria-label="From line" type="number" min="1" value={start} onChange={(event) => setStart(Number(event.target.value))} /></label><label>To line<input aria-label="To line" type="number" min="1" value={end} onChange={(event) => setEnd(Number(event.target.value))} /></label></div>
        <pre>{rangeValid ? rangeFile.source.split('\n').slice(start - 1, end).join('\n') : 'Choose a valid line range.'}</pre><button className="primary" disabled={!rangeValid} onClick={() => addCode(rangeFile, null, start, end)}>Add line range</button></div> : <>
        <input autoFocus aria-label="Search canvas declarations" placeholder="Search by name or file…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="canvas-declaration-list">{candidates.map(({ file, symbol }) => <button key={symbol.id} onClick={() => addCode(file, symbol)}><Code2 size={14} /><span><strong>{symbol.scopeName !== '<module>' ? `${symbol.scopeName}.` : ''}{symbol.name}</strong><small>{file.path}:{symbol.line}–{symbol.endLine}</small></span><Plus size={14} /></button>)}{!candidates.length && <p>No matching declarations.</p>}</div>
      </>}
    </section></div>}
  </div>;
}
