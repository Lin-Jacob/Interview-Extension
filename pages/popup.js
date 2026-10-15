/* global isCoding, send, el, timeAgo, todayItems, progressText */

function render(st) {
  const p = st.progress;
  const prog = document.getElementById("progress");
  prog.replaceChildren(
    el("span", { class: p.done ? "done" : "notdone" }, isCoding(p.type) ? String(p.count) : p.done ? "✓" : "1"),
    el("span", { class: "of" }, `${progressText(p)}${p.done ? " · sites unlocked" : ""}`));
  const status = document.getElementById("status");
  status.replaceChildren(st.syncError
    ? el("span", { class: "error" }, st.syncError)
    : `${st.username ? st.username + " · " : ""}synced ${timeAgo(st.lastSync)}`);
  if (st.settings.helpMode === "api" && !st.settings.hasApiKey) {
    status.append(el("div", {}, "No Claude API key yet. ", el("a", { href: "options.html", target: "_blank" }, "Add one")));
  }
  document.getElementById("ramp").textContent = st.ramp && (!st.today || st.today.type === "leetcode") ? st.ramp.label : "";
  const list = document.getElementById("picks");
  list.replaceChildren(...todayItems(st));
  if (!list.children.length) list.append(el("li", { class: "muted" }, "No picks yet."));
}

document.getElementById("refresh").addEventListener("click", async (e) => {
  e.target.disabled = true;
  try { render(await send({ type: "refresh" })); } finally { e.target.disabled = false; }
});

send({ type: "getState" }).then(render).catch((e) => {
  document.getElementById("status").textContent = e.message;
});
