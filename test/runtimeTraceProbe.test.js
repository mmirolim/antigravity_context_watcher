"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTracePayload, scanTraceValue } = require("../src/runtimeTraceProbe");

test("parseTracePayload parses JSON strings", () => {
  const parsed = parseTracePayload("{\"conversationId\":\"abc\",\"inputTokens\":42}");

  assert.equal(parsed.parsed, true);
  assert.equal(parsed.parsedValue.conversationId, "abc");
});

test("scanTraceValue extracts session, token, model, and text hits", () => {
  const scan = scanTraceValue({
    conversationId: "66b0819e-b19d-4aa8-bf63-262f7fb6f455",
    requestedModel: "Claude Sonnet 4.6 (Thinking)",
    promptTokens: 8123,
    completionTokens: 4096,
    request: {
      prompt: "Generate a very long wall of text for this test."
    },
    response: {
      text: "Here is the generated content."
    }
  }, "66b0819e-b19d-4aa8-bf63-262f7fb6f455");

  assert.equal(scan.sessionHits.length > 0, true);
  assert.equal(scan.tokenHits.some((hit) => hit.path.endsWith(".promptTokens") && hit.value === 8123), true);
  assert.equal(scan.tokenHits.some((hit) => hit.path.endsWith(".completionTokens") && hit.value === 4096), true);
  assert.equal(scan.modelHints.some((hit) => hit.value.includes("Claude Sonnet 4.6")), true);
  assert.equal(scan.textHits.some((hit) => hit.preview.includes("Generate a very long wall of text")), true);
});
