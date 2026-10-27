// Loads the real background scripts in a sandbox with a fake `browser` and
// fake LeetCode / Claude endpoints, then drives them through messages.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ALL_LEETCODE = Array(7).fill("leetcode");

function makeEnv({ acToday = [], native = null, settings = { dailyGoal: 2, schedule: ALL_LEETCODE } } = {}) {
  const store = settings ? { settings } : {};
  const sessionStore = {};
  const openTabs = {};
  const createdTabs = [];
  const nativeCalls = [];
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const tabUpdates = [];
  const claudeCalls = [];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const browser = {
    storage: {
      local: {
        get: async (defaults) => {
          const out = {};
          for (const [k, v] of Object.entries(defaults)) out[k] = k in store ? clone(store[k]) : clone(v);
          return out;
        },
        set: async (patch) => { Object.assign(store, clone(patch)); }
      },
      onChanged: on("storage"),
      session: {
        get: async (key) => ({ [key]: sessionStore[key] }),
        set: async (patch) => { Object.assign(sessionStore, clone(patch)); }
      }
    },
    windows: { update: async () => {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: {
      query: async () => [{ id: 7, url: "https://www.youtube.com/" }, { id: 8, url: "https://leetcode.com/" }],
      update: async (id, props) => { tabUpdates.push({ id, ...props }); },
      create: async ({ url }) => { const id = 100 + createdTabs.length; createdTabs.push(url); openTabs[id] = { id, url, windowId: 1 }; return openTabs[id]; },
      get: async (id) => { if (!openTabs[id]) throw new Error("no tab"); return openTabs[id]; }
    },
    webNavigation: { onBeforeNavigate: on("nav") },
    alarms: { create: () => {}, onAlarm: on("alarm") },
    runtime: {
      onMessage: on("message"), onInstalled: on("installed"),
      getURL: (p) => `moz-extension://test/${p}`, openOptionsPage: async () => {},
      sendNativeMessage: async (host, m) => {
        nativeCalls.push({ host, ...clone(m) });
        if (!native) throw new Error("No such native application leetcode_daily_lock_claude");
        return native(m);
      }
    },
    cookies: { get: async () => ({ value: "csrf" }) }
  };
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.startsWith("https://leetcode.com/graphql")) {
      assert.strictEqual(init.headers["x-csrftoken"], "csrf");
      const q = body.query;
      let data;
      if (q.includes("userStatus")) data = { userStatus: { username: "jacob", isSignedIn: true } };
      else if (q.includes("recentAcSubmissionList")) data = { recentAcSubmissionList: acToday.map((slug) => ({ id: "1", title: slug, titleSlug: slug, timestamp: String(Math.floor(Date.now() / 1000)) })) };
      else if (q.includes("matchedUser")) data = { matchedUser: {
        tagProblemCounts: { advanced: [{ tagSlug: "dynamic-programming", problemsSolved: 3 }], intermediate: [{ tagSlug: "tree", problemsSolved: 25 }], fundamental: [{ tagSlug: "array", problemsSolved: 80 }] },
        submitStatsGlobal: { acSubmissionNum: [{ difficulty: "All", count: 110 }] } } };
      else if (q.includes("question(")) data = { question: {
        questionFrontendId: "1", title: body.variables.titleSlug, titleSlug: body.variables.titleSlug, difficulty: "Medium",
        content: "<p>Given <code>nums</code>&nbsp;return...</p>", status: null, topicTags: [{ name: "Array", slug: "array" }] } };
      return { ok: true, status: 200, json: async () => ({ data }) };
    }
    if (url === "https://api.anthropic.com/v1/messages") {
      claudeCalls.push(body);
      const tag = body.messages[body.messages.length - 1].content.split("\n")[0];
      return { ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: `reply to ${tag}` }] }) };
    }
    throw new Error("unexpected fetch " + url);
  };
  const ctx = vm.createContext({ browser, fetch, console, URL, setTimeout: () => {}, Date, Math, JSON, Promise });
  ctx.globalThis = ctx;
  for (const f of ["lib/topics.js", "lib/curriculum.js", "lib/core.js", "lib/leetcode.js", "lib/claude.js", "background.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f });
  }
  const msg = async (m) => {
    const r = await listeners.message(m, {});
    if (!r.ok) throw new Error(r.error);
    return r.result === undefined ? undefined : JSON.parse(JSON.stringify(r.result)); // cross-realm -> plain
  };
  return { store, listeners, tabUpdates, claudeCalls, createdTabs, openTabs, nativeCalls, msg, ctx };
}

