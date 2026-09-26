const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
let window, currentRoot, activeProcess;
let indexedPaths = new Set();
const popouts = new Map();
let recentRepositories = [];
const resources = () =>
  app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const recentFile = () => path.join(app.getPath("userData"), "recent-repositories.json");
const rootKey = (root) => process.platform === "win32" ? root.toLowerCase() : root;
const CACHE_VERSION = 1;
const EXCLUDED = new Set([
  ".git", ".venv", "venv", "env", "__pycache__", "node_modules", "dist",
  "build", ".mypy_cache", ".pytest_cache", ".ruff_cache", "site-packages",
]);
const cacheDir = () => path.join(app.getPath("userData"), "analysis-cache");
const cacheFile = (root) =>
  path.join(cacheDir(), `${crypto.createHash("sha1").update(rootKey(root)).digest("hex")}.json`);

async function fingerprint(root) {
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (EXCLUDED.has(entry.name)) continue;
        await walk(full);
      } else if (entry.name.endsWith(".py") || entry.name.endsWith(".pyi")) {
        try {
          const stat = await fs.stat(full);
          files.push({
            rel: path.relative(root, full).replace(/\\/g, "/"),
            size: stat.size,
            mtime: Math.round(stat.mtimeMs),
          });
        } catch {
          /* unreadable file; the analyzer will also skip it */
        }
      }
    }
  }
  await walk(root);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return files;
}

async function readCache(root, fp) {
  try {
    const raw = JSON.parse(await fs.readFile(cacheFile(root), "utf8"));
    if (
      raw.version === CACHE_VERSION &&
      raw.appVersion === app.getVersion() &&
      JSON.stringify(raw.fingerprint) === JSON.stringify(fp)
    )
      return raw.result;
  } catch {
    /* cache miss, corrupt, or invalidated */
  }
  return null;
}

async function writeCache(root, result, fp) {
  try {
    await fs.mkdir(cacheDir(), { recursive: true });
    const file = cacheFile(root);
    await fs.writeFile(
      `${file}.tmp`,
      JSON.stringify({ version: CACHE_VERSION, appVersion: app.getVersion(), root, fingerprint: fp, result }),
      "utf8",
    );
    await fs.rename(`${file}.tmp`, file);
  } catch (error) {
    console.warn("Could not write analysis cache:", error.message);
  }
}

async function loadIndex(root) {
  const fp = await fingerprint(root);
  const cached = await readCache(root, fp);
  if (cached) return cached;
  const result = await analyze(root);
  await writeCache(root, result, fp);
  return result;
}

async function reindex(root) {
  const result = await analyze(root);
  await writeCache(root, result, await fingerprint(root));
  indexedPaths = new Set(result.files.map((file) => file.path));
  return result;
}

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
  const result = await loadIndex(directory);
  if (remember) {
    await saveRecentRepositories([
      { root: directory, name: result.name, lastOpened: new Date().toISOString() },
      ...recentRepositories.filter((entry) => rootKey(entry.root) !== rootKey(directory)),
    ].slice(0, 10));
  }
  currentRoot = directory;
  indexedPaths = new Set(result.files.map((file) => file.path));
  return result;
}
function inspectDeclaration(file, target) {
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "--no-project", "--script",
      path.join(resources(), "backend", "declaration.py"), file, JSON.stringify(target)],
    { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => { output = (output + data).slice(0, 4_000_000); });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        if (code !== 0) throw new Error("Could not inspect declaration.");
        resolve(JSON.parse(output));
      } catch (error) { reject(error); }
    });
  });
}

function openDeclaration(target) {
  if (!currentRoot || !indexedPaths.has(target?.path) ||
      !Array.isArray(target.chain) || !target.chain.length ||
      !target.chain.every((part) => ["class", "function"].includes(part.kind) &&
        typeof part.name === "string" && part.name.length < 200) ||
      !Number.isInteger(target.line) || target.line < 1)
    throw new Error("Invalid declaration target.");
  const file = path.resolve(currentRoot, target.path);
  if (!file.startsWith(currentRoot + path.sep))
    throw new Error("Invalid declaration path.");
  const popup = new BrowserWindow({
    width: 360, height: 180, minWidth: 360, minHeight: 180,
    frame: false, alwaysOnTop: true, autoHideMenuBar: true,
    backgroundColor: "#101215", title: target.chain.at(-1).name,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  const state = { popup, target: { ...target }, file, lastStamp: null,
    current: { status: "loading" }, lastFound: null, busy: false, timer: null };
  const popupId = popup.webContents.id;
  popouts.set(popupId, state);
  popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  popup.webContents.on("will-navigate", (event) => event.preventDefault());
  async function update() {
    if (state.busy || popup.isDestroyed()) return;
    state.busy = true;
    try {
      const stat = await fs.stat(file);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      if (stamp === state.lastStamp) return;
      state.lastStamp = stamp;
      const result = await inspectDeclaration(file, state.target);
      if (result.status === "found") {
        state.target.line = result.line;
        state.lastFound = result;
      }
      state.current = result.status === "invalid" && state.lastFound
        ? { ...state.lastFound, status: "stale", message: result.message }
        : result;
    } catch (error) {
      state.lastStamp = null;
      state.current = { status: "error", message: error.message };
    } finally {
      state.busy = false;
      if (!popup.isDestroyed()) popup.webContents.send("declaration:update", state.current);
    }
  }
  popup.on("closed", () => {
    clearInterval(state.timer);
    popouts.delete(popupId);
  });
  state.timer = setInterval(update, 850);
  if (process.env.CODYSSEY_DEV_URL)
    popup.loadURL(`${process.env.CODYSSEY_DEV_URL}?popout=1`);
  else popup.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query: { popout: "1" } });
  update();
  return true;
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
    indexedPaths = new Set();
    for (const state of popouts.values()) state.popup.close();
  });
  handle("declaration:open", openDeclaration);
  ipcMain.handle("declaration:state", (event) => {
    const state = popouts.get(event.sender.id);
    if (!state || event.senderFrame !== event.sender.mainFrame)
      throw new Error("Unauthorized frame");
    return { target: state.target, current: state.current };
  });
  ipcMain.handle("declaration:close", (event) => {
    const state = popouts.get(event.sender.id);
    if (!state || event.senderFrame !== event.sender.mainFrame)
      throw new Error("Unauthorized frame");
    state.popup.close();
  });
  ipcMain.handle("declaration:fit", (event, size) => {
    const state = popouts.get(event.sender.id);
    if (!state || event.senderFrame !== event.sender.mainFrame)
      throw new Error("Unauthorized frame");
    if (!Number.isFinite(size?.width) || !Number.isFinite(size?.height))
      throw new Error("Invalid declaration size.");
    const popup = state.popup;
    const workArea = screen.getDisplayMatching(popup.getBounds()).workArea;
    const width = Math.min(Math.max(360, Math.ceil(size.width)), 680, workArea.width);
    const height = Math.min(Math.max(180, Math.ceil(size.height)), 520, workArea.height);
    const bounds = popup.getBounds();
    if (bounds.width === width && bounds.height === height) return;
    popup.setBounds({
      x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
      y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
      width, height,
    });
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
    return reindex(currentRoot);
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
