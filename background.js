/* global Core, LeetCode, Claude, TOPICS, DESIGN_LESSONS, BEHAVIORAL */
// Background event page: syncs solves from LeetCode, blocks sites until the
// daily goal is met, picks problems from weak topics, and talks to Claude.

const SYNC_ALARM = "sync";
const STORAGE_DEFAULTS = {
  settings: Core.DEFAULT_SETTINGS,
  acList: [],
  localAccepts: {},
  revealed: {},
  attempts: {},
  knownSolved: {},
  profile: null,
  assessment: null,
  daily: null,
  convos: {},
  lastSync: 0,
  syncError: "",
  resolvedUsername: "",
  practiceDays: {},   // { "YYYY-MM-DD": task type } for each day the goal was met
  rampStartedAt: 0,
  solveLog: {},       // { slug: { ts, title, difficulty, topics } } first accepted solve
  lessonLog: {},      // { lessonId: [{ ts, score }] } graded system design quizzes
  behavioralLog: {},  // { questionId: [{ ts, score }] } graded behavioral answers
  learnSessions: {},  // "design:<id>" / "behavioral:<id>" -> lesson text, answers, grade, Claude conversation
  gameGuard: null,    // last report to the game blocker: { at, enabled, done, guard, error }
  migrations: {}
};

const PROGRESS_KEYS = ["settings", "acList", "localAccepts", "revealed", "lessonLog", "behavioralLog"];

async function load(keys = Object.keys(STORAGE_DEFAULTS)) {
  const defaults = {};
  for (const k of keys) defaults[k] = STORAGE_DEFAULTS[k];
  const data = await browser.storage.local.get(defaults);
  data.settings && (data.settings = { ...Core.DEFAULT_SETTINGS, ...data.settings });
  return data;
}

function save(patch) {
  return browser.storage.local.set(patch);
}

// ---------- progress ----------

// Today's task type comes from the weekday schedule. LeetCode days need
// `dailyGoal` accepted problems; design and behavioral days need one graded quiz
// or answer.
function progressFrom(s) {
  const type = Core.taskTypeFor(Date.now(), s.settings.schedule);
  const solved = Core.solvedTodaySlugs({
    acList: s.acList,
    localAccepts: s.localAccepts,
    revealed: s.revealed,
    countRevealed: s.settings.countRevealedSolutions
  });
  const start = Core.startOfDay();
  const doneToday = (log) => Object.values(log || {}).flat().filter((e) => e.ts >= start).length;
  const designToday = doneToday(s.lessonLog);
  const behavioralToday = doneToday(s.behavioralLog);
  const goal = type === "leetcode" ? Math.max(1, Number(s.settings.dailyGoal) || 1) : 1;
  // SQL days need a database problem; LeetCode days count any accepted problem.
  const count = type === "leetcode" ? solved.length
    : type === "sql" ? solved.filter(Core.isSqlProblem).length
    : type === "design" ? designToday : behavioralToday;
  return { type, solved, designToday, behavioralToday, count, goal, done: count >= goal };
}

async function updateBadge() {
  const s = await load(PROGRESS_KEYS);
  const p = progressFrom(s);
  await browser.action.setBadgeText({ text: p.done ? "✓" : `${Math.min(p.count, p.goal)}/${p.goal}` });
  await browser.action.setBadgeBackgroundColor({ color: p.done ? "#2e7d32" : "#c62828" });
  return p;
}

// ---------- LeetCode sync ----------

async function resolveUsername(settings) {
  if (settings.username) return settings.username.trim();
  return LeetCode.currentUser();
}

async function sync({ forceProfile = false } = {}) {
  const s = await load();
  let username = "";
  try {
    username = await resolveUsername(s.settings);
    if (!username) {
      await save({ syncError: "Sign in to leetcode.com, or set your LeetCode username in settings.", lastSync: Date.now() });
      await afterStateChange();
      return;
    }
    const acList = await LeetCode.recentAccepted(username, 20);
    const patch = { acList, lastSync: Date.now(), syncError: "", resolvedUsername: username };
    const stale = !s.profile || Date.now() - s.profile.fetchedAt > 12 * 60 * 60 * 1000;
    if (forceProfile || stale || (s.profile && s.profile.username !== username)) {
      const prof = await LeetCode.skillProfile(username);
      patch.profile = { ...prof, username, fetchedAt: Date.now() };
    }
    // Re-read after the network calls so hints or accepts recorded meanwhile aren't overwritten.
    const fresh = await load(["knownSolved", "attempts"]);
    const knownSolved = { ...fresh.knownSolved };
    const attempts = { ...fresh.attempts };
    for (const sub of acList) {
      knownSolved[sub.titleSlug] = true;
      const a = attempts[sub.titleSlug];
      if (a && !a.solvedAt && Number(sub.timestamp) * 1000 >= (a.startedAt || 0) - 60000) {
        attempts[sub.titleSlug] = { ...a, solvedAt: Number(sub.timestamp) * 1000 };
      }
    }
    Object.assign(patch, { knownSolved, attempts });
    await save(patch);
    // Record first-solve times for the stats page.
    const { solveLog } = await load(["solveLog"]);
    for (const sub of acList) {
      if (solveLog[sub.titleSlug]) continue;
      let q = null;
      try { q = await LeetCode.question(sub.titleSlug); } catch { /* keep what we have */ }
      await logSolve(sub.titleSlug, Number(sub.timestamp) * 1000, {
        title: sub.title, difficulty: q ? q.difficulty : "",
        topics: Core.topicsForProblem(sub.titleSlug, q ? q.topicTags.map((t) => t.slug) : [])
      });
    }
    await save(patch);
  } catch (e) {
    await save({ syncError: `Couldn't reach LeetCode: ${e.message}`, lastSync: Date.now() });
  }
  await afterStateChange();
}

