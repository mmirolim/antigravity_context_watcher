"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chooseRefreshDetail,
  reusePreviousLiveData,
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
