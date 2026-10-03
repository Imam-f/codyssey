import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
const profile = await mkdtemp(path.join(tmpdir(), 'codyssey-canvas-hit-tests-'));
const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function sample() {
    await page.getByRole('button', { name: /Explore the sample/ }).click();
    await page.getByText('Indexed', { exact: true }).waitFor({ timeout: 60000 });
  }
  await sample();
  await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.startsWith('codyssey:canvas:')));
  await page.getByRole('button', { name: 'Close repository', exact: true }).click();
  // Restore a known layout to test actual pointer hit targets and zoom transforms.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('codyssey:canvas:'));
    const item = (id, type, x, y, w, h) => ({ id, type, x, y, w, h, color: '#89b4a2', thickness: 2, text: '' });
    localStorage.setItem(key, JSON.stringify({ sources: {}, viewport: { x: 0, y: 0, zoom: 1 }, items: [
      item('a', 'box', 40, 40, 100, 70), item('b', 'box', 260, 40, 100, 70),
      item('arrow', 'arrow', 80, 220, 260, 120),
      { ...item('bend', 'bend', 80, 380, 260, 100), startPoint: { x: 0, y: 1 }, endPoint: { x: 1, y: 1 }, bendPoint: { x: .5, y: 0 } },
    ] }));
  });
  await sample();
  await page.getByRole('button', { name: 'Free canvas', exact: true }).click();
  const selected = page.locator('.canvas-item.selected');
  const positions = () => page.locator('.canvas-item').evaluateAll((elements) => Object.fromEntries(elements.map((element) => [element.dataset.canvasId, { x: parseFloat(element.style.left), y: parseFloat(element.style.top) }])));
  async function screen(x, y) {
    return page.evaluate(({ x, y }) => {
      const rect = document.querySelector('.canvas-surface').getBoundingClientRect();
      const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);
      return { x: rect.x + matrix.e + x * matrix.a, y: rect.y + matrix.f + y * matrix.d };
    }, { x, y });
  }
  async function click(x, y, shift = false) {
    const p = await screen(x, y);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(p.x, p.y);
    if (shift) await page.keyboard.up('Shift');
  }
  async function drag(x, y, endX, endY) {
    const start = await screen(x, y), end = await screen(endX, endY);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up();
  }
  await click(120, 320); // Inside the arrow rectangle, far away from its stroke.
  await expect(selected).toHaveCount(0);
  await click(210, 280);
  await expect(selected).toHaveAttribute('data-canvas-id', 'arrow');
  await expect(page.locator('.canvas-point-handle')).toHaveCount(2);
  await click(120, 320);
  await expect(selected).toHaveCount(0);
  await drag(210, 280, 230, 300);
  assert.deepEqual((await positions()).arrow, { x: 100, y: 240 });
  await page.getByRole('button', { name: 'Undo canvas change', exact: true }).click();
  await click(210, 470); // Inside the curved arrow rectangle, below the curve.
  await expect(selected).toHaveCount(0);
  await click(210, 380);
  await expect(selected).toHaveAttribute('data-canvas-id', 'bend');
  await expect(page.locator('.canvas-point-handle')).toHaveCount(3);
  await click(210, 470);
  await expect(selected).toHaveCount(0);

  await drag(20, 20, 100, 90); // Partly covers the first box.
  await expect(selected).toHaveCount(0);
  await drag(20, 20, 170, 130);
  await expect(selected).toHaveAttribute('data-canvas-id', 'a');
  await click(400, 160);
  await drag(170, 130, 20, 20); // Reverse-direction enclosure.
  await expect(selected).toHaveAttribute('data-canvas-id', 'a');
  await click(400, 160);
  await drag(20, 20, 300, 130); // Encloses a, only touches b.
  await expect(selected).toHaveAttribute('data-canvas-id', 'a');
  await click(300, 75, true);
  await expect(selected).toHaveCount(2);
  await drag(200, 75, 230, 115); // Empty gap inside the multi-selection.
  let state = await positions();
  assert.deepEqual(state.a, { x: 70, y: 80 });
  assert.deepEqual(state.b, { x: 290, y: 80 });
  assert.deepEqual(state.arrow, { x: 80, y: 220 });
  await click(100, 115, true); // Shift still reaches selected items below the overlay.
  await expect(selected).toHaveAttribute('data-canvas-id', 'b');
  await click(100, 115, true);
  await expect(selected).toHaveCount(2);
  await page.getByRole('button', { name: 'Zoom in canvas', exact: true }).click();
  await drag(230, 115, 250, 95);
  state = await positions();
  assert.deepEqual(state.a, { x: 90, y: 60 });
  assert.deepEqual(state.b, { x: 310, y: 60 });
  await page.getByRole('button', { name: 'Undo canvas change', exact: true }).click();
  state = await positions();
  assert.deepEqual(state.a, { x: 70, y: 80 });
  assert.deepEqual(state.b, { x: 290, y: 80 });

  await page.getByRole('button', { name: 'Zoom out canvas', exact: true }).click();
  await click(100, 115);
  await click(320, 115, true);
  await page.getByRole('button', { name: 'Group selection', exact: true }).click();
  await page.keyboard.press('Escape');
  await drag(60, 70, 180, 160); // One group member is enclosed; the full group is not.
  await expect(selected).toHaveCount(0);
  await drag(60, 70, 400, 160);
  await expect(selected).toHaveCount(2);
  assert.deepEqual(errors, []);
  console.log('Canvas selection passed: stroke-only straight/curved arrows, full enclosure, reverse marquee, dragging selection gaps, Shift membership, zoom, undo, and group enclosure.');
} finally { await app.close(); }
