// Add this at the top of main.js
try {
  require('electron-reloader')(module);
} catch (_) {}

const { app, BrowserWindow } = require('electron');
const { fork } = require('child_process');

let serverProcess;

app.whenReady().then(() => {
  serverProcess = fork('./server.js');

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
  });

  setTimeout(() => {
    win.loadURL('http://localhost:8000');
  }, 2000);
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});