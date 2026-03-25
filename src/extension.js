"use strict";

const extensionPackage = require("../package.json");
const vscode = require("vscode");
const { ContextTracker } = require("./contextTracker");
const { getConfiguredProfiles, getActiveModelId, buildModelBudgetOverrideTemplate } = require("./modelCatalog");
const { formatProviderReference } = require("./budget");
const { buildSummaryPrompt, buildSummarizeCurrentChatPrompt } = require("./compactor");
const { buildDiagnostics } = require("./antigravityState");
const { getBrainRoot } = require("./antigravityLocator");
const { probeRuntimeTraces } = require("./runtimeTraceProbe");
const { analyzeLiveUsage } = require("./liveUsageAnalysis");
const { resolveAutoPinBrainPath } = require("./sessionPinning");

function formatCompactCount(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "0";
  }
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 100) / 10}k`;
  }
  return String(value);
}

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0%";
  }
  return `${Math.round(value * 100)}%`;
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "unknown";
  }
  return new Date(timestamp).toLocaleString();
}

function formatBytes(size) {
  if (!size || size < 1024) {
    return `${size || 0} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function shortSessionId(sessionId) {
  if (!sessionId) {
    return "unknown";
  }
  return sessionId.slice(0, 8);
}

function formatUsageSource(source) {
  switch (source) {
    case "liveGeneratorMetadata":
      return "Live Antigravity generator metadata";
    case "artifactEstimate":
    default:
      return "Tracked artifact estimate";
  }
}

function formatResolutionSource(source) {
  switch (source) {
    case "liveVisibleTab":
      return "Visible Antigravity tab";
    case "liveDiagnosticsActiveSession":
      return "Live active conversation";
    case "liveTrajectory":
      return "Live Antigravity trajectory";
    case "configuredPath":
      return "Configured brain path";
    case "workspaceState":
      return "Workspace-linked Antigravity state";
    case "latestConversationMtime":
      return "Latest conversation activity";
    case "latestBrainMtime":
      return "Latest brain activity fallback";
    default:
      return "Unavailable";
  }
}

function formatRemainingFraction(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return `${Math.round(value * 100)}% remaining`;
}

