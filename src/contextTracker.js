"use strict";

const { EventEmitter } = require("events");
const path = require("path");
const { resolveActiveBrainTarget, getBrainRoot } = require("./antigravityLocator");
const { buildArtifactRegistry } = require("./artifactRegistry");
const { getConversationFileInfo } = require("./antigravityState");
const { getConfiguredProfiles, getActiveModelId, getProfileById } = require("./modelCatalog");
const { resolveBudget, computeUsage } = require("./budget");
const { AntigravitySdkBridge } = require("./antigravitySdkBridge");
const { FilesystemWorkerClient } = require("./filesystemWorkerClient");
const { parseTimestamp } = require("./utils");

function normalizeRefreshDetail(value) {
  return value === "light" || value === "full" ? value : "auto";
}

function shouldDoFullRefresh(lastFullRefreshAt, intervalMs, now = Date.now()) {
  if (!lastFullRefreshAt) {
    return true;
  }
  if (typeof intervalMs !== "number" || intervalMs <= 0) {
    return true;
  }
  return now - lastFullRefreshAt >= intervalMs;
}

function chooseRefreshDetail(config, requestedDetail, snapshot) {
  const normalized = normalizeRefreshDetail(requestedDetail);
  if (normalized === "full" || normalized === "light") {
    return normalized;
  }
  const fullRefreshIntervalMs = Math.max(5000, config.get("fullRefreshIntervalMs", 300000));
  return shouldDoFullRefresh(snapshot && snapshot.lastFullRefreshAt, fullRefreshIntervalMs)
    ? "full"
    : "light";
}

function shouldPromoteRefreshForConversationActivity(previousSnapshot, getConversationInfo = getConversationFileInfo) {
  const previous = previousSnapshot || null;
  if (!previous || !previous.sessionId) {
    return false;
  }

  const previousConversationMtime = previous.conversation && typeof previous.conversation.mtimeMs === "number"
    ? previous.conversation.mtimeMs
    : 0;
  if (!previousConversationMtime) {
    return false;
  }

  const currentConversation = getConversationInfo(previous.sessionId);
  return Boolean(currentConversation && currentConversation.mtimeMs > previousConversationMtime);
}

function reusePreviousLiveData(previousSnapshot, sessionId, liveState) {
  const previous = previousSnapshot || null;
  if (!previous || !previous.sessionId || previous.sessionId !== sessionId) {
    return {
      latestGeneration: liveState.latestGeneration || null,
      recentSteps: liveState.recentSteps || [],
      activeSummary: liveState.activeSummary || null
    };
  }

  return {
    latestGeneration: liveState.latestGeneration || previous.liveLatestGeneration || null,
    recentSteps: (liveState.recentSteps && liveState.recentSteps.length > 0)
      ? liveState.recentSteps
      : (previous.liveRecentSteps || []),
    activeSummary: liveState.activeSummary || previous.activeTrajectorySummary || null
  };
}

