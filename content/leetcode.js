/* global Markdown */
// Content script on leetcode.com/problems/*: adds the "Ask Claude" help panel
// and reports accepted submissions to the background page.

(function () {
  const SUBMIT_WINDOW_MS = 2 * 60 * 1000;
  let slug = currentSlug();
  let submittedAt = 0;
  let reported = new Set();
  let session = null;
  let busy = false;
  let includeCode = true;
  let lastPrompt = "";

  function currentSlug() {
    const m = location.pathname.match(/^\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

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
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) e.append(c);
    return e;
  }

  // ---------- reading the editor ----------

  function readCode() {
    try {
      const monaco = window.wrappedJSObject && window.wrappedJSObject.monaco;
      if (monaco && monaco.editor) {
        const editors = monaco.editor.getEditors ? monaco.editor.getEditors() : null;
        const model = editors && editors.length ? editors[0].getModel() : monaco.editor.getModels()[0];
        if (model) return { code: String(model.getValue()), language: String(model.getLanguageId()) };
      }
    } catch { /* fall through to DOM */ }
    const lines = document.querySelector(".monaco-editor .view-lines");
    return { code: lines ? lines.innerText : "", language: "" };
  }

  // ---------- accepted detection ----------

  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest('[data-e2e-locator="console-submit-button"]')) submittedAt = Date.now();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submittedAt = Date.now();
  }, true);

  function checkAccepted() {
    if (!slug || reported.has(slug)) return;
    if (Date.now() - submittedAt > SUBMIT_WINDOW_MS) return;
    const result = document.querySelector('[data-e2e-locator="submission-result"]');
    if (result && result.textContent.trim().startsWith("Accepted")) {
      reported.add(slug);
      const title = (document.title || "").replace(/\s*-\s*LeetCode.*$/, "");
      send({ type: "accepted", slug, title }).catch(() => {});
      if (session) { session.solved = true; renderPanel(); }
      toast("Accepted! Counted toward today's goal.");
    }
  }

  new MutationObserver(() => {
    const s = currentSlug();
    if (s !== slug) { slug = s; session = null; if (panel.isConnected && panelOpen) loadSession(); }
    checkAccepted();
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- UI ----------

  let panelOpen = false;
  const fab = el("button", { class: "lcdl-fab", title: "Ask Claude for help", onclick: () => togglePanel() }, "Ask Claude");
  const panel = el("div", { class: "lcdl-panel" });

  function toast(text) {
    const t = el("div", { class: "lcdl-toast" }, text);
    document.body.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    panel.classList.toggle("lcdl-open", panelOpen);
    if (panelOpen) loadSession();
  }

  async function loadSession() {
    if (!slug) return;
    try {
      session = await send({ type: "getSession", slug });
    } catch (e) {
      session = { error: e.message, transcript: [] };
    }
    renderPanel();
  }

  async function ask(kind, text) {
    if (busy) return;
    busy = true;
    const viaClaudeAi = !session || session.helpMode === "claudeai";
    renderPanel(viaClaudeAi ? "Preparing your prompt…" : kind === "solution" ? "Writing the solution…" : "Thinking…");
    const { code, language } = includeCode ? readCode() : { code: "", language: "" };
    try {
      if (viaClaudeAi) {
        const r = await send({ type: "handoff", slug, kind, text, code, language });
        session = r.session;
        let copied = true;
        try { await navigator.clipboard.writeText(r.prompt); } catch {
          // Gesture may have expired during the round trip; the background page can still write.
          try { await send({ type: "copy", text: r.prompt }); } catch { copied = false; }
        }
        lastPrompt = r.prompt;
        session.notice = copied
          ? `Prompt copied. In the claude.ai tab, ${r.newChat ? "paste it into the new chat" : "paste it into the same chat"} (Ctrl+V) and press Enter.`
          : "Couldn't copy automatically. Use \"Copy prompt again\" below, then paste it into claude.ai.";
      } else {
        session = await send({ type: "help", slug, kind, text, code, language });
      }
    } catch (e) {
      session = { ...(session || {}), error: e.message };
    }
    busy = false;
    renderPanel();
    const log = panel.querySelector(".lcdl-log");
    if (log) log.scrollTop = log.scrollHeight;
  }

  function renderPanel(pending) {
    const s = session || { transcript: [], hints: 0, hintsBeforeSolution: 5 };
    panel.replaceChildren();
    const need = s.hintsBeforeSolution || 5;
    const header = el("div", { class: "lcdl-header" },
      el("strong", {}, "Claude tutor"),
      el("span", { class: "lcdl-count" }, s.revealed ? "Solution shown" : `Hints ${Math.min(s.hints || 0, need)}/${need}`),
      el("button", { class: "lcdl-close", title: "Close", onclick: () => togglePanel() }, "×"));
    panel.append(header);

    if (s.helpMode === "api" && s.hasApiKey === false) {
      panel.append(el("div", { class: "lcdl-note" },
        "Add your Claude API key to get hints. ",
        el("a", { href: "#", onclick: (e) => { e.preventDefault(); send({ type: "openOptions" }).catch(() => {}); } }, "Open settings")));
    }

    const log = el("div", { class: "lcdl-log" });
    if (!s.transcript.length && !pending) {
      log.append(el("p", { class: "lcdl-muted" },
        `Stuck? Take a hint. Each one gets more specific. After ${need} hints you can choose to see the full solution.` +
        (s.helpMode === "claudeai" ? " Hints open in claude.ai with the prompt copied, so they use your Claude plan." : "")));
    }
    for (const m of s.transcript) {
      if (m.role === "user") {
        if (m.text) log.append(el("div", { class: "lcdl-msg lcdl-user" }, m.text));
        continue;
      }
      const body = el("div", { class: "lcdl-msg lcdl-assistant" }, el("div", { class: "lcdl-label" }, m.label));
      body.append(Markdown.render(m.text));
      log.append(body);
    }
    if (pending) log.append(el("div", { class: "lcdl-msg lcdl-pending" }, pending));
    if (s.notice && !pending) {
      log.append(el("div", { class: "lcdl-msg lcdl-notice" }, s.notice,
        lastPrompt ? el("button", { class: "lcdl-link", onclick: () => navigator.clipboard.writeText(lastPrompt).then(() => toast("Prompt copied")) }, "Copy prompt again") : ""));
    }
    if (s.error) log.append(el("div", { class: "lcdl-msg lcdl-error" }, s.error));
    panel.append(log);

    const hintBtn = el("button", { class: "lcdl-btn", onclick: () => ask("hint") },
      (s.hints || 0) === 0 ? "Get a hint" : "Next hint");
    const remaining = Math.max(0, need - (s.hints || 0));
    const solBtn = el("button", {
      class: "lcdl-btn lcdl-danger",
      title: remaining ? `Unlocks after ${remaining} more hint(s)` : "Reveal the full solution",
      onclick: () => {
        const note = s.countRevealed ? "" : "\n\nA problem with a revealed solution won't count toward today's goal.";
        if (confirm(`Show the full solution?${note}`)) ask("solution");
      }
    }, remaining ? `Solution (in ${remaining})` : "Show solution");
    if (busy || remaining > 0 || s.revealed) solBtn.disabled = true;
    if (busy) hintBtn.disabled = true;
    panel.append(el("div", { class: "lcdl-actions" }, hintBtn, solBtn));

    const input = el("textarea", { class: "lcdl-input", rows: "2", placeholder: "Ask a question (e.g. why does my code TLE?)" });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); submitQuestion(); }
    });
    const submitQuestion = () => { const q = input.value.trim(); if (q) ask("question", q); };
    const askBtn = el("button", { class: "lcdl-btn", onclick: submitQuestion }, "Ask");
    if (busy) askBtn.disabled = true;
    const include = el("input", { type: "checkbox", class: "lcdl-include-code" });
    include.checked = includeCode;
    include.addEventListener("change", () => { includeCode = include.checked; });
    panel.append(el("div", { class: "lcdl-ask" }, input, askBtn));
    panel.append(el("label", { class: "lcdl-check" }, include, " Include my current code"));
    if (s.solved) panel.append(el("div", { class: "lcdl-note lcdl-good" }, "Solved ✓"));
  }

  document.body.append(fab, panel);
})();
