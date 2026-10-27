#!/usr/bin/env node
// Game blocker for LeetCode Daily Lock. Runs in the background (started at
// sign-in and every few minutes by the installer's scheduled task) and closes
// game launchers and games until the extension reports that today's task is
// done. The extension reports through the bridge (host.js), which writes
// games.json; when Firefox hasn't reported today, games stay blocked.
"use strict";
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR = path.join(os.homedir(), ".leetcode-daily-lock");
const STATE_PATH = path.join(DATA_DIR, "games.json");
const HEARTBEAT_PATH = path.join(DATA_DIR, "gameguard.json");
const LOG_PATH = path.join(DATA_DIR, "gameguard.log");
const INTERVAL_MS = 10 * 1000;
const STALE_MS = 60 * 1000;
const WIN = process.platform === "win32";

// Used until the extension has sent its own list. Keep in sync with
// DEFAULT_SETTINGS.blockedGames in lib/core.js. Entries with a slash match a
// folder anywhere in the program's path; the rest match the program name.
const DEFAULT_GAMES = [
  "steam.exe", "EpicGamesLauncher.exe", "RiotClientServices.exe", "LeagueClient.exe", "VALORANT.exe",
  "\\steamapps\\common\\", "\\Epic Games\\", "\\Riot Games\\"
];

function pad(n) { return String(n).padStart(2, "0"); }
function dateKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

// Games are allowed only once the extension said today's task is done, or
// when game blocking is turned off in its settings.
function gamesAllowed(state, now = Date.now()) {
  if (!state) return false;
  if (state.enabled === false) return true;
  return state.date === dateKey(now) && !!state.done;
}

const stripExe = (s) => s.toLowerCase().replace(/\.exe$/, "");
const slashes = (s) => s.replace(/\//g, "\\").toLowerCase();

function compileRules(list) {
  const rules = { names: new Set(), folders: [] };
  for (const raw of list || []) {
    const s = String(raw || "").trim();
    if (!s) continue;
    if (/[\\/]/.test(s)) rules.folders.push(slashes(s));
    else rules.names.add(stripExe(s));
  }
  return rules;
}

function matches(proc, rules) {
  if (rules.names.has(stripExe(proc.name || ""))) return true;
  const p = proc.path ? slashes(proc.path) : "";
  return !!p && rules.folders.some((f) => p.includes(f));
}

function exec(cmd, args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

// [{ pid, name, path }] for every running process we can see.
async function listProcesses() {
  if (WIN) {
    try {
      const out = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-Process | ForEach-Object { '{0}|{1}|{2}' -f $_.Id, $_.ProcessName, $_.Path }"]);
      return out.split(/\r?\n/).filter(Boolean).map((line) => {
        const [pid, name, ...rest] = line.split("|");
        return { pid: Number(pid), name: `${name}.exe`, path: rest.join("|").trim() };
      }).filter((p) => p.pid > 0);
    } catch {
      // No PowerShell: names only.
      const out = await exec("tasklist", ["/fo", "csv", "/nh"]);
      return out.split(/\r?\n/).filter(Boolean).map((line) => {
        const cols = line.match(/"([^"]*)"/g) || [];
        return { pid: Number((cols[1] || "").replace(/"/g, "")), name: (cols[0] || "").replace(/"/g, ""), path: "" };
      }).filter((p) => p.pid > 0);
    }
  }
  const out = await exec("ps", ["-Ao", "pid=,args="]);
  return out.split("\n").map((line) => line.trim().match(/^(\d+)\s+(\S+)/)).filter(Boolean)
    .map(([, pid, cmd]) => ({ pid: Number(pid), name: path.basename(cmd), path: cmd }));
}

async function kill(pids) {
  if (!pids.length) return;
  if (WIN) {
    const args = ["/F", "/T"];
    for (const pid of pids) args.push("/PID", String(pid));
    await exec("taskkill", args).catch(() => {});
    return;
  }
  for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
}

function log(line) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 256 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + ".old");
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging is best effort */ }
}

// One pass: closes matching programs unless games are allowed right now.
// Returns the processes it closed.
async function checkOnce({ state = readJson(STATE_PATH, null), now = Date.now() } = {}) {
  if (gamesAllowed(state, now)) return [];
  const rules = compileRules(state && Array.isArray(state.processes) ? state.processes : DEFAULT_GAMES);
  const safe = new Set([process.pid, process.ppid]);
  const hits = (await listProcesses()).filter((p) => !safe.has(p.pid) && matches(p, rules));
  await kill(hits.map((p) => p.pid));
  if (hits.length) log(`closed ${hits.map((p) => `${p.name} (${p.pid})`).join(", ")}: today's task isn't done yet`);
  return hits;
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// Another guard is running if it wrote a heartbeat recently and its process exists.
function otherGuardRunning(now = Date.now()) {
  const hb = readJson(HEARTBEAT_PATH, null);
  return !!(hb && hb.pid && hb.pid !== process.pid && now - hb.at < STALE_MS && isAlive(hb.pid));
}

function beat() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HEARTBEAT_PATH, JSON.stringify({ pid: process.pid, at: Date.now() }));
  } catch { /* try again next tick */ }
}

async function main() {
  if (otherGuardRunning()) return;
  beat();
  log(`started (pid ${process.pid})`);
  for (;;) {
    beat();
    try { await checkOnce(); } catch (e) { log(`check failed: ${e.message}`); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

if (require.main === module) main();
module.exports = {
  DEFAULT_GAMES, STATE_PATH, HEARTBEAT_PATH, dateKey, gamesAllowed, compileRules, matches,
  listProcesses, checkOnce, otherGuardRunning
};
