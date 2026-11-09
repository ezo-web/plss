# PLSS
**Performant Life Simulation System**

PLSS is an extremely fast fork of *partice-life* by hunar4321 on GitHub, using WASM, multithreading, and heavy 
optimization to achieve up to 14.2x higher FPS compared to the original. PLSS also allows you to run the system's CPU 
heavy particle updates in the cloud if needed, enabling its use on lower-end devices, like the ones used in education.

[Click here]() to open the installation instructions.

## Improvements

PLSS uses a combination of optimizations to achieve this massive speed boost. The old particle update logic has been 
rewritten and compiled to WASM for near-native speeds, and the 

### Comparison
Tested on a base M4 MacBook Air, compared against the original *particle-life* by hunar4321. Due to a lack of 
benchmarking software, these averages were estimated manually and may be a little off (sorry).

| System                          | Avg. FPS   | Peak FPS | Compared to particle-life |
|---------------------------------|------------|----------|---------------------------|
| hunar4321/particle-life         | ~60        | -        | -                         |
| PLSS                            | ~350 - 400 | -        | Up to 6.6x faster         |
| PLSS with FT (50p/t)            | ~400 - 600 | ~700     | Up to 10x faster          |
| PLSS with FT (46p/t) & TS (10x) | ~550 - 850 | ~1000    | Up to 14.2x faster        |