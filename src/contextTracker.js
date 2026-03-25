"use strict";

const { EventEmitter } = require("events");
const path = require("path");
const { resolveActiveBrainTarget, getBrainRoot } = require("./antigravityLocator");
const { buildArtifactRegistry } = require("./artifactRegistry");
const { getConversationFileInfo } = require("./antigravityState");
const { getConfiguredProfiles, getActiveModelId, getProfileById } = require("./modelCatalog");
const { resolveBudget, computeUsage } = require("./budget");
const { AntigravitySdkBridge } = require("./antigravitySdkBridge");

function parseTimestamp(value) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildLiveSummaryEntries(sessionId, recentSteps) {
  return (recentSteps || [])
    .slice()
    .sort((left, right) => right.stepIndex - left.stepIndex)
    .map((step) => ({
      path: `cascade://${sessionId || "unknown"}/steps/${step.stepIndex}`,
      category: "liveTrajectory",
      includedInEstimate: false,
      includedInHandoff: true,
      tokens: step.tokens || 0,
      text: step.text || "",
      mtimeMs: parseTimestamp(step.createdAt),
      size: Buffer.byteLength(step.text || "", "utf8"),
      liveStepIndex: step.stepIndex,
      liveStepType: step.type || "unknown",
      liveModelPlaceholder: step.modelPlaceholder || ""
    }));
}

class ContextTracker extends EventEmitter {
  constructor(vscode) {
    super();
    this.vscode = vscode;
    this.sdkBridge = new AntigravitySdkBridge(vscode);
    this.snapshot = this.buildEmptySnapshot();
    this.interval = null;
    this.signature = "";
    this.refreshPromise = null;
  }

  getConfiguration() {
    return this.vscode.workspace.getConfiguration("contextWatcher");
  }

  getWorkspaceFolders() {
    return this.vscode.workspace.workspaceFolders || [];
  }

  buildEmptySnapshot() {
    const config = this.getConfiguration();
    const profiles = getConfiguredProfiles(config);
    const activeModelId = getActiveModelId(config, profiles);
    const activeProfile = getProfileById(profiles, activeModelId);
    const budget = resolveBudget(activeProfile, config);
    return {
      activeModelId,
      activeProfile,
      budget,
      brainDir: "",
      sessionId: "",
      resolutionSource: "none",
      workspaceCandidates: [],
      conversation: getConversationFileInfo(""),
      entries: [],
      summaryEntries: [],
      sessionArtifactCount: 0,
      estimatedTrackedTokens: 0,
      retainedTokens: 0,
      artifactEstimateTokens: 0,
      categoryTotals: {},
      artifactCategoryTotals: {},
      lastUpdatedAt: 0,
      percentUsed: 0,
      remainingInputHeadroom: budget ? budget.effectiveMaxInputTokens || 0 : 0,
      usageSource: "artifactEstimate",
      liveReady: false,
      liveError: "",
      liveConnection: null,
      availableModelOptions: [],
      detectedModelLabel: "",
      detectedModelPlaceholder: "",
      liveLatestGeneration: null,
      liveRecentSteps: [],
      activeTrajectorySummary: null,
      activeTrajectoryTitle: "",
      liveSelectionSource: "",
      diagnosticsActiveSession: null,
      activeTabSelection: null
    };
  }

