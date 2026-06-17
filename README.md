# Web Video Compressor

Local-first video compressor for creating web video exports.

The repo currently contains both:

- the original Tauri desktop shell, backed by native bundled `ffmpeg`
- a browser path, backed by local `ffmpeg.wasm` assets and browser `File` objects

The browser path keeps source files on the user's device. It does not upload videos to a backend.

## Requirements

- macOS
- Node.js 22+
- Rust/Cargo for Tauri builds

## Run

```sh
npm install
npm start
```

## Run In A Browser

Prepare the local wasm assets and serve the static renderer:

```sh
npm install
npm run serve:web
```

Open `http://127.0.0.1:4173`.

The browser version loads `ffmpeg.wasm` lazily when compression starts. Encoding is slower than the desktop app and is more sensitive to browser memory limits, especially with long or high-resolution source files.

After files are selected, the browser version shows the selected total size and, when the browser can read it, source duration metadata. Large selections show a warning before encoding starts. This is guidance, not a hard limit, because browser memory ceilings vary by device and browser.

Unsupported files are ignored with a visible message. The first browser version accepts `.mov` and `.mp4` only.

Large video processing is desktop-recommended. The app can open on mobile or small-screen browsers, but browser memory limits are more likely to stop encoding there.

## Build For Web Hosting

Create a deployable static web directory:

```sh
npm run build:web
```

The output is written to `dist/web`. The build uses a minimal Astro wrapper because Webflow Cloud's BYO app path is framework-oriented. For Webflow Cloud, use:

- Build command: `npm run build:web`
- Publish directory: `dist/web`
- Node: `22.x`

Verify the local static build and critical asset MIME types:

```sh
npm run verify:web
```

The verifier checks that the ffmpeg worker JavaScript and `ffmpeg-core.wasm` are present and served with usable content types. Production still needs the same check against the deployed Webflow Cloud URL before the browser path can be considered production-proven.

After deploying, verify the live URL:

```sh
npm run verify:web:url -- https://your-live-origin.example
```

This checks the same critical files from the deployed origin and reports whether cross-origin isolation headers are present. The current single-thread wasm build does not require those headers, but they matter if the app later moves to a multi-thread ffmpeg.wasm build.

Current Webflow Cloud docs describe deployments as GitHub-connected app builds with framework detection, and the bring-your-own-app guidance is centered on Next.js and Astro. This repo now uses Astro only as a static deployment wrapper; the compressor itself remains plain browser JavaScript and still does not use a backend encoder.

`npm audit` currently reports high-severity findings through Astro/Vite/esbuild. `npm audit fix --force` would downgrade Astro to an old incompatible major, so do not apply it blindly. Revisit when the Astro/Vite advisory path has a non-breaking fix.

## Create the Mac App

Create the Apple Silicon handoff build:

```sh
npm run package:mac
```

The app is created at `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Web Video Compressor.app`. The packaged app includes bundled `ffmpeg`, so colleagues do not need Homebrew or admin access to use it.

The bundle is ad-hoc signed with signing identity `-`. This keeps the bundle internally valid for trusted local sharing, but it does not notarise the app and does not bypass managed macOS Gatekeeper policy.

For the intended small-scale handoff, share the raw `.app` only after it has fully built and fully synced locally. Users should copy/open it from a fully synced local Finder or Dropbox desktop folder. A 270-byte app in Finder is a Dropbox placeholder, not the real app. Downloading an ad-hoc signed app from Dropbox in a browser may add macOS quarantine and trigger Gatekeeper.

Verify the `.app` before sharing:

```sh
codesign --verify --deep --strict --verbose=2 "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Web Video Compressor.app"
du -sh "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Web Video Compressor.app"
```

## What It Exports

For each selected `.mov` or `.mp4`, the app creates:

- `1080p` MP4 and WebM: `1920x1080`
- `720p` MP4 and WebM: `1280x720`
- `480p` MP4 and WebM: `854x480`
- One `1920x1080` poster JPG

The desktop app writes these files to a `web-video-exports` folder. The browser app exposes completed outputs as download links because browsers cannot silently create a local output folder. Completed browser outputs can also be downloaded as one ZIP from the output panel.

Folder selection only processes top-level `.mov` and `.mp4` files in the desktop app. Browser folder upload is not enabled yet because cross-browser support depends on non-standard directory picker APIs.

## Quality

The quality slider maps to simple CRF presets:

- Low: MP4 `34`, WebM `46`
- Medium: MP4 `30`, WebM `42`
- High: MP4 `26`, WebM `36`

Higher quality means larger files and slower processing.

## Trade-Offs

The packaged app bundles a static `ffmpeg` binary. This makes the app easier to share on managed machines, but it increases the app size and means binary updates need to happen through app releases.

The bundled `ffmpeg-static` package is GPL-licensed. Keep that visible if the app is distributed beyond a small internal group.

All exports run sequentially. That is slower than parallel processing, but easier to cancel and less likely to overload a machine during the MVP stage.

The browser app uses the single-thread `@ffmpeg/core` build first. That avoids requiring cross-origin isolation headers before Webflow Cloud header support is proven. The trade-off is slower encoding.

The browser wasm build successfully generates all seven expected outputs from a small test source. One browser-specific codec adjustment is currently required: `480p` WebM uses VP8 (`libvpx`) instead of VP9 because the single-thread wasm VP9 encoder crashes with `RuntimeError: memory access out of bounds` at the `854x480` target. `1080p` and `720p` WebM still use VP9.

The browser adapter creates a fresh wasm worker per output. This is slower, but it avoids memory reuse failures observed when multiple outputs are encoded in one wasm instance.

Completed browser outputs are kept as download links if a later job fails or the user cancels. Those links are Blob URLs and only last while the page remains open.

The browser ZIP download uses a store-only ZIP container. That keeps the feature dependency-free and avoids wasting CPU recompressing MP4, WebM, and JPG files that are already compressed.

The browser app warns before closing or reloading the tab while encoding is active or while completed outputs still exist only as page-local Blob download links.

Before production deployment, Webflow Cloud still needs to prove that `.wasm` and worker assets are served with correct MIME types and headers from production URLs. The single-thread wasm build does not require `SharedArrayBuffer`, but the production proof should still confirm whether cross-origin isolation is available before considering a future multi-thread upgrade.
