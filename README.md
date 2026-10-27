# LeetCode Daily Lock (Firefox)

Blocks distracting sites every day until today's prep task is done. Most days that's one LeetCode
problem from your weakest topics; other days it's a short system design lesson with a graded quiz, or a
behavioral interview question with feedback. Adds an "Ask Claude" tutor on every problem page and a
stats page to track your streak.

## Install
Download `interview-extension-<version>.xpi` from the latest
[release](https://github.com/Lin-Jacob/Interview-Extension/releases/latest) and open it in Firefox.
After that, Firefox updates it on its own (it checks about once a day; to check now, open
`about:addons`, click the gear icon and choose **Check for Updates**).

Releases are made by GitHub Actions: every push to `main` runs the tests, and when `manifest.json` has a
new version, the workflow signs it on addons.mozilla.org as an unlisted add-on and publishes the release
with `updates.json`, which Firefox polls through `update_url`. Signing uses the `AMO_JWT_ISSUER` and
`AMO_JWT_SECRET` repository secrets (Settings → Secrets and variables → Actions). Bump the version in
`manifest.json` for each release; AMO won't sign the same version twice.

## First run
1. The settings page opens. Click **Allow access** if shown (LeetCode + Claude API).
2. Sign in to leetcode.com in Firefox (or type your username in settings).
3. Edit the blocked-site list.
4. Set up the Claude Code bridge (below) so hints use your Pro plan and answer inside the panel.

## Claude Code bridge (hints on your Pro plan)
The extension can't use a Pro subscription directly, but Claude Code can. The bridge lets Firefox ask
Claude Code on your computer for each hint, and the answer shows up in the LeetCode panel.

1. Install Claude Code (https://claude.com/claude-code), run `claude` in a terminal once, and sign in with your Pro account.
2. Unzip `leetcode-daily-lock-bridge.zip` anywhere and run `node install.js` inside it (Node.js 18+).
   It finds Claude Code, registers the bridge with Firefox for your user only, and sends one tiny test message.
3. Restart Firefox. In the extension settings, keep "Claude Code on this computer" selected and click **Test connection**.

Hints count against your Pro usage limits like claude.ai does. Each problem keeps its own conversation,
so later hints build on earlier ones. Claude Code runs with all tools turned off, in its own empty folder
(`~/.leetcode-daily-lock/workspace`), so it only talks and never touches your files.
To remove it: `node install.js --uninstall`.

## Game blocker (Windows)
The bridge install also sets up a small background program (`gameguard.js`) that closes games and game
launchers until today's task is done. By default it closes Steam, Epic Games Launcher, the Riot Client,
League of Legends and VALORANT, plus anything installed under `\steamapps\common\`, `\Epic Games\`
or `\Riot Games\`. Edit the list or turn it off in the extension settings (a program name like
`minecraft.exe`, or a folder). A game that's already open when blocking starts (at midnight, or when you install or turn it on)
keeps running until you close it, including a match it starts from its own folder, like League from its
client. Opening anything new gets it closed, and that includes a game started from a Steam window that was
already open. It checks every 10 seconds, starts when you sign in to Windows, and Task
Scheduler restarts it every 5 minutes if it's closed. Firefox tells it about your progress through the
bridge, so on a day Firefox hasn't reported the task as done, games stay closed. At midnight a new day
starts and games close again until that day's task is done. Each time it closes a game, Firefox opens a page that names the game and lists today's task, within about a
minute (the extension checks the bridge every minute and opens the tab itself, so it lands in the Firefox
profile you use). A log of what it closed is in
`~/.leetcode-daily-lock/gameguard.log`. It isn't tamper-proof: deleting the scheduled task or
uninstalling the bridge turns it off.

Other options in settings: **Open claude.ai** copies the prompt and opens a claude.ai tab for you to paste
into, and **API key** answers in the panel and is billed per use.

## How it works
- **Daily rotation:** one task a day, set per weekday in settings. Default: LeetCode on Sun, Mon and Wed;
  system design on Tue and Thu; SQL on Fri; behavioral on Sat. Extra practice is always optional.
- **SQL days:** one problem a day from LeetCode's Top SQL 50 study plan, in order (Select, joins,
  aggregates, grouping, subqueries, string functions). The Ask Claude tutor works on them too.
- **System design lessons:** 49 lessons in order, from how the web works through caching, databases,
  SQL, schema design, query performance, queues and consistency to case studies (URL shortener, chat, news feed, payments) and team practices.
  Claude writes each one as a short 2–3 minute reading with 3 quiz questions; you type answers and Claude grades them.
  Lessons under 60% come back for review a week later.
- **Behavioral practice:** 30 questions, including communication ones like "explain a hash map to a
  non-engineer". Claude scores your answer out of 10, lists what worked and what to improve, and rewrites
  a stronger version that keeps your facts. Low scores come back after 5 days.
- **Stats:** current and longest streak, goal days in the last 30, a 26-week practice calendar, activity
  per week, LeetCode by difficulty and topic, hint-free rate, quiz averages and a full history.
- Lessons and grading need Claude Code (or an API key); the claude.ai copy mode can't send answers back.
- **Progress:** solves come from LeetCode's recent accepted submissions (synced every 5 minutes) plus
  instant detection when you submit and get "Accepted". The toolbar badge shows `done/goal` or ✓.
- **Blocking:** until the goal is met, any page on a blocked domain (and its subdomains) is replaced
  with a "Solve first" page listing today's problems. It unblocks automatically once you're done.
- **Assessment:** starts on install. It pulls your per-topic solve counts from LeetCode, then assigns one
  problem from each of 17 core topics, least-practiced topics first. Your LeetCode days come from it;
  the dashboard lists the rest if you want to go faster.
- **Warm-up ramp (on by default):** week 1 is Easy only. Days 8–14 add an occasional Medium,
  days 15–28 are half Medium, and days 29–42 are Medium. Hards return after day 42.
  Only days you hit your goal count, so skipped days don't speed it up. Toggle it in settings.
- **Strengths:** each topic's score blends LeetCode history with how you do here: a clean solve scores
  100%, each hint costs 12%, a revealed solution scores 0. After the assessment, daily picks target your
  weakest topics at a matching difficulty (Easy below 35%, Medium below 70%, Hard above).
- **IntelliSense in LeetCode's editor:** a VS Code-style suggestion list with the selected suggestion
  previewed as ghost text (Tab or Enter accepts, arrows move, Esc dismisses, Ctrl+Space asks). It reads
  your code to know classes, fields and methods (including LeetCode's commented-out ListNode/TreeNode
  definitions) and variable types, so `node.` after `node = queue.popleft()` lists `val`, `left`, `right`.
  Works for Python, Java, C++, JavaScript/TypeScript and SQL (table and column names from the problem).
  Turn it off in settings.
- **Claude tutor:** "Ask Claude" on any problem page. Hints get more specific each time and see your
  current code; after 5 hints the **Show solution** button unlocks. You can also ask free-form questions.
  By default a problem whose solution you revealed doesn't count toward the daily goal (changeable in settings).

## Development
```
npm install
npm test                 # unit + background integration tests
npm run lint
npm run build            # unsigned zip in dist/
npx web-ext run          # launches Firefox with the extension loaded
```
