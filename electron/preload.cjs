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
  export: (data) => ipcRenderer.invoke("repo:export", data),
  openDeclaration: (target) => ipcRenderer.invoke("declaration:open", target),
  declarationState: () => ipcRenderer.invoke("declaration:state"),
  closeDeclaration: () => ipcRenderer.invoke("declaration:close"),
  fitDeclaration: (size) => ipcRenderer.invoke("declaration:fit", size),
  onDeclarationUpdate: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("declaration:update", listener);
    return () => ipcRenderer.removeListener("declaration:update", listener);
  },
});
