#!/usr/bin/env node
// Starts the dashboard (and its ngrok tunnel) in the background every time you
// sign in to Windows, with no window. Output goes to data/dashboard.log.
//   npm run autostart            turn it on and start it now
//   npm run autostart -- --off   turn it off and stop it
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const STARTUP_DIR = path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
const STARTUP_FILE = path.join(STARTUP_DIR, "LeetCode Daily Lock dashboard.vbs");
const PID_FILE = path.join(__dirname, "data", "dashboard.pid");

// The hidden launcher: runs `node start.js --log` from this folder.
function launcherScript(nodePath = process.execPath, startJs = path.join(__dirname, "start.js")) {
  const q = (p) => `""${p}""`;
  return `Set sh = CreateObject("WScript.Shell")\r\nsh.CurrentDirectory = "${path.win32.dirname(startJs)}"\r\nsh.Run "${q(nodePath)} ${q(startJs)} --log", 0, False\r\n`;
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
  if (process.argv.includes("--off")) {
    fs.rmSync(STARTUP_FILE, { force: true });
    stopRunning();
    console.log("The dashboard won't start with Windows anymore.");
    return;
  }
  if (!fs.existsSync(path.join(__dirname, ".env"))) {
    console.error("Make .env first (copy .env.example and fill in NGROK_AUTHTOKEN and NGROK_DOMAIN).");
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(STARTUP_DIR, { recursive: true });
  fs.writeFileSync(STARTUP_FILE, launcherScript());
  stopRunning();
  spawnSync("wscript.exe", [STARTUP_FILE], { stdio: "ignore" });
  console.log("Done. The dashboard is starting in the background now and will start each time you sign in to Windows.");
  console.log(`Log: ${path.join(__dirname, "data", "dashboard.log")}`);
  console.log("Turn it off with: npm run autostart -- --off");
}

if (require.main === module) main();
module.exports = { launcherScript, STARTUP_FILE };
