const fs = require("node:fs/promises");
const path = require("node:path");

const ACCEPTED_EXTENSIONS = new Set([".mov", ".mp4"]);

const TARGETS = [
  { key: "1080p", width: 1920, height: 1080 },
  { key: "720p", width: 1280, height: 720 },
  { key: "480p", width: 854, height: 480 }
];

const QUALITY_PRESETS = {
  low: { label: "Low", mp4Crf: 34, webmCrf: 46 },
  medium: { label: "Medium", mp4Crf: 30, webmCrf: 42 },
  high: { label: "High", mp4Crf: 26, webmCrf: 36 }
};

function isSupportedVideoFile(filePath) {
  return ACCEPTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function listInputVideos(selection) {
  if (!selection || !selection.type) {
    return [];
  }

  if (selection.type === "files") {
    return Array.isArray(selection.paths)
      ? selection.paths.filter(isSupportedVideoFile)
      : [];
  }

  if (!selection.path) {
    return [];
  }

  if (selection.type === "file") {
    return isSupportedVideoFile(selection.path) ? [selection.path] : [];
  }

  if (selection.type !== "folder") {
    return [];
  }

  const entries = await fs.readdir(selection.path, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(selection.path, entry.name))
    .filter(isSupportedVideoFile)
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function outputDirForSelection(selection) {
  if (selection.type === "folder") {
    return path.join(selection.path, "web-video-exports");
  }

  if (selection.type === "files") {
    return Array.isArray(selection.paths) && selection.paths.length > 0
      ? path.join(path.dirname(selection.paths[0]), "web-video-exports")
      : null;
  }

  return path.join(path.dirname(selection.path), "web-video-exports");
}

function videoFilter(width, height) {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1"
  ].join(",");
}

function buildMp4Args({ inputPath, outputPath, width, height, quality }) {
  return [
    "-y",
    "-i",
    inputPath,
    "-vf",
    videoFilter(width, height),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    String(quality.mp4Crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    outputPath
  ];
}

function buildWebmArgs({ inputPath, outputPath, width, height, quality }) {
  return [
    "-y",
    "-i",
    inputPath,
    "-vf",
    videoFilter(width, height),
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "0",
    "-crf",
    String(quality.webmCrf),
    "-row-mt",
    "1",
    "-c:a",
    "libopus",
    "-b:a",
    "128k",
    outputPath
  ];
}

function buildPosterArgs({ inputPath, outputPath, timestampSeconds }) {
  return [
    "-y",
    "-ss",
    String(timestampSeconds),
    "-i",
    inputPath,
    "-vf",
    videoFilter(1920, 1080),
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outputPath
  ];
}

function buildExportPlan(inputPath, outputDir, qualityKey) {
  const quality = QUALITY_PRESETS[qualityKey] || QUALITY_PRESETS.medium;
  const name = path.basename(inputPath, path.extname(inputPath));
  const jobs = [];

  for (const target of TARGETS) {
    const mp4Output = path.join(outputDir, `${name}-${target.key}.mp4`);
    jobs.push({
      kind: "mp4",
      label: `${target.key} MP4`,
      inputPath,
      outputPath: mp4Output,
      args: buildMp4Args({
        inputPath,
        outputPath: mp4Output,
        width: target.width,
        height: target.height,
        quality
      })
    });

    const webmOutput = path.join(outputDir, `${name}-${target.key}.webm`);
    jobs.push({
      kind: "webm",
      label: `${target.key} WebM`,
      inputPath,
      outputPath: webmOutput,
      args: buildWebmArgs({
        inputPath,
        outputPath: webmOutput,
        width: target.width,
        height: target.height,
        quality
      })
    });
  }

  const posterOutput = path.join(outputDir, `${name}-poster.jpg`);
  jobs.push({
    kind: "poster",
    label: "Poster JPG",
    inputPath,
    outputPath: posterOutput,
    args: buildPosterArgs({
      inputPath,
      outputPath: posterOutput,
      timestampSeconds: 3
    }),
    fallbackArgs: buildPosterArgs({
      inputPath,
      outputPath: posterOutput,
      timestampSeconds: 0
    })
  });

  return jobs;
}

module.exports = {
  ACCEPTED_EXTENSIONS,
  QUALITY_PRESETS,
  TARGETS,
  buildExportPlan,
  buildMp4Args,
  buildPosterArgs,
  buildWebmArgs,
  isSupportedVideoFile,
  listInputVideos,
  outputDirForSelection,
  videoFilter
};
