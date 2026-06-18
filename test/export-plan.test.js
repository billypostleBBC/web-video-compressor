const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ACCEPTED_EXTENSIONS,
  EXPORT_DEFINITIONS,
  QUALITY_KEYS,
  TARGETS,
  createOutputRows,
  buildBrowserFfmpegArgs,
  buildFfmpegArgs,
  buildPosterFallbackArgs,
  isSupportedVideoFile,
  outputFileName,
  qualityPreset,
  videoFilter
} = require("../src/renderer/export-plan.js");

test("export plan keeps the current seven-output desktop contract", () => {
  assert.deepEqual(TARGETS, [
    { key: "1080p", width: 1920, height: 1080 },
    { key: "720p", width: 1280, height: 720 },
    { key: "480p", width: 854, height: 480 }
  ]);
  assert.deepEqual(
    EXPORT_DEFINITIONS.map(({ jobLabel, suffix, width, height }) => ({
      jobLabel,
      suffix,
      width,
      height
    })),
    [
      { jobLabel: "1080p MP4", suffix: "1080p.mp4", width: 1920, height: 1080 },
      { jobLabel: "1080p WebM", suffix: "1080p.webm", width: 1920, height: 1080 },
      { jobLabel: "720p MP4", suffix: "720p.mp4", width: 1280, height: 720 },
      { jobLabel: "720p WebM", suffix: "720p.webm", width: 1280, height: 720 },
      { jobLabel: "480p MP4", suffix: "480p.mp4", width: 854, height: 480 },
      { jobLabel: "480p WebM", suffix: "480p.webm", width: 854, height: 480 },
      { jobLabel: "Poster JPG", suffix: "poster.jpg", width: 1920, height: 1080 }
    ]
  );
});

test("createOutputRows creates named rows for every selected source", () => {
  const rows = createOutputRows([
    "/work/source/launch.mov",
    "/work/source/case-study.mp4"
  ]);

  assert.equal(rows.length, 14);
  assert.deepEqual(
    rows.slice(0, 7).map(({ inputPath, sourceName, jobLabel, label, status, progress }) => ({
      inputPath,
      sourceName,
      jobLabel,
      label,
      status,
      progress
    })),
    [
      {
        inputPath: "/work/source/launch.mov",
        sourceName: "launch.mov",
        jobLabel: "1080p MP4",
        label: "launch-1080p.mp4",
        status: "waiting",
        progress: 0
      },
      {
        inputPath: "/work/source/launch.mov",
        sourceName: "launch.mov",
        jobLabel: "1080p WebM",
        label: "launch-1080p.webm",
        status: "waiting",
        progress: 0
      },
      {
        inputPath: "/work/source/launch.mov",
        sourceName: "launch.mov",
        jobLabel: "720p MP4",
        label: "launch-720p.mp4",
        status: "waiting",
        progress: 0
      },
      {
        inputPath: "/work/source/launch.mov",
        sourceName: "launch.mov",
        jobLabel: "720p WebM",
        label: "launch-720p.webm",
        status: "waiting",
        progress: 0
      },
      {
        inputPath: "/work/source/launch.mov",
        sourceName: "launch.mov",
        jobLabel: "480p MP4",
        label: "launch-480p.mp4",
        status: "waiting",
        progress: 0
      },
      {
        inputPath: "/work/source/launch.mov",
        sourceName: "launch.mov",
        jobLabel: "480p WebM",
        label: "launch-480p.webm",
        status: "waiting",
        progress: 0
      },
      {
        inputPath: "/work/source/launch.mov",
        sourceName: "launch.mov",
        jobLabel: "Poster JPG",
        label: "launch-poster.jpg",
        status: "waiting",
        progress: 0
      }
    ]
  );
});

