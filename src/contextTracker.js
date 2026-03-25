"use strict";

const { EventEmitter } = require("events");
const { resolveActiveBrainDir } = require("./antigravityLocator");
const { buildArtifactRegistry } = require("./artifactRegistry");
const { getConfiguredProfiles, getActiveModelId, getProfileById } = require("./modelCatalog");
const { resolveBudget, computeUsage } = require("./budget");

class ContextTracker extends EventEmitter {
  constructor(vscode) {
    super();
    this.vscode = vscode;
    this.snapshot = null;
    this.interval = null;
    this.signature = "";
  }

  getConfiguration() {
    return this.vscode.workspace.getConfiguration("contextWatcher");
  }

  getWorkspaceFolders() {
    return this.vscode.workspace.workspaceFolders || [];
  }

  buildSnapshot() {
    const config = this.getConfiguration();
    const profiles = getConfiguredProfiles(config);
    const activeModelId = getActiveModelId(config, profiles);
    const activeProfile = getProfileById(profiles, activeModelId);
    const budget = resolveBudget(activeProfile, config);
    const brainDir = resolveActiveBrainDir(config);

    const registry = buildArtifactRegistry({
      brainDir,
      workspaceFolders: this.getWorkspaceFolders(),
      includeBrainArtifacts: config.get("includeBrainArtifactsInEstimate", false),
      extraWatchPaths: config.get("extraWatchPaths", [])
    });

    const usage = computeUsage(registry.totalTokens, budget);
    return {
      activeModelId,
      activeProfile,
      budget,
      brainDir,
      entries: registry.entries,
      summaryEntries: registry.summaryEntries,
      estimatedTrackedTokens: registry.totalTokens,
      categoryTotals: registry.categoryTotals,
      lastUpdatedAt: registry.lastUpdatedAt || Date.now(),
      percentUsed: usage.percentUsed,
      remainingInputHeadroom: usage.remainingInputHeadroom
    };
  }

  computeSignature(snapshot) {
    return JSON.stringify({
      model: snapshot.activeModelId,
      brainDir: snapshot.brainDir,
      estimatedTrackedTokens: snapshot.estimatedTrackedTokens,
      categoryTotals: snapshot.categoryTotals,
      lastUpdatedAt: snapshot.lastUpdatedAt
    });
  }

  refresh() {
    const nextSnapshot = this.buildSnapshot();
    const nextSignature = this.computeSignature(nextSnapshot);
    this.snapshot = nextSnapshot;
    if (nextSignature !== this.signature) {
      this.signature = nextSignature;
      this.emit("changed", nextSnapshot);
    }
    return nextSnapshot;
  }

  start() {
    if (this.interval) {
      return;
    }
    const config = this.getConfiguration();
    const refreshIntervalMs = Math.max(1000, config.get("refreshIntervalMs", 3000));
    this.refresh();
    this.interval = setInterval(() => {
      try {
        this.refresh();
      } catch (error) {
        console.error("[contextWatcher] refresh failed", error);
      }
    }, refreshIntervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getSnapshot() {
    return this.snapshot || this.refresh();
  }
}

module.exports = {
  ContextTracker
};
