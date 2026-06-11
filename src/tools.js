const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function optionalStaticBinary(name) {
  try {
    if (name === "ffmpeg") {
      return require("ffmpeg-static");
    }
  } catch {
    return null;
  }

  return null;
}

function packagedBinaryPath(name, resourcesPath = process.resourcesPath) {
  if (!resourcesPath) {
    return null;
  }

  return path.join(resourcesPath, "bin", name);
}

async function resolveBinary(name, options = {}) {
  const resourcesPath =
    Object.prototype.hasOwnProperty.call(options, "resourcesPath")
      ? options.resourcesPath
      : process.resourcesPath;

  const candidates = [
    packagedBinaryPath(name, resourcesPath),
    optionalStaticBinary(name),
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep)) {
        await fs.access(candidate);
        return candidate;
      }

      const { stdout } = await execFileAsync("which", [candidate]);
      const resolved = stdout.trim();
      if (resolved) {
        return resolved;
      }
    } catch {
      // Try the next bundled, static, or system install location.
    }
  }

  return null;
}

async function checkTools(options = {}) {
  const ffmpegPath = await resolveBinary("ffmpeg", options);

  if (!ffmpegPath) {
    return {
      ok: false,
      ffmpegPath,
      message:
        "ffmpeg is required. Rebuild the app with bundled tools or install ffmpeg with Homebrew."
    };
  }

  return {
    ok: true,
    ffmpegPath,
    message: `Using ffmpeg at ${ffmpegPath}`
  };
}

module.exports = {
  checkTools,
  packagedBinaryPath,
  resolveBinary
};
