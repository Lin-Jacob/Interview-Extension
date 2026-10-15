const test = require("node:test");
const assert = require("node:assert");
const Claude = require("../lib/claude.js");

test("system prompt carries the problem and hint budget", () => {
  const sys = Claude.buildSystemPrompt({
    problem: { frontendId: "1", title: "Two Sum", difficulty: "Easy", tags: ["Array"], statement: "Find two numbers." },
    weakTopics: ["Graphs (BFS/DFS)"], hintsBeforeSolution: 5
  });
  assert.match(sys, /1\. Two Sum \(Easy\)/);
  assert.match(sys, /\[HINT k\/5\]/);
  assert.match(sys, /Find two numbers\./);
  assert.match(sys, /Graphs \(BFS\/DFS\)/);
});

test("user turns are tagged and include code", () => {
  const t = Claude.userTurn({ kind: "hint", hintNumber: 2, hintsBeforeSolution: 5, code: "x = 1", language: "python" });
  assert.strictEqual(t.role, "user");
  assert.match(t.content, /^\[HINT 2\/5\]/);
  assert.match(t.content, /```python\nx = 1\n```/);
  assert.match(Claude.userTurn({ kind: "solution" }).content, /^\[SOLUTION\]/);
  assert.match(Claude.userTurn({ kind: "question", text: "why TLE?" }).content, /^\[QUESTION\]\n\nwhy TLE\?/);
});

test("send builds a valid request and keeps assistant content verbatim", async () => {
  let captured;
  global.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, json: async () => ({
      stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "Try a hash map." }]
    }) };
  };
  const r = await Claude.send({ apiKey: "k", model: "claude-opus-5-5", system: "s", messages: [{ role: "user", content: "hi" }], effort: "medium" });
  const body = JSON.parse(captured.init.body);
  assert.strictEqual(captured.url, "https://api.anthropic.com/v1/messages");
  assert.strictEqual(captured.init.headers["x-api-key"], "k");
  assert.strictEqual(captured.init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.strictEqual(captured.init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.deepStrictEqual(body.thinking, { type: "adaptive" });
  assert.deepStrictEqual(body.output_config, { effort: "medium" });
  assert.strictEqual(body.fallbacks, "default");
  assert.strictEqual(r.text, "Try a hash map.");
  assert.strictEqual(r.assistantMessage.content.length, 2);

  await Claude.send({ apiKey: "k", model: "claude-haiku-5-5", system: "s", messages: [], effort: "medium" });
  assert.strictEqual(JSON.parse(captured.init.body).fallbacks, undefined);
  assert.strictEqual(captured.init.headers["anthropic-beta"], undefined);
});

test("send surfaces refusals, auth errors, and a missing key", async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: "refusal", content: [] }) });
  await assert.rejects(Claude.send({ apiKey: "k", model: "m", system: "", messages: [] }), /declined/);
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "invalid x-api-key" } }) });
  await assert.rejects(Claude.send({ apiKey: "k", model: "m", system: "", messages: [] }), /API key/);
  await assert.rejects(Claude.send({ apiKey: "", model: "m", system: "", messages: [] }), /API key/);
});

test("handoff prompt carries instructions only on a new chat", () => {
  const turn = Claude.userTurn({ kind: "hint", hintNumber: 3, hintsBeforeSolution: 5 });
  assert.strictEqual(Claude.handoffPrompt({ system: "SYS", turn, newChat: false, hintsAlreadyUsed: 2 }), "[HINT 3/5]");
  const fresh = Claude.handoffPrompt({ system: "SYS", turn, newChat: true, hintsAlreadyUsed: 2 });
  assert.match(fresh, /^SYS\n\n---\n\n\(I already had 2 hint\(s\) in an earlier chat, so continue from hint 3\.\)\n\n\[HINT 3\/5\]$/);
});
