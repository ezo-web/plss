const { parentPort } = require('node:worker_threads');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const samples = [];
let sampleRound = 0;
let lastCpuUsage = process.cpuUsage();
let lastTime = performance.now();

// lightweight CPU usage calculation
function getProcessCpuUsagePercentage() {
    const currentTime = performance.now();
    const currentCpuUsage = process.cpuUsage(lastCpuUsage);
    const timeDeltaMicroseconds = (currentTime - lastTime) * 1000;
    const totalCpuTimeUsed = currentCpuUsage.user + currentCpuUsage.system;
    const cpuPercentage = (totalCpuTimeUsed / timeDeltaMicroseconds) * 100;
    lastCpuUsage = process.cpuUsage();
    lastTime = currentTime;
    return cpuPercentage;
}

// lightweight sampling
function takeSample(data) {
    try {
        const timestamp = new Date().toISOString();
        const cpuUsage = getProcessCpuUsagePercentage();
        const memory = process.memoryUsage();
        const rss = memory.rss || 0;
        const availableParallelism = typeof os.availableParallelism === 'function'
            ? os.availableParallelism()
            : os.cpus().length;

        const sample = {
            timestamp,
            sampling_round: sampleRound++,
            server_fps: data.serverFps || 0,
            particles_per_thread: data.particlesPerThread || '',
            thread_count: data.threadCount || 0,
            worker_count: data.workerCount || 0,
            cpu_usage_percent: Number(cpuUsage.toFixed(2)),
            available_parallelism: availableParallelism,
            used_memory_bytes: rss,
            num_particles: data.numParticles || 0,
            num_colours: data.numColours || 0,
            particles_per_colour: data.particlesPerColour || 0,
            total_particles: data.totalParticles || 0,
        };

        samples.push(sample);
    } catch (e) {
        console.warn('[Monitor] Sample error:', e.message);
    }
}

function writeCSV(rootDir) {
    try {
        if (!samples.length) return;

        const dir = path.join(rootDir, 'Server Performance Logs');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const filename = `server_performance_${Date.now()}.csv`;
        const filepath = path.join(dir, filename);
        const header = [
            'timestamp',
            'sampling_round',
            'server_fps',
            'particles_per_thread',
            'thread_count',
            'worker_count',
            'cpu_usage_percent',
            'available_parallelism',
            'used_memory_bytes',
            'num_particles',
            'num_colours',
            'particles_per_colour',
            'total_particles',
        ].join(',') + '\n';

        const lines = samples.map(s => [
            s.timestamp,
            s.sampling_round,
            s.server_fps,
            s.particles_per_thread,
            s.thread_count,
            s.worker_count,
            s.cpu_usage_percent,
            s.available_parallelism,
            s.used_memory_bytes,
            s.num_particles,
            s.num_colours,
            s.particles_per_colour,
            s.total_particles,
        ].join(','));

        fs.writeFileSync(filepath, header + lines.join('\n'));
    } catch (e) {
        console.warn('[Monitor] CSV write error:', e.message);
    }
}

parentPort.on('message', (message) => {
    if (message.type === 'sample') {
        takeSample(message.data);
    } else if (message.type === 'shutdown') {
        writeCSV(message.rootDir);
        process.exit(0);
    }
});

parentPort.postMessage({ type: 'ready' });
