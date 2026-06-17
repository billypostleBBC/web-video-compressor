const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const exportPlanSource = fs.readFileSync(
  path.join(__dirname, "../src/renderer/export-plan.js"),
  "utf8"
);
const browserAdapterSource = fs.readFileSync(
  path.join(__dirname, "../src/renderer/browser-adapter.js"),
  "utf8"
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBrowserAdapter({ windowOverrides = {} } = {}) {
  const appendedInputs = [];
  const objectUrls = [];
  const navigator = windowOverrides.navigator || { maxTouchPoints: 0 };
  const context = {
    globalThis: {},
    Blob: class Blob {},
    File: class File {},
    WebAssembly: {},
    window: {
      Worker: class Worker {},
      WebAssembly: {},
      File: class File {},
      Blob: class Blob {},
      innerWidth: 1024,
      navigator,
      matchMedia: () => ({ matches: false }),
      setTimeout: (callback) => setTimeout(callback, 0),
      clearTimeout,
      URL: {
        createObjectURL: (file) => {
          objectUrls.push(file.name || "blob");
          return `blob:${file.name || "test"}`;
        },
        revokeObjectURL: () => {}
      }
    },
    document: {
      body: {
        append: (element) => appendedInputs.push(element)
      },
      createElement: (tagName) => {
        if (tagName === "video") {
          const listeners = new Map();
          return {
            muted: false,
            preload: "",
            duration: 125,
            addEventListener: (eventName, callback) => listeners.set(eventName, callback),
            set src(_value) {
              listeners.get("loadedmetadata")();
            }
          };
        }

        assert.equal(tagName, "input");
        const listeners = new Map();
        return {
          tagName,
          hidden: false,
          multiple: false,
          accept: "",
          files: [],
          addEventListener: (eventName, callback) => listeners.set(eventName, callback),
          click: () => {},
          remove: () => {},
          dispatchChange(files) {
            this.files = files;
            listeners.get("change")();
          }
        };
      }
    }
  };
  Object.assign(context.window, windowOverrides);

  vm.runInNewContext(exportPlanSource, context);
  vm.runInNewContext(browserAdapterSource, context);

  return {
    compressor: context.window.compressor,
    appendedInputs,
    objectUrls
  };
}

test("browser adapter installs only outside Tauri and reports browser encoder availability", async () => {
  const { compressor } = loadBrowserAdapter();

  assert.equal(typeof compressor.selectFile, "function");
  assert.deepEqual(plain(await compressor.checkTools()), {
    ok: true,
    ffmpegPath: null,
    message: "Browser encoder is available. Files stay on this device."
  });
});

test("browser adapter selects multiple local video files with browser-safe IDs", async () => {
  const { compressor, appendedInputs } = loadBrowserAdapter();
  const selectionPromise = compressor.selectFile();

  assert.equal(appendedInputs.length, 1);
  assert.equal(appendedInputs[0].accept, ".mov,.mp4");
  assert.equal(appendedInputs[0].multiple, true);

  appendedInputs[0].dispatchChange([
    { name: "launch.mov", size: 100, lastModified: 1 },
    { name: "notes.txt", size: 10, lastModified: 2 },
    { name: "case-study.MP4", size: 200, lastModified: 3 }
  ]);

  const selection = await selectionPromise;
  assert.equal(selection.type, "files");
  assert.deepEqual(plain(selection.names), ["launch.mov", "case-study.MP4"]);
  assert.deepEqual(plain(selection.rejectedNames), ["notes.txt"]);
  assert.equal(selection.fileIds.length, 2);

  const preview = await compressor.previewInputs(selection);
  assert.equal(preview.outputDir, null);
  assert.deepEqual(plain(preview.guidance), [
    "Selected 2 files (1 MB total, longest 2m 05s).",
    "Encoding stays on this device and may take longer than the desktop app.",
    "Ignored 1 unsupported file: notes.txt. Use .mov or .mp4."
  ]);
  assert.deepEqual(
    plain(
    preview.videos.map(({ id, name, displayName, size, lastModified, durationSeconds }) => ({
      id,
      name,
      displayName,
      size,
      lastModified,
      durationSeconds
    }))
    ),
    [
      {
        id: selection.fileIds[0],
        name: "launch.mov",
        displayName: "launch.mov",
        size: 100,
        lastModified: 1,
        durationSeconds: 125
      },
      {
        id: selection.fileIds[1],
        name: "case-study.MP4",
        displayName: "case-study.MP4",
        size: 200,
        lastModified: 3,
        durationSeconds: 125
      }
    ]
  );
});

test("browser adapter warns before encoding large browser selections", async () => {
  const { compressor, appendedInputs } = loadBrowserAdapter();
  const selectionPromise = compressor.selectFile();

  appendedInputs[0].dispatchChange([
    { name: "large.mov", size: 600 * 1024 * 1024, lastModified: 1 }
  ]);

  const preview = await compressor.previewInputs(await selectionPromise);

  assert.deepEqual(plain(preview.guidance), [
    "Selected 1 file (600 MB total, longest 2m 05s).",
    "Browser encoding can be slow or run out of memory on large or long videos; keep this tab open and use the desktop app if it fails."
  ]);
});

test("browser adapter recommends desktop browsers in small touch contexts", async () => {
  const { compressor, appendedInputs } = loadBrowserAdapter({
    windowOverrides: {
      innerWidth: 390,
      navigator: { maxTouchPoints: 5 },
      matchMedia: () => ({ matches: true })
    }
  });
  const selectionPromise = compressor.selectFile();

  appendedInputs[0].dispatchChange([
    { name: "phone-selected.mov", size: 100, lastModified: 1 }
  ]);

  const preview = await compressor.previewInputs(await selectionPromise);

  assert.deepEqual(plain(preview.guidance), [
    "Selected 1 file (1 MB total, longest 2m 05s).",
    "Encoding stays on this device and may take longer than the desktop app.",
    "Large video processing is desktop-recommended; mobile and small-screen browsers may fail sooner because of memory limits."
  ]);
});

test("browser adapter converts dropped FileList entries into a previewable selection", async () => {
  const { compressor } = loadBrowserAdapter();
  const dropPayload = compressor.droppedPathsFromFiles([
    { name: "dropped.mov", size: 100, lastModified: 1 },
    { name: "ignored.webm", size: 100, lastModified: 1 }
  ]);

  assert.equal(dropPayload.records.length, 1);
  assert.deepEqual(plain(dropPayload.rejectedNames), ["ignored.webm"]);

  const result = await compressor.selectionFromDroppedPaths(dropPayload);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.selection.fileIds), [dropPayload.records[0].id]);

  const preview = await compressor.previewInputs(result.selection);
  assert.deepEqual(plain(preview.videos.map((record) => record.name)), ["dropped.mov"]);
  assert(preview.guidance.includes("Ignored 1 unsupported file: ignored.webm. Use .mov or .mp4."));
});

