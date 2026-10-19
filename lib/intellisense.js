// Code completion for LeetCode's editor, in the spirit of VS Code IntelliSense.
// Pure functions (no DOM): given the code, the cursor's line and column and
// the language, work out what's being typed and rank suggestions.
//
// It reads the code the way a light language server would:
//   - classes and structs (including LeetCode's commented-out ListNode /
//     TreeNode definitions), with their fields and methods;
//   - variable types from annotations, declarations and assignments
//     (x = [], q = deque(), Map<..> m = new HashMap<>(), vector<int> v, ...);
//   - so after `node.` it lists TreeNode's val/left/right, after `self.` the
//     current class's attributes and methods, after `q.` deque methods, and so on.
// Without a dot it suggests locals, functions, classes, keywords and builtins.
(function (root) {
  const words = (s) => s.split(/\s+/).filter(Boolean);
  const K = { kw: "keyword", fn: "method", field: "field", var: "variable", cls: "class", mod: "module" };

  // ---------- built-in types and their members ----------

  const PY_TYPES = {
    list: { methods: words("append extend insert remove pop clear index count sort reverse copy") },
    dict: { methods: words("get keys values items pop popitem setdefault update clear copy fromkeys") },
    set: { methods: words("add remove discard pop clear union intersection difference symmetric_difference issubset issuperset isdisjoint update intersection_update difference_update copy") },
    str: { methods: words("join split rsplit strip lstrip rstrip lower upper isdigit isalpha isalnum isspace islower isupper startswith endswith find rfind index replace count format zfill center ljust rjust swapcase title capitalize splitlines partition encode") },
    deque: { methods: words("append appendleft pop popleft extend extendleft rotate clear count index insert remove reverse"), fields: words("maxlen") },
    Counter: { methods: words("most_common elements update subtract total get keys values items pop setdefault clear copy") },
    defaultdict: { methods: words("get keys values items pop setdefault update clear copy"), fields: words("default_factory") },
    int: { methods: words("bit_length bit_count to_bytes") },
    ListNode: { fields: words("val next") },
    TreeNode: { fields: words("val left right") },
    Node: { fields: words("val next random left right neighbors children") }
  };
  const PY_FIELD_TYPES = { ListNode: { next: "ListNode" }, TreeNode: { left: "TreeNode", right: "TreeNode" }, Node: { next: "Node", left: "Node", right: "Node", random: "Node" } };
  const PY_MODULES = {
    collections: words("defaultdict Counter deque OrderedDict namedtuple ChainMap"),
    heapq: words("heappush heappop heapify heappushpop heapreplace nlargest nsmallest merge"),
    math: words("inf sqrt isqrt ceil floor gcd lcm log log2 log10 pow comb perm factorial pi e fabs hypot"),
    bisect: words("bisect_left bisect_right bisect insort insort_left insort_right"),
    itertools: words("accumulate permutations combinations combinations_with_replacement product chain groupby zip_longest count cycle repeat islice pairwise"),
    functools: words("lru_cache cache reduce cmp_to_key partial"),
    string: words("ascii_lowercase ascii_uppercase ascii_letters digits punctuation"),
    sys: words("maxsize setrecursionlimit"),
    random: words("randint random choice shuffle sample")
  };
  const PY_KEYWORDS = words(`False None True and as assert break class continue def del elif else except finally for from global if
    import in is lambda nonlocal not or pass raise return try while with yield self`);
  const PY_BUILTINS = words(`len range enumerate zip sorted reversed min max sum abs all any map filter list dict set tuple str int
    float bool print isinstance ord chr divmod pow iter next hash id type frozenset round
    collections heapq math bisect itertools functools defaultdict Counter deque OrderedDict heappush heappop heapify
    lru_cache cache inf List Optional Dict Set Tuple ListNode TreeNode`);

  const JAVA_TYPES = {
    String: words("length charAt substring indexOf lastIndexOf contains equals equalsIgnoreCase compareTo isEmpty isBlank toCharArray toLowerCase toUpperCase trim strip split startsWith endsWith replace chars repeat hashCode"),
    StringBuilder: words("append insert deleteCharAt delete reverse toString length charAt setCharAt setLength indexOf"),
    List: words("add get set remove size isEmpty contains indexOf clear addAll sort subList stream forEach toArray iterator removeIf"),
    Map: words("put get getOrDefault containsKey containsValue remove size isEmpty keySet values entrySet putIfAbsent computeIfAbsent computeIfPresent merge clear forEach"),
    TreeMap: words("firstKey lastKey floorKey ceilingKey lowerKey higherKey firstEntry lastEntry pollFirstEntry pollLastEntry headMap tailMap subMap"),
    Set: words("add remove contains size isEmpty clear addAll retainAll removeAll stream iterator"),
    TreeSet: words("first last floor ceiling lower higher pollFirst pollLast headSet tailSet"),
    Deque: words("offer offerFirst offerLast poll pollFirst pollLast peek peekFirst peekLast push pop addFirst addLast removeFirst removeLast isEmpty size clear"),
    Queue: words("offer poll peek add remove isEmpty size clear"),
    PriorityQueue: words("offer poll peek add remove isEmpty size clear contains"),
    Stack: words("push pop peek isEmpty size empty search"),
    Entry: words("getKey getValue setValue"),
    Array: words("length"),
    Integer: words("MAX_VALUE MIN_VALUE parseInt valueOf toString bitCount toBinaryString compare max min sum"),
    Math: words("max min abs pow sqrt floor ceil round log random floorMod floorDiv"),
    Arrays: words("sort fill asList toString copyOf copyOfRange stream equals binarySearch"),
    Collections: words("sort reverse max min swap emptyList unmodifiableList frequency"),
    Character: words("isDigit isLetter isLetterOrDigit isUpperCase isLowerCase toUpperCase toLowerCase getNumericValue"),
    ListNode: words("val next"),
    TreeNode: words("val left right"),
    Node: words("val next random left right neighbors children")
  };
  const JAVA_ALIASES = { ArrayList: "List", LinkedList: ["List", "Deque"], HashMap: "Map", LinkedHashMap: "Map", HashSet: "Set", LinkedHashSet: "Set", ArrayDeque: "Deque", TreeMap: ["Map", "TreeMap"], TreeSet: ["Set", "TreeSet"], "Map.Entry": "Entry" };
  const JAVA_FIELD_TYPES = { ListNode: { next: "ListNode" }, TreeNode: { left: "TreeNode", right: "TreeNode" }, Node: { next: "Node", left: "Node", right: "Node", random: "Node" } };
  const JAVA_KEYWORDS = words(`abstract boolean break byte case catch char class continue default do double else enum extends final finally float
    for if implements import instanceof int interface long new null private protected public return short static super switch
    this throw throws try void while true false var String Integer Long Character Boolean Math Arrays Collections List ArrayList
    LinkedList Map HashMap TreeMap LinkedHashMap Set HashSet TreeSet Queue Deque ArrayDeque PriorityQueue Stack StringBuilder
    Comparator Objects ListNode TreeNode`);

  const CPP_TYPES = {
    vector: words("push_back emplace_back pop_back size empty clear begin end rbegin rend front back insert erase resize reserve assign at data"),
    string: words("size length empty substr find rfind push_back pop_back append insert erase replace begin end front back c_str compare at clear"),
    unordered_map: words("count find insert emplace erase size empty clear begin end at contains"),
    map: words("count find insert emplace erase size empty clear begin end at lower_bound upper_bound rbegin rend contains"),
    unordered_set: words("insert emplace count find erase size empty clear begin end contains"),
    set: words("insert emplace count find erase size empty clear begin end lower_bound upper_bound rbegin rend contains"),
    multiset: words("insert count find erase size empty clear begin end lower_bound upper_bound"),
    queue: words("push pop front back empty size emplace"),
    priority_queue: words("push pop top empty size emplace"),
    stack: words("push pop top empty size emplace"),
    deque: words("push_back push_front pop_back pop_front front back size empty clear begin end"),
    pair: words("first second"),
    ListNode: words("val next"),
    TreeNode: words("val left right"),
    Node: words("val next random left right neighbors children")
  };
  const CPP_FIELD_TYPES = { ListNode: { next: "ListNode" }, TreeNode: { left: "TreeNode", right: "TreeNode" }, Node: { next: "Node", left: "Node", right: "Node", random: "Node" } };
  const CPP_KEYWORDS = words(`auto bool break case char class const continue default delete do double else enum false float for if int long
    namespace new nullptr private protected public return short signed sizeof static struct switch template this true typedef
    unsigned using virtual void while std vector string unordered_map unordered_set map set multiset pair queue priority_queue
    stack deque make_pair sort reverse max min abs swap lower_bound upper_bound accumulate INT_MAX INT_MIN LLONG_MAX greater less
    ListNode TreeNode`);

  const JS_TYPES = {
    Array: words("length push pop shift unshift slice splice map filter reduce forEach some every find findIndex findLast indexOf lastIndexOf includes sort reverse join concat fill flat flatMap at keys values entries"),
    String: words("length charAt charCodeAt codePointAt slice substring indexOf lastIndexOf includes startsWith endsWith split toLowerCase toUpperCase trim padStart padEnd repeat replace replaceAll at"),
    Map: words("get set has delete clear size keys values entries forEach"),
    Set: words("add has delete clear size keys values entries forEach"),
    Math: words("max min abs floor ceil round sqrt pow log2 log10 trunc sign random hypot PI"),
    Number: words("MAX_SAFE_INTEGER MIN_SAFE_INTEGER isInteger parseInt parseFloat"),
    Object: words("keys values entries assign fromEntries freeze"),
    ListNode: words("val next"),
    TreeNode: words("val left right"),
    _Node: words("val next random left right neighbors children")
  };
  const JS_FIELD_TYPES = { ListNode: { next: "ListNode" }, TreeNode: { left: "TreeNode", right: "TreeNode" } };
  const JS_KEYWORDS = words(`async await break case catch class const continue default delete do else export extends false finally for function
    if import in instanceof let new null return super switch this throw true try typeof undefined var void while of
    Array Map Set Object Math Number String JSON Infinity ListNode TreeNode`);

  const SQL_KEYWORDS = words(`SELECT FROM WHERE AND OR NOT IN IS NULL AS JOIN INNER LEFT RIGHT FULL OUTER CROSS ON USING GROUP BY ORDER HAVING
    LIMIT OFFSET DISTINCT UNION ALL EXISTS BETWEEN LIKE CASE WHEN THEN ELSE END WITH RECURSIVE OVER PARTITION ASC DESC
    INSERT INTO VALUES UPDATE SET DELETE COUNT SUM AVG MIN MAX ROUND IFNULL COALESCE NULLIF CONCAT GROUP_CONCAT SUBSTRING
    LENGTH UPPER LOWER TRIM DATE_FORMAT DATEDIFF DATE_ADD DATE_SUB YEAR MONTH DAY NOW CAST ROW_NUMBER RANK DENSE_RANK LAG
    LEAD FIRST_VALUE REGEXP INTERVAL`);

  // ---------- helpers ----------

  const ID = /[A-Za-z_][A-Za-z0-9_]*/g;
  const add = (map, key, kind) => { if (key && !map.has(key)) map.set(key, kind); };

  // Text before the cursor on the current line, split into the word being
  // typed and (if it follows a dot or ->) the expression it's a member of.
  function context(line, col) {
    const before = line.slice(0, col);
    const m = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
    const prefix = m ? m[0] : "";
    const rest = before.slice(0, before.length - prefix.length);
    const dot = rest.match(/((?:[A-Za-z_][A-Za-z0-9_]*(?:\(\))?(?:\[[^\]]*\])?\s*(?:\.|->)\s*)*[A-Za-z_][A-Za-z0-9_]*(?:\(\))?(?:\[[^\]]*\])?)\s*(\.|->)\s*$/);
    if (!dot) return { prefix, chain: null };
    const chain = dot[1].split(/\s*(?:\.|->)\s*/).map((p) => p.replace(/\(\)$/, "()").trim());
    return { prefix, chain };
  }

  // Lines with comment markers removed, so LeetCode's commented-out
  // "Definition for a binary tree node" classes are understood too.
  function uncomment(code) {
    return code.split("\n").map((l) => l.replace(/^(\s*)(#|\/\/|\*|\/\*\*?)\s?/, "$1"));
  }
  const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, "    ").length;

  // ---------- Python ----------

  function pyAnalyze(code, lineNo) {
    const lines = uncomment(code);
    const classes = {}; // name -> { fields:Set, methods:Set, types:{} , start, end, indent }
    const vars = {};    // name -> type
    const elems = {};   // container name -> element type (queue of TreeNode, List[ListNode], ...)
    const locals = new Map();
    let current = null;
    lines.forEach((l, i) => {
      const ind = indentOf(l);
      const c = l.match(/^\s*class\s+(\w+)/);
      if (current && l.trim() && ind <= current.indent && !c) current.end = i - 1, current = null;
      if (c) {
        if (current) current.end = i - 1;
        current = classes[c[1]] = { fields: new Set(), methods: new Set(), types: {}, start: i, end: lines.length - 1, indent: ind };
        add(locals, c[1], K.cls);
        return;
      }
      const d = l.match(/^\s*def\s+(\w+)\s*\(([^)]*)/);
      if (d) {
        if (current && ind > current.indent) current.methods.add(d[1]); else add(locals, d[1], K.fn);
        for (const p of d[2].split(",")) {
          const pm = p.match(/^\s*(\w+)\s*(?::\s*([\w.\[\], ]+))?/);
          if (pm && pm[1] !== "self") {
            add(locals, pm[1], K.var);
            if (pm[2]) { vars[pm[1]] = pyTypeName(pm[2]); const el = pyElemName(pm[2]); if (el) elems[pm[1]] = el; }
          }
        }
      }
      for (const m of l.matchAll(/self\.(\w+)\s*(?::\s*([\w.\[\], ]+?))?\s*=(?!=)\s*(.*)/g)) {
        if (current) { current.fields.add(m[1]); const t = m[2] ? pyTypeName(m[2]) : pyExprType(m[3], vars); if (t) current.types[m[1]] = t; }
      }
      for (const m of l.matchAll(/(?:^|[;\s(,])(\w+)\s*(?::\s*([\w.\[\], ]+?))?\s*=(?!=)\s*(.*)/g)) {
        if (/^(self|if|while|return)$/.test(m[1])) continue;
        add(locals, m[1], K.var);
        const t = m[2] ? pyTypeName(m[2]) : pyExprType(m[3], vars, elems);
        if (t) vars[m[1]] = t;
        const el = m[2] ? pyElemName(m[2]) : pyExprElem(m[3], vars);
        if (el) elems[m[1]] = el;
      }
      for (const m of l.matchAll(/for\s+(\w+)(?:\s*,\s*(\w+))?\s+in\s+(enumerate\()?\s*([\w.]+)/g)) {
        add(locals, m[1], K.var);
        if (m[2]) add(locals, m[2], K.var);
        const src = m[4].replace(/^self\./, "");
        const el = elems[src] || (current && current.elems && current.elems[src]);
        if (el) vars[m[2] && m[3] ? m[2] : m[1]] = el;
      }
      for (const m of l.matchAll(/\b(\w+)\s*,\s*(\w+)\s*=(?!=)/g)) { add(locals, m[1], K.var); add(locals, m[2], K.var); }
    });
    const here = Object.entries(classes).find(([, c]) => lineNo >= c.start && lineNo <= c.end);
    return { classes, vars, locals, currentClass: here ? here[0] : null };
  }

  function pyTypeName(t) {
    t = t.trim().replace(/^Optional\[(.*)\]$/, "$1").replace(/^['"]|['"]$/g, "");
    const m = t.match(/^(?:typing\.)?(\w+)/);
    if (!m) return null;
    const map = { List: "list", Dict: "dict", Set: "set", Deque: "deque", DefaultDict: "defaultdict" };
    return map[m[1]] || m[1];
  }

  // Element type of a container annotation: List[TreeNode], Deque[ListNode], ...
  function pyElemName(t) {
    const m = t.match(/\[\s*(?:Optional\[)?\s*['"]?([A-Z]\w*)/);
    return m && !/^(List|Dict|Set|Optional|Tuple)$/.test(m[1]) ? m[1] : null;
  }
  // Element type of a container built from known values: [root], deque([root]), ...
  function pyExprElem(e, vars) {
    const m = (e || "").trim().match(/^(?:(?:collections\.)?deque\(\s*)?\[\s*(?:\(\s*)?(\w+)/);
    return m && vars[m[1]] && /^[A-Z]/.test(vars[m[1]]) ? vars[m[1]] : null;
  }

  function pyExprType(e, vars, elems = {}) {
    e = (e || "").trim();
    const take = e.match(/^(?:self\.)?(\w+)(?:\.(?:pop|popleft)\([^)]*\)|\[[^\]]*\])(?:\s*$|\s*#)/);
    if (take && elems[take[1]]) return elems[take[1]];
    if (/^\[/.test(e) || /^list\(/.test(e) || /^sorted\(/.test(e)) return "list";
    if (/^\{\s*\}/.test(e) || /^dict\(/.test(e) || /^\{[^}]*:/.test(e)) return "dict";
    if (/^set\(/.test(e) || /^\{[^:}]+\}/.test(e)) return "set";
    if (/^(['"]|str\(|f['"])/.test(e) || /\.join\(/.test(e)) return "str";
    if (/^(collections\.)?deque\(/.test(e)) return "deque";
    if (/^(collections\.)?Counter\(/.test(e)) return "Counter";
    if (/^(collections\.)?defaultdict\(/.test(e)) return "defaultdict";
    if (/^-?\d+$/.test(e) || /^(len|int)\(/.test(e)) return "int";
    const ctor = e.match(/^(\w+)\(/);
    if (ctor && /^[A-Z]/.test(ctor[1])) return ctor[1];
    const alias = e.match(/^(\w+)$/);
    if (alias && vars[alias[1]]) return vars[alias[1]];
    return null;
  }

  function pyMembers(chain, a) {
    if (chain.length === 1 && PY_MODULES[chain[0]]) return PY_MODULES[chain[0]].map((w) => [w, K.fn]);
    let type = null;
    const [head, ...rest] = chain;
    if (head === "self") type = a.currentClass;
    else if (/^["']/.test(head)) type = "str";
    else type = a.vars[head.replace(/\(\)$|\[.*\]$/g, "")] || (a.classes[head] ? head : null);
    for (const part of rest) type = memberType(type, part, a.classes, PY_FIELD_TYPES);
    return typeMembers(type, a.classes, (t) => PY_TYPES[t] && { fields: PY_TYPES[t].fields || [], methods: PY_TYPES[t].methods || [] });
  }

  // ---------- Java / C++ / JavaScript (C-like) ----------

  function cAnalyze(code, lineNo, lang) {
    const lines = uncomment(code);
    const classes = {};
    const vars = {};
    const elems = {};
    const locals = new Map();
    const stack = [];
    let depth = 0;
    lines.forEach((l, i) => {
      const c = l.match(/\b(?:class|struct)\s+(\w+)/) || (lang === "javascript" && l.match(/^\s*(?:var|const|let)?\s*(\w+)\s*=\s*function\s*\(|^\s*function\s+([A-Z]\w*)\s*\(/));
      if (c) {
        const name = c[1] || c[2];
        classes[name] = classes[name] || { fields: new Set(), methods: new Set(), types: {}, start: i, end: lines.length - 1, depth };
        add(locals, name, K.cls);
        stack.push(name);
      }
      const cls = stack.length ? classes[stack[stack.length - 1]] : null;
      // Declarations: Type name [= ...]
      const declRe = lang === "cpp"
        ? /\b((?:std::)?\w+(?:<[^;()=]*>)?)\s*([*&]?)\s*(\w+)\s*(?=[=;,)({[])/g
        : lang === "java"
          ? /\b([A-Z]\w*(?:\.\w+)?(?:<[^;()=]*>)?(?:\[\])*|int\[\](?:\[\])*|char\[\]|long\[\]|boolean\[\]|double\[\])\s+(\w+)\s*(?=[=;,)])/g
          : /\b(?:const|let|var)\s+(\w+)\s*(?::\s*([\w<>\[\], ]+?))?\s*=\s*([^;]*)/g;
      for (const m of l.matchAll(declRe)) {
        if (lang === "javascript") {
          add(locals, m[1], K.var);
          const t = m[2] ? jsTypeName(m[2]) : jsExprType(m[3]);
          if (t) vars[m[1]] = t;
          continue;
        }
        const type = lang === "cpp" ? m[1] : m[1];
        const name = lang === "cpp" ? m[3] : m[2];
        if (/^(return|new|delete|else|case|using|namespace|public|private|static|const|class|struct|if|while|for)$/.test(type)) continue;
        if (/^(if|while|for|return)$/.test(name)) continue;
        add(locals, name, K.var);
        vars[name] = cTypeName(type, lang);
        const g = type.match(/<\s*(?:std::)?(\w+)/);
        if (g) elems[name] = g[1];
        else if (/\[\]$/.test(type)) elems[name] = type.replace(/\[\]/g, "");
        else if (lang === "cpp" && /^(vector|queue|stack|deque)$/.test(type)) elems[name] = null;
        if (cls && depth === cls.depth + 1) { cls.fields.add(name); cls.types[name] = cTypeName(type, lang); }
      }
      // JS/TS params and class fields
      if (lang === "javascript") {
        for (const m of l.matchAll(/function\s*\w*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>/g)) {
          for (const p of (m[1] || m[2] || "").split(",")) {
            const pm = p.match(/^\s*(\w+)\s*(?::\s*([\w<>\[\]| ]+))?/);
            if (pm) { add(locals, pm[1], K.var); if (pm[2]) vars[pm[1]] = jsTypeName(pm[2]); }
          }
        }
        for (const m of l.matchAll(/this\.(\w+)\s*=(?!=)\s*([^;]*)/g)) {
          if (cls) { cls.fields.add(m[1]); const t = jsExprType(m[2]); if (t) cls.types[m[1]] = t; }
        }
        for (const m of l.matchAll(/@param\s*\{([^}]+)\}\s*(\w+)/g)) vars[m[2]] = jsTypeName(m[1]);
      }
      // Methods: name(...) { at class level
      const meth = lang === "javascript" ? l.match(/^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/) : l.match(/\b[\w<>\[\],*& ]+\s+(\w+)\s*\([^;]*\)\s*(?:const\s*)?\{?\s*$/);
      if (meth && !/^(if|for|while|switch|catch|function)$/.test(meth[1])) {
        if (cls && depth === cls.depth + 1) cls.methods.add(meth[1]); else add(locals, meth[1], K.fn);
      }
      for (const m of l.matchAll(/for\s*\(\s*(?:const\s+)?(auto|var|int|char|[A-Z]\w*)\s*[&*]?\s*(\w+)\s*:\s*(\w+)/g)) {
        add(locals, m[2], K.var);
        if (/^(auto|var)$/.test(m[1]) && elems[m[3]]) vars[m[2]] = elems[m[3]];
      }
      // auto x = q.front(); var x = q.poll(); auto x = v[i];
      for (const m of l.matchAll(/\b(?:auto|var)\s*[&*]?\s*(\w+)\s*=\s*(\w+)(?:\s*(?:\.|->)\s*(?:front|back|top|poll|peek|pop|pollFirst|pollLast|peekFirst|peekLast|get|remove|removeFirst|removeLast)\s*\(|\s*\[)/g)) {
        if (elems[m[2]]) vars[m[1]] = elems[m[2]];
      }
      depth += (l.match(/{/g) || []).length - (l.match(/}/g) || []).length;
      while (stack.length && depth <= classes[stack[stack.length - 1]].depth && l.includes("}")) {
        classes[stack.pop()].end = i;
      }
    });
    const here = Object.entries(classes).filter(([, c]) => lineNo >= c.start && lineNo <= c.end).pop();
    return { classes, vars, locals, currentClass: here ? here[0] : null };
  }

  function cTypeName(t, lang) {
    t = t.replace(/^std::/, "").trim();
    if (/\[\]$/.test(t)) return "Array";
    const m = t.match(/^(\w+(?:\.\w+)?)/);
    return m ? m[1] : null;
  }
  function jsTypeName(t) {
    t = t.trim();
    if (/\[\]$|^Array</.test(t)) return "Array";
    if (/^string$/i.test(t)) return "String";
    const m = t.match(/^(\w+)/);
    return m ? m[1] : null;
  }
  function jsExprType(e) {
    e = (e || "").trim();
    if (/^\[|^Array\.|^new Array/.test(e) || /\.split\(/.test(e)) return "Array";
    if (/^['"`]/.test(e) || /\.join\(/.test(e)) return "String";
    const n = e.match(/^new\s+(\w+)/);
    return n ? n[1] : null;
  }

  function cMembers(chain, a, lang) {
    const TYPES = lang === "java" ? JAVA_TYPES : lang === "cpp" ? CPP_TYPES : JS_TYPES;
    const FT = lang === "java" ? JAVA_FIELD_TYPES : lang === "cpp" ? CPP_FIELD_TYPES : JS_FIELD_TYPES;
    const [head, ...rest] = chain;
    const bare = head.replace(/\(\)$|\[.*\]$/g, "");
    let type;
    if (head === "this") type = a.currentClass;
    else if (/\[.*\]$/.test(head) && a.vars[bare] === "Array") type = null;
    else type = a.vars[bare] || (TYPES[bare] || a.classes[bare] ? bare : null);
    for (const part of rest) type = memberType(type, part, a.classes, FT);
    const builtin = (t) => {
      const names = [].concat(lang === "java" && JAVA_ALIASES[t] ? JAVA_ALIASES[t] : t);
      const out = names.flatMap((n) => TYPES[n] || []);
      if (lang === "java" && (t === "TreeMap" || t === "LinkedList" || t === "TreeSet")) out.push(...(TYPES[t] || []));
      if (!out.length) return null;
      const isField = (w) => /^(val|next|left|right|random|neighbors|children|first|second|length|size|MAX_VALUE|MIN_VALUE|PI|MAX_SAFE_INTEGER|MIN_SAFE_INTEGER)$/.test(w) && !(lang === "java" && w === "size") && !(lang === "cpp" && w === "size");
      return { fields: out.filter(isField), methods: out.filter((w) => !isField(w)) };
    };
    return typeMembers(type, a.classes, builtin);
  }

  // ---------- shared ----------

  function memberType(type, part, classes, fieldTypes) {
    if (!type) return null;
    const name = part.replace(/\(\)$|\[.*\]$/g, "");
    if (classes[type] && classes[type].types[name]) return classes[type].types[name];
    if (fieldTypes[type] && fieldTypes[type][name]) return fieldTypes[type][name];
    return null;
  }

  function typeMembers(type, classes, builtin) {
    const out = [];
    if (!type) return null;
    if (classes[type]) {
      for (const f of classes[type].fields) out.push([f, K.field]);
      for (const m of classes[type].methods) if (!/^__/.test(m)) out.push([m, K.fn]);
    }
    const b = builtin(type);
    if (b) { for (const f of b.fields) out.push([f, K.field]); for (const m of b.methods) out.push([m, K.fn]); }
    return out.length ? out : null;
  }

  // Every name used after a dot anywhere in the code: a fallback when the
  // receiver's type can't be worked out.
  function seenMembers(code, a, lang) {
    const out = new Map();
    for (const c of Object.values(a.classes)) {
      for (const f of c.fields) add(out, f, K.field);
      for (const m of c.methods) if (!/^__/.test(m)) add(out, m, K.fn);
    }
    const modules = lang === "python" ? PY_MODULES : {};
    const re = lang === "python" ? /(\w+)\.\s*([A-Za-z_]\w*)/g : /(\w+)\s*(?:\.|->)\s*([A-Za-z_]\w*)/g;
    for (const m of code.matchAll(re)) if (!modules[m[1]] && !/^(std|Math|Arrays|Collections|Integer|System)$/.test(m[1])) add(out, m[2], K.field);
    return [...out];
  }

  // ---------- ranking (VS Code-style fuzzy match) ----------

  // Higher is better; null means no match. Exact-case prefix beats any-case
  // prefix beats camelCase/underscore initials beats a plain subsequence.
  function score(word, prefix) {
    if (!prefix) return 1;
    if (word.startsWith(prefix)) return 1000 - word.length;
    const lw = word.toLowerCase(), lp = prefix.toLowerCase();
    if (lw.startsWith(lp)) return 800 - word.length;
    let wi = 0, gaps = 0, boundaryHits = 0;
    for (const ch of lp) {
      const at = lw.indexOf(ch, wi);
      if (at < 0) return null;
      if (at === 0 || word[at - 1] === "_" || (word[at] >= "A" && word[at] <= "Z")) boundaryHits++;
      gaps += at - wi;
      wi = at + 1;
    }
    if (lw[0] !== lp[0]) return null;
    return 400 + boundaryHits * 20 - gaps * 5 - word.length;
  }

  // ---------- main entry ----------

  const KIND_ORDER = { field: 0, method: 1, variable: 2, class: 3, module: 4, keyword: 5 };

  // code: whole file; lineNo: 0-based; col: 0-based column of the cursor;
  // lang: python | java | cpp | javascript | sql; extra: more words (e.g. SQL
  // table and column names from the problem statement).
  function complete({ code, lineNo, col, lang, extra = [] }) {
    const lines = code.split("\n");
    const line = lines[lineNo] || "";
    const { prefix, chain } = context(line, col);
    const inMember = !!chain;
    if (!inMember && !prefix) return { prefix, items: [] };
    // Don't suggest inside a number or right after a closing quote/digit.
    if (/^\d/.test(prefix)) return { prefix, items: [] };

    let candidates = [];
    if (lang === "sql") {
      const names = new Map();
      for (const w of extra) add(names, w, K.field);
      for (const m of code.matchAll(ID)) if (!SQL_KEYWORDS.includes(m[0].toUpperCase())) add(names, m[0], K.var);
      candidates = inMember ? [...names].filter(([, k]) => k === K.field) : [...names, ...SQL_KEYWORDS.map((w) => [w, K.kw])];
      if (inMember && !candidates.length) candidates = [...names];
    } else {
      const a = lang === "python" ? pyAnalyze(code, lineNo) : cAnalyze(code, lineNo, lang);
      if (inMember) {
        const members = lang === "python" ? pyMembers(chain, a) : cMembers(chain, a, lang);
        candidates = members || seenMembers(code, a, lang);
      } else {
        const kws = lang === "python" ? PY_KEYWORDS.concat(PY_BUILTINS) : lang === "java" ? JAVA_KEYWORDS : lang === "cpp" ? CPP_KEYWORDS : JS_KEYWORDS;
        const ids = new Map(a.locals);
        for (const m of code.matchAll(ID)) if (m[0].length > 2) add(ids, m[0], K.var);
        candidates = [...ids, ...kws.map((w) => [w, K.kw])];
      }
    }

    const counts = {};
    for (const m of code.matchAll(ID)) counts[m[0]] = (counts[m[0]] || 0) + 1;
    const seen = new Set();
    const ranked = [];
    for (const [word, kind] of candidates) {
      if (seen.has(word)) continue;
      seen.add(word);
      // The word being typed is in the code too; only offer it back if it's a
      // real member/keyword or appears somewhere else.
      if (word === prefix && kind === K.var && (counts[word] || 0) < 2) continue;
      const s = word === prefix ? 2000 : score(word, prefix);
      if (s === null) continue;
      ranked.push({ word, kind, score: s });
    }
    ranked.sort((x, y) => y.score - x.score || KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || x.word.localeCompare(y.word));
    return { prefix, items: ranked.slice(0, 12).map(({ word, kind }) => ({ word, kind })) };
  }

  const api = { complete, context, score };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LcdlIntellisense = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
