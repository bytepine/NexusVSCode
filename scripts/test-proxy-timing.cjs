// decideMaintain 契约单测（与 Rider / Desktop 同表）。
const assert = require("assert");
const { decideMaintain, FULL_SCAN_EVERY_N_TICKS } = require("../dist/proxyTiming.cjs");

function ok(cond, msg) { assert.ok(cond, msg); }

const skip = decideMaintain(true, 1, 3);
ok(skip.action === "skip" && skip.nextCountdown === 3, "pending skips");

const probe = decideMaintain(true, 0, 1);
ok(probe.action === "probe" && probe.nextCountdown === 0, "countdown probes");

const full = decideMaintain(true, 0, 0);
ok(full.action === "full_scan" && full.nextCountdown === FULL_SCAN_EVERY_N_TICKS, "zero scans");

const closed = decideMaintain(false, 2, 4);
ok(closed.action === "full_scan" && closed.nextCountdown === FULL_SCAN_EVERY_N_TICKS, "closed scans");

console.log("proxy timing ok");
