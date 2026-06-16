# AGENTS.md

## Role And Objective

This repo is being evaluated for conversion from a local desktop video compressor into a hosted web app, with Webflow Cloud as the intended deployment target.

Act as a code-first implementation partner. The goal is not to preserve the desktop app at all costs; the goal is to ship a reliable browser-based compressor that keeps the same user value:

- select one or more `.mov` or `.mp4` files
- create web-ready MP4, WebM, and poster outputs
- keep processing local to the user's browser where practical
- expose clear progress, cancel, failure, and download states

Prefer correctness and maintainability over clever rewrites. Explain decisions when they affect browser limits, codec compatibility, file size, hosting constraints, or future scaling.

## Current Repo Audit

This repository is currently a Tauri desktop app, not yet a web app.

### Current Stack

- UI: plain HTML, CSS, and browser JavaScript in `src/renderer/`
- Native shell: Tauri 2 in `src-tauri/`
- Encoding: native `ffmpeg` executed from Rust commands
- Bundled encoder: `ffmpeg-static`, copied into Tauri resources by `scripts/prepare-tauri-resources.js`
- Tests: Node tests for the renderer adapter plus Rust unit tests inside `src-tauri/src/`

### Important Existing Boundaries

The renderer talks to a single API surface at `window.compressor`.

That is the best migration boundary. Preserve the renderer workflow while replacing the Tauri adapter with a browser adapter backed by ffmpeg.wasm.

Current native responsibilities are:

- file and folder selection through Tauri dialog APIs
- dropped path handling from native drag/drop events
- filesystem scanning of selected folders
- output folder creation
- sequential ffmpeg process execution
- progress parsing from ffmpeg stderr
- cancellation by terminating the active ffmpeg process
- opening the output folder after completion
- preventing system sleep while encoding
- desktop notification on completion

Most of those responsibilities need a browser-specific replacement rather than a direct port.

### Current Export Contract

For every selected source video, the desktop app queues seven outputs:

- `1080p` MP4: `1920x1080`
- `1080p` WebM: `1920x1080`
- `720p` MP4: `1280x720`
- `720p` WebM: `1280x720`
- `480p` MP4: `854x480`
- `480p` WebM: `854x480`
- poster JPG: `1920x1080`

The current ffmpeg filter preserves aspect ratio, pads to exact dimensions, and sets square pixels:

```text
scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1
```

Current quality presets:

- Low: MP4 CRF `34`, WebM CRF `46`
- Medium: MP4 CRF `30`, WebM CRF `42`
- High: MP4 CRF `26`, WebM CRF `36`

## Web Conversion Direction

Use a browser-first app architecture:

- keep a static frontend unless a server route is explicitly needed
- use `@ffmpeg/ffmpeg` / ffmpeg.wasm in a Web Worker for encoding
- use browser `File` objects as the source of truth
- use generated Blob URLs for downloads
- support ZIP download for batches if individual output downloads become too noisy
- keep all media processing client-side for the first production web version

Do not introduce a backend encoder, queues, uploads, cloud storage, or user accounts unless browser-side encoding proves unsuitable for the actual Webflow Cloud constraints or expected file sizes.

### Browser Constraints To Treat As Product Scope

Browser ffmpeg is not native ffmpeg. Expect these constraints and design around them:

- ffmpeg.wasm is large and must be loaded lazily with clear loading feedback
- encoding will be slower than native desktop encoding
- memory limits can block large videos, especially on managed or older machines
- browser output cannot silently create a local `web-video-exports` folder
- folder selection is limited by browser APIs and cross-browser support
- cancellation must terminate or reset the ffmpeg worker, not kill a process
- MP4/H.264 encoder availability depends on the ffmpeg.wasm build in use
- Webflow Cloud must serve worker, wasm, and core files with the correct headers

If WebM VP9 or H.264 support is missing from the chosen wasm build, do not hide it. Either choose a build that supports the required codecs or adjust the export contract explicitly.

## Development Roadmap

