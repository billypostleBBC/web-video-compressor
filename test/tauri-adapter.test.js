const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const adapterSource = fs.readFileSync(
  path.join(__dirname, "../src/renderer/tauri-adapter.js"),
  "utf8"
);
const capability = JSON.parse(fs.readFileSync(
  path.join(__dirname, "../src-tauri/capabilities/main.json"),
  "utf8"
));

function loadAdapter(tauri) {
  const context = {
    window: {
      __TAURI__: tauri
    }
  };

  vm.runInNewContext(adapterSource, context);
  return context.window.compressor;
}

test("Tauri adapter opens file dialog through plugin command when global dialog helper is absent", async () => {
  const calls = [];
  const compressor = loadAdapter({
    core: {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        if (command === "plugin:dialog|open") {
          return "/work/source/clip.mov";
        }
        return null;
      }
    },
    event: {
      listen: async () => () => {}
    }
  });

  const selection = await compressor.selectFile();

  assert.deepEqual(JSON.parse(JSON.stringify(selection)), {
    type: "file",
    path: "/work/source/clip.mov"
  });
  assert.equal(calls[0].command, "plugin:dialog|open");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload.options.filters)), [
    { name: "Video files", extensions: ["mov", "mp4"] }
  ]);
});

test("Tauri adapter receives dropped file paths from raw Tauri drag events", async () => {
  const listeners = new Map();
  const compressor = loadAdapter({
    core: {
      invoke: async () => null
    },
    event: {
      listen: async (eventName, callback) => {
        listeners.set(eventName, callback);
        return () => listeners.delete(eventName);
      }
    }
  });

  let droppedPaths = null;
  compressor.onDroppedPaths((paths) => {
    droppedPaths = paths;
  });

  await new Promise((resolve) => setImmediate(resolve));

  await listeners.get("tauri://drag-drop")({
    payload: {
      paths: ["/work/source/clip.mov"],
      position: { x: 10, y: 20 }
    }
  });

  assert.deepEqual(JSON.parse(JSON.stringify(droppedPaths)), ["/work/source/clip.mov"]);
});

test("Tauri adapter starts native window dragging when available", async () => {
  let dragStarted = false;
  const compressor = loadAdapter({
    core: {
      invoke: async () => null
    },
    event: {
      listen: async () => () => {}
    },
    window: {
      getCurrentWindow: () => ({
        startDragging: async () => {
          dragStarted = true;
        }
      })
    }
  });

  const result = await compressor.startWindowDrag();

  assert.equal(result, true);
  assert.equal(dragStarted, true);
});

test("Tauri adapter resizes the native window to measured content", async () => {
  let resizedTo = null;
  class LogicalSize {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
  }

  const compressor = loadAdapter({
    core: {
      invoke: async () => null
    },
    event: {
      listen: async () => () => {}
    },
    window: {
      LogicalSize,
      getCurrentWindow: () => ({
        setSize: async (size) => {
          resizedTo = size;
        }
      })
    }
  });

  const result = await compressor.resizeWindowToContent({ width: 474, height: 464 });

  assert.equal(result, true);
  assert(resizedTo instanceof LogicalSize);
  assert.deepEqual(JSON.parse(JSON.stringify(resizedTo)), {
    width: 474,
    height: 464
  });
});

test("Tauri main capability allows file selection and drop event APIs", () => {
  assert.deepEqual(capability.windows, ["main"]);
  assert(capability.permissions.includes("core:default"));
  assert(capability.permissions.includes("core:window:allow-start-dragging"));
  assert(capability.permissions.includes("core:window:allow-set-size"));
  assert(capability.permissions.includes("dialog:allow-open"));
});