// ---------- assessment & daily picks ----------

function strengthsFrom(s) {
  return Core.topicStrengths(s.profile ? s.profile.tagCounts : {}, s.attempts);
}

async function maybeCompleteAssessment(s) {
  if (!s.assessment || s.assessment.completedAt) return s.assessment;
  const covered = Core.assessmentCoverage(s.attempts, s.assessment);
  if (covered.size >= TOPICS.length) {
    const assessment = { ...s.assessment, completedAt: Date.now() };
    await save({ assessment });
    return assessment;
  }
  return s.assessment;
}

// LeetCode days the goal was met since the warm-up ramp started, not counting today.
function rampDaysDone(s) {
  const start = Core.dateKey(s.rampStartedAt || Date.now());
  const today = Core.dateKey();
  return Object.entries(s.practiceDays || {})
    .filter(([d, t]) => d >= start && d < today && (t === true || t === "leetcode")).length;
}

// Today's difficulty caps for the picks still to choose, after removing the
// ones already used by picks we keep (e.g. on a swap).
function rampCapsFor(s, goal, keep) {
  if (!s.settings.rampUp) return null;
  const caps = Core.rampCaps(rampDaysDone(s), goal);
  if (!caps) return null;
  for (const k of keep) {
    const i = caps.indexOf(k.difficulty);
    caps.splice(i >= 0 ? i : 0, 1);
  }
  return caps;
}

async function generatePicks(s, { keep = [], avoid = [] } = {}) {
  const exclude = new Set([
    ...Object.keys(s.knownSolved), ...Object.keys(s.attempts), ...Object.keys(s.revealed), ...avoid,
    ...keep.map((p) => p.slug)
  ]);
  const strengths = strengthsFrom(s);
  const covered = Core.assessmentCoverage(s.attempts, s.assessment);
  const avoidTopics = s.daily && s.daily.picks && s.daily.date !== Core.dateKey() ? s.daily.picks.map((p) => p.topicId) : [];
  const goal = Math.max(1, Number(s.settings.dailyGoal) || 2);
  const knownSolved = { ...s.knownSolved };
  let picks = [];
  if (s.settings.rampUp && !s.rampStartedAt) {
    s.rampStartedAt = Date.now();
    await save({ rampStartedAt: s.rampStartedAt });
  }
  const caps = rampCapsFor(s, goal, keep);
  // Skip problems LeetCode already marks as solved (works when signed in).
  for (let round = 0; round < 4 && picks.length < goal - keep.length; round++) {
    const batch = Core.pickDaily({
      strengths, exclude, assessment: s.assessment, covered, avoidTopics,
      count: goal - keep.length - picks.length,
      caps: caps ? caps.slice(picks.length) : null
    });
    if (!batch.length) break;
    for (const p of batch) {
      exclude.add(p.slug);
      let status = null;
      try { status = (await LeetCode.question(p.slug) || {}).status; } catch { /* offline: keep it */ }
      if (status === "ac") knownSolved[p.slug] = true;
      else picks.push(p);
    }
  }
  await save({ knownSolved });
  return keep.concat(picks);
}

// Next unsolved SQL problem in study-plan order (one a day).
async function generateSqlPicks(s, { avoid = [] } = {}) {
  const exclude = new Set([...Object.keys(s.knownSolved), ...Object.keys(s.attempts), ...Object.keys(s.revealed), ...avoid]);
  const knownSolved = { ...s.knownSolved };
  let pick = null;
  for (let round = 0; round < 6 && !pick; round++) {
    const p = Core.nextSqlPick(exclude);
    if (!p) break;
    exclude.add(p.slug);
    let status = null;
    try { status = (await LeetCode.question(p.slug) || {}).status; } catch { /* offline: keep it */ }
    if (status === "ac") knownSolved[p.slug] = true;
    else pick = p;
  }
  await save({ knownSolved });
  return pick ? [pick] : [];
}

async function ensureDaily() {
  const s = await load();
  const type = Core.taskTypeFor(Date.now(), s.settings.schedule);
  if (s.daily && s.daily.date === Core.dateKey() && s.daily.type === type) return s.daily;
  let daily;
  if (type === "leetcode") {
    daily = { date: Core.dateKey(), type, picks: await generatePicks(s) };
  } else if (type === "sql") {
    daily = { date: Core.dateKey(), type, picks: await generateSqlPicks(s) };
  } else {
    const { item, review } = type === "design" ? Core.nextLesson(s.lessonLog) : Core.nextBehavioral(s.behavioralLog);
    // Keep yesterday's LeetCode topics so tomorrow's picks can avoid repeating them.
    daily = { date: Core.dateKey(), type, itemId: item.id, review, picks: s.daily && s.daily.picks ? s.daily.picks : [] };
  }
  await save({ daily });
  return daily;
}

