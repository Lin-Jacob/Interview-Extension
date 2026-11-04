#!/usr/bin/env node
// Makes and manages dashboard logins. The username is the person's first name.
//   npm run add-user -- Sam             new account with a made-up password
//   npm run add-user -- Sam hunter22    new account (or new password) you choose
//   npm run add-user -- "Sam L."        a name with a space goes in quotes
//   npm run remove-user -- Sam          delete the account and their stats
//   npm run users                       list accounts
// Works while the dashboard is running.
"use strict";
const crypto = require("crypto");
const { createStore, setPassword, removeUser } = require("./server.js");

// Easy to read out loud or text: three short chunks, no look-alike characters.
function makePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const chunk = () => Array.from(crypto.randomBytes(4), (b) => chars[b % chars.length]).join("");
  return `${chunk()}-${chunk()}-${chunk()}`;
}

function main(argv, store = createStore(), log = console.log) {
  const [cmd, ...rest] = argv;
  if (cmd === "add") {
    // A name with a space needs quotes: npm run add-user -- "Sam L."
    const name = rest[0] || "";
    let password = rest[1] || "";
    if (!name) throw new Error("Usage: npm run add-user -- <first name> [password]");
    if (!password) password = makePassword();
    const r = setPassword(store, name, password);
    log(`${r.existed ? "New password for" : "Added"} ${r.name}.`);
    log(`  Username: ${r.name}`);
    log(`  Password: ${password}`);
    log("They use these on the dashboard page and in the extension settings under Practice with friends.");
    return r;
  }
  if (cmd === "remove") {
    const name = rest.join(" ");
    if (!name) throw new Error("Usage: npm run remove-user -- <first name>");
    log(removeUser(store, name) ? `Removed ${name} and their stats.` : `No account named ${name}.`);
    return null;
  }
  if (cmd === "list" || !cmd) {
    const d = store.data();
    const rows = Object.entries(d.accounts);
    if (!rows.length) log("No accounts yet. Add one with: npm run add-user -- <first name>");
    for (const [key, a] of rows) {
      const u = d.users[key];
      log(`${a.name}${u ? `  (last synced ${new Date(u.at).toLocaleString()})` : "  (hasn't synced yet)"}`);
    }
    return rows.length;
  }
  throw new Error(`Unknown command "${cmd}". Use add, remove or list.`);
}

if (require.main === module) {
  require("./start.js").loadEnv(require("path").join(__dirname, ".env"));
  if ((process.env.DASHBOARD_USERS || "").trim() && ["add", "remove"].includes(process.argv[2])) {
    console.log("Note: DASHBOARD_USERS is set in .env, so the next start replaces logins with that list. Edit .env instead.");
  }
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { main, makePassword };
