// Shared dashboard for LeetCode Daily Lock. Each person's extension posts a
// stats summary here (lib/share.js), and the page in public/ shows everyone's
// streaks side by side. start.js adds the ngrok tunnel.
//
// Login is a first name plus a password that the host makes for each friend
// with users.js (`npm run add-user -- Sam`). Passwords are stored as scrypt
// hashes. The page and the extension both need them: the page to see
// anyone's stats, the extension to post your own.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data", "users.json");
const SESSION_DAYS = 60;
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

// Accounts, stats and page sessions in one JSON file. It's re-read when it
// changes on disk, so users.js can add people while the dashboard runs.
function createStore(file = DATA_FILE) {
  let data = null;
  let mtime = -1;
  function load() {
    let m = -1;
    try { m = fs.statSync(file).mtimeMs; } catch { /* first run */ }
    if (data && m === mtime) return data;
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { data = {}; }
    for (const k of ["accounts", "users", "sessions"]) if (!data[k] || typeof data[k] !== "object") data[k] = {};
    mtime = m;
    return data;
  }
  function write() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
    mtime = fs.statSync(file).mtimeMs;
  }
  return {
    data: load,
    update(fn) { load(); const r = fn(data); write(); return r; }
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString("hex") };
}

function checkPassword(account, password) {
  if (!account || typeof password !== "string" || !password) return false;
  const { hash } = hashPassword(password, account.salt);
  const x = Buffer.from(hash, "hex"), y = Buffer.from(account.hash, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function setPassword(store, name, password) {
  const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 30);
  if (!clean) throw new Error("A name is needed.");
  if (String(password || "").length < 4) throw new Error("Use a password of at least 4 characters.");
  return store.update((d) => {
    const key = nameKey(clean);
    const existed = !!d.accounts[key];
    d.accounts[key] = { name: clean, ...hashPassword(password), createdAt: existed ? d.accounts[key].createdAt : Date.now() };
    // A new password signs that person out of the dashboard everywhere.
    for (const [t, sess] of Object.entries(d.sessions)) if (sess.key === key) delete d.sessions[t];
    return { name: clean, existed };
  });
}

function removeUser(store, name) {
  const key = nameKey(name);
  return store.update((d) => {
    const had = !!(d.accounts[key] || d.users[key]);
    delete d.accounts[key];
    delete d.users[key];
    for (const [t, sess] of Object.entries(d.sessions)) if (sess.key === key) delete d.sessions[t];
    return had;
  });
}

function login(store, name, password) {
  const key = nameKey(name);
  const account = store.data().accounts[key];
  if (!checkPassword(account, password)) return null;
  const token = crypto.randomBytes(24).toString("base64url");
  store.update((d) => {
    const cutoff = Date.now() - SESSION_DAYS * 864e5;
    for (const [t, sess] of Object.entries(d.sessions)) if (sess.at < cutoff) delete d.sessions[t];
    d.sessions[token] = { key, at: Date.now() };
  });
  return { token, name: account.name };
}

function sessionFor(store, req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  const d = store.data();
  const sess = Object.prototype.hasOwnProperty.call(d.sessions, m[1]) ? d.sessions[m[1]] : null;
  if (!sess || sess.at < Date.now() - SESSION_DAYS * 864e5 || !d.accounts[sess.key]) return null;
  return { token: m[1], key: sess.key, name: d.accounts[sess.key].name };
}

const WRONG = "That name and password don't match an account on this dashboard. Ask whoever runs it for yours.";

// Saves one summary from an extension. Returns [status, body].
function handleSync(store, body) {
  const stats = cleanStats(body && body.stats);
  if (!stats) return [400, { ok: false, error: "Enter your first name in the extension settings." }];
  const key = nameKey(stats.name);
  const account = store.data().accounts[key];
  if (!checkPassword(account, body.password)) return [401, { ok: false, error: WRONG }];
  stats.name = account.name;
  store.update((d) => { d.users[key] = { stats, at: Date.now() }; });
  return [200, { ok: true, name: account.name }];
}

function listUsers(store) {
  const d = store.data();
  return Object.entries(d.accounts).map(([key, a]) => (d.users[key] ? d.users[key].stats : { name: a.name, empty: true }))
    .sort((a, b) => !!a.empty - !!b.empty || (b.current || 0) - (a.current || 0) || ((b.totals || {}).last30 || 0) - ((a.totals || {}).last30 || 0) || a.name.localeCompare(b.name));
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
  "access-control-allow-headers": "content-type, authorization, ngrok-skip-browser-warning",
  "access-control-max-age": "86400"
};

function readJson(req, res, then) {
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
    then(body || {});
  });
}

// A wrong password waits a second before answering, to slow down guessing.
const later = (fn, ms) => setTimeout(fn, ms);

function createServer({ dataFile = DATA_FILE, failDelayMs = 1000 } = {}) {
  const store = createStore(dataFile);
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") return send(res, 204, "", CORS);
      const route = `${req.method} ${url.pathname}`;
      if (route === "POST /api/sync") {
        return readJson(req, res, (body) => {
          const [status, out] = handleSync(store, body);
          later(() => send(res, status, out, CORS), status === 401 ? failDelayMs : 0);
        });
      }
      if (route === "POST /api/login") {
        return readJson(req, res, (body) => {
          const r = login(store, body.name, body.password);
          if (r) return send(res, 200, { ok: true, ...r }, CORS);
          later(() => send(res, 401, { ok: false, error: WRONG }, CORS), failDelayMs);
        });
      }
      const sess = sessionFor(store, req);
      if (!sess) return send(res, 401, { ok: false, error: "Log in first." }, CORS);
      if (route === "GET /api/users") {
        return send(res, 200, { ok: true, me: sess.name, users: listUsers(store), now: Date.now() }, { ...CORS, "cache-control": "no-store" });
      }
      if (route === "POST /api/logout") {
        store.update((d) => { delete d.sessions[sess.token]; });
        return send(res, 200, { ok: true }, CORS);
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

module.exports = { createServer, cleanStats, handleSync, createStore, setPassword, removeUser, login, nameKey, DATA_FILE };
