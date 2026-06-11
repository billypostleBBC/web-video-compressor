const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const root = path.resolve(__dirname, "..");
const sourceApp = path.join(root, "node_modules", "electron", "dist", "Electron.app");
const distDir = path.join(root, "dist");
const targetApp = path.join(distDir, "Web Video Compressor.app");
const resourcesApp = path.join(targetApp, "Contents", "Resources", "app");
const resourcesBin = path.join(targetApp, "Contents", "Resources", "bin");
const infoPlist = path.join(targetApp, "Contents", "Info.plist");
const entitlementsPath = path.join(root, "scripts", "entitlements.mac.plist");
const execFileAsync = promisify(execFile);
const packageJson = require(path.join(root, "package.json"));
const appArchive = path.join(distDir, `Web Video Compressor-${packageJson.version}-mac.zip`);
const internalArchive = path.join(distDir, `Web Video Compressor-${packageJson.version}-internal-mac.zip`);
const internalInstructions = path.join(distDir, "FIRST-RUN-INSTRUCTIONS.txt");

function hasArg(args, name) {
  return args.includes(name);
}

function buildOptions(env = process.env, args = process.argv.slice(2)) {
  const release = hasArg(args, "--release");
  const internal = hasArg(args, "--internal");
  const signIdentity = env.MACOS_SIGN_IDENTITY || (release ? "" : "-");
  const notaryProfile = env.APPLE_NOTARY_PROFILE || "";
  const appleId = env.APPLE_ID || "";
  const applePassword = env.APPLE_APP_SPECIFIC_PASSWORD || "";
  const appleTeamId = env.APPLE_TEAM_ID || "";

  if (release && internal) {
    throw new Error("Choose either --release or --internal, not both.");
  }

  if (release && !signIdentity) {
    throw new Error(
      "Release packaging requires MACOS_SIGN_IDENTITY, for example: Developer ID Application: Example Ltd (TEAMID)."
    );
  }

  if (release && !signIdentity.startsWith("Developer ID Application:")) {
    throw new Error("Release packaging requires a Developer ID Application signing identity.");
  }

  if (release && !notaryProfile && (!appleId || !applePassword || !appleTeamId)) {
    throw new Error(
      "Release packaging requires APPLE_NOTARY_PROFILE, or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID."
    );
  }

  return {
    release,
    internal,
    signIdentity,
    notaryProfile,
    appleId,
    applePassword,
    appleTeamId
  };
}