test("quality presets mirror native ffmpeg CRF settings", () => {
  assert.deepEqual(QUALITY_KEYS, ["low", "medium", "high"]);
  assert.deepEqual(
    ["low", "medium", "high", "unknown"].map((key) => {
      const preset = qualityPreset(key);
      return {
        key: preset.key,
        label: preset.label,
        mp4Crf: preset.mp4Crf,
        webmCrf: preset.webmCrf
      };
    }),
    [
      { key: "low", label: "Low", mp4Crf: 34, webmCrf: 46 },
      { key: "medium", label: "Medium", mp4Crf: 30, webmCrf: 42 },
      { key: "high", label: "High", mp4Crf: 26, webmCrf: 36 },
      { key: "medium", label: "Medium", mp4Crf: 30, webmCrf: 42 }
    ]
  );
});

test("ffmpeg args mirror native codec, quality, and sizing settings", () => {
  assert.equal(
    videoFilter(1920, 1080),
    "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1"
  );

  assert.deepEqual(
    buildFfmpegArgs(EXPORT_DEFINITIONS[0], "input.mov", "launch-1080p.mp4", "high"),
    [
      "-i",
      "input.mov",
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "26",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "launch-1080p.mp4"
    ]
  );

  assert.deepEqual(
    buildFfmpegArgs(EXPORT_DEFINITIONS[3], "input.mov", "launch-720p.webm", "low"),
    [
      "-i",
      "input.mov",
      "-vf",
      "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "0",
      "-crf",
      "46",
      "-row-mt",
      "1",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "launch-720p.webm"
    ]
  );

  assert.deepEqual(
    buildFfmpegArgs(EXPORT_DEFINITIONS[6], "input.mov", "launch-poster.jpg", "medium"),
    [
      "-ss",
      "3",
      "-i",
      "input.mov",
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "launch-poster.jpg"
    ]
  );

  assert.deepEqual(
    buildPosterFallbackArgs("input.mov", "launch-poster.jpg"),
    [
      "-ss",
      "0",
      "-i",
      "input.mov",
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "launch-poster.jpg"
    ]
  );
});

test("browser ffmpeg args use faster MP4 preset because wasm x264 medium is too slow", () => {
  assert.deepEqual(
    buildBrowserFfmpegArgs(EXPORT_DEFINITIONS[0], "input.mov", "launch-1080p.mp4", "medium"),
    [
      "-i",
      "input.mov",
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "launch-1080p.mp4"
    ]
  );
});

test("browser ffmpeg args use low-memory VP8 settings for WebM", () => {
  for (const [index, outputName] of [
    [1, "launch-1080p.webm"],
    [3, "launch-720p.webm"],
    [5, "launch-480p.webm"]
  ]) {
    const args = buildBrowserFfmpegArgs(EXPORT_DEFINITIONS[index], "input.mov", outputName, "medium");
    assert(args.includes("libvpx"));
    assert(!args.includes("libvpx-vp9"));
    assert(!args.includes("-row-mt"));
    assert(args.includes("-lag-in-frames"));
    assert(args.includes("-auto-alt-ref"));
    assert(args.includes("-threads"));
  }

  assert.deepEqual(
    buildBrowserFfmpegArgs(EXPORT_DEFINITIONS[5], "input.mov", "launch-480p.webm", "medium"),
    [
      "-i",
      "input.mov",
      "-vf",
      "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-c:v",
      "libvpx",
      "-b:v",
      "0",
      "-crf",
      "42",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-lag-in-frames",
      "0",
      "-auto-alt-ref",
      "0",
      "-threads",
      "1",
      "launch-480p.webm"
    ]
  );
});

test("file validation accepts only mp4 and mov names case-insensitively", () => {
  assert.deepEqual(ACCEPTED_EXTENSIONS, [".mov", ".mp4"]);
  assert.equal(isSupportedVideoFile("/work/clip.mov"), true);
  assert.equal(isSupportedVideoFile("/work/clip.MP4"), true);
  assert.equal(isSupportedVideoFile({ name: "clip.Mov" }), true);
  assert.equal(isSupportedVideoFile("/work/clip.webm"), false);
  assert.equal(isSupportedVideoFile("/work/clip.mp4.txt"), false);
});

test("output filenames preserve dotted source basenames", () => {
  assert.equal(outputFileName("/work/source/my.video.v2.mov", "720p.mp4"), "my.video.v2-720p.mp4");
});
