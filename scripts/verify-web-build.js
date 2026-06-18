const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.join(__dirname, "..");
const webDir = path.join(root, "dist/web");
const appBasePath = "/web-video-compressor";
const checks = [
  {
    path: appBasePath,
    type: "text/html",
    includes: [
      "Web Video Compressor",
      `${appBasePath}/styles.css`,
      `${appBasePath}/export-plan.js`,
      `${appBasePath}/zip-download.js`,
      `${appBasePath}/browser-adapter.js`,
      `${appBasePath}/renderer.js`
    ]
  },
  { path: `${appBasePath}/styles.css?v=verify`, type: "text/css", includes: [".app-shell"] },
  { path: `${appBasePath}/export-plan.js?v=verify`, type: "javascript", includes: ["CompressorPlan"] },
  { path: `${appBasePath}/zip-download.js?v=verify`, type: "javascript", includes: ["CompressorZip"] },
  { path: `${appBasePath}/browser-adapter.js?v=verify`, type: "javascript", includes: ["window.compressor"] },
  { path: `${appBasePath}/vendor/ffmpeg/ffmpeg/index.js`, type: "javascript" },
  { path: `${appBasePath}/vendor/ffmpeg/ffmpeg/worker.js`, type: "javascript" }
];
const mimeTypes = {
  ".html": "text/html; charset=UTF-8",
  ".js": "application/javascript; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".wasm": "application/wasm"
};

function assertFile(relativePath) {
  const absolutePath = path.join(webDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing build output: ${relativePath}`);
  }

  if (fs.statSync(absolutePath).size === 0) {
    throw new Error(`Build output is empty: ${relativePath}`);
  }
}

function fileForRequest(requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);

  let relativePath = null;
  if (pathname === "/" || pathname === appBasePath) {
    relativePath = "index.html";
  } else if (pathname.startsWith(`${appBasePath}/`)) {
    relativePath = pathname.slice(appBasePath.length + 1);
  }

  if (!relativePath) {
    return null;
  }

  const filePath = path.normalize(path.join(webDir, relativePath));

  if (!filePath.startsWith(webDir)) {
    return null;
  }

  return filePath;
}

function createStaticServer() {
  const server = http.createServer((request, response) => {
    const filePath = fileForRequest(request.url || "/");

    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=UTF-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    fs.createReadStream(filePath).pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        server
      });
    });
  });
}

async function verifyUrl(origin, check) {
  const response = await fetch(`${origin}${check.path}`, { cache: "no-store" });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    throw new Error(`${check.path} returned HTTP ${response.status}`);
  }

  if (!contentType.includes(check.type)) {
    throw new Error(`${check.path} returned content-type "${contentType}", expected "${check.type}"`);
  }

  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength === 0) {
    throw new Error(`${check.path} returned an empty response body`);
  }

  if (check.includes) {
    const text = new TextDecoder().decode(body);
    for (const expectedText of check.includes) {
      if (!text.includes(expectedText)) {
        throw new Error(`${check.path} did not include expected text "${expectedText}"`);
      }
    }
  }

  if (check.magicBytes) {
    for (let index = 0; index < check.magicBytes.length; index += 1) {
      if (body[index] !== check.magicBytes[index]) {
        throw new Error(`${check.path} did not start with the expected binary signature`);
      }
    }
  }
}

async function main() {
  assertFile("index.html");
  assertFile("vendor/ffmpeg/ffmpeg/worker.js");

  if (fs.existsSync(path.join(webDir, "vendor/ffmpeg/core/ffmpeg-core.wasm"))) {
    throw new Error("Build output includes ffmpeg-core.wasm, which is too large for Webflow Cloud assets.");
  }

  const { origin, server } = await createStaticServer();

  try {
    for (const check of checks) {
      await verifyUrl(origin, check);
    }
  } finally {
    server.close();
  }

  console.log("Verified static web build assets and MIME types.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
