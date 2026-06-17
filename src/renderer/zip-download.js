(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.CompressorZip = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < crcTable.length; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[i] = value >>> 0;
  }

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
  }

  function dosTimestamp(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11)
      | (date.getMinutes() << 5)
      | Math.floor(date.getSeconds() / 2);
    const day = (year - 1980) << 9
      | ((date.getMonth() + 1) << 5)
      | date.getDate();

    return {
      time,
      day
    };
  }

  function uint16(value) {
    const bytes = new Uint8Array(2);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, value, true);
    return bytes;
  }

  function uint32(value) {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, value >>> 0, true);
    return bytes;
  }

  function encodeName(name) {
    const safeName = String(name || "download.bin")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    return new TextEncoder().encode(safeName || "download.bin");
  }

  function header(parts) {
    return new Uint8Array(parts.flatMap((part) => Array.from(part)));
  }

  async function entryBytes(entry) {
    if (entry.bytes instanceof Uint8Array) {
      return entry.bytes;
    }

    if (entry.arrayBuffer instanceof ArrayBuffer) {
      return new Uint8Array(entry.arrayBuffer);
    }

    if (entry.blob && typeof entry.blob.arrayBuffer === "function") {
      return new Uint8Array(await entry.blob.arrayBuffer());
    }

    throw new Error(`ZIP entry "${entry.name}" does not include bytes or a Blob.`);
  }

  async function createStoredZip(entries, { now = new Date() } = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("Choose at least one completed output before creating a ZIP.");
    }

    const { time, day } = dosTimestamp(now);
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encodeName(entry.name);
      const data = await entryBytes(entry);
      const checksum = crc32(data);

      if (data.byteLength > 0xffffffff || offset > 0xffffffff) {
        throw new Error("The completed outputs are too large for this ZIP download.");
      }

      const localHeader = header([
        uint32(0x04034b50),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(time),
        uint16(day),
        uint32(checksum),
        uint32(data.byteLength),
        uint32(data.byteLength),
        uint16(nameBytes.byteLength),
        uint16(0),
        nameBytes
      ]);

      const centralHeader = header([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(time),
        uint16(day),
        uint32(checksum),
        uint32(data.byteLength),
        uint32(data.byteLength),
        uint16(nameBytes.byteLength),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        nameBytes
      ]);

      localParts.push(localHeader, data);
      centralParts.push(centralHeader);
      offset += localHeader.byteLength + data.byteLength;
    }

    const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
    const endOfCentralDirectory = header([
      uint32(0x06054b50),
      uint16(0),
      uint16(0),
      uint16(entries.length),
      uint16(entries.length),
      uint32(centralSize),
      uint32(offset),
      uint16(0)
    ]);

    return new Blob([...localParts, ...centralParts, endOfCentralDirectory], {
      type: "application/zip"
    });
  }

  return {
    createStoredZip,
    crc32
  };
});
