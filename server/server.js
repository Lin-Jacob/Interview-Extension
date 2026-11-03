// Shared dashboard for LeetCode Daily Lock. Each person's extension posts a
// stats summary here (lib/share.js), and the page in public/ shows everyone's
// streaks side by side. No dependencies; start.js adds the ngrok tunnel.
//
// "Login" is by first name only. The first extension to post a name gets a
// random token for it, and later posts for that name must send the token, so
// a friend can't overwrite your stats by typing your name. Anyone with the
// link can view the dashboard.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY = 256 * 1024;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

const nameKey = (name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x, max = 200) => (typeof x === "string" ? x.slice(0, max) : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Keeps only the fields the page shows, with the types it expects.
function cleanStats(s) {
  if (!s || typeof s !== "object") return null;
  const name = str(s.name, 30).trim().replace(/\s+/g, " ");
  if (!name) return null;
  const t = s.totals || {};
  const d = t.byDifficulty || {};
  const today = s.today && typeof s.today === "object"
    ? { type: str(s.today.type, 20), count: num(s.today.count) || 0, goal: num(s.today.goal) || 1, done: !!s.today.done }
    : null;
  return {
    name,
    updatedAt: num(s.updatedAt) || Date.now(),
    today,
    current: num(s.current) || 0,
    longest: num(s.longest) || 0,
    totals: {
      solved: num(t.solved) || 0,
      byDifficulty: { Easy: num(d.Easy) || 0, Medium: num(d.Medium) || 0, Hard: num(d.Hard) || 0 },
      noHintRate: num(t.noHintRate),
      lessons: num(t.lessons) || 0,
      lessonsTotal: num(t.lessonsTotal) || 0,
      avgLessonScore: num(t.avgLessonScore),
      behavioral: num(t.behavioral) || 0,
      avgBehavioralScore: num(t.avgBehavioralScore),
      goalDays: num(t.goalDays) || 0,
      last30: num(t.last30) || 0
    },
    calendar: (Array.isArray(s.calendar) ? s.calendar : []).slice(-371)
      .filter((c) => c && DATE.test(c.date))
      .map((c) => ({ date: c.date, total: num(c.total) || 0, goalMet: !!c.goalMet })),
    recent: (Array.isArray(s.recent) ? s.recent : []).slice(0, 20)
      .filter((a) => a && typeof a === "object")
      .map((a) => ({ type: str(a.type, 20), ts: num(a.ts) || 0, title: str(a.title), id: str(a.id, 120), difficulty: str(a.difficulty, 10), score: num(a.score) }))
  };
}

function createStore(file) {
  let data = { users: {} };
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  if (!data.users) data.users = {};
  return {
    get: (key) => data.users[key],
    all: () => Object.values(data.users),
    put(key, user) {
      data.users[key] = user;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    }
  };
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// Saves one summary. Returns [status, body].
function handleSync(store, body) {
  const stats = cleanStats(body && body.stats);
  if (!stats) return [400, { ok: false, error: "Enter your first name in the extension settings." }];
  const key = nameKey(stats.name);
  const existing = store.get(key);
  if (existing && !sameToken(existing.token, body.token)) {
    return [403, { ok: false, error: `Someone already uses the name "${existing.stats.name}" on this dashboard. Add a last initial (like "${stats.name} L.") and save again.` }];
  }
  const token = existing ? existing.token : crypto.randomBytes(18).toString("base64url");
  store.put(key, { token, createdAt: existing ? existing.createdAt : Date.now(), stats });
  return [200, { ok: true, token }];
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "content-type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

// The extension posts from a moz-extension:// page, so the API allows any
// origin. ngrok's free plan shows a warning page to browsers unless this
// header is sent, so the extension sends it and preflight must allow it.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, ngrok-skip-browser-warning",
  "access-control-max-age": "86400"
};

function createServer({ dataFile = path.join(__dirname, "data", "users.json") } = {}) {
  const store = createStore(dataFile);
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") return send(res, 204, "", CORS);
      if (url.pathname === "/api/users" && req.method === "GET") {
        const users = store.all().map((u) => u.stats).sort((a, b) => b.current - a.current || b.totals.last30 - a.totals.last30 || a.name.localeCompare(b.name));
        return send(res, 200, { ok: true, users, now: Date.now() }, { ...CORS, "cache-control": "no-store" });
      }
      if (url.pathname === "/api/sync" && req.method === "POST") {
        let size = 0;
        const chunks = [];
        req.on("data", (c) => {
          size += c.length;
          if (size > MAX_BODY) { send(res, 413, { ok: false, error: "Too much data." }, CORS); req.destroy(); return; }
          chunks.push(c);
        });
        req.on("end", () => {
          if (res.headersSent) return;
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, { ok: false, error: "Bad request." }, CORS); }
          const [status, out] = handleSync(store, body);
          send(res, status, out, CORS);
        });
        return undefined;
      }
      return send(res, 404, { ok: false, error: "Not found." }, CORS);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !TYPES[path.extname(file)]) return send(res, 404, "Not found");
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, "Not found");
      res.writeHead(200, { "content-type": TYPES[path.extname(file)], "x-content-type-options": "nosniff", "cache-control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : buf);
    });
    return undefined;
  });
}

module.exports = { createServer, cleanStats, handleSync, createStore, nameKey };
