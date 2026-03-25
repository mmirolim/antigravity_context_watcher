"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSummaryPrompt, buildSummarizeCurrentChatPrompt } = require("../src/compactor");

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

test("buildSummarizeCurrentChatPrompt creates a pasteable summarize request", () => {
  const prompt = buildSummarizeCurrentChatPrompt({
    activeProfile: { label: "Claude Sonnet 4.6 (Thinking)" },
    estimatedTrackedTokens: 12000,
    liveRecentSteps: [
      {
        stepIndex: 4,
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        text: "Very long generated answer that should not be embedded in the summarize prompt."
      }
    ],
    entries: [
      {
        includedInEstimate: true,
        path: "/tmp/implementation_plan.md"
      }
    ]
  }, 6000);

  assert.match(prompt, /Summarize this current Antigravity chat/);
  assert.match(prompt, /Use at most 6000 tokens/);
  assert.match(prompt, /Starter Prompt/);
  assert.doesNotMatch(prompt, /\/tmp\/implementation_plan\.md/);
  assert.doesNotMatch(prompt, /Very long generated answer/);
});

test("buildSummaryPrompt includes live trajectory steps when available", () => {
  const prompt = buildSummaryPrompt({
    activeProfile: { label: "Claude Sonnet 4.6 (Thinking)" },
    detectedModelLabel: "Claude Sonnet 4.6 (Thinking)",
    usageSource: "liveGeneratorMetadata",
    estimatedTrackedTokens: 53000,
    artifactEstimateTokens: 7000,
    budget: { effectiveMaxInputTokens: 184000 },
    lastUpdatedAt: Date.now(),
    summaryEntries: [
      {
        includedInHandoff: true,
        category: "liveTrajectory",
        path: "cascade://session/steps/6",
        liveStepIndex: 6,
        liveStepType: "notifyUser",
        text: "Generated a very long response",
        tokens: 10,
        mtimeMs: Date.now()
      }
    ]
  }, 4000);

  assert.match(prompt, /Live retained context/);
  assert.match(prompt, /Generated a very long response/);
  assert.match(prompt, /live Antigravity trajectory metadata/);
});

test("buildSummaryPrompt warns when retained context exceeds decoded live steps", () => {
  const prompt = buildSummaryPrompt({
    activeProfile: { label: "Gemini 3 Flash" },
    detectedModelLabel: "Gemini 3 Flash",
    usageSource: "liveGeneratorMetadata",
    estimatedTrackedTokens: 42409,
    artifactEstimateTokens: 0,
    budget: { effectiveMaxInputTokens: 1000000 },
    lastUpdatedAt: Date.now(),
    liveLatestGeneration: {
      usage: {
        retainedTokens: 42409,
        cacheReadTokens: 0,
        cachedContentTokenCount: 0,
        cacheCreationInputTokens: 0,
        uncachedInputTokens: 42211,
        outputTokens: 198
      }
    },
    liveRecentSteps: [
      {
        stepIndex: 4,
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        tokens: 57,
        text: "Hello! How can I help you?"
      }
    ],
    summaryEntries: []
  }, 4000);

  assert.match(prompt, /Retained tokens not explained by decoded live steps: 42352/);
  assert.match(prompt, /preload substantial hidden context/);
});
