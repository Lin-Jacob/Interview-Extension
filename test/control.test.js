"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { isDashboardCommand, findRunning, startupSettled } = require("../server/control.js");

test("recognises the dashboard however it was launched", () => {
  assert.ok(isDashboardCommand('"C:\\Program Files\\nodejs\\node.exe" "C:\\dash\\start.js" --log'));
  assert.ok(isDashboardCommand("node start.js"));
  assert.ok(isDashboardCommand("/usr/bin/node /srv/dash/start.js --local"));
});

test("doesn't mistake other programs for the dashboard", () => {
  assert.equal(isDashboardCommand('"C:\\node.exe" "C:\\bridge\\gameguard.js"'), false);
  assert.equal(isDashboardCommand("node restart.js"), false);
  assert.equal(isDashboardCommand("node start.json"), false);
  assert.equal(isDashboardCommand(""), false);
  assert.equal(isDashboardCommand(undefined), false);
});

test("a saved id reused by another program is never picked", () => {
  const lookup = (pid) => ({ 11: "node gameguard.js", 22: "node start.js --log" })[pid] || "";
  assert.equal(findRunning([11], lookup), 0);
  assert.equal(findRunning([11, 22], lookup), 22);
  assert.equal(findRunning([undefined, 0, NaN, -1, "22"], lookup), 0);
});

test("startup only settles for this run's process", () => {
  assert.equal(startupSettled({ pid: 5, online: true }, 5), true);
  assert.equal(startupSettled({ pid: 5, local: true }, 5), true);
  assert.equal(startupSettled({ pid: 5, problem: "no token" }, 5), true);
  assert.equal(startupSettled({ pid: 5, online: false, local: false, problem: "" }, 5), false);
  assert.equal(startupSettled({ pid: 4, online: true }, 5), false);
  assert.equal(startupSettled({}, 5), false);
});
