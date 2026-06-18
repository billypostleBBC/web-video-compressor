const checks = [
  {
    path: "",
    type: "text/html",
    includes: [
      "Web Video Compressor",
      "/web-video-compressor/styles.css",
      "/web-video-compressor/export-plan.js",
      "/web-video-compressor/zip-download.js",
      "/web-video-compressor/browser-adapter.js",
      "/web-video-compressor/renderer.js"
    ]
  },
  { path: "styles.css?v=verify", type: "text/css", includes: [".app-shell"] },
  { path: "export-plan.js?v=verify", type: "javascript", includes: ["CompressorPlan"] },
  { path: "zip-download.js?v=verify", type: "javascript", includes: ["CompressorZip"] },
  { path: "browser-adapter.js?v=verify", type: "javascript", includes: ["window.compressor", "cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10"] },
  { path: "vendor/ffmpeg/ffmpeg/index.js", type: "javascript" },
  { path: "vendor/ffmpeg/ffmpeg/worker.js", type: "javascript" }
];

function usage() {
  console.error("Usage: node scripts/verify-web-url.js <app-url>");
  console.error("Example: node scripts/verify-web-url.js https://example.webflow.io/web-video-compressor");
}

function normalizeBaseUrl(input) {
  try {
    const url = new URL(input);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url;
  } catch {
    return null;
  }
}

async function verifyUrl(baseUrl, check) {
  const url = check.path === ""
    ? new URL(baseUrl.href)
    : new URL(`${baseUrl.pathname}/${check.path}`, baseUrl.origin);
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
  const baseUrl = normalizeBaseUrl(process.argv[2] || "");
  if (!baseUrl) {
    usage();
    process.exit(1);
  }

  const results = [];
  for (const check of checks) {
    results.push(await verifyUrl(baseUrl, check));
  }

  const rootResponse = await fetch(baseUrl, { cache: "no-store" });
  const crossOriginOpenerPolicy = rootResponse.headers.get("cross-origin-opener-policy") || "";
  const crossOriginEmbedderPolicy = rootResponse.headers.get("cross-origin-embedder-policy") || "";
  const crossOriginIsolated = crossOriginOpenerPolicy.includes("same-origin")
    && crossOriginEmbedderPolicy.includes("require-corp");

  console.log(JSON.stringify({
    appUrl: baseUrl.href,
    results,
    headers: {
      crossOriginOpenerPolicy,
      crossOriginEmbedderPolicy,
      crossOriginIsolated
    },
    notes: [
      "The current single-thread ffmpeg.wasm core is loaded from a pinned CDN URL because Webflow Cloud rejects the 31 MB wasm file as an oversized asset.",
      "The CDN-hosted encoder still runs in the user's browser; source videos are not uploaded to an encoder backend.",
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
