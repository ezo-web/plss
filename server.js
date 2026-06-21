const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("node:worker_threads");
const { performance } = require("node:perf_hooks");

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "0.0.0.0";
const wasmPath = isMainThread
  ? path.join(root, "life2d.wasm")
  : workerData.wasmPath;
const wasmNumberType = 1;
const wasmPageBytes = 65536;
const wasmScratchOffset = 4096;
const atomValueCount = 5;
const atomByteStride = atomValueCount * Float64Array.BYTES_PER_ELEMENT;
const maxRequestBytes = 20 * 1024 * 1024;
let smoothedServerFps = 0;
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

const wasmBytes = fs.readFileSync(wasmPath);
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
    Connection: "keep-alive",
    "Keep-Alive": "timeout=5, max=100",
    "Cache-Control": "max-age=1",
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

function updateAtomAfterForces(input, atom, fx, fy) {
  fy += input.gravity;

  const vmix = 1 - input.viscosity;
  let vx = atom[2] * vmix + fx * input.timeScale;
  let vy = atom[3] * vmix + fy * input.timeScale;
  let x = atom[0] + vx;
  let y = atom[1] + vy;

  if (x < 0) {
    x = -x;
    vx *= -1;
  }
  if (x >= input.canvasWidth) {
    x = 2 * input.canvasWidth - x;
    vx *= -1;
  }
  if (y < 0) {
    y = -y;
    vy *= -1;
  }
  if (y >= input.canvasHeight) {
    y = 2 * input.canvasHeight - y;
    vy *= -1;
  }

  return {
    atom: [x, y, vx, vy, atom[4]],
    totalV: Math.abs(vx) + Math.abs(vy),
  };
}

function getSharedAtoms(input) {
  if (!input.atomsBuffer) return null;

  return {
    values: new Float64Array(input.atomsBuffer),
    length: input.atomCount,
  };
}

function readSharedAtom(sharedAtoms, index) {
  const offset = index * atomValueCount;
  return [
    sharedAtoms.values[offset],
    sharedAtoms.values[offset + 1],
    sharedAtoms.values[offset + 2],
    sharedAtoms.values[offset + 3],
    sharedAtoms.values[offset + 4],
  ];
}

function applyRulesChunkOnServer(input) {
  const sharedAtoms = getSharedAtoms(input);
  const atomCount = sharedAtoms ? sharedAtoms.length : input.atoms.length;
  const nextAtoms = new Array(input.chunkEnd - input.chunkStart);
  let totalVSum = 0;

  for (let i = input.chunkStart; i < input.chunkEnd; i++) {
    const atom = sharedAtoms ? readSharedAtom(sharedAtoms, i) : input.atoms[i];
    const ax = atom[0];
    const ay = atom[1];
    const color = atom[4];
    const ruleRow = color * input.numColors;
    const r2 = input.radii2Array[color];
    let fx = 0;
    let fy = 0;

    for (let j = 0; j < atomCount; j++) {
      const otherOffset = j * atomValueCount;
      const bx = sharedAtoms
        ? sharedAtoms.values[otherOffset]
        : input.atoms[j][0];
      const by = sharedAtoms
        ? sharedAtoms.values[otherOffset + 1]
        : input.atoms[j][1];
      const otherColor = sharedAtoms
        ? sharedAtoms.values[otherOffset + 4]
        : input.atoms[j][4];
      const dx = ax - bx;
      const dy = ay - by;

      if (dx !== 0 || dy !== 0) {
        const d = dx * dx + dy * dy;
        if (d < r2) {
          const g = input.rulesArray[ruleRow + otherColor];
          const f = g / Math.sqrt(d);
          fx += f * dx;
          fy += f * dy;
        }
      }
    }

    if (input.pulse !== 0) {
      const dx = ax - input.pulseX;
      const dy = ay - input.pulseY;
      const d = dx * dx + dy * dy;
      if (d > 0) {
        const f = (100 * input.pulse) / (d * input.timeScale);
        fx += f * dx;
        fy += f * dy;
      }
    }

    if (input.wallRepel > 0) {
      const d = input.wallRepel;
      const strength = 0.1;
      if (ax < d) fx += (d - ax) * strength;
      if (ax > input.canvasWidth - d) {
        fx += (input.canvasWidth - d - ax) * strength;
      }
      if (ay < d) fy += (d - ay) * strength;
      if (ay > input.canvasHeight - d) {
        fy += (input.canvasHeight - d - ay) * strength;
      }
    }

    const updated = updateAtomAfterForces(input, atom, fx, fy);
    nextAtoms[i - input.chunkStart] = updated.atom;
    totalVSum += updated.totalV;
  }

  return {
    chunkStart: input.chunkStart,
    atoms: nextAtoms,
    totalVSum,
  };
}

