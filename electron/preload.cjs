const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("codyssey", {
  open: () => ipcRenderer.invoke("repo:open"),
  sample: () => ipcRenderer.invoke("repo:sample"),
  recent: () => ipcRenderer.invoke("repo:recent"),
  openRecent: (root) => ipcRenderer.invoke("repo:open-recent", root),
  removeRecent: (root) => ipcRenderer.invoke("repo:remove-recent", root),
  close: () => ipcRenderer.invoke("repo:close"),
  openInVSCode: () => ipcRenderer.invoke("repo:open-in-vscode"),
  refresh: () => ipcRenderer.invoke("repo:refresh"),
  saveTypes: (path, text) => ipcRenderer.invoke("types:save", path, text),
  export: (data) => ipcRenderer.invoke("repo:export", data),
});
