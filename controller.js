import {$} from "bun";
import {dirname} from "node:path";
import readline from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import os from "os";
import * as http from "node:http";

process.on("SIGINT", () => {
    console.log("[SIGINT | SHUTTING DOWN GRACEFULLY]")
    process.exit(0);
});
process.on("SIGTERM", () => {
    console.log("[SIGINT | SHUTTING DOWN GRACEFULLY]")
    process.exit(0);
});

const {spawnSync} = require('child_process');
const prompt = require('prompt-sync')();

const rl = readline.createInterface({input, output});

const cpuDetails = os.cpus();
const deviceCores = cpuDetails.length;
const cpuModel = cpuDetails[0].model;
const availableParallelism = os.availableParallelism()
const cpuMHz = cpuDetails[0].speed
var error
var errorMessage = ""

if (deviceCores < 8) {
    error = true
    errorMessage += `${os.EOL}| [ERROR 101] | NOT ENOUGH CPU CORES | MIN: 8 | DEVICE: ${deviceCores} | PLSS will not run on your CPU |`
}
if (availableParallelism < 4) {
    error = true
    errorMessage += `${os.EOL}| [ERROR 102] | NOT ENOUGH AVAILABLE THREADS | MIN: 4 | DEVICE: ${availableParallelism} | Close CPU heavy apps and try again |`
}

function isBunInstalled() {
    // Check for the 'bun' executable directly
    const result = spawnSync('bun', ['--version'], {shell: false});

    // If result.error exists, the command could not be found or executed
    return !result.error;
}

if (isBunInstalled()) {
    console.log(`Using Bun v${process.versions.bun}`);
} else {
    console.log("Bun is not installed! Visit https://bun.com to install the latest version.");
}

const fileDir = import.meta.dir;
const exeDir = dirname(process.execPath);
console.log(fileDir + exeDir); // e.g., "/Users/username/my-project/src"
async function startServer(command1ToRun = `cd '${exeDir}/' && CTRLR=${process.pid} bun start`) {
    const os = process.platform;

    try {
        if (os === "win32") {
            // Windows: Opens a new Command Prompt window
            // /K ensures the window stays open after executing
            await $`start cmd.exe /K ${command1ToRun}`;
        } else if (os === "darwin") {
            // macOS: Uses AppleScript to open Terminal app and run a command
            const appleScript = command1ToRun ? `tell application "Terminal" to do script "${command1ToRun}" activate` : `tell application "Terminal" to do script "" activate`;

            await $`osascript -e ${appleScript}`;
        } else if (os === "linux") {
            // Linux: Attempts common terminal emulators (GNOME Terminal or xterm)
            if (commandToRun) {
                await $`gnome-terminal -- bash -c "${command1ToRun}; exec bash"`.quiet()
                    .catch(() => $`xterm -e "bash -c '${command1ToRun}; exec bash'"`);
            } else {
                await $`gnome-terminal`.quiet()
                    .catch(() => $`xterm`);
            }
        } else {
            console.error(`Unsupported operating system: ${os}`);
        }
    } catch (error) {
        console.error("Failed to open terminal window:", error);
    }
}

async function exitController(command2ToRun = `exit`) {
    const os = process.platform;

    try {
        if (os === "win32") {
            // Windows: Opens a new Command Prompt window
            // /K ensures the window stays open after executing
            await $`start cmd.exe /K ${command2ToRun}`;
        } else if (os === "darwin") {
            // macOS: Uses AppleScript to open Terminal app and run a command
            const appleScript = command2ToRun ? `tell application "Terminal" to do script "${command2ToRun}" activate` : `tell application "Terminal" to do script "" activate`;

            await $`osascript -e ${appleScript}`;
        } else if (os === "linux") {
            // Linux: Attempts common terminal emulators (GNOME Terminal or xterm)
            if (commandToRun) {
                await $`gnome-terminal -- bash -c "${command2ToRun}; exec bash"`.quiet()
                    .catch(() => $`xterm -e "bash -c '${command2ToRun}; exec bash'"`);
            } else {
                await $`gnome-terminal`.quiet()
                    .catch(() => $`xterm`);
            }
        } else {
            console.error(`Unsupported operating system: ${os}`);
        }
    } catch (error) {
        console.error("Failed to open terminal window:", error);
    }
}

