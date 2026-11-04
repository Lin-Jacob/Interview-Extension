#!/usr/bin/env node
// Starts the friends dashboard and puts it online through ngrok.
//   npm start            dashboard + ngrok tunnel (needs .env)
//   npm start -- --local dashboard on this computer only
//   node start.js --log  write output to data/dashboard.log (used by autostart.js)
// Settings come from .env next to this file (copy .env.example):
//   NGROK_AUTHTOKEN  from https://dashboard.ngrok.com/get-started/your-authtoken
//   NGROK_DOMAIN     your free static domain, like something.ngrok-free.app
//   DASHBOARD_USERS  optional logins, like Jacob:pass1,Sam:pass2 (see server.js)
//   PORT             optional, default 8787
"use strict";
const fs = require("fs");
const path = require("path");
const { createServer } = require("./server.js");

// Minimal .env reader: KEY=value lines, # comments, optional quotes. Values
// already set in the environment win.
function loadEnv(file) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return false; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}

function cleanDomain(d) {
  return String(d || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

// Background runs have no window, so output goes to a log file (cut back to
// the last ~200 KB when it passes 1 MB) and the process id is saved so
// autostart.js can stop it.
function logToFile() {
  const dir = path.join(__dirname, "data");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "dashboard.log");
  try {
    if (fs.statSync(file).size > 1024 * 1024) fs.writeFileSync(file, fs.readFileSync(file).subarray(-200 * 1024));
  } catch { /* new log */ }
  const write = (...a) => fs.appendFileSync(file, `[${new Date().toLocaleString()}] ${a.join(" ")}\n`);
  console.log = write;
  console.error = write;
  fs.writeFileSync(path.join(dir, "dashboard.pid"), String(process.pid));
  process.on("uncaughtException", (e) => { write(`Crashed: ${e.stack || e}`); process.exit(1); });
}

async function main() {
  if (process.argv.includes("--log")) logToFile();
  const hasEnv = loadEnv(path.join(__dirname, ".env"));
  const local = process.argv.includes("--local");
  const port = Number(process.env.PORT) || 8787;
  const server = createServer();
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  } catch (e) {
    console.error(e.code === "EADDRINUSE" ? `Port ${port} is busy. The dashboard is probably already running (maybe in the background from autostart).` : `Couldn't start: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Dashboard running at http://localhost:${port}`);
  const { createStore, syncAccountsFromEnv } = require("./server.js");
  const store = createStore();
  if (process.env.DASHBOARD_USERS !== undefined && process.env.DASHBOARD_USERS.trim()) {
    try {
      const r = syncAccountsFromEnv(store, process.env.DASHBOARD_USERS);
      const parts = [["Added", r.added], ["New password for", r.changed], ["Removed", r.removed]].filter(([, n]) => n.length).map(([w, n]) => `${w} ${n.join(", ")}`);
      console.log(`Logins from .env: ${Object.values(store.data().accounts).map((a) => a.name).join(", ")}.${parts.length ? ` ${parts.join(". ")}.` : ""}`);
    } catch (e) {
      console.error(`Couldn't read DASHBOARD_USERS in .env: ${e.message}`);
    }
  }
  if (!Object.keys(store.data().accounts).length) console.log("No logins yet. Add DASHBOARD_USERS=Name:password,Friend:password to .env, or run: npm run add-user -- <first name>");
  if (local) return;

  const token = (process.env.NGROK_AUTHTOKEN || "").trim();
  const domain = cleanDomain(process.env.NGROK_DOMAIN);
  if (!token || !domain) {
    console.error(`${hasEnv ? "" : "No .env file found. "}Put NGROK_AUTHTOKEN and NGROK_DOMAIN in ${path.join(__dirname, ".env")} (copy .env.example), then run npm start again.`);
    console.error("The dashboard is still running on this computer only.");
    return;
  }
  let ngrok;
  try {
    ngrok = require("@ngrok/ngrok");
  } catch {
    console.error("ngrok isn't installed yet. Run `npm install` in this folder, then `npm start`.");
    process.exitCode = 1;
    server.close();
    return;
  }
  try {
    const listener = await ngrok.forward({ addr: port, authtoken: token, domain });
    console.log(`Online at ${listener.url()}`);
    console.log("Give friends that link and the password you made them (npm run add-user -- <name>). They enter both in the extension settings under Practice with friends.");
    console.log("Leave this window open; closing it takes the dashboard offline.");
  } catch (e) {
    console.error(`ngrok couldn't start: ${e.message}`);
    console.error("Check NGROK_AUTHTOKEN and NGROK_DOMAIN in .env. The domain must be one you claimed at https://dashboard.ngrok.com/domains.");
    console.error("The dashboard is still running on this computer only.");
  }
}

if (require.main === module) main();
module.exports = { loadEnv, cleanDomain };
