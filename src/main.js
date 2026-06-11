const { app, BrowserWindow, dialog, ipcMain, Notification } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  QUALITY_PRESETS,
  buildExportPlan,
  listInputVideos,
  outputDirForSelection
} = require("./encoder");
const { createSleepBlocker } = require("./sleep-blocker");
const { checkTools } = require("./tools");

let mainWindow;
let activeRun = null;
const sleepBlocker = createSleepBlocker();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 820,
    minHeight: 640,
    title: "Web Video Compressor",
    backgroundColor: "#f6f4ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function sendEvent(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("encoder:event", payload);
}

function showQueueCompleteNotification({ outputDir, totalFiles }) {
  if (!Notification.isSupported()) {
    return;
  }

  const sourceLabel = `${totalFiles} source video${totalFiles === 1 ? "" : "s"}`;
  const notification = new Notification({
    title: "Compression queue complete",
    body: `${sourceLabel} exported to ${outputDir}`
  });

  notification.show();
}

function runFfmpeg(ffmpegPath, args, runState) {
  return new Promise((resolve, reject) => {
    if (runState.cancelRequested) {
      reject(new Error("Run cancelled."));
      return;
    }

    const child = spawn(ffmpegPath, args, {
      windowsHide: true
    });

    runState.currentProcess = child;

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      runState.currentProcess = null;
      reject(error);
    });

    child.on("close", (code, signal) => {
      runState.currentProcess = null;

      if (runState.cancelRequested || signal === "SIGTERM") {
        reject(new Error("Run cancelled."));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      const usefulError = stderr.trim().split("\n").slice(-4).join("\n");
      reject(new Error(usefulError || `ffmpeg exited with code ${code}.`));
    });
  });
}

async function runJob(ffmpegPath, job, runState) {
  try {
    await runFfmpeg(ffmpegPath, job.args, runState);
  } catch (error) {
    if (job.kind === "poster" && job.fallbackArgs && !runState.cancelRequested) {
      await runFfmpeg(ffmpegPath, job.fallbackArgs, runState);
      return;
    }

    throw error;
  }
}

async function startEncoding(_, { selection, qualityKey }) {
  if (activeRun) {
    return {
      ok: false,
      message: "A compression run is already active."
    };
  }

  const tools = await checkTools();
  if (!tools.ok) {
    return tools;
  }

  const videos = await listInputVideos(selection);
  if (videos.length === 0) {
    return {
      ok: false,
      message: "Choose a .mov or .mp4 file, or a folder containing .mov or .mp4 files."
    };
  }

  const quality = QUALITY_PRESETS[qualityKey] ? qualityKey : "medium";
  const outputDir = outputDirForSelection(selection);
  await fs.mkdir(outputDir, { recursive: true });

  const runState = {
    cancelRequested: false,
    currentProcess: null
  };
  activeRun = runState;
  sleepBlocker.start();

  const totalJobs = videos.length * 7;
  let completedJobs = 0;

  sendEvent({
    type: "run-started",
    outputDir,
    totalFiles: videos.length,
    totalJobs
  });

  try {
    for (const inputPath of videos) {
      const fileName = path.basename(inputPath);
      const jobs = buildExportPlan(inputPath, outputDir, quality);

      sendEvent({
        type: "file-started",
        inputPath,
        fileName,
        totalJobs: jobs.length
      });

      for (const job of jobs) {
        if (runState.cancelRequested) {
          throw new Error("Run cancelled.");
        }

        sendEvent({
          type: "job-started",
          inputPath,
          fileName,
          label: job.label,
          outputPath: job.outputPath,
          completedJobs,
          totalJobs
        });

        await runJob(tools.ffmpegPath, job, runState);
        completedJobs += 1;

        sendEvent({
          type: "job-finished",
          inputPath,
          fileName,
          label: job.label,
          outputPath: job.outputPath,
          completedJobs,
          totalJobs
        });
      }

      sendEvent({
        type: "file-finished",
        inputPath,
        fileName,
        totalJobs: jobs.length
      });
    }

    sendEvent({
      type: "run-finished",
      outputDir,
      totalFiles: videos.length,
      completedJobs,
      totalJobs
    });
    showQueueCompleteNotification({
      outputDir,
      totalFiles: videos.length
    });

    return {
      ok: true,
      outputDir,
      completedJobs,
      totalJobs
    };
  } catch (error) {
    const cancelled = runState.cancelRequested;
    sendEvent({
      type: cancelled ? "run-cancelled" : "run-failed",
      message: cancelled
        ? "Compression cancelled. Completed exports were left in place."
        : `Compression failed. ${error.message}`,
      completedJobs,
      totalJobs
    });

    return {
      ok: false,
      cancelled,
      message: cancelled
        ? "Compression cancelled. Completed exports were left in place."
        : `Compression failed. ${error.message}`
    };
  } finally {
    sleepBlocker.stop();
    activeRun = null;
  }
}

async function selectionFromDroppedPaths(_, droppedPaths) {
  const paths = Array.isArray(droppedPaths)
    ? droppedPaths.filter((filePath) => typeof filePath === "string" && filePath.trim())
    : [];

  if (paths.length === 0) {
    return {
      ok: false,
      message: "Drop one folder, or one or more .mov or .mp4 files."
    };
  }

  let entries;
  try {
    entries = await Promise.all(
      paths.map(async (filePath) => ({
        path: filePath,
        stats: await fs.stat(filePath)
      }))
    );
  } catch {
    return {
      ok: false,
      message: "Some dropped items could not be read. Drop one folder, or one or more .mov or .mp4 files."
    };
  }
  const folders = entries.filter((entry) => entry.stats.isDirectory());
  const files = entries.filter((entry) => entry.stats.isFile());

  if (folders.length === 1 && files.length === 0) {
    return {
      ok: true,
      selection: {
        type: "folder",
        path: folders[0].path
      }
    };
  }

  if (folders.length > 0) {
    return {
      ok: false,
      message: "Drop one folder at a time, or drop one or more .mov or .mp4 files."
    };
  }

  return {
    ok: true,
    selection: files.length === 1
      ? {
          type: "file",
          path: files[0].path
        }
      : {
          type: "files",
          paths: files.map((entry) => entry.path)
        }
  };
}

ipcMain.handle("tools:check", checkTools);

ipcMain.handle("dialog:select-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a video file",
    properties: ["openFile"],
    filters: [{ name: "Video files", extensions: ["mov", "mp4"] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return {
    type: "file",
    path: result.filePaths[0]
  };
});

ipcMain.handle("dialog:select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a folder of videos",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return {
    type: "folder",
    path: result.filePaths[0]
  };
});

ipcMain.handle("inputs:preview", async (_, selection) => {
  const videos = await listInputVideos(selection);
  return {
    videos,
    outputDir: selection ? outputDirForSelection(selection) : null
  };
});

ipcMain.handle("inputs:selection-from-dropped-paths", selectionFromDroppedPaths);

ipcMain.handle("encoder:start", startEncoding);

ipcMain.handle("encoder:cancel", async () => {
  if (!activeRun) {
    return { ok: true };
  }

  activeRun.cancelRequested = true;

  if (activeRun.currentProcess) {
    activeRun.currentProcess.kill("SIGTERM");
  }

  return { ok: true };
});

app.whenReady().then(createWindow);

app.on("before-quit", () => {
  sleepBlocker.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