function buildBreakdownMarkdown(snapshot) {
  const lines = [];
  const liveUsage = snapshot.liveLatestGeneration ? snapshot.liveLatestGeneration.usage : null;
  const liveUsageAnalysis = analyzeLiveUsage(snapshot);
  lines.push("# Antigravity Context Watcher");
  lines.push("");
  lines.push(`- Model: ${snapshot.activeProfile ? snapshot.activeProfile.label : "Not selected"}`);
  if (snapshot.detectedModelLabel) {
    lines.push(`- Detected live model: ${snapshot.detectedModelLabel}`);
  }
  lines.push(`- Session: ${snapshot.brainDir || "No active brain directory found"}`);
  lines.push(`- Session id: ${snapshot.sessionId || "unknown"}`);
  lines.push(`- Resolution source: ${formatResolutionSource(snapshot.resolutionSource)}`);
  if (snapshot.activeTrajectoryTitle) {
    lines.push(`- Trajectory title: ${snapshot.activeTrajectoryTitle}`);
  }
  lines.push(`- Usage source: ${formatUsageSource(snapshot.usageSource)}`);
  lines.push(`- Retained context tokens: ${snapshot.estimatedTrackedTokens}`);
  lines.push(`- Supporting artifact estimate: ${snapshot.artifactEstimateTokens}`);
  lines.push(`- Session artifacts counted: ${snapshot.sessionArtifactCount}`);
  lines.push(`- Effective max input: ${snapshot.budget ? snapshot.budget.effectiveMaxInputTokens : 0}`);
  lines.push(`- Effective max output: ${snapshot.budget ? snapshot.budget.effectiveMaxOutputTokens : 0}`);
  lines.push(`- Provider reference: ${formatProviderReference(snapshot.budget)}`);
  lines.push(`- Usage: ${formatPercent(snapshot.percentUsed)}`);
  lines.push(`- Remaining input headroom: ${snapshot.remainingInputHeadroom}`);
  lines.push(`- Last updated: ${formatDate(snapshot.lastUpdatedAt)}`);
  if (snapshot.conversation && snapshot.conversation.path) {
    lines.push(
      `- Conversation file: ${snapshot.conversation.path} (${snapshot.conversation.exists ? formatBytes(snapshot.conversation.size) : "missing"})`
    );
  }
  lines.push("");
  if (snapshot.usageSource === "liveGeneratorMetadata" && liveUsage) {
    lines.push("> Primary usage comes from Antigravity live generator metadata. Supporting files below are shown for handoff context and are not added again to the retained-token count.");
    if (liveUsageAnalysis.hiddenContextLikely) {
      lines.push("> Antigravity is carrying substantial retained context beyond the decoded recent live steps. Fresh chats may already include hidden workspace, system, retrieved, or older cached context.");
    }
  } else {
    lines.push("> Fallback mode. This value is assembled from tracked Antigravity artifacts because no live generator usage was recovered for this chat.");
  }
  if (snapshot.liveReady && snapshot.liveError) {
    lines.push(`> Live bridge warning: ${snapshot.liveError}`);
  }
  if (snapshot.usageSource !== "liveGeneratorMetadata" && snapshot.conversation && snapshot.conversation.exists && snapshot.sessionArtifactCount === 0) {
    lines.push("> This chat is active on disk, but Antigravity has not written any decodable session artifacts for it yet. Live turns inside the `.pb` conversation blob are not counted.");
  }
  lines.push("");
  if (liveUsage) {
    lines.push("## Live Usage Breakdown");
    lines.push("");
    lines.push(`- Latest generation input tokens: ${liveUsage.effectiveInputTokens}`);
    lines.push(`- Latest generation output tokens: ${liveUsage.outputTokens}`);
    lines.push(`- Retained context after latest generation: ${liveUsage.retainedTokens}`);
    lines.push(`- Uncached input tokens: ${liveUsage.uncachedInputTokens}`);
    lines.push(`- Prompt token count: ${liveUsage.promptTokenCount}`);
    lines.push(`- Cache read tokens: ${liveUsage.cacheReadTokens}`);
    lines.push(`- Cached content tokens: ${liveUsage.cachedContentTokenCount}`);
    lines.push(`- Cache creation input tokens: ${liveUsage.cacheCreationInputTokens}`);
    lines.push(`- Tool use prompt tokens: ${liveUsage.toolUsePromptTokenCount}`);
    lines.push(`- Approximate new tokens processed this turn: ${liveUsageAnalysis.approximateNewTokensThisTurn}`);
    lines.push(`- Prior context reused from cache: ${liveUsageAnalysis.cachedInputTokens}`);
    lines.push(`- Decoded recent live-step tokens: ${liveUsageAnalysis.decodedRecentStepTokens}`);
    lines.push(`- Retained tokens not explained by decoded live steps: ${liveUsageAnalysis.unexplainedRetainedTokens}`);
    lines.push(`- Decoded live-step coverage: ${formatPercent(liveUsageAnalysis.decodedCoverageFraction)}`);
    lines.push(`- API provider: ${liveUsage.apiProvider || "unknown"}`);
    lines.push(`- Response id: ${liveUsage.responseId || "unknown"}`);
    lines.push(`- Latest generation step indices: ${snapshot.liveLatestGeneration && snapshot.liveLatestGeneration.stepIndices.length > 0 ? snapshot.liveLatestGeneration.stepIndices.join(", ") : "unknown"}`);
    lines.push(`- Metadata generations observed: ${snapshot.liveLatestGeneration ? snapshot.liveLatestGeneration.generationCount : 0}`);
    lines.push(`- Max observed retained tokens: ${snapshot.liveLatestGeneration ? snapshot.liveLatestGeneration.maxObservedRetainedTokens : 0}`);
    lines.push("- Note: latest-generation input includes prior retained chat context, not just the last user message.");
    if (liveUsageAnalysis.hiddenContextLikely) {
      lines.push("- Observation: retained context is far larger than decoded live steps. Antigravity is likely adding hidden workspace, system, retrieved, or older cached context.");
    }
    lines.push("");
  }
  lines.push("## Category Totals");
  lines.push("");
  for (const [category, total] of Object.entries(snapshot.categoryTotals || {}).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${category}: ${total}`);
  }
  lines.push("");
  lines.push("## Recent Live Steps");
  lines.push("");
  if (!snapshot.liveRecentSteps || snapshot.liveRecentSteps.length === 0) {
    lines.push("- No live trajectory steps decoded.");
  } else {
    for (const step of snapshot.liveRecentSteps.slice(-8)) {
      const preview = (step.text || "").replace(/\s+/g, " ").slice(0, 200);
      lines.push(`- step ${step.stepIndex} (${step.type || "unknown"}) | ${step.tokens} tokens | ${preview}`);
    }
  }
  lines.push("");
  lines.push("## Supporting Artifacts");
  lines.push("");
  if (!snapshot.entries || snapshot.entries.length === 0) {
    lines.push("- No supporting artifacts counted.");
  } else {
    for (const entry of snapshot.entries || []) {
      const marker = entry.includedInEstimate ? "[x]" : "[ ]";
      lines.push(`- ${marker} ${entry.category}: ${entry.tokens} tokens - ${entry.path}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function buildDiagnosticsMarkdown(snapshot, diagnostics, runtimeTraceProbe) {
  const lines = [];
  const liveUsage = snapshot.liveLatestGeneration ? snapshot.liveLatestGeneration.usage : null;
  const liveUsageAnalysis = analyzeLiveUsage(snapshot);
  lines.push("# Antigravity Context Diagnostics");
  lines.push("");
  lines.push(`- Extension build: ${extensionPackage.version}`);
  lines.push("");
  lines.push("## Current Resolution");
  lines.push("");
  lines.push(`- Selected model profile: ${snapshot.activeProfile ? snapshot.activeProfile.label : "Not selected"}`);
  lines.push(`- Detected live model: ${snapshot.detectedModelLabel || "unknown"}`);
  lines.push(`- Active brain dir: ${snapshot.brainDir || "not resolved"}`);
  lines.push(`- Session id: ${snapshot.sessionId || "unknown"}`);
  lines.push(`- Resolution source: ${formatResolutionSource(snapshot.resolutionSource)}`);
  lines.push(`- Usage source: ${formatUsageSource(snapshot.usageSource)}`);
  lines.push(`- Retained context tokens: ${snapshot.estimatedTrackedTokens}`);
  lines.push(`- Supporting artifact estimate: ${snapshot.artifactEstimateTokens}`);
  if (snapshot.conversation && snapshot.conversation.path) {
    lines.push(`- Conversation file: ${snapshot.conversation.path}`);
    lines.push(`- Conversation file exists: ${snapshot.conversation.exists ? "yes" : "no"}`);
    lines.push(`- Conversation file size: ${formatBytes(snapshot.conversation.size)}`);
    lines.push(`- Conversation file updated: ${formatDate(snapshot.conversation.mtimeMs)}`);
  }
  lines.push(`- Session artifacts counted: ${snapshot.sessionArtifactCount}`);
  lines.push("");
  lines.push("## Live Language Server");
  lines.push("");
  lines.push(`- Live bridge ready: ${snapshot.liveReady ? "yes" : "no"}`);
  if (snapshot.liveConnection) {
    lines.push(`- Connection source: ${snapshot.liveConnection.source || "unknown"}`);
    lines.push(`- Port: ${snapshot.liveConnection.port || 0}`);
    lines.push(`- TLS: ${snapshot.liveConnection.useTls ? "yes" : "no"}`);
    lines.push(`- CSRF token available: ${snapshot.liveConnection.hasCsrfToken ? "yes" : "no"}`);
  }
  if (snapshot.liveError) {
    lines.push(`- Live bridge error: ${snapshot.liveError}`);
  }
  lines.push("");
  lines.push("## Live Model Menu");
  lines.push("");
  if (!snapshot.availableModelOptions || snapshot.availableModelOptions.length === 0) {
    lines.push("- No live model menu decoded from Antigravity.");
  } else {
    for (const option of snapshot.availableModelOptions) {
      const parts = [];
      if (option.placeholder) {
        parts.push(option.placeholder);
      }
      const remaining = formatRemainingFraction(option.remainingFraction);
      if (remaining) {
        parts.push(remaining);
      }
      if (option.resetTime) {
        parts.push(`resets ${option.resetTime}`);
      }
      if (option.tagTitle) {
        parts.push(option.tagTitle);
      }
      lines.push(`- ${option.label}${parts.length > 0 ? ` | ${parts.join(" | ")}` : ""}`);
    }
  }
  lines.push("");
  lines.push("## Active Trajectory");
  lines.push("");
  lines.push(`- Title: ${snapshot.activeTrajectoryTitle || "unknown"}`);
  const trajectoryLastModified = snapshot.diagnosticsActiveSession
    ? Date.parse(snapshot.diagnosticsActiveSession.lastModifiedTime || "")
    : Date.parse((snapshot.activeTrajectorySummary && snapshot.activeTrajectorySummary.lastModifiedTime) || "");
  const trajectoryStepCount = snapshot.diagnosticsActiveSession && typeof snapshot.diagnosticsActiveSession.stepCount === "number"
    ? snapshot.diagnosticsActiveSession.stepCount
    : (snapshot.activeTrajectorySummary && typeof snapshot.activeTrajectorySummary.stepCount === "number"
      ? snapshot.activeTrajectorySummary.stepCount
      : null);
  if (trajectoryLastModified) {
    lines.push(`- Last modified: ${formatDate(trajectoryLastModified)}`);
  }
  if (typeof trajectoryStepCount === "number") {
    lines.push(`- Step count: ${trajectoryStepCount}`);
  }
  if (snapshot.diagnosticsActiveSession) {
    lines.push(`- Diagnostics active session: ${snapshot.diagnosticsActiveSession.sessionId} (${snapshot.diagnosticsActiveSession.title || "untitled"})`);
  }
  if (snapshot.activeTabSelection && snapshot.activeTabSelection.tab) {
    lines.push(`- Active tab label: ${snapshot.activeTabSelection.tab.label || "unknown"}`);
    lines.push(`- Active tab input: ${snapshot.activeTabSelection.tab.inputKind || "unknown"}${snapshot.activeTabSelection.tab.viewType ? ` | ${snapshot.activeTabSelection.tab.viewType}` : ""}`);
    lines.push(`- Active tab match: ${snapshot.activeTabSelection.matchedBy || "none"}${snapshot.activeTabSelection.sessionId ? ` -> ${snapshot.activeTabSelection.sessionId}` : ""}`);
  }
  lines.push(`- Live selection source: ${snapshot.liveSelectionSource || "unknown"}`);
  lines.push(`- Recent live steps decoded: ${snapshot.liveRecentSteps ? snapshot.liveRecentSteps.length : 0}`);
  lines.push("");
  lines.push("## Latest Generation Usage");
  lines.push("");
  if (!liveUsage) {
    lines.push("- No live generator usage metadata decoded for the current chat.");
  } else {
    lines.push(`- Latest generation input tokens: ${liveUsage.effectiveInputTokens}`);
    lines.push(`- Latest generation output tokens: ${liveUsage.outputTokens}`);
    lines.push(`- Retained context after latest generation: ${liveUsage.retainedTokens}`);
    lines.push(`- Uncached input tokens: ${liveUsage.uncachedInputTokens}`);
    lines.push(`- Prompt token count: ${liveUsage.promptTokenCount}`);
    lines.push(`- Cache read tokens: ${liveUsage.cacheReadTokens}`);
    lines.push(`- Cached content tokens: ${liveUsage.cachedContentTokenCount}`);
    lines.push(`- Cache creation input tokens: ${liveUsage.cacheCreationInputTokens}`);
    lines.push(`- Tool use prompt tokens: ${liveUsage.toolUsePromptTokenCount}`);
    lines.push(`- Approximate new tokens processed this turn: ${liveUsageAnalysis.approximateNewTokensThisTurn}`);
    lines.push(`- Prior context reused from cache: ${liveUsageAnalysis.cachedInputTokens}`);
    lines.push(`- Decoded recent live-step tokens: ${liveUsageAnalysis.decodedRecentStepTokens}`);
    lines.push(`- Retained tokens not explained by decoded live steps: ${liveUsageAnalysis.unexplainedRetainedTokens}`);
    lines.push(`- Decoded live-step coverage: ${formatPercent(liveUsageAnalysis.decodedCoverageFraction)}`);
    lines.push(`- API provider: ${liveUsage.apiProvider || "unknown"}`);
    lines.push(`- Response id: ${liveUsage.responseId || "unknown"}`);
    lines.push(`- Response session id: ${liveUsage.sessionId || "unknown"}`);
    lines.push(`- Latest generation step indices: ${snapshot.liveLatestGeneration && snapshot.liveLatestGeneration.stepIndices.length > 0 ? snapshot.liveLatestGeneration.stepIndices.join(", ") : "unknown"}`);
    lines.push(`- Metadata generations observed: ${snapshot.liveLatestGeneration ? snapshot.liveLatestGeneration.generationCount : 0}`);
    lines.push(`- Max observed retained tokens: ${snapshot.liveLatestGeneration ? snapshot.liveLatestGeneration.maxObservedRetainedTokens : 0}`);
    lines.push("- Note: latest-generation input includes prior retained chat context, not just the last user message.");
    if (liveUsageAnalysis.hiddenContextLikely) {
      lines.push("- Observation: retained context is far larger than decoded live steps. Antigravity is likely adding hidden workspace, system, retrieved, or older cached context.");
    }
  }
  lines.push("");
  lines.push("## Recent Live Steps");
  lines.push("");
  if (!snapshot.liveRecentSteps || snapshot.liveRecentSteps.length === 0) {
    lines.push("- No live trajectory steps decoded.");
  } else {
    for (const step of snapshot.liveRecentSteps.slice(-8)) {
      const preview = (step.text || "").replace(/\s+/g, " ").slice(0, 240);
      lines.push(`- step ${step.stepIndex} (${step.type || "unknown"}) | ${step.tokens} tokens | ${preview}`);
    }
  }
  lines.push("");
  lines.push("## Workspace Candidates");
  lines.push("");
  if (!diagnostics.workspaceCandidates || diagnostics.workspaceCandidates.length === 0) {
    lines.push("- No workspace-linked Antigravity sessions found in workspace storage.");
  } else {
    for (const candidate of diagnostics.workspaceCandidates.slice(0, 8)) {
      lines.push(
        `- ${candidate.sessionId} | score ${candidate.score} | workspace match: ${candidate.workspaceMatched ? "yes" : "no"} | keys: ${candidate.sourceKeys.join(", ")} | db: ${candidate.sourceDbPath}`
      );
    }
  }
  lines.push("");
  lines.push("## Latest Conversations");
  lines.push("");
  if (!diagnostics.latestConversations || diagnostics.latestConversations.length === 0) {
    lines.push("- No local Antigravity conversation blobs found.");
  } else {
    for (const candidate of diagnostics.latestConversations) {
      lines.push(
        `- ${candidate.sessionId} | updated ${formatDate(candidate.conversation.mtimeMs)} | size ${formatBytes(candidate.conversation.size)} | brain dir: ${candidate.brainDir ? candidate.brainDir : "missing"}`
      );
    }
  }
  lines.push("");
  lines.push("## Model Hints");
  lines.push("");
  lines.push(`- SQLite available: ${diagnostics.sqliteAvailable ? "yes" : "no"}`);
  lines.push(`- Global storage db: ${diagnostics.globalStorageDbPath}`);
  if (diagnostics.globalHints.modelConfigNames.length === 0) {
    lines.push("- Allowed command model configs: none decoded");
  } else {
    lines.push(`- Allowed command model configs: ${diagnostics.globalHints.modelConfigNames.join(", ")}`);
  }
  if (diagnostics.globalHints.modelPreferencesStrings.length > 0) {
    lines.push(`- Model preference strings: ${diagnostics.globalHints.modelPreferencesStrings.join(" | ")}`);
  }
  if (diagnostics.globalHints.modelCreditsStrings.length > 0) {
    lines.push(`- Model credit strings: ${diagnostics.globalHints.modelCreditsStrings.join(" | ")}`);
  }
  lines.push("");
  lines.push("## Limits");
  lines.push("");
  lines.push("- Live generator usage now comes from Antigravity language-server RPC when available.");
  lines.push("- Conversation `.pb` files are still opaque on disk; this extension currently relies on live RPC rather than decoding protobuf storage directly.");
  lines.push("- If the live bridge is unavailable, the extension falls back to tracked artifact estimation.");
  lines.push("- The extension cannot send a summarization prompt into the active Antigravity chat automatically with the APIs found so far.");
  lines.push("");
  lines.push("## Runtime Trace Probe");
  lines.push("");
  if (!runtimeTraceProbe) {
    lines.push("- Runtime probe not executed.");
  } else {
    lines.push(`- Hidden Antigravity commands discovered: ${runtimeTraceProbe.antigravityCommands.length}`);
    for (const trace of runtimeTraceProbe.traces) {
      lines.push(`- ${trace.commandId}: ${trace.available ? "available" : "missing"}${trace.error ? ` | error: ${trace.error}` : ""}`);
      if (!trace.available || trace.error) {
        continue;
      }
      lines.push(`- ${trace.commandId} payload: ${trace.rawType || "unknown"} | raw length ${trace.rawLength} | parsed: ${trace.parsed ? "yes" : "no"} | scanned nodes: ${trace.scan.nodeCount}${trace.scan.truncated ? " | truncated" : ""}`);
      if (trace.scan.sessionHits.length > 0) {
        for (const hit of trace.scan.sessionHits.slice(0, 5)) {
          lines.push(`- ${trace.commandId} session hit: ${hit.path} -> ${hit.preview}`);
        }
      }
      if (trace.scan.tokenHits.length > 0) {
        for (const hit of trace.scan.tokenHits.slice(0, 8)) {
          lines.push(`- ${trace.commandId} token field: ${hit.path} = ${hit.value}`);
        }
      }
      if (trace.scan.modelHints.length > 0) {
        for (const hit of trace.scan.modelHints.slice(0, 6)) {
          lines.push(`- ${trace.commandId} model hint: ${hit.path} -> ${hit.value}`);
        }
      }
      if (trace.scan.textHits.length > 0) {
        for (const hit of trace.scan.textHits.slice(0, 4)) {
          lines.push(`- ${trace.commandId} text hit: ${hit.path} -> ${hit.preview}`);
        }
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

function applyStatusBarStyle(statusBarItem, snapshot, config) {
  const warning = config.get("warningThreshold", 0.7);
  const critical = config.get("criticalThreshold", 0.85);
  statusBarItem.backgroundColor = undefined;
  statusBarItem.color = undefined;
  if (snapshot.percentUsed >= critical) {
    statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    statusBarItem.color = new vscode.ThemeColor("statusBarItem.errorForeground");
  } else if (snapshot.percentUsed >= warning) {
    statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    statusBarItem.color = new vscode.ThemeColor("statusBarItem.warningForeground");
  }
}

function buildModelPickerItems(profiles, snapshot) {
  const availableByLabel = new Map();
  for (const option of snapshot && Array.isArray(snapshot.availableModelOptions) ? snapshot.availableModelOptions : []) {
    availableByLabel.set(option.label, option);
  }

  return profiles
    .slice()
    .sort((left, right) => {
      return Number(Boolean(availableByLabel.get(right.label))) - Number(Boolean(availableByLabel.get(left.label)));
    })
    .map((profile) => {
      const liveOption = availableByLabel.get(profile.label);
      const detailParts = [
        profile.budgetMode === "combined"
          ? `Combined budget, effective input ${profile.effectiveMaxInputTokens || profile.effectiveContextTokens || 0}`
          : `Separate budget, effective input ${profile.effectiveMaxInputTokens || 0}`
      ];
      if (liveOption) {
        const remaining = formatRemainingFraction(liveOption.remainingFraction);
        detailParts.push(`Live in Antigravity${remaining ? `, ${remaining}` : ""}`);
        if (liveOption.resetTime) {
          detailParts.push(`resets ${liveOption.resetTime}`);
        }
      }
      return {
        label: profile.label,
        description: liveOption ? `${profile.provider} | available in current Antigravity menu` : profile.provider,
        detail: detailParts.join(" | "),
        profile
      };
    });
}

function buildSessionPickerItems(snapshot, diagnostics) {
  const diagnosticsBySession = new Map();
  for (const entry of snapshot && Array.isArray(snapshot.diagnosticsRecentTrajectories)
    ? snapshot.diagnosticsRecentTrajectories
    : []) {
    diagnosticsBySession.set(entry.sessionId, entry);
  }

  return (diagnostics.latestConversations || []).map((candidate) => {
    const diagnosticEntry = diagnosticsBySession.get(candidate.sessionId);
    const title = diagnosticEntry && diagnosticEntry.title
      ? diagnosticEntry.title
      : `Session ${shortSessionId(candidate.sessionId)}`;
    const isCurrent = snapshot.sessionId && snapshot.sessionId === candidate.sessionId;
    const isPinned = snapshot.resolutionSource === "configuredPath" && snapshot.sessionId === candidate.sessionId;
    const descriptionParts = [
      candidate.sessionId,
      `updated ${formatDate(candidate.conversation.mtimeMs)}`
    ];
    if (isCurrent) {
      descriptionParts.unshift("Current");
    }
    if (isPinned) {
      descriptionParts.unshift("Pinned");
    }
    return {
      label: title,
      description: descriptionParts.join(" | "),
      detail: `Conversation ${formatBytes(candidate.conversation.size)}${candidate.brainDir ? ` | ${candidate.brainDir}` : ""}`,
      candidate
    };
  });
}

async function showModelPicker(tracker, forcePrompt) {
  const config = vscode.workspace.getConfiguration("contextWatcher");
  const profiles = getConfiguredProfiles(config);
  if (profiles.length === 0) {
    return null;
  }

  const activeModelId = getActiveModelId(config, profiles);
  if (!forcePrompt && activeModelId) {
    return activeModelId;
  }

  const snapshot = tracker ? tracker.getSnapshot() : null;
  const picked = await vscode.window.showQuickPick(
    buildModelPickerItems(profiles, snapshot),
    {
      placeHolder: snapshot && snapshot.detectedModelLabel
        ? `Select the model profile used for counting this Antigravity session. Detected live model: ${snapshot.detectedModelLabel}`
        : "Select the model profile used for counting this Antigravity session",
      ignoreFocusOut: true
    }
  );

  if (!picked) {
    return activeModelId || null;
  }

  await config.update("activeModelId", picked.profile.id, vscode.ConfigurationTarget.Global);
  return picked.profile.id;
}

async function ensureModelSelected(tracker) {
  return showModelPicker(tracker, false);
}

async function openMarkdownDocument(content) {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

function updateStatusBar(statusBarItem, tracker) {
  const snapshot = tracker.getSnapshot();
  const config = vscode.workspace.getConfiguration("contextWatcher");
  const liveUsage = snapshot.liveLatestGeneration ? snapshot.liveLatestGeneration.usage : null;
  const liveUsageAnalysis = analyzeLiveUsage(snapshot);

  if (!snapshot.activeProfile) {
    statusBarItem.text = "AG: Pick Model";
    statusBarItem.tooltip = snapshot.detectedModelLabel
      ? `Select a model profile for Antigravity context counting.\nDetected live model: ${snapshot.detectedModelLabel}\nClick for actions.`
      : "Select a model profile for Antigravity context counting.\nClick for actions.";
    statusBarItem.show();
    return;
  }

  if (!snapshot.brainDir && !snapshot.sessionId) {
    statusBarItem.text = `AG Est. 0 / ${formatCompactCount(snapshot.budget.effectiveMaxInputTokens)}`;
    statusBarItem.tooltip = "No active Antigravity brain directory found.\nClick for actions.";
    statusBarItem.show();
    return;
  }

  const textPrefix = snapshot.sessionId ? `AG ${shortSessionId(snapshot.sessionId)}` : "AG";
  const tooltipLines = [
    `Model: ${snapshot.activeProfile.label}`,
    `Detected live model: ${snapshot.detectedModelLabel || "unknown"}`,
    `Session: ${snapshot.sessionId || "unknown"}`,
    `Resolution: ${formatResolutionSource(snapshot.resolutionSource)}`,
    `Live selection source: ${snapshot.liveSelectionSource || "unknown"}`,
    `Usage source: ${formatUsageSource(snapshot.usageSource)}`,
    `Effective max input: ${snapshot.budget.effectiveMaxInputTokens}`,
    `Effective max output: ${snapshot.budget.effectiveMaxOutputTokens}`,
    `Provider reference: ${formatProviderReference(snapshot.budget)}`,
    `Retained context tokens: ${snapshot.estimatedTrackedTokens}`,
    `Supporting artifact estimate: ${snapshot.artifactEstimateTokens}`,
    `Conversation file: ${snapshot.conversation && snapshot.conversation.exists ? formatBytes(snapshot.conversation.size) : "missing"}`,
    `Session artifacts counted: ${snapshot.sessionArtifactCount}`,
    `Last updated: ${formatDate(snapshot.lastUpdatedAt)}`,
    "Click for actions."
  ];
  if (snapshot.usageSource === "liveGeneratorMetadata" && liveUsage) {
    tooltipLines.splice(
      4,
      0,
      `Latest gen input: ${liveUsage.effectiveInputTokens}`,
      `Latest gen output: ${liveUsage.outputTokens}`,
      `Cache read: ${liveUsage.cacheReadTokens}`,
      `Approx new this turn: ${liveUsageAnalysis.approximateNewTokensThisTurn}`,
      `Decoded live steps: ${liveUsageAnalysis.decodedRecentStepTokens}`,
      `Not explained by decoded steps: ${liveUsageAnalysis.unexplainedRetainedTokens}`,
      liveUsageAnalysis.hiddenContextLikely
        ? "Retained context is much larger than the decoded visible steps."
        : "Decoded live steps cover only part of the retained context.",
      "Latest generation input includes prior retained context."
    );
  } else if (snapshot.conversation && snapshot.conversation.exists && snapshot.sessionArtifactCount === 0) {
    tooltipLines.splice(
      3,
      0,
      "Current conversation detected, but no decodable session artifacts have been written yet."
    );
  }
  if (
    snapshot.detectedModelLabel
    && snapshot.activeProfile
    && snapshot.detectedModelLabel !== snapshot.activeProfile.label
  ) {
    tooltipLines.splice(1, 0, `Selected model differs from live model: ${snapshot.detectedModelLabel}`);
  }
  statusBarItem.text = `${textPrefix} ${formatCompactCount(snapshot.estimatedTrackedTokens)} / ${formatCompactCount(snapshot.budget.effectiveMaxInputTokens)} (${formatPercent(snapshot.percentUsed)})`;
  statusBarItem.tooltip = tooltipLines.join("\n");
  applyStatusBarStyle(statusBarItem, snapshot, config);
  statusBarItem.show();
}

async function activate(context) {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  statusBarItem.command = "contextWatcher.showActions";
  context.subscriptions.push(statusBarItem);

  const tracker = new ContextTracker(vscode);
  let autoPinPromise = null;

  const maybeAutoPinVisibleSession = async () => {
    const config = vscode.workspace.getConfiguration("contextWatcher");
    const nextBrainPath = resolveAutoPinBrainPath(
      tracker.getSnapshot(),
      config.get("activeBrainPath", ""),
      config.get("autoPinVisibleSession", true)
    );
    if (!nextBrainPath) {
      return false;
    }
    await config.update("activeBrainPath", nextBrainPath, vscode.ConfigurationTarget.Global);
    return true;
  };

  const syncAutoPinVisibleSession = async (detailLevel = "light") => {
    if (autoPinPromise) {
      return autoPinPromise;
    }

    autoPinPromise = (async () => {
      const autoPinned = await maybeAutoPinVisibleSession();
      if (autoPinned) {
        await tracker.refresh({ detailLevel });
        updateStatusBar(statusBarItem, tracker);
      }
      return autoPinned;
    })().finally(() => {
      autoPinPromise = null;
    });

    return autoPinPromise;
  };

  context.subscriptions.push({
    dispose() {
      tracker.stop();
    }
  });

  tracker.on("changed", () => {
    updateStatusBar(statusBarItem, tracker);
    void syncAutoPinVisibleSession("light").catch((error) => {
      console.error("[contextWatcher] auto pin failed", error);
    });
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("contextWatcher")) {
        return;
      }
      const pollingChanged =
        event.affectsConfiguration("contextWatcher.refreshIntervalMs")
        || event.affectsConfiguration("contextWatcher.fullRefreshIntervalMs");
      if (pollingChanged) {
        tracker.stop();
        tracker.start();
      }
      void tracker.refresh({ detailLevel: pollingChanged ? "auto" : "light" }).then(() => {
        updateStatusBar(statusBarItem, tracker);
      }).catch((error) => {
        console.error("[contextWatcher] configuration refresh failed", error);
      });
    })
  );

  const scheduleRefresh = (() => {
    let timeout = null;
    return (delayMs = 250) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        timeout = null;
        void tracker.refresh({ detailLevel: "light" }).then(() => {
          updateStatusBar(statusBarItem, tracker);
          return syncAutoPinVisibleSession("light");
        }).catch((error) => {
          console.error("[contextWatcher] refresh failed", error);
        });
      }, delayMs);
    };
  })();

  if (vscode.window.tabGroups) {
    if (typeof vscode.window.tabGroups.onDidChangeTabs === "function") {
      context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabs(() => {
          scheduleRefresh(150);
        })
      );
    }
    if (typeof vscode.window.tabGroups.onDidChangeTabGroups === "function") {
      context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabGroups(() => {
          scheduleRefresh(150);
        })
      );
    }
  }

  const refreshTracker = async (showMessage, detailLevel = "full") => {
    await tracker.refresh({ detailLevel });
    await syncAutoPinVisibleSession("light");
    updateStatusBar(statusBarItem, tracker);
    if (showMessage) {
      await vscode.window.setStatusBarMessage("Context Watcher refreshed.", 1500);
    }
  };

  const pickModelAndRefresh = async () => {
    const previousId = getActiveModelId(
      vscode.workspace.getConfiguration("contextWatcher"),
      getConfiguredProfiles(vscode.workspace.getConfiguration("contextWatcher"))
    );
    const selectedId = await showModelPicker(tracker, true);
    await refreshTracker(false);
    if (selectedId && selectedId !== previousId) {
      const snapshot = tracker.getSnapshot();
      await vscode.window.showInformationMessage(
        `Context Watcher model set to ${snapshot.activeProfile ? snapshot.activeProfile.label : selectedId}.`
      );
    }
  };

  const copyModelBudgetOverrideTemplate = async () => {
    const config = vscode.workspace.getConfiguration("contextWatcher");
    const profiles = getConfiguredProfiles(config);
    const snippet = JSON.stringify({
      "contextWatcher.modelBudgetOverrides": buildModelBudgetOverrideTemplate(profiles)
    }, null, 2);
    await vscode.env.clipboard.writeText(snippet);
    await vscode.window.showInformationMessage(
      "Copied a model budget override template. Paste it into your Antigravity settings JSON and adjust the effective limits per model."
    );
  };

  const pickActiveSessionAndRefresh = async () => {
    await refreshTracker(false);
    const snapshot = tracker.getSnapshot();
    const diagnostics = buildDiagnostics(
      tracker.getWorkspaceFolders(),
      getBrainRoot,
      {
        brainDir: snapshot.brainDir,
        sessionId: snapshot.sessionId,
        source: snapshot.resolutionSource,
        conversation: snapshot.conversation
      }
    );

    const items = buildSessionPickerItems(snapshot, diagnostics);
    if (items.length === 0) {
      await vscode.window.showWarningMessage("No recent Antigravity conversations were found.");
      return;
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Pick the Antigravity chat session to pin",
      ignoreFocusOut: true
    });

    if (!picked) {
      return;
    }

    await vscode.workspace
      .getConfiguration("contextWatcher")
      .update("activeBrainPath", picked.candidate.brainDirPath || picked.candidate.brainDir, vscode.ConfigurationTarget.Global);
    await refreshTracker(false);
    await vscode.window.showInformationMessage(`Pinned Context Watcher to ${picked.label}.`);
  };

  const clearPinnedSessionAndRefresh = async () => {
    const config = vscode.workspace.getConfiguration("contextWatcher");
    const current = config.get("activeBrainPath", "");
    if (!current) {
      await vscode.window.showInformationMessage("Context Watcher is already using automatic session detection.");
      return;
    }
    await config.update("activeBrainPath", "", vscode.ConfigurationTarget.Global);
    await refreshTracker(false);
    await vscode.window.showInformationMessage("Context Watcher session pin cleared.");
  };

  const showActions = async () => {
    await refreshTracker(false);
    const snapshot = tracker.getSnapshot();
    const action = await vscode.window.showQuickPick(
      [
        {
          label: "$(list-unordered) Show Breakdown",
          description: snapshot.brainDir ? formatCompactCount(snapshot.estimatedTrackedTokens) + " retained tokens" : "No active brain",
          value: "breakdown"
        },
        {
          label: "$(symbol-key) Pick Model Profile",
          description: snapshot.activeProfile ? snapshot.activeProfile.label : (snapshot.detectedModelLabel || "Not selected"),
          value: "pickModel"
        },
        {
          label: "$(settings-gear) Copy Model Budget Override Template",
          description: "Copy JSON for per-model effective context limits",
          value: "copyBudgetTemplate"
        },
        {
          label: "$(pin) Pick Active Session",
          description: snapshot.sessionId ? `${shortSessionId(snapshot.sessionId)}${snapshot.resolutionSource === "configuredPath" ? " | pinned" : ""}` : "Choose a specific chat to pin",
          value: "pickSession"
        },
        {
          label: "$(close) Clear Pinned Session",
          description: "Return to automatic session detection",
          value: "clearPinnedSession"
        },
        {
          label: "$(refresh) Refresh",
          description: `Last updated ${formatDate(snapshot.lastUpdatedAt)}`,
          value: "refresh"
        },
        {
          label: "$(copy) Copy New Chat Handoff",
          description: "Assemble a local handoff from live steps and supporting artifacts",
          value: "handoff"
        },
        {
          label: "$(comment-discussion) Copy Summarize Current Chat Prompt",
          description: "Instruction-only prompt to paste into the current Antigravity chat",
          value: "summarizePrompt"
        },
        {
          label: "$(pulse) Show Diagnostics",
          description: "Inspect Antigravity session and model discovery state",
          value: "diagnostics"
        },
        {
          label: "$(gear) Open Settings",
          description: "Open Context Watcher settings",
          value: "settings"
        }
      ],
      {
        placeHolder: "Antigravity Context Watcher actions",
        ignoreFocusOut: true
      }
    );

    if (!action) {
      return;
    }

    switch (action.value) {
      case "breakdown":
        await openMarkdownDocument(buildBreakdownMarkdown(tracker.getSnapshot()));
        return;
      case "pickModel":
        await pickModelAndRefresh();
        return;
      case "copyBudgetTemplate":
        await copyModelBudgetOverrideTemplate();
        return;
      case "pickSession":
        await pickActiveSessionAndRefresh();
        return;
      case "clearPinnedSession":
        await clearPinnedSessionAndRefresh();
        return;
      case "refresh":
        await refreshTracker(true);
        return;
      case "handoff":
        await vscode.commands.executeCommand("contextWatcher.copyCompactPrompt");
        return;
      case "summarizePrompt":
        await vscode.commands.executeCommand("contextWatcher.copySummarizeCurrentChatPrompt");
        return;
      case "diagnostics":
        await vscode.commands.executeCommand("contextWatcher.showDiagnostics");
        return;
      case "settings":
        await vscode.commands.executeCommand("contextWatcher.openSettings");
        return;
      default:
        return;
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("contextWatcher.refresh", async () => {
      await refreshTracker(true, "full");
    }),
    vscode.commands.registerCommand("contextWatcher.showBreakdown", async () => {
      await refreshTracker(false, "full");
      await openMarkdownDocument(buildBreakdownMarkdown(tracker.getSnapshot()));
    }),
    vscode.commands.registerCommand("contextWatcher.showActions", showActions),
    vscode.commands.registerCommand("contextWatcher.pickModelProfile", async () => {
      await pickModelAndRefresh();
    }),
    vscode.commands.registerCommand("contextWatcher.copyModelBudgetOverrideTemplate", async () => {
      await copyModelBudgetOverrideTemplate();
    }),
    vscode.commands.registerCommand("contextWatcher.pickActiveSession", async () => {
      await pickActiveSessionAndRefresh();
    }),
    vscode.commands.registerCommand("contextWatcher.clearPinnedSession", async () => {
      await clearPinnedSessionAndRefresh();
    }),
    vscode.commands.registerCommand("contextWatcher.copyCompactPrompt", async () => {
      await refreshTracker(false, "full");
      const snapshot = tracker.getSnapshot();
      const config = vscode.workspace.getConfiguration("contextWatcher");
      const prompt = buildSummaryPrompt(snapshot, config.get("compactorTokenLimit", 24000));
      await vscode.env.clipboard.writeText(prompt);
      await vscode.window.showInformationMessage(
        snapshot.usageSource === "liveGeneratorMetadata"
          ? "Copied a new-chat handoff assembled from live trajectory steps and supporting artifacts."
          : "Copied a new-chat handoff assembled from supporting artifacts. This does not ask Antigravity to summarize the live chat."
      );
    }),
    vscode.commands.registerCommand("contextWatcher.copySummarizeCurrentChatPrompt", async () => {
      await refreshTracker(false, "full");
      const snapshot = tracker.getSnapshot();
      const config = vscode.workspace.getConfiguration("contextWatcher");
      const prompt = buildSummarizeCurrentChatPrompt(snapshot, config.get("compactorTokenLimit", 24000));
      await vscode.env.clipboard.writeText(prompt);
      await vscode.window.showInformationMessage(
        "Copied an instruction-only prompt to paste into the current Antigravity chat. The extension cannot send it automatically."
      );
    }),
    vscode.commands.registerCommand("contextWatcher.showDiagnostics", async () => {
      await refreshTracker(false, "full");
      const snapshot = tracker.getSnapshot();
      const diagnostics = buildDiagnostics(
        tracker.getWorkspaceFolders(),
        getBrainRoot,
        {
          brainDir: snapshot.brainDir,
          sessionId: snapshot.sessionId,
          source: snapshot.resolutionSource,
          conversation: snapshot.conversation
        }
      );
      let runtimeTraceProbe = null;
      try {
        runtimeTraceProbe = await probeRuntimeTraces(vscode, snapshot.sessionId);
      } catch (error) {
        runtimeTraceProbe = {
          antigravityCommands: [],
          traces: [
            {
              commandId: "runtimeTraceProbe",
              available: true,
              error: error && error.message ? error.message : String(error),
              rawType: "",
              rawLength: 0,
              parsed: false,
              scan: {
                nodeCount: 0,
                truncated: false,
                sessionHits: [],
                tokenHits: [],
                modelHints: [],
                textHits: []
              }
            }
          ]
        };
      }
      await openMarkdownDocument(buildDiagnosticsMarkdown(snapshot, diagnostics, runtimeTraceProbe));
    }),
    vscode.commands.registerCommand("contextWatcher.openSettings", async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "contextWatcher"
      );
    })
  );

  await refreshTracker(false, "full");
  await ensureModelSelected(tracker);
  await refreshTracker(false, "full");
  tracker.start();
  updateStatusBar(statusBarItem, tracker);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
