const maxRadius = 200;
const maxClusters = 50;
const minClusterSize = 10;
const minSmartParticleSetSize = 20;
const predefinedColors = [
    "green",
    "red",
    "orange",
    "cyan",
    "magenta",
    "lavender",
    "teal",
    "yellow",
    "blue",
    "white",
    "lime",
    "purple",
    "pink",
    "brown",
    "coral",
    "gold",
    "silver",
    "maroon",
    "navy",
];
const settings = {
    seed: 91651088029,
    fps: 0,
    atomCount: 0,
    atoms: {
        count: 500, // Per Color
        radius: 1,
    },
    drawings: {
        // Drawing options can be expensive on performance
        lines: false, // draw lines between atoms that arr effecting each other
        circle: false, // draw atoms as circles
        clusters: false,
        background_color: "#000000", // Background color
    },
    export: {
        // Export a Screenshot image
        image: () => {
            const imageDataURL = canvas.toDataURL({
                format: "png",
                quality: 1,
            });
            dataURL_downloader(imageDataURL);
        },
        // Export a video recording
        video: () => {
            mediaRecorder.state == "recording"
                ? mediaRecorder.stop()
                : mediaRecorder.start();
        },
    },
    explore: false,
    explorePeriod: 100,
    chunkedThreads: false,
    smartChunking: false,
    particleSetSize: 50,
    rules: {},
    rulesArray: [],
    radii: {},
    radii2Array: [],
    colors: [],
    numColors: 4,
    time_scale: 1.0,
    viscosity: 0.7, // speed-dampening (can be >1 !)
    gravity: 0.0, // pulling downward
    pulseDuration: 10,
    wallRepel: 40,
    reset: () => {
        randomAtoms(settings.atoms.count, true);
    },
    randomRules: () => {
        settings.seed = local_seed; // last used seed is the new starting seed
        startRandom();
    },
    symmetricRules: () => {
        symmetricRules();
        randomAtoms(settings.atoms.count, true);
        updateGUIDisplay();
    },
    gui: null,
};

const setupClicks = () => {
    canvas.addEventListener("click", (e) => {
        pulse = settings.pulseDuration;
        if (e.shiftKey) pulse = -pulse;
        pulse_x = e.clientX;
        pulse_y = e.clientY;
    });
};
const setupKeys = () => {
    canvas.addEventListener("keydown", function (e) {
        console.log(e.key);
        switch (e.key) {
            case "r":
                settings.randomRules();
                break;
            case "t":
                settings.drawings.clusters = !settings.drawings.clusters;
                break;
            case "o":
                settings.reset();
                break;
            case "s":
                settings.symmetricRules();
                break;
            default:
                console.log(e.key);
        }
    });
};
const updateGUIDisplay = () => {
    console.log("gui", settings.gui);
    settings.gui.destroy();
    setupGUI();
};
Object.defineProperty(String.prototype, "capitalise", {
    value: function () {
        return this.charAt(0).toUpperCase() + this.slice(1);
    },
    enumerable: false,
});

const smartChunking = {
    active: false,
    settled: false,
    phase: "idle",
    candidates: [],
    candidateIndex: 0,
    searchRound: 0,
    sampleCount: 0,
    sampleTotal: 0,
    bestFps: 0,
    bestSize: 100,
    lastCandidateSize: 100,
    framesPerSample: 50, // collect 50 frames per sample
    maxSearchRounds: 7, // run 7 rounds of evaluation
    improvementRatio: 0.1, // require 10% improvement to keep a new candidate size
};

let smartChunkingController = null;
let particleSetSizeController = null;

function clampParticleSetSize(value) {
    const maxSize = Math.max(1, atoms.length || settings.atoms.count);
    return Math.min(maxSize, Math.max(1, Math.floor(value)));
}

function clampSmartParticleSetSize(value) {
    const maxSize = Math.max(
        minSmartParticleSetSize,
        atoms.length || settings.atoms.count,
    );
    return Math.min(
        maxSize,
        Math.max(minSmartParticleSetSize, Math.floor(value)),
    );
}

function setParticleSetSize(value) {
    settings.particleSetSize = clampParticleSetSize(value);
    if (particleSetSizeController) particleSetSizeController.updateDisplay();
    invalidateServerStep();
}

function getSmartParticleSetMax() {
    return Math.max(minSmartParticleSetSize, atoms.length || settings.atoms.count);
}

