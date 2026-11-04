#!/usr/bin/env node
// Starts the dashboard (and its ngrok tunnel) in the background every time you
// sign in to Windows, with no window, plus the tray icon that shows whether
// it's running (tray.ps1). Output goes to data/dashboard.log.
//   npm run autostart            turn it on and start both now
//   npm run autostart -- --off   turn it off and stop the dashboard
//   npm run tray                 just show the tray icon now
"use strict";
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const STARTUP_DIR = path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
const STARTUP_FILE = path.join(STARTUP_DIR, "LeetCode Daily Lock dashboard.vbs");
const TRAY_STARTUP_FILE = path.join(STARTUP_DIR, "LeetCode Daily Lock dashboard tray.vbs");
const PID_FILE = path.join(__dirname, "data", "dashboard.pid");

// The hidden launcher: runs `node start.js --log` from this folder.
function launcherScript(nodePath = process.execPath, startJs = path.join(__dirname, "start.js")) {
  const q = (p) => `""${p}""`;
  return `Set sh = CreateObject("WScript.Shell")\r\nsh.CurrentDirectory = "${path.win32.dirname(startJs)}"\r\nsh.Run "${q(nodePath)} ${q(startJs)} --log", 0, False\r\n`;
}

// The tray launcher: PowerShell with no window running tray.ps1, told where
// node is so its Start button works even if node isn't on PATH at sign-in.
function trayArgs(nodePath = process.execPath, trayPs1 = path.join(__dirname, "tray.ps1")) {
  return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-STA", "-File", trayPs1, "-Node", nodePath];
}
function trayLauncherScript(nodePath = process.execPath, trayPs1 = path.join(__dirname, "tray.ps1")) {
  const args = trayArgs(nodePath, trayPs1).map((a) => (/[\s"]/.test(a) || a === trayPs1 || a === nodePath ? `""${a}""` : a)).join(" ");
  return `Set sh = CreateObject("WScript.Shell")\r\nsh.Run "powershell.exe ${args}", 0, False\r\n`;
}

function startTray() {
  const child = spawn("powershell.exe", trayArgs(), { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", (e) => console.error(`Couldn't start the tray icon: ${e.message}`));
  child.unref();
}

function stopRunning() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8"));
    if (pid) process.kill(pid);
    console.log("Stopped the background dashboard.");
  } catch { /* not running */ }
  fs.rmSync(PID_FILE, { force: true });
}

function main() {
  if (process.platform !== "win32") {
    console.error("This sets up Windows sign-in startup. On other systems, run `npm start` from a login item or service manager.");
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes("--tray")) {
    startTray();
    console.log("The tray icon is starting (look by the clock; it may be under the ^ arrow).");
    return;
  }
  if (process.argv.includes("--off")) {
    fs.rmSync(STARTUP_FILE, { force: true });
    fs.rmSync(TRAY_STARTUP_FILE, { force: true });
    stopRunning();
    console.log("The dashboard and its tray icon won't start with Windows anymore. (Right-click the tray icon > Exit to close it now.)");
    return;
  }
  if (!fs.existsSync(path.join(__dirname, ".env"))) {
    console.error("Make .env first (copy .env.example and fill in NGROK_AUTHTOKEN and NGROK_DOMAIN).");
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(STARTUP_DIR, { recursive: true });
  fs.writeFileSync(STARTUP_FILE, launcherScript());
  fs.writeFileSync(TRAY_STARTUP_FILE, trayLauncherScript());
  stopRunning();
  spawnSync("wscript.exe", [STARTUP_FILE], { stdio: "ignore" });
  spawnSync("wscript.exe", [TRAY_STARTUP_FILE], { stdio: "ignore" });
  console.log("Done. The dashboard is starting in the background now and will start each time you sign in to Windows.");
  console.log("A tray icon by the clock shows whether it's running: green online, yellow this PC only, red stopped. Right-click it to start or stop.");
  console.log(`Log: ${path.join(__dirname, "data", "dashboard.log")}`);
  console.log("Turn it off with: npm run autostart -- --off");
}

if (require.main === module) main();
module.exports = { launcherScript, trayLauncherScript, trayArgs, STARTUP_FILE, TRAY_STARTUP_FILE };
