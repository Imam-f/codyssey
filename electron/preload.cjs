const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("codyssey", {
  open: () => ipcRenderer.invoke("repo:open"),
  sample: () => ipcRenderer.invoke("repo:sample"),
  refresh: () => ipcRenderer.invoke("repo:refresh"),
  export: (data) => ipcRenderer.invoke("repo:export", data),
});
