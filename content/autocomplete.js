// Runs in the page's own JavaScript world on LeetCode problem pages (manifest
// "world": "MAIN") so it can reach LeetCode's Monaco editor. Turns on
// suggestions as you type and adds each language's keywords, common library
// names and a few snippets, on top of Monaco's suggestions from words already
// in the file. The extension's content script sets
// <html data-lcdl-autocomplete="on|off"> from the settings.
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

  const registered = new Set();
  const configured = new WeakSet();

  function register(monaco) {
    const { CompletionItemKind, CompletionItemInsertTextRule } = monaco.languages;
    for (const lang of Object.values(LANGS)) {
      for (const id of lang.ids) {
        if (registered.has(id)) continue;
        registered.add(id);
        monaco.languages.registerCompletionItemProvider(id, {
          provideCompletionItems(model, position) {
            if (document.documentElement.getAttribute(ATTR) === "off") return { suggestions: [] };
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

  function tick() {
    const monaco = window.monaco;
    if (!monaco || !monaco.editor || !monaco.languages) return;
    const on = document.documentElement.getAttribute(ATTR) !== "off";
    try { register(monaco); } catch (e) { /* older Monaco: keep the options at least */ }
    const editors = monaco.editor.getEditors ? monaco.editor.getEditors() : [];
    for (const ed of editors) {
      const want = on ? "on" : "off";
      if (configured.has(ed) && ed.__lcdlAuto === want) continue;
      ed.updateOptions(on
        ? { quickSuggestions: { other: true, comments: false, strings: false }, suggestOnTriggerCharacters: true,
            wordBasedSuggestions: "allDocuments", acceptSuggestionOnEnter: "smart", tabCompletion: "on", snippetSuggestions: "inline" }
        : { quickSuggestions: false, suggestOnTriggerCharacters: false, wordBasedSuggestions: "off" });
      configured.add(ed);
      ed.__lcdlAuto = want;
    }
  }

  // LeetCode builds its editor after the page loads and rebuilds it when you
  // switch problems or languages, so keep checking.
  setInterval(tick, 1000);
  tick();
})();
