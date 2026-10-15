#!/usr/bin/env node
// Native messaging host for LeetCode Daily Lock. Firefox starts it for each
// hint, sends one length-prefixed JSON message on stdin, and reads one reply on
// stdout. It answers by running Claude Code (`claude -p`), which uses whatever
// account Claude Code is signed in with, such as a Pro plan.
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");
const WORK_DIR = path.join(os.homedir(), ".leetcode-daily-lock", "workspace");
const TIMEOUT_MS = 5 * 60 * 1000;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { claude: { command: "claude", args: [] } };
  }
}

// Builds the argv for one turn. Tools are off so Claude only talks; the fixed
// working directory keeps project files and CLAUDE.md out of the conversation.
function buildArgs({ system, sessionId, model }) {
  const args = ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config"];
  if (system) args.push("--system-prompt", system);
  if (sessionId) args.push("--resume", sessionId);
  if (model) args.push("--model", model);
  return args;
}

// Removes variables that would make Claude Code bill an API key or join
// another Claude Code session instead of using the signed-in plan.
function childEnv(env = process.env, config = {}) {
  const out = { ...env };
  // Firefox starts us with a bare PATH; restore the one recorded at install time
  // so an npm-installed `claude` (a node script) can find node.
  if (config.path) out.PATH = config.path;
  for (const k of Object.keys(out)) {
    if (k === "ANTHROPIC_API_KEY" || k === "ANTHROPIC_AUTH_TOKEN" || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_SESSION")) delete out[k];
  }
  return out;
}

function parseResult(stdout) {
  const text = stdout.trim();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const last = text.split("\n").filter(Boolean).pop() || "";
    data = JSON.parse(last);
  }
  if (Array.isArray(data)) data = data.filter((d) => d && d.type === "result").pop();
  if (!data) throw new Error("Claude Code returned no result.");
  return data;
}

function run(command, args, { input = "", cwd, env, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: env || childEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Claude Code took too long to answer.")); }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

async function handle(msg, config = loadConfig()) {
  const { command, args: baseArgs = [] } = config.claude;
  const env = childEnv(process.env, config);
  fs.mkdirSync(WORK_DIR, { recursive: true });
  if (msg.type === "ping") {
    const r = await run(command, baseArgs.concat(["--version"]), { cwd: WORK_DIR, env, timeoutMs: 30000 });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || "claude --version failed").trim());
    return { version: r.stdout.trim() };
  }
  if (msg.type === "ask") {
    const r = await run(command, baseArgs.concat(buildArgs(msg)), { input: msg.prompt || "", cwd: WORK_DIR, env });
    let data;
    try {
      data = parseResult(r.stdout);
    } catch {
      throw new Error((r.stderr || r.stdout || `Claude Code exited with code ${r.code}`).trim().slice(0, 500));
    }
    if (data.is_error || data.subtype !== "success") {
      const why = String(data.result || data.subtype || "unknown error");
      if (/login|log in|auth|api key/i.test(why)) throw new Error(`Claude Code isn't signed in. Run \`claude\` in a terminal and log in with your Pro account. (${why})`);
      throw new Error(`Claude Code error: ${why}`);
    }
    return { text: String(data.result || ""), sessionId: data.session_id || null };
  }
  throw new Error(`Unknown message type: ${msg.type}`);
}

// ---- native messaging framing: 4-byte little-endian length + UTF-8 JSON ----

function writeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function readOneMessage(stream) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    stream.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) return;
      stream.pause();
      try { resolve(JSON.parse(buf.slice(4, 4 + len).toString("utf8"))); } catch (e) { reject(e); }
    });
    stream.on("end", () => reject(new Error("stdin closed before a full message arrived")));
  });
}

async function main() {
  let reply;
  try {
    const msg = await readOneMessage(process.stdin);
    reply = { ok: true, ...(await handle(msg)) };
  } catch (e) {
    reply = { ok: false, error: e.message || String(e) };
  }
  writeMessage(reply);
  process.exit(0);
}

if (require.main === module) main();
module.exports = { buildArgs, childEnv, parseResult, handle };