async function startAssessment() {
  await save({ assessment: { startedAt: Date.now(), completedAt: null }, daily: null });
  await sync({ forceProfile: true });
  await ensureDaily();
}

async function swapPick(slug) {
  const s = await load();
  if (!s.daily) return;
  if (!s.daily || !Core.isCodingType(s.daily.type)) return;
  if (s.daily.type === "sql") {
    const picks = await generateSqlPicks(s, { avoid: [slug, ...s.daily.picks.map((p) => p.slug)] });
    if (picks.length) await save({ daily: { ...s.daily, picks } });
    return;
  }
  const keep = s.daily.picks.filter((p) => p.slug !== slug);
  const picks = await generatePicks(s, { keep, avoid: [slug] });
  await save({ daily: { ...s.daily, picks } });
}

// ---------- blocking ----------

async function shouldBlock(url) {
  const s = await load(PROGRESS_KEYS);
  if (progressFrom(s).done) return false;
  return Core.isBlockedUrl(url, Core.parseSiteList(s.settings.blockedSites));
}

function blockedPageUrl(target) {
  return browser.runtime.getURL(`pages/blocked.html?u=${encodeURIComponent(target)}`);
}

// The bridge's game blocker opens this leetcode.com address after closing a
// game (native/gameguard.js taskPageUrl); show today's task instead.
const TASK_PAGE_MARKER = "lcdl-game";

function gamePageFor(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== "leetcode.com" || !u.searchParams.has(TASK_PAGE_MARKER)) return null;
  return browser.runtime.getURL(`pages/blocked.html?g=${encodeURIComponent(u.searchParams.get(TASK_PAGE_MARKER) || "Games")}`);
}

browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const gamePage = gamePageFor(details.url);
  if (gamePage) {
    browser.tabs.update(details.tabId, { url: gamePage });
    return;
  }
  if (await shouldBlock(details.url)) {
    browser.tabs.update(details.tabId, { url: blockedPageUrl(details.url) });
  }
});

// Catches tabs that were already open when the day rolled over or the extension loaded.
async function sweepTabs() {
  const tabs = await browser.tabs.query({});
  for (const t of tabs) {
    if (t.url && await shouldBlock(t.url)) browser.tabs.update(t.id, { url: blockedPageUrl(t.url) });
  }
}

async function afterStateChange() {
  const s = await load();
  await maybeCompleteAssessment(s);
  const p = await updateBadge();
  const today = Core.dateKey();
  if (p.done && !s.practiceDays[today]) await save({ practiceDays: { ...s.practiceDays, [today]: p.type } });
  if (!p.done) await sweepTabs();
  await reportGames(s.settings, p, s.gameGuard);
}

// Tells the bridge's game blocker whether games are allowed today. Sent on
// every sync too, which also restarts the blocker if it was closed. Once
// blocking is off, one last report tells the blocker to stand down.
async function reportGames(settings, p, last) {
  const enabled = !!settings.blockGames;
  if (!enabled && !(last && last.enabled)) return;
  const report = { at: Date.now(), enabled, done: p.done };
  try {
    const r = await nativeCall({ type: "games", date: Core.dateKey(), done: p.done, enabled, processes: Core.parseGameList(settings.blockedGames) });
    report.guard = r.guard || "";
  } catch (e) {
    report.error = e.message;
  }
  await save({ gameGuard: report });
}

// ---------- help (Claude) ----------

function htmlToText(html) {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "</p>\n"), "text/html");
    return doc.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return html.replace(/<[^>]+>/g, "");
  }
}

async function ensureProblemSession(slug, s) {
  const attempts = { ...s.attempts };
  const convos = { ...s.convos };
  if (!attempts[slug] || !convos[slug]) {
    let q = null;
    try { q = await LeetCode.question(slug); } catch { /* use slug as title */ }
    const tags = q ? q.topicTags.map((t) => t.slug) : [];
    if (!attempts[slug]) {
      attempts[slug] = {
        slug, title: q ? q.title : slug, difficulty: q ? q.difficulty : "",
        topics: Core.topicsForProblem(slug, tags),
        startedAt: Date.now(), hints: 0, questions: 0, revealed: false, solvedAt: null
      };
    }
    if (!convos[slug]) {
      const weakTopics = strengthsFrom(s).sort((a, b) => a.strength - b.strength).slice(0, 3).map((t) => t.name);
      convos[slug] = {
        system: Claude.buildSystemPrompt({
          problem: {
            frontendId: q && q.questionFrontendId, title: q ? q.title : slug, difficulty: q && q.difficulty,
            tags: q ? q.topicTags.map((t) => t.name) : [], statement: q ? htmlToText(q.content) : ""
          },
          weakTopics,
          hintsBeforeSolution: s.settings.hintsBeforeSolution
        }),
        messages: [],
        transcript: [],
        updatedAt: Date.now()
      };
    }
  }
  // Keep only the 40 most recent conversations.
  const slugs = Object.keys(convos).sort((a, b) => convos[b].updatedAt - convos[a].updatedAt);
  for (const old of slugs.slice(40)) delete convos[old];
  return { attempts, convos };
}

