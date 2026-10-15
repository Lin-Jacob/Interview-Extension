// Claude Messages API client used for hints, questions, and solutions.
// Raw fetch because extensions here ship without a bundler; the API key is the
// user's own and stays in browser.storage.local.
(function (root) {
  const API_URL = "https://api.anthropic.com/v1/messages";
  // Models that accept server-side refusal fallbacks on the Claude API.
  const FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];

  function buildSystemPrompt({ problem, weakTopics, hintsBeforeSolution }) {
    return [
      "You are a coding-interview tutor inside a browser extension on LeetCode.",
      "The student is preparing for technical interviews and must solve problems themselves; your job is to unblock them without giving the answer away.",
      "",
      "Each student turn starts with a tag:",
      `- [HINT k/${hintsBeforeSolution}] Give exactly one new hint that is a bit more specific than the previous ones. Hint 1 is a nudge (what to notice), middle hints name the technique or data structure and the key invariant, the last hint outlines the algorithm in plain words. Never write code in a hint. Keep it under 120 words.`,
      "- [QUESTION] Answer the student's question directly and briefly. If they ask for the solution or code, decline and offer a hint instead. You may point out bugs in their code by describing the problem, not by rewriting it.",
      "- [SOLUTION] The student has used every hint and chose to see the solution. Explain the approach, give clean, commented code in the student's language, state time and space complexity, and end with one line on the pattern to remember for similar problems.",
      "",
      "Use Markdown. Use fenced code blocks only for code.",
      weakTopics && weakTopics.length ? `The student's weakest topics right now: ${weakTopics.join(", ")}. When relevant, connect hints to these patterns.` : "",
      "",
      `Problem: ${problem.frontendId ? problem.frontendId + ". " : ""}${problem.title} (${problem.difficulty || "unknown difficulty"})`,
      problem.tags && problem.tags.length ? `LeetCode tags: ${problem.tags.join(", ")}` : "",
      "",
      "Problem statement:",
      problem.statement || "(not available — ask the student to describe it if needed)"
    ].filter((l) => l !== null).join("\n");
  }

  function userTurn({ kind, hintNumber, hintsBeforeSolution, text, code, language }) {
    let tag = "[QUESTION]";
    if (kind === "hint") tag = `[HINT ${hintNumber}/${hintsBeforeSolution}]`;
    if (kind === "solution") tag = "[SOLUTION]";
    const parts = [tag];
    if (text) parts.push(text);
    if (code) parts.push(`My current code${language ? ` (${language})` : ""}:\n\`\`\`${language || ""}\n${code}\n\`\`\``);
    return { role: "user", content: parts.join("\n\n") };
  }

  // Prompt for pasting into a claude.ai chat. The first message of a chat carries
  // the tutor instructions; later ones are just the tagged turn.
  function handoffPrompt({ system, turn, newChat, hintsAlreadyUsed }) {
    if (!newChat) return turn.content;
    const parts = [system, "---"];
    if (hintsAlreadyUsed) {
      parts.push(`(I already had ${hintsAlreadyUsed} hint(s) in an earlier chat, so continue from hint ${hintsAlreadyUsed + 1}.)`);
    }
    parts.push(turn.content);
    return parts.join("\n\n");
  }

  async function send({ apiKey, model, system, messages, effort }) {
    if (!apiKey) throw new Error("Add your Claude API key in the extension settings first.");
    const headers = {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    };
    const body = {
      model,
      max_tokens: 16000,
      system,
      messages,
      thinking: { type: "adaptive" },
      output_config: { effort }
    };
    if (FALLBACK_MODELS.includes(model)) {
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }
    const res = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json.error && json.error.message) || `HTTP ${res.status}`;
      if (res.status === 401) throw new Error("Claude rejected the API key. Check it in settings.");
      if (res.status === 429) throw new Error("Rate limited by the Claude API. Try again in a moment.");
      throw new Error(`Claude API error: ${msg}`);
    }
    if (json.stop_reason === "refusal") {
      throw new Error("Claude declined to answer this one. Try rephrasing your question.");
    }
    const text = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    // Keep the assistant content verbatim so thinking blocks replay unchanged next turn.
    return { text, assistantMessage: { role: "assistant", content: json.content || [] } };
  }

  const api = { buildSystemPrompt, userTurn, handoffPrompt, send, FALLBACK_MODELS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Claude = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
