"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSummaryPrompt } = require("../src/compactor");

test("buildSummaryPrompt includes model label and estimate disclaimer", () => {
  const prompt = buildSummaryPrompt({
    activeProfile: { label: "Claude Sonnet 4.6 (Thinking)" },
    estimatedTrackedTokens: 12000,
    budget: { effectiveMaxInputTokens: 184000 },
    lastUpdatedAt: Date.now(),
    summaryEntries: [
      {
        includedInEstimate: true,
        category: "stepOutput",
        path: "/tmp/output.txt",
        text: "recent output",
        tokens: 3,
        mtimeMs: Date.now()
      }
    ]
  }, 4000);

  assert.match(prompt, /Claude Sonnet 4\.6 \(Thinking\)/);
  assert.match(prompt, /estimate, not an exact transcript/);
  assert.match(prompt, /recent output/);
});

test("buildSummaryPrompt truncates to the requested budget", () => {
  const longText = "abcd".repeat(5000);
  const prompt = buildSummaryPrompt({
    activeProfile: { label: "Gemini 3 Flash" },
    estimatedTrackedTokens: 50000,
    budget: { effectiveMaxInputTokens: 1000000 },
    lastUpdatedAt: Date.now(),
    summaryEntries: [
      {
        includedInEstimate: true,
        category: "stepOutput",
        path: "/tmp/output.txt",
        text: longText,
        tokens: 5000,
        mtimeMs: Date.now()
      }
    ]
  }, 2000);

  assert.match(prompt, /\[truncated\]/);
});
