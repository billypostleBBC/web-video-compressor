const checks = [
  {
    path: "/",
    type: "text/html",
    includes: [
      "Web Video Compressor",
      "/export-plan.js",
      "/zip-download.js",
      "/browser-adapter.js",
      "/renderer.js"
    ]
  },
  { path: "/export-plan.js?v=verify", type: "javascript", includes: ["CompressorPlan"] },
  { path: "/zip-download.js?v=verify", type: "javascript", includes: ["CompressorZip"] },
  { path: "/browser-adapter.js?v=verify", type: "javascript", includes: ["window.compressor"] },
  { path: "/vendor/ffmpeg/ffmpeg/index.js", type: "javascript" },
  { path: "/vendor/ffmpeg/ffmpeg/worker.js", type: "javascript" },
  { path: "/vendor/ffmpeg/core/ffmpeg-core.js", type: "javascript" },
  {
    path: "/vendor/ffmpeg/core/ffmpeg-core.wasm",
    type: "application/wasm",
    magicBytes: [0x00, 0x61, 0x73, 0x6d]
  }
];

function usage() {
  console.error("Usage: node scripts/verify-web-url.js <origin>");
  console.error("Example: node scripts/verify-web-url.js https://example.webflow.io");
}

function normalizeOrigin(input) {
  try {
    const url = new URL(input);
    return url.origin;
  } catch {
    return null;
  }
}

async function verifyUrl(origin, check) {
  const url = new URL(check.path, origin);
  const response = await fetch(url, { cache: "no-store", redirect: "follow" });
  const contentType = response.headers.get("content-type") || "";
  const body = new Uint8Array(await response.arrayBuffer());

  if (!response.ok) {
    throw new Error(`${url.href} returned HTTP ${response.status}`);
  }

  if (!contentType.includes(check.type)) {
    throw new Error(`${url.href} returned content-type "${contentType}", expected "${check.type}"`);
  }

  if (body.byteLength === 0) {
    throw new Error(`${url.href} returned an empty response body`);
  }

  if (check.includes) {
    const text = new TextDecoder().decode(body);
    for (const expectedText of check.includes) {
      if (!text.includes(expectedText)) {
        throw new Error(`${url.href} did not include expected text "${expectedText}"`);
      }
    }
  }

  if (check.magicBytes) {
    for (let index = 0; index < check.magicBytes.length; index += 1) {
      if (body[index] !== check.magicBytes[index]) {
        throw new Error(`${url.href} did not start with the expected binary signature`);
      }
    }
  }

  return {
    path: check.path,
    status: response.status,
    contentType,
    byteLength: body.byteLength
  };
}

async function main() {
  const origin = normalizeOrigin(process.argv[2] || "");
  if (!origin) {
    usage();
    process.exit(1);
  }

  const results = [];
  for (const check of checks) {
    results.push(await verifyUrl(origin, check));
  }

  const rootResponse = await fetch(origin, { cache: "no-store" });
  const crossOriginOpenerPolicy = rootResponse.headers.get("cross-origin-opener-policy") || "";
  const crossOriginEmbedderPolicy = rootResponse.headers.get("cross-origin-embedder-policy") || "";
  const crossOriginIsolated = crossOriginOpenerPolicy.includes("same-origin")
    && crossOriginEmbedderPolicy.includes("require-corp");

  console.log(JSON.stringify({
    origin,
    results,
    headers: {
      crossOriginOpenerPolicy,
      crossOriginEmbedderPolicy,
      crossOriginIsolated
    },
    notes: [
      "The current single-thread ffmpeg.wasm build does not require SharedArrayBuffer.",
      crossOriginIsolated
        ? "Cross-origin isolation headers are present, so a future multi-thread wasm build may be possible."
        : "Cross-origin isolation headers are not present; keep the single-thread wasm build unless hosting headers change."
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
