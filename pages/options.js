/* global send */

const ORIGINS = { origins: ["https://leetcode.com/*", "https://api.anthropic.com/*"] };
const $ = (id) => document.getElementById(id);

try {
  const v = browser.runtime.getManifest().version;
  $("version").textContent = `v${v}`;
  document.title = `Daily Lock Settings (v${v})`;
} catch { /* not running as an extension */ }

async function checkPermissions() {
  const ok = await browser.permissions.contains(ORIGINS);
  $("perm").hidden = ok;
}

$("grant").addEventListener("click", async () => {
  await browser.permissions.request(ORIGINS);
  await checkPermissions();
  send({ type: "refresh", forceProfile: true }).catch(() => {});
});

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPES = [["leetcode", "LeetCode"], ["sql", "SQL"], ["design", "System design"], ["behavioral", "Behavioral"]];

function fillSchedule(schedule) {
  $("schedule").replaceChildren(...DAYS.map((d, i) => {
    const sel = document.createElement("select");
    sel.id = `day${i}`;
    sel.style.width = "auto";
    for (const [v, label] of TYPES) {
      const o = document.createElement("option");
      o.value = v; o.textContent = label;
      sel.append(o);
    }
    sel.value = schedule[i] || "leetcode";
    const wrap = document.createElement("label");
    wrap.className = "small";
    wrap.style.display = "flex"; wrap.style.flexDirection = "column";
    wrap.append(d, sel);
    return wrap;
  }));
}

function fill(st) {
  const s = st.settings;
  fillSchedule(s.schedule || []);
  $("username").value = s.username || "";
  $("username").placeholder = st.username ? `Signed in as ${st.username}` : "";
  $("dailyGoal").value = s.dailyGoal;
  $("blockedSites").value = (s.blockedSites || []).join("\n");
  $("blockGames").checked = !!s.blockGames;
  $("blockedGames").value = (s.blockedGames || []).join("\n");
  showGameStatus(s.blockGames, st.gameGuard);
  $("apiKey").value = "";
  $("apiKey").placeholder = s.hasApiKey ? "Saved. Paste a new key to replace it." : "sk-ant-...";
  $("model").value = s.model;
  $("helpMode").value = s.helpMode || "claudecode";
  showApiFields();
  $("hintsBeforeSolution").value = s.hintsBeforeSolution;
  $("countRevealedSolutions").checked = !!s.countRevealedSolutions;
  $("rampUp").checked = !!s.rampUp;
  $("autocomplete").checked = s.autocomplete !== false;
  $("shareName").value = s.shareName || "";
  $("shareUrl").value = s.shareUrl || "";
  showShareStatus(st);
}

function showShareStatus(st) {
  const sh = st.share || {};
  const status = $("shareStatus");
  const link = $("openDashboard");
  link.hidden = !sh.url;
  if (sh.url) link.href = sh.url;
  status.className = "small muted";
  if (!sh.url || !st.settings.shareName) { status.textContent = "Not sharing."; return; }
  if (!sh.at) { status.textContent = "Not synced yet."; return; }
  if (sh.error) { status.textContent = sh.error; status.className = "small error"; return; }
  status.textContent = `Synced at ${new Date(sh.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  status.className = "small done";
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const settings = {
    username: $("username").value.trim(),
    dailyGoal: Number($("dailyGoal").value),
    schedule: DAYS.map((_, i) => $(`day${i}`).value),
    blockedSites: $("blockedSites").value,
    blockGames: $("blockGames").checked,
    blockedGames: $("blockedGames").value,
    model: $("model").value,
    helpMode: $("helpMode").value,
    hintsBeforeSolution: Number($("hintsBeforeSolution").value),
    countRevealedSolutions: $("countRevealedSolutions").checked,
    rampUp: $("rampUp").checked,
    autocomplete: $("autocomplete").checked,
    shareName: $("shareName").value,
    shareUrl: $("shareUrl").value
  };
  const key = $("apiKey").value.trim();
  if (key) settings.apiKey = key;
  $("saved").textContent = "Saving…";
  try {
    fill(await send({ type: "saveSettings", settings }));
    $("saved").textContent = "Saved.";
  } catch (err) {
    $("saved").textContent = err.message;
  }
});

function showGameStatus(on, g) {
  const el = $("gameStatus");
  el.className = "small muted";
  if (!on) { el.textContent = "Game blocking is off."; return; }
  if (!g) { el.textContent = "Not reported to the bridge yet."; return; }
  if (g.error) { el.textContent = `Game blocker not reachable: ${g.error}`; el.className = "small error"; return; }
  const when = new Date(g.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  el.textContent = `Game blocker ${g.guard === "started" ? "started" : "running"} at ${when}. Games are ${g.done ? "allowed: today's task is done" : "closed until today's task is done"}.`;
  el.className = g.done ? "small done" : "small muted";
}

function showApiFields() {
  $("apiFields").hidden = $("helpMode").value !== "api";
  $("bridgeFields").hidden = $("helpMode").value !== "claudecode";
}

$("testBridge").addEventListener("click", async () => {
  $("bridgeStatus").textContent = "Checking…";
  $("bridgeStatus").className = "small muted";
  try {
    const r = await send({ type: "pingBridge" });
    $("bridgeStatus").textContent = `Connected: ${r.version}`;
    $("bridgeStatus").className = "small done";
  } catch (e) {
    $("bridgeStatus").textContent = e.message;
    $("bridgeStatus").className = "small error";
  }
});
$("helpMode").addEventListener("change", showApiFields);

$("shareNow").addEventListener("click", async () => {
  $("shareStatus").textContent = "Syncing…";
  $("shareStatus").className = "small muted";
  try {
    await send({ type: "saveSettings", settings: { shareName: $("shareName").value, shareUrl: $("shareUrl").value } });
    const st = await send({ type: "shareNow" });
    $("shareName").value = st.settings.shareName;
    $("shareUrl").value = st.settings.shareUrl;
    showShareStatus(st);
  } catch (e) {
    $("shareStatus").textContent = e.message;
    $("shareStatus").className = "small error";
  }
});

checkPermissions();
send({ type: "getState" }).then(fill).catch((e) => { $("saved").textContent = e.message; });
