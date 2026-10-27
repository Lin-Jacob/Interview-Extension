// Tests the native bridge host against a fake `claude`, and the installer in a
// throwaway home directory.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const host = require("../native/host.js");
const guard = require("../native/gameguard.js");

const HOST_JS = path.join(__dirname, "..", "native", "host.js");
const GUARD_JS = path.join(__dirname, "..", "native", "gameguard.js");

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; sleepMs(25); }
  return null;
}
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

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

  // The game blocker was started and keeps a heartbeat.
  const hb = waitFor(() => readJson(path.join(home, ".leetcode-daily-lock", "gameguard.json")));
  assert.ok(hb && alive(hb.pid), "game blocker running after install");

  const u = spawnSync(process.execPath, [path.join(__dirname, "..", "native", "install.js"), "--uninstall"], { env, encoding: "utf8" });
  assert.strictEqual(u.status, 0);
  assert.ok(waitFor(() => !alive(hb.pid)), "uninstall stops the game blocker");
  assert.ok(!fs.existsSync(path.join(manifestDir, "leetcode_daily_lock_claude.json")));
  assert.ok(!fs.existsSync(path.join(home, ".leetcode-daily-lock", "bridge")));
});

test("games are allowed only after today's task is reported done, or with blocking off", () => {
  const now = new Date(2026, 9, 27, 15).getTime();
  assert.strictEqual(guard.gamesAllowed(null, now), false);
  assert.strictEqual(guard.gamesAllowed({ date: "2026-10-27", done: false }, now), false);
  assert.strictEqual(guard.gamesAllowed({ date: "2026-10-27", done: true }, now), true);
  assert.strictEqual(guard.gamesAllowed({ date: "2026-10-26", done: true }, now), false, "yesterday's report doesn't count");
  assert.strictEqual(guard.gamesAllowed({ date: "2026-10-26", done: false, enabled: false }, now), true);
});

test("game rules match program names and install folders", () => {
  const rules = guard.compileRules(guard.DEFAULT_GAMES.concat(["minecraft", "D:/Games/"]));
  const m = (name, p = "") => guard.matches({ name, path: p }, rules);
  assert.ok(m("Steam.exe"));
  assert.ok(m("VALORANT.exe", "C:\\Riot Games\\VALORANT\\live\\VALORANT.exe"));
  assert.ok(m("eldenring.exe", "E:\\SteamLibrary\\steamapps\\common\\ELDEN RING\\Game\\eldenring.exe"));
  assert.ok(m("Fortnite.exe", "C:\\Program Files\\Epic Games\\Fortnite\\Fortnite.exe"));
  assert.ok(m("minecraft.exe"));
  assert.ok(m("x.exe", "d:\\games\\x\\x.exe"));
  assert.ok(!m("firefox.exe", "C:\\Program Files\\Mozilla Firefox\\firefox.exe"));
  assert.ok(!m("Code.exe", "C:\\Users\\j\\steamapps-notes\\Code.exe"));
});

test("game blocker leaves games that were already open, and closes new launches", { skip: process.platform === "win32" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lcdl-game-"));
  const exe = path.join(dir, "fakegame-lcdl");
  fs.copyFileSync(fs.realpathSync("/bin/sleep"), exe);
  fs.chmodSync(exe, 0o755);
  // A "client" that later starts a game from its own folder, like a League match.
  const client = path.join(dir, "fakeclient-lcdl");
  fs.copyFileSync(fs.realpathSync("/bin/sh"), client);
  fs.chmodSync(client, 0o755);
  const sessionPath = path.join(dir, "session.json");
  const { spawn } = require("node:child_process");
  const started = [];
  const launch = (file) => { const c = spawn(file, ["60"], { stdio: "ignore" }); started.push(c); return c; };
  const today = guard.dateKey();
  const blocked = { date: today, done: false, processes: ["fakegame-lcdl", "fakeclient-lcdl"] };
  const check = (state) => guard.checkOnce({ state, sessionPath });
  try {
    const open = launch(exe);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual(await check({ ...blocked, done: true }), [], "allowed once the task is done");
    assert.deepStrictEqual(await check(blocked), [], "a game already open when blocking starts keeps running");
    assert.ok(alive(open.pid));

    const fresh = launch(exe);
    await new Promise((r) => setTimeout(r, 100));
    let hits = await check(blocked);
    assert.deepStrictEqual(hits.map((h) => h.pid), [fresh.pid], "a new launch is closed");
    assert.ok(alive(open.pid));

    // A kept client starting a game from its own folder is part of that session.
    const c = spawn(client, ["-c", `sleep 0.4; "${exe}" 60 & wait`], { stdio: "ignore" });
    started.push(c);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual(await check({ ...blocked, done: true }), []);
    assert.deepStrictEqual(await check(blocked), [], "client open when blocking starts is kept");
    await new Promise((r) => setTimeout(r, 600));
    assert.deepStrictEqual(await check(blocked), [], "the game it starts is kept too");
    assert.ok(alive(c.pid));

    // Closing the open game and starting it again counts as a new launch.
    open.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 100));
    const again = launch(exe);
    await new Promise((r) => setTimeout(r, 100));
    hits = await check(blocked);
    assert.deepStrictEqual(hits.map((h) => h.pid), [again.pid]);

    // After a done day, blocking starts over: what's open then is kept, folders match too.
    assert.deepStrictEqual(await check({ ...blocked, done: true }), []);
    const keep = launch(exe);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual(await check({ ...blocked, processes: [dir + "/"] }), []);
    assert.ok(alive(keep.pid));
    const late = launch(exe);
    await new Promise((r) => setTimeout(r, 100));
    hits = await check({ ...blocked, processes: [dir + "/"] });
    assert.deepStrictEqual(hits.map((h) => h.pid), [late.pid]);
  } finally {
    for (const c of started) try { c.kill("SIGKILL"); } catch { /* gone */ }
    spawnSync("pkill", ["-9", "-f", dir]);
  }
});

