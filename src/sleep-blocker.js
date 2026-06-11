const { spawn } = require("node:child_process");

function createSleepBlocker(options = {}) {
  const platform = options.platform || process.platform;
  const spawnProcess = options.spawn || spawn;
  const command = options.command || "/usr/bin/caffeinate";
  let processHandle = null;

  function start() {
    if (platform !== "darwin" || processHandle) {
      return false;
    }

    try {
      const child = spawnProcess(command, ["-dimsu"], {
        stdio: "ignore",
        windowsHide: true
      });

      processHandle = child;

      child.once("error", () => {
        if (processHandle === child) {
          processHandle = null;
        }
      });

      child.once("exit", () => {
        if (processHandle === child) {
          processHandle = null;
        }
      });

      return true;
    } catch {
      processHandle = null;
      return false;
    }
  }

  function stop() {
    if (!processHandle) {
      return false;
    }

    const child = processHandle;
    processHandle = null;

    if (!child.killed) {
      child.kill("SIGTERM");
    }

    return true;
  }

  return {
    start,
    stop,
    isActive: () => Boolean(processHandle)
  };
}

module.exports = {
  createSleepBlocker
};
