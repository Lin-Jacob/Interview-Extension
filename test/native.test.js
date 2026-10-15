// Tests the native bridge host against a fake `claude`, and the installer in a
// throwaway home directory.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const host = require("../native/host.js");

const HOST_JS = path.join(__dirname, "..", "native", "host.js");

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const h = Buffer.alloc(4);
  h.writeUInt32LE(body.length);
  return Buffer.concat([h, body]);
}
function unframe(buf) {
  const len = buf.readUInt32LE(0);
  return JSON.parse(buf.slice(4, 4 + len).toString());
}

// A fake Claude Code that records its argv, stdin, cwd and env, then answers.
function fakeClaude(dir, { result = "a hint", isError = false } = {}) {
  const p = path.join(dir, "claude");
  fs.writeFileSync(p, `#!/usr/bin/env node
const fs = require("fs");
const input = fs.readFileSync(0, "utf8");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(path.join(dir, "call.json"))}, JSON.stringify({ args, input, cwd: process.cwd(), key: process.env.ANTHROPIC_API_KEY || null }));
if (args.includes("--version")) { console.log("9.9.9 (Claude Code)"); process.exit(0); }
const i = args.indexOf("--resume");
console.log(JSON.stringify({ type: "result", subtype: ${JSON.stringify(isError ? "error" : "success")}, is_error: ${isError}, result: ${JSON.stringify(result)}, session_id: i >= 0 ? args[i + 1] : "new-session" }));
`);
  fs.chmodSync(p, 0o755);
  return p;
}

test("argv disables tools and passes system prompt, resume and model", () => {
  assert.deepStrictEqual(host.buildArgs({ system: "S", sessionId: "abc", model: "opus" }),
    ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--system-prompt", "S", "--resume", "abc", "--model", "opus"]);
  assert.deepStrictEqual(host.buildArgs({}), ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config"]);
});

test("child env drops API keys so Claude Code uses the signed-in plan", () => {
  const env = host.childEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "x", HOME: "/h" });
  assert.deepStrictEqual(env, { PATH: "/bin", HOME: "/h" });
});

test("result parsing handles a single object, an array, and trailing log lines", () => {
  assert.strictEqual(host.parseResult('{"type":"result","result":"x"}').result, "x");
  assert.strictEqual(host.parseResult('[{"type":"system"},{"type":"result","result":"y"}]').result, "y");
  assert.strictEqual(host.parseResult('warning: something\n{"type":"result","result":"z"}').result, "z");
});

test("host speaks native messaging end to end", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lcdl-host-"));
  const claude = fakeClaude(dir, { result: "Think about complements." });
  fs.writeFileSync(path.join(dir, "host.js"), fs.readFileSync(HOST_JS));
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ claude: { command: claude, args: [] } }));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lcdl-home-"));
  const run = (msg) => {
    const r = spawnSync(process.execPath, [path.join(dir, "host.js")], {
      input: frame(msg), env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: "should-not-leak" }
    });
    return unframe(r.stdout);
  };
  let out = run({ type: "ask", system: "SYS", prompt: "[HINT 1/5]", sessionId: "s-1" });
  assert.deepStrictEqual(out, { ok: true, text: "Think about complements.", sessionId: "s-1" });
  const call = JSON.parse(fs.readFileSync(path.join(dir, "call.json"), "utf8"));
  assert.strictEqual(call.input, "[HINT 1/5]");
  assert.ok(call.args.includes("--system-prompt") && call.args.includes("SYS"));
  assert.strictEqual(call.key, null);
  assert.strictEqual(fs.realpathSync(call.cwd), fs.realpathSync(path.join(home, ".leetcode-daily-lock", "workspace")));

  out = run({ type: "ping" });
  assert.deepStrictEqual(out, { ok: true, version: "9.9.9 (Claude Code)" });
});

test("host reports sign-in problems clearly", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lcdl-host-"));
  const claude = fakeClaude(dir, { result: "Invalid API key · Please run /login", isError: true });
  await assert.rejects(host.handle({ type: "ask", system: "S", prompt: "p" }, { claude: { command: claude, args: [] } }), /isn't signed in/);
  await assert.rejects(host.handle({ type: "ask", prompt: "p" }, { claude: { command: path.join(dir, "missing"), args: [] } }), /ENOENT/);
});

test("installer registers the host for Firefox and uninstalls cleanly", { skip: process.platform === "win32" }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lcdl-inst-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "lcdl-bin-"));
  fakeClaude(bin, { result: "ready" });
  const env = { ...process.env, HOME: home, PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin` };
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "native", "install.js")], { env, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Claude Code answered: ready/);
  const manifestDir = process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts")
    : path.join(home, ".mozilla", "native-messaging-hosts");
  const manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, "leetcode_daily_lock_claude.json"), "utf8"));
  assert.deepStrictEqual(manifest.allowed_extensions, ["leetcode-daily-lock@lin-jacob"]);
  assert.strictEqual(manifest.type, "stdio");
  const config = JSON.parse(fs.readFileSync(path.join(home, ".leetcode-daily-lock", "bridge", "config.json"), "utf8"));
  assert.strictEqual(config.claude.command, path.join(bin, "claude"));

  // The launcher Firefox runs works with a bare PATH.
  const out = spawnSync(manifest.path, [], { input: frame({ type: "ping" }), env: { HOME: home, PATH: "/usr/bin:/bin" } });
  assert.deepStrictEqual(unframe(out.stdout), { ok: true, version: "9.9.9 (Claude Code)" });

  const u = spawnSync(process.execPath, [path.join(__dirname, "..", "native", "install.js"), "--uninstall"], { env, encoding: "utf8" });
  assert.strictEqual(u.status, 0);
  assert.ok(!fs.existsSync(path.join(manifestDir, "leetcode_daily_lock_claude.json")));
  assert.ok(!fs.existsSync(path.join(home, ".leetcode-daily-lock", "bridge")));
});
