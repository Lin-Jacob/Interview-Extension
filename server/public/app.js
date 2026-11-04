// Friends dashboard page. Log in with a first name and the password the host
// made; the session token is kept in this browser.
"use strict";
const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
const SESSION_KEY = "dailyLockSession";
const TASK = { leetcode: "LeetCode", sql: "SQL", design: "System design", behavioral: "Behavioral" };
const TYPE_COLOR = { leetcode: "var(--s-leetcode)", design: "var(--s-design)", behavioral: "var(--s-behavioral)" };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}
function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// { token, name } or null. Falls back to memory in a private window.
let memorySession = null;
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return memorySession; }
}
function setSession(sess) {
  memorySession = sess;
  try { sess ? localStorage.setItem(SESSION_KEY, JSON.stringify(sess)) : localStorage.removeItem(SESSION_KEY); } catch { /* private window */ }
}
const key = (n) => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();

const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return plural(Math.round(h / 24), "day") + " ago";
}
function niceDate(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// ---------- tooltip ----------
const tip = $("tip");
function hover(node, lines) {
  node.addEventListener("mousemove", (ev) => {
    tip.replaceChildren(...lines.map((l, i) => el("div", i === 0 ? { style: "font-weight:600" } : {}, l)));
    tip.style.display = "block";
    tip.style.left = `${Math.min(ev.clientX + 12, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${ev.clientY + 12}px`;
  });
  node.addEventListener("mouseleave", () => { tip.style.display = "none"; });
}

// ---------- state ----------
let users = [];
let session = getSession();
let me = session ? session.name : "";
let selected = null;

function todayStatus(u) {
  if (!u.today || dateKey(u.updatedAt) !== dateKey(Date.now())) return el("div", { class: "status stale" }, "Hasn't synced today");
  const t = u.today;
  const label = TASK[t.type] || t.type;
  if (t.done) return el("div", { class: "status done" }, `✓ Done: ${label}`);
  return el("div", { class: "status todo" }, `Not yet: ${label}${t.goal > 1 ? ` ${t.count}/${t.goal}` : ""}`);
}

function renderBoard() {
  const cards = users.map((u) => {
    const isMe = key(u.name) === key(me);
    const d = u.totals.byDifficulty;
    return el("button", {
      type: "button",
      class: "person" + (isMe ? " you" : "") + (selected && key(selected) === key(u.name) ? " selected" : ""),
      onclick: () => { selected = u.name; render(); $("detail").scrollIntoView({ behavior: "smooth", block: "start" }); }
    },
    el("div", { class: "name" }, u.name, isMe ? el("span", { class: "tag" }, "YOU") : null),
    el("div", { class: "streak" }, String(u.current), el("span", {}, ` day streak · best ${u.longest}`)),
    todayStatus(u),
    el("div", { class: "small muted" }, `${u.totals.last30}/30 goal days · ${u.totals.solved} solved (${d.Easy}E ${d.Medium}M ${d.Hard}H)`),
    el("div", { class: "small muted" }, `Updated ${ago(u.updatedAt)}`));
  });
  $("board").replaceChildren(...(cards.length ? cards : [el("p", { class: "muted" }, "Nobody has synced yet. Open How to join below.")]));
}

function tile(label, value, sub) {
  return el("div", { class: "tile" }, el("div", { class: "label" }, label), el("div", { class: "value" }, value), sub ? el("div", { class: "sub" }, sub) : null);
}

function renderCalendar(cal) {
  const cell = 13, gap = 3, left = 28, top = 16;
  const svg = $("calendar");
  svg.replaceChildren();
  const weeks = Math.ceil(cal.length / 7);
  svg.setAttribute("width", left + weeks * (cell + gap));
  svg.setAttribute("height", top + 7 * (cell + gap));
  ["Mon", "Wed", "Fri"].forEach((d, i) => {
    const t = svgEl("text", { x: 0, y: top + (1 + i * 2) * (cell + gap) + cell - 2 });
    t.textContent = d;
    svg.append(t);
  });
  // The extension starts the calendar on a Sunday.
  let lastMonth = -1;
  cal.forEach((day, i) => {
    const w = Math.floor(i / 7), dow = i % 7;
    const x = left + w * (cell + gap), y = top + dow * (cell + gap);
    const month = Number(day.date.slice(5, 7));
    if (dow === 0 && month !== lastMonth) {
      const t = svgEl("text", { x, y: 10 });
      t.textContent = new Date(2000, month - 1, 1).toLocaleDateString(undefined, { month: "short" });
      svg.append(t);
      lastMonth = month;
    }
    const r = svgEl("rect", { x, y, width: cell, height: cell, rx: 3, fill: `var(--heat-${Math.min(4, Math.max(0, day.total))})` });
    if (day.goalMet) { r.setAttribute("stroke", "var(--muted)"); r.setAttribute("stroke-width", "1.5"); }
    hover(r, [niceDate(day.date), day.total ? `${day.total} ${day.total === 1 ? "activity" : "activities"}` : "No activity", day.goalMet ? "Goal met ✓" : ""].filter(Boolean));
    svg.append(r);
  });
  svg.parentElement.scrollLeft = svg.parentElement.scrollWidth;
}

function renderRecent(list) {
  const items = list.map((a) => {
    let what = a.title || a.id;
    if (a.type === "leetcode" && /^[a-z0-9-]+$/.test(a.id)) what = el("a", { href: `https://leetcode.com/problems/${a.id}/`, target: "_blank", rel: "noopener" }, what);
    const res = a.type === "leetcode" ? a.difficulty : a.type === "design" ? `Quiz ${pct(a.score)}` : a.score === null ? "" : `${Math.round(a.score * 10)}/10`;
    return el("li", {},
      el("span", { class: "when" }, new Date(a.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })),
      el("span", { class: "sw", style: `background:${TYPE_COLOR[a.type] || "var(--muted)"}`, title: TASK[a.type] || a.type }),
      el("span", { class: "what" }, what),
      el("span", { class: "res" }, res || ""));
  });
  $("recent").replaceChildren(...(items.length ? items : [el("li", { class: "muted" }, "Nothing yet.")]));
}