async function copyAppSource() {
  await fs.rm(targetApp, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
  await fs.cp(sourceApp, targetApp, {
    recursive: true,
    verbatimSymlinks: true
  });
}

async function copyRuntimeFiles() {
  await fs.rm(resourcesApp, { recursive: true, force: true });
  await fs.rm(resourcesBin, { recursive: true, force: true });
  await fs.mkdir(resourcesApp, { recursive: true });
  await fs.mkdir(resourcesBin, { recursive: true });

  await fs.cp(path.join(root, "src"), path.join(resourcesApp, "src"), {
    recursive: true
  });
  await fs.copyFile(path.join(root, "package.json"), path.join(resourcesApp, "package.json"));

  const ffmpegPath = require("ffmpeg-static");

  await fs.copyFile(ffmpegPath, path.join(resourcesBin, "ffmpeg"));
  await fs.chmod(path.join(resourcesBin, "ffmpeg"), 0o755);

  await fs.copyFile(
    path.join(root, "node_modules", "ffmpeg-static", "ffmpeg.LICENSE"),
    path.join(resourcesBin, "ffmpeg.LICENSE")
  );
  await fs.copyFile(
    path.join(root, "node_modules", "ffmpeg-static", "ffmpeg.README"),
    path.join(resourcesBin, "ffmpeg.README")
  );
}

async function updateInfoPlist() {
  const plistBuddy = "/usr/libexec/PlistBuddy";
  await execFileAsync(plistBuddy, ["-c", "Set :CFBundleName Web Video Compressor", infoPlist]);
  await execFileAsync(plistBuddy, ["-c", "Set :CFBundleDisplayName Web Video Compressor", infoPlist]);
  await execFileAsync(plistBuddy, [
    "-c",
    "Set :CFBundleIdentifier uk.co.bbcstoryworks.web-video-compressor",
    infoPlist
  ]);
  await execFileAsync(plistBuddy, [
    "-c",
    `Set :CFBundleShortVersionString ${packageJson.version}`,
    infoPlist
  ]);
  await execFileAsync(plistBuddy, ["-c", `Set :CFBundleVersion ${packageJson.version}`, infoPlist]);
}

async function clearExtendedAttributes() {
  await execFileAsync("xattr", ["-cr", targetApp]);
}

async function signPath(target, options, { entitlements = false } = {}) {
  const args = ["--force", "--sign", options.signIdentity];

  if (options.release) {
    args.push("--options", "runtime", "--timestamp");

    if (entitlements) {
      args.push("--entitlements", entitlementsPath);
    }
  }

  args.push(target);
  await execFileAsync("codesign", args);
}

async function signApp(options) {
  if (!options.release) {
    await execFileAsync("codesign", ["--force", "--deep", "--sign", options.signIdentity, targetApp]);
    return;
  }

  const signTargets = [
    path.join(targetApp, "Contents", "Resources", "bin", "ffmpeg"),
    path.join(
      targetApp,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Libraries",
      "libEGL.dylib"
    ),
    path.join(
      targetApp,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Libraries",
      "libGLESv2.dylib"
    ),
    path.join(
      targetApp,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Libraries",
      "libffmpeg.dylib"
    ),
    path.join(
      targetApp,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Libraries",
      "libvk_swiftshader.dylib"
    ),
    path.join(
      targetApp,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Helpers",
      "chrome_crashpad_handler"
    ),
    path.join(
      targetApp,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A"
    ),
    path.join(targetApp, "Contents", "Frameworks", "Mantle.framework", "Versions", "A"),
    path.join(targetApp, "Contents", "Frameworks", "ReactiveObjC.framework", "Versions", "A"),
    path.join(targetApp, "Contents", "Frameworks", "Squirrel.framework", "Versions", "A"),
    path.join(targetApp, "Contents", "Frameworks", "Electron Helper.app"),
    path.join(targetApp, "Contents", "Frameworks", "Electron Helper (GPU).app"),
    path.join(targetApp, "Contents", "Frameworks", "Electron Helper (Plugin).app"),
    path.join(targetApp, "Contents", "Frameworks", "Electron Helper (Renderer).app")
  ];

  for (const signTarget of signTargets) {
    await signPath(signTarget, options, { entitlements: signTarget.endsWith(".app") });
  }

  await signPath(targetApp, options, { entitlements: true });
}

async function verifyApp() {
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", targetApp]);
}

async function createArchive(archivePath) {
  await fs.rm(archivePath, { force: true });
  await execFileAsync("ditto", ["-c", "-k", "--norsrc", "--keepParent", targetApp, archivePath]);
}

function notaryArgs(options) {
  if (options.notaryProfile) {
    return ["--keychain-profile", options.notaryProfile];
  }

  return [
    "--apple-id",
    options.appleId,
    "--password",
    options.applePassword,
    "--team-id",
    options.appleTeamId
  ];
}

async function notarizeApp(options) {
  await createArchive(appArchive);
  await execFileAsync("xcrun", [
    "notarytool",
    "submit",
    appArchive,
    "--wait",
    ...notaryArgs(options)
  ]);
  await execFileAsync("xcrun", ["stapler", "staple", targetApp]);
  await execFileAsync("xcrun", ["stapler", "validate", targetApp]);
  await createArchive(appArchive);
}

function internalInstructionsText() {
  return `Web Video Compressor - first run instructions

This is an internal ad hoc-signed BBC Storyworks tool. It is not notarised by Apple.

How to open it:

1. Make sure the zip has fully downloaded or synced before opening it.
2. Double-click the zip to extract "Web Video Compressor.app".
3. Move "Web Video Compressor.app" to Applications, or run it from a fully synced local folder.
4. Open "Web Video Compressor.app".

If macOS says "Apple could not verify Web Video Compressor is free of malware":

- Do not click "Move to Bin".
- Check that the app was extracted from the zip first. Do not run it from inside the zip preview.
- If using Dropbox, wait until the app is fully synced locally before opening it. A tiny placeholder app or cloud icon means it is not ready.
- If the app was downloaded through a browser, try using the Dropbox desktop app or Finder copy instead.
- If your Mac is managed by BBC and there is no "Open Anyway" option, send the exact screenshot and the source of the app copy back to the tool owner.

Expected app name:
Web Video Compressor.app

Expected version:
${packageJson.version}
`;
}

async function createInternalDistribution() {
  await fs.writeFile(internalInstructions, internalInstructionsText(), "utf8");
  await createArchive(internalArchive);
}

async function main() {
  const options = buildOptions();

  await copyAppSource();
  await copyRuntimeFiles();
  await updateInfoPlist();
  await clearExtendedAttributes();
  await signApp(options);
  await verifyApp();

  if (options.release) {
    await notarizeApp(options);
  }

  if (options.internal) {
    await createInternalDistribution();
  }

  console.log(`Created ${targetApp}`);

  if (options.release) {
    console.log(`Created notarized archive ${appArchive}`);
  }

  if (options.internal) {
    console.log(`Created internal archive ${internalArchive}`);
    console.log(`Created first-run note ${internalInstructions}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildOptions,
  notaryArgs
};
