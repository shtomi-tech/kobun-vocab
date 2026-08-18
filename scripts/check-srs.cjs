const assert = require("node:assert/strict");
const srs = require("../static/srs.js");

const start = new Date("2026-08-09T00:00:00.000Z");
let state = {};
for (const days of [1, 3, 7, 14]) {
  state = srs.record(state, true, start);
  assert.equal(Math.round((new Date(state.nextReviewAt) - start) / 86400000), days);
}
assert.equal(srs.label(state), "14日後");
assert.equal(srs.isDue(state, start.getTime()), false);
state = srs.record(state, false, start);
assert.equal(state.stage, 0);
assert.equal(state.nextReviewAt, null);
assert.equal(srs.isDue(state, start.getTime()), true);
console.log("OK: SRS 1・3・7・14日 / 誤答リセット");