function renderDetail() {
  const u = users.find((x) => key(x.name) === key(selected));
  $("detail").hidden = !u;
  if (!u) return;
  const t = u.totals;
  $("detailTitle").textContent = key(u.name) === key(me) ? "Your progress" : `${u.name}'s progress`;
  $("tiles").replaceChildren(
    tile("Current streak", plural(u.current, "day"), `Longest: ${u.longest}`),
    tile("Last 30 days", `${t.last30}/30`, "days with the goal met"),
    tile("LeetCode solved", String(t.solved), `${t.byDifficulty.Easy} Easy · ${t.byDifficulty.Medium} Medium · ${t.byDifficulty.Hard} Hard`),
    tile("Without hints", pct(t.noHintRate), "of solved problems"),
    tile("System design", `${t.lessons}/${t.lessonsTotal || "—"}`, `avg quiz ${pct(t.avgLessonScore)}`),
    tile("Behavioral", String(t.behavioral), `avg ${t.avgBehavioralScore === null ? "—" : (t.avgBehavioralScore * 10).toFixed(1) + "/10"}`));
  renderCalendar(u.calendar);
  renderRecent(u.recent);
}

function render() {
  const loggedIn = !!me;
  $("login").hidden = loggedIn;
  $("main").hidden = !loggedIn;
  $("who").hidden = !loggedIn;
  $("whoName").textContent = me;
  if (!loggedIn) return;
  const mine = users.find((u) => key(u.name) === key(me));
  const nj = $("notJoined");
  nj.hidden = !!mine;
  if (!mine) {
    nj.replaceChildren(
      el("strong", {}, `No stats for "${me}" yet.`),
      el("p", { class: "muted", style: "margin:6px 0 0" }, "In the extension settings, under Practice with friends, enter your first name, password and this page's address, then click Sync now. New here? Open How to join below."));
    $("join").open = true;
  }
  if (!selected || !users.some((u) => key(u.name) === key(selected))) selected = mine ? mine.name : (users[0] || {}).name || null;
  renderBoard();
  renderDetail();
}

function api(pathname, { method = "GET", body } = {}) {
  const headers = { "ngrok-skip-browser-warning": "1" };
  if (session) headers.authorization = `Bearer ${session.token}`;
  if (body) headers["content-type"] = "application/json";
  return fetch(pathname, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
}

function signedOut() {
  session = null;
  me = "";
  users = [];
  selected = null;
  setSession(null);
  render();
}

async function refresh() {
  if (!session) return;
  try {
    const r = await api("api/users");
    if (r.status === 401) { signedOut(); return; }
    const data = await r.json();
    users = (data.users || []).filter((u) => !u.empty);
    if (data.me) me = data.me;
    $("updated").textContent = `Refreshed ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  } catch (e) {
    $("updated").textContent = `Couldn't load: ${e.message}`;
  }
  render();
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("loginError");
  err.hidden = true;
  $("loginBtn").disabled = true;
  try {
    const r = await api("api/login", { method: "POST", body: { name: $("nameInput").value, password: $("passwordInput").value } });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "Couldn't log in.");
    session = { token: data.token, name: data.name };
    setSession(session);
    me = data.name;
    selected = null;
    $("passwordInput").value = "";
    render();
    await refresh();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    $("loginBtn").disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  await api("api/logout", { method: "POST" }).catch(() => {});
  signedOut();
  $("nameInput").value = "";
  $("nameInput").focus();
});
$("hereUrl").textContent = location.origin;

render();
refresh();
setInterval(refresh, 60000);