### Phase 1: Baseline And Test Harness

1. Confirm the current duplicated repo builds and tests locally.
2. Add tests around the export plan in JavaScript so the browser implementation can match the existing Rust behavior.
3. Document the current dirty git state before large changes.
4. Keep Tauri code intact until the web path has parity for source selection, queue creation, progress, cancel, and download.

Definition of done:

- `npm test` passes
- Rust tests pass where the local toolchain supports them
- the expected seven-output queue is covered outside Rust

### Phase 2: Extract Shared Browser App Logic

1. Move export definitions, quality presets, file validation, output naming, and queue creation into a plain JavaScript module.
2. Refactor `renderer.js` to depend on that module rather than duplicating export assumptions inline.
3. Keep the `window.compressor` API stable while adding tests for the browser-facing contract.

Definition of done:

- the existing Tauri app still runs
- queue behavior is tested without Tauri
- no encoding behavior changes

### Phase 3: Add Browser Adapter

1. Create a browser adapter that implements `window.compressor` without Tauri.
2. Replace native file paths with browser-safe file records containing `File`, display name, size, and generated IDs.
3. Support drag/drop and file input selection.
4. Decide explicitly whether folder upload is supported in MVP. If supported, use `webkitdirectory` with a visible browser-support limitation.
5. Replace native output folder behavior with per-output download links and a batch download option.

Definition of done:

- the app can be opened in a normal browser
- source selection and queue creation work without Tauri
- output UI no longer assumes local filesystem paths

### Phase 4: ffmpeg.wasm Encoding Spike

1. Load ffmpeg.wasm lazily only when compression starts.
2. Run encoding inside a worker-backed implementation.
3. Port the current MP4, WebM, and poster ffmpeg arguments as closely as the wasm build allows.
4. Verify actual codec support, output playback, dimensions, and file sizes with representative `.mov` and `.mp4` inputs.
5. Implement cancellation by terminating and recreating the worker.

Definition of done:

- one small input can produce all expected outputs
- progress and cancellation are visible
- failures tell the user what to change
- generated MP4, WebM, and poster files are manually playable/viewable

### Phase 5: Webflow Cloud Deployment Proof

1. Create the Webflow Cloud-compatible build output.
2. Confirm worker and wasm assets are emitted and served correctly.
3. Verify whether SharedArrayBuffer, cross-origin isolation, and required response headers are available in Webflow Cloud.
4. If the selected ffmpeg.wasm build requires headers that Webflow Cloud cannot set, switch to a compatible single-thread build before considering backend encoding.

Definition of done:

- deployed app loads on Webflow Cloud
- ffmpeg core files load from production URLs
- a small browser-side compression run completes in production

### Phase 6: Production Hardening

1. Add file size and duration guidance before encoding starts.
2. Add clear unsupported-file and out-of-memory failures.
3. Add a download recovery state so completed outputs are not lost if one later job fails.
4. Add mobile and small-screen checks, even if large video processing is desktop-recommended.
5. Add basic browser compatibility notes in the README.

Definition of done:

- expected user-blocking failures have visible recovery paths
- representative test files pass in local and hosted environments
- README explains limits without overstating capability

## Implementation Rules

- Keep the `window.compressor` boundary until there is a proven reason to replace it.
- Do not add a backend encoder during the first web conversion pass.
- Do not upload user videos to a server unless the user explicitly approves that product change.
- Do not promise native-app speed in the browser.
- Preserve the current export naming and dimensions unless a browser ffmpeg limitation forces a documented change.
- Prefer focused tests around encoding plans, queue state, adapter behavior, and failure handling.
- Avoid broad framework migration unless it clearly reduces implementation risk.

## Verification Expectations

For each material change:

- run `npm test`
- run Rust tests while Tauri code remains active, if the Rust toolchain is available
- run the app locally and verify the main workflow in a browser or Tauri shell as appropriate
- for frontend changes, inspect the UI in a real browser viewport
- for encoding changes, verify output files with real playback, not only file existence

