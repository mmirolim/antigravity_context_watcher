"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeUsageFromGeneratorUsage,
  detectActiveTabSession,
  extractTabMetadata,
  parseDiagnosticsRecentTrajectories,
  selectLatestGeneratorMetadata
} = require("../src/antigravitySdkBridge");

test("computeUsageFromGeneratorUsage includes cache read tokens when promptTokenCount is absent", () => {
  const usage = computeUsageFromGeneratorUsage({
    inputTokens: "3197",
    cacheReadTokens: "50162",
    outputTokens: "292",
    apiProvider: "anthropic"
  });

  assert.equal(usage.effectiveInputTokens, 53359);
  assert.equal(usage.outputTokens, 292);
  assert.equal(usage.retainedTokens, 53651);
  assert.equal(usage.apiProvider, "anthropic");
});

test("computeUsageFromGeneratorUsage prefers promptTokenCount when available", () => {
  const usage = computeUsageFromGeneratorUsage({
    promptTokenCount: "8000",
    inputTokens: "1000",
    cacheReadTokens: "50000",
    toolUsePromptTokenCount: "120",
    responseOutputTokens: "300"
  });

  assert.equal(usage.effectiveInputTokens, 8120);
  assert.equal(usage.outputTokens, 300);
  assert.equal(usage.retainedTokens, 8420);
});

test("selectLatestGeneratorMetadata returns the newest generation and maps the live model label", () => {
  const latest = selectLatestGeneratorMetadata(
    [
      {
        stepIndices: [2, 3],
        chatModel: {
          model: "MODEL_PLACEHOLDER_M35",
          usage: {
            inputTokens: "2000",
            outputTokens: "400"
          }
        }
      },
      {
        stepIndices: [6],
        chatModel: {
          model: "MODEL_PLACEHOLDER_M26",
          usage: {
            inputTokens: "3000",
            cacheReadTokens: "1000",
            outputTokens: "500"
          }
        }
      }
    ],
    new Map([
      ["MODEL_PLACEHOLDER_M35", "Claude Sonnet 4.6 (Thinking)"],
      ["MODEL_PLACEHOLDER_M26", "Claude Opus 4.6 (Thinking)"]
    ])
  );

  assert.equal(latest.modelLabel, "Claude Opus 4.6 (Thinking)");
  assert.equal(latest.usage.retainedTokens, 4500);
  assert.equal(latest.maxObservedRetainedTokens, 4500);
  assert.deepEqual(latest.stepIndices, [6]);
});

test("parseDiagnosticsRecentTrajectories extracts the active visible session order", () => {
  const trajectories = parseDiagnosticsRecentTrajectories(JSON.stringify({
    recentTrajectories: [
      {
        googleAgentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        trajectoryId: "traj-b",
        summary: "Currently visible chat",
        lastStepIndex: 8,
        lastModifiedTime: "2026-03-25T18:40:35.000Z"
      },
      {
        googleAgentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        trajectoryId: "traj-a",
        summary: "Older chat",
        lastStepIndex: 12,
        lastModifiedTime: "2026-03-25T18:10:35.000Z"
      }
    ]
  }));

  assert.equal(trajectories.length, 2);
  assert.equal(trajectories[0].sessionId, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  assert.equal(trajectories[0].title, "Currently visible chat");
  assert.equal(trajectories[0].stepCount, 8);
});

test("extractTabMetadata recovers session ids and Antigravity hints from a tab input", () => {
  const metadata = extractTabMetadata({
    label: "Compiling Historical Anecdotes Collection",
    isActive: true,
    input: {
      viewType: "antigravity.conversation",
      uri: {
        toString() {
          return "antigravity://conversation/66b0819e-b19d-4aa8-bf63-262f7fb6f455";
        }
      }
    }
  });

  assert.equal(metadata.label, "Compiling Historical Anecdotes Collection");
  assert.equal(metadata.viewType, "antigravity.conversation");
  assert.equal(metadata.antigravityHint, true);
  assert.deepEqual(metadata.sessionIds, ["66b0819e-b19d-4aa8-bf63-262f7fb6f455"]);
});

test("detectActiveTabSession prefers a direct session id from the active tab", () => {
  const selection = detectActiveTabSession(
    {
      window: {
        tabGroups: {
          activeTabGroup: {
            activeTab: {
              label: "Current chat",
              input: {
                viewType: "antigravity.conversation",
                resource: {
                  fsPath: "/Users/test/.gemini/antigravity/brain/322f345a-0c5b-4158-9baa-bd62318ee982/task.md"
                }
              }
            }
          },
          all: [
            {
              tabs: []
            }
          ]
        }
      }
    },
    {
      "322f345a-0c5b-4158-9baa-bd62318ee982": {
        title: "Inquiring About AI Identity"
      }
    },
    []
  );

  assert.equal(selection.sessionId, "322f345a-0c5b-4158-9baa-bd62318ee982");
  assert.equal(selection.source, "activeTabSessionId");
});

test("detectActiveTabSession falls back to title matching for Antigravity tabs", () => {
  const selection = detectActiveTabSession(
    {
      window: {
        tabGroups: {
          activeTabGroup: {
            activeTab: {
              label: "Inquiring About AI Identity",
              input: {
                viewType: "antigravity.conversation"
              }
            }
          },
          all: [
            {
              tabs: []
            }
          ]
        }
      }
    },
    {},
    [
      {
        sessionId: "322f345a-0c5b-4158-9baa-bd62318ee982",
        title: "Inquiring About AI Identity"
      }
    ]
  );

  assert.equal(selection.sessionId, "322f345a-0c5b-4158-9baa-bd62318ee982");
  assert.equal(selection.source, "activeTabTitle");
});