  async buildSnapshot() {
    const config = this.getConfiguration();
    const profiles = getConfiguredProfiles(config);
    const activeModelId = getActiveModelId(config, profiles);
    const activeProfile = getProfileById(profiles, activeModelId);
    const budget = resolveBudget(activeProfile, config);
    const workspaceFolders = this.getWorkspaceFolders();
    const configuredBrainPath = config.get("activeBrainPath", "");
    const preferredCascadeId = configuredBrainPath ? path.basename(configuredBrainPath) : "";
    const fallbackTarget = resolveActiveBrainTarget(config, workspaceFolders);

    let liveState = {
      ready: false,
      connection: null,
      error: ""
    };
    try {
      liveState = await this.sdkBridge.refresh(workspaceFolders, preferredCascadeId);
    } catch (error) {
      liveState = {
        ready: false,
        connection: this.sdkBridge.connection,
        error: error && error.message ? error.message : String(error)
      };
    }

    let sessionId = fallbackTarget.sessionId;
    let brainDir = fallbackTarget.brainDir;
    let resolutionSource = fallbackTarget.source;
    let conversation = fallbackTarget.conversation;

    if (liveState.ready && liveState.cascadeId) {
      sessionId = liveState.cascadeId;
      brainDir = path.join(getBrainRoot(), sessionId);
      conversation = getConversationFileInfo(sessionId);
      if (preferredCascadeId) {
        resolutionSource = "configuredPath";
      } else if (liveState.selectionSource === "activeTabSessionId" || liveState.selectionSource === "activeTabTitle") {
        resolutionSource = "liveVisibleTab";
      } else if (liveState.selectionSource === "diagnosticsActiveSession") {
        resolutionSource = "liveDiagnosticsActiveSession";
      } else {
        resolutionSource = "liveTrajectory";
      }
    }

    const registry = buildArtifactRegistry({
      brainDir,
      workspaceFolders,
      includeBrainArtifacts: config.get("includeBrainArtifactsInEstimate", true),
      extraWatchPaths: config.get("extraWatchPaths", [])
    });

    const artifactEntries = registry.entries.map((entry) => ({
      ...entry,
      includedInHandoff: true
    }));
    const liveSummaryEntries = buildLiveSummaryEntries(sessionId, liveState.recentSteps || []);
    const latestGeneration = liveState.latestGeneration || null;
    const liveUsage = latestGeneration && latestGeneration.usage && latestGeneration.usage.retainedTokens > 0
      ? latestGeneration.usage
      : null;
    const usageSource = liveUsage ? "liveGeneratorMetadata" : "artifactEstimate";
    const retainedTokens = liveUsage ? liveUsage.retainedTokens : registry.totalTokens;
    const usage = computeUsage(retainedTokens, budget);
    const sessionPrefix = brainDir ? `${brainDir}${path.sep}` : "";
    const sessionArtifactCount = artifactEntries.filter((entry) =>
      sessionPrefix ? entry.path.startsWith(sessionPrefix) : false
    ).length;
    const liveUpdatedAt = Math.max(
      parseTimestamp(liveState.activeSummary && liveState.activeSummary.lastModifiedTime),
      parseTimestamp(liveState.diagnosticsActiveSession && liveState.diagnosticsActiveSession.lastModifiedTime),
      ...((liveState.recentSteps || []).map((step) => parseTimestamp(step.createdAt)))
    );
    const lastUpdatedAt = Math.max(
      registry.lastUpdatedAt || 0,
      conversation ? conversation.mtimeMs || 0 : 0,
      liveUpdatedAt || 0
    ) || Date.now();
    const detectedModelLabel = latestGeneration && latestGeneration.modelLabel
      ? latestGeneration.modelLabel
      : "";

    return {
      activeModelId,
      activeProfile,
      budget,
      brainDir,
      sessionId,
      resolutionSource,
      workspaceCandidates: fallbackTarget.workspaceCandidates,
      conversation,
      entries: artifactEntries,
      summaryEntries: [...liveSummaryEntries, ...registry.summaryEntries.map((entry) => ({
        ...entry,
        includedInHandoff: true
      }))],
      sessionArtifactCount,
      estimatedTrackedTokens: retainedTokens,
      retainedTokens,
      artifactEstimateTokens: registry.totalTokens,
      categoryTotals: liveUsage ? { liveRetainedContext: retainedTokens } : registry.categoryTotals,
      artifactCategoryTotals: registry.categoryTotals,
      lastUpdatedAt,
      percentUsed: usage.percentUsed,
      remainingInputHeadroom: usage.remainingInputHeadroom,
      usageSource,
      liveReady: Boolean(liveState.ready),
      liveError: liveState.error || "",
      liveConnection: liveState.connection || null,
      availableModelOptions: liveState.modelOptions || [],
      detectedModelLabel,
      detectedModelPlaceholder: latestGeneration ? latestGeneration.modelPlaceholder || "" : "",
      liveLatestGeneration: latestGeneration,
      liveRecentSteps: liveState.recentSteps || [],
      activeTrajectorySummary: liveState.activeSummary || null,
      activeTrajectoryTitle:
        (liveState.activeSummary && (
          liveState.activeSummary.title
          || liveState.activeSummary.trajectoryMetadata?.title
          || liveState.activeSummary.chatTitle
        ))
        || (liveState.diagnosticsActiveSession && liveState.diagnosticsActiveSession.title)
        || "",
      liveWorkspaceCandidates: liveState.workspaceCandidates || [],
      liveSelectionSource: liveState.selectionSource || "",
      diagnosticsActiveSession: liveState.diagnosticsActiveSession || null,
      diagnosticsRecentTrajectories: liveState.diagnosticsRecentTrajectories || [],
      activeTabSelection: liveState.activeTabSelection || null
    };
  }

  computeSignature(snapshot) {
    return JSON.stringify({
      model: snapshot.activeModelId,
      brainDir: snapshot.brainDir,
      sessionId: snapshot.sessionId,
      resolutionSource: snapshot.resolutionSource,
      estimatedTrackedTokens: snapshot.estimatedTrackedTokens,
      artifactEstimateTokens: snapshot.artifactEstimateTokens,
      usageSource: snapshot.usageSource,
      detectedModelLabel: snapshot.detectedModelLabel,
      latestGeneration: snapshot.liveLatestGeneration
        ? {
          retainedTokens: snapshot.liveLatestGeneration.usage.retainedTokens,
          outputTokens: snapshot.liveLatestGeneration.usage.outputTokens,
          effectiveInputTokens: snapshot.liveLatestGeneration.usage.effectiveInputTokens,
          generationCount: snapshot.liveLatestGeneration.generationCount
        }
        : null,
      lastUpdatedAt: snapshot.lastUpdatedAt
    });
  }

  async refresh() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      const nextSnapshot = await this.buildSnapshot();
      const nextSignature = this.computeSignature(nextSnapshot);
      this.snapshot = nextSnapshot;
      if (nextSignature !== this.signature) {
        this.signature = nextSignature;
        this.emit("changed", nextSnapshot);
      }
      return nextSnapshot;
    })()
      .catch((error) => {
        console.error("[contextWatcher] refresh failed", error);
        throw error;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  start() {
    if (this.interval) {
      return;
    }
    const config = this.getConfiguration();
    const refreshIntervalMs = Math.max(1000, config.get("refreshIntervalMs", 3000));
    void this.refresh();
    this.interval = setInterval(() => {
      void this.refresh().catch((error) => {
        console.error("[contextWatcher] refresh failed", error);
      });
    }, refreshIntervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getSnapshot() {
    return this.snapshot || this.buildEmptySnapshot();
  }
}

module.exports = {
  ContextTracker,
  buildLiveSummaryEntries
};
