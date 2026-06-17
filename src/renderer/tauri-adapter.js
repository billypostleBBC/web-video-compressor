(function () {
  if (window.compressor || !window.__TAURI__) {
    return;
  }

  const tauri = window.__TAURI__;
  const invoke = tauri.core && tauri.core.invoke;
  const listen = tauri.event && tauri.event.listen;
  const dialogOpen = tauri.dialog && tauri.dialog.open;
  const getCurrentWebview = tauri.webview && tauri.webview.getCurrentWebview;
  const getCurrentWindow = tauri.window && tauri.window.getCurrentWindow;
  const LogicalSize = (tauri.window && tauri.window.LogicalSize)
    || (tauri.dpi && tauri.dpi.LogicalSize);

  if (!invoke || !listen) {
    return;
  }

  const dropPathListeners = new Set();
  const dropStateListeners = new Set();

  function notifyDropState(active, position) {
    for (const listener of dropStateListeners) {
      listener(active, position);
    }
  }

  function notifyDroppedPaths(paths, position) {
    const validPaths = Array.isArray(paths)
      ? paths.filter((path) => typeof path === "string" && path.trim())
      : [];

    if (validPaths.length === 0) {
      notifyDropState(false);
      return;
    }

    for (const listener of dropPathListeners) {
      listener(validPaths, position);
    }
  }

  async function openDialog(options) {
    if (dialogOpen) {
      return dialogOpen(options);
    }

    return invoke("plugin:dialog|open", { options });
  }

  async function registerDragDropEvents() {
    const dragDropTarget = getCurrentWebview
      ? getCurrentWebview()
      : (getCurrentWindow ? getCurrentWindow() : null);

    if (dragDropTarget && dragDropTarget.onDragDropEvent) {
      await dragDropTarget.onDragDropEvent((event) => {
        handleDragDropPayload(event.payload || {});
      });
      return;
    }

    await listen("tauri://drag-enter", (event) => {
      const payload = event.payload || {};
      handleDragDropPayload({
        type: "enter",
        paths: payload.paths,
        position: payload.position
      });
    });
    await listen("tauri://drag-over", (event) => {
      const payload = event.payload || {};
      handleDragDropPayload({
        type: "over",
        position: payload.position
      });
    });
    await listen("tauri://drag-drop", (event) => {
      const payload = event.payload || {};
      handleDragDropPayload({
        type: "drop",
        paths: payload.paths,
        position: payload.position
      });
    });
    await listen("tauri://drag-leave", () => {
      handleDragDropPayload({ type: "leave" });
    });
  }

  function handleDragDropPayload(payload) {
    if (payload.type === "enter" || payload.type === "over") {
      notifyDropState(true, payload.position);
      return;
    }

    if (payload.type === "drop") {
      notifyDropState(false, payload.position);
      notifyDroppedPaths(payload.paths, payload.position);
      return;
    }

    if (payload.type === "leave") {
      notifyDropState(false);
    }
  }

  registerDragDropEvents().catch(() => {
    notifyDropState(false);
  });

  window.compressor = {
    checkTools: () => invoke("check_tools"),
    selectFile: async () => {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "Choose a video file",
        filters: [{ name: "Video files", extensions: ["mov", "mp4"] }]
      });

      return typeof selected === "string" ? { type: "file", path: selected } : null;
    },
    selectFolder: async () => {
      const selected = await openDialog({
        multiple: false,
        directory: true,
        title: "Choose a folder of videos"
      });

      return typeof selected === "string" ? { type: "folder", path: selected } : null;
    },
    droppedPathsFromFiles: () => [],
    selectionFromDroppedPaths: (paths) =>
      invoke("selection_from_dropped_paths", { paths }),
    previewInputs: (selection) => invoke("preview_inputs", { selection }),
    releaseSelection: async () => ({ ok: true }),
    start: (options) => invoke("start", options),
    cancel: () => invoke("cancel"),
    startWindowDrag: async () => {
      if (!getCurrentWindow) {
        return false;
      }

      const currentWindow = getCurrentWindow();
      if (!currentWindow || !currentWindow.startDragging) {
        return false;
      }

      await currentWindow.startDragging();
      return true;
    },
    resizeWindowToContent: async ({ width, height }) => {
      if (!getCurrentWindow || !LogicalSize) {
        return false;
      }

      const currentWindow = getCurrentWindow();
      if (!currentWindow || !currentWindow.setSize) {
        return false;
      }

      await currentWindow.setSize(new LogicalSize(width, height));
      return true;
    },
    onEncoderEvent: (callback) => {
      const unlistenPromise = listen("encoder:event", (event) => {
        callback(event.payload);
      });

      return () => {
        unlistenPromise.then((unlisten) => unlisten());
      };
    },
    onDroppedPaths: (callback) => {
      dropPathListeners.add(callback);
      return () => dropPathListeners.delete(callback);
    },
    onDropState: (callback) => {
      dropStateListeners.add(callback);
      return () => dropStateListeners.delete(callback);
    }
  };
})();
