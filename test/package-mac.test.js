const assert = require("node:assert/strict");
const test = require("node:test");

const { buildOptions, notaryArgs } = require("../scripts/package-mac");

test("default packaging uses ad hoc signing for local builds", () => {
  const options = buildOptions({}, []);

  assert.equal(options.release, false);
  assert.equal(options.internal, false);
  assert.equal(options.signIdentity, "-");
});

test("internal packaging uses ad hoc signing and creates a handoff bundle", () => {
  const options = buildOptions({}, ["--internal"]);

  assert.equal(options.release, false);
  assert.equal(options.internal, true);
  assert.equal(options.signIdentity, "-");
});

test("packaging rejects release and internal modes together", () => {
  assert.throws(
    () =>
      buildOptions(
        {
          MACOS_SIGN_IDENTITY: "Developer ID Application: Example Ltd (ABCDE12345)",
          APPLE_NOTARY_PROFILE: "web-video-compressor"
        },
        ["--release", "--internal"]
      ),
    /either --release or --internal/
  );
});

test("release packaging requires a Developer ID signing identity", () => {
  assert.throws(
    () => buildOptions({ APPLE_NOTARY_PROFILE: "web-video-compressor" }, ["--release"]),
    /MACOS_SIGN_IDENTITY/
  );
});

test("release packaging rejects non-Developer ID signing identities", () => {
  assert.throws(
    () =>
      buildOptions(
        {
          MACOS_SIGN_IDENTITY: "Apple Development: Example Person (ABCDE12345)",
          APPLE_NOTARY_PROFILE: "web-video-compressor"
        },
        ["--release"]
      ),
    /Developer ID Application/
  );
});

test("release packaging accepts a stored notarytool profile", () => {
  const options = buildOptions(
    {
      MACOS_SIGN_IDENTITY: "Developer ID Application: Example Ltd (ABCDE12345)",
      APPLE_NOTARY_PROFILE: "web-video-compressor"
    },
    ["--release"]
  );

  assert.equal(options.release, true);
  assert.equal(options.signIdentity, "Developer ID Application: Example Ltd (ABCDE12345)");
  assert.deepEqual(notaryArgs(options), ["--keychain-profile", "web-video-compressor"]);
});

test("release packaging accepts direct Apple ID notarisation credentials", () => {
  const options = buildOptions(
    {
      MACOS_SIGN_IDENTITY: "Developer ID Application: Example Ltd (ABCDE12345)",
      APPLE_ID: "person@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "xxxx-xxxx-xxxx-xxxx",
      APPLE_TEAM_ID: "ABCDE12345"
    },
    ["--release"]
  );

  assert.deepEqual(notaryArgs(options), [
    "--apple-id",
    "person@example.com",
    "--password",
    "xxxx-xxxx-xxxx-xxxx",
    "--team-id",
    "ABCDE12345"
  ]);
});