test("programs a kept game starts from its own folder are part of it; Steam library games are not", () => {
  const P = (p) => ({ name: p.split("\\").pop(), path: p });
  assert.ok(guard.partOfGame(P("C:\\Riot Games\\League of Legends\\Game\\League of Legends.exe"), P("C:\\Riot Games\\League of Legends\\LeagueClient.exe")));
  assert.ok(guard.partOfGame(P("C:\\Riot Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe"), P("C:\\Riot Games\\VALORANT\\live\\VALORANT.exe")));
  assert.ok(!guard.partOfGame(P("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\Hades.exe"), P("C:\\Program Files (x86)\\Steam\\steam.exe")));
  assert.ok(!guard.partOfGame(P("D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe"), P("C:\\Program Files (x86)\\Steam\\steam.exe")));
  assert.ok(!guard.partOfGame(P("C:\\Riot Games\\League of Legends\\LeagueClient.exe"), P("C:\\Riot Games\\Riot Client\\RiotClientServices.exe")));
  assert.ok(!guard.partOfGame(P("C:\\Program Files\\Epic Games\\Fortnite\\Fortnite.exe"), P("C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe")));
});

test("bridge saves the game report and starts the blocker", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lcdl-host-"));
  for (const f of [HOST_JS, GUARD_JS]) fs.copyFileSync(f, path.join(dir, path.basename(f)));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lcdl-home-"));
  const run = (msg) => unframe(spawnSync(process.execPath, [path.join(dir, "host.js")], { input: frame(msg), env: { ...process.env, HOME: home } }).stdout);
  const out = run({ type: "games", date: "2026-10-27", done: false, enabled: true, processes: ["steam.exe"] });
  assert.deepStrictEqual(out, { ok: true, guard: "started" });
  const state = readJson(path.join(home, ".leetcode-daily-lock", "games.json"));
  assert.deepStrictEqual({ ...state, updatedAt: 0 }, { date: "2026-10-27", done: false, enabled: true, processes: ["steam.exe"], updatedAt: 0 });
  const hb = waitFor(() => readJson(path.join(home, ".leetcode-daily-lock", "gameguard.json")));
  try {
    assert.ok(hb && alive(hb.pid));
    // A second report finds it running instead of starting another.
    assert.deepStrictEqual(run({ type: "games", date: "2026-10-27", done: true, enabled: true }), { ok: true, guard: "running" });
    assert.deepStrictEqual(readJson(path.join(home, ".leetcode-daily-lock", "games.json")).processes, guard.DEFAULT_GAMES);
  } finally {
    if (hb) try { process.kill(hb.pid); } catch { /* gone */ }
  }
});

test("installer sets up the game blocker even without Claude Code", { skip: process.platform === "win32" }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lcdl-inst-"));
  const env = { ...process.env, HOME: home, PATH: "/usr/bin:/bin" };
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "native", "install.js")], { env, encoding: "utf8" });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Couldn't find Claude Code.*Installing the game blocker anyway/);
  assert.match(r.stdout, /Game blocker is running/);
  const hb = waitFor(() => readJson(path.join(home, ".leetcode-daily-lock", "gameguard.json")));
  assert.ok(hb && alive(hb.pid));
  const u = spawnSync(process.execPath, [path.join(__dirname, "..", "native", "install.js"), "--uninstall"], { env, encoding: "utf8" });
  assert.strictEqual(u.status, 0);
  assert.ok(waitFor(() => !alive(hb.pid)));
});
