"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveBudget, computeUsage } = require("../src/budget");
const { getActiveModelId } = require("../src/modelCatalog");

function config(overrides) {
  return {
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(overrides || {}, key)
        ? overrides[key]
        : fallback;
    }
  };
}

test("resolveBudget derives input budget for combined models", () => {
  const budget = resolveBudget({
    id: "claude",
    label: "Claude",
    provider: "anthropic",
    budgetMode: "combined",
    effectiveContextTokens: 200000,
    effectiveMaxOutputTokens: 64000,
    reservedOutputTokens: 16000
  }, config({ reservedOutputTokens: 8000 }));
  assert.equal(budget.effectiveMaxInputTokens, 184000);
});

test("resolveBudget preserves direct limits for separate models", () => {
  const budget = resolveBudget({
    id: "gemini",
    label: "Gemini",
    provider: "google",
    budgetMode: "separate",
    effectiveMaxInputTokens: 1000000,
    effectiveMaxOutputTokens: 64000
  }, config({}));
  assert.equal(budget.effectiveMaxInputTokens, 1000000);
  assert.equal(budget.effectiveMaxOutputTokens, 64000);
});

test("computeUsage returns remaining headroom", () => {
  const usage = computeUsage(50000, {
    effectiveMaxInputTokens: 100000
  });
  assert.equal(usage.remainingInputHeadroom, 50000);
  assert.equal(usage.percentUsed, 0.5);
});

test("getActiveModelId requires an explicit configured profile", () => {
  const profiles = [{ id: "gemini-3-1-pro-high" }];
  assert.equal(getActiveModelId(config({}), profiles), "");
  assert.equal(
    getActiveModelId(config({ activeModelId: "gemini-3-1-pro-high" }), profiles),
    "gemini-3-1-pro-high"
  );
});
