const qualityKeys = ["low", "medium", "high"];
const qualityLabels = {
  low: "Low",
  medium: "Medium",
  high: "High"
};
const qualityDescriptions = {
  low: "Smaller files, faster exports",
  medium: "Default, for balanced quality and size",
  high: "Higher fidelity, larger files"
};
const exportDefinitions = [
  { jobLabel: "1080p MP4", suffix: "1080p.mp4" },
  { jobLabel: "1080p WebM", suffix: "1080p.webm" },
  { jobLabel: "720p MP4", suffix: "720p.mp4" },
  { jobLabel: "720p WebM", suffix: "720p.webm" },
  { jobLabel: "480p MP4", suffix: "480p.mp4" },
  { jobLabel: "480p WebM", suffix: "480p.webm" },
  { jobLabel: "Poster JPG", suffix: "poster.jpg" }
];
const chevronMotionMs = 360;
const panelMotionMs = 260;
const minimumJobProgressAnimationMs = 1000;
const windowWidth = 474;
const sectionTimers = new WeakMap();
const completionTimers = new Map();
let resizeWindowFrame = null;
let resizeWindowTimer = null;
let progressAnimationFrame = null;

const state = {
  selection: null,
  videos: [],
  outputDir: null,
  outputRows: [],
  running: false,
  toolsOk: false,
  dragDepth: 0,
  activeSection: "source",
  runState: "idle"
};

const elements = {
  windowDragRegion: document.querySelector(".window-drag-region"),
  appShell: document.querySelector(".app-shell"),
  toolStatus: document.querySelector("#toolStatus"),
  sections: Array.from(document.querySelectorAll(".accordion-section")),
  toggles: Array.from(document.querySelectorAll(".accordion-toggle")),
  sourceSubtitle: document.querySelector("#sourceSubtitle"),
  compressionSubtitle: document.querySelector("#compressionSubtitle"),
  outputSubtitle: document.querySelector("#outputSubtitle"),
  dropZone: document.querySelector("#dropZone"),
  sourceSelection: document.querySelector("#sourceSelection"),
  selectFileButton: document.querySelector("#selectFileButton"),
  resetButton: document.querySelector("#resetButton"),
  selectionText: document.querySelector("#selectionText"),
  outputText: document.querySelector("#outputText"),
  qualitySlider: document.querySelector("#qualitySlider"),
  qualityLabel: document.querySelector("#qualityLabel"),
  qualityDescription: document.querySelector("#qualityDescription"),
  summaryText: document.querySelector("#summaryText"),
  runActions: document.querySelector("#runActions"),
  outputRestartButton: document.querySelector("#outputRestartButton"),
  outputActionButton: document.querySelector("#outputActionButton"),
  queueList: document.querySelector("#queueList")
};

function fileName(filePath) {
  return filePath.split(/[\\/]/).pop();
}

function truncateStart(text, maxLength = 42) {
  return text.length > maxLength
    ? `...${text.slice(-(maxLength - 3))}`
    : text;
}

function currentQualityKey() {
  return qualityKeys[Number(elements.qualitySlider.value)] || "medium";
}

function compressorApi() {
  return window.compressor || null;
}

function clearPendingWindowResize() {
  if (resizeWindowFrame) {
    window.cancelAnimationFrame(resizeWindowFrame);
    resizeWindowFrame = null;
  }

  if (resizeWindowTimer) {
    window.clearTimeout(resizeWindowTimer);
    resizeWindowTimer = null;
  }
}

function scheduleWindowResize({ delay = 0 } = {}) {
  const api = compressorApi();
  if (!api || !api.resizeWindowToContent) {
    return;
  }

  clearPendingWindowResize();

  if (delay > 0) {
    resizeWindowTimer = window.setTimeout(() => {
      resizeWindowTimer = null;
      scheduleWindowResize();
    }, delay);
    return;
  }

  resizeWindowFrame = window.requestAnimationFrame(() => {
    resizeWindowFrame = null;
    resizeWindowToContent();
  });
}

function resizeWindowToContent() {
  const api = compressorApi();
  if (!api || !api.resizeWindowToContent || !elements.appShell) {
    return;
  }

  const height = Math.ceil(elements.appShell.getBoundingClientRect().height);
  api.resizeWindowToContent({ width: windowWidth, height }).catch(() => {});
}

