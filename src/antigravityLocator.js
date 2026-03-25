"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildWorkspaceSessionCandidates,
  getConversationFileInfo,
  listConversationCandidates
} = require("./antigravityState");

const TRACKED_FILENAMES = new Set(["output.txt"]);
const CONVERSATION_OVERRIDE_DELTA_MS = 15000;

function existsDir(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function getBrainRoot() {
  return path.join(os.homedir(), ".gemini", "antigravity", "brain");
}

function getSessionIdFromBrainDir(brainDir) {
  if (!brainDir) {
    return "";
  }
  return path.basename(brainDir);
}

function listSessionDirs(brainRoot) {
  if (!existsDir(brainRoot)) {
    return [];
  }
  return fs
    .readdirSync(brainRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(brainRoot, entry.name));
}

function isRelevantBrainFile(filePath, entryName) {
  if (TRACKED_FILENAMES.has(entryName)) {
    return true;
  }
  if (filePath.endsWith(".resolved") || filePath.includes(".resolved.")) {
    return false;
  }
  if (filePath.endsWith(".metadata.json")) {
    return false;
  }
  return entryName.endsWith(".md") || entryName.endsWith(".txt");
}

function getLatestRelevantMtime(sessionDir) {
  let latest = 0;
  const stack = [sessionDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".tempmediaStorage") {
          continue;
        }
        stack.push(nextPath);
        continue;
      }
      if (!isRelevantBrainFile(nextPath, entry.name)) {
        continue;
      }
      try {
        const stat = fs.statSync(nextPath);
        if (stat.mtimeMs > latest) {
          latest = stat.mtimeMs;
        }
      } catch (_error) {
        continue;
      }
    }
  }
  return latest;
}

function resolveConfiguredBrainTarget(config) {
  const configuredPath = config.get("activeBrainPath", "");
  if (!configuredPath || !existsDir(configuredPath)) {
    return null;
  }
  const sessionId = getSessionIdFromBrainDir(configuredPath);
  return {
    brainDir: configuredPath,
    sessionId,
    source: "configuredPath",
    workspaceCandidates: [],
    conversation: getConversationFileInfo(sessionId)
  };
}

function resolveWorkspaceBrainTarget(workspaceFolders) {
  const candidates = buildWorkspaceSessionCandidates(workspaceFolders, getBrainRoot);
  if (candidates.length === 0) {
    return null;
  }
  const best = candidates[0];
  return {
    brainDir: best.brainDir,
    sessionId: best.sessionId,
    source: "workspaceState",
    workspaceCandidates: candidates,
    conversation: getConversationFileInfo(best.sessionId)
  };
}

function resolveLatestConversationTarget() {
  const candidates = listConversationCandidates(getBrainRoot, 1);
  if (candidates.length === 0) {
    return null;
  }
  const best = candidates[0];
  return {
    brainDir: best.brainDir,
    sessionId: best.sessionId,
    source: "latestConversationMtime",
    workspaceCandidates: [],
    conversation: best.conversation
  };
}

function resolveLatestBrainTarget() {
  const brainRoot = getBrainRoot();
  const sessions = listSessionDirs(brainRoot);
  let best = null;
  let bestScore = 0;
  for (const sessionDir of sessions) {
    const score = getLatestRelevantMtime(sessionDir);
    if (score > bestScore) {
      bestScore = score;
      best = sessionDir;
    }
  }
  if (!best) {
    return {
      brainDir: null,
      sessionId: "",
      source: "none",
      workspaceCandidates: [],
      conversation: getConversationFileInfo("")
    };
  }
  const sessionId = getSessionIdFromBrainDir(best);
  return {
    brainDir: best,
    sessionId,
    source: "latestBrainMtime",
    workspaceCandidates: [],
    conversation: getConversationFileInfo(sessionId)
  };
}

function getTargetActivityMtime(target) {
  if (!target) {
    return 0;
  }
  const brainMtime = target.brainDir ? getLatestRelevantMtime(target.brainDir) : 0;
  const conversationMtime = target.conversation ? target.conversation.mtimeMs || 0 : 0;
  return Math.max(brainMtime, conversationMtime);
}

function pickPreferredTarget(workspaceTarget, latestConversationTarget) {
  if (!workspaceTarget) {
    return latestConversationTarget;
  }
  if (!latestConversationTarget) {
    return workspaceTarget;
  }

  if (workspaceTarget.sessionId === latestConversationTarget.sessionId) {
    return {
      ...workspaceTarget,
      conversation: latestConversationTarget.conversation
    };
  }

  const workspaceActivity = getTargetActivityMtime(workspaceTarget);
  const latestConversationActivity = getTargetActivityMtime(latestConversationTarget);
  if (!workspaceActivity) {
    return {
      ...latestConversationTarget,
      workspaceCandidates: workspaceTarget.workspaceCandidates || []
    };
  }
  if (latestConversationActivity > workspaceActivity + CONVERSATION_OVERRIDE_DELTA_MS) {
    return {
      ...latestConversationTarget,
      workspaceCandidates: workspaceTarget.workspaceCandidates || []
    };
  }
  return workspaceTarget;
}

function resolveActiveBrainTarget(config, workspaceFolders) {
  const configuredTarget = resolveConfiguredBrainTarget(config);
  if (configuredTarget) {
    return configuredTarget;
  }

  const workspaceTarget = resolveWorkspaceBrainTarget(workspaceFolders);
  const latestConversationTarget = resolveLatestConversationTarget();
  const preferredTarget = pickPreferredTarget(workspaceTarget, latestConversationTarget);
  if (preferredTarget) {
    return preferredTarget;
  }

  return resolveLatestBrainTarget();
}

function resolveActiveBrainDir(config, workspaceFolders) {
  return resolveActiveBrainTarget(config, workspaceFolders).brainDir;
}

module.exports = {
  getBrainRoot,
  getSessionIdFromBrainDir,
  listSessionDirs,
  pickPreferredTarget,
  resolveActiveBrainTarget,
  resolveActiveBrainDir
};
