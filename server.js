const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require('readline');
const cpuUsageLog = [0.00]
var serverFps
const {
    Worker,
    isMainThread,
    parentPort,
    workerData,
} = require("node:worker_threads");
const {performance} = require("node:perf_hooks");

const root = __dirname;
const port = Number(process.env.PORT || 3000);
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
const mode = process.env.MODE;
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

const wasmBytes = fs.existsSync(wasmPath) ? fs.readFileSync(wasmPath) : null;
let wasmInstance = null;
let rulesWasm = null;
let rulesWasmF64 = null;
if (wasmBytes) {
    wasmInstance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {});
    rulesWasm = wasmInstance.exports;
    rulesWasmF64 = new Float64Array(rulesWasm.$.buffer);
}

// Attempt to initialize WebGPU on the server (node). Prefer @webgpu/wgpu but fall back gracefully.
let gpuAvailable = false;
let gpuDevice = null;
let gpuAdapter = null;
let gpuBackend = null;

async function initWebGPU() {
    if (mode == "GPU") {
        try {
            // Try several possible Node WebGPU package names (project may have installed a different one)
            const candidates = ['webgpu', '@webgpu/wgpu', 'node-webgpu', '@webgpu/node', 'wgpu'];
            let nodeGpu = null;
            let loadedPackageName = null;
            for (const name of candidates) {
                try {
                    nodeGpu = require(name);
                    loadedPackageName = name;
                    break;
                } catch (e) {
                    // ignore and try next
                }
            }

            if (!nodeGpu) {
                console.warn('No Node WebGPU package found; GPU path disabled. Install @webgpu/wgpu or compatible package for WebGPU support.');
                return;
            }

            console.log('Using WebGPU package:', loadedPackageName);
            // Some packages export navigator.gpu-like API under .gpu
            const gpuAPI = nodeGpu.gpu || nodeGpu;

            // requestAdapter / requestDevice are async in the modern API
            if (typeof gpuAPI.requestAdapter === 'function') {
                gpuAdapter = await gpuAPI.requestAdapter();
                gpuDevice = await gpuAdapter.requestDevice();
            } else if (typeof gpuAPI.requestDevice === 'function') {
                // some bindings expose direct device creation
                gpuDevice = await gpuAPI.requestDevice();
            } else if (typeof nodeGpu.requestAdapter === 'function') {
                gpuAdapter = await nodeGpu.requestAdapter();
                gpuDevice = await gpuAdapter.requestDevice();
            }

            if (gpuDevice) {
                gpuAvailable = true;
                gpuBackend = nodeGpu;
                console.log('WebGPU initialized for server-side rule computation.');
            }
        } catch (err) {
            console.warn('WebGPU initialization failed, falling back to WASM/CPU path:', err && err.message ? err.message : err);
        }
    }
}

// Kick off initialization but don't block startup; runRulesUpdate will wait if needed
const gpuInitPromise = initWebGPU();

// GPU resource cache to avoid re-creating pipelines and buffers each frame
const gpuResources = {
    maxAtoms: 0,
    maxRules: 0,
    maxRadii: 0,
    shaderModule: null,
    pipeline: null,
    bindGroup: null,
    atomsInBuf: null,
    atomsOutBuf: null,
    rulesBuf: null,
    radiiBuf: null,
    paramsBuf: null,
    readbackBuf: null,
};

