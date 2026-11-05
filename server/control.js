#!/usr/bin/env node
// Starts and stops the dashboard and its ngrok link in the background, so the
// terminal stays free. Works from the repo root or this folder.
//   npm start               dashboard + ngrok link, output in data/dashboard.log
//   npm start -- --local    same, on this computer only
//   npm run stop            stops it, however it was started
"use strict";
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { loadEnv, STATUS_FILE } = require("./start.js");

const PID_FILE = path.join(__dirname, "data", "dashboard.pid");
const LOG_FILE = path.join(__dirname, "data", "dashboard.log");
const START_TIMEOUT_MS = 20000;
const STOP_TIMEOUT_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")); } catch { return {}; }
}

function readPidFile() {
  try { return Number(fs.readFileSync(PID_FILE, "utf8").trim()); } catch { return 0; }
}

// Saved ids go stale and Windows reuses them, often for another node program,
// so a saved id only counts if that process is really running start.js.
function isDashboardCommand(commandLine) {
  return /(^|[\s"'\\/])start\.js(["'\s]|$)/i.test(String(commandLine || ""));
}

function commandLineOf(pid) {
  const r = process.platform === "win32"
    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8", windowsHide: true })
    : spawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" });
  return r.stdout || "";
}

function findRunning(pids = [readStatus().pid, readPidFile()], lookup = commandLineOf) {
  for (const pid of new Set(pids)) {
    if (Number.isInteger(pid) && pid > 0 && isDashboardCommand(lookup(pid))) return pid;
  }
  return 0;
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const finish = (used) => { socket.destroy(); resolve(used); };
    socket.setTimeout(800, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function configuredPort() {
  loadEnv(path.join(__dirname, ".env"));
  return Number(process.env.PORT) || 8787;
}

function clearRunFiles() {
  fs.rmSync(PID_FILE, { force: true });
  fs.rmSync(STATUS_FILE, { force: true });
}

function logTail(lines = 5) {
  try { return fs.readFileSync(LOG_FILE, "utf8").trimEnd().split(/\r?\n/).slice(-lines).join("\n"); } catch { return ""; }
}

// start.js is done starting once it reports the link, a local-only run, or a problem.
function startupSettled(status, pid) {
  return status.pid === pid && Boolean(status.online || status.local || status.problem);
}

async function start(args) {
  if (findRunning()) {
    const s = readStatus();
    console.log(`The dashboard is already running${s.url ? ` at ${s.url}` : ""}. Stop it with: npm run stop`);
    return;
  }
  const port = configuredPort();
  if (await portInUse(port)) {
    console.error(`Port ${port} is busy with another program, so the dashboard can't start.`);
    process.exitCode = 1;
    return;
  }
  clearRunFiles();
  const child = spawn(process.execPath, [path.join(__dirname, "start.js"), "--log", ...args.filter((a) => a === "--local")], { cwd: __dirname, detached: true, stdio: "ignore", windowsHide: true });
  let exited = false;
  child.once("exit", () => { exited = true; });
  child.once("error", (e) => { exited = true; console.error(`Couldn't start the dashboard: ${e.message}`); });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (!exited && !startupSettled(readStatus(), child.pid) && Date.now() < deadline) await sleep(250);
  child.unref();

  const s = readStatus();
  if (exited) {
    console.error(`The dashboard didn't start.${s.problem ? ` ${s.problem}` : ""}`);
    const tail = logTail();
    if (tail) console.error(tail);
    process.exitCode = 1;
    return;
  }
  if (s.online) console.log(`Dashboard online at ${s.url}`);
  else if (s.local) console.log(`Dashboard running on this computer only at http://localhost:${s.port}`);
  else if (s.problem) console.log(`Dashboard running on this computer only at http://localhost:${s.port}. ${s.problem}`);
  else console.log("The dashboard is still starting.");
  console.log(`Log: ${LOG_FILE}`);
  console.log("Stop it with: npm run stop");
}

async function stop() {
  const pid = findRunning();
  if (!pid) {
    const port = readStatus().port || configuredPort();
    if (await portInUse(port)) {
      console.error(`Port ${port} is in use, but not by a dashboard started from this folder, so nothing was stopped.`);
      process.exitCode = 1;
      return;
    }
    clearRunFiles();
    console.log("The dashboard isn't running.");
    return;
  }
  process.kill(pid);
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (isAlive(pid) && Date.now() < deadline) await sleep(100);
  if (isAlive(pid)) {
    console.error(`The dashboard (process ${pid}) didn't stop.`);
    process.exitCode = 1;
    return;
  }
  clearRunFiles();
  console.log("Stopped the dashboard.");
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  const run = { start, stop }[command];
  if (run) run(args);
  else { console.error("Use: node control.js start|stop"); process.exitCode = 1; }
}
module.exports = { isDashboardCommand, findRunning, startupSettled };
