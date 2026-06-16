const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const resourcesBin = path.join(root, "src-tauri", "resources", "bin");

async function main() {
  const ffmpegPath = require("ffmpeg-static");
  const target = path.join(resourcesBin, "ffmpeg");

  await fs.mkdir(resourcesBin, { recursive: true });
  await fs.copyFile(ffmpegPath, target);
  await fs.chmod(target, 0o755);

  await fs.copyFile(
    path.join(root, "node_modules", "ffmpeg-static", "ffmpeg.LICENSE"),
    path.join(resourcesBin, "ffmpeg.LICENSE")
  );
  await fs.copyFile(
    path.join(root, "node_modules", "ffmpeg-static", "ffmpeg.README"),
    path.join(resourcesBin, "ffmpeg.README")
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main };
