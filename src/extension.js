"use strict";

const vscode = require("vscode");
const { ContextTracker } = require("./contextTracker");
const { getConfiguredProfiles, getActiveModelId } = require("./modelCatalog");
const { formatProviderReference } = require("./budget");
const { buildSummaryPrompt } = require("./compactor");

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

function buildBreakdownMarkdown(snapshot) {
  const lines = [];
  lines.push("# Antigravity Context Watcher");
  lines.push("");
  lines.push(`- Model: ${snapshot.activeProfile ? snapshot.activeProfile.label : "Not selected"}`);
  lines.push(`- Session: ${snapshot.brainDir || "No active brain directory found"}`);
  lines.push(`- Estimated retained tokens: ${snapshot.estimatedTrackedTokens}`);
  lines.push(`- Effective max input: ${snapshot.budget ? snapshot.budget.effectiveMaxInputTokens : 0}`);
  lines.push(`- Effective max output: ${snapshot.budget ? snapshot.budget.effectiveMaxOutputTokens : 0}`);
  lines.push(`- Provider reference: ${formatProviderReference(snapshot.budget)}`);
  lines.push(`- Usage: ${formatPercent(snapshot.percentUsed)}`);
  lines.push(`- Remaining input headroom: ${snapshot.remainingInputHeadroom}`);
  lines.push(`- Last updated: ${formatDate(snapshot.lastUpdatedAt)}`);
  lines.push("");
  lines.push("> Estimate only. This value is assembled from tracked Antigravity artifacts, not a provider-native prompt log.");
  lines.push("");
  lines.push("## Category Totals");
  lines.push("");
  for (const [category, total] of Object.entries(snapshot.categoryTotals || {}).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${category}: ${total}`);
  }
  lines.push("");
  lines.push("## Counted Files");
  lines.push("");
  for (const entry of snapshot.entries || []) {
    const marker = entry.includedInEstimate ? "[x]" : "[ ]";
    lines.push(`- ${marker} ${entry.category}: ${entry.tokens} tokens - ${entry.path}`);
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

async function ensureModelSelected(context) {
  const config = vscode.workspace.getConfiguration("contextWatcher");
  const profiles = getConfiguredProfiles(config);
  if (profiles.length === 0) {
    return null;
  }
  const activeModelId = getActiveModelId(config, profiles);
  if (activeModelId) {
    return activeModelId;
  }
  const picked = await vscode.window.showQuickPick(
    profiles.map((profile) => ({
      label: profile.label,
      description: profile.provider,
      detail: profile.budgetMode === "combined"
        ? `Combined budget, effective input ${profile.effectiveMaxInputTokens || profile.effectiveContextTokens || 0}`
        : `Separate budget, effective input ${profile.effectiveMaxInputTokens || 0}`,
      profile
    })),
    {
      placeHolder: "Select the model profile used for counting this Antigravity session",
      ignoreFocusOut: true
    }
  );
  if (!picked) {
    return null;
  }
  await config.update("activeModelId", picked.profile.id, vscode.ConfigurationTarget.Global);
  return picked.profile.id;
}

async function showBreakdown(snapshot) {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: buildBreakdownMarkdown(snapshot)
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

function updateStatusBar(statusBarItem, tracker) {
  const snapshot = tracker.getSnapshot();
  const config = vscode.workspace.getConfiguration("contextWatcher");
  if (!snapshot.activeProfile) {
    statusBarItem.text = "AG: Pick Model";
    statusBarItem.tooltip = "Select a model profile for Antigravity context counting.";
    statusBarItem.show();
    return;
  }
  if (!snapshot.brainDir) {
    statusBarItem.text = `AG Est. 0 / ${formatCompactCount(snapshot.budget.effectiveMaxInputTokens)}`;
    statusBarItem.tooltip = "No active Antigravity brain directory found.";
    statusBarItem.show();
    return;
  }

  statusBarItem.text = `AG Est. ${formatCompactCount(snapshot.estimatedTrackedTokens)} / ${formatCompactCount(snapshot.budget.effectiveMaxInputTokens)} (${formatPercent(snapshot.percentUsed)})`;
  statusBarItem.tooltip = [
    `Model: ${snapshot.activeProfile.label}`,
    `Estimate only: tracked Antigravity artifacts`,
    `Effective max input: ${snapshot.budget.effectiveMaxInputTokens}`,
    `Effective max output: ${snapshot.budget.effectiveMaxOutputTokens}`,
    `Provider reference: ${formatProviderReference(snapshot.budget)}`,
    `Last updated: ${formatDate(snapshot.lastUpdatedAt)}`,
    `Session: ${snapshot.brainDir}`
  ].join("\n");
  applyStatusBarStyle(statusBarItem, snapshot, config);
  statusBarItem.show();
}

async function activate(context) {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  statusBarItem.command = "contextWatcher.showBreakdown";
  context.subscriptions.push(statusBarItem);

  const tracker = new ContextTracker(vscode);

  context.subscriptions.push({
    dispose() {
      tracker.stop();
    }
  });

  tracker.on("changed", () => {
    updateStatusBar(statusBarItem, tracker);
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("contextWatcher")) {
        return;
      }
      tracker.stop();
      tracker.start();
      updateStatusBar(statusBarItem, tracker);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("contextWatcher.refresh", async () => {
      tracker.refresh();
      updateStatusBar(statusBarItem, tracker);
      await vscode.window.setStatusBarMessage("Context Watcher refreshed.", 1500);
    }),
    vscode.commands.registerCommand("contextWatcher.showBreakdown", async () => {
      await showBreakdown(tracker.getSnapshot());
    }),
    vscode.commands.registerCommand("contextWatcher.pickModelProfile", async () => {
      await ensureModelSelected(context);
      tracker.refresh();
      updateStatusBar(statusBarItem, tracker);
    }),
    vscode.commands.registerCommand("contextWatcher.copyCompactPrompt", async () => {
      const snapshot = tracker.getSnapshot();
      const config = vscode.workspace.getConfiguration("contextWatcher");
      const prompt = buildSummaryPrompt(snapshot, config.get("compactorTokenLimit", 24000));
      await vscode.env.clipboard.writeText(prompt);
      await vscode.window.showInformationMessage(
        `Copied new-chat summary prompt (${formatCompactCount(snapshot.estimatedTrackedTokens)} tracked tokens, updated ${formatDate(snapshot.lastUpdatedAt)}).`
      );
    }),
    vscode.commands.registerCommand("contextWatcher.openSettings", async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "contextWatcher"
      );
    })
  );

  await ensureModelSelected(context);
  tracker.start();
  updateStatusBar(statusBarItem, tracker);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
