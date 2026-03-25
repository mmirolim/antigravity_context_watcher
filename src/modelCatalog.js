"use strict";

const DEFAULT_PROFILES = [
  {
    id: "gemini-3-1-pro-high",
    label: "Gemini 3.1 Pro (High)",
    provider: "google",
    budgetMode: "separate",
    providerMaxInputTokens: 1048576,
    providerMaxOutputTokens: 65536,
    effectiveMaxInputTokens: 1000000,
    effectiveMaxOutputTokens: 64000,
    reservedOutputTokens: 0
  },
  {
    id: "gemini-3-1-pro-low",
    label: "Gemini 3.1 Pro (Low)",
    provider: "google",
    budgetMode: "separate",
    providerMaxInputTokens: 1048576,
    providerMaxOutputTokens: 65536,
    effectiveMaxInputTokens: 1000000,
    effectiveMaxOutputTokens: 64000,
    reservedOutputTokens: 0
  },
  {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    provider: "google",
    budgetMode: "separate",
    providerMaxInputTokens: 1048576,
    providerMaxOutputTokens: 65536,
    effectiveMaxInputTokens: 1000000,
    effectiveMaxOutputTokens: 64000,
    reservedOutputTokens: 0
  },
  {
    id: "claude-sonnet-4-6-thinking",
    label: "Claude Sonnet 4.6 (Thinking)",
    provider: "anthropic",
    budgetMode: "combined",
    providerMaxContextTokens: 200000,
    providerMaxOutputTokens: 64000,
    effectiveContextTokens: 200000,
    effectiveMaxOutputTokens: 64000,
    reservedOutputTokens: 16000
  },
  {
    id: "claude-opus-4-6-thinking",
    label: "Claude Opus 4.6 (Thinking)",
    provider: "anthropic",
    budgetMode: "combined",
    providerMaxContextTokens: 200000,
    providerMaxOutputTokens: 128000,
    effectiveContextTokens: 200000,
    effectiveMaxOutputTokens: 128000,
    reservedOutputTokens: 32000
  },
  {
    id: "gpt-oss-120b-medium",
    label: "GPT-OSS 120B (Medium)",
    provider: "openai",
    budgetMode: "combined",
    providerMaxContextTokens: 131072,
    providerMaxOutputTokens: 131072,
    effectiveContextTokens: 131072,
    effectiveMaxOutputTokens: 131072,
    reservedOutputTokens: 8192
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeNumber(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return fallback;
  }
  return value;
}

function mergeProfile(base, override) {
  const merged = Object.assign({}, base, override || {});
  merged.id = String(merged.id || base.id);
  merged.label = String(merged.label || base.label);
  merged.provider = String(merged.provider || base.provider);
  merged.budgetMode = merged.budgetMode === "separate" ? "separate" : "combined";
  merged.providerMaxContextTokens = normalizeNumber(
    merged.providerMaxContextTokens,
    base.providerMaxContextTokens
  );
  merged.providerMaxInputTokens = normalizeNumber(
    merged.providerMaxInputTokens,
    base.providerMaxInputTokens
  );
  merged.providerMaxOutputTokens = normalizeNumber(
    merged.providerMaxOutputTokens,
    base.providerMaxOutputTokens
  );
  merged.effectiveContextTokens = normalizeNumber(
    merged.effectiveContextTokens,
    base.effectiveContextTokens
  );
  merged.effectiveMaxInputTokens = normalizeNumber(
    merged.effectiveMaxInputTokens,
    base.effectiveMaxInputTokens
  );
  merged.effectiveMaxOutputTokens = normalizeNumber(
    merged.effectiveMaxOutputTokens,
    base.effectiveMaxOutputTokens
  );
  merged.reservedOutputTokens = normalizeNumber(
    merged.reservedOutputTokens,
    base.reservedOutputTokens
  );
  return merged;
}

function applyOverrideMap(byId, overrideMap) {
  if (!isObject(overrideMap)) {
    return;
  }

  for (const [id, override] of Object.entries(overrideMap)) {
    if (!isObject(override) || !id) {
      continue;
    }
    if (byId.has(id)) {
      byId.set(id, mergeProfile(byId.get(id), Object.assign({ id }, override)));
      continue;
    }
    byId.set(id, mergeProfile({
      id,
      label: id,
      provider: "custom",
      budgetMode: override.budgetMode === "separate" ? "separate" : "combined",
      providerMaxContextTokens: undefined,
      providerMaxInputTokens: undefined,
      providerMaxOutputTokens: 0,
      effectiveContextTokens: undefined,
      effectiveMaxInputTokens: undefined,
      effectiveMaxOutputTokens: 0,
      reservedOutputTokens: 0
    }, Object.assign({ id }, override)));
  }
}

function getConfiguredProfiles(config) {
  const profiles = clone(DEFAULT_PROFILES);
  const overrides = config.get("modelProfiles", []);
  const byId = new Map();
  for (const profile of profiles) {
    byId.set(profile.id, profile);
  }

  if (Array.isArray(overrides)) {
    for (const override of overrides) {
      if (!isObject(override) || typeof override.id !== "string" || !override.id) {
        continue;
      }
      if (byId.has(override.id)) {
        byId.set(override.id, mergeProfile(byId.get(override.id), override));
        continue;
      }
      byId.set(override.id, mergeProfile({
        id: override.id,
        label: override.id,
        provider: "custom",
        budgetMode: override.budgetMode === "separate" ? "separate" : "combined",
        providerMaxContextTokens: undefined,
        providerMaxInputTokens: undefined,
        providerMaxOutputTokens: 0,
        effectiveContextTokens: undefined,
        effectiveMaxInputTokens: undefined,
        effectiveMaxOutputTokens: 0,
        reservedOutputTokens: 0
      }, override));
    }
  }

  applyOverrideMap(byId, config.get("modelBudgetOverrides", {}));

  return Array.from(byId.values());
}

function getActiveModelId(config, profiles) {
  const configured = config.get("activeModelId", "");
  if (configured && profiles.some((profile) => profile.id === configured)) {
    return configured;
  }
  return "";
}

function getProfileById(profiles, id) {
  return profiles.find((profile) => profile.id === id) || null;
}

function buildModelBudgetOverrideTemplate(profiles) {
  const template = {};
  for (const profile of profiles || []) {
    if (!profile || !profile.id) {
      continue;
    }
    if (profile.budgetMode === "separate") {
      template[profile.id] = {
        effectiveMaxInputTokens: profile.effectiveMaxInputTokens,
        effectiveMaxOutputTokens: profile.effectiveMaxOutputTokens
      };
      continue;
    }
    template[profile.id] = {
      effectiveContextTokens: profile.effectiveContextTokens,
      effectiveMaxOutputTokens: profile.effectiveMaxOutputTokens,
      reservedOutputTokens: profile.reservedOutputTokens
    };
  }
  return template;
}

module.exports = {
  buildModelBudgetOverrideTemplate,
  DEFAULT_PROFILES,
  getConfiguredProfiles,
  getActiveModelId,
  getProfileById
};
