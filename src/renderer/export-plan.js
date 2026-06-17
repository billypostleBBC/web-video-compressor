(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.CompressorPlan = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const ACCEPTED_EXTENSIONS = [".mov", ".mp4"];
  const QUALITY_KEYS = ["low", "medium", "high"];
  const QUALITY_PRESETS = {
    low: {
      key: "low",
      label: "Low",
      description: "Smaller files, faster exports",
      mp4Crf: 34,
      webmCrf: 46
    },
    medium: {
      key: "medium",
      label: "Medium",
      description: "Default, for balanced quality and size",
      mp4Crf: 30,
      webmCrf: 42
    },
    high: {
      key: "high",
      label: "High",
      description: "Higher fidelity, larger files",
      mp4Crf: 26,
      webmCrf: 36
    }
  };
  const TARGETS = [
    { key: "1080p", width: 1920, height: 1080 },
    { key: "720p", width: 1280, height: 720 },
    { key: "480p", width: 854, height: 480 }
  ];
  const EXPORT_DEFINITIONS = TARGETS.flatMap((target) => [
    {
      kind: "mp4",
      jobLabel: `${target.key} MP4`,
      suffix: `${target.key}.mp4`,
      width: target.width,
      height: target.height
    },
    {
      kind: "webm",
      jobLabel: `${target.key} WebM`,
      suffix: `${target.key}.webm`,
      width: target.width,
      height: target.height
    }
  ]).concat({
    kind: "poster",
    jobLabel: "Poster JPG",
    suffix: "poster.jpg",
    width: 1920,
    height: 1080
  });

  function qualityPreset(qualityKey) {
    return QUALITY_PRESETS[qualityKey] || QUALITY_PRESETS.medium;
  }

  function fileName(filePath) {
    return String(filePath || "").split(/[\\/]/).pop();
  }

  function sourceName(source) {
    if (typeof source === "string") {
      return fileName(source);
    }

    return source && (source.displayName || source.name || fileName(source.path));
  }

  function sourceKey(source) {
    if (typeof source === "string") {
      return source;
    }

    return source && (source.path || source.id || source.name || source.displayName);
  }

  function outputFileName(source, suffix) {
    const name = sourceName(source);
    const extensionIndex = name.lastIndexOf(".");
    const baseName = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
    return `${baseName}-${suffix}`;
  }

  function videoFilter(width, height) {
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      "setsar=1"
    ].join(",");
  }

  function buildMp4Args(inputName, outputName, width, height, quality) {
    return [
      "-i",
      inputName,
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
      outputName
    ];
  }

  function buildWebmArgs(inputName, outputName, width, height, quality) {
    return [
      "-i",
      inputName,
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
      outputName
    ];
  }

  function buildPosterArgs(inputName, outputName, timestampSeconds) {
    return [
      "-ss",
      String(timestampSeconds),
      "-i",
      inputName,
      "-vf",
      videoFilter(1920, 1080),
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputName
    ];
  }

  function buildFfmpegArgs(exportDefinition, inputName, outputName, qualityKey) {
    const quality = qualityPreset(qualityKey);

    if (exportDefinition.kind === "mp4") {
      return buildMp4Args(inputName, outputName, exportDefinition.width, exportDefinition.height, quality);
    }

    if (exportDefinition.kind === "webm") {
      return buildWebmArgs(inputName, outputName, exportDefinition.width, exportDefinition.height, quality);
    }

    return buildPosterArgs(inputName, outputName, 3);
  }

  function buildBrowserFfmpegArgs(exportDefinition, inputName, outputName, qualityKey) {
    const args = buildFfmpegArgs(exportDefinition, inputName, outputName, qualityKey);

    if (exportDefinition.kind === "webm" && exportDefinition.width <= 854) {
      const codecIndex = args.indexOf("libvpx-vp9");
      if (codecIndex !== -1) {
        args[codecIndex] = "libvpx";
      }
    }

    return args;
  }

  function buildPosterFallbackArgs(inputName, outputName) {
    return buildPosterArgs(inputName, outputName, 0);
  }

  function buildRowId(source, label) {
    return `${sourceKey(source)}::${label}`;
  }

  function createOutputRows(videos) {
    return videos.flatMap((video) =>
      EXPORT_DEFINITIONS.map((exportDefinition) => ({
        id: buildRowId(video, exportDefinition.jobLabel),
        inputPath: sourceKey(video),
        sourceName: sourceName(video),
        jobLabel: exportDefinition.jobLabel,
        kind: exportDefinition.kind,
        width: exportDefinition.width,
        height: exportDefinition.height,
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

  function isSupportedVideoFile(filePath) {
    const name = typeof filePath === "string"
      ? filePath
      : (filePath && (filePath.name || filePath.path || filePath.displayName));
    const lowerName = String(name || "").toLowerCase();

    return ACCEPTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  }

  return {
    ACCEPTED_EXTENSIONS,
    QUALITY_KEYS,
    QUALITY_PRESETS,
    TARGETS,
    EXPORT_DEFINITIONS,
    buildRowId,
    buildBrowserFfmpegArgs,
    buildFfmpegArgs,
    buildPosterFallbackArgs,
    createOutputRows,
    fileName,
    isSupportedVideoFile,
    outputFileName,
    qualityPreset,
    videoFilter
  };
});
