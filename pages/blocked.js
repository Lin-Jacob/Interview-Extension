/* global isCoding, send, el, todayItems, progressText */

const target = new URLSearchParams(location.search).get("u") || "";
let host = "";
try { host = new URL(target).hostname; } catch { /* leave blank */ }
document.getElementById("site").textContent = host || "This site";

function render(st) {
  const p = st.progress;
  if (p.done && /^https?:/.test(target)) {
    location.replace(target);
    return;
  }
  document.getElementById("progress").replaceChildren(
    el("span", { class: "notdone" }, isCoding(p.type) ? String(p.count) : "0"),
    el("span", { class: "of" }, isCoding(p.type) ? `${progressText(p)} today` : "/ 1 done today"));
  document.getElementById("status").textContent = st.syncError || "";
  document.getElementById("picks").replaceChildren(...todayItems(st));
}

function load() { return send({ type: "getState" }).then(render); }

document.getElementById("refresh").addEventListener("click", async (e) => {
  e.target.disabled = true;
  try { render(await send({ type: "refresh" })); } finally { e.target.disabled = false; }
});

browser.storage.onChanged.addListener((changes) => {
  if (changes.acList || changes.localAccepts || changes.daily || changes.settings || changes.lessonLog || changes.behavioralLog) load();
});
load();