function scheduleSettledWindowResize() {
  scheduleWindowResize({ delay: panelMotionMs + 40 });
}

function outputCount() {
  return state.outputRows.length;
}

function completedOutputCount() {
  return state.outputRows.filter((row) => row.status === "done").length;
}

function buildRowId(inputPath, label) {
  return `${inputPath}::${label}`;
}

function createOutputRows(videos) {
  return videos.flatMap((video) =>
    exportDefinitions.map((exportDefinition) => ({
      id: buildRowId(video, exportDefinition.jobLabel),
      inputPath: video,
      sourceName: fileName(video),
      jobLabel: exportDefinition.jobLabel,
      label: outputFileName(video, exportDefinition.suffix),
      status: "waiting",
      progress: 0,
      startedAt: null,
      completingFrom: null,
      completingStartedAt: null,
      completingDurationMs: null
    }))
  );
}

function outputFileName(inputPath, suffix) {
  const sourceName = fileName(inputPath);
  const extensionIndex = sourceName.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? sourceName.slice(0, extensionIndex) : sourceName;
  return `${baseName}-${suffix}`;
}

function scheduleSection(section, callback, delay) {
  const existingTimer = sectionTimers.get(section);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  sectionTimers.set(section, window.setTimeout(() => {
    sectionTimers.delete(section);
    callback();
  }, delay));
}

function openSection(sectionName) {
  state.activeSection = sectionName;

  for (const section of elements.sections) {
    const isOpen = section.dataset.section === sectionName;
    const toggle = section.querySelector(".accordion-toggle");
    const panel = section.querySelector(".accordion-panel");

    toggle.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
      panel.hidden = false;
      section.classList.add("accordion-section--chevron-open");
      scheduleSection(section, () => {
        if (state.activeSection === sectionName) {
          for (const otherSection of elements.sections) {
            if (otherSection !== section) {
              const otherPanel = otherSection.querySelector(".accordion-panel");
              otherSection.classList.remove("accordion-section--open");
              otherSection.classList.remove("accordion-section--chevron-open");
              otherPanel.hidden = true;
            }
          }
          section.classList.add("accordion-section--open");
          scheduleSettledWindowResize();
        }
      }, chevronMotionMs);
      updateSubtitles();
      return;
    }

    section.classList.remove("accordion-section--open");
    scheduleSection(section, () => {
      if (state.activeSection !== section.dataset.section) {
        section.classList.remove("accordion-section--chevron-open");
        panel.hidden = true;
      }
    }, panelMotionMs);
  }
}

function updateSubtitles() {
  const fileCount = state.videos.length;
  elements.sourceSubtitle.textContent = fileCount === 0
    ? (state.activeSection === "source" ? "No files selected" : "")
    : String(fileCount);

  elements.compressionSubtitle.textContent = qualityLabels[currentQualityKey()];

  const total = outputCount();
  const complete = completedOutputCount();
  elements.outputSubtitle.textContent = total === 0
    ? (state.activeSection === "output" ? "0/0" : "")
    : `${complete}/${total}`;
}

function setToolStatus(result) {
  state.toolsOk = Boolean(result.ok);
  elements.toolStatus.hidden = result.ok;
  elements.toolStatus.textContent = result.ok ? "" : result.message;
  scheduleWindowResize();

  if (!result.ok) {
    elements.summaryText.textContent = result.message;
  }
}

function renderQueue() {
  elements.queueList.innerHTML = "";
  const now = window.performance.now();

  if (state.outputRows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = state.selection
      ? "No .mov or .mp4 files found."
      : "No outputs queued.";
    elements.queueList.append(empty);
    updateSubtitles();
    scheduleWindowResize();
    return;
  }

  for (const row of state.outputRows) {
    const item = document.createElement("div");
    item.className = `queue-item queue-item--${row.status}`;
    item.dataset.rowId = row.id;

    const heading = document.createElement("div");
    heading.className = "queue-item__heading";

    const titleWrap = document.createElement("div");
    titleWrap.className = "queue-item__title";

    const name = document.createElement("strong");
    name.textContent = row.label;

    const status = document.createElement("span");
    status.className = "queue-status";
    status.textContent = statusLabel(row.status);

    const progressTrack = document.createElement("div");
    progressTrack.className = "queue-progress";
    progressTrack.setAttribute("role", "progressbar");
    progressTrack.setAttribute("aria-valuemin", "0");
    progressTrack.setAttribute("aria-valuemax", "100");
    progressTrack.setAttribute("aria-valuenow", String(Math.round(displayedProgress(row, now) * 100)));

    const progressBar = document.createElement("span");
    progressBar.style.width = `${Math.round(displayedProgress(row, now) * 100)}%`;

    titleWrap.append(name);
    heading.append(titleWrap, status);
    progressTrack.append(progressBar);
    item.append(heading, progressTrack);
    elements.queueList.append(item);
  }

  updateSubtitles();
  scheduleWindowResize();
  scheduleProgressAnimation();
}

