const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
let window, currentRoot, activeProcess;
let recentRepositories = [];
const resources = () =>
  app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const recentFile = () => path.join(app.getPath("userData"), "recent-repositories.json");
const rootKey = (root) => process.platform === "win32" ? root.toLowerCase() : root;
async function readRecentRepositories() {
  try {
    const data = JSON.parse(await fs.readFile(recentFile(), "utf8"));
    const seen = new Set();
    recentRepositories = (Array.isArray(data) ? data : []).filter((entry) => {
      if (!entry || typeof entry.root !== "string" || !path.isAbsolute(entry.root) ||
          typeof entry.name !== "string" || typeof entry.lastOpened !== "string" ||
          !Number.isFinite(Date.parse(entry.lastOpened)) || seen.has(rootKey(entry.root)))
        return false;
      seen.add(rootKey(entry.root));
      return true;
    }).slice(0, 10);
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Could not read recent repositories:", error.message);
  }
}
async function saveRecentRepositories(next) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(`${recentFile()}.tmp`, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(`${recentFile()}.tmp`, recentFile());
  recentRepositories = next;
  return recentRepositories;
}
async function openRepository(root, remember = true) {
  let directory;
  try {
    directory = await fs.realpath(root);
    if (!(await fs.stat(directory)).isDirectory()) throw new Error("Not a directory");
  } catch {
    throw new Error("This repository folder is unavailable. Choose another folder or remove it from recent repositories.");
  }
  const result = await analyze(directory);
  if (remember) {
    await saveRecentRepositories([
      { root: directory, name: result.name, lastOpened: new Date().toISOString() },
      ...recentRepositories.filter((entry) => rootKey(entry.root) !== rootKey(directory)),
    ].slice(0, 10));
  }
  currentRoot = directory;
  return result;
}
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
app.whenReady().then(async () => {
  await readRecentRepositories();
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
    return result.canceled ? null : openRepository(result.filePaths[0]);
  });
  handle("repo:sample", () =>
    openRepository(path.join(resources(), app.isPackaged ? "sample" : "test/sample"), false),
  );
  handle("repo:recent", () => recentRepositories);
  handle("repo:open-recent", (root) => {
    const entry = recentRepositories.find((item) => item.root === root);
    if (!entry) throw new Error("Repository is no longer in the recent list.");
    return openRepository(entry.root);
  });
  handle("repo:remove-recent", (root) =>
    saveRecentRepositories(recentRepositories.filter((entry) => entry.root !== root)),
  );
  handle("repo:close", () => {
    if (activeProcess) throw new Error("Wait for indexing to finish before closing the repository.");
    currentRoot = null;
  });
  handle("repo:open-in-vscode", async () => {
    if (!currentRoot) throw new Error("Open a repository first.");
    const url = pathToFileURL(currentRoot);
    try {
      // Force a new window instead of replacing another repository's workspace.
      await shell.openExternal(
        `vscode://file${url.host ? `//${url.host}` : ""}${url.pathname}?windowId=_blank`,
      );
    } catch {
      throw new Error("Could not open VS Code. Make sure Visual Studio Code is installed and its vscode:// links are enabled.");
    }
    return true;
  });
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
