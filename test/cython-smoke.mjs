import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const workspace = await mkdtemp(path.join(tmpdir(), "codyssey-cython-"));
const fixture = path.join(workspace, "repository");
const profile = path.join(workspace, "profile");
await mkdir(fixture);
const source = "cdef double scale(double value) nogil:\n    return value * 2\ncpdef double calculate(double value):\n    return scale(value)\n";
await writeFile(path.join(fixture, "engine.pyx"), source);
await writeFile(path.join(fixture, "engine.pxd"), "cpdef double calculate(double value)\n");
await writeFile(path.join(fixture, "limits.pxi"), "cdef int limit = 3\n");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("heading", { name: "Start exploring" })).toBeVisible();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, fixture);
  await page.getByTitle("Open repository · Ctrl+O").click();
  await expect(page.getByText("Indexed", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".tree-file")).toHaveCount(3);
  await page.locator(".tree-file").filter({ hasText: "engine.pyx" }).click();
  await expect(page.getByRole("region", { name: "Cython source" })).toBeVisible();
  await expect(page.locator(".statusbar")).toContainText("Cython AST");
  await expect(page.locator('.code-line[data-line="1"] .syntax-keyword').filter({ hasText: /^cdef$/ })).toBeVisible();
  await expect(page.locator('.code-line[data-line="1"] .syntax-type').filter({ hasText: /^double$/ }).first()).toBeVisible();
  const token = page.locator('.code-line[data-line="4"] .line-content > span').filter({ hasText: /^scale$/ });
  await token.click({ modifiers: ["Control"] });
  await expect(page.locator(".current-line")).toHaveAttribute("data-line", "1");

  const opened = app.waitForEvent("window");
  await page.evaluate(() => window.codyssey.openDeclaration({
    path: "engine.pyx", line: 3, chain: [{ kind: "function", name: "calculate" }],
  }));
  const popup = await opened;
  await expect(popup.locator(".popup-code")).toContainText("cpdef double calculate");
  await writeFile(path.join(fixture, "engine.pyx"), `# moved\n${source.replace("return scale(value)", "return scale(value) + 1")}cdef int added = 1\n`);
  await expect(popup.locator(".popup-code")).toContainText("return scale(value) + 1", { timeout: 30000 });
  await popup.getByRole("button", { name: "Close declaration" }).click();

  // Reopening must invalidate the fingerprint when only a Cython file changes.
  await page.getByRole("button", { name: "Close repository", exact: true }).click();
  await page.getByTitle("Open repository · Ctrl+O").click();
  await expect(page.getByText("Indexed", { exact: true })).toBeVisible({ timeout: 60000 });
  const cacheDir = path.join(profile, "analysis-cache");
  const [cacheName] = await readdir(cacheDir);
  const cache = JSON.parse(await readFile(path.join(cacheDir, cacheName), "utf8"));
  assert.ok(cache.result.files.find((file) => file.path === "engine.pyx").symbols.some((symbol) => symbol.name === "added"));
  assert.deepEqual(errors, []);
  console.log("Cython source, navigation, popups, and cache invalidation passed");
} finally {
  await app.close();
}
