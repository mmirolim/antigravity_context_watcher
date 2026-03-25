"use strict";

function numeric(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return value;
}

function resolveBudget(profile, config) {
  if (!profile) {
    return null;
  }

  const reservedFallback = numeric(config.get("reservedOutputTokens", 16000), 16000);
  const reservedOutputTokens = numeric(profile.reservedOutputTokens, reservedFallback);
  const budgetMode = profile.budgetMode === "separate" ? "separate" : "combined";

  const budget = {
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    budgetMode,
    reservedOutputTokens,
    providerMaxContextTokens: numeric(profile.providerMaxContextTokens, undefined),
    providerMaxInputTokens: numeric(profile.providerMaxInputTokens, undefined),
    providerMaxOutputTokens: numeric(profile.providerMaxOutputTokens, 0),
    effectiveContextTokens: numeric(profile.effectiveContextTokens, undefined),
    effectiveMaxInputTokens: numeric(profile.effectiveMaxInputTokens, undefined),
    effectiveMaxOutputTokens: numeric(profile.effectiveMaxOutputTokens, 0),
    source: "defaultProfile"
  };

  if (budgetMode === "combined") {
    const effectiveContextTokens = numeric(
      budget.effectiveContextTokens,
      budget.providerMaxContextTokens
    );
    budget.effectiveContextTokens = effectiveContextTokens;
    if (typeof budget.effectiveMaxInputTokens !== "number") {
      budget.effectiveMaxInputTokens = Math.max(0, effectiveContextTokens - reservedOutputTokens);
    }
  }

  if (budgetMode === "separate") {
    budget.effectiveMaxInputTokens = numeric(
      budget.effectiveMaxInputTokens,
      budget.providerMaxInputTokens
    );
  }

  return budget;
}

function computeUsage(totalTokens, budget) {
  if (!budget || typeof budget.effectiveMaxInputTokens !== "number" || budget.effectiveMaxInputTokens <= 0) {
    return {
      percentUsed: 0,
      remainingInputHeadroom: 0,
      effectiveMaxInputTokens: 0
    };
  }

  const percentUsed = totalTokens / budget.effectiveMaxInputTokens;
  return {
    percentUsed,
    remainingInputHeadroom: Math.max(0, budget.effectiveMaxInputTokens - totalTokens),
    effectiveMaxInputTokens: budget.effectiveMaxInputTokens
  };
}

function formatProviderReference(budget) {
  if (!budget) {
    return "n/a";
  }
  if (budget.budgetMode === "separate") {
    return `input ${budget.providerMaxInputTokens || "?"}, output ${budget.providerMaxOutputTokens || "?"}`;
  }
  return `shared ${budget.providerMaxContextTokens || "?"}, output ${budget.providerMaxOutputTokens || "?"}`;
}

module.exports = {
  resolveBudget,
  computeUsage,
  formatProviderReference
};
