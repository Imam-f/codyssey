import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
const profile = await mkdtemp(path.join(tmpdir(), 'codyssey-canvas-colors-'));
const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function sample() {
    await page.getByRole('button', { name: /Explore the sample/ }).click();
    await page.getByText('Indexed', { exact: true }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: 'Free canvas', exact: true }).click();
  }
  await sample();
  await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.startsWith('codyssey:canvas:')));
  await page.getByRole('button', { name: 'Close repository', exact: true }).click();
  await page.getByRole('button', { name: /Explore the sample/ }).waitFor();
  // Items saved before fill/alpha existed should retain their original appearance.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('codyssey:canvas:'));
    const item = (id, type, x, y, w, h) => ({ id, type, x, y, w, h, color: '#89b4a2', thickness: 2, text: '' });
    localStorage.setItem(key, JSON.stringify({ sources: {}, viewport: { x: 0, y: 0, zoom: 1 }, items: [
      item('a', 'box', 40, 40, 120, 90), item('b', 'box', 240, 40, 120, 90),
      item('arrow', 'arrow', 40, 240, 200, 80), item('text', 'text', 300, 240, 160, 60),
    ] }));
  });
  await sample();
  const a = page.locator('[data-canvas-id="a"]'), b = page.locator('[data-canvas-id="b"]');
  const arrow = page.locator('[data-canvas-id="arrow"]');
  const canvas = page.getByRole('region', { name: 'Free canvas', exact: true });
  const fillAlpha = page.getByLabel('Canvas fill alpha', { exact: true });
  const colorAlpha = page.getByLabel('Canvas color alpha', { exact: true });
  await expect(a).toHaveCSS('background-color', 'rgba(20, 23, 27, 0.91)');
  await expect(a).toHaveCSS('border-top-color', 'rgb(137, 180, 162)');
  await a.click();
  await expect(fillAlpha).toHaveValue('91');
  await expect(colorAlpha).toHaveValue('100');
  await page.getByLabel('Canvas fill color', { exact: true }).fill('#e88a94');
  await fillAlpha.fill('0');
  await colorAlpha.fill('25');
  await expect(a).toHaveCSS('background-color', 'rgba(232, 138, 148, 0)');
  await expect(a).toHaveCSS('border-top-color', 'rgba(137, 180, 162, 0.25)');
  await expect(b).toHaveCSS('background-color', 'rgba(20, 23, 27, 0.91)');
  await page.getByRole('button', { name: 'Use fill color #79b8e8', exact: true }).click();
  await expect(fillAlpha).toHaveValue('0');
  await expect(a).toHaveCSS('background-color', 'rgba(121, 184, 232, 0)');
  await fillAlpha.fill('40');
  await expect(a).toHaveCSS('background-color', 'rgba(121, 184, 232, 0.4)');
  await page.getByRole('button', { name: 'Undo canvas change', exact: true }).click();
  await expect(a).toHaveCSS('background-color', 'rgba(121, 184, 232, 0)');
  await page.getByRole('button', { name: 'Redo canvas change', exact: true }).click();
  await expect(a).toHaveCSS('background-color', 'rgba(121, 184, 232, 0.4)');
  await a.click();
  await expect(fillAlpha).toHaveValue('40');
  await expect(colorAlpha).toHaveValue('25');

  // Fill edits in a mixed selection affect only boxes; RGB edits preserve alpha.
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Use fill color #e9b872', exact: true }).click();
  await fillAlpha.fill('100');
  await expect(a).toHaveCSS('background-color', 'rgb(233, 184, 114)');
  await expect(b).toHaveCSS('background-color', 'rgb(233, 184, 114)');
  await canvas.press('Escape');
  await arrow.locator('.canvas-connector-hit').click({ position: { x: 100, y: 40 } });
  await expect(fillAlpha).toHaveCount(0);
  await colorAlpha.fill('30');
  await page.getByRole('button', { name: 'Use color #b4a4df', exact: true }).click();
  await expect(colorAlpha).toHaveValue('30');
  await expect(arrow.locator('svg > path').last()).toHaveCSS('stroke', 'rgba(180, 164, 223, 0.3)');
  await expect(arrow.locator('marker path')).toHaveCSS('stroke', 'rgba(180, 164, 223, 0.3)');
  await page.locator('[data-canvas-id="text"]').click();
  await colorAlpha.fill('0');
  await expect(page.locator('[data-canvas-id="text"] .canvas-item-text')).toHaveCSS('color', 'rgba(137, 180, 162, 0)');

  // The current drawing style is also used for newly created boxes.
  await canvas.press('Escape');
  await page.getByRole('button', { name: 'Box', exact: true }).click();
  await page.getByRole('region', { name: 'Free canvas', exact: true }).click({ position: { x: 400, y: 400 } });
  const created = page.locator('.canvas-box').last();
  await expect(created).toHaveCSS('background-color', 'rgb(233, 184, 114)');
  await expect(created).toHaveCSS('border-top-color', 'rgba(180, 164, 223, 0)');
  await page.getByRole('button', { name: 'Delete selection', exact: true }).click();
  // Closing immediately after an edit exercises the autosave flush.
  await a.click();
  await fillAlpha.fill('65');
  await page.getByRole('button', { name: 'Close repository', exact: true }).click();
  await page.getByRole('button', { name: /Explore the sample/ }).waitFor();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('codyssey:canvas:')))).items);
  assert.equal(saved.find((item) => item.id === 'a').fillAlpha, 0.65);
  assert.equal(saved.find((item) => item.id === 'arrow').fillColor, undefined);
  assert.equal(saved.find((item) => item.id === 'text').fillAlpha, undefined);
  await sample();
  await expect(a).toHaveCSS('background-color', 'rgba(233, 184, 114, 0.65)');
  await expect(a).toHaveCSS('border-top-color', 'rgba(137, 180, 162, 0.25)');
  await a.click();
  await expect(fillAlpha).toHaveValue('65');
  await expect(colorAlpha).toHaveValue('25');

  const fillStyle = page.getByLabel('Canvas fill style', { exact: true });
  await expect(fillStyle).toHaveValue('solid');
  await expect(a).toHaveCSS('background-image', 'none');
  const patterns = new Set();
  for (const style of ['parallel', 'crossing', 'dots']) {
    await fillStyle.selectOption(style);
    await expect(a).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const pattern = await a.evaluate((element) => getComputedStyle(element).backgroundImage);
    if (style === 'parallel') assert.match(pattern, /^repeating-linear-gradient\(135deg,/);
    assert.match(pattern, /rgba\(233, 184, 114, 0\.65\)/);
    patterns.add(pattern);
    await expect(fillAlpha).toHaveValue('65');
    await expect(a).toHaveCSS('border-top-color', 'rgba(137, 180, 162, 0.25)');
    await expect(b).toHaveCSS('background-image', 'none');
  }
  assert.equal(patterns.size, 3); // Each pattern has a distinct appearance.
  await fillStyle.selectOption('solid');
  await expect(a).toHaveCSS('background-image', 'none');
  await expect(a).toHaveCSS('background-color', 'rgba(233, 184, 114, 0.65)');
  await page.getByRole('button', { name: 'Undo canvas change', exact: true }).click();
  await expect(a).toHaveAttribute('data-fill-style', 'dots');
  await page.getByRole('button', { name: 'Redo canvas change', exact: true }).click();
  await expect(a).toHaveCSS('background-image', 'none');

  // Pattern changes work across box selections and become the drawing default.
  await canvas.press('Control+a');
  await fillStyle.selectOption('parallel');
  await expect(a).toHaveAttribute('data-fill-style', 'parallel');
  await expect(b).toHaveAttribute('data-fill-style', 'parallel');
  await canvas.press('Escape');
  await page.getByRole('button', { name: 'Box', exact: true }).click();
  await canvas.click({ position: { x: 400, y: 400 } });
  await expect(created).toHaveAttribute('data-fill-style', 'parallel');
  await expect(created).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Delete selection', exact: true }).click();
  await a.click();
  await fillStyle.selectOption('dots');
  await fillAlpha.fill('0');
  assert.match(await a.evaluate((element) => getComputedStyle(element).backgroundImage), /rgba\(233, 184, 114, 0\)/);
  await fillAlpha.fill('45');
  await page.getByLabel('Canvas w', { exact: true }).fill('200');
  await expect(a).toHaveCSS('background-size', '12px 12px');
  await page.getByRole('button', { name: 'Close repository', exact: true }).click();
  await page.getByRole('button', { name: /Explore the sample/ }).waitFor();
  const patterned = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('codyssey:canvas:')))).items);
  assert.equal(patterned.find((item) => item.id === 'arrow').fillStyle, undefined);
  assert.equal(patterned.find((item) => item.id === 'text').fillStyle, undefined);
  await sample();
  await expect(a).toHaveAttribute('data-fill-style', 'dots');
  await expect(b).toHaveAttribute('data-fill-style', 'parallel');
  await a.click();
  await expect(fillStyle).toHaveValue('dots');
  await expect(fillAlpha).toHaveValue('45');
  await expect(page.getByLabel('Canvas w', { exact: true })).toHaveValue('200');

  const borderStyle = page.getByLabel('Canvas border style', { exact: true });
  await expect(borderStyle).toHaveValue('solid');
  const beforeBorder = await a.evaluate((element) => ({ fill: getComputedStyle(element).backgroundImage, width: element.offsetWidth, height: element.offsetHeight }));
  await borderStyle.selectOption('dotted');
  await expect(a).toHaveCSS('border-top-style', 'dotted');
  await expect(b).toHaveCSS('border-top-style', 'solid');
  await borderStyle.selectOption('dashed');
  await expect(a).toHaveCSS('border-top-style', 'dashed');
  await expect(a).toHaveCSS('border-top-color', 'rgba(137, 180, 162, 0.25)');
  await expect(a).toHaveCSS('border-top-width', '2px');
  assert.deepEqual(await a.evaluate((element) => ({ fill: getComputedStyle(element).backgroundImage, width: element.offsetWidth, height: element.offsetHeight })), beforeBorder);
  await page.getByRole('button', { name: 'Undo canvas change', exact: true }).click();
  await expect(a).toHaveCSS('border-top-style', 'dotted');
  await page.getByRole('button', { name: 'Redo canvas change', exact: true }).click();
  await expect(a).toHaveCSS('border-top-style', 'dashed');
  await canvas.press('Control+a');
  await borderStyle.selectOption('dotted');
  await expect(a).toHaveCSS('border-top-style', 'dotted');
  await expect(b).toHaveCSS('border-top-style', 'dotted');
  await canvas.press('Escape');
  await page.getByRole('button', { name: 'Box', exact: true }).click();
  await canvas.click({ position: { x: 400, y: 400 } });
  await expect(created).toHaveCSS('border-top-style', 'dotted');
  await page.getByRole('button', { name: 'Delete selection', exact: true }).click();
  await a.click();
  await borderStyle.selectOption('dashed');
  await page.getByRole('button', { name: 'Close repository', exact: true }).click();
  await page.getByRole('button', { name: /Explore the sample/ }).waitFor();
  const bordered = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('codyssey:canvas:')))).items);
  assert.equal(bordered.find((item) => item.id === 'arrow').borderStyle, undefined);
  assert.equal(bordered.find((item) => item.id === 'text').borderStyle, undefined);
  await sample();
  await expect(a).toHaveCSS('border-top-style', 'dashed');
  await expect(b).toHaveCSS('border-top-style', 'dotted');
  await a.click();
  await expect(borderStyle).toHaveValue('dashed');
  await expect(fillStyle).toHaveValue('dots');
  await expect(fillAlpha).toHaveValue('45');

  // Ellipses share all shape styles and the normal drawing/selection workflow.
  await canvas.press('Escape');
  await fillStyle.selectOption('parallel');
  await borderStyle.selectOption('dotted');
  await page.getByRole('button', { name: 'Use fill color #b4a4df', exact: true }).click();
  await fillAlpha.fill('55');
  await page.getByRole('button', { name: 'Ellipse', exact: true }).click();
  const rect = await canvas.boundingBox();
  async function drag(x, y, endX, endY) {
    await page.mouse.move(rect.x + x, rect.y + y); await page.mouse.down();
    await page.mouse.move(rect.x + endX, rect.y + endY, { steps: 6 }); await page.mouse.up();
  }
  await drag(550, 440, 350, 320); // Drawing backwards normalizes the bounds.
  const oval = page.locator('.canvas-ellipse');
  await expect(oval).toHaveCount(1);
  await expect(oval).toHaveClass(/selected/);
  await expect(oval).toHaveCSS('border-radius', '50%');
  await expect(oval).toHaveCSS('width', '200px');
  await expect(oval).toHaveCSS('height', '120px');
  await expect(oval).toHaveCSS('border-top-style', 'dotted');
  assert.match(await oval.evaluate((element) => getComputedStyle(element).backgroundImage), /rgba\(180, 164, 223, 0\.55\)/);
  // Empty bounding-box corners belong to the canvas, not the oval.
  assert.notEqual(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.canvas-item')?.dataset.type, { x: rect.x + 352, y: rect.y + 322 }), 'ellipse');
  for (const style of ['solid', 'parallel', 'crossing', 'dots']) {
    await fillStyle.selectOption(style);
    await expect(oval).toHaveAttribute('data-fill-style', style);
  }
  await page.getByLabel('Canvas text', { exact: true }).fill('Ellipse');
  await page.getByLabel('Canvas font weight', { exact: true }).selectOption('700');
  await expect(oval.locator('.canvas-item-text')).toHaveCSS('font-weight', '700');
  await drag(450, 380, 475, 395);
  await expect(oval).toHaveCSS('left', '375px');
  await expect(oval).toHaveCSS('top', '335px');
  const resize = await page.getByRole('button', { name: 'Resize selection', exact: true }).boundingBox();
  await drag(resize.x + resize.width / 2 - rect.x, resize.y + resize.height / 2 - rect.y, resize.x + resize.width / 2 - rect.x + 40, resize.y + resize.height / 2 - rect.y + 20);
  await expect(oval).toHaveCSS('width', '240px');
  await expect(oval).toHaveCSS('height', '140px');
  await page.getByRole('button', { name: 'Undo canvas change', exact: true }).click();
  await expect(oval).toHaveCSS('width', '200px');
  await page.getByRole('button', { name: 'Redo canvas change', exact: true }).click();
  await expect(oval).toHaveCSS('width', '240px');
  await page.getByRole('button', { name: 'Arrow', exact: true }).click();
  await canvas.click({ position: { x: 615, y: 405 } });
  await canvas.click({ position: { x: 750, y: 500 } });
  const ovalLink = page.locator('.canvas-arrow').last();
  await oval.click();
  await page.getByLabel('Canvas x', { exact: true }).fill('400');
  await expect(ovalLink).toHaveCSS('left', '640px');
  await b.click({ modifiers: ['Shift'] });
  await borderStyle.selectOption('dashed');
  await expect(oval).toHaveCSS('border-top-style', 'dashed');
  await expect(b).toHaveCSS('border-top-style', 'dashed');
  await page.getByRole('button', { name: 'Close repository', exact: true }).click();
  await page.getByRole('button', { name: /Explore the sample/ }).waitFor();
  await sample();
  await expect(oval).toHaveText('Ellipse');
  await expect(oval).toHaveCSS('width', '240px');
  await expect(oval).toHaveCSS('border-top-style', 'dashed');
  await oval.click();
  await expect(fillStyle).toHaveValue('dots');
  await expect(fillAlpha).toHaveValue('55');
  await expect(page.getByLabel('Canvas font weight', { exact: true })).toHaveValue('700');
  await page.getByRole('button', { name: 'Delete selection', exact: true }).click();
  await expect(oval).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo canvas change', exact: true }).click();
  await expect(oval).toHaveCount(1);
  assert.deepEqual(errors, []);
  console.log('Canvas styles and ellipses passed: fills/borders, alpha, drawing, oval hit targets, text/fonts, mixed selections, moving/resizing, snapping, undo/redo, and persistence.');
} finally { await app.close(); }
