"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeLiveUsage } = require("../src/liveUsageAnalysis");

test("analyzeLiveUsage detects a large retained payload beyond decoded live steps", () => {
  const analysis = analyzeLiveUsage({
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
        tokens: 57
      }
    ]
  });

  assert.equal(analysis.decodedRecentStepTokens, 57);
  assert.equal(analysis.unexplainedRetainedTokens, 42352);
  assert.equal(analysis.hiddenContextLikely, true);
});

test("analyzeLiveUsage reports cache-backed retained input when present", () => {
  const analysis = analyzeLiveUsage({
    liveLatestGeneration: {
      usage: {
        retainedTokens: 47238,
        cacheReadTokens: 40535,
        cachedContentTokenCount: 0,
        cacheCreationInputTokens: 0,
        uncachedInputTokens: 6691,
        outputTokens: 12
      }
    },
    liveRecentSteps: [
      {
        stepIndex: 4,
        tokens: 57
      },
      {
        stepIndex: 8,
        tokens: 4123
      },
      {
        stepIndex: 11,
        tokens: 1
      }
    ]
  });

  assert.equal(analysis.cachedInputTokens, 40535);
  assert.equal(analysis.decodedRecentStepTokens, 4181);
  assert.equal(analysis.unexplainedRetainedTokens, 43057);
  assert.equal(analysis.hiddenContextLikely, true);
});
