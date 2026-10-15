const test = require("node:test");
const assert = require("node:assert");
const Core = require("../lib/core.js");
const { TOPICS } = require("../lib/topics.js");

test("site list parsing normalizes entries", () => {
  assert.deepStrictEqual(
    Core.parseSiteList("https://www.YouTube.com/watch?v=1\n*.reddit.com\n\n# comment\nx.com, x.com"),
    ["youtube.com", "reddit.com", "x.com"]);
});

test("blocking matches domains and subdomains only", () => {
  const sites = ["youtube.com", "x.com"];
  assert.ok(Core.isBlockedUrl("https://m.youtube.com/feed", sites));
  assert.ok(Core.isBlockedUrl("https://x.com/home", sites));
  assert.ok(!Core.isBlockedUrl("https://notyoutube.com/", sites));
  assert.ok(!Core.isBlockedUrl("https://box.com/", sites));
  assert.ok(!Core.isBlockedUrl("https://leetcode.com/problems/two-sum/", ["leetcode.com"]));
  assert.ok(!Core.isBlockedUrl("moz-extension://abc/pages/blocked.html", sites));
});

test("solved today counts only today's unique accepts and drops revealed ones", () => {
  const now = new Date(2026, 9, 14, 15, 0).getTime();
  const today = Core.startOfDay(now);
  const acList = [
    { titleSlug: "two-sum", timestamp: String((today + 3600e3) / 1000) },
    { titleSlug: "two-sum", timestamp: String((today + 7200e3) / 1000) },
    { titleSlug: "3sum", timestamp: String((today - 3600e3) / 1000) },
    { titleSlug: "subsets", timestamp: String((today + 60e3) / 1000) }
  ];
  const localAccepts = { "valid-anagram": today + 10, "old": today - 10 };
  const base = { acList, localAccepts, now };
  assert.deepStrictEqual(Core.solvedTodaySlugs(base).sort(), ["subsets", "two-sum", "valid-anagram"]);
  assert.deepStrictEqual(Core.solvedTodaySlugs({ ...base, revealed: { subsets: 1 } }).sort(), ["two-sum", "valid-anagram"]);
  assert.strictEqual(Core.solvedTodaySlugs({ ...base, revealed: { subsets: 1 }, countRevealed: true }).length, 3);
});

test("attempt quality falls with hints and is zero when revealed", () => {
  const now = Date.now();
  assert.strictEqual(Core.attemptQuality({ solvedAt: now, hints: 0 }, now), 1);
  assert.ok(Math.abs(Core.attemptQuality({ solvedAt: now, hints: 2 }, now) - 0.76) < 1e-9);
  assert.strictEqual(Core.attemptQuality({ solvedAt: now, hints: 5, revealed: true }, now), 0);
  assert.strictEqual(Core.attemptQuality({ startedAt: now - 1000 }, now), null);
  assert.strictEqual(Core.attemptQuality({ startedAt: now - 2 * Core.DAY_MS }, now), 0.15);
});

test("strengths blend LeetCode history with practice", () => {
  const now = Date.now();
  const tagCounts = { "dynamic-programming": 30, "two-pointers": 0, "array": 120 };
  const attempts = {
    "3sum": { topics: ["two-pointers"], startedAt: now - 10, solvedAt: now, hints: 0 },
    "valid-palindrome": { topics: ["two-pointers"], startedAt: now - 20, solvedAt: now, hints: 0 },
    "container-with-most-water": { topics: ["two-pointers"], startedAt: now - 30, solvedAt: now, hints: 0 },
    "coin-change": { topics: ["dp-1d"], startedAt: now - 5, revealed: true, hints: 5 }
  };
  const s = Object.fromEntries(Core.topicStrengths(tagCounts, attempts, now).map((t) => [t.id, t]));
  assert.strictEqual(s["arrays-hashing"].strength, 1);
  assert.strictEqual(s["two-pointers"].history, 0);
  assert.ok(s["two-pointers"].strength > 0.6, "three clean solves lift a topic with no history");
  assert.ok(s["dp-1d"].strength < 1, "revealed solution pulls a strong history down");
  assert.strictEqual(s["tries"].strength, 0);
  // No history and no attempts: unknown, neutral.
  const blank = Core.topicStrengths({}, {}, now);
  assert.ok(blank.every((t) => t.strength === 0.5 && !t.known));
});

