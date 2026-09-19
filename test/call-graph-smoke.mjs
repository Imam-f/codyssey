import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const fixture = await mkdtemp(path.join(tmpdir(), "codyssey-dense-graph-"));
const profile = await mkdtemp(path.join(tmpdir(), "codyssey-graph-profile-"));
// Forty targets, twelve callers, recursion, and repeated call sites exercise
// continuous layout and panning in both directions without depending on the sample graph.
const names = [
  "torch.device",
  "torch.cuda.is_available",
  "MNISTDataset",
  "DataLoader",
  "OuterProductBinaryMLP",
  "torch.optim.Adam",
  "model.parameters",
  "nn.CrossEntropyLoss",
  "range",
  "model.train",
  "x.to",
  "class_label.to",
  "target.to",
  "F.one_hot",
  "F.cross_entropy",
  "model",
  "criterion",
  "optimizer.zero_grad",
  "loss.backward",
  "optimizer.step",
  "loss.item",
  "x.size",
  "len",
  "train_losses.append",
  "model.eval",
  "torch.no_grad",
  "torch.argmax",
  "prediction.eq",
  "prediction.sum",
  "val_accs.append",
  "print",
  "plt.figure",
  "plt.subplot",
  "plt.plot",
  "plt.xlabel",
  "plt.ylabel",
  "plt.legend",
  "plt.suptitle",
  "plt.show",
  "save_checkpoint",
];
await writeFile(
  path.join(fixture, "training.py"),
  `def save_checkpoint():\n    pass\n\ndef train_model():\n${names.map((n) => `    ${n}()`).join("\n")}\n    train_model()\n    plt.plot()\n\n${Array.from({ length: 12 }, (_, i) => `def caller_${i}():\n    train_model()\n`).join("\n")}`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
const app = await electron.launch({
  args: [".", `--user-data-dir=${profile}`],
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, fixture);
  await page.getByTitle("Open repository · Ctrl+O").click();
  await page.getByText("Indexed", { exact: true }).waitFor();
  await page
    .locator(".view-tabs")
    .getByRole("button", { name: /Call graph/ })
    .click();
  await page
    .getByRole("textbox", { name: "Find function" })
    .fill("train_model");
  await page.locator(".call-function-results > button").click();
  await page.locator(".callees .call-node").first().waitFor();
  await expect(page.locator(".callees .call-node")).toHaveCount(40);
  await expect(page.locator(".callers .call-node")).toHaveCount(12);
  await expect(page.locator(".call-edge")).toHaveCount(52);
  await expect(page.locator(".callees .call-column")).toHaveCount(7);
  const columnPositions = await page
    .locator(".callees .call-column")
    .evaluateAll((columns) =>
      columns.map((column) => ({
        x: column.offsetLeft,
        y: column.offsetTop,
        count: column.children.length,
      })),
    );
  assert.ok(
    columnPositions.every(
      (column, i) =>
        column.count <= 6 && (!i || column.x > columnPositions[i - 1].x),
    ),
  );
  assert.ok(
    columnPositions.every((column) => column.y === columnPositions[0].y),
    "Columns extend rightward from the same top edge",
  );
  assert.equal(await page.locator(".call-pagination").count(), 0);
  const targets = await page
    .locator(".callees .call-node-header button:first-of-type")
    .allTextContents();
  assert.deepEqual(
    new Set(targets),
    new Set(names),
    "Every target is present simultaneously",
  );
  await page
    .getByRole("textbox", { name: "Filter connections" })
    .fill("plt.plot");
  assert.equal(await page.locator(".callees .call-node").count(), 1);
  assert.equal(
    await page.locator(".callees .call-node-sites button").count(),
    2,
  );
  await page.getByRole("textbox", { name: "Filter connections" }).fill("");
  await expect(page.locator(".callees .call-node")).toHaveCount(40);
  await page.locator(".call-graph-view").getByTitle("Fit in view").click();
  await page.locator(".callees .call-node").first().hover();
  await expect(page.locator(".call-edge.active")).toHaveCount(1);
  await page.getByTitle("Expand graph").click();
  await page.getByTitle("Hide function list").click();
  await page.locator(".call-graph-view").getByTitle("Fit in view").click();
  // Connections stay between their adjacent columns, and fitted nodes stay in view.
  const geometry = await page.locator(".call-canvas").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    return [...canvas.querySelectorAll(".call-node")].every((node) => {
      const r = node.getBoundingClientRect();
      return (
        r.left >= bounds.left &&
        r.right <= bounds.right &&
        r.top >= bounds.top &&
        r.bottom <= bounds.bottom
      );
    });
  });
  assert.equal(geometry, true);
  const crossesCards = await page.locator(".call-flow").evaluate((flow) => {
    const origin = flow.getBoundingClientRect();
    const scale = new DOMMatrix(getComputedStyle(flow).transform).a;
    const cards = [...flow.querySelectorAll(".call-node")].map((node) => {
      const r = node.getBoundingClientRect();
      return {
        left: (r.left - origin.left) / scale + 2,
        right: (r.right - origin.left) / scale - 2,
        top: (r.top - origin.top) / scale + 2,
        bottom: (r.bottom - origin.top) / scale - 2,
      };
    });
    return [...flow.querySelectorAll(".call-edge")].some((edge) => {
      const length = edge.getTotalLength();
      for (let step = 1; step < length; step += 8) {
        const p = edge.getPointAtLength(step);
        if (
          cards.some(
            (r) =>
              p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom,
          )
        )
          return true;
      }
      return false;
    });
  });
  assert.equal(
    crossesCards,
    false,
    "Connections route around all cards, including intervening columns",
  );
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/call-graph-dense.png" });
  await page
    .locator(".call-graph-view")
    .getByTitle("Zoom in", { exact: true })
    .click();
  const zoom = await page.getByTitle("Reset zoom to 100%").textContent();
  await page
    .locator(".call-graph-view")
    .getByTitle("Zoom out", { exact: true })
    .click();
  assert.notEqual(
    await page.getByTitle("Reset zoom to 100%").textContent(),
    zoom,
  );
  const before = await page.locator(".call-flow").getAttribute("style");
  const canvas = await page.locator(".call-canvas").boundingBox();
  await page.mouse.move(canvas.x + 30, canvas.y + 30);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 80, canvas.y + 70);
  await page.mouse.up();
  assert.notEqual(
    await page.locator(".call-flow").getAttribute("style"),
    before,
  );
  // Middle drag must also work over node buttons without following the node.
  await page.getByTitle("Center on selected function").click();
  const focusedId = await page
    .locator(".selected-function .call-node")
    .getAttribute("data-node-id");
  const readPosition = () =>
    page.locator(".call-flow").evaluate((el) => {
      const matrix = new DOMMatrix(getComputedStyle(el).transform);
      return { x: matrix.e, y: matrix.f };
    });
  for (const overButton of [false, true]) {
    const focusButton = await page
      .locator(".selected-function .call-node-header button")
      .first()
      .boundingBox();
    const point = overButton
      ? {
          x: focusButton.x + focusButton.width / 2,
          y: focusButton.y + focusButton.height / 2,
        }
      : { x: canvas.x + 30, y: canvas.y + 30 };
    if (overButton) {
      assert.equal(
        await page.evaluate(
          ({ x, y }) =>
            Boolean(document.elementFromPoint(x, y)?.closest("button")),
          point,
        ),
        true,
      );
    }
    const initial = await readPosition();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(point.x + 60, point.y + 40, { steps: 5 });
    await page.mouse.up({ button: "middle" });
    await expect
      .poll(async () => Math.round((await readPosition()).x - initial.x))
      .toBe(60);
    await expect
      .poll(async () => Math.round((await readPosition()).y - initial.y))
      .toBe(40);
    await page.mouse.move(point.x + 100, point.y + 70);
    assert.equal(
      Math.round((await readPosition()).x - initial.x),
      60,
      "Release ends panning",
    );
    assert.equal(
      await page
        .locator(".selected-function .call-node")
        .getAttribute("data-node-id"),
      focusedId,
    );
  }
  await page.getByTitle("Center on selected function").click();
  await page.screenshot({ path: "artifacts/call-graph-flat.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".call-graph-view.is-expanded").count(), 0);
  await page.getByTitle("Show function list").click();
  await page.getByRole("checkbox", { name: "Show unresolved" }).uncheck();
  assert.equal(await page.locator(".callees .call-node").count(), 1);
  await page.getByRole("checkbox", { name: "Show unresolved" }).check();
  await page
    .getByRole("group", { name: "Call graph direction" })
    .getByRole("button", { name: "Calls", exact: true })
    .click();
  assert.equal(await page.locator(".callers").count(), 0);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1100, 760),
  );
  await page.locator(".call-graph-view").getByTitle("Fit in view").click();
  await page.screenshot({ path: "artifacts/call-graph-compact.png" });
  await page
    .getByRole("textbox", { name: "Filter connections" })
    .fill("plt.plot");
  await page.locator(".callees .call-node-sites button").first().click();
  assert.equal(
    await page.locator(".current-line").getAttribute("data-line"),
    "38",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Dense graph passed: 40 targets and 12 callers simultaneously, filtering, hover, fit, zoom, left/middle panning, fullscreen, resize, and call-site navigation.",
  );
} finally {
  await app.close();
}
