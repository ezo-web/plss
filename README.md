# PLSS
**Performant Life Simulation System**

PLSS is an extremely fast fork of *partice-life* by hunar4321 on GitHub, using WASM and multithreading to achieve up to 
27x higher FPS compared to the original. PLSS also allows you to run the system's CPU heavy particle updates in the 
cloud if needed, enabling its use on lower-end devices, like the ones used in education.

[Click here]() to open the installation instructions.

## Improvements 

porf wasm life2d-wasm-optimized-candidate.ts candidate.wasm --module

In order to achieve up to a 27x improvement in FPS compared to *particle-life*, PLSS updates particle positions 
multithreaded-ly using workers dispatched by the server, which additionally utilize WASM to further speed up the 
particle updates. PLSS also allows you to manually define how many particles should be processed on their own thread 
(p/t) by using *Fine Threading* mode. You can also have it automatically test and evaluate different p/t values to 
find the value that nets you the highest FPS by enabling Smart Parallelism.

Please note that "FPS" in this case doesn't mean the actual number of frames being rendered on your screen per 
second, it just means how many frames the system can process per second, regardless of how many are being rendered.

### Comparison
Tested on an M4 MacBook Air, compared against the original *particle-life* by hunar4321. Due to a lack of 
benchmarking software, these averages were estimated manually and may be a little off.

| System                               | Avg. FPS | Compared to particle-life |
|--------------------------------------|----------|---------------------------|
| hunar4321/particle-life              | ~24      | -                         |
| PLSS                                 | ~400     | Up to 16x faster          |
| PLSS with Fine Threading (50p/t)     | ~500     | Up to 20x faster          |
| PLSS with Smart Parallelism (113p/t) | ~650     | Up to 27x faster          |