const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const test = require("node:test");

const { createSleepBlocker } = require("../src/sleep-blocker");

function createFakeProcess() {
  const child = new EventEmitter();
  child.killed = false;
  child.killSignal = null;
  child.kill = (signal) => {
    child.killed = true;
    child.killSignal = signal;
    return true;
  };
  return child;
}

test("sleep blocker starts caffeinate with display and system assertions on macOS", () => {
  const child = createFakeProcess();
  const calls = [];
  const blocker = createSleepBlocker({
    platform: "darwin",
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    }
  });

  assert.equal(blocker.start(), true);
  assert.equal(blocker.isActive(), true);
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/caffeinate",
      args: ["-dimsu"],
      options: {
        stdio: "ignore",
        windowsHide: true
      }
    }
  ]);
});

test("sleep blocker is a no-op outside macOS", () => {
  let spawnCalled = false;
  const blocker = createSleepBlocker({
    platform: "linux",
    spawn: () => {
      spawnCalled = true;
      return createFakeProcess();
    }
  });

  assert.equal(blocker.start(), false);
  assert.equal(blocker.isActive(), false);
  assert.equal(spawnCalled, false);
});

test("sleep blocker only starts one caffeinate process and stops it", () => {
  const child = createFakeProcess();
  let spawnCount = 0;
  const blocker = createSleepBlocker({
    platform: "darwin",
    spawn: () => {
      spawnCount += 1;
      return child;
    }
  });

  assert.equal(blocker.start(), true);
  assert.equal(blocker.start(), false);
  assert.equal(spawnCount, 1);

  assert.equal(blocker.stop(), true);
  assert.equal(child.killed, true);
  assert.equal(child.killSignal, "SIGTERM");
  assert.equal(blocker.isActive(), false);
  assert.equal(blocker.stop(), false);
});

test("sleep blocker clears active state if caffeinate exits on its own", () => {
  const child = createFakeProcess();
  const blocker = createSleepBlocker({
    platform: "darwin",
    spawn: () => child
  });

  blocker.start();
  child.emit("exit", 0);

  assert.equal(blocker.isActive(), false);
});