function sessionView(slug, s) {
  const a = s.attempts[slug];
  const c = s.convos[slug];
  const need = Number(s.settings.hintsBeforeSolution) || 5;
  return {
    slug,
    hints: a ? a.hints : 0,
    hintsBeforeSolution: need,
    canReveal: !!a && (a.hints >= need),
    revealed: !!(a && a.revealed),
    solved: !!(a && a.solvedAt) || !!s.localAccepts[slug],
    transcript: c ? c.transcript : [],
    hasApiKey: !!s.settings.apiKey,
    helpMode: s.settings.helpMode,
    countRevealed: !!s.settings.countRevealedSolutions
  };
}

async function help({ slug, kind, text, code, language }) {
  let s = await load();
  const need = Number(s.settings.hintsBeforeSolution) || 5;
  const { attempts, convos } = await ensureProblemSession(slug, s);
  await save({ attempts, convos });
  const attempt = attempts[slug];
  const convo = convos[slug];
  if (kind === "solution" && attempt.hints < need) {
    throw new Error(`Use ${need - attempt.hints} more hint(s) before the solution unlocks.`);
  }
  const turn = Claude.userTurn({
    kind, hintNumber: attempt.hints + 1, hintsBeforeSolution: need, text, code, language
  });
  const messages = convo.messages.concat([turn]);
  let answer;
  let assistantMessage = null;
  let claudeSessionId = convo.claudeSessionId || null;
  if (s.settings.helpMode === "claudecode") {
    ({ text: answer, sessionId: claudeSessionId } = await askClaudeCode({
      system: convo.system, turn, sessionId: claudeSessionId, hintsAlreadyUsed: attempt.hints
    }));
  } else {
    const effort = kind === "solution" ? "high" : "medium";
    ({ text: answer, assistantMessage } = await Claude.send({
      apiKey: s.settings.apiKey, model: s.settings.model, system: convo.system, messages, effort
    }));
  }

  // Reload so a sync that ran during the API call isn't overwritten.
  s = await load();
  const a = { ...s.attempts[slug] };
  if (kind === "hint") a.hints = (a.hints || 0) + 1;
  if (kind === "question") a.questions = (a.questions || 0) + 1;
  const revealed = { ...s.revealed };
  if (kind === "solution") { a.revealed = true; revealed[slug] = Date.now(); }
  const c = { ...s.convos[slug] };
  if (assistantMessage) c.messages = messages.concat([assistantMessage]);
  if (claudeSessionId) c.claudeSessionId = claudeSessionId;
  const label = kind === "hint" ? `Hint ${a.hints}` : kind === "solution" ? "Solution" : "Question";
  c.transcript = (c.transcript || []).concat([
    { role: "user", label, text: kind === "question" ? text : "" },
    { role: "assistant", label, text: answer }
  ]);
  c.updatedAt = Date.now();
  await save({
    attempts: { ...s.attempts, [slug]: a },
    convos: { ...s.convos, [slug]: c },
    revealed
  });
  await afterStateChange();
  return sessionView(slug, await load());
}

// ---------- Claude Code bridge (native messaging) ----------

const NATIVE_HOST = "leetcode_daily_lock_claude";

async function nativeCall(message) {
  let r;
  try {
    r = await browser.runtime.sendNativeMessage(NATIVE_HOST, message);
  } catch (e) {
    const m = String(e && e.message || e);
    if (/no such native application|not found|access to the specified native/i.test(m)) {
      throw new Error("The Claude Code bridge isn't installed yet. Open the extension settings for the one-time setup.");
    }
    throw new Error(`Couldn't reach the Claude Code bridge: ${m}`);
  }
  if (!r || !r.ok) throw new Error((r && r.error) || "The Claude Code bridge returned nothing.");
  return r;
}

// Resumes the problem's Claude Code conversation; if it's gone, starts a new one
// that knows how many hints were already used.
async function askClaudeCode({ system, turn, sessionId, hintsAlreadyUsed }) {
  if (sessionId) {
    try {
      return await nativeCall({ type: "ask", system, prompt: turn.content, sessionId });
    } catch (e) {
      if (!/conversation|session/i.test(e.message)) throw e;
    }
  }
  const note = hintsAlreadyUsed
    ? `(I already had ${hintsAlreadyUsed} hint(s) in an earlier chat, so continue from hint ${hintsAlreadyUsed + 1}.)\n\n`
    : "";
  return nativeCall({ type: "ask", system, prompt: note + turn.content });
}

// claude.ai mode: build the prompt, count the hint, and open or focus the
// claude.ai tab for this problem. The content script copies the prompt.
// slug -> tabId of the chat opened for it, kept in session storage because the
// event page can unload between hints.
async function existingClaudeTab(slug) {
  const { claudeTabs = {} } = await browser.storage.session.get("claudeTabs");
  const id = claudeTabs[slug];
  if (id === undefined) return null;
  try {
    const tab = await browser.tabs.get(id);
    return tab.url && tab.url.startsWith("https://claude.ai/") ? tab : null;
  } catch {
    return null;
  }
}