test("browser adapter rejects drops without supported video files", async () => {
  const { compressor } = loadBrowserAdapter();
  const dropPayload = compressor.droppedPathsFromFiles([{ name: "notes.txt" }]);

  assert.deepEqual(plain(dropPayload.records), []);
  assert.deepEqual(plain(await compressor.selectionFromDroppedPaths(dropPayload)), {
    ok: false,
    message: "Ignored 1 unsupported file: notes.txt. Use .mov or .mp4."
  });
});

test("browser adapter returns unsupported-file guidance for file picker selections without supported videos", async () => {
  const { compressor, appendedInputs } = loadBrowserAdapter();
  const selectionPromise = compressor.selectFile();

  appendedInputs[0].dispatchChange([
    { name: "notes.txt", size: 10, lastModified: 1 }
  ]);

  const selection = await selectionPromise;
  assert.deepEqual(plain(selection), {
    type: "files",
    fileIds: [],
    names: [],
    rejectedNames: ["notes.txt"]
  });
  assert.deepEqual(plain(await compressor.previewInputs(selection)), {
    videos: [],
    outputDir: null,
    guidance: ["Ignored 1 unsupported file: notes.txt. Use .mov or .mp4."]
  });
});

test("browser adapter releases selected File references when the renderer resets or replaces a selection", async () => {
  const { compressor, appendedInputs } = loadBrowserAdapter();
  const selectionPromise = compressor.selectFile();

  appendedInputs[0].dispatchChange([
    { name: "memory-heavy.mov", size: 600 * 1024 * 1024, lastModified: 1 }
  ]);

  const selection = await selectionPromise;
  assert.equal((await compressor.previewInputs(selection)).videos.length, 1);

  assert.deepEqual(plain(await compressor.releaseSelection(selection)), {
    ok: true
  });
  assert.deepEqual(plain(await compressor.previewInputs(selection)), {
    videos: [],
    outputDir: null,
    guidance: []
  });
});
