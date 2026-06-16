# PLSS
**Performant Life Simulator System**

PLSS is an extremely fast fork of partice-life by hunar4321, using WASM and multithreading to achieve 15x higher FPS. PLSS also enables particle updates to be processed in the cloud instead of on the device's CPU, allowing it to run on lower end systems used in education.

## Usage & Installation
Start by cloning this repository.

```
git clone https://github.com/ezo-web/plss.git
```

Open the folder in your IDE's integrated terminal and start PLSS by running:

```
npm run start
```

Now you've started PLSS! **Yay**! You can now go to localhost:8000 to use it.

## Performance Optomizations & Config
PLSS is functionally the same as the original hunar4321/particle-life, no changes were made to how the particles behave in practice. However, **many** changes were made to the way the system updates each particle. The server processes the CPU intensive particle updates using WASM while employing multithreading to achieve much higher speeds, then sends them to the client to display. When running the client and server locally (tested on a M3 Macbook Air), PLSS can reach 400 to 500 FPS using *Chunking*, between 15 and 20 times faster than the same simulation using particle-life.

Now what is Chunking? **Chunked Threads** is a mode you can find in the PLSS config controls. When Chunked Threads is on, the server updates particles in groups ("Chunks"), with each group of particles processed on it's own thread. The number of particles in each Chunk can be set manually or you can do it automatically. To manually define the number of particles per Chunk, you can use the "Particles per Thread" slider in the config controls (depending on the number of particles in your simulation, you may want to adjust this value). If you don't want to do this manually, you can enable "Smart Chunking" mode, which will automatically test many "Particle per Thread" values to find the value at which the simulation runs with the highest FPS (this can take around 10 seconds and may cycle through Particle per Thread values a couple times). Smart Chunking will run a re-evaluation whenever the number of colors or atoms per color values are changed to always get you the highest FPS possible (you may see a lag spike when an evaluation is running, this is normal).


### Comparison
Tested on an M3 Macbook Air.
| System | Avg. FPS | Compared to particle-life |
| -------- | -------- | -------- |
| particle-life   | ~24   | -     |
| PLSS (Without Chunked Threads)   | ~100   | Up to 4x Faster     |
| PLSS (With Chunked Threads)   | ~500   | Up to 20x Faster     |
