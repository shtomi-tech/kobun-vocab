"use strict";

const KobunSrs = (() => {
  const intervals = [1, 3, 7, 14];
  const labels = ["未実施", "要再確認", "1日後", "3日後", "7日後", "14日後"];

  function normalize(value = {}) {
    return {
      wrongCount: Number.isFinite(value.wrongCount) ? value.wrongCount : 0,
      stage: Number.isInteger(value.stage) ? Math.max(0, Math.min(value.stage, intervals.length - 1)) : 0,
      lastAnsweredAt: typeof value.lastAnsweredAt === "string" ? value.lastAnsweredAt : null,
      nextReviewAt: typeof value.nextReviewAt === "string" ? value.nextReviewAt : null,
    };
  }

  function record(value, correct, now = new Date()) {
    const state = normalize(value);
    state.lastAnsweredAt = now.toISOString();
    if (!correct) {
      state.wrongCount++;
      state.stage = 0;
      state.nextReviewAt = null;
      return state;
    }
    const days = intervals[state.stage];
    const next = new Date(now);
    next.setDate(next.getDate() + days);
    state.nextReviewAt = next.toISOString();
    state.stage = Math.min(state.stage + 1, intervals.length - 1);
    return state;
  }

  function isDue(value, now = Date.now()) {
    const state = normalize(value);
    return !state.lastAnsweredAt || !state.nextReviewAt || new Date(state.nextReviewAt).getTime() <= now;
  }

  function label(value) {
    const state = normalize(value);
    if (!state.lastAnsweredAt) return labels[0];
    if (!state.nextReviewAt) return labels[1];
    const days = Math.round((new Date(state.nextReviewAt) - new Date(state.lastAnsweredAt)) / 86400000);
    const index = intervals.indexOf(days);
    return index < 0 ? labels[1] : labels[index + 2];
  }

  return { intervals, labels, normalize, record, isDue, label };
})();

if (typeof module !== "undefined") module.exports = KobunSrs;
