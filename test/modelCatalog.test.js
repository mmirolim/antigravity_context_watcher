"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildModelBudgetOverrideTemplate,
  getConfiguredProfiles
} = require("../src/modelCatalog");

function createConfig(values) {
  return {
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    }
  };
}

test("getConfiguredProfiles applies keyed model budget overrides", () => {
  const profiles = getConfiguredProfiles(createConfig({
    modelBudgetOverrides: {
      "gemini-3-flash": {
        effectiveMaxInputTokens: 128000,
        effectiveMaxOutputTokens: 8192
      },
      "claude-sonnet-4-6-thinking": {
        effectiveContextTokens: 180000,
        reservedOutputTokens: 20000,
        effectiveMaxOutputTokens: 32000
      }
    }
  }));

  const geminiFlash = profiles.find((profile) => profile.id === "gemini-3-flash");
  const sonnet = profiles.find((profile) => profile.id === "claude-sonnet-4-6-thinking");

  assert.equal(geminiFlash.effectiveMaxInputTokens, 128000);
  assert.equal(geminiFlash.effectiveMaxOutputTokens, 8192);
  assert.equal(sonnet.effectiveContextTokens, 180000);
  assert.equal(sonnet.reservedOutputTokens, 20000);
  assert.equal(sonnet.effectiveMaxOutputTokens, 32000);
});

test("keyed model budget overrides win over generic array overrides", () => {
  const profiles = getConfiguredProfiles(createConfig({
    modelProfiles: [
      {
        id: "gemini-3-flash",
        effectiveMaxInputTokens: 256000,
        effectiveMaxOutputTokens: 16000
      }
    ],
    modelBudgetOverrides: {
      "gemini-3-flash": {
        effectiveMaxInputTokens: 128000
      }
    }
  }));

  const geminiFlash = profiles.find((profile) => profile.id === "gemini-3-flash");
  assert.equal(geminiFlash.effectiveMaxInputTokens, 128000);
  assert.equal(geminiFlash.effectiveMaxOutputTokens, 16000);
});

test("buildModelBudgetOverrideTemplate emits editable per-model limits", () => {
  const profiles = getConfiguredProfiles(createConfig({}));
  const template = buildModelBudgetOverrideTemplate(profiles);

  assert.deepEqual(template["gemini-3-flash"], {
    effectiveMaxInputTokens: 1000000,
    effectiveMaxOutputTokens: 64000
  });
  assert.deepEqual(template["claude-sonnet-4-6-thinking"], {
    effectiveContextTokens: 200000,
    effectiveMaxOutputTokens: 64000,
    reservedOutputTokens: 16000
  });
});
