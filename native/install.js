#!/usr/bin/env node
// One-time setup for the LeetCode Daily Lock Claude Code bridge.
//   node install.js            install (or update)
//   node install.js --uninstall
// Copies host.js and gameguard.js to ~/.leetcode-daily-lock/bridge, records
// where `claude` is, registers the bridge with Firefox for this user only, and
// sets up the game blocker to run in the background.
"use strict";
const { execFileSync, spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOST_NAME = "leetcode_daily_lock_claude";
const EXTENSION_ID = "leetcode-daily-lock@lin-jacob";
const HOME = os.homedir();
const INSTALL_DIR = path.join(HOME, ".leetcode-daily-lock", "bridge");
const WIN = process.platform === "win32";
const REG_KEY = `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`;
const GUARD_TASK = "LeetCode Daily Lock game blocker";
const STARTUP_DIR = path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
const STARTUP_FILE = path.join(STARTUP_DIR, "LeetCode Daily Lock game blocker.vbs");

function manifestDir() {
  if (process.platform === "darwin") return path.join(HOME, "Library", "Application Support", "Mozilla", "NativeMessagingHosts");
  if (WIN) return INSTALL_DIR; // Windows finds it through the registry key instead.
  return path.join(HOME, ".mozilla", "native-messaging-hosts");
}

// Finds Claude Code. Firefox starts the bridge with a bare PATH, so we store
// absolute paths now, while running in the user's own terminal.
function findClaude() {
  let found = [];
  try {
    found = execFileSync(WIN ? "where" : "which", WIN ? ["claude"] : ["-a", "claude"], { encoding: "utf8" })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { /* not on PATH */ }
  const localAppData = process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local");
  const extra = WIN
    ? [path.join(HOME, ".local", "bin", "claude.exe"), path.join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"),
        path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "npm", "claude.cmd")]
    : [path.join(HOME, ".local", "bin", "claude"), path.join(HOME, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  for (const p of found.concat(extra)) {
    if (!fs.existsSync(p)) continue;
    if (WIN && /\.(cmd|bat|ps1)$/i.test(p)) {
      // npm shim: run its JavaScript entry point with node directly, which avoids cmd.exe quoting.
      // Newer packages ship a native claude.exe in the package instead of cli.js.
      const pkg = path.join(path.dirname(p), "node_modules", "@anthropic-ai", "claude-code");
      const cli = path.join(pkg, "cli.js");
      if (fs.existsSync(cli)) return { command: process.execPath, args: [cli] };
      for (const exe of [path.join(pkg, "bin", "claude.exe"), path.join(pkg, "claude.exe")]) {
        if (fs.existsSync(exe)) return { command: exe, args: [] };
      }
      continue;
    }
    if (WIN && !/\.exe$/i.test(p)) continue;
    return { command: p, args: [] };
  }
  // Fall back to what an earlier install of the bridge found, if it's still there.
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(INSTALL_DIR, "config.json"), "utf8")).claude;
    if (prev && prev.command && fs.existsSync(prev.command) && (prev.args || []).every((a) => fs.existsSync(a))) return prev;
  } catch { /* no earlier install */ }
  return null;
}

// Stops a running game blocker, using the heartbeat file it keeps.
function stopGuard() {
  const hbPath = path.join(HOME, ".leetcode-daily-lock", "gameguard.json");
  try {
    const { pid } = JSON.parse(fs.readFileSync(hbPath, "utf8"));
    if (pid) process.kill(pid);
  } catch { /* not running */ }
  fs.rmSync(hbPath, { force: true });
  // Games open right now count as already running and stay open until closed.
  fs.rmSync(path.join(HOME, ".leetcode-daily-lock", "gameguard-session.json"), { force: true });
}

// Windows: a hidden launcher, run at sign-in (Startup folder) and every 5
// minutes by Task Scheduler, so the blocker comes back if it's ended. A second
// copy exits right away when one is already running. Elsewhere the bridge
// starts it whenever Firefox reports progress.
function setUpGuard() {
  stopGuard();
  const guard = path.join(INSTALL_DIR, "gameguard.js");
  if (!WIN) {
    spawn(process.execPath, [guard], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, admin: true };
  }
  const vbs = path.join(INSTALL_DIR, "gameguard.vbs");
  const q = (p) => `""${p}""`;
  fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${q(process.execPath)} ${q(guard)}", 0, False\r\n`);
  // From an administrator terminal the task runs with full rights, so it can
  // also close games that run as administrator (the League client does).
  // A non-elevated copy from the Startup folder would block it, so skip that.
  const admin = isAdmin();
  const create = ["/create", "/f", "/sc", "minute", "/mo", "5", "/tn", GUARD_TASK, "/tr", `wscript.exe "${vbs}"`];
  if (admin) create.push("/rl", "highest");
  let ok = spawnSync("schtasks", create, { stdio: "ignore" }).status === 0;
  if (admin) {
    fs.rmSync(STARTUP_FILE, { force: true });
    if (ok) ok = spawnSync("schtasks", ["/run", "/tn", GUARD_TASK], { stdio: "ignore" }).status === 0;
    if (!ok) spawnSync("wscript.exe", [vbs], { stdio: "ignore" });
    return { ok, admin };
  }
  try {
    fs.mkdirSync(STARTUP_DIR, { recursive: true });
    fs.copyFileSync(vbs, STARTUP_FILE);
  } catch { ok = false; }
  spawnSync("wscript.exe", [vbs], { stdio: "ignore" });
  return { ok, admin };
}