async function handoff({ slug, kind, text, code, language }) {
  let s = await load();
  const need = Number(s.settings.hintsBeforeSolution) || 5;
  const { attempts, convos } = await ensureProblemSession(slug, s);
  const attempt = attempts[slug];
  if (kind === "solution" && attempt.hints < need) {
    throw new Error(`Use ${need - attempt.hints} more hint(s) before the solution unlocks.`);
  }
  const tab = await existingClaudeTab(slug);
  const turn = Claude.userTurn({
    kind, hintNumber: attempt.hints + 1, hintsBeforeSolution: need, text, code, language
  });
  const prompt = Claude.handoffPrompt({
    system: convos[slug].system, turn, newChat: !tab, hintsAlreadyUsed: attempt.hints
  });

  const a = { ...attempt };
  if (kind === "hint") a.hints = (a.hints || 0) + 1;
  if (kind === "question") a.questions = (a.questions || 0) + 1;
  const revealed = { ...s.revealed };
  if (kind === "solution") { a.revealed = true; revealed[slug] = Date.now(); }
  const c = { ...convos[slug] };
  const label = kind === "hint" ? `Hint ${a.hints}` : kind === "solution" ? "Solution" : "Question";
  c.transcript = (c.transcript || []).concat([
    { role: "user", label, text: kind === "question" ? text : "" },
    { role: "assistant", label, text: `${label} prompt sent to claude.ai.` }
  ]);
  c.updatedAt = Date.now();
  await save({ attempts: { ...attempts, [slug]: a }, convos: { ...convos, [slug]: c }, revealed });

  if (tab) {
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
  } else {
    const created = await browser.tabs.create({ url: "https://claude.ai/new" });
    const { claudeTabs = {} } = await browser.storage.session.get("claudeTabs");
    await browser.storage.session.set({ claudeTabs: { ...claudeTabs, [slug]: created.id } });
  }
  await afterStateChange();
  return { prompt, newChat: !tab, session: sessionView(slug, await load()) };
}

async function markAccepted(slug, title) {
  const s = await load();
  const localAccepts = { ...s.localAccepts, [slug]: Date.now() };
  const knownSolved = { ...s.knownSolved, [slug]: true };
  const attempts = { ...s.attempts };
  let q = null;
  if (!attempts[slug] || !s.solveLog[slug]) {
    try { q = await LeetCode.question(slug); } catch { /* ignore */ }
  }
  const tags = q ? q.topicTags.map((t) => t.slug) : [];
  if (!attempts[slug]) {
    attempts[slug] = {
      slug, title: (q && q.title) || title || slug, difficulty: q ? q.difficulty : "", topics: Core.topicsForProblem(slug, tags),
      startedAt: Date.now(), hints: 0, questions: 0, revealed: false, solvedAt: null
    };
  }
  if (!s.solveLog[slug]) {
    await logSolve(slug, Date.now(), {
      title: (q && q.title) || attempts[slug].title || title, difficulty: (q && q.difficulty) || attempts[slug].difficulty,
      topics: attempts[slug].topics
    });
  }
  if (!attempts[slug].solvedAt) attempts[slug] = { ...attempts[slug], solvedAt: Date.now() };
  // Drop accepts older than a week to keep storage small.
  for (const [k, ts] of Object.entries(localAccepts)) if (Date.now() - ts > 7 * Core.DAY_MS) delete localAccepts[k];
  await save({ localAccepts, knownSolved, attempts });
  await afterStateChange();
  setTimeout(() => sync(), 5000);
}

// ---------- stats log ----------

async function logSolve(slug, ts, info) {
  const { solveLog } = await load(["solveLog"]);
  if (solveLog[slug] && solveLog[slug].ts <= ts) return;
  await save({ solveLog: { ...solveLog, [slug]: { ts, ...info } } });
}

async function getStats() {
  const s = await load();
  // Merge hint usage from attempts into the solve log.
  const solveLog = {};
  for (const [slug, e] of Object.entries(s.solveLog)) {
    const a = s.attempts[slug] || {};
    solveLog[slug] = { ...e, hints: a.hints || 0, revealed: !!a.revealed, topics: e.topics && e.topics.length ? e.topics : a.topics || [] };
  }
  return Core.computeStats({ solveLog, lessonLog: s.lessonLog, behavioralLog: s.behavioralLog, practiceDays: s.practiceDays });
}

// ---------- Claude for lessons and grading ----------

// One conversation turn through whichever route the settings choose. `convo`
// holds the route's state ({ sessionId } for Claude Code, { messages } for the
// API) and is updated in place.
async function converse(convo, { system, prompt, effort = "medium" }) {
  const s = await load(["settings"]);
  const mode = s.settings.helpMode;
  if (mode === "claudecode") {
    let r;
    if (convo.sessionId) {
      try { r = await nativeCall({ type: "ask", system, prompt, sessionId: convo.sessionId }); }
      catch (e) { if (!/conversation|session/i.test(e.message)) throw e; }
    }
    if (!r) r = await nativeCall({ type: "ask", system, prompt: (convo.context ? convo.context + "\n\n" : "") + prompt });
    convo.sessionId = r.sessionId;
    return r.text;
  }
  if (mode === "api") {
    const messages = (convo.messages || []).concat([{ role: "user", content: prompt }]);
    const r = await Claude.send({ apiKey: s.settings.apiKey, model: s.settings.model, system, messages, effort });
    convo.messages = messages.concat([r.assistantMessage]);
    return r.text;
  }
  throw new Error("Lessons and grading need Claude to answer here. In settings, choose \"Claude Code on this computer\" (your Pro plan) or an API key.");
}