const tick = () => new Promise((r) => setImmediate(r));

test("fresh install: assessment starts, picks come from least-practiced topics, sites block", async () => {
  const env = makeEnv();
  await env.listeners.installed({ reason: "install" });
  await tick();
  const st = await env.msg({ type: "getState" });
  assert.strictEqual(st.username, "jacob");
  assert.strictEqual(st.progress.solved.length, 0);
  assert.strictEqual(st.progress.done, false);
  assert.strictEqual(st.picks.length, 2);
  assert.ok(st.picks.every((p) => p.reason === "Assessment"));
  assert.ok(!st.picks.some((p) => ["arrays-hashing", "trees"].includes(p.topicId)), "well-practiced topics are not assessed first");
  assert.ok(st.assessment && st.assessment.total === 17);
  assert.ok(!("apiKey" in st.settings));

  // Sweep redirected the open YouTube tab but not LeetCode.
  assert.ok(env.tabUpdates.some((u) => u.id === 7 && u.url.startsWith("moz-extension://test/pages/blocked.html")));
  assert.ok(!env.tabUpdates.some((u) => u.id === 8));

  env.tabUpdates.length = 0;
  await env.listeners.nav({ frameId: 0, tabId: 3, url: "https://reddit.com/r/all" });
  await env.listeners.nav({ frameId: 0, tabId: 4, url: "https://github.com/" });
  assert.deepStrictEqual(env.tabUpdates.map((u) => u.id), [3]);
});

test("hints unlock the solution after five; revealed problems don't count", async () => {
  const env = makeEnv();
  await env.msg({ type: "saveSettings", settings: { apiKey: "sk-test", helpMode: "api" } });
  await assert.rejects(env.msg({ type: "help", slug: "two-sum", kind: "solution" }), /5 more hint/);
  let view;
  for (let i = 1; i <= 5; i++) view = await env.msg({ type: "help", slug: "two-sum", kind: "hint", code: "def f(): pass", language: "python3" });
  assert.strictEqual(view.hints, 5);
  assert.strictEqual(view.canReveal, true);
  view = await env.msg({ type: "help", slug: "two-sum", kind: "question", text: "is O(n) possible?" });
  assert.strictEqual(view.hints, 5);
  view = await env.msg({ type: "help", slug: "two-sum", kind: "solution" });
  assert.strictEqual(view.revealed, true);
  assert.strictEqual(view.transcript.filter((m) => m.role === "assistant").length, 7);

  // The conversation replays verbatim: last call has 13 messages (6 pairs + new turn),
  // assistant turns keep their thinking blocks, and the system prompt never changed.
  const last = env.claudeCalls[env.claudeCalls.length - 1];
  assert.strictEqual(last.messages.length, 13);
  assert.strictEqual(last.messages[1].content[0].type, "thinking");
  assert.match(last.messages[12].content, /^\[SOLUTION\]/);
  assert.ok(env.claudeCalls.every((c) => c.system === env.claudeCalls[0].system));
  assert.match(env.claudeCalls[0].system, /Given nums/);
  assert.strictEqual(last.output_config.effort, "high");

  // Accepting after revealing does not count toward the goal by default.
  await env.msg({ type: "accepted", slug: "two-sum", title: "Two Sum" });
  let st = await env.msg({ type: "getState" });
  assert.strictEqual(st.progress.solved.length, 0);
  await env.msg({ type: "saveSettings", settings: { countRevealedSolutions: true } });
  st = await env.msg({ type: "getState" });
  assert.strictEqual(st.progress.solved.length, 1);
});

test("two accepted solves unlock sites; LeetCode sync counts too", async () => {
  const env = makeEnv({ acToday: ["valid-parentheses"] });
  await env.msg({ type: "refresh" });
  let st = await env.msg({ type: "getState" });
  assert.deepStrictEqual(st.progress.solved, ["valid-parentheses"]);
  await env.msg({ type: "accepted", slug: "climbing-stairs", title: "Climbing Stairs" });
  st = await env.msg({ type: "getState" });
  assert.strictEqual(st.progress.done, true);
  env.tabUpdates.length = 0;
  await env.listeners.nav({ frameId: 0, tabId: 3, url: "https://reddit.com/" });
  assert.strictEqual(env.tabUpdates.length, 0);
  const attempt = st.attempts.find((a) => a.slug === "climbing-stairs");
  assert.ok(attempt.solvedAt);
  assert.deepStrictEqual(attempt.topics, ["dp-1d"]);
});

