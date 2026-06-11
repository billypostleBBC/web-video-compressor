const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { checkTools, resolveBinary } = require("../src/tools");

test("resolveBinary prefers binaries bundled in app resources", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wvc-tools-"));
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir);

  const bundledFfmpeg = path.join(binDir, "ffmpeg");
  await fs.writeFile(bundledFfmpeg, "");

  const resolved = await resolveBinary("ffmpeg", { resourcesPath: root });

  assert.equal(resolved, bundledFfmpeg);
});

test("checkTools reports bundled ffmpeg as ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wvc-tools-"));
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir);

  const bundledFfmpeg = path.join(binDir, "ffmpeg");
  await fs.writeFile(bundledFfmpeg, "");

  const result = await checkTools({ resourcesPath: root });

  assert.equal(result.ok, true);
  assert.equal(result.ffmpegPath, bundledFfmpeg);
});