function ensureGPUResources(atomCount, ruleCount, radiiCount) {
    const device = gpuDevice;
    // Create pipeline/shader once
    if (!gpuResources.pipeline) {
        const shaderWGSL = `
struct Atom { x: f32; y: f32; vx: f32; vy: f32; color: f32; };
@group(0) @binding(0) var<storage, read> atoms_in: array<Atom>;
@group(0) @binding(1) var<storage, read_write> atoms_out: array<Atom>;
@group(0) @binding(2) var<storage, read> rules: array<f32>;
@group(0) @binding(3) var<storage, read> radii2: array<f32>;
@group(0) @binding(4) var<uniform> params: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalId : vec3<u32>) {
    let i = i32(GlobalId.x);
    let count = i32(params[0]);
    if (i >= count) { return; }

    let ax = atoms_in[i].x;
    let ay = atoms_in[i].y;
    var avx = atoms_in[i].vx;
    var avy = atoms_in[i].vy;
    let color = i32(atoms_in[i].color);
    let numColors = i32(params[1]);
    let ruleRow = color * numColors;
    let r2 = radii2[color];
    var fx: f32 = 0.0;
    var fy: f32 = 0.0;

    var j: i32 = 0;
    for (; j < count; j = j + 1) {
        if (j == i) { continue; }
        let bx = atoms_in[j].x;
        let by = atoms_in[j].y;
        let dx = ax - bx;
        let dy = ay - by;
        if (dx == 0.0 && dy == 0.0) { continue; }
        let d = dx * dx + dy * dy;
        if (d < r2 && d > 0.0) {
            let otherColor = i32(atoms_in[j].color);
            let idx = ruleRow + otherColor;
            let g = rules[idx];
            let inv = 1.0 / sqrt(d);
            let f = g * inv;
            fx = fx + f * dx;
            fy = fy + f * dy;
        }
    }

    let pulse = params[3];
    if (pulse != 0.0) {
        let dx = ax - params[4];
        let dy = ay - params[5];
        let d = dx * dx + dy * dy;
        if (d > 0.0) {
            let f = (100.0 * pulse) / (d * params[2]);
            fx = fx + f * dx;
            fy = fy + f * dy;
        }
    }

    let wallRepel = params[6];
    if (wallRepel > 0.0) {
        let d = wallRepel;
        let strength = 0.1;
        if (ax < d) { fx = fx + (d - ax) * strength; }
        if (ax > params[7] - d) { fx = fx + (params[7] - d - ax) * strength; }
        if (ay < d) { fy = fy + (d - ay) * strength; }
        if (ay > params[8] - d) { fy = fy + (params[8] - d - ay) * strength; }
    }

    var fy_total = fy + params[9];
    let vmix = 1.0 - params[10];
    var vx = avx * vmix + fx * params[2];
    var vy = avy * vmix + fy_total * params[2];
    var x = ax + vx;
    var y = ay + vy;

    if (x < 0.0) { x = -x; vx = -vx; }
    if (x >= params[7]) { x = 2.0 * params[7] - x; vx = -vx; }
    if (y < 0.0) { y = -y; vy = -vy; }
    if (y >= params[8]) { y = 2.0 * params[8] - y; vy = -vy; }

    atoms_out[i].x = x;
    atoms_out[i].y = y;
    atoms_out[i].vx = vx;
    atoms_out[i].vy = vy;
    atoms_out[i].color = atoms_in[i].color;
}
`;
        gpuResources.shaderModule = device.createShaderModule({code: shaderWGSL});
        gpuResources.pipeline = device.createComputePipeline({
            compute: {
                module: gpuResources.shaderModule,
                entryPoint: 'main'
            }
        });
    }

    // Grow buffers if needed
    const atomBytes = atomCount * atomValueCount * 4; // f32
    if (!gpuResources.atomsInBuf || gpuResources.maxAtoms < atomCount) {
        gpuResources.maxAtoms = Math.max(atomCount, gpuResources.maxAtoms * 2 || atomCount);
        const size = gpuResources.maxAtoms * atomValueCount * 4;
        gpuResources.atomsInBuf = device.createBuffer({
            size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        gpuResources.atomsOutBuf = device.createBuffer({
            size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        // readback buffer
        gpuResources.readbackBuf = device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
    }

    if (!gpuResources.rulesBuf || gpuResources.maxRules < ruleCount) {
        gpuResources.maxRules = Math.max(ruleCount, gpuResources.maxRules * 2 || ruleCount);
        const size = gpuResources.maxRules * 4;
        gpuResources.rulesBuf = device.createBuffer({
            size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
    }

    if (!gpuResources.radiiBuf || gpuResources.maxRadii < radiiCount) {
        gpuResources.maxRadii = Math.max(radiiCount, gpuResources.maxRadii * 2 || radiiCount);
        const size = gpuResources.maxRadii * 4;
        gpuResources.radiiBuf = device.createBuffer({
            size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
    }

    // params buffer fixed small size
    if (!gpuResources.paramsBuf) {
        gpuResources.paramsBuf = device.createBuffer({
            size: 11 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
    }

    // Recreate bind group to reference current buffers
    gpuResources.bindGroup = gpuDevice.createBindGroup({
        layout: gpuResources.pipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: {buffer: gpuResources.atomsInBuf}},
            {binding: 1, resource: {buffer: gpuResources.atomsOutBuf}},
            {binding: 2, resource: {buffer: gpuResources.rulesBuf}},
            {binding: 3, resource: {buffer: gpuResources.radiiBuf}},
            {binding: 4, resource: {buffer: gpuResources.paramsBuf}},
        ],
    });
}

async function applyRulesOnGPU(input) {
    if (!gpuAvailable || !gpuDevice) throw new Error('WebGPU device not available');
    const atomCount = input.atoms.length;
    if (atomCount === 0) return {atoms: [], totalV: 0};

    const atomsF32 = new Float32Array(atomCount * atomValueCount);
    for (let i = 0; i < atomCount; i++) {
        const a = input.atoms[i];
        const off = i * atomValueCount;
        atomsF32[off] = a[0];
        atomsF32[off + 1] = a[1];
        atomsF32[off + 2] = a[2];
        atomsF32[off + 3] = a[3];
        atomsF32[off + 4] = a[4];
    }

    const rulesF32 = new Float32Array(input.rulesArray.map((v) => v));
    const radiiF32 = new Float32Array(input.radii2Array.map((v) => v));

    // ensure buffers/pipeline sized
    ensureGPUResources(atomCount, rulesF32.length, radiiF32.length);

    const device = gpuDevice;

    // Upload only the needed ranges
    device.queue.writeBuffer(gpuResources.atomsInBuf, 0, atomsF32.buffer, atomsF32.byteOffset, atomsF32.byteLength);
    device.queue.writeBuffer(gpuResources.rulesBuf, 0, rulesF32.buffer, rulesF32.byteOffset, rulesF32.byteLength);
    device.queue.writeBuffer(gpuResources.radiiBuf, 0, radiiF32.buffer, radiiF32.byteOffset, radiiF32.byteLength);

    const paramsArray = new Float32Array([
        atomCount,
        input.numColors,
        input.forceScale,
        input.pulse,
        input.pulseX,
        input.pulseY,
        input.wallRepel,
        input.canvasWidth,
        input.canvasHeight,
        input.gravity,
        input.viscosity,
    ]);
    device.queue.writeBuffer(gpuResources.paramsBuf, 0, paramsArray.buffer, paramsArray.byteOffset, paramsArray.byteLength);

    const commandEncoder = device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(gpuResources.pipeline);
    pass.setBindGroup(0, gpuResources.bindGroup);
    const workgroupSize = 64;
    const numGroups = Math.ceil(atomCount / workgroupSize);
    pass.dispatchWorkgroups(numGroups);
    pass.end();

    commandEncoder.copyBufferToBuffer(gpuResources.atomsOutBuf, 0, gpuResources.readbackBuf, 0, atomCount * atomValueCount * 4);
    device.queue.submit([commandEncoder.finish()]);

    // Map and read results (use numeric READ flag if constants are not exposed)
    const MAP_READ = (typeof gpuBackend !== 'undefined' && gpuBackend.GPUMapMode && gpuBackend.GPUMapMode.READ) || 1;
    await gpuResources.readbackBuf.mapAsync(MAP_READ, 0, atomCount * atomValueCount * 4);
    const mapped = gpuResources.readbackBuf.getMappedRange(0, atomCount * atomValueCount * 4);
    const resultF32 = new Float32Array(mapped.slice(0));
    gpuResources.readbackBuf.unmap();

    const atomsOut = new Array(atomCount);
    let totalVSum = 0;
    for (let i = 0; i < atomCount; i++) {
        const off = i * atomValueCount;
        const x = resultF32[off];
        const y = resultF32[off + 1];
        const vx = resultF32[off + 2];
        const vy = resultF32[off + 3];
        const c = Math.floor(resultF32[off + 4]);
        atomsOut[i] = [x, y, vx, vy, c];
        totalVSum += Math.abs(vx) + Math.abs(vy);
    }

    console.log(`WebGPU: computed ${atomCount} atoms, avgV=${(totalVSum / atomCount).toFixed(4)}`);
    return {atoms: atomsOut, totalV: totalVSum / atomCount};
}


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
        input.forceScale,
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
    let vx = atom[2] * vmix + fx * input.forceScale;
    let vy = atom[3] * vmix + fy * input.forceScale;
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
    const forceScale = input.forceScale;
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
                const f = (100 * pulse) / (d * forceScale);
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

async function runRulesUpdate(input) {
    // Wait briefly for GPU init if in progress
    try {
        await Promise.race([
            gpuInitPromise,
            new Promise((res) => setTimeout(res, 300)),
        ]);
    } catch (e) {
        // ignore init errors; detection below will fall back
    }

    if (gpuAvailable && gpuDevice) {
        try {
            const t0 = performance.now();
            const result = await applyRulesOnGPU(input);
            const t1 = performance.now();
            console.log(`WebGPU time: ${(t1 - t0).toFixed(2)}ms`);
            return result;
        } catch (err) {
            console.error('WebGPU computation failed, falling back to CPU worker pool:', err && err.message ? err.message : err);
        }
    }

    // Fallback: existing chunked CPU/worker implementation
    const t0 = performance.now();
    const cpuResult = await applyRulesChunkedOnServer(input);
    const t1 = performance.now();
    // console.log(`CPU time: ${(t1 - t0).toFixed(2)}ms`);
    return cpuResult;
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
                    serverFps = fps;
                    send(response, 200, JSON.stringify({...result, fps, frameStartTime, deviceCores}), {
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
        startMessage = `[WARNING] YOUR DEVICE DOES NOT MEET THE RECOMMENDED HARDWARE REQUIREMENTS TO RUN PLSS. PROCEED WITH CAUTION AND DO NOT USE MORE THAN 2500 PARTICLES IN YOUR SIMULATION.`
    }
    if (HOST !== "0.0.0.0") {
        if (Number(deviceCores) >= 8) {
            startMessage = `| Serving PLSS on http://${HOST}:${port}\n\n| Information and configuration: \n | Default Mode configured with a worker pool of ${ruleWorkerPool.size} rule workers\n | Fine Threading Mode is not bound by this worker pool, use it with caution\n | Smart Parallelism is disabled as your devices does not meet the minimum requirements to use the feature\n | PLSS's server-side code is spawning workers that run the following program: ${wasmPath}\n\n| Your device's hardware details:\n | Cores: ${deviceCores}\n | Model: ${cpuModel}\n | Clock Speed: ${cpuMHz}MHz\n\n| PLSS's system usage metrics:`
        }
        if (Number(deviceCores) >= 10) {
            startMessage = `| Serving PLSS on http://${HOST}:${port}\n\n| Information and configuration: \n | Default Mode configured with a worker pool of ${ruleWorkerPool.size} rule workers\n | Fine Threading Mode is not bound by this worker pool, use it with caution\n | Smart Parallelism may cause lag spikes while evaluating, this is normal and should stop after it's done\n | PLSS's server-side code is spawning workers that run the following program: ${wasmPath}\n\n| Your device's hardware details:\n | Cores: ${deviceCores}\n | Model: ${cpuModel}\n | Clock Speed: ${cpuMHz}MHz\n\n| PLSS's system usage metrics:`
        }
    } else {
        if (Number(deviceCores) >= 8) {
            startMessage = `| Serving PLSS on http://localhost:${port}\n\n| Information and configuration: \n | Default Mode configured with a worker pool of ${ruleWorkerPool.size} rule workers\n | Fine Threading Mode is not bound by this worker pool, use it with caution\n | Smart Parallelism is disabled as your devices does not meet the minimum requirements to use the feature\n | PLSS's server-side code is spawning workers that run the following program: ${wasmPath}\n\n| Your device's hardware details:\n | Cores: ${deviceCores}\n | Model: ${cpuModel}\n | Clock Speed: ${cpuMHz}MHz\n\n| PLSS's system usage metrics:`
        }
        if (Number(deviceCores) >= 10) {
            startMessage = `| Serving PLSS on http://localhost:${port}\n\n| Information and configuration: \n | Default Mode configured with a worker pool of ${ruleWorkerPool.size} rule workers\n | Fine Threading Mode is not bound by this worker pool, use it with caution\n | Smart Parallelism may cause lag spikes while evaluating, this is normal and should stop after it's done\n | PLSS's server-side code is spawning workers that run the following program: ${wasmPath}\n\n| Your device's hardware details:\n | Cores: ${deviceCores}\n | Model: ${cpuModel}\n | Clock Speed: ${cpuMHz}MHz\n\n| PLSS's system usage metrics:`
        }
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

    process.stdout.write(`  | Total CPU Usage: ${cpuUsagePercentage}% | Server FPS: ${serverFps} |`);
    cpuUsageLog.push(Number(cpuUsagePercentage))
}, 1000);