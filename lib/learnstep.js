// Runs one lesson or grading step from the learn page. Claude Code can take a
// minute or more to write a lesson or grade an answer, longer than Firefox keeps
// an idle event page alive, so the background page hands back the prompt
// (`ask`) and the learn page, which stays open while the user waits, calls the
// bridge itself and sends the reply back to be checked and saved.
(function (root) {
  const NATIVE_HOST = "leetcode_daily_lock_claude";

  function bridgeError(e) {
    const m = String((e && e.message) || e);
    if (/no such native application|not found|access to the specified native/i.test(m)) {
      return new Error("The Claude Code bridge isn't installed yet. Open the extension settings for the one-time setup.");
    }
    return new Error(`Couldn't reach the Claude Code bridge: ${m}`);
  }

  // Asks the bridge, resuming the step's Claude Code conversation when there is
  // one; if it's gone, starts a new one with the saved context.
  async function askBridge(sendNative, ask) {
    const call = async (m) => {
      let r;
      try { r = await sendNative(NATIVE_HOST, m); } catch (e) { throw bridgeError(e); }
      if (!r || !r.ok) throw new Error((r && r.error) || "The Claude Code bridge returned nothing.");
      return r;
    };
    if (ask.sessionId) {
      try { return await call({ type: "ask", system: ask.system, prompt: ask.prompt, sessionId: ask.sessionId }); }
      catch (e) { if (!/conversation|session/i.test(e.message)) throw e; }
    }
    return call({ type: "ask", system: ask.system, prompt: (ask.context ? ask.context + "\n\n" : "") + ask.prompt });
  }

  // `send` posts a message to the background page and returns its result.
  async function runLearnStep(send, sendNative, msg) {
    const first = await send(msg);
    if (!first || !first.ask) return first;
    const r = await askBridge(sendNative, first.ask);
    return send({ ...msg, reply: { text: String(r.text || ""), sessionId: r.sessionId || null } });
  }

  const api = { runLearnStep, askBridge, NATIVE_HOST };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LearnStep = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