test("assessment picks one problem per uncovered topic, least-practiced first", () => {
  const strengths = Core.topicStrengths({ "array": 100, "two-pointers": 15, "trie": 0 }, {});
  const assessment = { startedAt: 0 };
  const picks = Core.pickDaily({ strengths, assessment, count: 2 });
  assert.strictEqual(picks.length, 2);
  assert.notStrictEqual(picks[0].topicId, picks[1].topicId);
  assert.ok(picks.every((p) => p.reason === "Assessment"));
  assert.ok(!picks.some((p) => p.topicId === "arrays-hashing" || p.topicId === "two-pointers"));
  // Topic with zero history starts at Easy when it has one, else Medium.
  for (const p of picks) assert.ok(["Easy", "Medium"].includes(p.difficulty));
});

test("after assessment, picks target the weakest topics at a fitting difficulty", () => {
  const tagCounts = {};
  for (const t of TOPICS) for (const tag of t.tags) tagCounts[tag] = 1000;
  tagCounts["sliding-window"] = 0;
  tagCounts["heap-priority-queue"] = 5; // 50% of target 10 -> Medium
  const strengths = Core.topicStrengths(tagCounts, {});
  const picks = Core.pickDaily({ strengths, assessment: { startedAt: 0, completedAt: 1 }, count: 2 });
  assert.deepStrictEqual(picks.map((p) => p.topicId), ["sliding-window", "heap"]);
  assert.strictEqual(picks[0].difficulty, "Easy");
  assert.strictEqual(picks[1].difficulty, "Medium");
});

test("picks skip solved problems and never repeat", () => {
  const strengths = Core.topicStrengths({}, {});
  const exclude = new Set(["valid-palindrome", "contains-duplicate"]);
  const picks = Core.pickDaily({ strengths, exclude, count: 5 });
  const slugs = picks.map((p) => p.slug);
  assert.strictEqual(new Set(slugs).size, 5);
  assert.ok(!slugs.some((s) => exclude.has(s)));
});

test("assessment coverage needs a scored attempt after the start", () => {
  const now = Date.now();
  const attempts = {
    a: { topics: ["stack"], startedAt: now - 10, solvedAt: now },
    b: { topics: ["trees"], startedAt: now - 10 },               // pending
    c: { topics: ["heap"], startedAt: 5, solvedAt: 6 }           // before start
  };
  const cov = Core.assessmentCoverage(attempts, { startedAt: 100 }, now);
  assert.deepStrictEqual([...cov], ["stack"]);
});

test("every curated problem slug is unique per topic and difficulty is valid", () => {
  for (const t of TOPICS) {
    assert.ok(t.problems.length >= 3, t.id);
    for (const [slug, d] of t.problems) {
      assert.match(slug, /^[a-z0-9-]+$/);
      assert.ok(["Easy", "Medium", "Hard"].includes(d), slug);
    }
  }
  assert.strictEqual(new Set(TOPICS.map((t) => t.id)).size, TOPICS.length);
});

test("problems outside the curated list map to topics by tag", () => {
  assert.deepStrictEqual(Core.topicsForProblem("two-sum", []), ["arrays-hashing"]);
  assert.deepStrictEqual(Core.topicsForProblem("some-new-problem", ["trie", "string"]), ["tries"]);
});

