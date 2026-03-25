"use strict";

function toPositiveInteger(value) {
  if (value == null || value === "") {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

function analyzeLiveUsage(snapshot) {
  const liveUsage = snapshot && snapshot.liveLatestGeneration && snapshot.liveLatestGeneration.usage
    ? snapshot.liveLatestGeneration.usage
    : null;
  const recentSteps = Array.isArray(snapshot && snapshot.liveRecentSteps)
    ? snapshot.liveRecentSteps
    : [];
  const decodedRecentStepTokens = recentSteps.reduce(
    (sum, step) => sum + toPositiveInteger(step && step.tokens),
    0
  );

  if (!liveUsage) {
    return {
      decodedRecentStepTokens,
      unexplainedRetainedTokens: 0,
      decodedCoverageFraction: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      hiddenContextLikely: false
    };
  }

  const retainedTokens = toPositiveInteger(liveUsage.retainedTokens);
  const cachedInputTokens =
    toPositiveInteger(liveUsage.cacheReadTokens)
    + toPositiveInteger(liveUsage.cachedContentTokenCount)
    + toPositiveInteger(liveUsage.cacheCreationInputTokens);
  const uncachedInputTokens = toPositiveInteger(liveUsage.uncachedInputTokens);
  const outputTokens = toPositiveInteger(liveUsage.outputTokens);
  const unexplainedRetainedTokens = Math.max(0, retainedTokens - decodedRecentStepTokens);
  const decodedCoverageFraction = retainedTokens > 0
    ? Math.min(1, decodedRecentStepTokens / retainedTokens)
    : 0;

  return {
    decodedRecentStepTokens,
    unexplainedRetainedTokens,
    decodedCoverageFraction,
    cachedInputTokens,
    uncachedInputTokens,
    outputTokens,
    hiddenContextLikely:
      retainedTokens > 0
      && unexplainedRetainedTokens >= 8192
      && unexplainedRetainedTokens >= decodedRecentStepTokens * 2
  };
}

module.exports = {
  analyzeLiveUsage
};