function uniqueSmartParticleSetSizes(sizes) {
    const seen = new Set();
    const values = [];

    for (const size of sizes) {
        const clampedSize = clampSmartParticleSetSize(size);
        if (!seen.has(clampedSize)) {
            seen.add(clampedSize);
            values.push(clampedSize);
        }
    }

    return values.sort((a, b) => a - b);
}

function getCoarseSmartChunkingCandidates() {
    const maxSize = getSmartParticleSetMax();
    const candidateCount = 12;
    const sizes = [settings.particleSetSize, minSmartParticleSetSize, maxSize];

    if (maxSize <= minSmartParticleSetSize) {
        return uniqueSmartParticleSetSizes(sizes);
    }

    const ratio = maxSize / minSmartParticleSetSize;
    for (let i = 0; i < candidateCount; i++) {
        const t = i / (candidateCount - 1);
        sizes.push(minSmartParticleSetSize * ratio ** t);
    }

    return uniqueSmartParticleSetSizes(sizes);
}

function getRefinedSmartChunkingCandidates() {
    const maxSize = getSmartParticleSetMax();
    const windowSize = Math.max(
        1,
        Math.round(smartChunking.bestSize / 2 ** smartChunking.searchRound),
    );
    const halfWindow = Math.max(1, Math.round(windowSize / 2));

    return uniqueSmartParticleSetSizes([
        smartChunking.bestSize - windowSize,
        smartChunking.bestSize - halfWindow,
        smartChunking.bestSize,
        smartChunking.bestSize + halfWindow,
        smartChunking.bestSize + windowSize,
        minSmartParticleSetSize,
        maxSize,
    ]);
}

function startSmartChunkingCandidates(candidates, phase) {
    smartChunking.candidates = candidates;
    smartChunking.candidateIndex = 0;
    smartChunking.phase = phase;
    smartChunking.sampleCount = 0;
    smartChunking.sampleTotal = 0;

    if (smartChunking.candidates.length === 0) {
        settleSmartChunking();
        return;
    }

    smartChunking.lastCandidateSize = smartChunking.candidates[0];
    setParticleSetSize(smartChunking.lastCandidateSize);
}

async function updateChunkingControllers() {
    if (!smartChunkingController) return;

    if (settings.chunkedThreads) {
        smartChunkingController.enable();
    } else {
        settings.smartChunking = false;
        smartChunking.active = false;
        smartChunking.settled = false;
        smartChunking.phase = "idle";
        smartChunkingController.disable();
        smartChunkingController.updateDisplay();
    }
}

function resetSmartChunking() {
    smartChunking.active = settings.chunkedThreads && settings.smartChunking;
    smartChunking.settled = false;
    smartChunking.phase = smartChunking.active ? "coarse" : "idle";
    smartChunking.candidates = [];
    smartChunking.candidateIndex = 0;
    smartChunking.searchRound = 0;
    smartChunking.sampleCount = 0;
    smartChunking.sampleTotal = 0;
    smartChunking.bestFps = 0;
    smartChunking.bestSize = smartChunking.active
        ? clampSmartParticleSetSize(settings.particleSetSize)
        : clampParticleSetSize(settings.particleSetSize);
    smartChunking.lastCandidateSize = smartChunking.bestSize;
    setParticleSetSize(smartChunking.bestSize);

    if (smartChunking.active) {
        startSmartChunkingCandidates(getCoarseSmartChunkingCandidates(), "coarse");
    }
}

function sampleSmartChunking(fps) {
    if (
        !settings.chunkedThreads ||
        !settings.smartChunking ||
        !smartChunking.active ||
        smartChunking.settled ||
        !Number.isFinite(fps) ||
        fps <= 0
    ) {
        return null;
    }

    smartChunking.sampleCount += 1;
    smartChunking.sampleTotal += fps;

    if (smartChunking.sampleCount < smartChunking.framesPerSample) return null;

    const averageFps = smartChunking.sampleTotal / smartChunking.sampleCount;
    smartChunking.sampleCount = 0;
    smartChunking.sampleTotal = 0;

    return averageFps;
}

function smartChunkingImproved(fps) {
    return fps > smartChunking.bestFps * (1 + smartChunking.improvementRatio);
}

function settleSmartChunking() {
    smartChunking.active = false;
    smartChunking.settled = true;
    smartChunking.phase = "settled";
    setParticleSetSize(smartChunking.bestSize);
}

