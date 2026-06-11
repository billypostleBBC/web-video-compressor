const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  QUALITY_PRESETS,
  buildExportPlan,
  buildMp4Args,
  buildPosterArgs,
  buildWebmArgs,
  listInputVideos,
  outputDirForSelection
} = require("../src/encoder");

test("listInputVideos accepts only top-level mov and mp4 files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wvc-"));
  await fs.writeFile(path.join(root, "clip.mov"), "");
  await fs.writeFile(path.join(root, "clip.MP4"), "");
  await fs.writeFile(path.join(root, "notes.txt"), "");
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, "nested", "ignored.mov"), "");

  const videos = await listInputVideos({ type: "folder", path: root });

  assert.deepEqual(
    videos.map((filePath) => path.basename(filePath)).sort(),
    ["clip.MP4", "clip.mov"].sort()
  );
});

test("single file selection rejects unsupported file types", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wvc-"));
  const txt = path.join(root, "notes.txt");
  await fs.writeFile(txt, "");

  const videos = await listInputVideos({ type: "file", path: txt });

  assert.deepEqual(videos, []);
});

test("multi-file selection accepts only mov and mp4 files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wvc-"));
  const mov = path.join(root, "clip.mov");
  const mp4 = path.join(root, "clip.mp4");
  const txt = path.join(root, "notes.txt");
  await fs.writeFile(mov, "");
  await fs.writeFile(mp4, "");
  await fs.writeFile(txt, "");

  const videos = await listInputVideos({ type: "files", paths: [mov, txt, mp4] });

  assert.deepEqual(videos, [mov, mp4]);
});

test("outputDirForSelection keeps exports out of the source files", () => {
  assert.equal(
    outputDirForSelection({ type: "file", path: "/work/source/clip.mov" }),
    path.join("/work/source", "web-video-exports")
  );
  assert.equal(
    outputDirForSelection({ type: "folder", path: "/work/source" }),
    path.join("/work/source", "web-video-exports")
  );
  assert.equal(
    outputDirForSelection({
      type: "files",
      paths: ["/work/source/clip-a.mov", "/work/source/clip-b.mp4"]
    }),
    path.join("/work/source", "web-video-exports")
  );
});

test("buildExportPlan creates six videos and one poster per input", () => {
  const source = "/work/source/launch.mov";
  const plan = buildExportPlan(source, "/work/source/web-video-exports", "medium");

  assert.equal(plan.length, 7);
  assert.deepEqual(
    plan.map((item) => path.basename(item.outputPath)),
    [
      "launch-1080p.mp4",
      "launch-1080p.webm",
      "launch-720p.mp4",
      "launch-720p.webm",
      "launch-480p.mp4",
      "launch-480p.webm",
      "launch-poster.jpg"
    ]
  );
});

test("buildMp4Args uses web-safe h264 settings and exact dimensions", () => {
  const args = buildMp4Args({
    inputPath: "/in/clip.mov",
    outputPath: "/out/clip-1080p.mp4",
    width: 1920,
    height: 1080,
    quality: QUALITY_PRESETS.high
  });

  assert(args.includes("-c:v"));
  assert(args.includes("libx264"));
  assert(args.includes("-pix_fmt"));
  assert(args.includes("yuv420p"));
  assert(args.includes("+faststart"));
  assert(args.join(" ").includes("scale=1920:1080:force_original_aspect_ratio=decrease"));
  assert(args.join(" ").includes("pad=1920:1080:(ow-iw)/2:(oh-ih)/2"));
  assert(args.includes("26"));
});

test("buildWebmArgs uses vp9 and opus settings", () => {
  const args = buildWebmArgs({
    inputPath: "/in/clip.mov",
    outputPath: "/out/clip-720p.webm",
    width: 1280,
    height: 720,
    quality: QUALITY_PRESETS.low
  });

  assert(args.includes("libvpx-vp9"));
  assert(args.includes("libopus"));
  assert(args.join(" ").includes("scale=1280:720:force_original_aspect_ratio=decrease"));
  assert(args.join(" ").includes("pad=1280:720:(ow-iw)/2:(oh-ih)/2"));
  assert(args.includes("46"));
});

test("buildPosterArgs captures a 1080p jpg at the requested timestamp", () => {
  const args = buildPosterArgs({
    inputPath: "/in/clip.mov",
    outputPath: "/out/clip-poster.jpg",
    timestampSeconds: 3
  });

  assert.deepEqual(args.slice(0, 4), ["-y", "-ss", "3", "-i"]);
  assert(args.join(" ").includes("scale=1920:1080:force_original_aspect_ratio=decrease"));
  assert(args.join(" ").includes("pad=1920:1080:(ow-iw)/2:(oh-ih)/2"));
  assert(args.includes("-frames:v"));
  assert(args.includes("1"));
});
