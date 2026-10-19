// Autocomplete for LeetCode's code editor. Runs in the page's own JavaScript
// world (manifest "world": "MAIN").
//
// If LeetCode exposes its Monaco editor as window.monaco, this turns on
// Monaco's own suggestions and adds each language's keywords, library names
// and snippets. LeetCode usually doesn't expose it, so otherwise this shows its
// own suggestion box: it tracks the word being typed in the editor, suggests
// keywords plus words already in your code, and types the rest of the word into
// the editor when you press Tab or Enter.
//
// The extension's content script sets <html data-lcdl-autocomplete="on|off">.
(function () {
  const ATTR = "data-lcdl-autocomplete";
  const words = (s) => s.split(/\s+/).filter(Boolean);

  const LANGS = {
    python: {
      ids: ["python", "python3"],
      words: words(`False None True and as assert break class continue def del elif else except finally for from global if
        import in is lambda nonlocal not or pass raise return try while with yield self len range enumerate zip sorted reversed
        min max sum abs all any map filter list dict set tuple str int float bool print isinstance ord chr divmod pow
        collections defaultdict Counter deque OrderedDict heapq heappush heappop heapify heappushpop nlargest nsmallest
        bisect bisect_left bisect_right insort functools lru_cache cache reduce itertools accumulate permutations combinations
        product chain groupby math inf gcd sqrt ceil floor append appendleft pop popleft extend insert remove sort index count
        keys values items get setdefault update add discard join split strip lower upper isdigit isalpha isalnum startswith endswith
        List Optional Dict Set Tuple ListNode TreeNode`),
      snippets: [
        ["for i in range", "for ${1:i} in range(${2:n}):\n\t$0"],
        ["for i, x in enumerate", "for ${1:i}, ${2:x} in enumerate(${3:nums}):\n\t$0"],
        ["while left <= right", "while ${1:left} <= ${2:right}:\n\t${3:mid} = (${1:left} + ${2:right}) // 2\n\t$0"],
        ["def dfs", "def dfs(${1:node}):\n\tif not ${1:node}:\n\t\treturn ${2:None}\n\t$0"],
        ["bfs with deque", "queue = collections.deque([${1:start}])\nseen = {${1:start}}\nwhile queue:\n\t${2:node} = queue.popleft()\n\t$0"]
      ]
    },
    java: {
      ids: ["java"],
      words: words(`abstract boolean break byte case catch char class continue default do double else enum extends final finally float
        for if implements import instanceof int interface long new null private protected public return short static super switch
        this throw throws try void while true false var String Integer Long Character Boolean Math Arrays Collections List ArrayList
        LinkedList Map HashMap TreeMap LinkedHashMap Set HashSet TreeSet Queue Deque ArrayDeque PriorityQueue Stack Iterator
        StringBuilder Comparator Objects length size get put getOrDefault containsKey containsValue add remove poll peek offer push
        pop isEmpty contains charAt substring toCharArray append toString sort asList fill max min abs valueOf parseInt
        MAX_VALUE MIN_VALUE entrySet keySet values ListNode TreeNode`),
      snippets: [
        ["for (int i", "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}"],
        ["for each", "for (${1:int} ${2:x} : ${3:nums}) {\n\t$0\n}"],
        ["new HashMap", "Map<${1:Integer}, ${2:Integer}> ${3:map} = new HashMap<>();"]
      ]
    },
    cpp: {
      ids: ["cpp", "c"],
      words: words(`auto bool break case char class const continue default delete do double else enum false float for if inline int long
        namespace new nullptr private protected public return short signed sizeof static struct switch template this true typedef
        unsigned using virtual void while std vector string unordered_map unordered_set map set multiset pair queue priority_queue
        stack deque make_pair push_back emplace_back pop_back push pop top front back begin end size empty insert erase find count
        sort reverse max min abs swap lower_bound upper_bound accumulate INT_MAX INT_MIN LLONG_MAX greater less ListNode TreeNode`),
      snippets: [
        ["for (int i", "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}"],
        ["for (auto& x", "for (auto& ${1:x} : ${2:nums}) {\n\t$0\n}"]
      ]
    },
    javascript: {
      ids: ["javascript", "typescript"],
      words: words(`async await break case catch class const continue default delete do else export extends false finally for function
        if import in instanceof let new null return super switch this throw true try typeof undefined var void while of
        Array Map Set Object Math Number String JSON Infinity length push pop shift unshift slice splice map filter reduce forEach
        some every find findIndex indexOf includes sort reverse join split fill from keys values entries has get set add delete
        max min floor ceil abs charCodeAt fromCharCode toString parseInt ListNode TreeNode`),
      snippets: [
        ["for (let i", "for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}"],
        ["for (const x of", "for (const ${1:x} of ${2:nums}) {\n\t$0\n}"]
      ]
    },
    sql: {
      ids: ["sql", "mysql", "pgsql", "postgres"],
      words: words(`SELECT FROM WHERE AND OR NOT IN IS NULL AS JOIN INNER LEFT RIGHT FULL OUTER CROSS ON USING GROUP BY ORDER HAVING
        LIMIT OFFSET DISTINCT UNION ALL EXISTS BETWEEN LIKE CASE WHEN THEN ELSE END WITH RECURSIVE OVER PARTITION ASC DESC
        INSERT INTO VALUES UPDATE SET DELETE COUNT SUM AVG MIN MAX ROUND IFNULL COALESCE NULLIF CONCAT GROUP_CONCAT SUBSTRING
        LENGTH UPPER LOWER TRIM DATE_FORMAT DATEDIFF DATE_ADD DATE_SUB YEAR MONTH DAY NOW CAST ROW_NUMBER RANK DENSE_RANK LAG
        LEAD FIRST_VALUE REGEXP`),
      snippets: [
        ["SELECT ... FROM ... WHERE", "SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};"],
        ["window function", "${1:ROW_NUMBER}() OVER (PARTITION BY ${2:col} ORDER BY ${3:col})"]
      ]
    }
  };

  const enabled = () => document.documentElement.getAttribute(ATTR) !== "off";

  // ---------- Monaco API (when window.monaco exists) ----------

  const registered = new Set();
  const configured = new WeakMap();

  function register(monaco) {
    const { CompletionItemKind, CompletionItemInsertTextRule } = monaco.languages;
    for (const lang of Object.values(LANGS)) {
      for (const id of lang.ids) {
        if (registered.has(id)) continue;
        registered.add(id);
        monaco.languages.registerCompletionItemProvider(id, {
          provideCompletionItems(model, position) {
            if (!enabled()) return { suggestions: [] };
            const w = model.getWordUntilPosition(position);
            const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn };
            const kw = lang.words.map((label) => ({ label, kind: CompletionItemKind.Keyword, insertText: label, range }));
            const sn = lang.snippets.map(([label, body]) => ({
              label, kind: CompletionItemKind.Snippet, insertText: body,
              insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet, range, sortText: "~" + label
            }));
            return { suggestions: kw.concat(sn) };
          }
        });
      }
    }
  }

  function useMonacoApi() {
    const monaco = window.monaco;
    if (!monaco || !monaco.editor || !monaco.languages || !monaco.editor.getEditors) return false;
    try { register(monaco); } catch { /* keep going with the options */ }
    const want = enabled() ? "on" : "off";
    for (const ed of monaco.editor.getEditors()) {
      if (configured.get(ed) === want) continue;
      ed.updateOptions(want === "on"
        ? { quickSuggestions: { other: true, comments: false, strings: false }, suggestOnTriggerCharacters: true,
            wordBasedSuggestions: "allDocuments", acceptSuggestionOnEnter: "smart", tabCompletion: "on", snippetSuggestions: "inline" }
        : { quickSuggestions: false, suggestOnTriggerCharacters: false, wordBasedSuggestions: "off" });
      configured.set(ed, want);
    }
    return true;
  }

  // ---------- fallback: our own suggestion box ----------

  const WORD_CHAR = /^[A-Za-z0-9_]$/;
  let prefix = "";
  let items = [];
  let active = 0;
  let box = null;

  function editorRoot(node) { return node && node.closest ? node.closest(".monaco-editor") : null; }

  function detectLang(root) {
    // LeetCode's language picker shows the name (e.g. "Python3", "C++", "MySQL").
    const label = [...document.querySelectorAll("button")].map((b) => b.textContent.trim())
      .find((t) => /^(Python3?|Java|C\+\+|C|JavaScript|TypeScript|MySQL|MS SQL Server|Oracle|PostgreSQL|Pandas)$/i.test(t)) || "";
    if (/sql|oracle/i.test(label)) return LANGS.sql;
    if (/python|pandas/i.test(label)) return LANGS.python;
    if (/^java$/i.test(label)) return LANGS.java;
    if (/c\+\+|^c$/i.test(label)) return LANGS.cpp;
    if (/script/i.test(label)) return LANGS.javascript;
    const code = codeText(root);
    if (/\bdef |self\b/.test(code)) return LANGS.python;
    if (/#include|vector</.test(code)) return LANGS.cpp;
    if (/public (class|int|boolean|String)/.test(code)) return LANGS.java;
    if (/\b(SELECT|FROM)\b/i.test(code)) return LANGS.sql;
    return LANGS.javascript;
  }

  function codeText(root) {
    const lines = root && root.querySelector(".view-lines");
    return lines ? lines.textContent.replace(/\u00a0/g, " ") : "";
  }

  function candidates(root) {
    const lang = detectLang(root);
    const fromCode = codeText(root).split(/[^A-Za-z0-9_]+/).filter((w) => w.length >= 3);
    const seen = new Set();
    const out = [];
    const p = prefix.toLowerCase();
    for (const w of [...fromCode, ...lang.words]) {
      if (seen.has(w) || w === prefix || !w.toLowerCase().startsWith(p)) continue;
      seen.add(w);
      out.push(w);
    }
    // Shorter and exact-case matches first, words from your code before keywords of equal length.
    return out.sort((a, b) => (b.startsWith(prefix) - a.startsWith(prefix)) || a.length - b.length).slice(0, 8);
  }

  function hide() { if (box) box.style.display = "none"; items = []; }

  function show(root) {
    items = prefix.length >= 2 ? candidates(root) : [];
    if (!items.length) return hide();
    active = Math.min(active, items.length - 1);
    if (!box) {
      box = document.createElement("div");
      box.className = "lcdl-suggest";
      Object.assign(box.style, {
        position: "fixed", zIndex: 2147483647, minWidth: "160px", maxWidth: "320px", padding: "4px 0",
        background: "#252526", color: "#d4d4d4", border: "1px solid #454545", borderRadius: "6px",
        font: "13px/1.5 Menlo, Consolas, monospace", boxShadow: "0 4px 14px rgba(0,0,0,.35)"
      });
      box.addEventListener("mousedown", (e) => {
        const row = e.target.closest("[data-i]");
        if (row) { e.preventDefault(); active = Number(row.dataset.i); accept(); }
      });
      document.body.append(box);
    }
    box.replaceChildren(...items.map((w, i) => {
      const row = document.createElement("div");
      row.dataset.i = i;
      Object.assign(row.style, { padding: "1px 10px", cursor: "pointer", background: i === active ? "#04395e" : "transparent", whiteSpace: "nowrap" });
      const b = document.createElement("b");
      b.textContent = w.slice(0, prefix.length);
      b.style.color = "#4fc1ff";
      row.append(b, w.slice(prefix.length));
      return row;
    }));
    const cursor = root.querySelector(".cursors-layer .cursor") || root.querySelector(".cursor");
    const r = (cursor || root).getBoundingClientRect();
    box.style.left = `${Math.min(r.left, window.innerWidth - 330)}px`;
    box.style.top = `${r.bottom + 2}px`;
    box.style.display = "block";
  }

  function accept() {
    const word = items[active];
    const rest = word ? word.slice(prefix.length) : "";
    hide();
    prefix = "";
    // Typing into Monaco's hidden input area lets the editor handle it like real typing.
    if (rest) document.execCommand("insertText", false, rest);
  }

  document.addEventListener("keydown", (e) => {
    const root = editorRoot(e.target);
    if (!root || !enabled() || usingApi) return;
    const open = box && box.style.display === "block" && items.length;
    if (open && (e.key === "Tab" || e.key === "Enter")) { e.preventDefault(); e.stopImmediatePropagation(); accept(); return; }
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault(); e.stopImmediatePropagation();
      active = (active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      show(root);
      return;
    }
    if (open && e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); hide(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) { prefix = ""; hide(); return; }
    if (e.key.length === 1 && WORD_CHAR.test(e.key)) { prefix += e.key; active = 0; setTimeout(() => show(root), 0); return; }
    if (e.key === "Backspace" && prefix) { prefix = prefix.slice(0, -1); active = 0; setTimeout(() => show(root), 0); return; }
    if (e.key === "Shift" || e.key === "CapsLock") return;
    prefix = "";
    hide();
  }, true);
  document.addEventListener("mousedown", (e) => { if (!box || !box.contains(e.target)) { prefix = ""; hide(); } }, true);

  // ---------- start ----------

  // LeetCode builds its editor after the page loads and rebuilds it when you
  // switch problems or languages, so keep checking for the Monaco API.
  let usingApi = false;
  function tick() { usingApi = useMonacoApi(); }
  setInterval(tick, 1000);
  tick();
})();
