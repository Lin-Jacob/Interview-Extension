/* global send, el, Markdown, LearnStep */
// Daily system design lesson + quiz, or a behavioral / communication question.
// Claude writes the lesson and grades answers through the background page.

const params = new URLSearchParams(location.search);
const type = params.get("type") === "behavioral" ? "behavioral" : "design";
let current = null;
let busy = "";
let error = "";

function scoreText(x) { return `${Math.round(x * 100)}%`; }

function md(text) {
  const d = el("div", { class: "lesson" });
  d.append(Markdown.render(text));
  return d;
}

function header(st) {
  const kind = st.type === "design" ? "System design" : "Behavioral & communication";
  const meta = [];
  if (st.position) meta.push(`Lesson ${st.position} of ${st.total}`);
  if (st.review) meta.push("Review");
  if (st.isToday) meta.push("Today's task");
  const done = st.progress && st.progress.done;
  return el("div", { style: "margin-top:16px" },
    el("div", { class: "muted small" }, kind + (meta.length ? " · " + meta.join(" · ") : "")),
    el("h1", { style: "margin-top:4px" }, st.type === "design" ? st.item.title : st.item.question),
    st.isToday && done ? el("div", { class: "done small" }, "Today's goal is done. Blocked sites are unlocked.") : null);
}

function historyLine(st) {
  if (!st.history.length) return null;
  const last = st.history[st.history.length - 1];
  return el("div", { class: "muted small" }, `Last time: ${scoreText(last.score)} on ${new Date(last.ts).toLocaleDateString()}`);
}

function needsClaude(st) {
  if (st.helpMode === "claudecode" || st.helpMode === "api") return null;
  return el("div", { class: "card error" }, "Lessons and grading need Claude to answer inside the extension. In ",
    el("a", { href: "options.html" }, "settings"), ", choose \"Claude Code on this computer\" (your Pro plan).");
}

function renderDesign(st) {
  const root = [header(st), historyLine(st), needsClaude(st)];
  if (!st.body) {
    root.push(el("div", { class: "card" },
      el("p", {}, `Today's lesson is about ${st.item.points}.`),
      el("p", { class: "muted small" }, "Claude writes it fresh for you. It takes up to a minute."),
      el("button", { disabled: !!busy || !!needsClaude(st), onclick: () => run("generateLesson", { id: st.item.id, review: st.review }, "Writing your lesson…") }, "Start lesson")));
    return root;
  }
  const words = st.body.split(/\s+/).length;
  root.push(el("div", { class: "card" },
    el("div", { class: "muted small", style: "margin-bottom:6px" }, `Reading · about ${Math.max(1, Math.round(words / 200))} min`),
    md(st.body)));
  // The quiz stays hidden until the reading is done.
  const started = st.grade || (st.answers && st.answers.length) || quizOpened() || st.questions.some((_, i) => draft(i));
  if (!started) {
    root.push(el("div", { class: "card" },
      el("h2", {}, "Quiz"),
      el("p", { class: "muted small" }, `${st.questions.length} short questions about what you just read. Take your time with the reading first.`),
      el("button", { onclick: () => { openQuiz(); render(); } }, "I've finished reading. Start the quiz")));
    return root;
  }
  const quiz = el("div", { class: "card" }, el("h2", {}, "Quiz"),
    el("p", { class: "muted small" }, "Answer in your own words, a few sentences each, the way you'd say it in an interview. Claude grades it."));
  const boxes = [];
  st.questions.forEach((q, i) => {
    const box = el("textarea", { rows: "4", placeholder: "Your answer" });
    box.value = (st.answers && st.answers[i]) || draft(i);
    box.addEventListener("input", () => saveDraft(i, box.value));
    if (st.grade) box.disabled = true;
    boxes.push(box);
    const block = el("div", { class: "q" }, el("div", { class: "prompt" }, `${i + 1}. ${q}`), box,
      el("button", { class: "ask-link", onclick: () => askAbout(i) }, st.grade ? "Ask Claude about this question" : "Stuck? Ask Claude about the idea behind it"));
    const r = st.grade && st.grade.results && st.grade.results[i];
    if (r) {
      block.append(el("div", { class: "result" },
        el("div", { class: "score" }, `${r.score}/10`),
        el("div", {}, r.feedback || ""),
        r.modelAnswer ? el("div", { class: "muted small", style: "margin-top:4px" }, el("strong", {}, "Model answer: "), r.modelAnswer) : null));
    }
    quiz.append(block);
  });
  if (st.grade) {
    quiz.append(el("div", { class: "card", style: "background:var(--bg)" },
      el("div", { class: "progress", style: "font-size:22px" }, scoreText(st.grade.score)),
      el("p", {}, st.grade.summary || ""),
      st.grade.score < 0.6 ? el("p", { class: "muted small" }, "Next time you get a new lesson. This one comes back for review in two weeks.") : null,
      el("div", { class: "row" },
        el("button", { class: "secondary", onclick: () => load({ next: true }) }, "Another lesson (optional)"))));
  } else {
    quiz.append(el("div", { class: "row", style: "margin-top:14px" },
      el("button", { disabled: !!busy, onclick: () => {
        const answers = boxes.map((b) => b.value);
        if (answers.every((a) => !a.trim())) { error = "Answer at least one question first."; render(); return; }
        run("gradeLesson", { id: st.item.id, answers }, "Grading your answers…");
      } }, "Submit for grading")));
  }
  root.push(quiz);
  return root;
}

