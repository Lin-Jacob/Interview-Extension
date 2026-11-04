// The friends dashboard: the extension's summary and push (lib/share.js) and
// the server's first-name "login" (server/server.js), end to end over HTTP.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
global.DESIGN_LESSONS = require("../lib/curriculum.js").DESIGN_LESSONS;
global.BEHAVIORAL = require("../lib/curriculum.js").BEHAVIORAL;
global.TOPICS = require("../lib/topics.js").TOPICS;
const Core = require("../lib/core.js");
const Share = require("../lib/share.js");
const { createServer, cleanStats, createStore } = require("../server/server.js");
const { loadEnv, cleanDomain } = require("../server/start.js");
const Users = require("../server/users.js");
const { launcherScript } = require("../server/autostart.js");

const now = Date.now();
const stats = Core.computeStats({
  solveLog: { "two-sum": { ts: now - 1000, title: "Two Sum", difficulty: "Easy", topics: ["array"], hints: 2 } },
  lessonLog: { "how-the-web-works": [{ ts: now - 2000, score: 0.8 }] },
  practiceDays: { [Core.dateKey(now)]: "leetcode" },
  now
});
const progress = { type: "leetcode", count: 1, goal: 1, done: true };

test("normalizeUrl accepts a bare ngrok domain, a full link or localhost", () => {
  assert.strictEqual(Share.normalizeUrl("jacob.ngrok-free.app"), "https://jacob.ngrok-free.app");
  assert.strictEqual(Share.normalizeUrl(" https://jacob.ngrok-free.app/some/page "), "https://jacob.ngrok-free.app");
  assert.strictEqual(Share.normalizeUrl("localhost:8787"), "http://localhost:8787");
  assert.strictEqual(Share.normalizeUrl(""), "");
  assert.strictEqual(Share.normalizeUrl("javascript:alert(1)"), "");
});

test("summary has streaks, totals and calendar but no hints or answers", () => {
  const s = Share.summary(stats, progress, "  Jacob  ", now);
  assert.strictEqual(s.name, "Jacob");
  assert.strictEqual(s.current, 1);
  assert.strictEqual(s.totals.solved, 1);
  assert.deepStrictEqual(s.today, progress);
  assert.ok(s.calendar.length >= 7 * 25);
  assert.deepStrictEqual(Object.keys(s.calendar[0]).sort(), ["date", "goalMet", "total"]);
  assert.strictEqual(s.recent[0].title, "Two Sum");
  assert.ok(!("hints" in s.recent[0]));
});

test("cleanStats drops unknown fields and wrong types", () => {
  const c = cleanStats({ name: "Sam", current: "9", evil: "<script>", totals: { solved: 3 }, calendar: [{ date: "bad" }, { date: "2026-11-03", total: 2 }] });
  assert.strictEqual(c.current, 0);
  assert.ok(!("evil" in c));
  assert.strictEqual(c.totals.solved, 3);
  assert.deepStrictEqual(c.calendar, [{ date: "2026-11-03", total: 2, goalMet: false }]);
  assert.strictEqual(cleanStats({ name: "  " }), null);
});

