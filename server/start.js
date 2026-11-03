#!/usr/bin/env node
// Starts the friends dashboard and puts it online through ngrok.
//   npm start            dashboard + ngrok tunnel (needs .env)
//   npm start -- --local dashboard on this computer only
// Settings come from .env next to this file (copy .env.example):
//   NGROK_AUTHTOKEN  from https://dashboard.ngrok.com/get-started/your-authtoken
//   NGROK_DOMAIN     your free static domain, like something.ngrok-free.app
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

async function main() {
  const hasEnv = loadEnv(path.join(__dirname, ".env"));
  const local = process.argv.includes("--local");
  const port = Number(process.env.PORT) || 8787;
  const server = createServer();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  console.log(`Dashboard running at http://localhost:${port}`);
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
    console.log("Give friends that link. In the extension settings, under Practice with friends, they enter their first name and this address.");
    console.log("Leave this window open; closing it takes the dashboard offline.");
  } catch (e) {
    console.error(`ngrok couldn't start: ${e.message}`);
    console.error("Check NGROK_AUTHTOKEN and NGROK_DOMAIN in .env. The domain must be one you claimed at https://dashboard.ngrok.com/domains.");
    console.error("The dashboard is still running on this computer only.");
  }
}

if (require.main === module) main();
module.exports = { loadEnv, cleanDomain };
