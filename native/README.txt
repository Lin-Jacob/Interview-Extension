LeetCode Daily Lock - AI bridge (Claude Code or Codex)

Lets the extension ask Claude Code or OpenAI's Codex on this computer for
hints, lessons and grading, so they use your Claude or ChatGPT plan and the
answer appears in the extension. It also installs the game blocker, which
closes Steam, Epic, Riot and any games you list in the extension settings
until today's task is done.

1. Install one AI tool and sign in:
   Claude Code: https://claude.com/claude-code, then run `claude` once.
   Codex:       npm install -g @openai/codex, then run `codex login`
                and sign in with your ChatGPT account.
2. In this folder, run:   node install.js
3. Restart Firefox. In the extension settings pick your AI tool, then click
   "Test connection".

Remove it with:           node install.js --uninstall
(This also removes the game blocker.)
