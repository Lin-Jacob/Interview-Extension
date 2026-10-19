/* global LcdlIntellisense */
// IntelliSense for LeetCode's code editor, VS Code style: a suggestion list
// with the selected suggestion previewed as grey ghost text at the cursor.
// Tab or Enter accepts, the arrow keys move, Esc dismisses.
//
// Runs in the page's own JavaScript world (manifest "world": "MAIN") after
// lib/intellisense.js, which does the code analysis. LeetCode doesn't expose
// its Monaco editor's API, so this reads the code and the cursor position from
// the editor's rendered lines and types accepted text into the editor's input
// area the way a keyboard would.
//
// The extension's content script sets <html data-lcdl-autocomplete="on|off">.
(function () {
  const ATTR = "data-lcdl-autocomplete";
  const enabled = () => document.documentElement.getAttribute(ATTR) !== "off";
  const KIND_ICON = { field: "◆", method: "ƒ", variable: "𝑥", class: "C", module: "M", keyword: "⌘" };
  const KIND_COLOR = { field: "#75beff", method: "#c586c0", variable: "#9cdcfe", class: "#ee9d28", module: "#ee9d28", keyword: "#cccccc" };

  let items = [];
  let prefix = "";
  let active = 0;
  let dismissed = false;
  let list = null;
  let ghost = null;
  let pending = 0;

  // ---------- reading the editor ----------

  const editorRoot = (node) => (node && node.closest ? node.closest(".monaco-editor") : null);
  const px = (v) => parseFloat(v) || 0;

  function lineNodes(root) {
    return [...root.querySelectorAll(".view-lines .view-line")].sort((a, b) => px(a.style.top) - px(b.style.top));
  }

  function lineText(node) { return node.textContent.replace(/ /g, " "); }

  let charWidthCache = 0;
  function charWidth(root) {
    if (charWidthCache) return charWidthCache;
    for (const n of lineNodes(root)) {
      const t = n.textContent;
      if (t.length < 4) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      const w = r.getBoundingClientRect().width;
      if (w > 0) return (charWidthCache = w / t.length);
    }
    return 7.7;
  }

  // Code, cursor line (index into the code) and column, from the rendered lines.
  function readEditor(root) {
    const cursor = root.querySelector(".cursors-layer .cursor");
    if (!cursor) return null;
    const nodes = lineNodes(root);
    const top = px(cursor.style.top);
    let lineNo = nodes.findIndex((n) => Math.abs(px(n.style.top) - top) < 2);
    if (lineNo < 0) return null;
    const col = Math.round(px(cursor.style.left) / charWidth(root));
    return { code: nodes.map(lineText).join("\n"), lineNo, col, cursor };
  }

  function detectLang(root) {
    const label = [...document.querySelectorAll("button")].map((b) => b.textContent.trim())
      .find((t) => /^(Python3?|Java|C\+\+|C|C#|JavaScript|TypeScript|MySQL|MS SQL Server|Oracle|PostgreSQL|Pandas)$/i.test(t)) || "";
    if (/sql|oracle/i.test(label)) return "sql";
    if (/python|pandas/i.test(label)) return "python";
    if (/^java$|^c#$/i.test(label)) return "java";
    if (/c\+\+|^c$/i.test(label)) return "cpp";
    if (/script/i.test(label)) return "javascript";
    const code = lineNodes(root).map(lineText).join("\n");
    if (/\bdef |\bself\b/.test(code)) return "python";
    if (/#include|vector<|->/.test(code)) return "cpp";
    if (/public (class|int|boolean|String|List|ListNode)/.test(code)) return "java";
    if (/\b(SELECT|FROM)\b/i.test(code)) return "sql";
    return "javascript";
  }

  // Table and column names from the problem statement's schema tables (SQL).
  let schemaCache = null;
  function schemaWords() {
    if (schemaCache && schemaCache.path === location.pathname) return schemaCache.words;
    const text = [...document.querySelectorAll("pre, code")].map((e) => e.textContent).join("\n");
    const out = new Set();
    for (const m of text.matchAll(/Table:\s*(\w+)/g)) out.add(m[1]);
    for (const line of text.split("\n")) {
      const cells = line.match(/^\|\s*(\w+)\s*\|\s*(\w+)\s*\|/);
      if (cells && !/^(Column|column_name)$/i.test(cells[1])) out.add(cells[1]);
    }
    for (const t of document.querySelectorAll("p, div")) {
      const m = t.childElementCount < 3 && t.textContent.match(/^Table:\s*(\w+)$/);
      if (m) out.add(m[1]);
    }
    schemaCache = { path: location.pathname, words: [...out] };
    return schemaCache.words;
  }

  // ---------- UI ----------

  function ensureUi() {
    if (list) return;
    list = document.createElement("div");
    list.className = "lcdl-suggest";
    Object.assign(list.style, {
      position: "fixed", zIndex: 2147483647, minWidth: "220px", maxWidth: "420px", maxHeight: "264px", overflowY: "auto",
      padding: "2px 0", background: "#252526", color: "#cccccc", border: "1px solid #454545", borderRadius: "4px",
      font: "13px/22px Menlo, Consolas, 'DejaVu Sans Mono', monospace", boxShadow: "0 2px 10px rgba(0,0,0,.45)", display: "none"
    });
    list.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const row = e.target.closest("[data-i]");
      if (row) { active = Number(row.dataset.i); accept(); }
    });
    ghost = document.createElement("span");
    ghost.className = "lcdl-ghost";
    Object.assign(ghost.style, { position: "fixed", zIndex: 2147483646, pointerEvents: "none", color: "rgba(160,160,160,.75)", whiteSpace: "pre", display: "none" });
    document.body.append(list, ghost);
  }

  function hide() {
    items = [];
    if (list) list.style.display = "none";
    if (ghost) ghost.style.display = "none";
  }

  function render(root, state) {
    ensureUi();
    list.replaceChildren(...items.map((it, i) => {
      const row = document.createElement("div");
      row.dataset.i = i;
      Object.assign(row.style, { display: "flex", gap: "8px", padding: "0 8px", cursor: "pointer", whiteSpace: "nowrap", background: i === active ? "#04395e" : "transparent" });
      const icon = document.createElement("span");
      icon.textContent = KIND_ICON[it.kind] || "•";
      Object.assign(icon.style, { color: KIND_COLOR[it.kind] || "#ccc", width: "14px", textAlign: "center", flex: "none" });
      const label = document.createElement("span");
      label.style.flex = "1";
      // Highlight the matched letters, like VS Code.
      let pi = 0;
      for (const ch of it.word) {
        const s = document.createElement("span");
        s.textContent = ch;
        if (pi < prefix.length && ch.toLowerCase() === prefix[pi].toLowerCase()) { s.style.color = "#2aaaff"; s.style.fontWeight = "700"; pi++; }
        label.append(s);
      }
      const kind = document.createElement("span");
      kind.textContent = it.kind;
      Object.assign(kind.style, { color: "#8b8b8b", fontSize: "11px", flex: "none" });
      row.append(icon, label, kind);
      return row;
    }));
    const rect = state.cursor.getBoundingClientRect();
    const lineH = rect.height || 19;
    list.style.display = "block";
    const h = list.offsetHeight;
    list.style.left = `${Math.max(4, Math.min(rect.left - prefix.length * charWidth(root), window.innerWidth - list.offsetWidth - 8))}px`;
    list.style.top = `${rect.bottom + h + 4 > window.innerHeight ? rect.top - h - 2 : rect.bottom + 2}px`;
    const sel = list.children[active];
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });

    // Ghost text: the rest of the selected suggestion, right at the cursor.
    const word = items[active] && items[active].word;
    if (word && word.startsWith(prefix) && word.length > prefix.length) {
      const line = root.querySelector(".view-line");
      const cs = line ? getComputedStyle(line) : null;
      ghost.textContent = word.slice(prefix.length);
      if (cs) {
        for (const k of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "fontFeatureSettings"]) ghost.style[k] = cs[k];
      }
      ghost.style.left = `${rect.left + 1}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.lineHeight = `${lineH}px`;
      ghost.style.display = "block";
    } else {
      ghost.style.display = "none";
    }
  }

  function update(root) {
    if (!enabled() || dismissed) return hide();
    const state = readEditor(root);
    if (!state) return hide();
    const lang = detectLang(root);
    const r = LcdlIntellisense.complete({ ...state, lang, extra: lang === "sql" ? schemaWords() : [] });
    const prevWord = items[active] && items[active].word;
    items = r.items;
    prefix = r.prefix;
    if (!items.length) return hide();
    const keep = items.findIndex((i) => i.word === prevWord);
    active = keep >= 0 ? keep : 0;
    render(root, state);
  }

  // Monaco redraws on the next animation frame after a keystroke.
  function schedule(root) {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => { pending = requestAnimationFrame(() => update(root)); });
  }

  function accept() {
    const it = items[active];
    const typed = prefix;
    hide();
    if (!it) return;
    // Typing into Monaco's hidden input area: the editor treats it like real keystrokes.
    if (it.word.startsWith(typed)) {
      document.execCommand("insertText", false, it.word.slice(typed.length));
    } else {
      for (let i = 0; i < typed.length; i++) document.execCommand("delete", false);
      document.execCommand("insertText", false, it.word);
    }
  }

  // ---------- events ----------

  document.addEventListener("keydown", (e) => {
    const root = editorRoot(e.target);
    if (!root || !enabled()) return;
    const open = list && list.style.display === "block" && items.length;
    if (open && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
      e.preventDefault(); e.stopImmediatePropagation(); accept(); return;
    }
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault(); e.stopImmediatePropagation();
      active = (active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      const state = readEditor(root);
      if (state) render(root, state);
      return;
    }
    if (open && e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); dismissed = true; hide(); return; }
    if (e.key === "Escape") return;
    // Ctrl+Space asks for suggestions, like VS Code.
    if (e.key === " " && e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); dismissed = false; schedule(root); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) { hide(); return; }
    if (/^[A-Za-z0-9_.>]$/.test(e.key) || e.key === "Backspace") {
      if (/^[A-Za-z_.>]$/.test(e.key)) dismissed = false;
      schedule(root);
      return;
    }
    if (e.key.length === 1 || /^(Arrow|Home|End|Page|Delete|Enter|Tab)/.test(e.key)) { dismissed = false; hide(); }
  }, true);

  document.addEventListener("mousedown", (e) => { if (!list || !list.contains(e.target)) hide(); }, true);
  document.addEventListener("scroll", () => hide(), true);
  window.addEventListener("blur", () => hide());
})();
