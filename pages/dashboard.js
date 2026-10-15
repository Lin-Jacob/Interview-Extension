/* global isCoding, send, el, pickItem, timeAgo, problemUrl, todayItems, Core, TOPICS */

const $ = (id) => document.getElementById(id);
const TOPIC_NAME = Object.fromEntries(TOPICS.map((t) => [t.id, t.name]));

function level(strength) {
  if (strength < 0.4) return { text: "Weak", color: "var(--bad)" };
  if (strength < 0.7) return { text: "Developing", color: "var(--warn)" };
  return { text: "Strong", color: "var(--good)" };
}

function pct(x) { return x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`; }

function renderAssessment(st) {
  const box = $("assessment");
  const a = st.assessment;
  const start = el("button", { onclick: () => run({ type: "startAssessment" }) }, a ? "Restart assessment" : "Start assessment");
  if (!a || a.completedAt) {
    const weakest = st.strengths.slice().sort((x, y) => x.strength - y.strength).slice(0, 3).map((t) => t.name);
    box.replaceChildren(
      el("h2", {}, "Assessment"),
      a ? el("p", {}, `Completed ${new Date(a.completedAt).toLocaleDateString()}. Your weakest areas: `, el("strong", {}, weakest.join(", ")), ". Daily picks now focus there.")
        : el("p", {}, "The assessment gives you one problem from each of ", el("strong", {}, `${TOPICS.length} core topics`),
          ", starting with the topics you've practiced least on LeetCode. How you do on each (hints used, solution revealed or not) sets your strengths."),
      start);
    return;
  }
  const covered = new Set(a.covered);
  const remaining = Core.pickDaily({
    strengths: st.strengths, exclude: new Set(st.excludeSlugs), assessment: a, covered,
    count: TOPICS.length - covered.size,
    caps: st.ramp ? Array(TOPICS.length).fill(st.ramp.maxDifficulty) : null
  }).filter((p) => p.reason === "Assessment");
  box.replaceChildren(
    el("div", { class: "row" },
      el("h2", { style: "margin:0" }, "Assessment in progress"),
      el("div", { class: "spacer" }),
      el("span", { class: "muted" }, `${covered.size} of ${a.total} topics assessed`)),
    el("div", { class: "bar", style: "margin:10px 0" }, el("span", { style: `width:${(covered.size / a.total) * 100}%; background: var(--accent)` })),
    el("p", { class: "muted small" }, "Your two daily problems come from this list. Want to go faster? Solve any of these now; each one you attempt counts for its topic."),
    el("ul", { class: "picks" }, ...remaining.map((p) => pickItem(p))),
    el("div", { style: "margin-top:12px" }, start));
}

function renderTopics(st) {
  const rows = st.strengths.slice().sort((a, b) => a.strength - b.strength).map((t) => {
    const lv = t.known ? level(t.strength) : { text: "Unknown", color: "var(--muted)" };
    return el("tr", {},
      el("td", {}, t.name),
      el("td", { class: "hide-sm" }, t.solvedOnLeetCode === null ? "—" : String(t.solvedOnLeetCode)),
      el("td", { class: "hide-sm" }, t.attemptsScored ? `${pct(t.practice)} over ${t.attemptsScored}` : "—"),
      el("td", { style: "width:35%" }, el("div", { class: "bar" }, el("span", { style: `width:${Math.max(4, t.strength * 100)}%; background:${lv.color}` }))),
      el("td", { style: `color:${lv.color}; white-space:nowrap` }, lv.text));
  });
  $("topics").replaceChildren(...rows);
}

function renderAttempts(st) {
  const rows = st.attempts.map((a) => {
    let result = "In progress";
    if (a.revealed) result = "Solution revealed";
    else if (a.solvedAt) result = a.hints ? "Solved with hints" : "Solved";
    return el("tr", {},
      el("td", {}, el("a", { href: problemUrl(a.slug), target: "_blank" }, a.title || a.slug)),
      el("td", { class: "hide-sm" }, (a.topics || []).map((id) => TOPIC_NAME[id]).join(", ") || "—"),
      el("td", {}, String(a.hints || 0)),
      el("td", {}, result));
  });
  if (!rows.length) rows.push(el("tr", {}, el("td", { colspan: "4", class: "muted" }, "Nothing yet. Solve or ask for a hint on any problem and it shows up here.")));
  $("attempts").replaceChildren(...rows);
}

function render(st) {
  $("sync").replaceChildren(st.syncError
    ? el("span", { class: "error" }, st.syncError)
    : `${st.username || "Not signed in"} · synced ${timeAgo(st.lastSync)}`);
  const p = st.progress;
  $("progress").replaceChildren(
    el("span", { class: p.done ? "done" : "notdone" }, isCoding(p.type) ? String(p.count) : p.done ? "✓" : "0"),
    el("span", { class: "of" }, isCoding(p.type) ? `/ ${p.goal}` : "/ 1"));
  $("ramp").textContent = st.ramp && (!st.today || st.today.type === "leetcode") ? st.ramp.label : "";
  $("picks").replaceChildren(...todayItems(st, { onSwap: (slug) => run({ type: "swapPick", slug }) }));
  renderAssessment(st);
  renderTopics(st);
  renderAttempts(st);
}

async function run(msg) {
  document.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  try { render(await send(msg)); }
  catch (e) { $("sync").textContent = e.message; }
  finally { document.querySelectorAll("button").forEach((b) => { b.disabled = false; }); }
}

$("refresh").addEventListener("click", () => run({ type: "refresh", forceProfile: true }));
run({ type: "getState" });