function reusePreviousLiveMetadata(previousSnapshot, liveState) {
  const previous = previousSnapshot || null;

  return {
    liveReady:
      typeof liveState.ready === "boolean"
        ? liveState.ready || Boolean(previous && previous.liveReady && liveState.detailLevel === "light")
        : Boolean(previous && previous.liveReady),
    liveConnection: liveState.connection || (previous ? previous.liveConnection : null) || null,
    modelOptions:
      Array.isArray(liveState.modelOptions) && liveState.modelOptions.length > 0
        ? liveState.modelOptions
        : (previous ? previous.availableModelOptions || [] : []),
    workspaceCandidates:
      Array.isArray(liveState.workspaceCandidates) && liveState.workspaceCandidates.length > 0
        ? liveState.workspaceCandidates
        : (previous ? previous.liveWorkspaceCandidates || [] : []),
    liveSelectionSource: liveState.selectionSource || (previous ? previous.liveSelectionSource || "" : "")
  };
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
    this.filesystemWorker = new FilesystemWorkerClient();
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
      liveDetailLevel: "full",
      liveRecentSteps: [],
      activeTrajectorySummary: null,
      activeTrajectoryTitle: "",
      liveSelectionSource: "",
      diagnosticsActiveSession: null,
      activeTabSelection: null,
      lastFullRefreshAt: 0
    };
  }

  async resolveActiveBrainTargetOffThread(configuredBrainPath, workspaceFolders) {
    const workspaceFolderPaths = (workspaceFolders || [])
      .map((folder) => folder && folder.uri && folder.uri.fsPath)
      .filter(Boolean);

    try {
      return await this.filesystemWorker.resolveActiveBrainTarget(configuredBrainPath, workspaceFolderPaths);
    } catch (_error) {
      return resolveActiveBrainTarget({
        get(key, fallback) {
          return key === "activeBrainPath" ? configuredBrainPath : fallback;
        }
      }, workspaceFolders);
    }
  }

  async buildArtifactRegistryOffThread(brainDir, includeBrainArtifacts, extraWatchPaths, workspaceFolders) {
    const workspaceFolderPaths = (workspaceFolders || [])
      .map((folder) => folder && folder.uri && folder.uri.fsPath)
      .filter(Boolean);

    try {
      return await this.filesystemWorker.buildArtifactRegistry(
        brainDir,
        includeBrainArtifacts,
        extraWatchPaths,
        workspaceFolderPaths
      );
    } catch (_error) {
      return buildArtifactRegistry({
        brainDir,
        includeBrainArtifacts,
        extraWatchPaths,
        workspaceFolders
      });
    }
  }

  async buildSnapshot(options = {}) {
    const config = this.getConfiguration();
    const previousSnapshot = this.snapshot || this.buildEmptySnapshot();
    let detailLevel = chooseRefreshDetail(config, options.detailLevel, previousSnapshot);
    if (
      detailLevel === "light"
      && options.refreshSource === "poll"
      && shouldPromoteRefreshForConversationActivity(previousSnapshot)
    ) {
      detailLevel = "full";
    }
    const profiles = getConfiguredProfiles(config);
    const activeModelId = getActiveModelId(config, profiles);
    const activeProfile = getProfileById(profiles, activeModelId);
    const budget = resolveBudget(activeProfile, config);
    const workspaceFolders = this.getWorkspaceFolders();
    const configuredBrainPath = config.get("activeBrainPath", "");
    const preferredCascadeId = configuredBrainPath ? path.basename(configuredBrainPath) : "";
    const includeBrainArtifacts = config.get("includeBrainArtifactsInEstimate", true);
    const extraWatchPaths = config.get("extraWatchPaths", []);
    const fallbackTargetPromise = this.resolveActiveBrainTargetOffThread(configuredBrainPath, workspaceFolders);

    const [liveState, fallbackTarget] = await Promise.all([
      this.sdkBridge.refresh(workspaceFolders, preferredCascadeId, {
        detailLevel,
        enableDiagnostics: options.refreshSource === "tabChange"
      }).catch((error) => ({
        ready: false,
        connection: this.sdkBridge.connection,
        error: error && error.message ? error.message : String(error),
        detailLevel
      })),
      fallbackTargetPromise
    ]);

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

    const registry = await this.buildArtifactRegistryOffThread(
      brainDir,
      includeBrainArtifacts,
      extraWatchPaths,
      workspaceFolders
    );

    const artifactEntries = registry.entries.map((entry) => ({
      ...entry,
      includedInHandoff: true
    }));
    const reusedLiveData = reusePreviousLiveData(previousSnapshot, sessionId, liveState);
    const reusedLiveMetadata = reusePreviousLiveMetadata(previousSnapshot, liveState);
    const liveSummaryEntries = buildLiveSummaryEntries(sessionId, reusedLiveData.recentSteps || []);
    const latestGeneration = reusedLiveData.latestGeneration || null;
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
      parseTimestamp(reusedLiveData.activeSummary && reusedLiveData.activeSummary.lastModifiedTime),
      parseTimestamp(liveState.diagnosticsActiveSession && liveState.diagnosticsActiveSession.lastModifiedTime),
      ...((reusedLiveData.recentSteps || []).map((step) => parseTimestamp(step.createdAt)))
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
      liveReady: reusedLiveMetadata.liveReady,
      liveError: liveState.error || "",
      liveConnection: reusedLiveMetadata.liveConnection,
      availableModelOptions: reusedLiveMetadata.modelOptions,
      detectedModelLabel,
      detectedModelPlaceholder: latestGeneration ? latestGeneration.modelPlaceholder || "" : "",
      liveLatestGeneration: latestGeneration,
      liveDetailLevel: liveState.detailLevel || detailLevel,
      liveRecentSteps: reusedLiveData.recentSteps || [],
      activeTrajectorySummary: reusedLiveData.activeSummary || null,
      activeTrajectoryTitle:
        (reusedLiveData.activeSummary && (
          reusedLiveData.activeSummary.title
          || reusedLiveData.activeSummary.trajectoryMetadata?.title
          || reusedLiveData.activeSummary.chatTitle
        ))
        || (liveState.diagnosticsActiveSession && liveState.diagnosticsActiveSession.title)
        || "",
      liveWorkspaceCandidates: reusedLiveMetadata.workspaceCandidates,
      liveSelectionSource: reusedLiveMetadata.liveSelectionSource,
      diagnosticsActiveSession: liveState.diagnosticsActiveSession || null,
      diagnosticsRecentTrajectories: liveState.diagnosticsRecentTrajectories || [],
      activeTabSelection: liveState.activeTabSelection || null,
      lastFullRefreshAt: detailLevel === "full" ? Date.now() : (previousSnapshot.lastFullRefreshAt || 0)
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
      lastUpdatedAt: snapshot.lastUpdatedAt,
      liveDetailLevel: snapshot.liveDetailLevel
    });
  }

  async refresh(options = {}) {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      const nextSnapshot = await this.buildSnapshot(options);
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
    const refreshIntervalMs = Math.max(1000, config.get("refreshIntervalMs", 30000));
    void this.refresh({ detailLevel: "auto", refreshSource: "poll" });
    this.interval = setInterval(() => {
      void this.refresh({ detailLevel: "auto", refreshSource: "poll" }).catch((error) => {
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

  async dispose() {
    this.stop();
    await this.filesystemWorker.dispose();
  }

  getSnapshot() {
    return this.snapshot || this.buildEmptySnapshot();
  }
}

module.exports = {
  ContextTracker,
  buildLiveSummaryEntries,
  chooseRefreshDetail,
  normalizeRefreshDetail,
  shouldPromoteRefreshForConversationActivity,
  reusePreviousLiveData,
  reusePreviousLiveMetadata,
  shouldDoFullRefresh
};