function updateSmartChunking(fps) {
    const averageFps = sampleSmartChunking(fps);
    if (averageFps === null) return;

    if (smartChunkingImproved(averageFps)) {
        smartChunking.bestFps = averageFps;
        smartChunking.bestSize = smartChunking.lastCandidateSize;
    }

    smartChunking.candidateIndex += 1;
    if (smartChunking.candidateIndex < smartChunking.candidates.length) {
        smartChunking.lastCandidateSize =
            smartChunking.candidates[smartChunking.candidateIndex];
        setParticleSetSize(smartChunking.lastCandidateSize);
        return;
    }

    smartChunking.searchRound += 1;
    if (smartChunking.searchRound >= smartChunking.maxSearchRounds) {
        settleSmartChunking();
        return;
    }

    startSmartChunkingCandidates(
        getRefinedSmartChunkingCandidates(),
        "refine",
    );
}

// Build GUI
const setupGUI = () => {
    settings.gui = new lil.GUI();
    // Configs
    const configFolder = settings.gui.addFolder("Config");
    configFolder.add(settings, "reset").name("Reset");
    configFolder.add(settings, "randomRules").name("Random Rules");
    configFolder.add(settings, "symmetricRules").name("Symmetric Rules");
    configFolder
        .add(settings, "numColors", 1, 19, 1)
        .name("Number of Colors")
        .listen()
        .onFinishChange((v) => {
            setNumberOfColors();
            startRandom();
            resetSmartChunking();
        });
    configFolder
        .add(settings, "seed")
        .name("Seed")
        .listen()
        .onFinishChange((v) => {
            startRandom();
        });
    configFolder.add(settings, "fps").name("FPS - (Server)").listen().disable();
    configFolder.add(settings, "atomCount").name("Atom Count").listen().disable()
    configFolder
        .add(settings.atoms, "count", 1, 3000, 1)
        .name("Atoms per-color")
        .listen()
        .onFinishChange((v) => {
            randomAtoms(v, true);
            resetSmartChunking();
        });
    configFolder
        .add(settings, "time_scale", 0.1, 5, 0.01)
        .name("Time Scale")
        .listen();
    configFolder
        .add(settings, "viscosity", 0.1, 2, 0.1)
        .name("Viscosity")
        .listen();

    configFolder.add(settings, "gravity", 0, 1, 0.05).name("Gravity").listen();
    configFolder
        .add(settings, "explorePeriod", 1, 500, 1)
        .name("Mutation Frequency")
        .listen();
    configFolder
        .add(settings, "pulseDuration", 1, 100, 1)
        .name("Click Pulse Duration")
        .listen();

    configFolder
        .add(settings, "wallRepel", 0, 100, 1)
        .name("Wall Repel")
        .listen();
    configFolder.add(settings, "explore").name("Random Mutations").listen();
    configFolder
        .add(settings, "chunkedThreads")
        .name("Fine Threading")
        .listen()
        .onFinishChange(() => {
            updateChunkingControllers();
            resetSmartChunking();
            invalidateServerStep();
        });
    smartChunkingController = configFolder
        .add(settings, "smartChunking")
        .name("Smart Parallelism")
        .listen()
        .onFinishChange(() => {
            resetSmartChunking();
            invalidateServerStep();
        });
    particleSetSizeController = configFolder
        .add(settings, "particleSetSize", 20, 4000, 5)
        .name("Particles per Thread")
        .listen()
        .onFinishChange((v) => {
            setParticleSetSize(v);
        });
    updateChunkingControllers();
    // Drawings
    const drawingsFolder = settings.gui.addFolder("Drawings");
    drawingsFolder
        .add(settings.atoms, "radius", 1, 10, 0.5)
        .name("Radius")
        .listen();
    drawingsFolder.add(settings.drawings, "circle").name("Circle Shape").listen();
    drawingsFolder
        .add(settings.drawings, "clusters")
        .name("Track Clusters")
        .listen();
    drawingsFolder.add(settings.drawings, "lines").name("Draw Lines").listen();
    drawingsFolder
        .addColor(settings.drawings, "background_color")
        .name("Background Color")
        .listen();
    // Export
    const exportFolder = settings.gui.addFolder("Export");
    exportFolder.add(settings.export, "image").name("Image");
    exportFolder.add(settings.export, "video").name("Video: Start / stop");
    // Colors
    for (const atomColor of settings.colors) {
        const colorFolder = settings.gui.addFolder(
            `Rules: <font color='${atomColor}'>${atomColor.capitalise()}</font>`,
        );
        for (const ruleColor of settings.colors) {
            colorFolder
                .add(settings.rules[atomColor], ruleColor, -1, 1, 0.001)
                .name(`<-> <font color='${ruleColor}'>${ruleColor.capitalise()}</font>`)
                .listen()
                .onFinishChange((v) => {
                    flattenRules();
                });
        }
        colorFolder
            .add(settings.radii, atomColor, 1, maxRadius, 5)
            .name("Radius")
            .listen()
            .onFinishChange((v) => {
                flattenRules();
            });
    }
};