function displayedProgress(row, now = window.performance.now()) {
  if (row.status === "done") {
    return 1;
  }

  if (row.status !== "active" || !row.startedAt) {
    return Math.max(0, Math.min(1, row.progress));
  }

  if (row.progress >= 1 && row.completingStartedAt !== null) {
    const completionProgress = Math.min(
      1,
      (now - row.completingStartedAt) / row.completingDurationMs
    );
    return row.completingFrom + ((1 - row.completingFrom) * completionProgress);
  }

  return Math.max(0, Math.min(1, row.progress));
}

function scheduleProgressAnimation() {
  if (progressAnimationFrame || !state.outputRows.some((row) => row.status === "active")) {
    return;
  }

  progressAnimationFrame = window.requestAnimationFrame(updateRenderedProgressBars);
}

function updateRenderedProgressBars() {
  progressAnimationFrame = null;
  const now = window.performance.now();
  let hasActiveRow = false;

  for (const row of state.outputRows) {
    if (row.status !== "active") {
      continue;
    }

    hasActiveRow = true;
    const progress = displayedProgress(row, now);
    const item = Array.from(elements.queueList.children)
      .find((child) => child.dataset.rowId === row.id);
    const progressTrack = item ? item.querySelector(".queue-progress") : null;
    const progressBar = progressTrack ? progressTrack.querySelector("span") : null;

    if (progressTrack && progressBar) {
      progressTrack.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
      progressBar.style.width = `${Math.round(progress * 100)}%`;
    }
  }

  if (hasActiveRow) {
    scheduleProgressAnimation();
  }
}

function clearCompletionTimers() {
  for (const timer of completionTimers.values()) {
    window.clearTimeout(timer);
  }
  completionTimers.clear();
}

function clearRowCompletion(row) {
  row.completingFrom = null;
  row.completingStartedAt = null;
  row.completingDurationMs = null;
}

function selectedSourceLabels() {
  if (!state.selection || state.videos.length === 0) {
    return [];
  }

  if (state.selection.type === "folder") {
    return [
      `.../${fileName(state.selection.path)}/[${state.videos.length} file${state.videos.length === 1 ? "" : "s"}]`
    ];
  }

  return state.videos.map((video) => truncateStart(fileName(video)));
}

function renderSourceSelection() {
  elements.sourceSelection.innerHTML = "";

  const labels = selectedSourceLabels();
  elements.sourceSelection.hidden = labels.length === 0;
  elements.dropZone.classList.toggle("source-drop--has-selection", labels.length > 0);

  for (const label of labels) {
    const item = document.createElement("div");
    item.className = "source-selection__item";
    item.textContent = label;
    elements.sourceSelection.append(item);
  }

  scheduleWindowResize();
}

function statusLabel(status) {
  if (status === "active") {
    return "In progress";
  }

  if (status === "done") {
    return "Done";
  }

  if (status === "cancelled") {
    return "Cancelled";
  }

  if (status === "error") {
    return "Failed";
  }

  return "Waiting";
}

function updateControls() {
  const isCancelled = state.runState === "cancelled";
  const isFinished = state.runState === "finished";
  const canStart = state.toolsOk
    && state.videos.length > 0
    && !state.running
    && !isCancelled
    && !isFinished;
  const actionState = outputActionState();
  const showRestartButton = isCancelled;

  elements.outputActionButton.textContent = actionState.label;
  elements.outputActionButton.disabled = actionState.disabled || (!canStart && actionState.kind === "start");
  elements.outputActionButton.classList.toggle("secondary", actionState.kind === "stop" || actionState.kind === "resume");
  elements.outputRestartButton.hidden = !showRestartButton;
  elements.outputRestartButton.disabled = !showRestartButton || state.running || state.outputRows.length === 0;
  elements.selectFileButton.disabled = state.running;
  elements.resetButton.disabled = state.running || !state.selection;
  elements.resetButton.hidden = !state.selection;
  elements.qualitySlider.disabled = state.running;
  updateSubtitles();
}

