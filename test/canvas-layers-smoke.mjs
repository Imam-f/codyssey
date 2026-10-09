import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
const profile = await mkdtemp(path.join(tmpdir(), 'codyssey-canvas-layers-'));
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
  await page.getByRole('button', { name: /Explore the sample/ }).waitFor();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('codyssey:canvas:'));
    const item = (id, type, x, y, w, h) => ({ id, type, x, y, w, h, color: '#89b4a2', thickness: 2, text: id });
    localStorage.setItem(key, JSON.stringify({ sources: {}, viewport: { x: 0, y: 0, zoom: 1 }, items: [
      item('frame', 'frame', 400, 250, 200, 180), item('a', 'box', 40, 40, 150, 120),
      item('child', 'box', 420, 290, 90, 60), item('b', 'box', 120, 80, 150, 120),
      item('text', 'text', 40, 280, 220, 70), item('outside', 'box', 480, 260, 160, 150),
    ] }));
  });
  await sample();
  await page.getByRole('button', { name: 'Free canvas', exact: true }).click();
  const selected = page.locator('.canvas-item.selected');
  const front = page.getByRole('button', { name: 'Bring to front', exact: true });
  const back = page.getByRole('button', { name: 'Send to back', exact: true });
  const order = () => page.locator('.canvas-item').evaluateAll((elements) => elements.map((element) => element.dataset.canvasId));
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
  async function top(x, y) {
    return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.canvas-item')?.dataset.canvasId, await screen(x, y));
  }
  await expect(front).toBeDisabled();
  await expect(back).toBeDisabled();
  assert.equal(await top(160, 100), 'b');
  await click(70, 60);
  await front.click();
  assert.equal(await top(160, 100), 'a');
  await expect(selected).toHaveAttribute('data-canvas-id', 'a');
  await back.click();
  assert.equal(await top(160, 100), 'b');
  await page.getByRole('button', { name: 'Undo canvas change', exact: true }).click();
  assert.equal(await top(160, 100), 'a');
  await page.getByRole('button', { name: 'Redo canvas change', exact: true }).click();
  assert.equal(await top(160, 100), 'b');

  await click(70, 60);
  await click(230, 150, true);
  await expect(selected).toHaveCount(2);
  await page.getByRole('button', { name: 'Group selection', exact: true }).click();
  await back.click();
  assert.deepEqual(await order(), ['a', 'b', 'frame', 'child', 'text', 'outside']);
  await front.click();
  assert.deepEqual(await order(), ['frame', 'child', 'text', 'outside', 'a', 'b']);
  await page.keyboard.press('Escape');
  await click(70, 60);
  await expect(selected).toHaveCount(2); // Layer changes kept the group intact.
  await page.keyboard.press('Control+Shift+BracketLeft');
  assert.deepEqual(await order(), ['a', 'b', 'frame', 'child', 'text', 'outside']);
  await page.keyboard.press('Control+Shift+BracketRight');
  assert.deepEqual(await order(), ['frame', 'child', 'text', 'outside', 'a', 'b']);

  await page.keyboard.press('Escape');
  assert.equal(await top(490, 310), 'outside');
  await click(430, 263);
  await expect(selected).toHaveAttribute('data-canvas-id', 'frame');
  await front.click();
  assert.deepEqual(await order(), ['text', 'outside', 'a', 'b', 'frame', 'child']);
  assert.equal(await top(490, 310), 'child'); // Frame contents move together above overlapping elements.
  await back.click();
  assert.equal(await top(490, 310), 'outside');
  await expect(selected).toHaveAttribute('data-canvas-id', 'frame');

  await click(100, 310);
  const text = page.locator('[data-canvas-id="text"] .canvas-item-text');
  await expect(text).toHaveCSS('font-family', 'Arial, Helvetica, sans-serif');
  await expect(text).toHaveCSS('font-weight', '400');
  const font = page.getByRole('combobox', { name: 'Canvas font', exact: true });
  await font.selectOption('rounded');
  await expect(text).toHaveCSS('font-family', '"Trebuchet MS", Arial, sans-serif');
  await page.getByRole('combobox', { name: 'Canvas font weight', exact: true }).selectOption('700');
  await expect(text).toHaveCSS('font-weight', '700');
  await page.getByRole('button', { name: 'Undo canvas change', exact: true }).click();
  await expect(text).toHaveCSS('font-weight', '400');
  await page.getByRole('button', { name: 'Undo canvas change', exact: true }).click();
  await expect(text).toHaveCSS('font-family', 'Arial, Helvetica, sans-serif');
  await click(100, 310);
  await font.selectOption('serif');
  const finalOrder = await order();
  await page.getByRole('button', { name: 'Close repository', exact: true }).click();
  await sample();
  await page.getByRole('button', { name: 'Free canvas', exact: true }).click();
  assert.deepEqual(await order(), finalOrder);
  await expect(text).toHaveCSS('font-family', 'Georgia, "Times New Roman", serif');
  assert.equal(await top(160, 100), 'b');
  assert.equal(await top(490, 310), 'outside');
  assert.deepEqual(errors, []);
  console.log('Canvas layers passed: overlap hit targets, front/back, groups, frames and contents, shortcuts, font picker, weight, undo/redo, and persistence.');
} finally { await app.close(); }