if (!isMainThread) {
  parentPort.on("message", ({ id, input }) => {
    try {
      const result = input.chunkedThreads
        ? applyRulesChunkOnServer(input)
        : applyRulesOnServer(input);
      parentPort.postMessage({ id, result });
    } catch (error) {
      parentPort.postMessage({
        id,
        error: error instanceof Error ? error.stack || error.message : error,
      });
    }
  });
  return;
}

function getRuleWorkerCount() {
  const configuredCount = Number(process.env.RULE_WORKERS);
  if (Number.isInteger(configuredCount) && configuredCount > 0) {
    return configuredCount;
  }

  const availableParallelism =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length;

  return Math.max(1, availableParallelism - 1);
}

class RuleWorkerPool {
  constructor(size) {
    this.size = size;
    this.nextJobId = 1;
    this.queue = [];
    this.workers = Array.from({ length: size }, (_, index) =>
      this.createWorker(index),
    );
  }

  growTo(size) {
    while (this.workers.length < size) {
      this.workers.push(this.createWorker(this.workers.length));
    }
    this.size = this.workers.length;
  }

  createWorker(index) {
    const slot = {
      index,
      worker: null,
      busy: false,
      currentJob: null,
    };

    const spawn = () => {
      slot.worker = new Worker(__filename, {
        workerData: { wasmPath },
      });

      slot.worker.on("message", (message) => {
        const job = slot.currentJob;
        if (!job || job.id !== message.id) return;

        if (message.error) {
          job.reject(new Error(String(message.error)));
        } else {
          job.resolve(message.result);
        }

        slot.busy = false;
        slot.currentJob = null;
        this.pump();
      });

      slot.worker.on("error", (error) => {
        if (slot.currentJob) slot.currentJob.reject(error);
        slot.busy = false;
        slot.currentJob = null;
      });

      slot.worker.on("exit", (code) => {
        if (slot.currentJob) {
          slot.currentJob.reject(
            new Error(`Rule worker exited with code ${code}`),
          );
        }
        slot.busy = false;
        slot.currentJob = null;
        if (code !== 0) spawn();
        this.pump();
      });
    };

    spawn();
    return slot;
  }

  run(input) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: this.nextJobId++,
        input,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  pump() {
    while (this.queue.length > 0) {
      const slot = this.workers.find((workerSlot) => !workerSlot.busy);
      if (!slot) return;

      const job = this.queue.shift();
      slot.busy = true;
      slot.currentJob = job;
      slot.worker.postMessage({
        id: job.id,
        input: job.input,
      });
    }
  }

  close() {
    for (const slot of this.workers) {
      slot.worker.terminate();
    }
  }
}

const ruleWorkerPool = new RuleWorkerPool(getRuleWorkerCount());

