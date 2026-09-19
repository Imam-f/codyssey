import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
const profile = await mkdtemp(path.join(tmpdir(), "codyssey-smoke-profile-"));
const app = await electron.launch({
  ...(process.env.CODYSSEY_EXECUTABLE
    ? { executablePath: process.env.CODYSSEY_EXECUTABLE, args: [`--user-data-dir=${profile}`] }
    : { args: [".", `--user-data-dir=${profile}`] }),
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: /Explore the sample/ }).click();
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 60000 });
  await page
    .locator(".statusbar")
    .getByText("Tree-sitter", { exact: true })
    .waitFor({ timeout: 30000 });
  assert.equal(
    (await page.locator(".syntax-keyword").count()) > 10,
    true,
    "Tree-sitter highlights Python keywords",
  );
  assert.equal(await page.locator(".symbol-title h2").textContent(), "user");
  assert.equal(await page.locator(".reference-row").count(), 5);
  const minimap = page.getByRole("scrollbar", { name: "Code minimap" });
  assert.equal(await minimap.getAttribute("aria-valuenow"), "24");
  const lastLine = await minimap.getAttribute("aria-valuemax");
  await minimap.focus();
  await page.keyboard.press("End");
  assert.equal(await minimap.getAttribute("aria-valuenow"), lastLine);
  assert.equal(
    await page.locator(".current-line").getAttribute("data-line"),
    lastLine,
  );
  await page.locator('.code-line[data-line="24"] .line-number').click();
  await page
    .locator(".view-tabs")
    .getByRole("button", { name: /Overview/ })
    .click();
  assert.equal(
    (await page.locator(".overview-table tbody tr").count()) >= 5,
    true,
    "Overview lists the sample files with metrics",
  );
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/overview.png" });
  await page
    .locator(".view-tabs")
    .getByRole("button", { name: /Call graph/ })
    .click();
  assert.match(
    await page.locator(".selected-function .call-node-header").textContent(),
    /UserService.update_email/,
  );
  assert.equal(await page.locator(".callers .call-node").count(), 1);
  assert.equal(await page.locator(".callees .call-node").count(), 4);
  await page.getByRole("checkbox", { name: "Show unresolved" }).uncheck();
  assert.equal(await page.locator(".callees .call-node").count(), 2);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/call-graph.png" });
  await page
    .getByRole("group", { name: "Call graph direction" })
    .getByRole("button", { name: "Called by", exact: true })
    .click();
  assert.equal(await page.locator(".callees").count(), 0);
  await page
    .getByRole("group", { name: "Call graph direction" })
    .getByRole("button", { name: "Both directions" })
    .click();
  await page
    .getByRole("textbox", { name: "Find function" })
    .fill("Repository.save");
  assert.equal(
    await page.locator(".call-function-results > button").count(),
    1,
  );
  await page.locator(".call-function-results > button").click();
  assert.equal(await page.locator(".callers .call-node").count(), 3);
  await page.getByTitle("Open definition of Repository.save").click();
  assert.equal(await page.locator(".symbol-title h2").textContent(), "save");
  await page
    .locator(".call-relations")
    .getByTitle("Open call site atlas/service.py:32")
    .click();
  assert.equal(
    await page.locator(".symbol-title h2").textContent(),
    "update_email",
  );
  assert.equal(
    await page.locator(".current-line").getAttribute("data-line"),
    "32",
  );
  await page
    .locator('.code-line[data-line="24"] .clickable-token')
    .filter({ hasText: /^user$/ })
    .click();
  await page.locator(".detail-link").getByText("User", { exact: true }).click();
  assert.equal(await page.locator(".symbol-title h2").textContent(), "User");
  assert.match(await page.locator(".breadcrumb").textContent(), /models.py/);
  await page.getByRole("button", { name: "Inheritance", exact: false }).click();
  assert.equal((await page.locator(".graph-node").count()) >= 10, true);
  assert.equal(
    (await page.locator(".graph-inner > svg > path").count()) >= 7,
    true,
  );
  await page
    .getByRole("textbox", { name: "Find class" })
    .fill("CachedUserRepository");
  assert.equal(await page.locator(".graph-node").count(), 3);
  await page.getByRole("textbox", { name: "Find class" }).fill("");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/inheritance.png" });
  await page.getByRole("button", { name: "Class tracker", exact: true }).click();
  assert.equal((await page.locator(".class-member-group").count()) > 0, true);
  await page
    .getByRole("textbox", { name: "Find tracked class or member" })
    .fill("save");
  assert.equal((await page.locator(".class-tracker-list > button").count()) >= 3, true);
  await page.getByRole("button", { name: "Inheritance", exact: false }).click();
  await page
    .locator(".graph-node-title")
    .filter({ hasText: "UserService" })
    .first()
    .click();
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "Aliases", exact: false })
    .click();
  assert.equal(await page.locator(".alias-card").count(), 6);
  await page.keyboard.press("Control+p");
  await page
    .getByRole("textbox", { name: "Search files and symbols" })
    .fill("update_email");
  assert.equal(await page.locator(".palette-results > button").count(), 2);
  await page.locator(".palette-results > button").first().click();
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "Inspect", exact: true })
    .click();
  await page
    .locator('.code-line[data-line="24"] .clickable-token')
    .filter({ hasText: /^user$/ })
    .click();
  await page.screenshot({ path: "artifacts/source.png" });
  await page
    .getByRole("button", { name: "Variables & symbols", exact: false })
    .click();
  assert.equal((await page.locator(".bottom-content tbody tr").count()) >= 5, true);
  await page.getByRole("button", { name: "Problems", exact: false }).click();
  await page.getByText("No parse errors in indexed files.").waitFor();
  await page.getByRole("button", { name: "Re-index repository · F5" }).click();
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 60000 });
  const fixture = await mkdtemp(path.join(tmpdir(), "codyssey-smoke-"));
  await writeFile(
    path.join(fixture, "example.py"),
    "class Base: pass\nclass Child(Base): pass\ndef f(value: Child):\n    result = value\n    return result\ndef recursive():\n    recursive()\n",
  );
  await writeFile(path.join(fixture, "broken.py"), "def invalid(:\n");
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, fixture);
  await page.getByTitle("Open repository · Ctrl+O").click();
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Problems", exact: false }).click();
  assert.equal(await page.locator(".diagnostic").count(), 1);
  await page.getByRole("textbox", { name: "Filter files" }).fill("example");
  assert.equal(await page.locator(".tree-file").count(), 1);
  await page.locator(".tree-file").click();
  await page.keyboard.press("Control+f");
  await page.getByRole("textbox", { name: "Filter symbols" }).fill("result");
  assert.equal(await page.locator(".bottom-content tbody tr").count(), 1);
  const report = path.join(fixture, "report.json");
  await app.evaluate(({ dialog }, reportPath) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: reportPath,
    });
  }, report);
  await page.getByRole("button", { name: "Export analysis as JSON" }).click();
  await page.getByText("Analysis exported").waitFor();
  const exported = JSON.parse(await readFile(report, "utf8"));
  assert.equal(exported.stats.files, 2);
  assert.equal(exported.diagnostics.length, 1);
  assert.equal(exported.callGraph.sites.length, 1);
  await page
    .locator(".view-tabs")
    .getByRole("button", { name: /Call graph/ })
    .click();
  await page.getByRole("textbox", { name: "Find function" }).fill("recursive");
  await page.locator(".call-function-results > button").click();
  await page.getByText("Calls itself", { exact: true }).waitFor();
  await page.getByTitle("Open recursive call").click();
  assert.equal(
    await page.locator(".current-line").getAttribute("data-line"),
    "7",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Electron smoke passed: uv analysis, Tree-sitter, usages, types, aliases, inheritance, call graph, callers/callees, call-site navigation, recursion, unresolved filter, search, diagnostics, refresh, repository open and JSON export.",
  );
} finally {
  await app.close();
}
