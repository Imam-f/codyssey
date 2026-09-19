import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = await mkdtemp(path.join(tmpdir(), "codyssey-welcome-"));
const profile = path.join(workspace, "profile");
const first = path.join(workspace, "Python project #1 % café");
const second = path.join(workspace, "Another project");
await Promise.all([profile, first, second].map((folder) => mkdir(folder)));
await writeFile(path.join(first, "example.py"), "def greet(name: str):\n    return name\n");
await writeFile(path.join(second, "other.py"), "class Example: pass\n");
const firstRoot = await realpath(first);
const secondRoot = await realpath(second);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
const errors = [];
let app;
async function launch() {
  app = await electron.launch({
    ...(process.env.CODYSSEY_EXECUTABLE
      ? { executablePath: process.env.CODYSSEY_EXECUTABLE, args: [`--user-data-dir=${profile}`] }
      : { args: [".", `--user-data-dir=${profile}`] }),
    env,
  });
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), profile);
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("heading", { name: "Start exploring" })).toBeVisible();
  await expect(page.getByText("Loading recent repositories…")).toHaveCount(0);
  return page;
}
async function choose(page, folder) {
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, folder);
  await page.getByTitle("Open repository · Ctrl+O").click();
  await expect(page.getByText("Indexed", { exact: true })).toBeVisible({ timeout: 60000 });
}
async function home(page) {
  await page.getByRole("button", { name: "Close repository", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start exploring" })).toBeVisible();
}

try {
  let page = await launch();
  await expect(page.getByText("A fresh start", { exact: true })).toBeVisible();
  await expect(page.locator(".workspace")).toHaveCount(0);
  await expect(page.locator(".statusbar")).toContainText("No repository open");
  await expect(page.locator(".statusbar")).not.toContainText("Loading parser");
  await expect(page.getByRole("button", { name: "Re-index repository · F5" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export analysis as JSON" })).toBeDisabled();
  await page.keyboard.press("F5");
  await page.keyboard.press("Control+p");
  await expect(page.getByRole("textbox", { name: "Search files and symbols" })).toHaveCount(0);
  assert.match(await page.evaluate(() => window.codyssey.openInVSCode().catch((e) => e.message)), /Open a repository first/);

  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.getByRole("button", { name: /Open repository Choose/ }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("A fresh start", { exact: true })).toBeVisible();

  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/welcome.png" });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 650));
  const layout = await page.evaluate(() => {
    const welcome = document.querySelector(".welcome-page");
    return {
      contentWidth: welcome.scrollWidth,
      viewportWidth: welcome.clientWidth,
      headingTop: document.querySelector(".welcome-heading").getBoundingClientRect().top,
      toolbarBottom: document.querySelector(".toolbar").getBoundingClientRect().bottom,
    };
  });
  assert.equal(layout.contentWidth, layout.viewportWidth, "Welcome fits the minimum window width");
  assert.ok(layout.headingTop >= layout.toolbarBottom, "Welcome content remains reachable at minimum height");
  await page.screenshot({ path: "artifacts/welcome-small.png" });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1520, 960));
  await page.getByRole("button", { name: /Explore the sample/ }).click();
  await expect(page.getByText("Indexed", { exact: true })).toBeVisible({ timeout: 60000 });
  assert.deepEqual(await page.evaluate(() => window.codyssey.recent()), []);
  await home(page);

  await choose(page, first);
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => { globalThis.__vscodeUrl = url; };
  });
  await page.getByRole("button", { name: "Open in VS Code", exact: true }).click();
  await expect(page.getByText("Repository sent to VS Code")).toBeVisible();
  assert.equal(
    await app.evaluate(() => globalThis.__vscodeUrl),
    `vscode://file${pathToFileURL(firstRoot).pathname}?windowId=_blank`,
    "VS Code opens a new window without replacing another workspace",
  );
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => { throw new Error("No handler"); };
  });
  await page.getByRole("button", { name: "Open in VS Code", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Make sure Visual Studio Code is installed");
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await choose(page, second);
  await home(page);
  await expect(page.locator(".recent-open strong")).toHaveText([path.basename(second), path.basename(first)]);
  await page.getByTitle(firstRoot, { exact: true }).click();
  await expect(page.getByText("Indexed", { exact: true })).toBeVisible({ timeout: 60000 });
  await home(page);
  await expect(page.locator(".recent-open strong")).toHaveText([path.basename(first), path.basename(second)]);
  assert.match(await page.evaluate(() => window.codyssey.refresh().catch((e) => e.message)), /Open a repository first/);
  await page.screenshot({ path: "artifacts/welcome-recent.png" });

  await app.close();
  app = null;
  const saved = JSON.parse(await readFile(path.join(profile, "recent-repositories.json"), "utf8"));
  assert.deepEqual(saved.map((entry) => entry.root), [firstRoot, secondRoot]);
  // Reopen after an on-disk change to ensure a recent entry is reindexed, not cached.
  await writeFile(path.join(first, "added.py"), "NEW_VALUE = 42\n");
  await rm(second, { recursive: true });
  page = await launch();
  await expect(page.locator(".recent-open strong")).toHaveText([path.basename(first), path.basename(second)]);
  await expect(page.locator(".workspace")).toHaveCount(0);
  await page.getByTitle(secondRoot, { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("repository folder is unavailable");
  await expect(page.getByRole("heading", { name: "Start exploring" })).toBeVisible();
  await page.getByRole("button", { name: `Remove ${path.basename(second)} from recent repositories` }).click();
  await expect(page.locator(".recent-open")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByTitle(firstRoot, { exact: true }).click();
  await expect(page.getByText("Indexed", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".tree-file")).toHaveCount(2);
  await home(page);
  await page.getByRole("button", { name: `Remove ${path.basename(first)} from recent repositories` }).click();
  await expect(page.getByText("A fresh start", { exact: true })).toBeVisible();
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, "recent-repositories.json"), "utf8")), []);
  assert.deepEqual(errors, []);
  console.log("Welcome integration passed: empty startup, cancellation, explicit sample, recent ordering/deduplication, restart persistence, fresh reindexing, missing folders, removal, close, and encoded VS Code handoff/error handling.");
} finally {
  if (app) await app.close();
  await rm(workspace, { recursive: true, force: true });
}
