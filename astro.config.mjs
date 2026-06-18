import { defineConfig } from "astro/config";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { prepareWebAssets } = require("./scripts/prepare-web-assets.js");

prepareWebAssets();

export default defineConfig({
  publicDir: "public",
  srcDir: "webflow",
  ...(process.env.WEB_VIDEO_COMPRESSOR_OUT_DIR
    ? { outDir: process.env.WEB_VIDEO_COMPRESSOR_OUT_DIR }
    : {}),
  build: {
    format: "file"
  }
});