test("logins: host makes passwords, extension posts with one, page needs one to view", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-"));
  const dataFile = path.join(dir, "users.json");
  const server = createServer({ dataFile, failDelayMs: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(url + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  try {
    // The host adds accounts while the server runs (users.js writes the same file).
    const store = createStore(dataFile);
    const quiet = () => {};
    Users.main(["add", "Jacob", "jacob-pass"], store, quiet);
    const out = [];
    Users.main(["add", "Sam"], store, (l) => out.push(l));
    const samPass = out.find((l) => l.includes("Password:")).split("Password: ")[1];
    assert.match(samPass, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

    // Extension pushes: right password works, wrong or missing doesn't.
    const r1 = await Share.push(fetch, url, Share.summary(stats, progress, "jacob", now), "jacob-pass");
    assert.strictEqual(r1.name, "Jacob", "the account's spelling wins");
    await assert.rejects(Share.push(fetch, url, Share.summary(stats, progress, "Jacob", now), "guess"), /don't match/);
    await assert.rejects(Share.push(fetch, url, Share.summary(stats, progress, "Alex", now), "x"), /don't match/);

    // Viewing needs a session.
    assert.strictEqual((await fetch(`${url}/api/users`)).status, 401);
    assert.strictEqual((await post("/api/login", { name: "Sam", password: "nope" })).status, 401);
    const login = await (await post("/api/login", { name: " sam ", password: samPass })).json();
    assert.ok(login.ok && login.token);
    assert.strictEqual(login.name, "Sam");
    const auth = { authorization: `Bearer ${login.token}` };
    const data = await (await fetch(`${url}/api/users`, { headers: auth })).json();
    assert.strictEqual(data.me, "Sam");
    assert.deepStrictEqual(data.users.map((u) => [u.name, !!u.empty]), [["Jacob", false], ["Sam", true]]);
    const raw = JSON.stringify(data);
    assert.ok(!raw.includes("hash") && !raw.includes("salt") && !raw.includes(login.token));

    // A new password signs Sam out; logout ends a session.
    Users.main(["add", "Sam", "new-pass"], store, quiet);
    assert.strictEqual((await fetch(`${url}/api/users`, { headers: auth })).status, 401);
    const l2 = await (await post("/api/login", { name: "Sam", password: "new-pass" })).json();
    assert.ok(l2.ok);
    await post("/api/logout", {}, { authorization: `Bearer ${l2.token}` });
    assert.strictEqual((await fetch(`${url}/api/users`, { headers: { authorization: `Bearer ${l2.token}` } })).status, 401);

    // Removing someone deletes their stats too.
    Users.main(["remove", "Jacob"], store, quiet);
    await assert.rejects(Share.push(fetch, url, Share.summary(stats, progress, "Jacob", now), "jacob-pass"), /don't match/);
    assert.ok(!JSON.parse(fs.readFileSync(dataFile, "utf8")).users.jacob);

    const pre = await fetch(`${url}/api/sync`, { method: "OPTIONS" });
    assert.strictEqual(pre.status, 204);
    assert.match(pre.headers.get("access-control-allow-headers"), /ngrok-skip-browser-warning/);
    const page = await fetch(`${url}/`);
    assert.match(await page.text(), /Daily Lock Friends/);
    assert.strictEqual((await fetch(`${url}/../server.js`)).status, 404);
    assert.strictEqual((await fetch(`${url}/%2e%2e/data/users.json`)).status, 404);
  } finally {
    server.close();
  }
});

test("Windows sign-in launcher runs start.js hidden with logging", () => {
  const vbs = launcherScript("C:\\Program Files\\nodejs\\node.exe", "C:\\dash\\start.js");
  assert.match(vbs, /sh\.CurrentDirectory = "C:\\dash"/);
  assert.match(vbs, /sh\.Run """C:\\Program Files\\nodejs\\node\.exe"" ""C:\\dash\\start\.js"" --log", 0, False/);
});

test("push explains when the address isn't the dashboard", async () => {
  const notJson = async () => ({ ok: false, status: 404, json: async () => { throw new Error("html"); } });
  await assert.rejects(Share.push(notJson, "https://x.ngrok-free.app", {}, ""), /answered 404/);
  const down = async () => { throw new TypeError("NetworkError"); };
  await assert.rejects(Share.push(down, "https://x.ngrok-free.app", {}, ""), /Is it running/);
});

test(".env reader and domain cleanup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-"));
  const f = path.join(dir, ".env");
  fs.writeFileSync(f, "# comment\nTEST_DASH_A=one\r\nexport TEST_DASH_B=\"two words\"\nTEST_DASH_C=\n");
  assert.strictEqual(loadEnv(f), true);
  assert.strictEqual(process.env.TEST_DASH_A, "one");
  assert.strictEqual(process.env.TEST_DASH_B, "two words");
  assert.strictEqual(loadEnv(path.join(dir, "missing")), false);
  assert.strictEqual(cleanDomain("https://jacob.ngrok-free.app/"), "jacob.ngrok-free.app");
});

test("DASHBOARD_USERS in .env is the list of logins", () => {
  const { syncAccountsFromEnv, parseUserList, login } = require("../server/server.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envusers-"));
  const store = createStore(path.join(dir, "users.json"));
  assert.deepStrictEqual(parseUserList(" Jacob:a:b:c , Sam L.:pw12 ,"), [{ name: "Jacob", password: "a:b:c" }, { name: "Sam L.", password: "pw12" }]);
  assert.throws(() => parseUserList("Jacob"), /needs a password/);

  let r = syncAccountsFromEnv(store, "Jacob:pass1,Sam:pass2");
  assert.deepStrictEqual(r, { added: ["Jacob", "Sam"], changed: [], removed: [] });
  const sess = login(store, "sam", "pass2");
  assert.ok(sess);

  // Restart with the same list: nothing changes and nobody is signed out.
  r = syncAccountsFromEnv(store, "Jacob:pass1,Sam:pass2");
  assert.deepStrictEqual(r, { added: [], changed: [], removed: [] });
  assert.ok(store.data().sessions[sess.token]);

  // New password for Sam signs Sam out; dropping Jacob removes his login but keeps his stats.
  store.update((d) => { d.users.jacob = { stats: { name: "Jacob" }, at: 1 }; });
  r = syncAccountsFromEnv(store, "Sam:new-pass");
  assert.deepStrictEqual(r, { added: [], changed: ["Sam"], removed: ["Jacob"] });
  assert.ok(!store.data().sessions[sess.token]);
  assert.strictEqual(login(store, "Jacob", "pass1"), null);
  assert.ok(store.data().users.jacob, "stats come back if the name is added again");
});
