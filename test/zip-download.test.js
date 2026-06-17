const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createStoredZip,
  crc32
} = require("../src/renderer/zip-download.js");

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readUint16(bytes, offset) {
  return view(bytes).getUint16(offset, true);
}

function readUint32(bytes, offset) {
  return view(bytes).getUint32(offset, true);
}

async function zipBytes(entries) {
  const blob = await createStoredZip(entries, {
    now: new Date("2026-06-17T12:34:56Z")
  });
  return new Uint8Array(await blob.arrayBuffer());
}

test("crc32 matches the standard ZIP checksum fixture", () => {
  assert.equal(
    crc32(new TextEncoder().encode("123456789")).toString(16),
    "cbf43926"
  );
});

test("createStoredZip creates a store-only ZIP with central directory entries", async () => {
  const bytes = await zipBytes([
    {
      name: "launch-1080p.mp4",
      bytes: new TextEncoder().encode("mp4")
    },
    {
      name: "launch-poster.jpg",
      bytes: new TextEncoder().encode("jpg")
    }
  ]);
  const eocdOffset = bytes.byteLength - 22;

  assert.equal(readUint32(bytes, 0), 0x04034b50);
  assert.equal(readUint32(bytes, eocdOffset), 0x06054b50);
  assert.equal(readUint16(bytes, eocdOffset + 10), 2);

  const centralDirectoryOffset = readUint32(bytes, eocdOffset + 16);
  assert.equal(readUint32(bytes, centralDirectoryOffset), 0x02014b50);

  const firstNameLength = readUint16(bytes, centralDirectoryOffset + 28);
  const firstName = new TextDecoder().decode(
    bytes.slice(centralDirectoryOffset + 46, centralDirectoryOffset + 46 + firstNameLength)
  );
  const secondCentralDirectoryOffset = centralDirectoryOffset + 46 + firstNameLength;
  const secondNameLength = readUint16(bytes, secondCentralDirectoryOffset + 28);
  const secondName = new TextDecoder().decode(
    bytes.slice(secondCentralDirectoryOffset + 46, secondCentralDirectoryOffset + 46 + secondNameLength)
  );

  assert.equal(firstName, "launch-1080p.mp4");
  assert.equal(secondName, "launch-poster.jpg");
});

test("createStoredZip rejects an empty entry list", async () => {
  await assert.rejects(
    () => createStoredZip([]),
    /Choose at least one completed output/
  );
});
