/* global isCoding, send, el, todayItems, progressText */

const params = new URLSearchParams(location.search);
const target = params.get("u") || "";
const game = params.get("g"); // set when the game blocker closed a game
let host = "";
try { host = new URL(target).hostname; } catch { /* leave blank */ }
document.getElementById("site").textContent = game || host || "This site";
if (game) {
  document.title = "Finish today's task first";
  document.querySelector("h1").textContent = "Finish today's task first, then play.";
  document.getElementById("closedNote").hidden = false;
}

function render(st) {
  const p = st.progress;
  if (game) document.getElementById("closedNote").textContent = p.done
    ? `Today's task is done, so ${game} can open now.`
    : `${game} was closed. It can open once today's task is done.`;
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