function outputActionState() {
  if (state.running) {
    return {
      kind: "stop",
      label: "Stop",
      disabled: false
    };
  }

  if (state.runState === "cancelled") {
    return {
      kind: "resume",
      label: "Resume",
      disabled: !state.toolsOk || state.videos.length === 0
    };
  }

  if (state.runState === "finished") {
    return {
      kind: "restart",
      label: "Restart",
      disabled: state.outputRows.length === 0
    };
  }

  return {
    kind: "start",
    label: "Start compression",
    disabled: !state.toolsOk || state.videos.length === 0
  };
}

function selectionLabel(selection) {
  if (selection.type === "folder") {
    return selection.path;
  }

  if (selection.type === "files") {
    return `${selection.paths.length} files selected`;
  }

  return fileName(selection.path);
}

function updateQualityText() {
  const key = currentQualityKey();
  const value = Number(elements.qualitySlider.value);
  elements.qualityLabel.textContent = qualityLabels[key];
  elements.qualityDescription.textContent = qualityDescriptions[key];
  elements.qualitySlider.style.setProperty("--quality-percent", `${value * 50}%`);
  for (const tick of document.querySelectorAll(".quality-ticks span")) {
    tick.classList.toggle("quality-tick--active", tick.textContent === qualityLabels[key]);
  }
  updateSubtitles();
}

function resetSelection() {
  clearCompletionTimers();
  state.selection = null;
  state.videos = [];
  state.outputDir = null;
  state.outputRows = [];
  state.runState = "idle";
  state.dragDepth = 0;

  elements.selectionText.textContent = "No source selected";
  elements.outputText.textContent = "";
  elements.summaryText.textContent = "No videos queued.";
  setDropActive(false);
  renderSourceSelection();
  renderQueue();
  updateControls();
  openSection("source");
}

async function loadSelection(selection) {
  if (!selection) {
    return;
  }

  const api = compressorApi();
  if (!api) {
    return;
  }

  state.selection = selection;
  clearCompletionTimers();
  const preview = await api.previewInputs(selection);
  state.videos = preview.videos;
  state.outputDir = preview.outputDir;
  state.outputRows = createOutputRows(preview.videos);
  state.runState = "idle";

  elements.selectionText.textContent = selectionLabel(selection);
  elements.outputText.textContent = state.outputDir
    ? `Output: ${state.outputDir}`
    : "";
  elements.summaryText.textContent = state.videos.length === 0
    ? "No .mov or .mp4 files found."
    : `${state.outputRows.length} outputs queued from ${state.videos.length} source file${state.videos.length === 1 ? "" : "s"}.`;

  renderSourceSelection();
  renderQueue();
  updateControls();
  openSection(state.videos.length > 0 ? "compression" : "source");
}

function setDropActive(active) {
  elements.dropZone.classList.toggle("source-drop--dragging", active);
}

function canAcceptDrop(event) {
  return Boolean(
    compressorApi()
      && !state.running
      && (!event
        || (event.dataTransfer
          && event.dataTransfer.types
          && Array.from(event.dataTransfer.types).includes("Files")))
  );
}

function isPositionInDropZone(position) {
  if (!position || typeof position.x !== "number" || typeof position.y !== "number") {
    return true;
  }

  const rect = elements.dropZone.getBoundingClientRect();
  const candidates = [
    position,
    {
      x: position.x / window.devicePixelRatio,
      y: position.y / window.devicePixelRatio
    }
  ];

  return candidates.some((candidate) =>
    candidate.x >= rect.left
      && candidate.x <= rect.right
      && candidate.y >= rect.top
      && candidate.y <= rect.bottom
  );
}

async function loadDroppedPaths(paths) {
  const api = compressorApi();
  if (!api) {
    return;
  }

  let result;
  try {
    result = await api.selectionFromDroppedPaths(paths);
  } catch (error) {
    elements.summaryText.textContent = `Dropped files could not be read. ${error.message}`;
    openSection("output");
    return;
  }

  if (!result.ok) {
    elements.summaryText.textContent = result.message;
    openSection("output");
    return;
  }

  await loadSelection(result.selection);
}

