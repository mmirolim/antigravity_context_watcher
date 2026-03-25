"use strict";

const path = require("path");
const { promisify } = require("util");
const { exec } = require("child_process");
const { countTokens } = require("./tokenizer");

const execAsync = promisify(exec);

function toPositiveInteger(value) {
  if (value == null || value === "") {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

function parseTimestamp(value) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTitle(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getWorkspaceUris(workspaceFolders) {
  return (workspaceFolders || [])
    .map((folder) => folder && folder.uri && folder.uri.toString())
    .filter(Boolean);
}

function buildWorkspaceProcessHint(fsPath) {
  if (!fsPath) {
    return "";
  }
  const normalized = fsPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `file_${normalized.replace(/[/:.\s-]+/g, "_")}`;
}

function buildModelOptionsFromUserStatus(userStatus) {
  const configs = userStatus && userStatus.cascadeModelConfigData && Array.isArray(userStatus.cascadeModelConfigData.clientModelConfigs)
    ? userStatus.cascadeModelConfigData.clientModelConfigs
    : [];

  return configs
    .map((item) => ({
      label: item.label || "",
      placeholder: item.modelOrAlias && (item.modelOrAlias.model || item.modelOrAlias.alias || ""),
      remainingFraction: typeof item.quotaInfo?.remainingFraction === "number" ? item.quotaInfo.remainingFraction : null,
      resetTime: item.quotaInfo?.resetTime || "",
      supportsImages: Boolean(item.supportsImages),
      tagTitle: item.tagTitle || ""
    }))
    .filter((item) => item.label && item.placeholder);
}

function buildPlaceholderModelMap(modelOptions) {
  const map = new Map();
  for (const item of modelOptions || []) {
    if (item.placeholder && item.label) {
      map.set(item.placeholder, item.label);
    }
  }
  return map;
}

function parseDiagnosticsRecentTrajectories(rawDiagnostics) {
  if (!rawDiagnostics) {
    return [];
  }

  let parsed = rawDiagnostics;
  if (typeof rawDiagnostics === "string") {
    try {
      parsed = JSON.parse(rawDiagnostics);
    } catch (_error) {
      return [];
    }
  }

  if (!parsed || !Array.isArray(parsed.recentTrajectories)) {
    return [];
  }

  return parsed.recentTrajectories
    .map((entry) => ({
      sessionId: entry.googleAgentId || "",
      trajectoryId: entry.trajectoryId || "",
      title: entry.summary || "",
      lastModifiedTime: entry.lastModifiedTime || "",
      lastModifiedMs: parseTimestamp(entry.lastModifiedTime),
      stepCount: toPositiveInteger(entry.lastStepIndex)
    }))
    .filter((entry) => entry.sessionId);
}

async function getDiagnosticsRecentTrajectories(vscode) {
  try {
    const raw = await vscode.commands.executeCommand("antigravity.getDiagnostics");
    return parseDiagnosticsRecentTrajectories(raw);
  } catch (_error) {
    return [];
  }
}

function getTrajectoryTitle(summary) {
  if (!summary || typeof summary !== "object") {
    return "";
  }
  return summary.title || summary.trajectoryMetadata?.title || summary.chatTitle || "";
}

function extractSessionIdsFromText(text) {
  if (!text || typeof text !== "string") {
    return [];
  }
  const matches = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  return Array.from(new Set(matches.map((value) => value.toLowerCase())));
}

function collectNestedStrings(value, strings, depth, seen) {
  if (!value || depth > 3) {
    return;
  }

  if (typeof value === "string") {
    strings.push(value);
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (typeof value.toString === "function") {
    try {
      const stringValue = value.toString();
      if (stringValue && stringValue !== "[object Object]") {
        strings.push(stringValue);
      }
    } catch (_error) {
      // Ignore non-serializable values.
    }
  }

  if (typeof value.fsPath === "string") {
    strings.push(value.fsPath);
  }
  if (typeof value.path === "string") {
    strings.push(value.path);
  }
  if (typeof value.viewType === "string") {
    strings.push(value.viewType);
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 12)) {
      collectNestedStrings(item, strings, depth + 1, seen);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (typeof key === "string") {
      strings.push(key);
    }
    collectNestedStrings(child, strings, depth + 1, seen);
  }
}

function extractTabMetadata(tab) {
  if (!tab) {
    return null;
  }

  const strings = [];
  const seen = new Set();
  if (typeof tab.label === "string") {
    strings.push(tab.label);
  }
  if (typeof tab.group?.viewColumn === "number") {
    strings.push(`viewColumn:${tab.group.viewColumn}`);
  }
  collectNestedStrings(tab.input, strings, 0, seen);
  const uniqueStrings = Array.from(new Set(strings.filter(Boolean)));
  const viewType = typeof tab.input?.viewType === "string" ? tab.input.viewType : "";
  const inputKind = tab.input && tab.input.constructor && tab.input.constructor.name
    ? tab.input.constructor.name
    : "";
  const sessionIds = Array.from(new Set(uniqueStrings.flatMap((value) => extractSessionIdsFromText(value))));
  const antigravityHint = uniqueStrings.some((value) => /antigravity|conversation|cascade|googleagent/i.test(value));

  return {
    label: tab.label || "",
    viewType,
    inputKind,
    isActive: Boolean(tab.isActive),
    isPreview: Boolean(tab.isPreview),
    sessionIds,
    antigravityHint,
    strings: uniqueStrings.slice(0, 20)
  };
}

function detectActiveTabSession(vscode, trajectorySummaries, diagnosticsRecentTrajectories) {
  const tabGroups = vscode?.window?.tabGroups;
  if (!tabGroups || !Array.isArray(tabGroups.all)) {
    return null;
  }

  const activeTab = tabGroups.activeTabGroup?.activeTab || null;
  const orderedTabs = [];
  if (activeTab) {
    orderedTabs.push(activeTab);
  }
  for (const group of tabGroups.all) {
    for (const tab of Array.isArray(group.tabs) ? group.tabs : []) {
      if (tab !== activeTab) {
        orderedTabs.push(tab);
      }
    }
  }

  const titleToSession = new Map();
  for (const entry of diagnosticsRecentTrajectories || []) {
    const normalized = normalizeTitle(entry.title);
    if (normalized && !titleToSession.has(normalized)) {
      titleToSession.set(normalized, entry.sessionId);
    }
  }
  for (const [sessionId, summary] of Object.entries(trajectorySummaries || {})) {
    const normalized = normalizeTitle(getTrajectoryTitle(summary));
    if (normalized && !titleToSession.has(normalized)) {
      titleToSession.set(normalized, sessionId);
    }
  }

  for (const tab of orderedTabs) {
    const metadata = extractTabMetadata(tab);
    if (!metadata) {
      continue;
    }

    for (const sessionId of metadata.sessionIds) {
      if (trajectorySummaries?.[sessionId]) {
        return {
          sessionId,
          source: "activeTabSessionId",
          matchedBy: "sessionId",
          tab: metadata
        };
      }
    }

    if (!metadata.antigravityHint) {
      continue;
    }

    const normalizedLabel = normalizeTitle(metadata.label);
    if (normalizedLabel && titleToSession.has(normalizedLabel)) {
      return {
        sessionId: titleToSession.get(normalizedLabel),
        source: "activeTabTitle",
        matchedBy: "title",
        tab: metadata
      };
    }

    for (const value of metadata.strings) {
      const normalizedValue = normalizeTitle(value);
      if (normalizedValue && titleToSession.has(normalizedValue)) {
        return {
          sessionId: titleToSession.get(normalizedValue),
          source: "activeTabTitle",
          matchedBy: "title",
          tab: metadata
        };
      }
    }
  }

  return activeTab
    ? {
      sessionId: "",
      source: "activeTabNoMatch",
      matchedBy: "",
      tab: extractTabMetadata(activeTab)
    }
    : null;
}

function listWorkspaceTrajectoryCandidates(trajectorySummaries, workspaceFolders) {
  const workspaceUris = getWorkspaceUris(workspaceFolders);
  const candidates = [];

  for (const [cascadeId, summary] of Object.entries(trajectorySummaries || {})) {
    const workspaces = Array.isArray(summary.workspaces)
      ? summary.workspaces
      : Array.isArray(summary.trajectoryMetadata?.workspaces)
        ? summary.trajectoryMetadata.workspaces
        : [];
    const workspaceMatched = workspaceUris.length === 0 || workspaces.some((workspace) =>
      workspaceUris.includes(workspace.workspaceFolderAbsoluteUri || workspace.workspaceUri || "")
    );
    candidates.push({
      cascadeId,
      summary,
      workspaceMatched,
      lastModifiedMs: parseTimestamp(summary.lastModifiedTime),
      createdMs: parseTimestamp(summary.createdTime)
    });
  }

  candidates.sort((left, right) => {
    if (Number(right.workspaceMatched) !== Number(left.workspaceMatched)) {
      return Number(right.workspaceMatched) - Number(left.workspaceMatched);
    }
    return right.lastModifiedMs - left.lastModifiedMs;
  });

  return candidates;
}

function resolvePreferredCascadeId(trajectorySummaries, workspaceFolders, preferredCascadeId) {
  if (preferredCascadeId && trajectorySummaries && trajectorySummaries[preferredCascadeId]) {
    return preferredCascadeId;
  }

  const candidates = listWorkspaceTrajectoryCandidates(trajectorySummaries, workspaceFolders);
  if (candidates.length === 0) {
    return preferredCascadeId || "";
  }

  const workspaceCandidate = candidates.find((candidate) => candidate.workspaceMatched);
  return (workspaceCandidate || candidates[0]).cascadeId;
}

function extractStepText(step) {
  if (!step || typeof step !== "object") {
    return "";
  }

  return (
    step.notifyUser?.notificationContent ||
    step.taskBoundary?.taskSummaryWithCitations ||
    step.taskBoundary?.taskSummary ||
    step.plannerResponse?.response ||
    step.userInput?.input ||
    step.ephemeralMessage?.message ||
    step.codeAction?.proposedCode ||
    ""
  );
}

function extractRecentTrajectorySteps(trajectory, maxSteps = 10) {
  const steps = Array.isArray(trajectory?.steps) ? trajectory.steps : [];
  const entries = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const text = extractStepText(step);
    if (!text) {
      continue;
    }
    entries.push({
      stepIndex: index,
      type: step.type || "unknown",
      text,
      tokens: countTokens(text),
      createdAt: step.metadata?.createdAt || "",
      modelPlaceholder:
        step.metadata?.requestedModel?.model ||
        step.metadata?.generatorModel ||
        "",
      category: "liveTrajectory"
    });
  }

  return entries.slice(-Math.max(1, maxSteps));
}

function computeUsageFromGeneratorUsage(usage) {
  const promptTokenCount = toPositiveInteger(usage?.promptTokenCount);
  const inputTokens = toPositiveInteger(usage?.inputTokens);
  const cacheReadTokens = toPositiveInteger(usage?.cacheReadTokens);
  const cachedContentTokenCount = toPositiveInteger(usage?.cachedContentTokenCount);
  const cacheCreationInputTokens = toPositiveInteger(usage?.cacheCreationInputTokens);
  const toolUsePromptTokenCount = toPositiveInteger(usage?.toolUsePromptTokenCount);

  const baseInputTokens = promptTokenCount || inputTokens;
  const additionalCachedTokens = promptTokenCount
    ? 0
    : cacheReadTokens + cachedContentTokenCount + cacheCreationInputTokens;
  const effectiveInputTokens = baseInputTokens + additionalCachedTokens + toolUsePromptTokenCount;

  const outputTokens = toPositiveInteger(usage?.outputTokens)
    || toPositiveInteger(usage?.responseOutputTokens)
    || toPositiveInteger(usage?.candidatesTokenCount);

  return {
    uncachedInputTokens: inputTokens,
    promptTokenCount,
    cacheReadTokens,
    cachedContentTokenCount,
    cacheCreationInputTokens,
    toolUsePromptTokenCount,
    effectiveInputTokens,
    outputTokens,
    retainedTokens: effectiveInputTokens + outputTokens,
    apiProvider: usage?.apiProvider || "",
    responseId: usage?.responseId || "",
    sessionId: usage?.responseHeader?.sessionID || ""
  };
}

function selectLatestGeneratorMetadata(generatorMetadata, placeholderToLabel) {
  const items = Array.isArray(generatorMetadata) ? generatorMetadata : [];
  if (items.length === 0) {
    return null;
  }

  const sorted = items
    .slice()
    .sort((left, right) => {
      const leftMaxStep = Math.max(...((left.stepIndices || []).map(toPositiveInteger)), -1);
      const rightMaxStep = Math.max(...((right.stepIndices || []).map(toPositiveInteger)), -1);
      return rightMaxStep - leftMaxStep;
    });

  const latest = sorted[0];
  const usage = computeUsageFromGeneratorUsage(latest.chatModel?.usage || {});
  const modelPlaceholder = latest.chatModel?.model || latest.chatModel?.responseModel || "";

  return {
    stepIndices: Array.isArray(latest.stepIndices) ? latest.stepIndices.slice() : [],
    modelPlaceholder,
    modelLabel: placeholderToLabel.get(modelPlaceholder) || "",
    usage,
    maxObservedRetainedTokens: sorted.reduce((maxValue, item) => {
      const nextUsage = computeUsageFromGeneratorUsage(item.chatModel?.usage || {});
      return Math.max(maxValue, nextUsage.retainedTokens);
    }, 0),
    generationCount: sorted.length
  };
}

async function probeRpcPort(port, useTls, csrfToken) {
  const protocol = useTls ? "https" : "http";
  const client = useTls ? require("https") : require("http");

  return new Promise((resolve) => {
    const body = "{}";
    const request = client.request(
      `${protocol}://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-codeium-csrf-token": csrfToken
        },
        rejectUnauthorized: false,
        timeout: 2000
      },
      (response) => {
        resolve(response.statusCode === 200);
      }
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.write(body);
    request.end();
  });
}

async function discoverManualConnection(workspaceFolders) {
  if (process.platform === "win32") {
    return null;
  }

  const hints = (workspaceFolders || [])
    .map((folder) => folder && folder.uri && folder.uri.fsPath)
    .filter(Boolean)
    .map(buildWorkspaceProcessHint)
    .filter(Boolean);

  let stdout = "";
  try {
    stdout = (await execAsync("ps -eo pid,args 2>/dev/null | grep language_server | grep csrf_token | grep -v grep", {
      encoding: "utf8",
      timeout: 5000
    })).stdout;
  } catch (_error) {
    return null;
  }

  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const matchingLine = lines.find((line) => hints.some((hint) => line.toLowerCase().includes(hint.toLowerCase())))
    || lines[0];

  const pid = Number.parseInt(matchingLine.split(/\s+/)[0], 10);
  const csrfToken = (matchingLine.match(/--csrf_token\s+([^\s]+)/) || [])[1] || "";
  const extensionServerPort = Number.parseInt((matchingLine.match(/--extension_server_port\s+([^\s]+)/) || [])[1] || "0", 10);

  if (!pid || !csrfToken) {
    return null;
  }

  let portsOutput = "";
  try {
    portsOutput = (await execAsync(`lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN`, {
      encoding: "utf8",
      timeout: 5000
    })).stdout;
  } catch (_error) {
    return null;
  }

  const ports = Array.from(portsOutput.matchAll(/TCP\s+127\.0\.0\.1:(\d+)\s+\(LISTEN\)/g))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((port) => port && port !== extensionServerPort);

  for (const port of ports) {
    if (await probeRpcPort(port, true, csrfToken)) {
      return {
        port,
        csrfToken,
        useTls: true,
        source: "manualProbe"
      };
    }
  }

  for (const port of ports) {
    if (await probeRpcPort(port, false, csrfToken)) {
      return {
        port,
        csrfToken,
        useTls: false,
        source: "manualProbe"
      };
    }
  }

  return null;
}

class AntigravitySdkBridge {
  constructor(vscode) {
    this.vscode = vscode;
    this.lsBridge = null;
    this.connection = null;
  }

  async loadLsBridge() {
    if (this.lsBridge) {
      return this.lsBridge;
    }
    const { LSBridge } = require("antigravity-sdk");
    this.lsBridge = new LSBridge((commandId, ...args) => this.vscode.commands.executeCommand(commandId, ...args));
    return this.lsBridge;
  }

  async ensureReady(workspaceFolders) {
    const bridge = await this.loadLsBridge();
    if (this.connection && bridge.isReady) {
      return bridge;
    }

    let ready = false;
    try {
      ready = await bridge.initialize();
      if (ready) {
        await bridge.getUserStatus();
        this.connection = {
          port: bridge.port,
          hasCsrfToken: bridge.hasCsrfToken,
          useTls: Boolean(bridge._useTls),
          source: "sdkAuto"
        };
        return bridge;
      }
    } catch (_error) {
      // Fall through to manual probing.
    }

    const manualConnection = await discoverManualConnection(workspaceFolders);
    if (!manualConnection) {
      return null;
    }

    bridge.setConnection(manualConnection.port, manualConnection.csrfToken, manualConnection.useTls);
    await bridge.getUserStatus();
    this.connection = {
      port: manualConnection.port,
      hasCsrfToken: true,
      useTls: manualConnection.useTls,
      source: manualConnection.source
    };
    return bridge;
  }

  async refresh(workspaceFolders, preferredCascadeId) {
    const bridge = await this.ensureReady(workspaceFolders);
    if (!bridge) {
      return {
        ready: false,
        connection: this.connection,
        error: "Unable to connect to the Antigravity language server."
      };
    }

    const userStatusResponse = await bridge.getUserStatus();
    const trajectorySummariesResponse = await bridge.rawRPC("GetAllCascadeTrajectories", {});
    const userStatus = userStatusResponse.userStatus || {};
    const trajectorySummaries = trajectorySummariesResponse.trajectorySummaries || {};
    const diagnosticsRecentTrajectories = await getDiagnosticsRecentTrajectories(this.vscode);
    const diagnosticsActiveSession = diagnosticsRecentTrajectories[0] || null;
    const activeTabSelection = detectActiveTabSession(this.vscode, trajectorySummaries, diagnosticsRecentTrajectories);
    const modelOptions = buildModelOptionsFromUserStatus(userStatus);
    const placeholderToLabel = buildPlaceholderModelMap(modelOptions);
    const workspaceCandidates = listWorkspaceTrajectoryCandidates(trajectorySummaries, workspaceFolders);
    let cascadeId = "";
    let selectionSource = "trajectorySummary";
    if (preferredCascadeId && trajectorySummaries && trajectorySummaries[preferredCascadeId]) {
      cascadeId = preferredCascadeId;
      selectionSource = "preferredCascadeId";
    } else if (
      activeTabSelection
      && activeTabSelection.sessionId
      && trajectorySummaries[activeTabSelection.sessionId]
    ) {
      cascadeId = activeTabSelection.sessionId;
      selectionSource = activeTabSelection.source;
    } else if (
      diagnosticsActiveSession
      && diagnosticsActiveSession.sessionId
      && trajectorySummaries[diagnosticsActiveSession.sessionId]
    ) {
      cascadeId = diagnosticsActiveSession.sessionId;
      selectionSource = "diagnosticsActiveSession";
    } else {
      cascadeId = resolvePreferredCascadeId(trajectorySummaries, workspaceFolders, preferredCascadeId);
    }
    const activeSummary = cascadeId ? trajectorySummaries[cascadeId] || null : null;

    let trajectory = null;
    let generatorMetadata = [];
    if (cascadeId) {
      try {
        await bridge.rawRPC("LoadTrajectory", { cascadeId });
      } catch (_error) {
        // Best-effort refresh. Some builds may not implement this call.
      }
      const trajectoryResponse = await bridge.rawRPC("GetCascadeTrajectory", { cascadeId });
      const generatorMetadataResponse = await bridge.rawRPC("GetCascadeTrajectoryGeneratorMetadata", { cascadeId });
      trajectory = trajectoryResponse.trajectory || null;
      generatorMetadata = Array.isArray(generatorMetadataResponse.generatorMetadata)
        ? generatorMetadataResponse.generatorMetadata
        : [];
    }

    const latestGeneration = selectLatestGeneratorMetadata(generatorMetadata, placeholderToLabel);

    return {
      ready: true,
      connection: this.connection,
      userStatus,
      modelOptions,
      placeholderToLabel,
      trajectorySummaries,
      workspaceCandidates,
      diagnosticsRecentTrajectories,
      diagnosticsActiveSession,
      activeTabSelection,
      selectionSource,
      cascadeId,
      activeSummary,
      trajectory,
      generatorMetadata,
      latestGeneration,
      recentSteps: extractRecentTrajectorySteps(trajectory)
    };
  }
}

module.exports = {
  AntigravitySdkBridge,
  buildModelOptionsFromUserStatus,
  buildPlaceholderModelMap,
  computeUsageFromGeneratorUsage,
  detectActiveTabSession,
  discoverManualConnection,
  extractRecentTrajectorySteps,
  extractStepText,
  extractTabMetadata,
  listWorkspaceTrajectoryCandidates,
  normalizeTitle,
  parseDiagnosticsRecentTrajectories,
  resolvePreferredCascadeId,
  selectLatestGeneratorMetadata,
  toPositiveInteger
};
