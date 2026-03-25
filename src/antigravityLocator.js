"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const TRACKED_FILENAMES = new Set([
  "output.txt",
  "analysis_report.md",
  "task.md",
  "implementation_plan.md",
  "walkthrough.md"
]);

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

function listSessionDirs(brainRoot) {
  if (!existsDir(brainRoot)) {
    return [];
  }
  return fs
    .readdirSync(brainRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(brainRoot, entry.name));
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
      if (!TRACKED_FILENAMES.has(entry.name)) {
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

function resolveActiveBrainDir(config) {
  const configuredPath = config.get("activeBrainPath", "");
  if (configuredPath && existsDir(configuredPath)) {
    return configuredPath;
  }

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
  return best;
}

module.exports = {
  getBrainRoot,
  listSessionDirs,
  resolveActiveBrainDir
};
