export const applyRulesWasm = (
    atomsPtr: i32,
    atomCount: i32,
    rulesPtr: i32,
    radii2Ptr: i32,
    numColors: i32,
    pulse: number,
    pulseX: number,
    pulseY: number,
    timeScale: number,
    wallRepel: number,
    canvasWidth: number,
    canvasHeight: number,
    gravity: number,
    viscosity: number
): number => {
    let totalV: number = 0;

// Invariants used throughout the function.
const vmix: number = 1 - viscosity;
const hasPulse: boolean = pulse != 0;
const hasWallRepel: boolean = wallRepel > 0;
const pulseStrength: number = 100 * pulse;
const wallStrength: number = 0.1;

// First pass: calculate forces and update velocities.
let aPtr: i32 = atomsPtr;
let i: i32 = 0;

while (i < atomCount) {
    const ax: number = Porffor.wasm.f64.load(aPtr, 0, 0);
    const ay: number = Porffor.wasm.f64.load(aPtr, 0, 8);
    const color: i32 = Porffor.wasm.f64.load(aPtr, 0, 32) as i32;

    const ruleRow: i32 = color * numColors;
    const r2: number = Porffor.wasm.f64.load(
        radii2Ptr + color * 8,
        0,
        0
    );

    let fx: number = 0;
    let fy: number = 0;

    // Particle-particle interactions.
    let bPtr: i32 = atomsPtr;
    let j: i32 = 0;

    while (j < atomCount) {
        const bx: number = Porffor.wasm.f64.load(bPtr, 0, 0);
        const by: number = Porffor.wasm.f64.load(bPtr, 0, 8);

        const dx: number = ax - bx;
        const dy: number = ay - by;

        if (dx != 0 || dy != 0) {
            const d: number = dx * dx + dy * dy;

            if (d < r2) {
                const bColor: i32 =
                    Porffor.wasm.f64.load(bPtr, 0, 32) as i32;

                const g: number = Porffor.wasm.f64.load(
                    rulesPtr + (ruleRow + bColor) * 8,
                    0,
                    0
                );

                const f: number = g / Math.sqrt(d);

                fx += f * dx;
                fy += f * dy;
            }
        }

        bPtr += 40;
        j += 1;
    }

    // Pulse force.
    if (hasPulse) {
        const dx: number = ax - pulseX;
        const dy: number = ay - pulseY;
        const d: number = dx * dx + dy * dy;

        if (d > 0) {
            const f: number = pulseStrength / (d * timeScale);
            fx += f * dx;
            fy += f * dy;
        }
    }

    // Wall repulsion.
    if (hasWallRepel) {
        if (ax < wallRepel) {
            fx += (wallRepel - ax) * wallStrength;
        }

        if (ax > canvasWidth - wallRepel) {
            fx += (canvasWidth - wallRepel - ax) * wallStrength;
        }

        if (ay < wallRepel) {
            fy += (wallRepel - ay) * wallStrength;
        }

        if (ay > canvasHeight - wallRepel) {
            fy += (canvasHeight - wallRepel - ay) * wallStrength;
        }
    }

    fy += gravity;

    const vx: number = Porffor.wasm.f64.load(aPtr, 0, 16);
    const vy: number = Porffor.wasm.f64.load(aPtr, 0, 24);

    const nextVx: number = vx * vmix + fx * timeScale;
    const nextVy: number = vy * vmix + fy * timeScale;

    Porffor.wasm.f64.store(aPtr, nextVx, 0, 16);
    Porffor.wasm.f64.store(aPtr, nextVy, 0, 24);

    totalV += Math.abs(nextVx);
    totalV += Math.abs(nextVy);

    aPtr += 40;
    i += 1;
}

// Second pass: integrate positions and handle boundary reflection.
aPtr = atomsPtr;
i = 0;

while (i < atomCount) {
    let x: number =
        Porffor.wasm.f64.load(aPtr, 0, 0) +
        Porffor.wasm.f64.load(aPtr, 0, 16);

    let y: number =
        Porffor.wasm.f64.load(aPtr, 0, 8) +
        Porffor.wasm.f64.load(aPtr, 0, 24);

    let vx: number = Porffor.wasm.f64.load(aPtr, 0, 16);
    let vy: number = Porffor.wasm.f64.load(aPtr, 0, 24);

    if (x < 0) {
        x = -x;
        vx *= -1;
    }

    if (x >= canvasWidth) {
        x = 2 * canvasWidth - x;
        vx *= -1;
    }

    if (y < 0) {
        y = -y;
        vy *= -1;
    }

    if (y >= canvasHeight) {
        y = 2 * canvasHeight - y;
        vy *= -1;
    }

    Porffor.wasm.f64.store(aPtr, x, 0, 0);
    Porffor.wasm.f64.store(aPtr, y, 0, 8);
    Porffor.wasm.f64.store(aPtr, vx, 0, 16);
    Porffor.wasm.f64.store(aPtr, vy, 0, 24);

    aPtr += 40;
    i += 1;
}

return totalV / atomCount;

};
