(function () {
  if (window.compressor || window.__TAURI__) {
    return;
  }

  const plan = window.CompressorPlan;
  if (!plan) {
    return;
  }

  let nextFileId = 1;
  const fileRecords = new Map();
  const encoderEventListeners = new Set();
  let ffmpeg = null;
  let ffmpegLoading = null;
  let activeJob = null;
  let activeNativeAbort = null;
  let cancelled = false;
  let ffmpegCoreBlobUrls = null;
  const largeFileWarningBytes = 500 * 1024 * 1024;
  const longDurationWarningSeconds = 10 * 60;
  const ffmpegCoreBaseUrl = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

  function createFileRecord(file) {
    const id = `browser-file-${nextFileId}`;
    nextFileId += 1;

    const record = {
      id,
      file,
      name: file.name,
      displayName: file.name,
      size: file.size,
      lastModified: file.lastModified
    };
    fileRecords.set(id, record);
    return record;
  }

  function classifyFiles(files) {
    const records = [];
    const rejectedNames = [];

    for (const file of Array.from(files || [])) {
      if (plan.isSupportedVideoFile(file)) {
        records.push(createFileRecord(file));
      } else if (file && file.name) {
        rejectedNames.push(file.name);
      }
    }

    return {
      totalCount: records.length + rejectedNames.length,
      records,
      rejectedNames
    };
  }

  function unsupportedFilesMessage(rejectedNames) {
    if (!Array.isArray(rejectedNames) || rejectedNames.length === 0) {
      return "";
    }

    const visibleNames = rejectedNames.slice(0, 3).join(", ");
    const remainingCount = rejectedNames.length - 3;
    const suffix = remainingCount > 0 ? `, and ${remainingCount} more` : "";

    return `Ignored ${rejectedNames.length} unsupported file${rejectedNames.length === 1 ? "" : "s"}: ${visibleNames}${suffix}. Use .mov or .mp4.`;
  }

  function selectionFromClassifiedFiles(classifiedFiles) {
    if (classifiedFiles.totalCount === 0) {
      return null;
    }

    return {
      type: "files",
      fileIds: classifiedFiles.records.map((record) => record.id),
      names: classifiedFiles.records.map((record) => record.name),
      rejectedNames: classifiedFiles.rejectedNames
    };
  }

  function selectFilesWithInput() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = plan.ACCEPTED_EXTENSIONS.join(",");
      input.multiple = true;
      input.hidden = true;

      input.addEventListener("change", () => {
        const classifiedFiles = classifyFiles(input.files);
        input.remove();
        resolve(selectionFromClassifiedFiles(classifiedFiles));
      }, { once: true });

      document.body.append(input);
      input.click();
    });
  }

  function selectedRecords(selection) {
    if (!selection || selection.type !== "files" || !Array.isArray(selection.fileIds)) {
      return [];
    }

    return selection.fileIds
      .map((id) => fileRecords.get(id))
      .filter(Boolean);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "0 MB";
    }

    const megabytes = bytes / (1024 * 1024);
    if (megabytes < 1024) {
      return `${Math.max(1, Math.round(megabytes))} MB`;
    }

    return `${(megabytes / 1024).toFixed(1)} GB`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return "unknown duration";
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes === 0) {
      return `${remainingSeconds}s`;
    }

    return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  }

  function isDesktopRecommendedContext() {
    const width = Number(window.innerWidth || document.documentElement.clientWidth || 0);
    const hasTouchInput = Number(window.navigator && window.navigator.maxTouchPoints) > 0;
    const coarsePointer = window.matchMedia
      ? window.matchMedia("(pointer: coarse)").matches
      : false;

    return width > 0 && (width < 760 || hasTouchInput || coarsePointer);
  }

  async function readDuration(record) {
    const browserUrl = window.URL;
    if (!document.createElement || !browserUrl || !browserUrl.createObjectURL) {
      return null;
    }

    return new Promise((resolve) => {
      const video = document.createElement("video");
      let settled = false;
      let url = null;

      function finish(duration) {
        if (settled) {
          return;
        }

        settled = true;
        if (url) {
          browserUrl.revokeObjectURL(url);
        }
        resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
      }

      const timer = window.setTimeout(() => finish(null), 4000);
      video.preload = "metadata";
      video.muted = true;
      video.addEventListener("loadedmetadata", () => {
        window.clearTimeout(timer);
        finish(video.duration);
      }, { once: true });
      video.addEventListener("error", () => {
        window.clearTimeout(timer);
        finish(null);
      }, { once: true });

      try {
        url = browserUrl.createObjectURL(record.file);
        video.src = url;
      } catch {
        window.clearTimeout(timer);
        finish(null);
      }
    });
  }

  async function inspectRecords(records) {
    await Promise.all(records.map(async (record) => {
      if (typeof record.durationSeconds === "number") {
        return;
      }

      record.durationSeconds = await readDuration(record);
    }));

    return records;
  }

  function selectionGuidance(records, selection) {
    const rejectedMessage = unsupportedFilesMessage(selection && selection.rejectedNames);

    if (records.length === 0) {
      return rejectedMessage ? [rejectedMessage] : [];
    }

    const totalBytes = records.reduce((total, record) => total + (record.size || 0), 0);
    const knownDurations = records
      .map((record) => record.durationSeconds)
      .filter((duration) => Number.isFinite(duration) && duration > 0);
    const longestDuration = knownDurations.length > 0 ? Math.max(...knownDurations) : null;
    const guidance = [
      `Selected ${records.length} file${records.length === 1 ? "" : "s"} (${formatBytes(totalBytes)} total${longestDuration ? `, longest ${formatDuration(longestDuration)}` : ", duration unknown"}).`
    ];

    if (totalBytes >= largeFileWarningBytes || (longestDuration !== null && longestDuration >= longDurationWarningSeconds)) {
      guidance.push("Browser encoding can be slow or run out of memory on large or long videos; keep this tab open and use the desktop app if it fails.");
    } else {
      guidance.push("Encoding stays on this device and may take longer than the desktop app.");
    }

    if (isDesktopRecommendedContext()) {
      guidance.push("Large video processing is desktop-recommended; mobile and small-screen browsers may fail sooner because of memory limits.");
    }

    if (rejectedMessage) {
      guidance.push(rejectedMessage);
    }

    return guidance;
  }

  function emit(event) {
    for (const listener of encoderEventListeners) {
      listener(event);
    }
  }

  function browserSupportError() {
    const browserUrl = window.URL;

    if (!window.Worker) {
      return "This browser cannot run the ffmpeg worker. Use a current desktop browser.";
    }

    if (!window.WebAssembly) {
      return "This browser cannot run WebAssembly. Use a current desktop browser.";
    }

    if (!window.File || !window.Blob || !browserUrl || !browserUrl.createObjectURL) {
      return "This browser cannot read local files and create downloads. Use a current desktop browser.";
    }

    return null;
  }

  async function createBlobUrlFromRemoteAsset(url, mimeType) {
    const response = await fetch(url, { cache: "force-cache" });

    if (!response.ok) {
      throw new Error(`Could not load browser encoder asset ${url}. Check your connection and try again.`);
    }

    const blob = new Blob([await response.arrayBuffer()], { type: mimeType });
    return URL.createObjectURL(blob);
  }

  async function ffmpegCoreUrls() {
    if (ffmpegCoreBlobUrls) {
      return ffmpegCoreBlobUrls;
    }

    ffmpegCoreBlobUrls = {
      coreURL: await createBlobUrlFromRemoteAsset(
        `${ffmpegCoreBaseUrl}/ffmpeg-core.js`,
        "application/javascript"
      ),
      wasmURL: await createBlobUrlFromRemoteAsset(
        `${ffmpegCoreBaseUrl}/ffmpeg-core.wasm`,
        "application/wasm"
      )
    };

    return ffmpegCoreBlobUrls;
  }

  async function createFfmpeg() {
    if (ffmpegLoading) {
      return ffmpegLoading;
    }

    ffmpegLoading = (async () => {
      emit({
        type: "run-loading",
        message: "Loading browser encoder..."
      });

      const { FFmpeg } = await import("./vendor/ffmpeg/ffmpeg/index.js");
      const instance = new FFmpeg();
      const coreUrls = await ffmpegCoreUrls();
      ffmpeg = instance;

      instance.on("progress", ({ progress }) => {
        if (!activeJob || typeof progress !== "number") {
          return;
        }

        emit({
          type: "job-progress",
          inputPath: activeJob.inputPath,
          label: activeJob.label,
          progress
        });
      });

      await instance.load(coreUrls);

      ffmpeg = instance;
      return instance;
    })();

    try {
      return await ffmpegLoading;
    } finally {
      ffmpegLoading = null;
    }
  }

  async function writeInputFile(instance, record, inputName) {
    const data = new Uint8Array(await record.file.arrayBuffer());
    await instance.writeFile(inputName, data);
  }

  async function removeVirtualFile(instance, name) {
    try {
      await instance.deleteFile(name);
    } catch {
      // MEMFS cleanup is best-effort; failed cleanup should not hide a completed export.
    }
  }

  function outputMimeType(outputName) {
    if (outputName.endsWith(".mp4")) {
      return "video/mp4";
    }

    if (outputName.endsWith(".webm")) {
      return "video/webm";
    }

    return "image/jpeg";
  }

  function nativeWebmMimeType() {
    if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) {
      return "";
    }

    for (const mimeType of [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp8",
      "video/webm"
    ]) {
      if (window.MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    }

    return "";
  }

  function nativeWebmBitrate(width, qualityKey) {
    const qualityMultipliers = {
      low: 0.65,
      medium: 1,
      high: 1.45
    };
    const baseBitrate = width >= 1920
      ? 3500000
      : (width >= 1280 ? 2200000 : 1200000);

    return Math.round(baseBitrate * (qualityMultipliers[qualityKey] || qualityMultipliers.medium));
  }

  function drawContainedVideoFrame(context, video, width, height) {
    const sourceWidth = video.videoWidth || width;
    const sourceHeight = video.videoHeight || height;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = Math.round(sourceWidth * scale);
    const drawHeight = Math.round(sourceHeight * scale);
    const drawX = Math.round((width - drawWidth) / 2);
    const drawY = Math.round((height - drawHeight) / 2);

    context.fillStyle = "black";
    context.fillRect(0, 0, width, height);
    context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
  }

  function waitForVideoEvent(video, eventName) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener(eventName, handleEvent);
        video.removeEventListener("error", handleError);
      };
      const handleEvent = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("The browser could not decode this source video."));
      };

      video.addEventListener(eventName, handleEvent, { once: true });
      video.addEventListener("error", handleError, { once: true });
    });
  }

  async function createAudioTracks(video) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return {
        tracks: [],
        cleanup: () => {}
      };
    }

    const audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(video);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    return {
      tracks: destination.stream.getAudioTracks(),
      cleanup: () => {
        source.disconnect();
        audioContext.close().catch(() => {});
      }
    };
  }

  async function executeNativeWebmJob(record, exportDefinition, qualityKey) {
    const mimeType = nativeWebmMimeType();
    if (!mimeType || !window.MediaStream) {
      throw new Error("This browser cannot create WebM outputs without ffmpeg.wasm.");
    }

    const browserUrl = window.URL;
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    const chunks = [];
    let sourceUrl = null;
    let recorder = null;
    let audioCleanup = () => {};
    let stream = null;
    let stopped = false;
    let animationFrame = null;

    canvas.width = exportDefinition.width;
    canvas.height = exportDefinition.height;
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    function cleanup() {
      stopped = true;
      activeNativeAbort = null;
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      video.pause();
      audioCleanup();
      if (sourceUrl) {
        browserUrl.revokeObjectURL(sourceUrl);
      }
    }

    try {
      sourceUrl = browserUrl.createObjectURL(record.file);
      video.src = sourceUrl;
      await waitForVideoEvent(video, "loadedmetadata");

      const canvasStream = canvas.captureStream(25);
      const audio = await createAudioTracks(video);
      audioCleanup = audio.cleanup;
      stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audio.tracks
      ]);

      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: nativeWebmBitrate(exportDefinition.width, qualityKey),
        audioBitsPerSecond: 128000
      });

      activeNativeAbort = () => {
        cleanup();
      };

      const recording = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        });
        recorder.addEventListener("stop", () => {
          if (cancelled) {
            reject(new DOMException("Encoding cancelled.", "AbortError"));
            return;
          }

          resolve(new Blob(chunks, { type: mimeType }));
        }, { once: true });
        recorder.addEventListener("error", () => {
          reject(new Error("The browser native WebM encoder failed."));
        }, { once: true });
      });

      function renderFrame() {
        if (stopped) {
          return;
        }

        drawContainedVideoFrame(context, video, exportDefinition.width, exportDefinition.height);
        if (activeJob && Number.isFinite(video.duration) && video.duration > 0) {
          emit({
            type: "job-progress",
            inputPath: activeJob.inputPath,
            label: activeJob.label,
            progress: Math.min(0.99, video.currentTime / video.duration)
          });
        }

        if (video.ended) {
          if (recorder && recorder.state !== "inactive") {
            recorder.stop();
          }
          return;
        }

        animationFrame = window.requestAnimationFrame(renderFrame);
      }

      recorder.start(1000);
      await video.play();
      renderFrame();

      const blob = await recording;
      return blob;
    } finally {
      cleanup();
    }
  }

  async function executeNativePosterJob(record, exportDefinition) {
    const browserUrl = window.URL;
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    let sourceUrl = null;

    canvas.width = exportDefinition.width;
    canvas.height = exportDefinition.height;
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    try {
      sourceUrl = browserUrl.createObjectURL(record.file);
      video.src = sourceUrl;
      await waitForVideoEvent(video, "loadedmetadata");
      await waitForVideoEvent(video, "loadeddata");
      const posterTime = Math.min(3, Math.max(0, (video.duration || 0) - 0.1));
      if (posterTime > 0) {
        video.currentTime = posterTime;
        await waitForVideoEvent(video, "seeked");
      }
      drawContainedVideoFrame(context, video, exportDefinition.width, exportDefinition.height);

      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("The browser could not create the poster image."));
          }
        }, "image/jpeg", 0.92);
      });
    } finally {
      video.pause();
      if (sourceUrl) {
        browserUrl.revokeObjectURL(sourceUrl);
      }
    }
  }

  function failureMessage(error) {
    const message = error && error.message ? error.message : String(error || "");

    if (/memory|abort/i.test(message)) {
      return "Browser encoding ran out of memory. Try a shorter or smaller source video, or use the desktop app for this file.";
    }

    if (/libx264|libvpx|libopus|aac|Unknown encoder/i.test(message)) {
      return `The browser ffmpeg build is missing a required codec. ${message}`;
    }

    return `Browser encoding failed. ${message}`;
  }

  function waitForWorkerCleanup() {
    return new Promise((resolve) => window.setTimeout(resolve, 750));
  }

  async function executeFfmpegJob(record, inputName, outputName, args) {
    const instance = await createFfmpeg();
    try {
      await writeInputFile(instance, record, inputName);
      const exitCode = await instance.exec(args);

      if (exitCode !== 0) {
        throw new Error(`ffmpeg exited with code ${exitCode}.`);
      }

      const data = await instance.readFile(outputName);
      return data;
    } finally {
      await removeVirtualFile(instance, outputName);
      await removeVirtualFile(instance, inputName);
      instance.terminate();
      if (ffmpeg === instance) {
        ffmpeg = null;
      }
      await waitForWorkerCleanup();
    }
  }

  async function runJob(record, exportDefinition, qualityKey) {
    const inputName = `input-${record.id}-${record.name.replace(/[^\w.-]+/g, "_")}`;
    const outputName = plan.outputFileName(record, exportDefinition.suffix);
    const eventBase = {
      inputPath: record.id,
      label: exportDefinition.jobLabel
    };

    try {
      activeJob = eventBase;
      emit({
        type: "job-started",
        ...eventBase
      });

      let blob;
      if (exportDefinition.kind === "webm") {
        blob = await executeNativeWebmJob(record, exportDefinition, qualityKey);
      } else if (exportDefinition.kind === "poster") {
        blob = await executeNativePosterJob(record, exportDefinition);
      } else {
        const args = plan.buildBrowserFfmpegArgs(exportDefinition, inputName, outputName, qualityKey);
        const data = await executeFfmpegJob(record, inputName, outputName, args);
        blob = new Blob([data], { type: outputMimeType(outputName) });
      }
      const downloadUrl = window.URL.createObjectURL(blob);

      emit({
        type: "job-finished",
        ...eventBase,
        outputName,
        downloadUrl,
        byteLength: blob.size
      });
    } finally {
      activeJob = null;
    }
  }

  async function startBrowserEncoding({ selection, qualityKey }) {
    const supportError = browserSupportError();
    if (supportError) {
      return {
        ok: false,
        cancelled: false,
        message: supportError
      };
    }

    const records = selectedRecords(selection);
    if (records.length === 0) {
      return {
        ok: false,
        cancelled: false,
        message: "Choose one or more .mov or .mp4 files before starting compression."
      };
    }

    cancelled = false;

    try {
      emit({
        type: "run-started",
        outputDir: "browser downloads",
        totalJobs: records.length * plan.EXPORT_DEFINITIONS.length
      });

      for (const record of records) {
        if (cancelled) {
          throw new DOMException("Encoding cancelled.", "AbortError");
        }

        for (const exportDefinition of plan.EXPORT_DEFINITIONS) {
          if (cancelled) {
            throw new DOMException("Encoding cancelled.", "AbortError");
          }

          await runJob(record, exportDefinition, qualityKey);
        }

        emit({
          type: "file-finished",
          inputPath: record.id
        });
      }

      activeJob = null;
      emit({
        type: "run-finished",
        outputDir: "download links below"
      });

      return {
        ok: true,
        cancelled: false,
        message: "Browser encoding finished."
      };
    } catch (error) {
      activeJob = null;

      if (cancelled || error.name === "AbortError" || String(error).includes("called FFmpeg.terminate")) {
        emit({
          type: "run-cancelled",
          message: "Compression cancelled. Completed browser downloads remain available below."
        });
        return {
          ok: false,
          cancelled: true,
          message: "Compression cancelled. Completed browser downloads remain available below."
        };
      }

      const message = failureMessage(error);
      emit({
        type: "run-failed",
        message
      });
      return {
        ok: false,
        cancelled: false,
        message
      };
    }
  }

  async function releaseSelection(selection) {
    if (!selection || selection.type !== "files" || !Array.isArray(selection.fileIds)) {
      return {
        ok: true
      };
    }

    for (const id of selection.fileIds) {
      fileRecords.delete(id);
    }

    return {
      ok: true
    };
  }

  window.compressor = {
    checkTools: async () => {
      const supportError = browserSupportError();
      return {
        ok: !supportError,
        ffmpegPath: null,
        message: supportError || "Browser encoder is available. Files stay on this device."
      };
    },
    selectFile: selectFilesWithInput,
    selectFolder: async () => null,
    droppedPathsFromFiles: classifyFiles,
    selectionFromDroppedPaths: async (dropPayload) => {
      const ids = Array.isArray(dropPayload)
        ? dropPayload
        : (dropPayload && Array.isArray(dropPayload.records)
          ? dropPayload.records.map((record) => record.id)
          : []);
      const rejectedNames = dropPayload && Array.isArray(dropPayload.rejectedNames)
        ? dropPayload.rejectedNames
        : [];
      const records = ids.map((id) => fileRecords.get(id)).filter(Boolean);

      if (records.length === 0) {
        return {
          ok: false,
          message: unsupportedFilesMessage(rejectedNames) || "Drop one or more .mov or .mp4 files."
        };
      }

      return {
        ok: true,
        selection: selectionFromClassifiedFiles({
          totalCount: records.length + rejectedNames.length,
          records,
          rejectedNames
        })
      };
    },
    previewInputs: async (selection) => {
      const records = await inspectRecords(selectedRecords(selection));
      return {
        videos: records,
        outputDir: null,
        guidance: selectionGuidance(records, selection)
      };
    },
    releaseSelection,
    start: startBrowserEncoding,
    cancel: async () => {
      cancelled = true;
      activeJob = null;
      if (activeNativeAbort) {
        activeNativeAbort();
      }
      if (ffmpeg) {
        ffmpeg.terminate();
        ffmpeg = null;
      }
      return {
        ok: true,
        message: "Browser encoding cancelled."
      };
    },
    startWindowDrag: async () => false,
    resizeWindowToContent: async () => false,
    onEncoderEvent: (callback) => {
      encoderEventListeners.add(callback);
      return () => encoderEventListeners.delete(callback);
    },
    onDroppedPaths: () => () => {},
    onDropState: () => () => {}
  };
})();
