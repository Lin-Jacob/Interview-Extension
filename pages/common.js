// Helpers shared by the extension pages.
/* exported send, el, problemUrl, pickItem, timeAgo, todayItems, progressText, TASK_LABEL, isCoding */

function send(msg) {
  return browser.runtime.sendMessage(msg).then((r) => {
    if (!r) throw new Error("No response from the extension.");
    if (!r.ok) throw new Error(r.error);
    return r.result;
  });
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

function problemUrl(slug) {
  return `https://leetcode.com/problems/${slug}/`;
}

function pickItem(p, { onSwap } = {}) {
  return el("li", { class: "pick" + (p.solvedToday ? " solved" : "") },
    el("div", { class: "spacer" },
      el("a", { class: "title", href: problemUrl(p.slug), target: "_blank" }, p.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())),
      el("div", { class: "meta" },
        el("span", { class: "diff-" + p.difficulty }, p.difficulty), ` · ${p.topicName} · ${p.reason}`)),
    p.solvedToday ? el("span", { class: "done" }, "✓") : null,
    onSwap && !p.solvedToday ? el("button", { class: "secondary", title: "Pick a different problem", onclick: () => onSwap(p.slug) }, "Swap") : null);
}

function timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const TASK_LABEL = { leetcode: "LeetCode", sql: "SQL", design: "System design lesson", behavioral: "Behavioral practice" };
const isCoding = (t) => t === "leetcode" || t === "sql";

// Today's task as list items: LeetCode picks, or the lesson / question to do.
function todayItems(st, opts = {}) {
  if (!st.today || isCoding(st.today.type)) return st.picks.map((pk) => pickItem(pk, opts));
  const t = st.today;
  const url = `learn.html?type=${t.type}&id=${encodeURIComponent(t.id)}`;
  return [el("li", { class: "pick" + (st.progress.done ? " solved" : "") },
    el("div", { class: "spacer" },
      el("a", { class: "title", href: url, target: "_blank" }, t.title || TASK_LABEL[t.type]),
      el("div", { class: "meta" }, TASK_LABEL[t.type] + (t.type === "design" ? " + quiz" : "") + (t.review ? " · Review" : ""))),
    st.progress.done ? el("span", { class: "done" }, "✓") : el("a", { class: "btn", href: url, target: "_blank" }, "Start"))];
}

function progressText(p) {
  if (isCoding(p.type)) return `/ ${p.goal} solved`;
  return p.done ? "done today" : "to do today";
}