test("swap replaces a pick with a different problem", async () => {
  const env = makeEnv();
  await env.msg({ type: "startAssessment" });
  const before = (await env.msg({ type: "getState" })).picks;
  const after = (await env.msg({ type: "swapPick", slug: before[0].slug })).picks;
  assert.strictEqual(after.length, 2);
  assert.ok(!after.some((p) => p.slug === before[0].slug));
  assert.ok(after.some((p) => p.slug === before[1].slug));
});

test("claude.ai mode: first hint opens a chat with full instructions, later ones reuse it", async () => {
  const env = makeEnv();
  assert.strictEqual((await env.msg({ type: "getState" })).settings.helpMode, "claudecode");
  await env.msg({ type: "saveSettings", settings: { helpMode: "claudeai" } });

  let r = await env.msg({ type: "handoff", slug: "two-sum", kind: "hint", code: "x", language: "python3" });
  assert.strictEqual(r.newChat, true);
  assert.deepStrictEqual(env.createdTabs, ["https://claude.ai/new"]);
  assert.match(r.prompt, /coding-interview tutor/);
  assert.match(r.prompt, /Given nums/);
  assert.match(r.prompt, /\[HINT 1\/5\]/);
  assert.match(r.prompt, /```python3\nx\n```/);
  assert.strictEqual(r.session.hints, 1);

  r = await env.msg({ type: "handoff", slug: "two-sum", kind: "hint" });
  assert.strictEqual(r.newChat, false);
  assert.strictEqual(env.createdTabs.length, 1, "reuses the open claude.ai tab");
  assert.ok(env.tabUpdates.some((u) => u.id === 100 && u.active));
  assert.strictEqual(r.prompt, "[HINT 2/5]");

  await assert.rejects(env.msg({ type: "handoff", slug: "two-sum", kind: "solution" }), /3 more hint/);
  r = await env.msg({ type: "handoff", slug: "two-sum", kind: "question", text: "why TLE?" });
  assert.strictEqual(r.session.hints, 2);

  // If the chat tab was closed, the next hint starts a new chat and says how many hints were used.
  delete env.openTabs[100];
  for (let i = 0; i < 3; i++) r = await env.msg({ type: "handoff", slug: "two-sum", kind: "hint" });
  assert.strictEqual(env.createdTabs.length, 2);
  assert.strictEqual(r.session.canReveal, true);
  r = await env.msg({ type: "handoff", slug: "two-sum", kind: "solution" });
  assert.match(r.prompt, /^\[SOLUTION\]/);
  assert.strictEqual(r.session.revealed, true);
  assert.strictEqual(env.claudeCalls.length, 0, "no API calls in claude.ai mode");
});