async function loadDroppedItems(event) {
  const api = compressorApi();
  if (!api) {
    return;
  }

  await loadDroppedPaths(api.droppedPathsFromFiles(event.dataTransfer.files));
}

function findOutputRow(event) {
  const inputPath = event.inputPath || "";
  if (!inputPath || !event.label) {
    return null;
  }

  return state.outputRows.find((row) => row.id === buildRowId(inputPath, event.label)) || null;
}

function updateOutputRow(event, updates) {
  const row = findOutputRow(event);
  if (!row) {
    return;
  }

  Object.assign(row, updates);
  renderQueue();
}

function markIncompleteRows(status) {
  clearCompletionTimers();
  for (const row of state.outputRows) {
    if (row.status !== "done") {
      row.status = status;
      row.progress = status === "waiting" ? 0 : row.progress;
      row.startedAt = null;
      clearRowCompletion(row);
    }
  }
  renderQueue();
}

function resetOutputRows() {
  clearCompletionTimers();
  for (const row of state.outputRows) {
    row.status = "waiting";
    row.progress = 0;
    row.startedAt = null;
    clearRowCompletion(row);
  }
  state.runState = "idle";
  elements.summaryText.textContent = `${state.outputRows.length} outputs queued from ${state.videos.length} source file${state.videos.length === 1 ? "" : "s"}.`;
  renderQueue();
  updateControls();
}

function handleEncoderEvent(event) {
  if (event.type === "run-started") {
    state.runState = "running";
    clearCompletionTimers();
    for (const row of state.outputRows) {
      row.status = "waiting";
      row.progress = 0;
      row.startedAt = null;
      clearRowCompletion(row);
    }
    elements.summaryText.textContent = `Writing exports to ${event.outputDir}`;
    renderQueue();
  }

  if (event.type === "job-started") {
    const row = findOutputRow(event);
    if (row) {
      const existingTimer = completionTimers.get(row.id);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
        completionTimers.delete(row.id);
      }
    }

    updateOutputRow(event, {
      status: "active",
      progress: 0,
      startedAt: window.performance.now(),
      completingFrom: null,
      completingStartedAt: null,
      completingDurationMs: null
    });
  }

  if (event.type === "job-progress" && typeof event.progress === "number") {
    updateOutputRow(event, {
      status: "active",
      progress: Math.max(0, Math.min(0.99, event.progress))
    });
  }

  if (event.type === "job-finished") {
    finishOutputRow(event);
  }

  if (event.type === "file-finished") {
    updateSubtitles();
  }

  if (event.type === "run-finished") {
    state.running = false;
    state.runState = "finished";
    elements.summaryText.textContent = `Finished. Outputs are in ${event.outputDir}`;
    updateControls();
  }

  if (event.type === "run-cancelled" || event.type === "run-failed") {
    state.running = false;
    state.runState = event.type === "run-cancelled" ? "cancelled" : "failed";
    elements.summaryText.textContent = event.message;
    markIncompleteRows(event.type === "run-cancelled" ? "cancelled" : "error");
    updateControls();
    openSection("output");
  }
}

function finishOutputRow(event) {
  const row = findOutputRow(event);
  if (!row) {
    return;
  }

  const startedAt = row.startedAt || window.performance.now();
  const remainingMs = Math.max(
    0,
    minimumJobProgressAnimationMs - (window.performance.now() - startedAt)
  );

  if (remainingMs === 0) {
    row.progress = 1;
    row.status = "done";
    row.startedAt = null;
    clearRowCompletion(row);
    renderQueue();
    return;
  }

  const now = window.performance.now();
  const completingFrom = displayedProgress(row, now);
  row.progress = 1;
  row.status = "active";
  row.startedAt = startedAt;
  row.completingFrom = completingFrom;
  row.completingStartedAt = now;
  row.completingDurationMs = remainingMs;
  renderQueue();

  const existingTimer = completionTimers.get(row.id);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  completionTimers.set(row.id, window.setTimeout(() => {
    completionTimers.delete(row.id);
    row.status = "done";
    row.startedAt = null;
    row.progress = 1;
    clearRowCompletion(row);
    renderQueue();
  }, remainingMs));
}

