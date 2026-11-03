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
const { createServer, cleanStats } = require("../server/server.js");
const { loadEnv, cleanDomain } = require("../server/start.js");

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

test("first name claims a spot; others can't post under it; the page and API are served", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-"));
  const server = createServer({ dataFile: path.join(dir, "users.json") });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await Share.push(fetch, url, Share.summary(stats, progress, "Jacob", now), "");
    assert.ok(first.token.length > 10);
    // Same browser again: same token works.
    const again = await Share.push(fetch, url, Share.summary(stats, progress, "Jacob", now), first.token);
    assert.strictEqual(again.token, first.token);
    // A friend typing "jacob" without the token is turned away.
    await assert.rejects(Share.push(fetch, url, Share.summary(stats, progress, "jacob", now), ""), /already uses the name "Jacob"/);
    await Share.push(fetch, url, Share.summary(stats, { ...progress, done: false }, "Sam", now), "");

    const r = await fetch(`${url}/api/users`);
    const data = await r.json();
    assert.deepStrictEqual(data.users.map((u) => u.name).sort(), ["Jacob", "Sam"]);
    assert.ok(!JSON.stringify(data).includes(first.token), "tokens never leave the server");
    assert.strictEqual(r.headers.get("access-control-allow-origin"), "*");

    const pre = await fetch(`${url}/api/sync`, { method: "OPTIONS" });
    assert.strictEqual(pre.status, 204);
    assert.match(pre.headers.get("access-control-allow-headers"), /ngrok-skip-browser-warning/);

    const page = await fetch(`${url}/`);
    assert.match(await page.text(), /Daily Lock Friends/);
    assert.strictEqual((await fetch(`${url}/../server.js`)).status, 404);
    assert.strictEqual((await fetch(`${url}/%2e%2e/server.js`)).status, 404);

    // Saved to disk, so a restart keeps everyone.
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "users.json"), "utf8"));
    assert.ok(saved.users.jacob && saved.users.sam);
  } finally {
    server.close();
  }
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