test("warm-up ramp: Easy first week, Mediums phase in, Hards only after day 42", () => {
  const caps = (done) => Core.rampCaps(done, 2);
  for (let d = 0; d < 7; d++) assert.deepStrictEqual(caps(d), ["Easy", "Easy"], `day ${d + 1}`);
  assert.deepStrictEqual(caps(7), ["Easy", "Medium"]);   // day 8
  assert.deepStrictEqual(caps(8), ["Easy", "Easy"]);     // day 9
  assert.deepStrictEqual(caps(14), ["Easy", "Medium"]);  // day 15
  assert.deepStrictEqual(caps(27), ["Easy", "Medium"]);  // day 28
  assert.deepStrictEqual(caps(28), ["Medium", "Medium"]); // day 29
  assert.deepStrictEqual(caps(41), ["Medium", "Medium"]); // day 42
  assert.strictEqual(caps(42), null);                    // day 43: normal
  assert.match(Core.rampStage(0).label, /day 1 of 42: Easy only/);
  assert.strictEqual(Core.rampStage(42), null);
});

test("ramp caps keep picks at or below the allowed difficulty", () => {
  const tagCounts = {};
  for (const t of TOPICS) for (const tag of t.tags) tagCounts[tag] = 1000; // strong everywhere -> would pick Hard
  const strengths = Core.topicStrengths(tagCounts, {});
  const done = { startedAt: 0, completedAt: 1 };
  assert.deepStrictEqual(Core.pickDaily({ strengths, assessment: done, count: 2, caps: ["Easy", "Easy"] }).map((p) => p.difficulty), ["Easy", "Easy"]);
  assert.deepStrictEqual(Core.pickDaily({ strengths, assessment: done, count: 2, caps: ["Easy", "Medium"] }).map((p) => p.difficulty), ["Easy", "Medium"]);
  assert.ok(Core.pickDaily({ strengths, assessment: done, count: 2 }).some((p) => p.difficulty === "Hard"));
  // Assessment picks follow the caps too.
  const fresh = Core.pickDaily({ strengths: Core.topicStrengths({}, {}), assessment: { startedAt: 0 }, count: 2, caps: ["Easy", "Easy"] });
  assert.ok(fresh.every((p) => p.difficulty === "Easy" && p.reason === "Assessment"));
});

test("when every Easy is used up, the ramp steps up one level instead of skipping", () => {
  const strengths = Core.topicStrengths({}, {});
  const allEasy = new Set(TOPICS.flatMap((t) => t.problems.filter((p) => p[1] === "Easy").map((p) => p[0])));
  const picks = Core.pickDaily({ strengths, exclude: allEasy, count: 2, caps: ["Easy", "Easy"] });
  assert.deepStrictEqual(picks.map((p) => p.difficulty), ["Medium", "Medium"]);
});

test("weekday schedule picks the task type, falling back to LeetCode", () => {
  const tue = new Date(2026, 9, 13, 9).getTime(); // a Tuesday
  assert.strictEqual(Core.taskTypeFor(tue, Core.DEFAULT_SETTINGS.schedule), "design");
  assert.strictEqual(Core.taskTypeFor(new Date(2026, 9, 17, 9).getTime(), Core.DEFAULT_SETTINGS.schedule), "behavioral");
  assert.strictEqual(Core.taskTypeFor(tue, ["x", "x", "nonsense", "x", "x", "x", "x"]), "leetcode");
});

test("next lesson: first undone, low scores come back for review, then oldest", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const now = new Date(2026, 9, 14).getTime();
  const day = 864e5;
  assert.deepStrictEqual(Core.nextItem(items, {}, now), { item: items[0], review: false });
  const log = { a: [{ ts: now - 2 * day, score: 0.4 }] };
  assert.strictEqual(Core.nextItem(items, log, now, 7).item.id, "b", "too soon to review a");
  assert.deepStrictEqual(Core.nextItem(items, log, now + 6 * day, 7), { item: items[0], review: true });
  const all = { a: [{ ts: now - 3 * day, score: 0.9 }], b: [{ ts: now - 5 * day, score: 0.8 }], c: [{ ts: now - day, score: 1 }] };
  assert.deepStrictEqual(Core.nextItem(items, all, now), { item: items[1], review: true });
});