function createSharedAtoms(atoms) {
  const atomsBuffer = new SharedArrayBuffer(
    atoms.length * atomValueCount * Float64Array.BYTES_PER_ELEMENT,
  );
  const atomsF64 = new Float64Array(atomsBuffer);
  let offset = 0;

  for (const atom of atoms) {
    atomsF64[offset] = atom[0];
    atomsF64[offset + 1] = atom[1];
    atomsF64[offset + 2] = atom[2];
    atomsF64[offset + 3] = atom[3];
    atomsF64[offset + 4] = atom[4];
    offset += atomValueCount;
  }

  return atomsBuffer;
}

function getParticleSetSize(input) {
  const particleSetSize = Math.floor(Number(input.particleSetSize));
  return Number.isFinite(particleSetSize) && particleSetSize > 0
    ? particleSetSize
    : 100;
}

function applyRulesChunkedOnServer(input) {
  const particleSetSize = getParticleSetSize(input);
  const chunks = [];
  const atomsBuffer = createSharedAtoms(input.atoms);
  const sharedInput = {
    ...input,
    atoms: undefined,
    atomsBuffer,
    atomCount: input.atoms.length,
  };

  for (
    let chunkStart = 0;
    chunkStart < input.atoms.length;
    chunkStart += particleSetSize
  ) {
    chunks.push({
      ...sharedInput,
      chunkedThreads: true,
      chunkStart,
      chunkEnd: Math.min(chunkStart + particleSetSize, input.atoms.length),
    });
  }

  if (chunks.length === 0) {
    return Promise.resolve({
      atoms: [],
      totalV: 0,
    });
  }

  ruleWorkerPool.growTo(chunks.length);

  return Promise.all(
    chunks.map((chunkInput) => ruleWorkerPool.run(chunkInput)),
  ).then((results) => {
    const atoms = new Array(input.atoms.length);
    let totalVSum = 0;

    for (const result of results) {
      totalVSum += result.totalVSum;
      for (let i = 0; i < result.atoms.length; i++) {
        atoms[result.chunkStart + i] = result.atoms[i];
      }
    }

    return {
      atoms,
      totalV: totalVSum / input.atoms.length,
      chunkCount: chunks.length,
      workerCount: ruleWorkerPool.size,
    };
  });
}

function runRulesUpdate(input) {
  if (input.chunkedThreads) {
    return applyRulesChunkedOnServer(input);
  }

  return ruleWorkerPool.run(input);
}

function recordServerFps(frameDurationMs) {
  if (frameDurationMs <= 0) return Math.round(smoothedServerFps);

  const frameFps = 1000 / frameDurationMs;
  smoothedServerFps =
    smoothedServerFps === 0
      ? frameFps
      : smoothedServerFps * 0.8 + frameFps * 0.2;

  return Math.round(smoothedServerFps);
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

var online = false;

const server = http.createServer((request, response) => {
  if (online) {
    if (request.method === "POST" && request.url === "/api/apply-rules") {
      readJsonBody(request, (error, input) => {
        if (error) {
          send(response, 400, JSON.stringify({ error: "Invalid JSON body" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
          return;
        }

        const frameStartTime = performance.now();

        runRulesUpdate(input)
          .then((result) => {
            const fps = recordServerFps(performance.now() - frameStartTime);
            send(response, 200, JSON.stringify({ ...result, fps }), {
              "Content-Type": "application/json; charset=utf-8",
            });
          })
          .catch((applyError) => {
            console.error(applyError);
            send(
              response,
              500,
              JSON.stringify({ error: "Failed to apply rules" }),
              {
                "Content-Type": "application/json; charset=utf-8",
              },
            );
          });
      });
      return;
    }
  }

  if (request.method === "POST" && request.url === "/shutdown") {
    online = false;
  }
  if (request.method === "POST" && request.url === "/startup") {
    online = true;
    send(response, 200, JSON.stringify({ success: true }), {
      "Content-Type": "application/json; charset=utf-8",
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

server.listen(port, HOST, () => {
  console.log(
    `Serving Life on port ${port} with ${ruleWorkerPool.size} rule workers`,
  );
});

function shutdown() {
  ruleWorkerPool.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
