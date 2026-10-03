import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
const profile = await mkdtemp(path.join(tmpdir(), "codyssey-marks-profile-"));
const fixture = await mkdtemp(path.join(tmpdir(), "codyssey-marks-fixture-"));
await writeFile(path.join(fixture, "example.py"), "def example():\n    value = 1\n    return value\n");
await writeFile(path.join(fixture, "other.py"), "def other():\n    return 2\n");
const launch = () => electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
let app = await launch();
const errors = [];

async function sample(page) {
  await page.getByRole("button", { name: /Explore the sample/ }).click();
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 60000 });
}
async function openFixture(page) {
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, fixture);
  await page.getByTitle("Open repository · Ctrl+O").click();
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 60000 });
}
const mark = (page, location) => page.getByRole("button", { name: `Go to mark ${location}`, exact: true });
const count = (page, value) => expect(page.locator(".marks-count")).toHaveText(String(value));
const current = (page, value) => expect(page.locator(".current-line")).toHaveAttribute("data-line", String(value));

try {
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await sample(page);
  await expect(page.locator('.sidebar .marks-section')).toHaveCount(0);
  await expect(page.locator('.right-sidebar .marks-section')).toBeVisible();
  await count(page, 0);
  await page.getByRole("button", { name: "Toggle mark at current line" }).click();
  await count(page, 1);
  await expect(page.getByRole("button", { name: "Remove mark at line 24", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("F9");
  await count(page, 0);
  await page.keyboard.press("F9");
  await count(page, 1);

  await page.getByRole("button", { name: "Edit note for atlas/service.py:24", exact: true }).click();
  await page.getByRole("textbox", { name: "Note for atlas/service.py:24", exact: true }).fill("Follow user lookup");
  await page.keyboard.press("F9");
  await count(page, 1);
  await page.keyboard.press("Enter");
  await expect(mark(page, "atlas/service.py:24")).toContainText("Follow user lookup");
  await page.getByRole("button", { name: "Add mark at line 32", exact: true }).click();
  await count(page, 2);
  await page.locator(".tree-file").filter({ hasText: "models.py" }).click();
  await page.getByRole("button", { name: "Add mark at line 28", exact: true }).click();
  await count(page, 3);
  await expect(page.locator(".tree-mark")).toHaveCount(2);

  await mark(page, "atlas/models.py:28").click();
  await page.keyboard.press("F2");
  await current(page, 24);
  await page.keyboard.press("F2");
  await current(page, 32);
  await page.keyboard.press("F2");
  await current(page, 28);
  await page.keyboard.press("Shift+F2");
  await current(page, 32);
  await page.getByTitle("Fold all blocks", { exact: true }).click();
  await expect(page.locator('.code-line[data-line="32"]')).toHaveCount(0);
  await mark(page, "atlas/service.py:32").click();
  await current(page, 32);
  await expect(page.locator('.code-line[data-line="32"]')).toBeInViewport();

  await page.getByRole("button", { name: /^MARKS/ }).click();
  await expect(page.locator(".marks-list")).toHaveCount(0);
  await page.getByTitle("Toggle explorer").click();
  await page.getByTitle("Toggle explorer").click();
  await count(page, 3);
  await page.getByRole("button", { name: /^MARKS/ }).click();
  await mark(page, "atlas/service.py:24").click();
  await expect(mark(page, "atlas/service.py:24")).toContainText("Follow user lookup");
  await page.getByRole('button', { name: 'Add to canvas', exact: true }).click();
  await expect(page.locator('.canvas-properties .marks-section')).toBeVisible();
  await count(page, 3);
  await expect(page.locator('.canvas-code').getByRole('button', { name: 'Remove mark at atlas/service.py:24', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.canvas-code').getByRole('button', { name: 'Remove mark at atlas/service.py:32', exact: true }).click();
  await count(page, 2);
  await page.locator('.canvas-code').getByRole('button', { name: 'Add mark at atlas/service.py:32', exact: true }).click();
  await count(page, 3);
  await mark(page, 'atlas/service.py:24').click();
  await current(page, 24);
  await expect(page.locator('.right-sidebar .marks-section')).toBeVisible();

  // Different repositories have separate storage, including paths with the same filename.
  await openFixture(page);
  await count(page, 0);
  await page.getByRole("button", { name: "Add mark at line 3", exact: true }).click();
  await page.locator(".tree-file").filter({ hasText: "other.py" }).click();
  await page.getByRole("button", { name: "Add mark at line 2", exact: true }).click();
  await count(page, 2);
  await page.getByRole("button", { name: "Close repository", exact: true }).click();
  await sample(page);
  await count(page, 3);
  await expect(mark(page, "atlas/service.py:24")).toContainText("Follow user lookup");

  // Restarts restore the marks and notes, rather than just retaining React state.
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await sample(page);
  await count(page, 3);
  await expect(mark(page, "atlas/service.py:24")).toContainText("Follow user lookup");
  await page.getByRole("button", { name: "Remove mark atlas/service.py:32", exact: true }).click();
  await count(page, 2);

  // Reindexing preserves unavailable locations without sending navigation to a missing file.
  await openFixture(page);
  await count(page, 2);
  await writeFile(path.join(fixture, "example.py"), "# shortened\n");
  await unlink(path.join(fixture, "other.py"));
  await page.getByTitle("Re-index repository · F5").click();
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 60000 });
  await count(page, 2);
  await expect(mark(page, "example.py:3")).toBeDisabled();
  await expect(mark(page, "other.py:2")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next mark", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Remove mark other.py:2", exact: true }).click();
  await count(page, 1);
  assert.deepEqual(errors, []);
  console.log("Marks smoke passed: gutter, notes, keyboard shortcuts, cross-file cycling, folded targets, sidebar toggle, repository isolation, restart persistence, removal, and missing locations after reindexing.");
} finally {
  await app.close();
}
