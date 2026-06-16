# Web Video Compressor

Local-only Tauri app for creating web video exports with bundled `ffmpeg`.

## Requirements

- macOS
- Node.js 22+
- Rust/Cargo for Tauri builds

## Run

```sh
npm install
npm start
```

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

For each selected `.mov` or `.mp4`, the app writes to a `web-video-exports` folder:

- `1080p` MP4 and WebM: `1920x1080`
- `720p` MP4 and WebM: `1280x720`
- `480p` MP4 and WebM: `854x480`
- One `1920x1080` poster JPG

Folder selection only processes top-level `.mov` and `.mp4` files. Subfolders are ignored.

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
