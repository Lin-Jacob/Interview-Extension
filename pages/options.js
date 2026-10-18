/* global send */

const ORIGINS = { origins: ["https://leetcode.com/*", "https://api.anthropic.com/*"] };
const $ = (id) => document.getElementById(id);

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
  $("apiKey").value = "";
  $("apiKey").placeholder = s.hasApiKey ? "Saved. Paste a new key to replace it." : "sk-ant-...";
  $("model").value = s.model;
  $("helpMode").value = s.helpMode || "claudecode";
  showApiFields();
  $("hintsBeforeSolution").value = s.hintsBeforeSolution;
  $("countRevealedSolutions").checked = !!s.countRevealedSolutions;
  $("rampUp").checked = !!s.rampUp;
  $("autocomplete").checked = s.autocomplete !== false;
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const settings = {
    username: $("username").value.trim(),
    dailyGoal: Number($("dailyGoal").value),
    schedule: DAYS.map((_, i) => $(`day${i}`).value),
    blockedSites: $("blockedSites").value,
    model: $("model").value,
    helpMode: $("helpMode").value,
    hintsBeforeSolution: Number($("hintsBeforeSolution").value),
    countRevealedSolutions: $("countRevealedSolutions").checked,
    rampUp: $("rampUp").checked,
    autocomplete: $("autocomplete").checked
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

checkPermissions();
send({ type: "getState" }).then(fill).catch((e) => { $("saved").textContent = e.message; });
