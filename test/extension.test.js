"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAutoPinSessionId,
  getVisibleSessionBrainPath,
  resolveAutoPinBrainPath
} = require("../src/sessionPinning");

test("getVisibleSessionBrainPath returns the visible chat brain path", () => {
  const brainPath = getVisibleSessionBrainPath({
    activeTabSelection: {
      sessionId: "601b476a-fc8c-4208-b8ad-47c3e458b6c0"
    }
  });

  assert.equal(
    brainPath,
    "/Users/mirolim/.gemini/antigravity/brain/601b476a-fc8c-4208-b8ad-47c3e458b6c0"
  );
});

test("getAutoPinSessionId prefers the diagnostics active session for in-chat switches", () => {
  const sessionId = getAutoPinSessionId({
    activeTabSelection: {
      sessionId: "2f1f2331-3499-4378-a66a-e31cf49199f4"
    },
    diagnosticsActiveSession: {
      sessionId: "601b476a-fc8c-4208-b8ad-47c3e458b6c0"
    }
  });

  assert.equal(sessionId, "601b476a-fc8c-4208-b8ad-47c3e458b6c0");
});

test("resolveAutoPinBrainPath does nothing when auto pin is disabled", () => {
  const nextPath = resolveAutoPinBrainPath({
    activeTabSelection: {
      sessionId: "601b476a-fc8c-4208-b8ad-47c3e458b6c0"
    },
    sessionId: "2f1f2331-3499-4378-a66a-e31cf49199f4",
    resolutionSource: "configuredPath"
  }, "", false);

  assert.equal(nextPath, "");
});

test("resolveAutoPinBrainPath pins the visible chat when it differs from the current pin", () => {
  const nextPath = resolveAutoPinBrainPath({
    activeTabSelection: {
      sessionId: "2f1f2331-3499-4378-a66a-e31cf49199f4"
    },
    diagnosticsActiveSession: {
      sessionId: "601b476a-fc8c-4208-b8ad-47c3e458b6c0"
    },
    sessionId: "2f1f2331-3499-4378-a66a-e31cf49199f4",
    resolutionSource: "configuredPath"
  }, "/Users/mirolim/.gemini/antigravity/brain/2f1f2331-3499-4378-a66a-e31cf49199f4", true);

  assert.equal(
    nextPath,
    "/Users/mirolim/.gemini/antigravity/brain/601b476a-fc8c-4208-b8ad-47c3e458b6c0"
  );
});

test("resolveAutoPinBrainPath avoids rewriting the pin when already following the visible chat automatically", () => {
  const nextPath = resolveAutoPinBrainPath({
    activeTabSelection: {
      sessionId: "2f1f2331-3499-4378-a66a-e31cf49199f4"
    },
    diagnosticsActiveSession: {
      sessionId: "601b476a-fc8c-4208-b8ad-47c3e458b6c0"
    },
    sessionId: "601b476a-fc8c-4208-b8ad-47c3e458b6c0",
    resolutionSource: "liveVisibleTab"
  }, "", true);

  assert.equal(nextPath, "");
});
