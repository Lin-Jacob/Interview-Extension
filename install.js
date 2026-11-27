#!/usr/bin/env node
// Installs (or updates) the AI bridge and game blocker from this repo's native/ folder.
//   node install.js            install, or update after a `git pull`
//   node install.js --uninstall
// Run it from an administrator terminal on Windows so the game blocker can also
// close games that run as administrator, like the League client.
"use strict";
require("./native/install.js");
