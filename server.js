const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require('readline');
const cpuUsageLog = [0.00]
const {
    Worker,
    isMainThread,
    parentPort,
    workerData,
} = require("node:worker_threads");
const {performance} = require("node:perf_hooks");

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const monitorPort = Number(process.env.MONITOR_PORT || 8001);
const HOST = process.env.HOST || "0.0.0.0";
const cpuDetails = os.cpus();
const deviceCores = cpuDetails.length;
const cpuModel = cpuDetails[0].model;
const cpuMHz = cpuDetails[0].speed
const wasmPath = isMainThread
    ? path.join(root, "rule-worker.wasm")
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
        "Connection": "keep-alive",
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

function getSharedNumberArray(buffer) {
    return buffer ? new Float64Array(buffer) : null;
}

function writeSharedAtom(sharedAtoms, index, atom) {
    const offset = index * atomValueCount;
    sharedAtoms[offset] = atom[0];
    sharedAtoms[offset + 1] = atom[1];
    sharedAtoms[offset + 2] = atom[2];
    sharedAtoms[offset + 3] = atom[3];
    sharedAtoms[offset + 4] = atom[4];
}

function applyRulesChunkOnServer(input) {
    const sharedAtoms = getSharedAtoms(input);
    const values = sharedAtoms ? sharedAtoms.values : null;
    const atomCount = sharedAtoms ? sharedAtoms.length : input.atoms.length;
    const nextAtoms = input.nextAtomsBuffer ? new Float64Array(input.nextAtomsBuffer) : null;
    const rulesArray = getSharedNumberArray(input.rulesBuffer) || input.rulesArray;
    const radii2Array = getSharedNumberArray(input.radii2Buffer) || input.radii2Array;
    const chunkAtoms = nextAtoms ? null : new Array(input.chunkEnd - input.chunkStart);
    let totalVSum = 0;

    const numColors = input.numColors;
    const canvasWidth = input.canvasWidth;
    const canvasHeight = input.canvasHeight;
    const timeScale = input.timeScale;
    const pulse = input.pulse;
    const pulseX = input.pulseX;
    const pulseY = input.pulseY;
    const wallRepel = input.wallRepel;

    for (let i = input.chunkStart; i < input.chunkEnd; i++) {
        const offI = i * atomValueCount;
        const ax = values ? values[offI] : input.atoms[i][0];
        const ay = values ? values[offI + 1] : input.atoms[i][1];
        const avx = values ? values[offI + 2] : input.atoms[i][2];
        const avy = values ? values[offI + 3] : input.atoms[i][3];
        const color = (values ? values[offI + 4] : input.atoms[i][4]) | 0;
        const ruleRow = color * numColors;
        const r2 = radii2Array[color];
        let fx = 0;
        let fy = 0;

        // Local references to avoid repeated property lookups
        const vals = values;
        const atomsRef = input.atoms;
        const rulesRef = rulesArray;
        const radiiRef = radii2Array;

        for (let j = 0; j < atomCount; j++) {
            const oOff = j * atomValueCount;
            const bx = vals ? vals[oOff] : atomsRef[j][0];
            const by = vals ? vals[oOff + 1] : atomsRef[j][1];

            // quick skip for identical position
            const dx = ax - bx;
            const dy = ay - by;
            if (dx === 0 && dy === 0) continue;

            const d = dx * dx + dy * dy;
            if (d < r2 && d > 0) {
                const otherColor = (vals ? vals[oOff + 4] : atomsRef[j][4]) | 0;
                const g = rulesRef[ruleRow + otherColor];
                const inv = 1 / Math.sqrt(d);
                const f = g * inv;
                fx += f * dx;
                fy += f * dy;
            }
        }

        if (pulse !== 0) {
            const dx = ax - pulseX;
            const dy = ay - pulseY;
            const d = dx * dx + dy * dy;
            if (d > 0) {
                const f = (100 * pulse) / (d * timeScale);
                fx += f * dx;
                fy += f * dy;
            }
        }

        if (wallRepel > 0) {
            const d = wallRepel;
            const strength = 0.1;
            if (ax < d) fx += (d - ax) * strength;
            if (ax > canvasWidth - d) fx += (canvasWidth - d - ax) * strength;
            if (ay < d) fy += (d - ay) * strength;
            if (ay > canvasHeight - d) fy += (canvasHeight - d - ay) * strength;
        }

        // update directly using numeric values to avoid extra allocations
        const updated = updateAtomAfterForces(
            input,
            [ax, ay, avx, avy, values ? values[offI + 4] : input.atoms[i][4]],
            fx,
            fy,
        );

        if (nextAtoms) {
            const base = i * atomValueCount;
            nextAtoms[base] = updated.atom[0];
            nextAtoms[base + 1] = updated.atom[1];
            nextAtoms[base + 2] = updated.atom[2];
            nextAtoms[base + 3] = updated.atom[3];
            nextAtoms[base + 4] = updated.atom[4];
        } else {
            chunkAtoms[i - input.chunkStart] = updated.atom;
        }

        totalVSum += updated.totalV;
    }

    return {
        chunkStart: input.chunkStart,
        chunkEnd: input.chunkEnd,
        atoms: chunkAtoms,
        totalVSum,
    };
}

