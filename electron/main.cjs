const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
let window, currentRoot, activeProcess;
const resources = () =>
  app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
function analyze(root) {
  return new Promise((resolve, reject) => {
    if (activeProcess)
      return reject(new Error("An analysis is already running."));
    const child = spawn(
      "uv",
      [
        "run",
        "--no-project",
        "--script",
        path.join(resources(), "backend", "analyzer.py"),
        root,
      ],
      { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
    );
    activeProcess = child;
    let out = "",
      err = "",
      bytes = 0,
      overflow = false;
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      bytes += Buffer.byteLength(data);
      if (bytes > 100 * 1024 * 1024) {
        overflow = true;
        child.kill();
      } else out += data;
    });
    child.stderr.on("data", (data) => {
      err = (err + data).slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      activeProcess = null;
      reject(
        new Error(
          error.code === "ENOENT"
            ? "uv was not found. Install uv and restart Codyssey."
            : error.message,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      activeProcess = null;
      if (overflow)
        return reject(
          new Error(
            "Repository index exceeds the 100 MB limit. Open a smaller folder.",
          ),
        );
      try {
        const result = JSON.parse(out);
        if (code !== 0 || result.error)
          throw new Error(result.error || err || "Analysis timed out.");
        currentRoot = root;
        resolve(result);
      } catch (error) {
        reject(
          new Error(
            error.message.startsWith("Unexpected")
              ? err || "Analysis failed or timed out."
              : error.message,
          ),
        );
      }
    });
  });
}
app.whenReady().then(() => {
  window = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1000,
    minHeight: 650,
    title: "Codyssey",
    backgroundColor: "#101215",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devURL = process.env.CODYSSEY_DEV_URL;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  function handle(channel, fn) {
    ipcMain.handle(channel, (event, ...args) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Unauthorized frame");
      return fn(...args);
    });
  }
  handle("repo:open", async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "Open Python repository",
    });
    return result.canceled ? null : analyze(result.filePaths[0]);
  });
  handle("repo:sample", () => analyze(path.join(resources(), "sample")));
  handle("repo:refresh", () => {
    if (!currentRoot) throw new Error("Open a repository first.");
    return analyze(currentRoot);
  });
  handle("repo:export", async (data) => {
    if (typeof data !== "string" || data.length > 100 * 1024 * 1024)
      throw new Error("Invalid report");
    const result = await dialog.showSaveDialog(window, {
      defaultPath: "codyssey-analysis.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!result.canceled) {
      await fs.writeFile(result.filePath, data, "utf8");
      return true;
    }
    return false;
  });
  if (devURL) window.loadURL(devURL);
  else window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
});
app.on("window-all-closed", () => {
  if (activeProcess) activeProcess.kill();
  app.quit();
});