// Seedable 'decent' random generator
var local_seed = settings.seed;

function mulberry32() {
    let t = (local_seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function loadSeedFromUrl() {
    let hash = window.location.hash;
    if (hash != undefined && hash[0] == "#") {
        let param = Number(hash.substr(1)); // remove the leading '#'
        if (isFinite(param)) {
            settings.seed = param;
            console.log("Using seed " + settings.seed);
        }
    }
}

function randomRules() {
    if (!isFinite(settings.seed)) settings.seed = 0xcafecafe;
    window.location.hash = "#" + settings.seed;
    document.title = "Life #" + settings.seed;
    local_seed = settings.seed;
    console.log("Seed=" + local_seed);
    for (const i of settings.colors) {
        settings.rules[i] = {};
        for (const j of settings.colors) {
            settings.rules[i][j] = mulberry32() * 2 - 1;
        }
        settings.radii[i] = 80;
    }
    console.log(JSON.stringify(settings.rules));
    flattenRules();
}

function symmetricRules() {
    for (const i of settings.colors) {
        for (const j of settings.colors) {
            if (j < i) {
                let v = 0.5 * (settings.rules[i][j] + settings.rules[j][i]);
                settings.rules[i][j] = settings.rules[j][i] = v;
            }
        }
    }
    console.log(JSON.stringify(settings.rules));
    flattenRules();
}

function flattenRules() {
    settings.rulesArray = [];
    settings.radii2Array = [];
    for (const c1 of settings.colors) {
        for (const c2 of settings.colors) {
            settings.rulesArray.push(settings.rules[c1][c2]);
        }
        settings.radii2Array.push(settings.radii[c1] * settings.radii[c1]);
    }
    invalidateServerStep();
}

function updateCanvasDimensions() {
    canvas.width = window.innerWidth * 0.9;
    canvas.height = window.innerHeight * 0.9;
}

// Initiate Random locations for Atoms ( used when atoms created )
function randomX() {
    return mulberry32() * (canvas.width - 100) + 50;
}

function randomY() {
    return mulberry32() * (canvas.height - 100) + 50;
}

/* Create an Atom - Use matrices for x4/5 performance improvement
atom[0] = x
atom[1] = y
atom[2] = ax
atom[3] = ay
atom[4] = color (index)
*/
const create = (number, color) => {
    for (let i = 0; i < number; i++) {
        atoms.push([randomX(), randomY(), 0, 0, color]);
    }
};

function randomAtoms(number_of_atoms_per_color, clear_previous) {
    if (clear_previous) atoms.length = 0;
    for (let c = 0; c < settings.colors.length; c++) {
        create(number_of_atoms_per_color, c);
    }
    clusters.length = 0;
    invalidateServerStep();
}

function startRandom() {
    randomRules();
    randomAtoms(settings.atoms.count, true);
    updateGUIDisplay();
}

function setNumberOfColors() {
    settings.colors = [];
    for (let i = 0; i < settings.numColors; ++i) {
        settings.colors.push(predefinedColors[i]);
    }
}

// Run Application
loadSeedFromUrl();

// Canvas
const canvas = document.getElementById("canvas");
const m = canvas.getContext("2d");

let serverStepInFlight = false;
let serverStepFailed = false;
let lineWarningShown = false;
let simulationVersion = 0;

function invalidateServerStep() {
    simulationVersion += 1;
    serverStepFailed = false;
}

function syncServerAtoms(nextAtoms) {
    atoms.length = nextAtoms.length;
    for (let i = 0; i < nextAtoms.length; i++) {
        atoms[i] = nextAtoms[i];
    }
}

function applyRulesOnServer() {
    if (serverStepInFlight || serverStepFailed) return;

    const requestVersion = simulationVersion;
    serverStepInFlight = true;
    fetch("/api/apply-rules", {
        method: "POST",
        headers: {"Content-Type": "application/json", "Connection": "keep-alive",},
        body: JSON.stringify({
            atoms,
            rulesArray: settings.rulesArray,
            radii2Array: settings.radii2Array,
            numColors: settings.numColors,
            pulse,
            pulseX: pulse_x,
            pulseY: pulse_y,
            timeScale: settings.time_scale,
            wallRepel: settings.wallRepel,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            gravity: settings.gravity,
            viscosity: settings.viscosity,
            chunkedThreads: settings.chunkedThreads,
            particleSetSize: settings.particleSetSize,
        }),
    })
        .then((response) => {
            if (!response.ok)
                throw new Error(`Server applyRules failed: ${response.status}`);
            return response.json();
        })
        .then((result) => {
            if (requestVersion !== simulationVersion) return;
            total_v = result.totalV;
            if (Number.isFinite(result.fps)) settings.fps = result.fps;
            settings.atomCount = result.atoms.length;
            syncServerAtoms(result.atoms);
            updateSmartChunking(result.fps);
        })
        .catch((error) => {
            serverStepFailed = true;
            console.warn("Server applyRules unavailable; simulation paused.", error);
        })
        .finally(() => {
            serverStepInFlight = false;
        });
}

// Draw a square
const drawSquare = (x, y, color, radius) => {
    m.fillStyle = color;
    m.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
};

// Draw a circle
function drawCircle(x, y, color, radius, fill = true) {
    m.beginPath();
    m.arc(x, y, radius, 0 * Math.PI, 2 * Math.PI); // x, y, radius, ArcStart, ArcEnd
    m.closePath();
    m.strokeStyle = m.fillStyle = color;
    fill ? m.fill() : m.stroke();
}

// Draw a line between two atoms
function drawLineBetweenAtoms(ax, ay, bx, by, color) {
    m.beginPath();
    m.moveTo(ax, ay);
    m.lineTo(bx, by);
    m.closePath();
    m.strokeStyle = color;
    m.stroke();
}

// [position-x, position-y, radius, color]
//    /* tmp accumulators: */
//  {count, accum-x, accum-y, accum-d^2, accum-color}]
let clusters = [];

function newCluster() {
    return [randomX(), randomY(), maxRadius, "white"];
}

function addNewClusters(num_clusters) {
    if (clusters.length < num_clusters / 2) {
        while (clusters.length < num_clusters) clusters.push(newCluster());
    }
}

function findNearestCluster(x, y) {
    let best = -1;
    let best_d2 = 1e38;
    for (let i = 0; i < clusters.length; ++i) {
        const c = clusters[i];
        const dx = c[0] - x;
        const dy = c[1] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best_d2) {
            best = i;
            best_d2 = d2;
        }
    }
    return [best, best_d2];
}

function moveClusters(accums) {
    let max_d = 0; // record max cluster displacement
    for (let i = 0; i < clusters.length; ++i) {
        let c = clusters[i];
        const a = accums[i];
        if (a[0] > minClusterSize) {
            const norm = 1 / a[0];
            const new_x = a[1] * norm;
            const new_y = a[2] * norm;
            max_d = Math.max(max_d, Math.abs(c[0] - new_x), Math.abs(c[1] - new_y));
            c[0] = new_x;
            c[1] = new_y;
        }
    }
    return max_d;
}

function finalizeClusters(accums) {
    for (let i = 0; i < clusters.length; ++i) {
        let c = clusters[i];
        const a = accums[i];
        if (a[0] > minClusterSize) {
            const norm = 1 / a[0];
            const new_r = 1.1 * Math.sqrt(a[3] * norm); // with 10% extra room
            c[2] = 0.95 * c[2] + 0.05 * new_r; // exponential smoothing
            // 'average' color
            c[3] = settings.colors[Math.floor(a[4] * norm + 0.5)];
        } else {
            c[2] = 0; // disable the weak cluster
        }
    }
    // note: if half of the particles are not within the average
    // radius of the cluster, we should probably split it in two
    // along the main axis!
}

function trackClusters() {
    addNewClusters(maxClusters);
    let accums = [];
    for (const c of clusters) accums.push([0, 0, 0, 0, 0]);
    const maxKMeanPasses = 10;
    for (let pass = maxKMeanPasses; pass >= 0; --pass) {
        for (let a of accums) a = [0, 0, 0, 0, 0];
        for (const c of atoms) {
            const [best, best_d2] = findNearestCluster(c[0], c[1]);
            if (best >= 0 && best_d2 < maxRadius * maxRadius) {
                accums[best][0] += 1;
                accums[best][1] += c[0];
                accums[best][2] += c[1];
                accums[best][3] += best_d2;
                accums[best][4] += c[4];
            }
        }
        const max_d = moveClusters(accums);
        if (max_d < 1) break;
    }
    finalizeClusters(accums);
}

function drawClusters() {
    let i = 0;
    while (i < clusters.length) {
        let c = clusters[i];
        if (c[2] > 0) {
            drawCircle(c[0], c[1], c[3], c[2], false);
            ++i;
        } else {
            // remove cluster by swapping with last
            const last = clusters.pop();
            if (i < clusters.length) clusters[i] = last;
        }
    }
}

// Canvas Dimensions
updateCanvasDimensions();

// Params for click-based pulse event
var pulse = 0;
var pulse_x = 0,
    pulse_y = 0;

var exploration_timer = 0;

function exploreParameters() {
    if (exploration_timer <= 0) {
        let c1 = settings.colors[Math.floor(mulberry32() * settings.numColors)];
        if (mulberry32() >= 0.2) {
            // 80% of the time, we change the strength
            let c2 = settings.colors[Math.floor(mulberry32() * settings.numColors)];
            let new_strength = mulberry32();
            // for better results, we force opposite-signed values
            if (settings.rules[c1][c2] > 0) new_strength = -new_strength;
            settings.rules[c1][c2] = new_strength;
        } else {
            // ...otherwise, the radius
            settings.radii[c1] = 1 + Math.floor(mulberry32() * maxRadius);
        }
        flattenRules();
        exploration_timer = settings.explorePeriod;
    }
    exploration_timer -= 1;
}

var total_v = 0; // global velocity as a estimate of on-screen activity

// Apply Rules ( How atoms interact with each other )
const applyRules = () => {
    if (settings.drawings.lines && !lineWarningShown) {
        console.warn("Draw Lines is disabled while applyRules runs on the server.");
        lineWarningShown = true;
    }

    applyRulesOnServer();
};

// Generate Rules
setNumberOfColors();
randomRules();

// Generate Atoms
const atoms = [];
randomAtoms(settings.atoms.count, true);

setupClicks();
setupKeys();
setupGUI();

console.log("settings", settings);

update();

function update() {
    // Update Canvas Dimensions - if screen size changed
    updateCanvasDimensions();
    // Background color
    m.fillStyle = settings.drawings.background_color;
    m.fillRect(0, 0, canvas.width, canvas.height);
    // Appy Rules
    applyRules();
    // Draw Atoms
    for (const a of atoms) {
        if (settings.drawings.circle) {
            drawCircle(a[0], a[1], settings.colors[a[4]], settings.atoms.radius);
        } else {
            drawSquare(a[0], a[1], settings.colors[a[4]], settings.atoms.radius);
        }
    }
    if (settings.drawings.clusters) {
        trackClusters();
        drawClusters();
    }

    updateParams();

    // const inRange = (a) => 0 <= a[0] && a[0] < canvas.width && 0 <= a[1] && a[1] < canvas.height
    // console.log('inRange', atoms.filter(inRange).length)

    requestAnimationFrame(update);
}

// post-frame stats and updates
function updateParams() {
    // adapt time_scale based on activity
    if (total_v > 30 && settings.time_scale > 5) settings.time_scale /= 1.1;
    if (settings.time_scale < 0.9) settings.time_scale *= 1.01;
    if (settings.time_scale > 1.1) settings.time_scale /= 1.01;

    if (pulse != 0) pulse -= pulse > 0 ? 1 : -1;
    if (settings.explore) exploreParameters();
}

// Download DataURL
function dataURL_downloader(dataURL, name = `particle_life_${settings.seed}`) {
    const hyperlink = document.createElement("a");
    // document.body.appendChild(hyperlink);
    hyperlink.download = name;
    hyperlink.target = "_blank";
    hyperlink.href = dataURL;
    hyperlink.click();
    hyperlink.remove();
}

// Recorde a video ----------------------------------
// Stream
const videoStream = canvas.captureStream();
// Video Recorder
const mediaRecorder = new MediaRecorder(videoStream);
// temp chunks
let chunks = [];
// Store chanks
mediaRecorder.ondataavailable = function (e) {
    chunks.push(e.data);
};
// Download video after recording is stopped
mediaRecorder.onstop = function (e) {
    // Chunks ---> Blob
    const blob = new Blob(chunks, {type: "video/mp4"});
    // Blob -----> DataURL
    const videoDataURL = URL.createObjectURL(blob);

    // Download video
    dataURL_downloader(videoDataURL);

    // Reset Chunks
    chunks = [];
};

// mediaRecorder.start(); // Start recording
// mediaRecorder.stop(); // Stop recording
// --------------------------------------------------
