#!/usr/bin/env node
// One-time setup for the LeetCode Daily Lock Claude Code bridge.
//   node install.js            install (or update)
//   node install.js --uninstall
// Copies host.js to ~/.leetcode-daily-lock/bridge, records where `claude` is,
// and registers the bridge with Firefox for this user only.
"use strict";
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOST_NAME = "leetcode_daily_lock_claude";
const EXTENSION_ID = "leetcode-daily-lock@lin-jacob";
const HOME = os.homedir();
const INSTALL_DIR = path.join(HOME, ".leetcode-daily-lock", "bridge");
const WIN = process.platform === "win32";
const REG_KEY = `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`;

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
  const extra = WIN
    ? [path.join(HOME, ".local", "bin", "claude.exe")]
    : [path.join(HOME, ".local", "bin", "claude"), path.join(HOME, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  for (const p of found.concat(extra)) {
    if (!fs.existsSync(p)) continue;
    if (WIN && /\.(cmd|bat|ps1)$/i.test(p)) {
      // npm shim: run its JavaScript entry point with node directly, which avoids cmd.exe quoting.
      const cli = path.join(path.dirname(p), "node_modules", "@anthropic-ai", "claude-code", "cli.js");
      if (fs.existsSync(cli)) return { command: process.execPath, args: [cli] };
      continue;
    }
    if (WIN && !/\.exe$/i.test(p)) continue;
    return { command: p, args: [] };
  }
  return null;
}

function uninstall() {
  const manifest = path.join(manifestDir(), `${HOST_NAME}.json`);
  if (fs.existsSync(manifest)) fs.unlinkSync(manifest);
  if (WIN) spawnSync("reg", ["delete", REG_KEY, "/f"], { stdio: "ignore" });
  fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
  console.log("Removed the LeetCode Daily Lock bridge.");
}

function install() {
  const claude = findClaude();
  if (!claude) {
    console.error("Couldn't find Claude Code. Install it (https://claude.com/claude-code), run `claude` once to sign in, then run this again.");
    process.exit(1);
  }
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "host.js"), path.join(INSTALL_DIR, "host.js"));
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
  console.log(`Using Claude Code at: ${[claude.command, ...claude.args].join(" ")}`);

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
