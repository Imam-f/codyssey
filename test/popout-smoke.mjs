import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODYSSEY_DEV_URL;
const profile = await mkdtemp(path.join(tmpdir(), "codyssey-popout-profile-"));
const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: /Explore the sample/ }).click();
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 60000 });
  const nextWindow = app.waitForEvent("window");
  await page.locator('.breadcrumb button[aria-label^="Pop "]').click();
  const popup = await nextWindow;
  await popup.getByRole("region", { name: "Declaration source" }).waitFor();
  assert.equal(await popup.locator(".popup-info-popover").isVisible(), false);
  await popup.getByRole("button", { name: "Declaration information" }).hover();
  await popup.locator(".popup-info-popover").waitFor({ state: "visible" });
  assert.match(await popup.locator(".popup-info-popover").textContent(), /update_email/);
  assert.match(await popup.locator(".popup-info-popover").textContent(), /atlas\/service\.py/);
  await popup.mouse.move(120, 130);
  await popup.locator(".popup-info-popover").waitFor({ state: "hidden" });
  assert.match(await popup.locator(".popup-code").textContent(), /def update_email/);
  await popup.locator(".popup-code .syntax-keyword").first().waitFor();
  const fullLineCount = await popup.locator(".popup-code-line").count();
  await popup.getByRole("button", { name: "Collapse block" }).first().click();
  assert.ok(await popup.locator(".popup-code-line").count() < fullLineCount);
  await popup.getByRole("button", { name: "Expand folded block" }).first().click();
  assert.equal(await popup.locator(".popup-code-line").count(), fullLineCount);
  await popup.getByRole("button", { name: "Fold all blocks", exact: true }).click();
  assert.ok(await popup.locator(".popup-code-line").count() < fullLineCount);
  await popup.getByRole("button", { name: "Unfold all blocks", exact: true }).click();
  assert.equal(await popup.locator(".popup-code-line").count(), fullLineCount);
  assert.equal(await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((item) => !item.isDestroyed() && item.isAlwaysOnTop())), true);
  const closed = popup.waitForEvent("close");
  await popup.getByRole("button", { name: "Close declaration window" }).click();
  await closed;
  await page.locator(".view-tabs").getByRole("button", { name: /Class tracker/ }).click();
  const classWindow = app.waitForEvent("window");
  await page.locator('.class-detail-title button[title^="Pop "]').click();
  const classPopup = await classWindow;
  await classPopup.getByRole("region", { name: "Declaration source" }).waitFor();
  assert.match(await classPopup.locator(".popup-code").textContent(), /class /);
  await classPopup.getByRole("button", { name: "Close declaration window" }).click();
  await page.locator(".view-tabs").getByRole("button", { name: /Call graph/ }).click();
  const functionWindow = app.waitForEvent("window");
  await page.locator('.selected-function button[title^="Pop "]').click();
  const functionPopup = await functionWindow;
  await functionPopup.getByRole("region", { name: "Declaration source" }).waitFor();
  assert.match(await functionPopup.locator(".popup-code").textContent(), /def /);
  const fixture = await mkdtemp(path.join(tmpdir(), "codyssey-popout-fixture-"));
  const sourceFile = path.join(fixture, "example.py");
  await writeFile(sourceFile, "class Example:\n    def run(self):\n        return 1\n");
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, fixture);
  await page.getByTitle("Open repository · Ctrl+O").click();
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 60000 });
  const liveWindow = app.waitForEvent("window");
  await page.locator('.code-line[data-line="2"] .declaration-pop').click();
  const livePopup = await liveWindow;
  await livePopup.getByText("return 1").waitFor();
  await livePopup.waitForFunction(() => window.innerHeight < 300);
  await writeFile(sourceFile, "# inserted above\n\nclass Example:\n    def run(self):\n        return 2\n");
  await livePopup.getByText("return 2").waitFor({ timeout: 10000 });
  await livePopup.locator(".syntax-keyword").filter({ hasText: "return" }).waitFor();
  await livePopup.getByRole("button", { name: "Declaration information" }).hover();
  assert.match(await livePopup.locator(".popup-info-popover").textContent(), /:4–5/);
  const longBody = [
    ...Array.from({ length: 60 }, (_, index) => `        value_${index} = ${index}`),
    `        label = "${"x".repeat(400)}"`,
  ].join("\n");
  await writeFile(sourceFile, `# inserted above\n\nclass Example:\n    def run(self):\n${longBody}\n        return 2\n`);
  await livePopup.waitForFunction(() => document.querySelectorAll(".popup-code-line").length > 60);
  await livePopup.waitForFunction(() => window.innerHeight >= 500);
  assert.equal(await livePopup.locator(".popup-code").evaluate((element) => element.scrollHeight > element.clientHeight), true);
  assert.equal(await livePopup.locator(".popup-code").evaluate((element) => element.scrollWidth > element.clientWidth), true);
  await livePopup.getByRole("button", { name: "Fold all blocks", exact: true }).click();
  await livePopup.waitForFunction(() => window.innerHeight < 300);
  await livePopup.getByRole("button", { name: "Unfold all blocks", exact: true }).click();
  await livePopup.waitForFunction(() => window.innerHeight >= 500);
  await writeFile(sourceFile, "def broken(:\n");
  await livePopup.locator(".popup-stale-message").waitFor({ timeout: 10000 });
  assert.match(await livePopup.locator(".popup-code").textContent(), /return 2/);
} finally {
  await app.close();
}