function renderBehavioral(st) {
  const root = [header(st), historyLine(st), needsClaude(st)];
  const box = el("textarea", { class: "answer-box", placeholder: "Write your answer the way you'd say it out loud. Aim for about 2 minutes spoken." });
  box.value = (st.answers && st.answers[0]) || draft(0);
  box.addEventListener("input", () => saveDraft(0, box.value));
  const card = el("div", { class: "card" },
    el("p", {}, el("strong", {}, "Tip: "), st.item.tip),
    el("p", { class: "muted small" }, "For stories, use STAR: Situation, Task, Action (most of the answer, and say \"I\", not \"we\"), Result."),
    box);
  if (st.grade) {
    box.disabled = true;
    const g = st.grade;
    card.append(
      el("div", { class: "progress", style: "font-size:22px; margin-top:14px" }, `${Math.round(g.score * 10)}/10`),
      el("p", {}, g.summary || ""),
      g.strengths && g.strengths.length ? el("div", {}, el("strong", {}, "What worked"), el("ul", {}, ...g.strengths.map((x) => el("li", {}, x)))) : null,
      g.improvements && g.improvements.length ? el("div", {}, el("strong", {}, "To improve"), el("ul", {}, ...g.improvements.map((x) => el("li", {}, x)))) : null,
      g.improvedAnswer ? el("div", {}, el("strong", {}, "Stronger version"), md(g.improvedAnswer)) : null,
      el("div", { class: "row", style: "margin-top:12px" },
        el("button", { class: "secondary", onclick: () => load({ id: st.item.id, retry: true }) }, "Try this one again"),
        el("button", { class: "secondary", onclick: () => load({ next: true }) }, "Another question (optional)")));
  } else {
    card.append(el("div", { class: "row", style: "margin-top:12px" },
      el("button", { disabled: !!busy || !!needsClaude(st), onclick: () => run("gradeBehavioral", { id: st.item.id, answer: box.value }, "Reviewing your answer…") }, "Get feedback")));
  }
  root.push(card);
  return root;
}

// Unsent answers survive closing the tab.
function draftKey(i) { return `draft:${type}:${current && current.item.id}:${i}`; }
function draft(i) { try { return localStorage.getItem(draftKey(i)) || ""; } catch { return ""; } }
function saveDraft(i, v) { try { localStorage.setItem(draftKey(i), v); } catch { /* ignore */ } }
function quizKey() { return `quiz:${current && current.item.id}:${new Date().toDateString()}`; }
function quizOpened() { try { return localStorage.getItem(quizKey()) === "1"; } catch { return false; } }
function openQuiz() { try { localStorage.setItem(quizKey(), "1"); } catch { /* ignore */ } }
function clearDrafts() { try { for (let i = 0; i < 5; i++) localStorage.removeItem(draftKey(i)); } catch { /* ignore */ } }

// ---------- Ask Claude chat (system design lessons) ----------
// A panel beside the lesson for questions about it. Until the quiz is graded,
// Claude explains the ideas but won't hand over quiz answers.

let chatOpen = false;
let chatBusy = "";
let chatError = "";
let chatDraft = "";
let chatPending = "";
const chatFab = el("button", { class: "chat-fab", onclick: () => toggleChat() }, "Ask Claude");
const chatPanel = el("div", { class: "chat-panel" });
document.body.append(chatFab, chatPanel);

function chatAvailable() { return !!(current && current.type === "design" && current.body); }

function toggleChat(open = !chatOpen) {
  chatOpen = open;
  renderChat();
  if (chatOpen) {
    const input = chatPanel.querySelector("textarea");
    if (input) input.focus();
  }
}