// `net session` only succeeds in an elevated (administrator) terminal.
function isAdmin() {
  return spawnSync("net", ["session"], { stdio: "ignore", windowsHide: true }).status === 0;
}

function uninstall() {
  if (WIN) {
    spawnSync("schtasks", ["/delete", "/f", "/tn", GUARD_TASK], { stdio: "ignore" });
    fs.rmSync(STARTUP_FILE, { force: true });
  }
  stopGuard();
  fs.rmSync(path.join(HOME, ".leetcode-daily-lock", "games.json"), { force: true });
  const manifest = path.join(manifestDir(), `${HOST_NAME}.json`);
  if (fs.existsSync(manifest)) fs.unlinkSync(manifest);
  if (WIN) spawnSync("reg", ["delete", REG_KEY, "/f"], { stdio: "ignore" });
  fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
  console.log("Removed the LeetCode Daily Lock bridge and game blocker.");
}

function install() {
  // The game blocker works without Claude Code, so install anyway and say so.
  const claude = findClaude();
  if (!claude) {
    console.error("Couldn't find Claude Code, so hints won't work yet. Install it (https://claude.com/claude-code), run `claude` once to sign in, then run this again. Installing the game blocker anyway.");
  }
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  for (const f of ["host.js", "gameguard.js"]) fs.copyFileSync(path.join(__dirname, f), path.join(INSTALL_DIR, f));
  // Record this terminal's PATH (plus node's folder) for the bridge to reuse.
  const pathValue = [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter);
  const config = { claude, path: pathValue };
  fs.writeFileSync(path.join(INSTALL_DIR, "config.json"), JSON.stringify(config, null, 2));

  // Firefox needs one executable to launch, so wrap node + host.js.
  let launcher;
  if (WIN) {
    launcher = path.join(INSTALL_DIR, "host.bat");
    fs.writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "%~dp0host.js" %*\r\n`);
  } else {
    launcher = path.join(INSTALL_DIR, "host.sh");
    fs.writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/host.js" "$@"\n`);
    fs.chmodSync(launcher, 0o755);
  }

  const dir = manifestDir();
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, `${HOST_NAME}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify({
    name: HOST_NAME,
    description: "Lets LeetCode Daily Lock ask Claude Code for hints",
    path: launcher,
    type: "stdio",
    allowed_extensions: [EXTENSION_ID]
  }, null, 2));
  if (WIN) execFileSync("reg", ["add", REG_KEY, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], { stdio: "ignore" });

  console.log(`Installed. Firefox will run: ${launcher}`);
  if (claude) console.log(`Using Claude Code at: ${[claude.command, ...claude.args].join(" ")}`);
  const g = setUpGuard();
  if (g.ok) console.log("Game blocker is running. Games stay closed until today's task is done (change the list in the extension settings).");
  else console.error("Couldn't set the game blocker to start with Windows. It still runs now, and the bridge restarts it while Firefox is open.");
  if (!g.admin) console.log("Tip: run this from an administrator terminal so the blocker can also close games that run as administrator, like the League client.");

  if (!claude) { process.exitCode = 1; return; }
  // Quick check that Claude Code runs and is signed in.
  const { handle } = require(path.join(INSTALL_DIR, "host.js"));
  console.log("Checking Claude Code (sends one tiny message)…");
  handle({ type: "ask", system: "Reply with exactly: ready", prompt: "ping" }, config)
    .then((r) => {
      console.log(`Claude Code answered: ${r.text.trim().slice(0, 80)}`);
      console.log("All set. In Firefox, open the extension settings and choose \"Claude Code on this computer\".");
    })
    .catch((e) => {
      console.error(`The bridge is installed, but Claude Code didn't answer: ${e.message}`);
      console.error("Run `claude` in a terminal, sign in with your Pro account, then try a hint again.");
      process.exitCode = 1;
    });
}

if (process.argv.includes("--uninstall")) uninstall();
else install();
