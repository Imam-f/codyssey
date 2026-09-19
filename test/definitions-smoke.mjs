import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const fixture = await mkdtemp(path.join(tmpdir(), "codyssey-definitions-"));
await mkdir(path.join(fixture, "pkg"));
await writeFile(
  path.join(fixture, "pkg/defs.py"),
  "LIMIT = 5\ndef work(value):\n    return value\nclass Base:\n    def save(self):\n        return self\n",
);
await writeFile(
  path.join(fixture, "pkg/__init__.py"),
  "from .defs import Base as PublicBase, work\n",
);
await writeFile(
  path.join(fixture, "consumer.py"),
  "from pkg import work as execute, PublicBase\nimport pkg.defs as models\nfrom pkg.defs import LIMIT\nclass Child(PublicBase): pass\ndef use(obj: Child):\n    execute(LIMIT)\n    obj.save()\n    models.work(LIMIT)\n    local = 1\n    return local\ndef shadow(execute):\n    execute()\ndef unknown(obj):\n    obj.save()\nimport unavailable\nunavailable.work()\n",
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
const profile = await mkdtemp(path.join(tmpdir(), "codyssey-definitions-profile-"));
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
  await page.getByRole("heading", { name: "Start exploring" }).waitFor();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, fixture);
  await page.getByTitle("Open repository · Ctrl+O").click();
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 60000 });
  async function consumer() {
    await page.locator(".tree-file").filter({ hasText: "consumer.py" }).click();
    await page
      .locator('.code-line[data-line="6"] .syntax-function')
      .filter({ hasText: /^execute$/ })
      .waitFor();
  }
  function token(line, name) {
    return page
      .locator(`.code-line[data-line="${line}"] .line-content > span`)
      .filter({ hasText: new RegExp(`^${name}$`) })
      .first();
  }
  async function destination(file, line) {
    await expect(page.locator(".breadcrumb")).toContainText(file);
    await expect(page.locator(".current-line")).toHaveAttribute(
      "data-line",
      String(line),
    );
  }
  await consumer();
  await token(6, "execute").click();
  await expect(page.locator(".symbol-title h2")).toHaveText("execute");
  await expect(page.locator(".definition-section")).toContainText(
    "pkg/defs.py",
  );
  await page.keyboard.press("F12");
  await destination("defs.py", 2);
  await page.getByTitle("Back", { exact: true }).click();
  await destination("consumer.py", 6);
  await page.keyboard.press("F12");
  await destination("defs.py", 2);

  await consumer();
  await token(6, "LIMIT").click({ modifiers: ["Control"] });
  await destination("defs.py", 1);
  await page.getByTitle("Back", { exact: true }).click();
  await destination("consumer.py", 6);
  await token(7, "save").dblclick();
  await destination("defs.py", 5);

  await consumer();
  await token(8, "work").click();
  await page.keyboard.press("F12");
  await destination("defs.py", 2);
  await consumer();
  await token(8, "models").click({ modifiers: ["Control"] });
  await destination("defs.py", 1);

  await consumer();
  await token(1, "work").dblclick();
  await destination("defs.py", 2);
  await consumer();
  await token(4, "PublicBase").click({ modifiers: ["Control"] });
  await destination("defs.py", 4);
  await consumer();
  await token(6, "execute").click();
  await page.getByTitle("Go to definition", { exact: true }).click();
  await destination("defs.py", 2);

  await consumer();
  await token(12, "execute").click();
  await page.keyboard.press("F12");
  await destination("consumer.py", 11);
  await token(10, "local").click();
  await page.keyboard.press("F12");
  await destination("consumer.py", 9);
  await token(14, "save").click();
  await page.keyboard.press("F12");
  await destination("consumer.py", 14);
  await expect(
    page.getByText("No definition found in the indexed repository", {
      exact: true,
    }),
  ).toBeVisible();
  await token(16, "work").click({ modifiers: ["Control"] });
  await destination("consumer.py", 16);
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  await consumer();
  await token(6, "execute").click();
  await page.screenshot({ path: "artifacts/cross-file-definition.png" });
  console.log(
    "Cross-file navigation passed: F12, Ctrl+click, double-click, inspector links, back history, imports, re-exports, constants, modules, inherited methods, local shadowing and unresolved targets.",
  );
} finally {
  await app.close();
}