async function startCompression({ resume = false } = {}) {
  const api = compressorApi();
  if (!api || state.running) {
    return;
  }

  if (!resume) {
    resetOutputRows();
  } else {
    markIncompleteRows("waiting");
  }

  state.running = true;
  state.runState = "running";
  updateControls();
  openSection("output");

  const result = await api.start({
    selection: state.selection,
    qualityKey: currentQualityKey()
  });

  if (!result.ok) {
    state.running = false;
    state.runState = result.cancelled ? "cancelled" : "failed";
    elements.summaryText.textContent = result.message;
    markIncompleteRows(result.cancelled ? "cancelled" : "error");
    updateControls();
    openSection("output");
  }
}

async function init() {
  const api = compressorApi();

  if (elements.windowDragRegion) {
    elements.windowDragRegion.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !api || !api.startWindowDrag) {
        return;
      }

      event.preventDefault();
      api.startWindowDrag().catch(() => {});
    });
  }

  for (const toggle of elements.toggles) {
    toggle.addEventListener("click", () => {
      openSection(toggle.closest(".accordion-section").dataset.section);
    });
  }

  elements.qualitySlider.addEventListener("input", updateQualityText);
  elements.resetButton.addEventListener("click", resetSelection);
  elements.outputRestartButton.addEventListener("click", async () => {
    await startCompression();
  });
  elements.outputActionButton.addEventListener("click", async () => {
    const actionState = outputActionState();

    if (actionState.kind === "start" || actionState.kind === "restart") {
      await startCompression();
      return;
    }

    if (actionState.kind === "resume") {
      await startCompression({ resume: true });
      return;
    }

    if (actionState.kind === "stop") {
      const api = compressorApi();
      if (api) {
        elements.summaryText.textContent = "Stopping current ffmpeg process...";
        await api.cancel();
      }
    }
  });

  updateQualityText();
  renderQueue();
  updateControls();
  openSection("source");

  if (!api) {
    return;
  }

  api.onEncoderEvent(handleEncoderEvent);

  const tools = await api.checkTools();
  setToolStatus(tools);
  updateControls();

  elements.selectFileButton.addEventListener("click", async () => {
    try {
      await loadSelection(await api.selectFile());
    } catch (error) {
      elements.summaryText.textContent = `File picker failed to open. ${error.message}`;
      openSection("output");
    }
  });

  if (api.onDroppedPaths) {
    api.onDroppedPaths(async (paths, position) => {
      if (!canAcceptDrop() || !isPositionInDropZone(position)) {
        return;
      }

      state.dragDepth = 0;
      setDropActive(false);
      await loadDroppedPaths(paths);
    });
  }

  if (api.onDropState) {
    api.onDropState((active, position) => {
      if (!canAcceptDrop()) {
        return;
      }

      const isInsideDropZone = active && isPositionInDropZone(position);
      state.dragDepth = isInsideDropZone ? 1 : 0;
      setDropActive(isInsideDropZone);
    });
  }

  elements.dropZone.addEventListener("dragenter", (event) => {
    if (!canAcceptDrop(event)) {
      return;
    }

    event.preventDefault();
    state.dragDepth += 1;
    setDropActive(true);
  });

  elements.dropZone.addEventListener("dragover", (event) => {
    if (!canAcceptDrop(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  elements.dropZone.addEventListener("dragleave", (event) => {
    if (!canAcceptDrop(event)) {
      return;
    }

    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    setDropActive(state.dragDepth > 0);
  });

  elements.dropZone.addEventListener("drop", async (event) => {
    if (!canAcceptDrop(event)) {
      return;
    }

    event.preventDefault();
    state.dragDepth = 0;
    setDropActive(false);
    await loadDroppedItems(event);
  });

  window.addEventListener("dragover", (event) => {
    if (!canAcceptDrop(event)) {
      return;
    }

    event.preventDefault();
  });

  window.addEventListener("drop", (event) => {
    if (!canAcceptDrop(event) || elements.dropZone.contains(event.target)) {
      return;
    }

    event.preventDefault();
    state.dragDepth = 0;
    setDropActive(false);
  });

}

init().catch((error) => {
  elements.summaryText.textContent = `App failed to start. ${error.message}`;
});