function askAbout(i) {
  const graded = !!current.grade;
  chatDraft = graded
    ? `About question ${i + 1}: why is the model answer right, and what did I miss?`
    : `I'm stuck on question ${i + 1}. Can you explain the idea it's testing without giving me the answer?`;
  toggleChat(true);
}

async function sendChat() {
  const text = chatDraft.trim();
  if (!text || chatBusy || !chatAvailable()) return;
  chatBusy = "Thinking…"; chatError = ""; chatPending = text; chatDraft = "";
  renderChat();
  const id = current.item.id;
  try {
    const r = await LearnStep.runLearnStep(send, (host, m) => browser.runtime.sendNativeMessage(host, m), { type: "lessonChat", id, text });
    if (current && current.item.id === id) current.chat = r.chat;
  } catch (e) {
    chatError = e.message;
    if (!chatDraft) chatDraft = text;
  }
  chatBusy = ""; chatPending = "";
  renderChat();
}

function renderChat() {
  const show = chatAvailable();
  chatFab.style.display = show ? "" : "none";
  chatPanel.classList.toggle("open", show && chatOpen);
  if (!show) return;
  const graded = !!current.grade;
  const blocked = needsClaude(current);
  const log = el("div", { class: "chat-log" });
  const chat = current.chat || [];
  if (!chat.length && !chatPending) {
    log.append(el("p", { class: "muted small", style: "margin:0" },
      "Ask anything about today's lesson or system design in general. " +
      (graded ? "The quiz is graded, so Claude can go through the model answers with you."
        : "Until the quiz is graded, Claude explains the ideas but won't write your quiz answers.")));
  }
  for (const m of chat) {
    if (m.role === "user") log.append(el("div", { class: "msg user" }, m.text));
    else log.append(el("div", { class: "msg assistant" }, md(m.text)));
  }
  if (chatPending) log.append(el("div", { class: "msg user" }, chatPending));
  if (chatBusy) log.append(el("div", { class: "loading small" }, chatBusy));
  if (chatError) log.append(el("div", { class: "error small" }, chatError));
  if (blocked) log.append(blocked);

  const input = el("textarea", { rows: "2", placeholder: graded ? "Ask about the lesson or your grade" : "Ask about the lesson (e.g. when would I pick X over Y?)" });
  input.value = chatDraft;
  input.disabled = !!blocked;
  input.addEventListener("input", () => { chatDraft = input.value; });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
    if (e.key === "Escape") toggleChat(false);
  });
  const askBtn = el("button", { disabled: !!chatBusy || !!blocked, onclick: () => sendChat() }, "Ask");
  chatPanel.replaceChildren(
    el("div", { class: "chat-head" },
      el("strong", {}, "Claude tutor"),
      el("span", { class: "muted small" }, graded ? "Quiz graded" : "No quiz answers until graded"),
      el("div", { class: "spacer" }),
      el("button", { class: "close", title: "Close", onclick: () => toggleChat(false) }, "×")),
    log,
    el("div", { class: "chat-ask" }, input, askBtn));
  log.scrollTop = log.scrollHeight;
  if (chatOpen && document.activeElement === document.body) input.focus();
}

function render() {
  renderChat();
  const root = document.getElementById("root");
  if (!current) { root.replaceChildren(el("p", { class: "loading" }, busy || "Loading…")); return; }
  const parts = current.type === "design" ? renderDesign(current) : renderBehavioral(current);
  if (busy) parts.push(el("p", { class: "loading" }, busy));
  if (error) parts.push(el("p", { class: "error" }, error));
  root.replaceChildren(...parts.filter(Boolean));
}

async function run(msgType, payload, label) {
  busy = label; error = ""; render();
  try {
    current = await LearnStep.runLearnStep(send, (host, m) => browser.runtime.sendNativeMessage(host, m), { type: msgType, ...payload });
    if (current.grade) clearDrafts();
  } catch (e) { error = e.message; }
  busy = ""; render();
  if (msgType === "generateLesson") window.scrollTo(0, 0);
}

async function load(opts = {}) {
  busy = ""; error = "";
  const id = opts.id || (opts.next ? null : params.get("id"));
  try {
    current = await send({ type: "getLearn", kind: type, ...(id ? { id } : {}), next: !!opts.next });
    if (opts.retry) current = { ...current, grade: null, answers: null };
    const u = new URL(location.href);
    u.searchParams.set("id", current.item.id);
    history.replaceState(null, "", u);
  } catch (e) { error = e.message; current = null; }
  render();
  window.scrollTo(0, 0);
}

load();