// Example 1: Open a blank terminal window
function startup() {
    var status = "OFFLINE"
    console.clear()
    console.log("Starting controller.")
    console.log(process.pid)
    setTimeout(() => {
        console.clear()
        console.log("Starting controller..")
        console.log(process.pid)
        setTimeout(() => {
            console.clear()
            console.log("Starting controller...")
            console.log(process.pid)
            setTimeout(() => {
                console.clear();
                console.log(`PLSS System Controller${os.EOL}----------------------`)
                console.log(`[VERIFYING DEVICE HARDWARE]`)
                console.log(process.pid)
                setTimeout(async () => {
                    console.clear()
                    console.log(`PLSS System Controller${os.EOL}----------------------`)
                    if (error) {
                        console.log(`Errors prevented PLSS from starting.${await errorMessage}`)
                    }
                    if (!error) {
                        console.clear()
                        console.log(`PLSS System Controller${os.EOL}----------------------`)
                        console.log(`| Processor: ${cpuModel} | CPU Cores: ${deviceCores} | CPU Clock Speed: ${cpuMHz} | Available Parallelism: ${availableParallelism} |\n\n${os.EOL}PLSS is ready. Run "/help" to list available commands.`)
                        var direction
                        while (direction !== "/exit") {
                            console.clear()
                            console.log(`PLSS System Controller${os.EOL}----------------------`)
                            console.log(`| Processor: ${cpuModel} | CPU Cores: ${deviceCores} | CPU Clock Speed: ${cpuMHz} | Available Parallelism: ${availableParallelism} |${os.EOL}${os.EOL}[PLSS ${status}]${os.EOL}${os.EOL}PLSS is ready. Run "/help" to list available commands.`)
                            direction = prompt(``)
                            if (direction === "/exit") {
                                console.log("Exiting...")
                                setTimeout(() => {
                                    console.clear();
                                    console.log(`PLSS System Controller${os.EOL}----------------------`)
                                    console.log(`[CTRL => PLSS | SHUTTING DOWN GRACEFULLY]`)
                                    stopServer();
                                    setTimeout(() => {
                                        console.clear();
                                        console.log(`PLSS System Controller${os.EOL}----------------------`)
                                        console.log(`[CTRL => CTRL | SHUTTING DOWN GRACEFULLY]`)
                                        setTimeout(() => {
                                            console.clear();
                                            process.exit(0);
                                            exitController()
                                        }, 500)
                                    }, 500)
                                }, 500)
                            } else {
                                if (direction === "/start" || direction === "/shutdown" || direction === "/help") {
                                    if (direction === "/start") {
                                        console.clear();
                                        console.log(`PLSS System Controller${os.EOL}----------------------`)
                                        console.log(`[CTRL => PLSS | STARTING UP]`)
                                        await startServer()
                                        status = "ONLINE"
                                        setTimeout(() => {
                                            console.clear();
                                            console.log(`PLSS System Controller${os.EOL}----------------------`)
                                            console.log(`[CTRL => PLSS | PLSS ONLINE]`)
                                            setTimeout(() => {
                                                console.clear()
                                                console.log(`PLSS System Controller${os.EOL}----------------------`)
                                                console.log(`| Processor: ${cpuModel} | CPU Cores: ${deviceCores} | CPU Clock Speed: ${cpuMHz} | Available Parallelism: ${availableParallelism} |${os.EOL}${os.EOL}[PLSS ${status}]${os.EOL}${os.EOL}PLSS is ready. Run "/help" to list available commands.`)
                                            }, 500)
                                        }, 500)
                                    }
                                    if (direction === "/shutdown") {
                                        console.clear();
                                        console.log(`PLSS System Controller${os.EOL}----------------------`)
                                        console.log(`[CTRL => PLSS | SHUTTING DOWN GRACEFULLY]`)
                                        await stopServer()
                                        status = "OFFLINE"
                                        setTimeout(() => {
                                            console.clear();
                                            console.log(`PLSS System Controller${os.EOL}----------------------`)
                                            console.log(`[CTRL => PLSS | PLSS OFFLINE]`)
                                            setTimeout(() => {
                                                console.clear()
                                                console.log(`PLSS System Controller${os.EOL}----------------------`)
                                                console.log(`| Processor: ${cpuModel} | CPU Cores: ${deviceCores} | CPU Clock Speed: ${cpuMHz} | Available Parallelism: ${availableParallelism} |${os.EOL}${os.EOL}[PLSS ${status}]${os.EOL}${os.EOL}PLSS is ready. Run "/help" to list available commands.`)
                                            }, 500)
                                        }, 500)
                                    }
                                    if (direction === "/help") {
                                        console.log(`${os.EOL}${os.EOL}/start      | Runs the PLSS server${os.EOL}/shutdown   | Terminates the PLSS server${os.EOL}/exit       | Terminates the PLSS server and this controller${os.EOL}${os.EOL}${os.EOL}Enter anything to close and return to command line.${os.EOL}`)
                                        prompt(``)
                                    }
                                } else {
                                    console.clear()
                                    await setTimeout(() => {
                                        console.log()
                                        console.log(`${os.EOL}Unrecognized command, run "/help" to find commands`)
                                    }, 2000)
                                }
                            }
                        }
                        /* if (direction === "/exit") {
                            console.log("Exiting...")
                            setTimeout(() => {
                                console.clear();
                                console.log(`PLSS System Controller${os.EOL}----------------------`)
                                console.log(`[VERIFYING DEVICE HARDWARE]`)
                                process.exit(0);
                            }, 500)
                        }*/
                    }
                }, 1500);
            }, 1000)
        }, 500);
    }, 500)
}

