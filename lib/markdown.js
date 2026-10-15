// Tiny Markdown-to-DOM renderer for Claude's replies. Builds nodes directly (no
// innerHTML), so model output can never inject markup into the page.
(function (root) {
  function inline(text, parent) {
    const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const tok = m[0];
      let el;
      if (tok.startsWith("`")) { el = document.createElement("code"); el.textContent = tok.slice(1, -1); }
      else if (tok.startsWith("**")) { el = document.createElement("strong"); el.textContent = tok.slice(2, -2); }
      else { el = document.createElement("em"); el.textContent = tok.slice(1, -1); }
      parent.appendChild(el);
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function render(md) {
    const frag = document.createDocumentFragment();
    const lines = String(md || "").replace(/\r/g, "").split("\n");
    let i = 0;
    let para = [];
    let list = null;
    const flushPara = () => {
      if (!para.length) return;
      const p = document.createElement("p");
      inline(para.join(" "), p);
      frag.appendChild(p);
      para = [];
    };
    const flushList = () => { if (list) { frag.appendChild(list); list = null; } };
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^\s*```(\w*)/);
      if (fence) {
        flushPara(); flushList();
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        i++;
        const pre = document.createElement("pre");
        const c = document.createElement("code");
        c.textContent = code.join("\n");
        pre.appendChild(c);
        frag.appendChild(pre);
        continue;
      }
      const h = line.match(/^(#{1,4})\s+(.*)/);
      const ul = line.match(/^\s*[-*]\s+(.*)/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (h) {
        flushPara(); flushList();
        const el = document.createElement("h4");
        inline(h[2], el);
        frag.appendChild(el);
      } else if (ul || ol) {
        flushPara();
        const tag = ul ? "UL" : "OL";
        if (!list || list.tagName !== tag) { flushList(); list = document.createElement(tag.toLowerCase()); }
        const li = document.createElement("li");
        inline((ul || ol)[1], li);
        list.appendChild(li);
      } else if (!line.trim()) {
        flushPara(); flushList();
      } else {
        flushList();
        para.push(line.trim());
      }
      i++;
    }
    flushPara(); flushList();
    return frag;
  }

  root.Markdown = { render };
})(typeof globalThis !== "undefined" ? globalThis : this);
