# Web Video Compressor

Local-only Electron app for creating web video exports with bundled `ffmpeg`.

## Requirements

- macOS
- Node.js 22+

## Run

```sh
npm install
npm start
```

## Create a Mac App

```sh
npm run package:mac
```

The app is created at `dist/Web Video Compressor.app`. The packaged app includes `ffmpeg` in `Contents/Resources/bin`, so colleagues do not need Homebrew or admin access to use it.

The default packaging script ad-hoc signs the finished `.app` after modifying the Electron bundle. This keeps the bundle internally valid for local testing if it is copied out of the repo folder, as long as the whole `.app` has fully synced first.

For Dropbox sharing, users should run the app from a fully synced Dropbox desktop folder or copy the fully synced `.app` with Finder. A 270-byte app in Finder is a Dropbox placeholder, not the real app. Downloading an ad-hoc signed app from Dropbox in a browser may add macOS quarantine and trigger Gatekeeper.

## Create an Internal Sharing Bundle

Use this for small-scale internal sharing where the app is not notarised:

```sh
npm run package:mac:internal
```

This creates:

- `dist/Web Video Compressor.app`
- `dist/Web Video Compressor-<version>-internal-mac.zip`
- `dist/FIRST-RUN-INSTRUCTIONS.txt`

Share the zip and the first-run note together. Do not share a partially synced `.app` bundle from Dropbox, because macOS app bundles are folders and can look present before every internal file has synced.

The internal bundle is still ad-hoc signed. It is suitable only for trusted small internal groups where users can receive the tool from a known source. It does not bypass BBC-managed Gatekeeper restrictions if a user receives a quarantined copy.

## Create a Signed and Notarized Release

Use this for builds that are shared with other people:

```sh
npm run package:mac:release
```

Release packaging requires:

- Apple Developer Program access.
- Xcode command line tools.
- A `Developer ID Application` certificate installed in Keychain on the build Mac.
- Notarisation credentials stored in Keychain with `xcrun notarytool`.

One-time setup:

```sh
xcrun notarytool store-credentials web-video-compressor \
  --apple-id "you@example.com" \
  --team-id "TEAMID" \
  --password "xxxx-xxxx-xxxx-xxxx"
```

Use an app-specific password from your Apple ID account, not your normal Apple ID password.

Then package with:

```sh
export MACOS_SIGN_IDENTITY="Developer ID Application: Your Name or Company (TEAMID)"
export APPLE_NOTARY_PROFILE="web-video-compressor"
npm run package:mac:release
```

The release script signs with hardened runtime, submits the app to Apple notarisation, staples the notarisation ticket to the `.app`, and creates `dist/Web Video Compressor-<version>-mac.zip` for distribution.

Verify a release before sharing:

```sh
codesign --verify --deep --strict --verbose=2 "dist/Web Video Compressor.app"
spctl --assess --type execute --verbose=4 "dist/Web Video Compressor.app"
xcrun stapler validate "dist/Web Video Compressor.app"
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