startup()
// Example 2: Open a terminal window and execute a command immediately
// openTerminalWindow("echo 'Hello from Bun!' && bun -v");

async function stopServer() {
    const findPort = Bun.spawnSync(["lsof", "-t", "-i:8001"]);
    const pid = parseInt(findPort.stdout.toString().trim(), 10);

    if (!isNaN(pid)) {
        process.kill(pid, "SIGTERM");
    }
}

async function startCtrlServer() {
    const server = http.createServer((req, res) => {
        // 1. Initialize an array to store incoming chunks
        let chunks = [];

        // 2. Listen for 'data' events to collect chunks as they arrive
        req.on('data', (chunk) => {
            chunks.push(chunk);
        });

        // 3. Listen for the 'end' event when the full body has arrived
        req.on('end', () => {
            // Combine chunks into a single Buffer and convert it to a string
            const rawBody = Buffer.concat(chunks).toString();

            // 4. (Optional) Parse the body based on Content-Type
            let parsedBody = rawBody;
            if (req.headers['content-type'] === 'application/json' && rawBody) {
                try {
                    parsedBody = JSON.parse(rawBody);
                } catch (err) {
                    res.statusCode = 400;
                    return res.end('Invalid JSON syntax');
                }
            }

            console.log('Received Body:', parsedBody);

            // Send a response back to the client
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Data received successfully', data: parsedBody }));
        });

        // Handle errors on the request stream
        req.on('error', (err) => {
            console.error(err);
            res.statusCode = 400;
            res.end('Bad Request');
        });
    });
    server.listen(8002, () => console.log('Server running on port 8002'));
}

setInterval(async () => {
}, 5000);