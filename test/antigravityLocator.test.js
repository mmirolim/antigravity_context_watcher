"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pickPreferredTarget } = require("../src/antigravityLocator");

function target(sessionId, source, conversationMtimeMs, workspaceCandidates) {
  return {
    brainDir: sessionId ? `/tmp/${sessionId}` : "",
    sessionId,
    source,
    workspaceCandidates: workspaceCandidates || [],
    conversation: {
      path: sessionId ? `/tmp/${sessionId}.pb` : "",
      exists: Boolean(sessionId),
      size: 0,
      mtimeMs: conversationMtimeMs || 0
    }
  };
}

test("pickPreferredTarget prefers a materially newer conversation over workspace state", () => {
  const workspaceTarget = target(
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "workspaceState",
    1000,
    [{ sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }]
  );
  const latestConversationTarget = target(
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "latestConversationMtime",
    20000
  );

  const preferred = pickPreferredTarget(workspaceTarget, latestConversationTarget);

  assert.equal(preferred.sessionId, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  assert.equal(preferred.source, "latestConversationMtime");
  assert.deepEqual(preferred.workspaceCandidates, workspaceTarget.workspaceCandidates);
});

test("pickPreferredTarget keeps workspace state when the latest conversation is not newer enough", () => {
  const workspaceTarget = target(
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "workspaceState",
    1000,
    [{ sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }]
  );
  const latestConversationTarget = target(
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "latestConversationMtime",
    5000
  );

  const preferred = pickPreferredTarget(workspaceTarget, latestConversationTarget);

  assert.equal(preferred.sessionId, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  assert.equal(preferred.source, "workspaceState");
});

test("pickPreferredTarget refreshes conversation metadata when both targets point to the same session", () => {
  const workspaceTarget = target(
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "workspaceState",
    1000
  );
  const latestConversationTarget = target(
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "latestConversationMtime",
    25000
  );

  const preferred = pickPreferredTarget(workspaceTarget, latestConversationTarget);

  assert.equal(preferred.sessionId, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  assert.equal(preferred.source, "workspaceState");
  assert.equal(preferred.conversation.mtimeMs, 25000);
});
