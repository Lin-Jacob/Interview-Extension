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
// Games that were already open when blocking started, which keep running
// until they're closed: { blocking, procs: [{ pid, name, path }] }.
const SESSION_PATH = path.join(DATA_DIR, "gameguard-session.json");
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

// [{ pid, ppid, name, path }] for every running process we can see.
async function listProcesses() {
  if (WIN) {
    try {
      const out = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.ParentProcessId, $_.Name, $_.ExecutablePath }"]);
      return out.split(/\r?\n/).filter(Boolean).map((line) => {
        const [pid, ppid, name, ...rest] = line.split("|");
        return { pid: Number(pid), ppid: Number(ppid), name, path: rest.join("|").trim() };
      }).filter((p) => p.pid > 0);
    } catch {
      // No PowerShell: names only.
      const out = await exec("tasklist", ["/fo", "csv", "/nh"]);
      return out.split(/\r?\n/).filter(Boolean).map((line) => {
        const cols = line.match(/"([^"]*)"/g) || [];
        return { pid: Number((cols[1] || "").replace(/"/g, "")), ppid: 0, name: (cols[0] || "").replace(/"/g, ""), path: "" };
      }).filter((p) => p.pid > 0);
    }
  }
  const out = await exec("ps", ["-Ao", "pid=,ppid=,args="]);
  return out.split("\n").map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)/)).filter(Boolean)
    .map(([, pid, ppid, cmd]) => ({ pid: Number(pid), ppid: Number(ppid), name: path.basename(cmd), path: cmd }));
}

async function kill(pids) {
  if (!pids.length) return;
  if (WIN) {
    const args = ["/F", "/T"];
    for (const pid of pids) args.push("/PID", String(pid));
    // Programs running as administrator can't be closed unless the blocker is
    // too (install from an administrator terminal); say so in the log.
    await exec("taskkill", args).catch((e) => log(`couldn't close some programs: ${String(e.message).trim().slice(0, 300)}`));
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

// A program started by a game that was already open counts as part of that
// game (a match starting from the League client, a game's own helpers) when it
// lives in the same install folder. Games launched from Steam's library aren't
// part of Steam, so a launcher that stays open can't start anything new.
function partOfGame(child, parent) {
  if (!child.path || !parent.path) return stripExe(child.name || "") === stripExe(parent.name || "");
  const pp = slashes(parent.path);
  const dir = pp.slice(0, pp.lastIndexOf("\\") + 1);
  const p = slashes(child.path);
  return p.startsWith(dir) && !p.slice(dir.length).includes("steamapps\\");
}

// One pass: closes matching programs unless games are allowed right now.
// Games already open when blocking starts (at midnight, when it's turned on,
// or when the blocker is installed) keep running until closed; anything
// opened after that is closed. Returns the processes it closed.
async function checkOnce({ state = readJson(STATE_PATH, null), now = Date.now(), sessionPath = SESSION_PATH, onClosed = showTask } = {}) {
  const session = readJson(sessionPath, null);
  if (gamesAllowed(state, now)) {
    if (!session || session.blocking) writeJson(sessionPath, { blocking: false, procs: [] });
    return [];
  }
  const rules = compileRules(state && Array.isArray(state.processes) ? state.processes : DEFAULT_GAMES);
  const procs = await listProcesses();
  const safe = new Set([process.pid, process.ppid]);
  const games = procs.filter((p) => !safe.has(p.pid) && matches(p, rules));
  const key = (p) => `${p.pid}|${stripExe(p.name || "")}`;
  let kept;
  if (!session || !session.blocking) {
    // Blocking just started: whatever is open now may keep running.
    kept = new Map(games.map((p) => [key(p), p]));
    if (kept.size) log(`left open until closed: ${games.map((p) => `${p.name} (${p.pid})`).join(", ")}`);
  } else {
    // Still-running games from before, plus anything they started themselves.
    const running = new Set(procs.map(key));
    kept = new Map(session.procs.filter((p) => running.has(key(p))).map((p) => [key(p), p]));
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    for (const g of games) {
      if (kept.has(key(g))) continue;
      for (let parent = byPid.get(g.ppid), hops = 0; parent && hops < 10; parent = byPid.get(parent.ppid), hops++) {
        const k = kept.get(key(parent));
        if (k && partOfGame(g, k)) { kept.set(key(g), g); break; }
      }
    }
  }
  writeJson(sessionPath, { blocking: true, procs: [...kept.values()].map(({ pid, name, path: p }) => ({ pid, name, path: p })) });
  const hits = games.filter((p) => !kept.has(key(p)));
  await kill(hits.map((p) => p.pid));
  if (hits.length) {
    log(`closed ${hits.map((p) => `${p.name} (${p.pid})`).join(", ")}: today's task isn't done yet`);
    onClosed(hits, now);
  }
  return hits;
}

const FRIENDLY = {
  steam: "Steam", epicgameslauncher: "Epic Games", riotclientservices: "Riot Client", "riot client": "Riot Client",
  leagueclient: "League of Legends", leagueclientux: "League of Legends", "league of legends": "League of Legends", valorant: "VALORANT"
};
function gameLabel(hits) {
  const names = hits.map((p) => stripExe(p.name || ""));
  const known = names.find((n) => FRIENDLY[n]);
  return known ? FRIENDLY[known] : (hits[0].name || "Game").replace(/\.exe$/i, "");
}

// The extension turns this leetcode.com address into its "finish today's task
// first" page, which lists today's task (background.js, TASK_PAGE_MARKER).
function taskPageUrl(label) {
  return `https://leetcode.com/?lcdl-game=${encodeURIComponent(label)}`;
}

// Opens today's task in the browser after closing a game, at most once a
// minute so a launcher that keeps retrying doesn't flood it with tabs.
let lastShown = 0;
function showTask(hits, now = Date.now()) {
  if (now - lastShown < 60 * 1000) return;
  lastShown = now;
  const url = taskPageUrl(gameLabel(hits));
  // explorer.exe opens it in the default browser as the signed-in user, even
  // when the blocker itself runs as administrator.
  const [cmd, args] = WIN ? ["explorer.exe", [url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  execFile(cmd, args, { windowsHide: true }, () => {});
}

function writeJson(p, data) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data));
  } catch { /* try again next tick */ }
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
  DEFAULT_GAMES, STATE_PATH, HEARTBEAT_PATH, SESSION_PATH, dateKey, partOfGame, gamesAllowed, compileRules, matches,
  listProcesses, checkOnce, otherGuardRunning, gameLabel, taskPageUrl
};