if (!isMainThread) {
    parentPort.on("message", ({id, input}) => {
        try {
            const result = input.chunkedThreads
                ? applyRulesChunkOnServer(input)
                : applyRulesOnServer(input);
            parentPort.postMessage({id, result});
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
        this.workers = Array.from({length: size}, (_, index) =>
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
                workerData: {wasmPath},
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

function createSharedNumberBuffer(values) {
    const buffer = new SharedArrayBuffer(
        values.length * Float64Array.BYTES_PER_ELEMENT,
    );
    new Float64Array(buffer).set(values);
    return buffer;
}

function readSharedAtomsBuffer(atomsBuffer, atomCount) {
    const atomsF64 = new Float64Array(atomsBuffer);
    const atoms = new Array(atomCount);
    let offset = 0;

    for (let i = 0; i < atomCount; i++) {
        atoms[i] = [
            atomsF64[offset],
            atomsF64[offset + 1],
            atomsF64[offset + 2],
            atomsF64[offset + 3],
            atomsF64[offset + 4],
        ];
        offset += atomValueCount;
    }

    return atoms;
}

function getParticleSetSize(input) {
    const particleSetSize = Math.floor(Number(input.particleSetSize));
    return Number.isFinite(particleSetSize) && particleSetSize > 0
        ? particleSetSize
        : 100;
}

function getDefaultParticleSetSize(input) {
    return Math.max(1, Math.ceil(input.atoms.length / ruleWorkerPool.size));
}

function applyRulesChunkedOnServer(input) {
    const particleSetSize = input.chunkedThreads
        ? getParticleSetSize(input)
        : getDefaultParticleSetSize(input);
    const chunks = [];
    const atomsBuffer = createSharedAtoms(input.atoms);
    const nextAtomsBuffer = new SharedArrayBuffer(
        input.atoms.length * atomValueCount * Float64Array.BYTES_PER_ELEMENT,
    );
    const rulesBuffer = createSharedNumberBuffer(input.rulesArray);
    const radii2Buffer = createSharedNumberBuffer(input.radii2Array);
    const sharedInput = {
        ...input,
        atoms: undefined,
        rulesArray: undefined,
        radii2Array: undefined,
        atomsBuffer,
        nextAtomsBuffer,
        rulesBuffer,
        radii2Buffer,
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
            chunkCount: 0,
            workerCount: ruleWorkerPool.size,
        });
    }

    ruleWorkerPool.growTo(chunks.length);

    return Promise.all(
        chunks.map((chunkInput) => ruleWorkerPool.run(chunkInput)),
    ).then((results) => {
        let atoms = null;
        let totalVSum = 0;

        for (const result of results) {
            totalVSum += result.totalVSum;
            if (result.atoms) {
                if (!atoms) atoms = new Array(input.atoms.length);
                for (let i = 0; i < result.atoms.length; i++) {
                    atoms[result.chunkStart + i] = result.atoms[i];
                }
            }
        }

        return {
            atoms:
                atoms || readSharedAtomsBuffer(nextAtomsBuffer, input.atoms.length),
            totalV: totalVSum / input.atoms.length,
            chunkCount: chunks.length,
            workerCount: ruleWorkerPool.size,
            sharedArrayBuffer: true,
        };
    });
}

function runRulesUpdate(input) {
    return applyRulesChunkedOnServer(input);
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

const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/apply-rules") {
        readJsonBody(request, (error, input) => {
            if (error) {
                send(response, 400, JSON.stringify({error: "Invalid JSON body"}), {
                    "Content-Type": "application/json; charset=utf-8",
                });
                return;
            }

            const frameStartTime = performance.now();

            runRulesUpdate(input)
                .then((result) => {
                    const fps = recordServerFps(performance.now() - frameStartTime);
                    send(response, 200, JSON.stringify({...result, fps}), {
                        "Content-Type": "application/json; charset=utf-8",
                    });
                })
                .catch((applyError) => {
                    console.error(applyError);
                    send(
                        response,
                        500,
                        JSON.stringify({error: "Failed to apply rules"}),
                        {
                            "Content-Type": "application/json; charset=utf-8",
                        },
                    );
                });
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
        send(response, 200, data, {"Content-Type": contentType});
    });
});

server.listen(port, HOST, () => {
    var startMessage
    if (Number(deviceCores) < 8) {
        startMessage = `[WARNING] YOUR DEVICE DOES NOT MEET THE RECOMMENDED HARDWARE REQUIREMENTS TO RUN PLSS. PROCEED WITH CAUTION AND DO NOT USE MORE THAN 4500 PARTICLES IN YOUR SIMULATION.`
    }
    if (Number(deviceCores) >= 8) {
        startMessage = `| Serving PLSS on http://localhost:${port}\n\n| Information and configuration: \n | Default Mode configured with a worker pool of ${ruleWorkerPool.size} rule workers\n | Fine Threading Mode is not bound by this worker pool, use it with caution\n | Smart Parallelism is disabled as your devices does not meet the minimum requirements to use the feature\n | PLSS's server-side code is spawning workers that run the following program: ${wasmPath}\n\n| Your device's hardware details:\n | Cores: ${deviceCores}\n | Model: ${cpuModel}\n | Clock Speed: ${cpuMHz}MHz\n\n| PLSS's system usage metrics:`
    }
    if (Number(deviceCores) >= 10) {
        startMessage = `| Serving PLSS on http://localhost:${port}\n\n| Information and configuration: \n | Default Mode configured with a worker pool of ${ruleWorkerPool.size} rule workers\n | Fine Threading Mode is not bound by this worker pool, use it with caution\n | Smart Parallelism may cause lag spikes while evaluating, this is normal and should stop after it's done\n | PLSS's server-side code is spawning workers that run the following program: ${wasmPath}\n\n| Your device's hardware details:\n | Cores: ${deviceCores}\n | Model: ${cpuModel}\n | Clock Speed: ${cpuMHz}MHz\n\n| PLSS's system usage metrics:`
    }

    console.log(`${startMessage}`);
});

function shutdown() {
    console.log(`\n\n| Complete log of CPU usage (%, oldest to newest):`)
    console.log(cpuUsageLog)
    ruleWorkerPool.close();
    server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

let previousCpuUsage = process.cpuUsage();
let previousTime = performance.now();

function getProcessCpuUsagePercentage() {
    const currentTime = performance.now();
    const currentCpuUsage = process.cpuUsage(previousCpuUsage); // Gets the delta

    // Convert millisecond time delta to microseconds to match process.cpuUsage
    const timeDeltaMicroseconds = (currentTime - previousTime) * 1000;

    // Total CPU time consumed by all threads (User + System space)
    const totalCpuTimeUsed = currentCpuUsage.user + currentCpuUsage.system;

    // Calculate percentage relative to a single core
    const cpuPercentage = (totalCpuTimeUsed / timeDeltaMicroseconds) * 100;

    // Reset baselines for the next check
    previousCpuUsage = process.cpuUsage();
    previousTime = currentTime;

    return cpuPercentage; // Note: Can exceed 100% on multi-core systems
}

// Example: Check usage every 2 seconds
setInterval(async () => {
    readline.cursorTo(process.stdout, 0, process.stdout.rows - 1);
    readline.clearLine(process.stdout, 0);

    const cpuUsagePercentage = getProcessCpuUsagePercentage().toFixed(2);

    process.stdout.write(`  | Total CPU Usage: ${cpuUsagePercentage}%`);
    cpuUsageLog.push(Number(cpuUsagePercentage))
}, 1000);