// Pure logic shared by the background page, extension pages, and tests:
// dates, site matching, daily progress, topic strength scoring, and daily picks.
(function (root) {
  const NODE = typeof module !== "undefined" && module.exports;
  const TOPICS = NODE ? require("./topics.js").TOPICS : root.TOPICS;
  const { DESIGN_LESSONS, BEHAVIORAL, SQL_PROBLEMS } = NODE ? require("./curriculum.js") : root;
  const SQL_SLUGS = new Set(SQL_PROBLEMS.map((p) => p.slug));
  const SQL_TOPIC = { id: "sql", name: "SQL & Databases" };

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DIFFICULTY_ORDER = ["Easy", "Medium", "Hard"];

  const DEFAULT_SETTINGS = {
    username: "",
    // "claudecode": ask Claude Code on this computer through the native bridge;
    // "claudeai": open claude.ai with a ready prompt; "api": call the API with apiKey
    helpMode: "claudecode",
    apiKey: "",
    model: "claude-opus-5-5",
    dailyGoal: 1,
    // What today's task is, by weekday (0 = Sunday): LeetCode, a system design
    // lesson with a quiz, or a behavioral / communication question.
    schedule: ["leetcode", "leetcode", "design", "leetcode", "design", "sql", "behavioral"],
    hintsBeforeSolution: 5,
    countRevealedSolutions: false,
    rampUp: true, // start Easy and slowly add harder problems (see rampCaps)
    autocomplete: true, // suggestions while typing in LeetCode's editor (content/autocomplete.js)
    blockedSites: [
      "youtube.com", "reddit.com", "twitter.com", "x.com", "instagram.com",
      "facebook.com", "tiktok.com", "twitch.tv", "netflix.com"
    ]
  };

  function pad(n) { return String(n).padStart(2, "0"); }

  function dateKey(now = Date.now()) {
    const d = new Date(now);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function startOfDay(now = Date.now()) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // "https://www.YouTube.com/watch" -> "youtube.com"; "*.reddit.com" -> "reddit.com"
  function normalizeSite(entry) {
    let s = String(entry || "").trim().toLowerCase();
    if (!s || s.startsWith("#")) return "";
    s = s.replace(/^[a-z]+:\/\//, "").replace(/^\*\./, "").replace(/^www\./, "");
    s = s.split(/[/?#:]/)[0];
    return s;
  }

  function parseSiteList(text) {
    const list = Array.isArray(text) ? text : String(text || "").split(/[\n,]+/);
    return [...new Set(list.map(normalizeSite).filter(Boolean))];
  }

  function isBlockedUrl(url, sites) {
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "leetcode.com" || host.endsWith(".leetcode.com")) return false;
    return sites.some((d) => host === d || host.endsWith("." + d));
  }

  // Slugs that count toward today's goal. Sources: LeetCode's accepted list
  // (timestamps in seconds) and accepts the content script saw directly (ms).
  function solvedTodaySlugs({ acList = [], localAccepts = {}, revealed = {}, countRevealed = false, now = Date.now() }) {
    const start = startOfDay(now);
    const slugs = new Set();
    for (const s of acList) {
      if (Number(s.timestamp) * 1000 >= start) slugs.add(s.titleSlug);
    }
    for (const [slug, ts] of Object.entries(localAccepts)) {
      if (ts >= start) slugs.add(slug);
    }
    if (!countRevealed) {
      for (const slug of Object.keys(revealed)) slugs.delete(slug);
    }
    return [...slugs];
  }

  const SLUG_TOPIC = {};
  for (const t of TOPICS) for (const [slug] of t.problems) (SLUG_TOPIC[slug] ||= []).push(t.id);

  function topicsForProblem(slug, tagSlugs = []) {
    if (SQL_SLUGS.has(slug) || tagSlugs.includes("database")) return [SQL_TOPIC.id];
    if (SLUG_TOPIC[slug]) return SLUG_TOPIC[slug].slice(0, 1);
    const ids = TOPICS.filter((t) => t.tags.some((tag) => tagSlugs.includes(tag))).map((t) => t.id);
    return [...new Set(ids)];
  }

  // 0..1 score for one attempt. Pending attempts don't score until a day has passed.
  function attemptQuality(a, now = Date.now()) {
    if (a.revealed) return 0;
    const helpUsed = (a.hints || 0) + 0.5 * (a.questions || 0);
    if (a.solvedAt) return Math.max(0.2, 1 - 0.12 * helpUsed);
    if (now - (a.startedAt || now) > DAY_MS) return 0.15;
    return null;
  }

  // tagCounts: { tagSlug: problemsSolved } from LeetCode. attempts: { slug: attempt }.
  function topicStrengths(tagCounts = {}, attempts = {}, now = Date.now()) {
    const hasHistory = Object.keys(tagCounts).length > 0;
    const all = Object.values(attempts);
    return TOPICS.map((t) => {
      const solved = Math.max(0, ...t.tags.map((tag) => tagCounts[tag] || 0));
      const history = hasHistory ? Math.min(1, solved / t.target) : null;
      const scored = all
        .filter((a) => (a.topics || []).includes(t.id))
        .map((a) => ({ a, q: attemptQuality(a, now) }))
        .filter((x) => x.q !== null)
        .sort((x, y) => (y.a.startedAt || 0) - (x.a.startedAt || 0))
        .slice(0, 6);
      const practice = scored.length ? scored.reduce((s, x) => s + x.q, 0) / scored.length : null;
      let strength;
      if (practice === null) strength = history === null ? 0.5 : history;
      else if (history === null) strength = practice;
      else {
        const w = Math.min(1, scored.length / 3) * 0.7;
        strength = (1 - w) * history + w * practice;
      }
      return {
        id: t.id, name: t.name, solvedOnLeetCode: hasHistory ? solved : null,
        history, practice, attemptsScored: scored.length,
        strength: Math.round(strength * 100) / 100,
        known: history !== null || practice !== null
      };
    });
  }

  function assessmentCoverage(attempts = {}, assessment, now = Date.now()) {
    const covered = new Set();
    if (!assessment) return covered;
    for (const a of Object.values(attempts)) {
      if ((a.startedAt || 0) < assessment.startedAt) continue;
      if (attemptQuality(a, now) === null) continue;
      for (const id of a.topics || []) covered.add(id);
    }
    return covered;
  }

  function targetDifficulty(strength) {
    if (strength < 0.35) return "Easy";
    if (strength < 0.7) return "Medium";
    return "Hard";
  }

  // Picks the problem in a topic closest to the wanted difficulty, skipping done
  // ones and anything harder than `cap` when a cap is given.
  function pickProblem(topic, wanted, exclude, cap = null) {
    const ci = cap ? DIFFICULTY_ORDER.indexOf(cap) : 2;
    const open = topic.problems.filter(([slug, d]) => !exclude.has(slug) && DIFFICULTY_ORDER.indexOf(d) <= ci);
    if (!open.length) return null;
    const wi = DIFFICULTY_ORDER.indexOf(wanted);
    open.sort((a, b) =>
      Math.abs(DIFFICULTY_ORDER.indexOf(a[1]) - wi) - Math.abs(DIFFICULTY_ORDER.indexOf(b[1]) - wi));
    return { slug: open[0][0], difficulty: open[0][1] };
  }

  // Warm-up ramp. Given how many LeetCode days the goal has been met since the
  // ramp started, returns the hardest difficulty allowed for each of today's
  // picks, or null once the ramp is over. The share of Medium picks grows:
  //   days 1-7:   0% (all Easy)
  //   days 8-14:  25%
  //   days 15-28: 50%
  //   days 29-42: 100% Medium
  //   day 43+:    no cap, normal difficulty
  // Mediums are spread evenly across days, so with one problem a day a 50%
  // share means a Medium every other day.
  const RAMP_DAYS = 42;
  function mediumShare(day) {
    if (day <= 7) return 0;
    if (day <= 14) return 0.25;
    if (day <= 28) return 0.5;
    return 1;
  }
  function rampCaps(daysDone, count) {
    const day = daysDone + 1;
    if (day > RAMP_DAYS) return null;
    const share = mediumShare(day);
    // Mediums owed by the end of today minus those owed by the end of yesterday.
    const nMedium = Math.min(count, Math.floor(day * count * share + 1e-9) - Math.floor((day - 1) * count * share + 1e-9));
    return Array.from({ length: count }, (_, i) => (i >= count - nMedium ? "Medium" : "Easy"));
  }

  function rampStage(daysDone) {
    const day = daysDone + 1;
    if (day <= 7) return { day, label: `Warm-up day ${day} of ${RAMP_DAYS}: Easy only (Mediums start on day 8)` };
    if (day <= 14) return { day, label: `Warm-up day ${day} of ${RAMP_DAYS}: mostly Easy, an occasional Medium` };
    if (day <= 28) return { day, label: `Warm-up day ${day} of ${RAMP_DAYS}: half Easy, half Medium` };
    if (day <= RAMP_DAYS) return { day, label: `Warm-up day ${day} of ${RAMP_DAYS}: Mediums (Hards start after day ${RAMP_DAYS})` };
    return null;
  }

  // ---------- daily rotation ----------

  const TASK_TYPES = ["leetcode", "sql", "design", "behavioral"];
  // LeetCode and SQL days are both solved on leetcode.com.
  const isCodingType = (t) => t === "leetcode" || t === "sql";
  const isSqlProblem = (slug) => SQL_SLUGS.has(slug);

  // Next SQL problem in study-plan order that isn't excluded.
  function nextSqlPick(exclude = new Set()) {
    const p = SQL_PROBLEMS.find((x) => !exclude.has(x.slug));
    return p ? { slug: p.slug, difficulty: p.difficulty, topicId: SQL_TOPIC.id, topicName: SQL_TOPIC.name, reason: p.group } : null;
  }
  function taskTypeFor(now, schedule) {
    const t = (schedule || DEFAULT_SETTINGS.schedule)[new Date(now).getDay()];
    return TASK_TYPES.includes(t) ? t : "leetcode";
  }

  // Next item from an ordered list. Items scored below 60% come back for review
  // after `reviewDays`; otherwise the first never-done item; once everything is
  // done, the least recently practiced one.
  function nextItem(items, log = {}, now = Date.now(), reviewDays = 7) {
    const last = (id) => (log[id] && log[id].length ? log[id][log[id].length - 1] : null);
    const review = items.find((it) => {
      const l = last(it.id);
      return l && l.score < 0.6 && now - l.ts >= reviewDays * DAY_MS;
    });
    if (review) return { item: review, review: true };
    const fresh = items.find((it) => !last(it.id));
    if (fresh) return { item: fresh, review: false };
    const oldest = items.slice().sort((a, b) => last(a.id).ts - last(b.id).ts)[0];
    return { item: oldest, review: true };
  }
  const nextLesson = (log, now) => nextItem(DESIGN_LESSONS, log, now, 7);
  const nextBehavioral = (log, now) => nextItem(BEHAVIORAL, log, now, 5);

  // ---------- statistics ----------

  function addDays(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    return dateKey(new Date(y, m - 1, d + n).getTime());
  }

  // Current and longest run of consecutive goal days. Today not being done yet
  // doesn't break the current streak.
  function streaks(practiceDays = {}, now = Date.now()) {
    const days = Object.keys(practiceDays).filter((d) => practiceDays[d]).sort();
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const d of days) {
      run = prev && addDays(prev, 1) === d ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = d;
    }
    const today = dateKey(now);
    let cursor = practiceDays[today] ? today : addDays(today, -1);
    let current = 0;
    while (practiceDays[cursor]) { current++; cursor = addDays(cursor, -1); }
    return { current, longest };
  }

  // Everything the stats page shows, from the stored logs.
  //   solveLog:      { slug: { ts, title, difficulty, topics, hints, revealed } }
  //   lessonLog:     { lessonId: [{ ts, score }] }
  //   behavioralLog: { questionId: [{ ts, score }] }
  function computeStats({ solveLog = {}, lessonLog = {}, behavioralLog = {}, practiceDays = {}, now = Date.now(), weeks = 26 }) {
    const activity = [];
    for (const [slug, e] of Object.entries(solveLog)) {
      activity.push({ type: "leetcode", ts: e.ts, id: slug, title: e.title || slug, difficulty: e.difficulty || "", topics: e.topics || [], hints: e.hints || 0, revealed: !!e.revealed });
    }
    const titleOf = (list, id, field) => (list.find((x) => x.id === id) || {})[field] || id;
    for (const [id, entries] of Object.entries(lessonLog)) {
      for (const e of entries) activity.push({ type: "design", ts: e.ts, id, title: titleOf(DESIGN_LESSONS, id, "title"), score: e.score });
    }
    for (const [id, entries] of Object.entries(behavioralLog)) {
      for (const e of entries) activity.push({ type: "behavioral", ts: e.ts, id, title: titleOf(BEHAVIORAL, id, "question"), score: e.score });
    }
    activity.sort((a, b) => b.ts - a.ts);

    // Calendar: the last `weeks` full weeks ending this week, Sunday first.
    const today = dateKey(now);
    const start = addDays(today, -(new Date(now).getDay() + 7 * (weeks - 1)));
    const byDay = {};
    for (const a of activity) {
      const k = dateKey(a.ts);
      if (k >= start) (byDay[k] ||= { leetcode: 0, design: 0, behavioral: 0 })[a.type]++;
    }
    const calendar = [];
    for (let k = start; k <= today; k = addDays(k, 1)) {
      const c = byDay[k] || { leetcode: 0, design: 0, behavioral: 0 };
      calendar.push({ date: k, ...c, total: c.leetcode + c.design + c.behavioral, goalMet: !!practiceDays[k] });
    }

    // Activities per week for the last 12 weeks.
    const weekly = [];
    for (let w = 11; w >= 0; w--) {
      const ws = addDays(today, -(new Date(now).getDay() + 7 * w));
      const we = addDays(ws, 6);
      const items = activity.filter((a) => { const k = dateKey(a.ts); return k >= ws && k <= we; });
      weekly.push({ weekStart: ws, leetcode: items.filter((a) => a.type === "leetcode").length, design: items.filter((a) => a.type === "design").length, behavioral: items.filter((a) => a.type === "behavioral").length });
    }

    const solves = activity.filter((a) => a.type === "leetcode");
    const byDifficulty = { Easy: 0, Medium: 0, Hard: 0 };
    for (const a of solves) if (byDifficulty[a.difficulty] !== undefined) byDifficulty[a.difficulty]++;
    const byTopic = {};
    for (const a of solves) for (const t of a.topics) byTopic[t] = (byTopic[t] || 0) + 1;
    const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const noHint = solves.filter((a) => !a.hints && !a.revealed).length;
    const lessonScores = activity.filter((a) => a.type === "design").map((a) => a.score);
    const behavioralScores = activity.filter((a) => a.type === "behavioral").map((a) => a.score);
    const goalDays = Object.keys(practiceDays).filter((d) => practiceDays[d]);
    const last30 = goalDays.filter((d) => d > addDays(today, -30)).length;
    return {
      calendar, weekly, activity: activity.slice(0, 100), ...streaks(practiceDays, now),
      totals: {
        solved: solves.length, byDifficulty, byTopic,
        noHintRate: solves.length ? noHint / solves.length : null,
        lessons: new Set(activity.filter((a) => a.type === "design").map((a) => a.id)).size,
        lessonsTotal: DESIGN_LESSONS.length,
        avgLessonScore: avg(lessonScores),
        behavioral: behavioralScores.length,
        avgBehavioralScore: avg(behavioralScores),
        goalDays: goalDays.length,
        last30
      }
    };
  }

  // Returns `count` picks. During an assessment, one per uncovered topic (weakest
  // history first); afterwards, the weakest topics by blended strength.
  // `caps` (from rampCaps) limits each pick's difficulty and sets its target.
  function pickDaily({ strengths, exclude = new Set(), assessment = null, covered = new Set(), count = 2, avoidTopics = [], caps = null }) {
    const byId = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
    const picks = [];
    const used = new Set(exclude);
    const usedTopics = new Set();
    let ordered;
    const inAssessment = assessment && !assessment.completedAt;
    if (inAssessment) {
      ordered = strengths.filter((s) => !covered.has(s.id))
        .sort((a, b) => (a.history ?? -1) - (b.history ?? -1));
    } else {
      ordered = strengths.slice().sort((a, b) =>
        (a.strength + (avoidTopics.includes(a.id) ? 0.15 : 0)) -
        (b.strength + (avoidTopics.includes(b.id) ? 0.15 : 0)));
    }
    for (let slot = 0; slot < count; slot++) {
      if (!fillSlot(caps ? caps[slot] : null) && caps) {
        // Nothing left at this cap: allow one step harder rather than skip the pick.
        fillSlot(DIFFICULTY_ORDER[Math.min(2, DIFFICULTY_ORDER.indexOf(caps[slot]) + 1)]);
      }
    }
    function fillSlot(cap) {
      for (const s of ordered) {
        if (usedTopics.has(s.id)) continue;
        let wanted = inAssessment ? (s.history !== null && s.history < 0.3 ? "Easy" : "Medium") : targetDifficulty(s.strength);
        if (cap) wanted = cap;
        const p = pickProblem(byId[s.id], wanted, used, cap);
        if (!p) continue;
        used.add(p.slug);
        usedTopics.add(s.id);
        picks.push({
          ...p, topicId: s.id, topicName: s.name,
          reason: inAssessment ? "Assessment" : `Weak area (${Math.round(s.strength * 100)}%)`
        });
        return true;
      }
      return false;
    }
    // Assessment nearly done or topics exhausted: top up from the weakest topics.
    if (picks.length < count && inAssessment) {
      const rest = caps ? caps.slice(picks.length) : null;
      return picks.concat(pickDaily({ strengths, exclude: used, count: count - picks.length, avoidTopics, caps: rest }));
    }
    return picks;
  }

  const api = {
    DAY_MS, DEFAULT_SETTINGS, dateKey, startOfDay, normalizeSite, parseSiteList, isBlockedUrl,
    solvedTodaySlugs, topicsForProblem, attemptQuality, topicStrengths, assessmentCoverage,
    targetDifficulty, pickProblem, pickDaily, rampCaps, rampStage, RAMP_DAYS,
    TASK_TYPES, isCodingType, isSqlProblem, nextSqlPick, SQL_TOPIC, taskTypeFor, nextItem, nextLesson, nextBehavioral, addDays, streaks, computeStats
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Core = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
