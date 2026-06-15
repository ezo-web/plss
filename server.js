const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const wasmNumberType = 1;
const wasmPageBytes = 65536;
const wasmScratchOffset = 4096;
const atomValueCount = 5;
const atomByteStride = atomValueCount * Float64Array.BYTES_PER_ELEMENT;
const maxRequestBytes = 20 * 1024 * 1024;
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
};

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
].join("; ");

const wasmBytes = fs.readFileSync(path.join(root, "life2d.wasm"));
const wasmInstance = new WebAssembly.Instance(
  new WebAssembly.Module(wasmBytes),
  {},
);
const rulesWasm = wasmInstance.exports;
let rulesWasmF64 = new Float64Array(rulesWasm.$.buffer);

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(
    new URL(url, "http://localhost").pathname,
  );
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root + path.sep)) return null;
  return filePath;
}

function ensureRulesWasmLayout(atomCount, ruleCount, radiiCount) {
  const atomsPtr = wasmScratchOffset;
  const rulesPtr = atomsPtr + atomCount * atomByteStride;
  const radii2Ptr = rulesPtr + ruleCount * Float64Array.BYTES_PER_ELEMENT;
  const requiredBytes = radii2Ptr + radiiCount * Float64Array.BYTES_PER_ELEMENT;
  const requiredPages = Math.ceil(requiredBytes / wasmPageBytes);
  const currentPages = rulesWasm.$.buffer.byteLength / wasmPageBytes;

  if (requiredPages > currentPages) {
    rulesWasm.$.grow(requiredPages - currentPages);
    rulesWasmF64 = new Float64Array(rulesWasm.$.buffer);
  }

  return {
    atomsPtr,
    rulesPtr,
    radii2Ptr,
    atomsIndex: atomsPtr / Float64Array.BYTES_PER_ELEMENT,
    rulesIndex: rulesPtr / Float64Array.BYTES_PER_ELEMENT,
    radii2Index: radii2Ptr / Float64Array.BYTES_PER_ELEMENT,
  };
}

function writeAtoms(atoms, atomsIndex) {
  let offset = atomsIndex;
  for (const atom of atoms) {
    rulesWasmF64[offset] = atom[0];
    rulesWasmF64[offset + 1] = atom[1];
    rulesWasmF64[offset + 2] = atom[2];
    rulesWasmF64[offset + 3] = atom[3];
    rulesWasmF64[offset + 4] = atom[4];
    offset += atomValueCount;
  }
}

function readAtoms(atomCount, atomsIndex) {
  const atoms = new Array(atomCount);
  let offset = atomsIndex;

  for (let i = 0; i < atomCount; i++) {
    atoms[i] = [
      rulesWasmF64[offset],
      rulesWasmF64[offset + 1],
      rulesWasmF64[offset + 2],
      rulesWasmF64[offset + 3],
      rulesWasmF64[offset + 4],
    ];
    offset += atomValueCount;
  }

  return atoms;
}

function applyRulesOnServer(input) {
  const atoms = input.atoms;
  const rulesArray = input.rulesArray;
  const radii2Array = input.radii2Array;
  const layout = ensureRulesWasmLayout(
    atoms.length,
    rulesArray.length,
    radii2Array.length,
  );

  writeAtoms(atoms, layout.atomsIndex);
  rulesWasmF64.set(rulesArray, layout.rulesIndex);
  rulesWasmF64.set(radii2Array, layout.radii2Index);

  const result = rulesWasm.applyRulesWasm(
    layout.atomsPtr,
    wasmNumberType,
    atoms.length,
    wasmNumberType,
    layout.rulesPtr,
    wasmNumberType,
    layout.radii2Ptr,
    wasmNumberType,
    input.numColors,
    wasmNumberType,
    input.pulse,
    wasmNumberType,
    input.pulseX,
    wasmNumberType,
    input.pulseY,
    wasmNumberType,
    input.timeScale,
    wasmNumberType,
    input.wallRepel,
    wasmNumberType,
    input.canvasWidth,
    wasmNumberType,
    input.canvasHeight,
    wasmNumberType,
    input.gravity,
    wasmNumberType,
    input.viscosity,
    wasmNumberType,
  );

  return {
    atoms: readAtoms(atoms.length, layout.atomsIndex),
    totalV: Array.isArray(result) ? result[0] : result,
  };
}

function readJsonBody(request, callback) {
  let body = "";

  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > maxRequestBytes) {
      request.destroy();
    }
  });

  request.on("end", () => {
    try {
      callback(null, JSON.parse(body));
    } catch (error) {
      callback(error);
    }
  });

  request.on("error", (error) => callback(error));
}

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/apply-rules") {
    readJsonBody(request, (error, input) => {
      if (error) {
        send(response, 400, JSON.stringify({ error: "Invalid JSON body" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
        return;
      }

      try {
        send(response, 200, JSON.stringify(applyRulesOnServer(input)), {
          "Content-Type": "application/json; charset=utf-8",
        });
      } catch (applyError) {
        console.error(applyError);
        send(
          response,
          500,
          JSON.stringify({ error: "Failed to apply rules" }),
          {
            "Content-Type": "application/json; charset=utf-8",
          },
        );
      }
    });
    return;
  }

  const filePath = resolveRequestPath(request.url);
  if (filePath === null) {
    send(response, 403, "Forbidden", {
      "Content-Type": "text/plain; charset=utf-8",
    });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(response, 404, "Not found", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    const contentType =
      contentTypes[path.extname(filePath)] || "application/octet-stream";
    send(response, 200, data, { "Content-Type": contentType });
  });
});

server.listen(port, () => {
  console.log(`Serving Life on port ${port}`);
});
