const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
let window, currentRoot, activeProcess;
let indexedPaths = new Set();
let indexedFiles = new Map();
let currentStubOptions = { paths: [], useVenv: false };
const popouts = new Map();
let canvasWatch = null;
let recentRepositories = [];
const resources = () =>
  app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const recentFile = () => path.join(app.getPath("userData"), "recent-repositories.json");
const rootKey = (root) => process.platform === "win32" ? root.toLowerCase() : root;
const CACHE_VERSION = 3;
const stubSettingsFile = () => path.join(app.getPath("userData"), "stub-settings.json");
function validStubOptions(value) {
  if (!value || typeof value.useVenv !== "boolean" || !Array.isArray(value.paths) || value.paths.length > 20 ||
      !value.paths.every((entry) => typeof entry === "string" && path.isAbsolute(entry) && entry.length < 4000))
    throw new Error("Invalid stub settings.");
  return { useVenv: value.useVenv, paths: [...new Set(value.paths)] };
}
async function readStubSettings() {
  try { return JSON.parse(await fs.readFile(stubSettingsFile(), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}
function registerIndex(result) {
  indexedPaths = new Set(result.files.map((file) => file.path));
  indexedFiles = new Map(result.files.map((file) => [file.path, {
    absolute: file.absolutePath || path.resolve(result.root, file.path),
    root: file.sourceRoot || result.root,
  }]));
}
function indexedFile(relative) {
  const entry = indexedFiles.get(relative);
  if (!entry) throw new Error("Invalid source path.");
  const local = path.relative(entry.root, entry.absolute);
  if (!local || local === ".." || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) throw new Error("Invalid source path.");
  return entry;
}
function insideSourceRoot(root, file) {
  const local = path.relative(root, file);
  return local && local !== ".." && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local);
}
const EXCLUDED = new Set([
  ".git", ".venv", "venv", "env", "__pycache__", "node_modules", "dist",
  "build", ".mypy_cache", ".pytest_cache", ".ruff_cache", "site-packages",
]);
const cacheDir = () => path.join(app.getPath("userData"), "analysis-cache");
const cacheFile = (root) =>
  path.join(cacheDir(), `${crypto.createHash("sha1").update(rootKey(root)).digest("hex")}.json`);

async function fingerprint(root, stubOptions) {
  const files = [];
  async function walk(dir, external = false, sourceRoot = root) {
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
        if (EXCLUDED.has(entry.name) && !(external && entry.name === "site-packages")) continue;
        await walk(full, external, sourceRoot);
      } else if ((external ? /\.(pyi|pxd)$/ : /\.(py|pyi|pyx|pxd|pxi)$/).test(entry.name)) {
        try {
          const stat = await fs.stat(full);
          files.push({
            rel: (external ? `${sourceRoot.replace(/\\/g, "/")}/` : "") + path.relative(sourceRoot, full).replace(/\\/g, "/"),
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
  const stubPaths = [...stubOptions.paths];
  if (stubOptions.useVenv) stubPaths.push(...[".venv", "venv", "env"].map((name) => path.join(root, name)));
  for (const directory of [...new Set(stubPaths)]) await walk(directory, true, directory);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { stubOptions, files };
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

async function loadIndex(root, stubOptions) {
  const fp = await fingerprint(root, stubOptions);
  const cached = await readCache(root, fp);
  if (cached) return cached;
  const result = await analyze(root, stubOptions);
  await writeCache(root, result, fp);
  return result;
}

async function reindex(root, stubOptions = currentStubOptions) {
  const result = await analyze(root, stubOptions);
  await writeCache(root, result, await fingerprint(root, stubOptions));
  registerIndex(result);
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
  const settings = await readStubSettings();
  const stubOptions = settings[rootKey(directory)] ? validStubOptions(settings[rootKey(directory)]) : { paths: [], useVenv: false };
  const result = await loadIndex(directory, stubOptions);
  if (remember) {
    await saveRecentRepositories([
      { root: directory, name: result.name, lastOpened: new Date().toISOString() },
      ...recentRepositories.filter((entry) => rootKey(entry.root) !== rootKey(directory)),
    ].slice(0, 10));
  }
  currentRoot = directory;
  currentStubOptions = stubOptions;
  stopCanvasWatch();
  registerIndex(result);
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

function stopCanvasWatch() {
  if (canvasWatch) {
    clearInterval(canvasWatch.timer);
    for (const child of canvasWatch.children) child.kill();
    canvasWatch = null;
  }
}
function watchCanvas(files) {
  if (!currentRoot || !Array.isArray(files) || files.length > 500 ||
      !files.every((file) => indexedPaths.has(file?.path) && typeof file.source === 'string' && file.source.length <= 4_000_000))
    throw new Error('Invalid canvas files.');
  stopCanvasWatch();
  const state = { root: currentRoot, children: new Set(), busy: false, timer: null,
    files: files.map((file) => ({ ...file, stamp: null })) };
  canvasWatch = state;
  async function update() {
    if (state.busy || canvasWatch !== state || window.isDestroyed()) return;
    state.busy = true;
    try {
      for (const entry of state.files) {
        if (canvasWatch !== state) break;
        try {
          const indexed = indexedFile(entry.path);
          const file = indexed.absolute;
          const realFile = await fs.realpath(file);
          if (!insideSourceRoot(indexed.root, realFile)) throw new Error('Canvas file is outside its source folder.');
          const stat = await fs.stat(realFile);
          if (stat.size > 2 * 1024 * 1024) throw new Error('Canvas file exceeds the 2 MB limit.');
          const stamp = `${stat.mtimeMs}:${stat.size}`;
          if (entry.stamp === stamp) continue;
          const result = await new Promise((resolve, reject) => {
            const child = spawn('uv', ['run', '--no-project', '--script',
              path.join(resources(), 'backend', 'canvas.py'), realFile],
            { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
            state.children.add(child);
            let output = '', error = '';
            const timer = setTimeout(() => child.kill(), 30000);
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (data) => { output += data; if (output.length > 16_000_000) child.kill(); });
            child.stderr.on('data', (data) => { error = (error + data).slice(-2000); });
            child.on('error', reject);
            child.stdin.on('error', () => {});
            child.stdin.end(JSON.stringify({ source: entry.source }));
            child.on('close', (code) => {
              clearTimeout(timer); state.children.delete(child);
              try { if (code !== 0) throw new Error(error || 'Could not track canvas file.'); resolve(JSON.parse(output)); }
              catch (failure) { reject(failure); }
            });
          });
          if (canvasWatch !== state || window.isDestroyed()) break;
          entry.stamp = stamp;
          if (result.status === 'found') entry.source = result.source;
          window.webContents.send('canvas:update', { path: entry.path, ...result });
        } catch (error) {
          if (canvasWatch === state && !window.isDestroyed())
            window.webContents.send('canvas:update', { path: entry.path, status: 'error', message: error.message });
        }
      }
    } finally { state.busy = false; }
  }
  state.timer = setInterval(update, 850);
  update();
  return true;
}

function openDeclaration(target) {
  if (!currentRoot || !indexedPaths.has(target?.path) ||
      !Array.isArray(target.chain) || !target.chain.length ||
      !target.chain.every((part) => ["class", "function"].includes(part.kind) &&
        typeof part.name === "string" && part.name.length < 200) ||
      !Number.isInteger(target.line) || target.line < 1)
    throw new Error("Invalid declaration target.");
  const indexed = indexedFile(target.path);
  const file = indexed.absolute;
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
      if (!insideSourceRoot(indexed.root, await fs.realpath(file))) throw new Error("Declaration is outside its source folder.");
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
function analyze(root, stubOptions) {
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
        ...stubOptions.paths.flatMap((directory) => ["--stub-path", directory]),
        ...(stubOptions.useVenv ? ["--use-venv"] : []),
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
      title: "Open Python or Cython repository",
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
    stopCanvasWatch();
    indexedPaths = new Set();
    indexedFiles = new Map();
    for (const state of popouts.values()) state.popup.close();
  });
  handle("declaration:open", openDeclaration);
  handle("stubs:choose", async () => {
    if (!currentRoot) throw new Error("Open a repository first.");
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"], title: "Choose a stub folder, site-packages, or virtual environment",
    });
    return result.canceled ? null : fs.realpath(result.filePaths[0]);
  });
  handle("stubs:save", async (value) => {
    if (!currentRoot) throw new Error("Open a repository first.");
    const stubOptions = validStubOptions(value);
    const result = await reindex(currentRoot, stubOptions);
    const settings = await readStubSettings();
    settings[rootKey(currentRoot)] = stubOptions;
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    await fs.writeFile(`${stubSettingsFile()}.tmp`, JSON.stringify(settings), "utf8");
    await fs.rename(`${stubSettingsFile()}.tmp`, stubSettingsFile());
    currentStubOptions = stubOptions;
    return result;
  });
  handle('canvas:watch', watchCanvas);
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
  stopCanvasWatch();
  if (activeProcess) activeProcess.kill();
  app.quit();
});
