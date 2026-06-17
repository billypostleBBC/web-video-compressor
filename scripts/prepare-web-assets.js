const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const renderer = path.join(root, "src/renderer");
const publicDir = path.join(root, "public");
const publicFiles = [
  "styles.css",
  "export-plan.js",
  "zip-download.js",
  "browser-adapter.js",
  "renderer.js",
  "tauri-adapter.js"
];
const copies = [
  {
    from: path.join(root, "node_modules/@ffmpeg/ffmpeg/dist/esm"),
    to: path.join(publicDir, "vendor/ffmpeg/ffmpeg")
  },
  {
    from: path.join(root, "node_modules/@ffmpeg/core/dist/esm"),
    to: path.join(publicDir, "vendor/ffmpeg/core")
  }
];

fs.rmSync(publicDir, { recursive: true, force: true });
fs.mkdirSync(publicDir, { recursive: true });

for (const relativePath of publicFiles) {
  fs.copyFileSync(
    path.join(renderer, relativePath),
    path.join(publicDir, relativePath)
  );
}

for (const copy of copies) {
  fs.rmSync(copy.to, { recursive: true, force: true });
  fs.mkdirSync(copy.to, { recursive: true });
  fs.cpSync(copy.from, copy.to, { recursive: true });
}
