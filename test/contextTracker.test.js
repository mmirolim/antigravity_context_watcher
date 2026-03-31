"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chooseRefreshDetail,
  reusePreviousLiveData,
  reusePreviousLiveMetadata,
  shouldPromoteRefreshForConversationActivity,
  shouldDoFullRefresh
} = require("../src/contextTracker");

function config(values) {
  return {
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    }
  };
}

test("shouldDoFullRefresh returns true when no full refresh has happened yet", () => {
  assert.equal(shouldDoFullRefresh(0, 60000, 1000), true);
});

test("chooseRefreshDetail uses light refresh before the full refresh interval elapses", () => {
  const originalNow = Date.now;
  Date.now = () => 30000;
  try {
    const detail = chooseRefreshDetail(
      config({ fullRefreshIntervalMs: 60000 }),
      "auto",
      { lastFullRefreshAt: 1000 }
    );

    assert.equal(detail, "light");
  } finally {
    Date.now = originalNow;
  }
});

test("chooseRefreshDetail uses full refresh after the interval elapses", () => {
  const originalNow = Date.now;
  Date.now = () => 70000;
  try {
    const detail = chooseRefreshDetail(
      config({ fullRefreshIntervalMs: 60000 }),
      "auto",
      { lastFullRefreshAt: 1000 }
    );

    assert.equal(detail, "full");
  } finally {
    Date.now = originalNow;
  }
});

test("reusePreviousLiveData preserves previous full live data during light refreshes for the same session", () => {
  const reused = reusePreviousLiveData(
    {
      sessionId: "session-1",
      liveLatestGeneration: { usage: { retainedTokens: 123 } },
      liveRecentSteps: [{ stepIndex: 9 }],
      activeTrajectorySummary: { title: "Existing summary" }
    },
    "session-1",
    {
      latestGeneration: null,
      recentSteps: [],
      activeSummary: null
    }
  );

  assert.equal(reused.latestGeneration.usage.retainedTokens, 123);
  assert.deepEqual(reused.recentSteps, [{ stepIndex: 9 }]);
  assert.equal(reused.activeSummary.title, "Existing summary");
});

test("reusePreviousLiveData does not reuse data across different sessions", () => {
  const reused = reusePreviousLiveData(
    {
      sessionId: "session-1",
      liveLatestGeneration: { usage: { retainedTokens: 123 } },
      liveRecentSteps: [{ stepIndex: 9 }],
      activeTrajectorySummary: { title: "Existing summary" }
    },
    "session-2",
    {
      latestGeneration: null,
      recentSteps: [],
      activeSummary: null
    }
  );

  assert.equal(reused.latestGeneration, null);
  assert.deepEqual(reused.recentSteps, []);
  assert.equal(reused.activeSummary, null);
});

test("reusePreviousLiveMetadata preserves model options and connection during light refreshes", () => {
  const reused = reusePreviousLiveMetadata(
    {
      liveReady: true,
      liveConnection: { port: 1234 },
      availableModelOptions: [{ label: "Claude Opus 4.6 (Thinking)" }],
      liveWorkspaceCandidates: [{ cascadeId: "session-1" }],
      liveSelectionSource: "preferredCascadeId"
    },
    {
      ready: false,
      detailLevel: "light",
      connection: null,
      modelOptions: [],
      workspaceCandidates: [],
      selectionSource: ""
    }
  );

  assert.equal(reused.liveReady, true);
  assert.deepEqual(reused.liveConnection, { port: 1234 });
  assert.deepEqual(reused.modelOptions, [{ label: "Claude Opus 4.6 (Thinking)" }]);
  assert.deepEqual(reused.workspaceCandidates, [{ cascadeId: "session-1" }]);
  assert.equal(reused.liveSelectionSource, "preferredCascadeId");
});

test("chooseRefreshDetail preserves explicit full and light refresh requests", () => {
  assert.equal(
    chooseRefreshDetail(config({ fullRefreshIntervalMs: 300000 }), "full", { lastFullRefreshAt: 1 }),
    "full"
  );
  assert.equal(
    chooseRefreshDetail(config({ fullRefreshIntervalMs: 300000 }), "light", { lastFullRefreshAt: 1 }),
    "light"
  );
});

test("shouldPromoteRefreshForConversationActivity returns true when the active conversation file changed", () => {
  const promoted = shouldPromoteRefreshForConversationActivity(
    {
      sessionId: "session-1",
      conversation: {
        mtimeMs: 1000
      }
    },
    () => ({
      path: "/tmp/session-1.pb",
      exists: true,
      size: 64,
      mtimeMs: 2000
    })
  );

  assert.equal(promoted, true);
});

test("shouldPromoteRefreshForConversationActivity ignores unchanged or unknown conversations", () => {
  assert.equal(
    shouldPromoteRefreshForConversationActivity(
      {
        sessionId: "session-1",
        conversation: {
          mtimeMs: 1000
        }
      },
      () => ({
        path: "/tmp/session-1.pb",
        exists: true,
        size: 64,
        mtimeMs: 1000
      })
    ),
    false
  );

  assert.equal(
    shouldPromoteRefreshForConversationActivity(
      {
        sessionId: "",
        conversation: {
          mtimeMs: 1000
        }
      },
      () => ({
        path: "/tmp/session-1.pb",
        exists: true,
        size: 64,
        mtimeMs: 2000
      })
    ),
    false
  );
});
