// Practice with friends: turns this browser's stats into a small summary and
// sends it to a shared dashboard (server/ in the repo, usually behind ngrok).
// Each person logs in with their first name and the password the dashboard's
// host made for them; both are sent with every update.
(function (root) {
  const SYNC_EVERY_MS = 2 * 60 * 1000;
  const TIMEOUT_MS = 15000;

  function normalizeName(name) {
    return String(name || "").trim().replace(/\s+/g, " ").slice(0, 30);
  }

  // Accepts "my-name.ngrok-free.app", "https://my-name.ngrok-free.app/" or a
  // localhost address, and returns the origin, or "" if it isn't a web address.
  function normalizeUrl(url) {
    let s = String(url || "").trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = (/^(localhost|127\.0\.0\.1)(:|$)/i.test(s) ? "http://" : "https://") + s;
    try {
      const u = new URL(s);
      if (u.protocol !== "https:" && u.protocol !== "http:") return "";
      return u.origin;
    } catch {
      return "";
    }
  }

  // The part of the stats page the dashboard shows. Only titles, scores and
  // counts: no code, hints, answers or settings.
  function summary(stats, progress, name, now = Date.now()) {
    const t = stats.totals;
    return {
      name: normalizeName(name),
      updatedAt: now,
      today: progress ? { type: progress.type, count: progress.count, goal: progress.goal, done: !!progress.done } : null,
      current: stats.current,
      longest: stats.longest,
      totals: {
        solved: t.solved, byDifficulty: t.byDifficulty, noHintRate: t.noHintRate,
        lessons: t.lessons, lessonsTotal: t.lessonsTotal, avgLessonScore: t.avgLessonScore,
        behavioral: t.behavioral, avgBehavioralScore: t.avgBehavioralScore,
        goalDays: t.goalDays, last30: t.last30
      },
      calendar: stats.calendar.map((d) => ({ date: d.date, total: d.total, goalMet: d.goalMet })),
      recent: stats.activity.slice(0, 15).map((a) => ({
        type: a.type, ts: a.ts, title: a.title, id: a.id,
        difficulty: a.difficulty || undefined, score: typeof a.score === "number" ? a.score : undefined
      }))
    };
  }

  // Sends one summary, or throws with a message the settings page can show.
  async function push(fetchFn, url, payload, password) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetchFn(`${url}/api/sync`, {
        method: "POST",
        headers: { "content-type": "application/json", "ngrok-skip-browser-warning": "1" },
        body: JSON.stringify({ password: password || "", stats: payload }),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      throw new Error(`Couldn't reach the dashboard at ${url}. Is it running? (${e.name === "AbortError" ? "timed out" : e.message})`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON: probably not the dashboard */ }
    if (!res.ok || !data || !data.ok) {
      if (data && data.error) throw new Error(data.error);
      throw new Error(`The dashboard at ${url} answered ${res.status}. Check the address.`);
    }
    return { name: data.name || payload.name };
  }

  const api = { SYNC_EVERY_MS, normalizeName, normalizeUrl, summary, push };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Share = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
