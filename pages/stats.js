/* global send, el, problemUrl, TASK_LABEL, TOPICS */
// Statistics page: streaks, a practice calendar, weekly activity, and history.

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
const TOPIC_NAME = { ...Object.fromEntries(TOPICS.map((t) => [t.id, t.name])), sql: "SQL & Databases" };
const TYPE_COLOR = { leetcode: "var(--s-leetcode)", design: "var(--s-design)", behavioral: "var(--s-behavioral)" };

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// ---------- tooltip ----------
const tip = $("tip");
function showTip(ev, lines) {
  tip.replaceChildren(...lines.map((l, i) => el("div", i === 0 ? { style: "font-weight:600" } : {}, l)));
  tip.style.display = "block";
  const x = Math.min(ev.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${ev.clientY + 12}px`;
}
function hideTip() { tip.style.display = "none"; }
function hover(node, lines) {
  node.addEventListener("mousemove", (ev) => showTip(ev, lines));
  node.addEventListener("mouseleave", hideTip);
  node.style.cursor = "default";
}

function niceDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function pct(x) { return x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`; }

// ---------- tiles & motivation ----------
function tile(label, value, sub) {
  return el("div", { class: "tile" }, el("div", { class: "label" }, label), el("div", { class: "value" }, value), sub ? el("div", { class: "sub" }, sub) : null);
}

function renderTiles(st) {
  const t = st.totals;
  $("tiles").replaceChildren(
    tile("Current streak", `${st.current} day${st.current === 1 ? "" : "s"}`, `Longest: ${st.longest}`),
    tile("Last 30 days", `${t.last30}/30`, "days with the goal met"),
    tile("LeetCode solved", String(t.solved), `${t.byDifficulty.Easy} Easy · ${t.byDifficulty.Medium} Medium · ${t.byDifficulty.Hard} Hard`),
    tile("Solved without hints", pct(t.noHintRate), "of solved problems"),
    tile("System design", `${t.lessons}/${t.lessonsTotal}`, `lessons · avg quiz ${pct(t.avgLessonScore)}`),
    tile("Behavioral", String(t.behavioral), `answers · avg ${t.avgBehavioralScore === null ? "—" : (t.avgBehavioralScore * 10).toFixed(1) + "/10"}`)
  );
  const milestones = [3, 7, 14, 30, 60, 90, 120, 180];
  const next = milestones.find((m) => m > st.current);
  const msg = [];
  if (st.current > 0) msg.push(`Streak: ${st.current} day${st.current === 1 ? "" : "s"}.`);
  else msg.push("Finish today's task to start a streak.");
  if (next) msg.push(`${next - st.current} more day${next - st.current === 1 ? "" : "s"} to reach ${next}.`);
  if (t.goalDays) msg.push(`${t.goalDays} goal day${t.goalDays === 1 ? "" : "s"} so far.`);
  $("motivation").textContent = msg.join(" ");
}

// ---------- calendar heatmap ----------
function heatLevel(n) { return n <= 0 ? 0 : n >= 4 ? 4 : n; }

function renderCalendar(st) {
  const cell = 15, gap = 4, left = 30, top = 18;
  const weeks = Math.ceil(st.calendar.length / 7);
  const svg = $("calendar");
  svg.replaceChildren();
  svg.setAttribute("width", left + weeks * (cell + gap));
  svg.setAttribute("height", top + 7 * (cell + gap));
  ["Mon", "Wed", "Fri"].forEach((d, i) => {
    const t = svgEl("text", { x: 0, y: top + (1 + i * 2) * (cell + gap) + cell - 2 });
    t.textContent = d;
    svg.append(t);
  });
  let lastMonth = -1;
  st.calendar.forEach((day, i) => {
    const w = Math.floor(i / 7), dow = i % 7;
    const x = left + w * (cell + gap), y = top + dow * (cell + gap);
    const month = Number(day.date.slice(5, 7));
    if (dow === 0 && month !== lastMonth && (lastMonth < 0 ? day.date.slice(8) <= "24" : true)) {
      const t = svgEl("text", { x, y: 11 });
      t.textContent = new Date(2000, month - 1, 1).toLocaleDateString(undefined, { month: "short" });
      svg.append(t);
      lastMonth = month;
    }
    const r = svgEl("rect", {
      x, y, width: cell, height: cell, rx: 3,
      fill: `var(--heat-${heatLevel(day.total)})`
    });
    if (day.goalMet) { r.setAttribute("stroke", "var(--muted)"); r.setAttribute("stroke-width", "1"); }
    const parts = [];
    if (day.leetcode) parts.push(`${day.leetcode} LeetCode`);
    if (day.design) parts.push(`${day.design} lesson${day.design > 1 ? "s" : ""}`);
    if (day.behavioral) parts.push(`${day.behavioral} behavioral`);
    hover(r, [niceDate(day.date), parts.length ? parts.join(", ") : "No activity", day.goalMet ? "Goal met ✓" : ""].filter(Boolean));
    svg.append(r);
  });
  // Show the most recent weeks first on narrow screens.
  const scroller = svg.parentElement;
  scroller.scrollLeft = scroller.scrollWidth;
}

// ---------- weekly stacked bars ----------
function renderWeekly(st) {
  const svg = $("weekly");
  svg.replaceChildren();
  const W = Math.max(320, svg.clientWidth || 760), H = 180, left = 28, bottom = 22, topPad = 8;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  const max = Math.max(3, ...st.weekly.map((w) => w.leetcode + w.design + w.behavioral));
  const plotH = H - bottom - topPad;
  const slot = (W - left) / st.weekly.length;
  const barW = Math.min(28, slot * 0.6);
  // Recessive grid.
  const step = max <= 6 ? 1 : max <= 14 ? 2 : 5;
  for (let v = 0; v <= max; v += step) {
    const y = topPad + plotH - (v / max) * plotH;
    svg.append(svgEl("line", { x1: left, x2: W, y1: y, y2: y, stroke: "var(--border)", "stroke-width": 1 }));
    const t = svgEl("text", { x: left - 6, y: y + 4, "text-anchor": "end" });
    t.textContent = v;
    svg.append(t);
  }
  st.weekly.forEach((w, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    let y = topPad + plotH;
    const segs = ["leetcode", "design", "behavioral"].filter((k) => w[k] > 0);
    segs.forEach((k, j) => {
      const h = (w[k] / max) * plotH;
      const isTop = j === segs.length - 1;
      const lines = [`Week of ${niceDate(w.weekStart)}`, `${w.leetcode} LeetCode · ${w.design} design · ${w.behavioral} behavioral`];
      // 2px surface gap between stacked segments; only the top segment gets rounded corners.
      const segH = Math.max(1, h - (isTop ? 0 : 2));
      const r = svgEl("rect", { x, y: y - h, width: barW, height: segH, rx: isTop ? 4 : 0, fill: TYPE_COLOR[k] });
      hover(r, lines);
      svg.append(r);
      if (isTop && h > 4) {
        // Square off the bottom corners of the rounded top segment so it sits flush on the baseline or the segment below.
        const sq = svgEl("rect", { x, y: y - 4, width: barW, height: 4, fill: TYPE_COLOR[k] });
        hover(sq, lines);
        svg.append(sq);
      }
      y -= h;
    });
    const hit = svgEl("rect", { x: left + i * slot, y: topPad, width: slot, height: plotH, fill: "transparent" });
    hover(hit, [`Week of ${niceDate(w.weekStart)}`, `${w.leetcode} LeetCode · ${w.design} design · ${w.behavioral} behavioral`]);
    svg.insertBefore(hit, svg.firstChild);
    if (i % 2 === 0 || st.weekly.length <= 6) {
      const t = svgEl("text", { x: x + barW / 2, y: H - 6, "text-anchor": "middle" });
      const [yy, mm, dd] = w.weekStart.split("-").map(Number);
      t.textContent = new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      svg.append(t);
    }
  });
}

// ---------- horizontal bars ----------
function hbars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return rows.map((r) => el("div", { class: "hbar" },
    el("span", {}, r.label),
    el("div", { class: "track" }, el("div", { class: "fill", style: `width:${(r.n / max) * 100}%` })),
    el("span", { class: "n" }, String(r.n))));
}