// Pulls a JSON object out of a reply that may have code fences or extra text.
function parseJsonReply(text) {
  const t = String(text || "").replace(/```(?:json)?/g, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Claude's reply wasn't in the expected format. Try again.");
  return JSON.parse(t.slice(a, b + 1));
}

const LESSON_SYSTEM = "You are a senior software engineer at a large tech company. You write short, engaging daily lessons for a new-grad engineer preparing for SWE I/II interviews at major tech companies, covering system design and engineering fundamentals. Be accurate, concrete and practical. The reader knows data structures and algorithms but has little production experience.";

const COACH_SYSTEM = "You are an experienced interviewer at a large tech company coaching a new-grad candidate for SWE I/II behavioral and communication questions. Grade honestly but kindly, and give concrete, actionable feedback.";

function lessonById(id) { return DESIGN_LESSONS.find((l) => l.id === id); }
function questionById(id) { return BEHAVIORAL.find((q) => q.id === id); }

async function updateLearnSession(key, patch) {
  const { learnSessions } = await load(["learnSessions"]);
  const next = { ...learnSessions, [key]: { ...(learnSessions[key] || {}), ...patch, updatedAt: Date.now() } };
  const keys = Object.keys(next).sort((a, b) => next[b].updatedAt - next[a].updatedAt);
  for (const old of keys.slice(30)) delete next[old];
  await save({ learnSessions: next });
  return next[key];
}

// Today's item for a type, or a specific item (`id`), or the next one for extra practice.
async function getLearn({ type, id, next }) {
  await ensureDaily();
  const s = await load();
  const log = type === "design" ? s.lessonLog : s.behavioralLog;
  let itemId = id;
  let review = false;
  if (!itemId && !next && s.daily && s.daily.type === type) { itemId = s.daily.itemId; review = !!s.daily.review; }
  if (!itemId) {
    const pick = type === "design" ? Core.nextLesson(log) : Core.nextBehavioral(log);
    // For extra practice, skip whatever was already done today.
    const start = Core.startOfDay();
    const doneToday = new Set(Object.entries(log).filter(([, e]) => e.some((x) => x.ts >= start)).map(([k]) => k));
    const list = type === "design" ? DESIGN_LESSONS : BEHAVIORAL;
    const alt = doneToday.has(pick.item.id) ? list.find((x) => !doneToday.has(x.id) && !(log[x.id] || []).length) : null;
    itemId = (alt || pick.item).id;
    review = alt ? false : pick.review;
  }
  const item = type === "design" ? lessonById(itemId) : questionById(itemId);
  if (!item) throw new Error("Unknown lesson.");
  const session = s.learnSessions[`${type}:${itemId}`] || {};
  const fresh = session.createdAt && Core.dateKey(session.createdAt) === Core.dateKey() ? session : {};
  const history = (log[itemId] || []).map((e) => ({ ts: e.ts, score: e.score }));
  const progress = progressFrom(s);
  return {
    type, item, review, history,
    isToday: !!(s.daily && s.daily.type === type && s.daily.itemId === itemId),
    body: fresh.body || null, questions: fresh.questions || null,
    answers: fresh.answers || null, grade: fresh.grade || null,
    helpMode: s.settings.helpMode, progress,
    position: type === "design" ? DESIGN_LESSONS.findIndex((l) => l.id === itemId) + 1 : null,
    total: type === "design" ? DESIGN_LESSONS.length : BEHAVIORAL.length
  };
}

async function generateLesson({ id, review }) {
  const lesson = lessonById(id);
  if (!lesson) throw new Error("Unknown lesson.");
  const convo = {};
  const text = await converse(convo, {
    system: LESSON_SYSTEM,
    prompt: [
      `Write today's lesson: "${lesson.title}". Cover: ${lesson.points}.`,
      review ? "This is a review: the student scored low on this topic before, so explain the core ideas differently and more simply." : "",
      "This is a short reading the student studies before a quiz: 350-550 words of Markdown (about a 2-3 minute read). Keep it tight: one or two sentences on why the topic matters, then the core ideas under 2-3 short ## headings (define key terms the first time they appear), one concrete real-world example (a named company or product is fine), a tiny ASCII diagram in a code block only if it really helps, a 2-3 sentence \"In an interview\" section, and a \"Key takeaways\" list of 3 bullets. Skip anything that isn't essential.",
      "Then write 3 quiz questions answerable from the reading in a few sentences: one checks understanding, one applies the idea to a scenario, one asks about a trade-off.",
      "Respond with only a JSON object and no code fences: {\"body\": \"<the lesson in Markdown>\", \"questions\": [\"...\", \"...\", \"...\"]}"
    ].filter(Boolean).join("\n\n")
  });
  const data = parseJsonReply(text);
  if (!data.body || !Array.isArray(data.questions) || !data.questions.length) throw new Error("Claude's lesson was incomplete. Try again.");
  // If the Claude Code conversation is lost before grading, this context lets a new one grade fairly.
  convo.context = `You wrote this lesson for the student:\n\n${data.body}\n\nQuiz questions:\n${data.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
  await updateLearnSession(`design:${id}`, { createdAt: Date.now(), body: data.body, questions: data.questions.slice(0, 5), answers: null, grade: null, convo });
  return getLearn({ type: "design", id });
}

async function gradeLesson({ id, answers }) {
  const { learnSessions } = await load(["learnSessions"]);
  const session = learnSessions[`design:${id}`];
  if (!session || !session.questions) throw new Error("Open the lesson first.");
  const convo = { ...(session.convo || {}) };
  const text = await converse(convo, {
    system: LESSON_SYSTEM,
    prompt: [
      "Here are my answers to the quiz:",
      session.questions.map((q, i) => `${i + 1}. ${q}\nMy answer: ${(answers[i] || "").trim() || "(no answer)"}`).join("\n\n"),
      "Grade each answer from 0 to 10 for correctness and completeness, like a friendly but honest interviewer. For each, give 1-3 sentences of feedback and a model answer of 2-4 sentences.",
      "Respond with only a JSON object and no code fences: {\"results\": [{\"score\": 0, \"feedback\": \"...\", \"modelAnswer\": \"...\"}], \"summary\": \"one or two sentences: encouragement and what to review\"}"
    ].join("\n\n")
  });
  const grade = parseJsonReply(text);
  const scores = (grade.results || []).map((r) => Math.max(0, Math.min(10, Number(r.score) || 0)));
  if (!scores.length) throw new Error("Claude's grade was incomplete. Try again.");
  grade.score = scores.reduce((a, b) => a + b, 0) / (scores.length * 10);
  await updateLearnSession(`design:${id}`, { answers, grade, convo });
  const { lessonLog } = await load(["lessonLog"]);
  await save({ lessonLog: { ...lessonLog, [id]: (lessonLog[id] || []).concat([{ ts: Date.now(), score: grade.score }]) } });
  await afterStateChange();
  return getLearn({ type: "design", id });
}

async function gradeBehavioral({ id, answer }) {
  const q = questionById(id);
  if (!q) throw new Error("Unknown question.");
  if (!String(answer || "").trim()) throw new Error("Write your answer first.");
  const convo = {};
  const text = await converse(convo, {
    system: COACH_SYSTEM,
    prompt: [
      `Interview question: ${q.question}`,
      `What a strong answer does: ${q.tip}`,
      `My answer (written the way I would say it):\n${answer}`,
      "Score my answer from 0 to 10 on: structure (STAR where it fits), specificity, my own actions and ownership, a result or reflection, and clarity and concision for a spoken answer of about 2 minutes.",
      "List what worked and what to improve (concrete). Then rewrite a stronger version that keeps my facts. Don't invent achievements; use placeholders like [metric] where details are missing.",
      "Respond with only a JSON object and no code fences: {\"score\": 0, \"strengths\": [\"...\"], \"improvements\": [\"...\"], \"improvedAnswer\": \"...\", \"summary\": \"one or two sentences\"}"
    ].join("\n\n")
  });
  const grade = parseJsonReply(text);
  grade.score = Math.max(0, Math.min(10, Number(grade.score) || 0)) / 10;
  await updateLearnSession(`behavioral:${id}`, { createdAt: Date.now(), answers: [answer], grade, convo });
  const { behavioralLog } = await load(["behavioralLog"]);
  await save({ behavioralLog: { ...behavioralLog, [id]: (behavioralLog[id] || []).concat([{ ts: Date.now(), score: grade.score }]) } });
  await afterStateChange();
  return getLearn({ type: "behavioral", id });
}

// ---------- state for the UI ----------

async function getState() {
  await ensureDaily();
  const s = await load();
  const progress = progressFrom(s);
  const strengths = strengthsFrom(s);
  const covered = Core.assessmentCoverage(s.attempts, s.assessment);
  const { apiKey, ...publicSettings } = s.settings;
  return {
    settings: { ...publicSettings, hasApiKey: !!apiKey },
    progress,
    picks: s.daily && Core.isCodingType(s.daily.type) ? s.daily.picks.map((p) => ({ ...p, solvedToday: progress.solved.includes(p.slug) })) : [],
    today: s.daily && !Core.isCodingType(s.daily.type)
      ? { type: s.daily.type, id: s.daily.itemId, review: !!s.daily.review,
          title: s.daily.type === "design" ? (lessonById(s.daily.itemId) || {}).title : (questionById(s.daily.itemId) || {}).question }
      : { type: s.daily ? s.daily.type : "leetcode" },
    strengths,
    ramp: s.settings.rampUp && Core.rampStage(rampDaysDone(s))
      ? { ...Core.rampStage(rampDaysDone(s)), maxDifficulty: Core.rampCaps(rampDaysDone(s), progress.goal).includes("Medium") ? "Medium" : "Easy" }
      : null,
    profile: s.profile ? { byDifficulty: s.profile.byDifficulty, fetchedAt: s.profile.fetchedAt, username: s.profile.username } : null,
    assessment: s.assessment ? { ...s.assessment, covered: [...covered], total: TOPICS.length } : null,
    excludeSlugs: [...new Set([...Object.keys(s.knownSolved), ...Object.keys(s.attempts), ...Object.keys(s.revealed)])],
    attempts: Object.values(s.attempts).sort((a, b) => b.startedAt - a.startedAt).slice(0, 50),
    lastSync: s.lastSync,
    syncError: s.syncError,
    gameGuard: s.gameGuard,
    username: s.resolvedUsername
  };
}

async function saveSettings(patch) {
  const s = await load(["settings"]);
  const settings = { ...s.settings, ...patch };
  if (patch.apiKey === undefined) settings.apiKey = s.settings.apiKey;
  settings.blockedSites = Core.parseSiteList(settings.blockedSites);
  settings.blockedGames = Core.parseGameList(settings.blockedGames);
  settings.blockGames = !!settings.blockGames;
  if (!["claudeai", "claudecode", "api"].includes(settings.helpMode)) settings.helpMode = "claudecode";
  settings.dailyGoal = Math.min(10, Math.max(1, Number(settings.dailyGoal) || 1));
  if (!Array.isArray(settings.schedule) || settings.schedule.length !== 7) settings.schedule = Core.DEFAULT_SETTINGS.schedule;
  settings.schedule = settings.schedule.map((t) => (Core.TASK_TYPES.includes(t) ? t : "leetcode"));
  const scheduleChanged = JSON.stringify(settings.schedule) !== JSON.stringify(s.settings.schedule);
  settings.hintsBeforeSolution = Math.min(10, Math.max(1, Number(settings.hintsBeforeSolution) || 5));
  const usernameChanged = patch.username !== undefined && patch.username !== s.settings.username;
  const rampChanged = patch.rampUp !== undefined && !!patch.rampUp !== !!s.settings.rampUp;
  const goalChanged = settings.dailyGoal !== s.settings.dailyGoal;
  await save({ settings });
  // Turning the warm-up on restarts it from day 1; either way, re-pick today's problems.
  if (rampChanged && settings.rampUp) await save({ rampStartedAt: Date.now() });
  if (rampChanged || goalChanged || scheduleChanged) await save({ daily: null });
  if (usernameChanged) await sync({ forceProfile: true });
  else await afterStateChange();
}

browser.runtime.onMessage.addListener((msg, sender) => {
  const handlers = {
    getState: () => getState(),
    refresh: () => sync({ forceProfile: !!msg.forceProfile }).then(getState),
    startAssessment: () => startAssessment().then(getState),
    swapPick: () => swapPick(msg.slug).then(getState),
    saveSettings: () => saveSettings(msg.settings).then(getState),
    accepted: () => markAccepted(msg.slug, msg.title),
    getSession: async () => sessionView(msg.slug, await load()),
    help: () => help(msg),
    handoff: () => handoff(msg),
    pingBridge: () => nativeCall({ type: "ping" }),
    copy: () => navigator.clipboard.writeText(String(msg.text || "")),
    openOptions: () => browser.runtime.openOptionsPage(),
    progress: async () => progressFrom(await load(PROGRESS_KEYS)),
    getLearn: () => getLearn({ type: msg.kind, id: msg.id, next: msg.next }),
    generateLesson: () => generateLesson(msg),
    gradeLesson: () => gradeLesson(msg),
    gradeBehavioral: () => gradeBehavioral(msg),
    getStats: () => getStats()
  };
  const h = handlers[msg && msg.type];
  if (!h) return undefined;
  return h().then(
    (result) => ({ ok: true, result }),
    (e) => ({ ok: false, error: e.message || String(e) })
  );
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) sync();
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "update") {
    // 1.4: one task a day (was two LeetCode problems).
    const { migrations, settings } = await browser.storage.local.get({ migrations: {}, settings: null });
    if (!migrations.oneADay) {
      if (settings) await save({ settings: { ...settings, dailyGoal: 1 } });
      await save({ migrations: { ...migrations, oneADay: true } });
    }
    // 1.5: SQL days. If the schedule is still the old default, Friday becomes SQL.
    const fresh = await browser.storage.local.get({ migrations: {}, settings: null });
    if (!fresh.migrations.sqlDay) {
      const oldDefault = ["leetcode", "leetcode", "design", "leetcode", "design", "leetcode", "behavioral"];
      const sched = fresh.settings && fresh.settings.schedule;
      if (fresh.settings && (!sched || JSON.stringify(sched) === JSON.stringify(oldDefault))) {
        await save({ settings: { ...fresh.settings, schedule: Core.DEFAULT_SETTINGS.schedule.slice() } });
      }
      await save({ migrations: { ...fresh.migrations, sqlDay: true } });
    }
    // Re-pick today's problems so changes to how picks are made apply right away.
    const { rampStartedAt } = await browser.storage.local.get({ rampStartedAt: 0 });
    await save({ daily: null, ...(rampStartedAt ? {} : { rampStartedAt: Date.now() }) });
  }
  if (reason === "install") {
    await save({ assessment: { startedAt: Date.now(), completedAt: null } });
    browser.runtime.openOptionsPage();
  }
});

browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
sync();
