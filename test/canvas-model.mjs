import assert from 'node:assert/strict';
import { mapRange, applySnapshot, bounds, connectorPoints, connectorPath, reshapeConnector, reflectConnector } from '../src/canvas-model.js';

assert.deepEqual(mapRange(3, 4, [['insert', 0, 0, 0, 2], ['equal', 0, 6, 2, 8]]), [5, 6]);
assert.deepEqual(mapRange(3, 4, [['equal', 0, 3, 0, 3], ['insert', 3, 3, 3, 5], ['equal', 3, 6, 5, 8]]), [3, 6]);
assert.deepEqual(mapRange(3, 4, [['equal', 0, 2, 0, 2], ['replace', 2, 4, 2, 5], ['equal', 4, 6, 5, 7]]), [3, 5]);
assert.deepEqual(mapRange(3, 4, [['equal', 0, 2, 0, 2], ['delete', 2, 4, 2, 2], ['equal', 4, 6, 2, 4]]), [3, 2]);
assert.deepEqual(mapRange(3, 4, [['equal', 0, 2, 0, 2], ['insert', 2, 2, 2, 3], ['equal', 2, 6, 3, 7]]), [4, 5]);
assert.deepEqual(mapRange(3, 4, [['equal', 0, 4, 0, 4], ['insert', 4, 4, 4, 5], ['equal', 4, 6, 5, 7]]), [3, 4]);
const chain = [{ kind: 'class', name: 'Example' }, { kind: 'function', name: 'run' }];
const original = { items: [
  { id: 'method', type: 'code', x: 10, y: 20, w: 200, h: 100, target: { path: 'example.py', chain, line: 2, endLine: 3 }, source: '    def run(self):\n        return 1' },
  { id: 'lines', type: 'code', target: { path: 'example.py', line: 3, endLine: 3 }, source: '        return 1' },
], sources: { 'example.py': 'class Example:\n    def run(self):\n        return 1' } };
const changed = applySnapshot(original, 'example.py', { status: 'found', source: '# heading\nclass Example:\n    def run(self):\n        return 2', declarations: [{ chain, line: 3, endLine: 4 }], changes: [['insert', 0, 0, 0, 1], ['equal', 0, 2, 1, 3], ['replace', 2, 3, 3, 4]] });
assert.equal(changed.items[0].target.line, 3);
assert.equal(changed.items[1].target.line, 4);
assert.match(changed.items[1].source, /return 2/);
assert.deepEqual(bounds([changed.items[0]]), { x: 10, y: 20, w: 200, h: 100 });
const stale = applySnapshot(changed, 'example.py', { status: 'stale', message: 'invalid' });
assert.equal(stale.items[0].source, changed.items[0].source);
assert.equal(stale.sources['example.py'], changed.sources['example.py']);
const deleted = applySnapshot(changed, 'example.py', { status: 'found', source: '', declarations: [], changes: [['delete', 0, 4, 0, 0]] });
assert.ok(deleted.items.every((item) => item.status === 'missing'));
assert.equal(deleted.items[0].source, changed.items[0].source);
console.log('Canvas range mapping and tracking checks passed.');

const straight = { type: 'bend', x: 20, y: 30, w: 160, h: 0 };
assert.equal(connectorPath(straight), 'M 0 0 Q 80 0 160 0');
const endpoints = connectorPoints(straight);
const curved = reshapeConnector(straight, { ...endpoints, middle: { x: 100, y: -40 } }, true);
assert.deepEqual(connectorPoints(curved), { start: { x: 20, y: 30 }, end: { x: 180, y: 30 }, middle: { x: 100, y: -40 } });
assert.equal(connectorPath(curved), 'M 0 70 Q 80 -70 160 70');
const crossed = reshapeConnector(curved, { ...connectorPoints(curved), end: { x: -80, y: 30 } });
assert.deepEqual(connectorPoints(crossed).start, { x: 20, y: 30 });
assert.deepEqual(connectorPoints(crossed).end, { x: -80, y: 30 });
const reflected = reflectConnector(reflectConnector(curved, 'x'), 'x');
assert.deepEqual(connectorPoints(reflected), connectorPoints(curved));
const resized = { ...curved, w: curved.w * 2, h: curved.h * 2 };
assert.equal(connectorPoints(resized).middle.x, curved.x + 2 * (connectorPoints(curved).middle.x - curved.x));
console.log('Connector curves, crossing endpoints, reflections, and resizing passed.');
