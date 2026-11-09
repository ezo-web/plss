const proc = Bun.spawn(["bun", "server.js"], {
    stdout: "inherit",
    stderr: "inherit",
});

console.log("Worker PID:", proc.pid);