test("Claude Code mode: answers come back in the panel and the conversation resumes", async () => {
  let turn = 0;
  let failResume = false;
  const env = makeEnv({
    native: (m) => {
      if (m.type === "ping") return { ok: true, version: "2.1.300 (Claude Code)" };
      if (m.sessionId && failResume) return { ok: false, error: "No conversation found with session ID: s1" };
      turn++;
      return { ok: true, text: `answer ${turn}`, sessionId: m.sessionId || `s${turn}` };
    }
  });
  assert.strictEqual((await env.msg({ type: "pingBridge" })).version, "2.1.300 (Claude Code)");

  let view = await env.msg({ type: "help", slug: "two-sum", kind: "hint", code: "x", language: "python3" });
  assert.strictEqual(view.hints, 1);
  assert.strictEqual(view.transcript[1].text, "answer 1");
  const first = env.nativeCalls.find((c) => c.type === "ask");
  assert.strictEqual(first.host, "leetcode_daily_lock_claude");
  assert.strictEqual(first.sessionId, undefined);
  assert.match(first.system, /coding-interview tutor/);
  assert.match(first.prompt, /^\[HINT 1\/5\]/);

  view = await env.msg({ type: "help", slug: "two-sum", kind: "question", text: "why?" });
  const second = env.nativeCalls.filter((c) => c.type === "ask")[1];
  assert.strictEqual(second.sessionId, "s1");
  assert.strictEqual(second.prompt, "[QUESTION]\n\nwhy?");
  assert.strictEqual(view.hints, 1);

  // A lost session starts a new one that is told how many hints were used.
  failResume = true;
  view = await env.msg({ type: "help", slug: "two-sum", kind: "hint" });
  const asks = env.nativeCalls.filter((c) => c.type === "ask");
  const retry = asks[asks.length - 1];
  assert.strictEqual(retry.sessionId, undefined);
  assert.match(retry.prompt, /^\(I already had 1 hint\(s\)/);
  assert.strictEqual(view.hints, 2);
  assert.strictEqual(env.claudeCalls.length, 0, "no API calls");
});

test("Claude Code mode without the bridge explains the setup", async () => {
  const env = makeEnv();
  await assert.rejects(env.msg({ type: "help", slug: "two-sum", kind: "hint" }), /bridge isn't installed/);
  const st = await env.msg({ type: "getSession", slug: "two-sum" });
  assert.strictEqual(st.hints, 0, "a failed hint isn't counted");
});

test("warm-up: Easy-only picks at first, Mediums after a week of hitting the goal", async () => {
  const env = makeEnv();
  let st = await env.msg({ type: "getState" });
  assert.ok(st.settings.rampUp);
  assert.match(st.ramp.label, /day 1 of 42: Easy only/);
  assert.ok(st.picks.every((p) => p.difficulty === "Easy"));

  // Pretend the goal was met on 7 earlier days (day 8 has a Medium: even day).
  const days = {};
  for (let i = 1; i <= 7; i++) days[`2000-01-0${i}`] = true;
  env.store.practiceDays = days;
  env.store.rampStartedAt = new Date(2000, 0, 1).getTime();
  env.store.daily = null;
  st = await env.msg({ type: "getState" });
  assert.match(st.ramp.label, /day 8/);
  assert.deepStrictEqual(st.picks.map((p) => p.difficulty).sort(), ["Easy", "Medium"]);

  // Swapping the Medium keeps the day's mix.
  const medium = st.picks.find((p) => p.difficulty === "Medium");
  st = await env.msg({ type: "swapPick", slug: medium.slug });
  assert.deepStrictEqual(st.picks.map((p) => p.difficulty).sort(), ["Easy", "Medium"]);
  assert.ok(!st.picks.some((p) => p.slug === medium.slug));

  // Turning the ramp off removes the caps; turning it on restarts at day 1.
  st = await env.msg({ type: "saveSettings", settings: { rampUp: false } });
  assert.strictEqual(st.ramp, null);
  st = await env.msg({ type: "saveSettings", settings: { rampUp: true } });
  assert.match(st.ramp.label, /day 1 of/);

  // Meeting today's goal records a practice day.
  await env.msg({ type: "accepted", slug: "two-sum" });
  await env.msg({ type: "accepted", slug: "valid-anagram" });
  assert.ok(Object.keys(env.store.practiceDays).length === 8);
});

function learnNative(replies) {
  return (m) => {
    if (m.type === "ping") return { ok: true, version: "x" };
    return { ok: true, text: replies(m), sessionId: m.sessionId || "lesson-session" };
  };
}

test("system design day: lesson, graded quiz, goal met, stats", async () => {
  const env = makeEnv({
    settings: { dailyGoal: 2, schedule: Array(7).fill("design") },
    native: learnNative((m) => m.prompt.includes("Write today's lesson")
      ? "Sure!\n```json\n" + JSON.stringify({ body: "# DNS\nIt resolves names.", questions: ["Q1?", "Q2?", "Q3?"] }) + "\n```"
      : JSON.stringify({ results: [{ score: 8, feedback: "ok", modelAnswer: "m" }, { score: 4, feedback: "f", modelAnswer: "m" }, { score: 9, feedback: "g", modelAnswer: "m" }], summary: "Nice." }))
  });
  let st = await env.msg({ type: "getState" });
  assert.strictEqual(st.today.type, "design");
  assert.strictEqual(st.today.id, "how-the-web-works");
  assert.strictEqual(st.progress.goal, 1);
  assert.strictEqual(st.progress.done, false);
  await env.listeners.nav({ frameId: 0, tabId: 3, url: "https://reddit.com/" });
  assert.ok(env.tabUpdates.some((u) => u.id === 3), "sites still block on a lesson day");

  let view = await env.msg({ type: "getLearn", kind: "design" });
  assert.strictEqual(view.item.id, "how-the-web-works");
  assert.strictEqual(view.isToday, true);
  assert.strictEqual(view.body, null);

  view = await env.msg({ type: "generateLesson", id: "how-the-web-works" });
  assert.match(view.body, /DNS/);
  assert.strictEqual(view.questions.length, 3);

  view = await env.msg({ type: "gradeLesson", id: "how-the-web-works", answers: ["a", "b", "c"] });
  const grading = env.nativeCalls.filter((c) => c.type === "ask")[1];
  assert.strictEqual(grading.sessionId, "lesson-session", "grading continues the lesson conversation");
  assert.match(grading.prompt, /My answer: b/);
  assert.strictEqual(view.grade.score, 0.7);
  assert.strictEqual(view.grade.results[1].feedback, "f");

  st = await env.msg({ type: "getState" });
  assert.strictEqual(st.progress.done, true);
  assert.strictEqual(Object.values(env.store.practiceDays)[0], "design");

  // Extra practice moves on to the next lesson.
  view = await env.msg({ type: "getLearn", kind: "design", next: true });
  assert.strictEqual(view.item.id, "apis");
  assert.strictEqual(view.isToday, false);

  const stats = await env.msg({ type: "getStats" });
  assert.strictEqual(stats.totals.lessons, 1);
  assert.strictEqual(stats.current, 1);
  assert.strictEqual(stats.calendar[stats.calendar.length - 1].design, 1);
});

test("behavioral day: feedback is graded and counts for the day", async () => {
  const env = makeEnv({
    settings: { dailyGoal: 2, schedule: Array(7).fill("behavioral") },
    native: learnNative(() => JSON.stringify({ score: 6, strengths: ["clear"], improvements: ["add a result"], improvedAnswer: "Better.", summary: "Good start." }))
  });
  const st = await env.msg({ type: "getState" });
  assert.strictEqual(st.today.type, "behavioral");
  await assert.rejects(env.msg({ type: "gradeBehavioral", id: st.today.id, answer: "  " }), /Write your answer/);
  const view = await env.msg({ type: "gradeBehavioral", id: st.today.id, answer: "I once..." });
  assert.strictEqual(view.grade.score, 0.6);
  assert.deepStrictEqual(view.answers, ["I once..."]);
  assert.match(env.nativeCalls.find((c) => c.type === "ask").prompt, /STAR/);
  assert.strictEqual((await env.msg({ type: "getState" })).progress.done, true);
});

test("lessons explain what to change in claude.ai mode", async () => {
  const env = makeEnv({ settings: { helpMode: "claudeai", schedule: Array(7).fill("design") } });
  await assert.rejects(env.msg({ type: "generateLesson", id: "caching" }), /Claude Code on this computer/);
});

test("LeetCode solves are logged for stats with hints", async () => {
  const env = makeEnv({ native: learnNative(() => "hint") });
  await env.msg({ type: "help", slug: "two-sum", kind: "hint" });
  await env.msg({ type: "accepted", slug: "two-sum", title: "Two Sum" });
  const stats = await env.msg({ type: "getStats" });
  assert.strictEqual(stats.totals.solved, 1);
  assert.strictEqual(stats.activity[0].title, "two-sum"); // the fake LeetCode API titles problems by slug
  assert.strictEqual(stats.activity[0].difficulty, "Medium");
  assert.strictEqual(stats.activity[0].hints, 1);
  assert.strictEqual(stats.totals.noHintRate, 0);
});

test("update to 1.4 moves to one a day once and keeps a custom goal after", async () => {
  const env = makeEnv({ settings: { dailyGoal: 2 } });
  await env.listeners.installed({ reason: "update" });
  assert.strictEqual(env.store.settings.dailyGoal, 1);
  assert.ok(env.store.rampStartedAt > 0);
  env.store.settings.dailyGoal = 3;
  await env.listeners.installed({ reason: "update" });
  assert.strictEqual(env.store.settings.dailyGoal, 3);
});

test("schedule settings are validated", async () => {
  const env = makeEnv();
  let st = await env.msg({ type: "saveSettings", settings: { schedule: ["leetcode"] } });
  assert.deepStrictEqual(st.settings.schedule, ["leetcode", "leetcode", "design", "leetcode", "design", "sql", "behavioral"]);
  st = await env.msg({ type: "saveSettings", settings: { schedule: Array(7).fill("behavioral") } });
  assert.strictEqual(st.today.type, "behavioral");
  assert.ok(!st.picks || st.picks.length === 0);
});

test("SQL day: one database problem; only SQL solves count; swap moves to the next", async () => {
  const env = makeEnv({ settings: { dailyGoal: 2, schedule: Array(7).fill("sql") } });
  let st = await env.msg({ type: "getState" });
  assert.strictEqual(st.today.type, "sql");
  assert.strictEqual(st.progress.goal, 1);
  assert.deepStrictEqual(st.picks.map((p) => p.slug), ["recyclable-and-low-fat-products"]);
  assert.strictEqual(st.picks[0].topicName, "SQL & Databases");

  st = await env.msg({ type: "swapPick", slug: "recyclable-and-low-fat-products" });
  assert.deepStrictEqual(st.picks.map((p) => p.slug), ["find-customer-referee"]);

  await env.msg({ type: "accepted", slug: "two-sum" });
  st = await env.msg({ type: "getState" });
  assert.strictEqual(st.progress.done, false, "an algorithm problem doesn't finish a SQL day");
  await env.msg({ type: "accepted", slug: "find-customer-referee" });
  st = await env.msg({ type: "getState" });
  assert.strictEqual(st.progress.done, true);
  const stats = await env.msg({ type: "getStats" });
  assert.strictEqual(stats.totals.byTopic.sql, 1);
});

test("update to 1.5 turns Friday into SQL only for the old default schedule", async () => {
  const old = ["leetcode", "leetcode", "design", "leetcode", "design", "leetcode", "behavioral"];
  let env = makeEnv({ settings: { schedule: old } });
  await env.listeners.installed({ reason: "update" });
  assert.strictEqual(env.store.settings.schedule[5], "sql");
  const custom = Array(7).fill("design");
  env = makeEnv({ settings: { schedule: custom } });
  await env.listeners.installed({ reason: "update" });
  assert.deepStrictEqual(env.store.settings.schedule, custom);
});

test("game blocker hears whether today's task is done, and once more when turned off", async () => {
  const env = makeEnv({ native: (m) => (m.type === "games" ? { ok: true, guard: "running" } : { ok: true, text: "" }) });
  await env.msg({ type: "refresh" });
  let games = env.nativeCalls.filter((c) => c.type === "games");
  assert.ok(games.length >= 1);
  const last = games[games.length - 1];
  assert.strictEqual(last.done, false);
  assert.strictEqual(last.enabled, true);
  assert.ok(last.processes.includes("steam.exe"));
  let st = await env.msg({ type: "getState" });
  assert.strictEqual(st.gameGuard.guard, "running");

  await env.msg({ type: "accepted", slug: "two-sum", title: "Two Sum" });
  await env.msg({ type: "accepted", slug: "add-two-numbers", title: "Add Two Numbers" });
  games = env.nativeCalls.filter((c) => c.type === "games");
  assert.strictEqual(games[games.length - 1].done, true);

  await env.msg({ type: "saveSettings", settings: { blockGames: false, blockedGames: "steam.exe\n\nsteam.exe\nminecraft.exe" } });
  st = await env.msg({ type: "getState" });
  assert.deepStrictEqual(st.settings.blockedGames, ["steam.exe", "minecraft.exe"]);
  games = env.nativeCalls.filter((c) => c.type === "games");
  assert.strictEqual(games[games.length - 1].enabled, false);
  const n = games.length;
  await env.msg({ type: "refresh" });
  assert.strictEqual(env.nativeCalls.filter((c) => c.type === "games").length, n, "no reports while blocking is off");
});

test("missing bridge is reported on the settings page, not thrown", async () => {
  const env = makeEnv();
  await env.msg({ type: "refresh" });
  const st = await env.msg({ type: "getState" });
  assert.match(st.gameGuard.error, /bridge isn't installed/);
});

test("a game closed by the blocker opens today's task once, within a minute", async () => {
  let lastClosed = null;
  const env = makeEnv({ native: () => ({ ok: true, guard: "running", lastClosed }) });
  const page = "moz-extension://test/pages/blocked.html?g=League%20of%20Legends";
  const opened = () => env.createdTabs.filter((u) => u === page).length;

  // An old close (from before an update) doesn't open anything.
  lastClosed = { at: Date.now() - 60 * 60 * 1000, label: "League of Legends" };
  await env.listeners.alarm({ name: "games" });
  assert.strictEqual(opened(), 0);

  lastClosed = { at: Date.now(), label: "League of Legends" };
  await env.listeners.alarm({ name: "games" });
  assert.strictEqual(opened(), 1);
  await env.listeners.alarm({ name: "games" });
  await env.msg({ type: "refresh" });
  assert.strictEqual(opened(), 1, "each close opens the page only once");
});
