// Claude Messages API client used for hints, questions, and solutions.
// Raw fetch because extensions here ship without a bundler; the API key is the
// user's own and stays in browser.storage.local.
(function (root) {
  const API_URL = "https://api.anthropic.com/v1/messages";
  // Models that accept server-side refusal fallbacks on the Claude API.
  const FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];

  // The prompt wording lives in lib/prompts.js so every AI tool gets the same words.
  const P = typeof module !== "undefined" && module.exports ? require("./prompts.js") : root.Prompts;

  function buildSystemPrompt(opts) { return P.tutorSystem(opts); }

  function userTurn(opts) { return { role: "user", content: P.tutorTurn(opts) }; }

  // Prompt for pasting into a claude.ai chat. The first message of a chat carries
  // the tutor instructions; later ones are just the tagged turn.
  function handoffPrompt({ system, turn, newChat, hintsAlreadyUsed }) {
    if (!newChat) return turn.content;
    const parts = [system, "---"];
    if (hintsAlreadyUsed) {
      parts.push(P.hintsAlreadyUsedNote(hintsAlreadyUsed));
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
