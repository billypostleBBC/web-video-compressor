const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("compressor", {
  checkTools: () => ipcRenderer.invoke("tools:check"),
  selectFile: () => ipcRenderer.invoke("dialog:select-file"),
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
  droppedPathsFromFiles: (files) =>
    Array.from(files)
      .map((file) => webUtils.getPathForFile(file))
      .filter(Boolean),
  selectionFromDroppedPaths: (paths) =>
    ipcRenderer.invoke("inputs:selection-from-dropped-paths", paths),
  previewInputs: (selection) => ipcRenderer.invoke("inputs:preview", selection),
  start: (options) => ipcRenderer.invoke("encoder:start", options),
  cancel: () => ipcRenderer.invoke("encoder:cancel"),
  onEncoderEvent: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on("encoder:event", listener);
    return () => ipcRenderer.removeListener("encoder:event", listener);
  }
});