test("streaks: today not done yet keeps the current streak", () => {
  const now = new Date(2026, 9, 14, 12).getTime();
  const days = { "2026-10-10": "leetcode", "2026-10-11": "design", "2026-10-12": true, "2026-10-13": "leetcode", "2026-10-01": "leetcode", "2026-10-02": true };
  assert.deepStrictEqual(Core.streaks(days, now), { current: 4, longest: 4 });
  assert.deepStrictEqual(Core.streaks({ ...days, "2026-10-14": "behavioral" }, now), { current: 5, longest: 5 });
  assert.strictEqual(Core.streaks(days, new Date(2026, 9, 16).getTime()).current, 0);
});

test("stats: calendar, weekly totals and per-type summaries", () => {
  const now = new Date(2026, 9, 14, 18).getTime();
  const at = (d, h = 10) => new Date(2026, 9, d, h).getTime();
  const st = Core.computeStats({
    now,
    solveLog: {
      "two-sum": { ts: at(14), title: "Two Sum", difficulty: "Easy", topics: ["arrays-hashing"], hints: 0 },
      "3sum": { ts: at(12), title: "3Sum", difficulty: "Medium", topics: ["two-pointers"], hints: 2 },
      "subsets": { ts: at(12, 20), title: "Subsets", difficulty: "Medium", topics: ["backtracking"], revealed: true }
    },
    lessonLog: { caching: [{ ts: at(13), score: 0.5 }, { ts: at(14), score: 0.9 }] },
    behavioralLog: { failure: [{ ts: at(11), score: 0.7 }] },
    practiceDays: { "2026-10-11": "behavioral", "2026-10-12": "leetcode", "2026-10-13": "design", "2026-10-14": "leetcode" }
  });
  assert.strictEqual(st.calendar.length % 7, 4, "26 weeks ending on Wednesday");
  assert.strictEqual(st.calendar[0].date, "2026-04-19");
  const today = st.calendar[st.calendar.length - 1];
  assert.deepStrictEqual(today, { date: "2026-10-14", leetcode: 1, design: 1, behavioral: 0, total: 2, goalMet: true });
  assert.strictEqual(st.weekly.length, 12);
  assert.deepStrictEqual(st.weekly[11], { weekStart: "2026-10-11", leetcode: 3, design: 2, behavioral: 1 });
  assert.strictEqual(st.activity[0].title, "Two Sum");
  assert.strictEqual(st.activity.find((a) => a.type === "behavioral").title, "Tell me about a time you failed.");
  assert.deepStrictEqual({ current: st.current, longest: st.longest }, { current: 4, longest: 4 });
  const t = st.totals;
  assert.deepStrictEqual(t.byDifficulty, { Easy: 1, Medium: 2, Hard: 0 });
  assert.strictEqual(t.byTopic["two-pointers"], 1);
  assert.strictEqual(t.noHintRate, 1 / 3);
  assert.strictEqual(t.lessons, 1);
  assert.strictEqual(t.avgLessonScore, 0.7);
  assert.strictEqual(t.avgBehavioralScore, 0.7);
  assert.strictEqual(t.goalDays, 4);
  assert.strictEqual(t.last30, 4);
});

test("SQL problems: study-plan order, tagged as SQL, skipped once solved", () => {
  assert.strictEqual(Core.taskTypeFor(new Date(2026, 9, 16, 9).getTime(), Core.DEFAULT_SETTINGS.schedule), "sql");
  const first = Core.nextSqlPick(new Set());
  assert.deepStrictEqual(first, { slug: "recyclable-and-low-fat-products", difficulty: "Easy", topicId: "sql", topicName: "SQL & Databases", reason: "Select" });
  assert.strictEqual(Core.nextSqlPick(new Set([first.slug])).slug, "find-customer-referee");
  assert.deepStrictEqual(Core.topicsForProblem("big-countries"), ["sql"]);
  assert.deepStrictEqual(Core.topicsForProblem("some-other-sql", ["database"]), ["sql"]);
  assert.ok(Core.isSqlProblem("second-highest-salary") && !Core.isSqlProblem("two-sum"));
  const { SQL_PROBLEMS } = require("../lib/curriculum.js");
  assert.strictEqual(SQL_PROBLEMS.length, 50);
  assert.strictEqual(new Set(SQL_PROBLEMS.map((p) => p.slug)).size, 50);
});
