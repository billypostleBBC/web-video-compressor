const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const output = path.join(root, "dist/web");
const requiredFiles = [
  "index.html",
  "styles.css",
  "export-plan.js",
  "zip-download.js",
  "browser-adapter.js",
  "renderer.js",
  "tauri-adapter.js",
  "vendor/ffmpeg/ffmpeg/index.js",
  "vendor/ffmpeg/ffmpeg/worker.js"
];

fs.rmSync(output, { recursive: true, force: true });
childProcess.execFileSync("npx", ["astro", "build"], {
  cwd: root,
  env: {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: "1",
    WEB_VIDEO_COMPRESSOR_OUT_DIR: "dist/web"
  },
  stdio: "inherit"
});

for (const relativePath of requiredFiles) {
  const filePath = path.join(output, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required web build output: ${relativePath}`);
  }
}

console.log(`Verified Astro static web app at ${path.relative(root, output)}`);
