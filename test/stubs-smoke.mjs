import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const workspace = await mkdtemp(path.join(tmpdir(), "codyssey-stubs-"));
const repository = path.join(workspace, "repository");
const external = path.join(workspace, "external stubs");
const profile = path.join(workspace, "profile");
await mkdir(path.join(repository, ".venv", "Lib", "site-packages", "dependency-stubs"), { recursive: true });
await mkdir(external);
await writeFile(path.join(repository, "main.py"), "from dependency import work\nfrom externalpkg import extra\ndef run():\n    return work() + extra()\n");
await writeFile(path.join(repository, ".venv", "Lib", "site-packages", "dependency-stubs", "__init__.pyi"), "def work() -> int: ...\n");
await writeFile(path.join(external, "externalpkg.pyi"), "def extra() -> int: ...\n");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
let app;
async function launch() {
  app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Start exploring" })).toBeVisible();
  return page;
}
async function choose(folder) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, folder);
}
async function apply(page) {
  await page.getByRole("button", { name: "Apply and reindex" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 60000 });
}
async function cache() {
  const directory = path.join(profile, "analysis-cache");
  const [name] = await readdir(directory);
  return JSON.parse(await readFile(path.join(directory, name), "utf8"));
}
try {
  let page = await launch();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await choose(repository);
  await page.getByTitle("Open repository · Ctrl+O").click();
  await expect(page.getByText("Indexed", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".tree-file")).toHaveCount(1);
  await page.getByRole("button", { name: "Dependency stubs", exact: true }).click();
  await page.getByRole("checkbox", { name: /Use stubs from this repository/ }).check();
  await choose(external);
  await page.getByRole("button", { name: "Add folder or virtual environment" }).click();
  await expect(page.locator(".stub-paths")).toContainText(external);
  await apply(page);
  await expect(page.locator(".tree-file")).toHaveCount(3);
  const result = (await cache()).result;
  const stub = result.files.find((file) => file.module === "externalpkg");
  assert.ok(stub.external);
  assert.deepEqual(result.stubOptions, { paths: [external], useVenv: true });
  await page.locator('.code-line[data-line="4"] .line-content > span').filter({ hasText: /^extra$/ }).click({ modifiers: ["Control"] });
  await expect(page.locator(".breadcrumb")).toContainText("externalpkg.pyi");
  await expect(page.locator(".statusbar")).toContainText("Dependency stub");
  const opened = app.waitForEvent("window");
  await page.evaluate((stubPath) => window.codyssey.openDeclaration({
    path: stubPath, line: 1, chain: [{ kind: "function", name: "extra" }],
  }), stub.path);
  const popup = await opened;
  await expect(popup.locator(".popup-code")).toContainText("def extra() -> int");
  await popup.getByRole("button", { name: "Close declaration" }).click();
  assert.match(await page.evaluate(() => window.codyssey.openDeclaration({
    path: "@stubs/../../outside.pyi", line: 1, chain: [{ kind: "function", name: "extra" }],
  }).catch((error) => error.message)), /Invalid declaration target/);
  assert.deepEqual(errors, []);
  await app.close();

  // Persisted options survive restarts and edits to external stubs invalidate the cache.
  await writeFile(path.join(external, "externalpkg.pyi"), "def extra() -> int: ...\nADDED: int\n");
  page = await launch();
  await choose(repository);
  await page.getByTitle("Open repository · Ctrl+O").click();
  await expect(page.getByText("Indexed", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".tree-file")).toHaveCount(3);
  assert.ok((await cache()).result.files.find((file) => file.module === "externalpkg").symbols.some((symbol) => symbol.name === "ADDED"));
  await page.getByRole("button", { name: "Dependency stubs", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /Use stubs from this repository/ })).toBeChecked();
  await expect(page.locator(".stub-paths")).toContainText(external);
  await page.getByRole("checkbox", { name: /Use stubs from this repository/ }).uncheck();
  await page.getByRole("button", { name: `Remove stub folder ${external}` }).click();
  await apply(page);
  await expect(page.locator(".tree-file")).toHaveCount(1);
  assert.deepEqual((await cache()).result.stubOptions, { paths: [], useVenv: false });
  console.log("External stub settings, venv discovery, navigation, popups, persistence, cache invalidation, and disabling passed");
} finally {
  if (app) await app.close();
}