function renderBars(st) {
  const d = st.totals.byDifficulty;
  $("difficulty").replaceChildren(...hbars([{ label: "Easy", n: d.Easy }, { label: "Medium", n: d.Medium }, { label: "Hard", n: d.Hard }]));
  const topics = Object.entries(st.totals.byTopic).map(([id, n]) => ({ label: TOPIC_NAME[id] || id, n })).sort((a, b) => b.n - a.n);
  $("topics").replaceChildren(...(topics.length ? hbars(topics) : [el("p", { class: "muted" }, "Solve a problem to see your topics here.")]));
}

// ---------- history table ----------
let showAll = false;
function renderHistory(st) {
  const list = showAll ? st.activity : st.activity.slice(0, 20);
  $("more").style.display = !showAll && st.activity.length > 20 ? "" : "none";
  const rows = list.map((a) => {
    const when = new Date(a.ts);
    let what = a.title;
    let result = "";
    if (a.type === "leetcode") {
      what = el("a", { href: problemUrl(a.id), target: "_blank" }, a.title);
      result = [a.difficulty, a.revealed ? "solution revealed" : a.hints ? `${a.hints} hint${a.hints > 1 ? "s" : ""}` : "no hints"].filter(Boolean).join(" · ");
    } else {
      what = el("a", { href: `learn.html?type=${a.type}&id=${encodeURIComponent(a.id)}`, target: "_blank" }, a.title);
      result = a.type === "design" ? `Quiz ${pct(a.score)}` : `${Math.round(a.score * 10)}/10`;
    }
    return el("tr", {},
      el("td", { style: "white-space:nowrap" }, when.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })),
      el("td", {}, el("span", { class: "swatch", style: `background:${TYPE_COLOR[a.type]}` }), (a.topics && a.topics.includes("sql") ? "SQL" : TASK_LABEL[a.type].replace(" lesson", "").replace(" practice", ""))),
      el("td", {}, what),
      el("td", { class: "muted" }, result));
  });
  if (!rows.length) rows.push(el("tr", {}, el("td", { colspan: "4", class: "muted" }, "Nothing yet. Your solved problems, lessons and answers will show up here.")));
  $("history").replaceChildren(...rows);
}

let stats = null;
function renderAll() {
  if (!stats) return;
  renderTiles(stats);
  renderCalendar(stats);
  renderWeekly(stats);
  renderBars(stats);
  renderHistory(stats);
}

send({ type: "getStats" }).then((s) => { stats = s; renderAll(); }).catch((e) => { $("motivation").textContent = e.message; });
$("more").addEventListener("click", () => { showAll = true; renderHistory(stats); });
window.addEventListener("resize", () => stats && renderWeekly(stats));
