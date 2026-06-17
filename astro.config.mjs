import { defineConfig } from "astro/config";

export default defineConfig({
  outDir: "dist/web",
  publicDir: "public",
  srcDir: "webflow",
  build: {
    format: "file"
  }
});
