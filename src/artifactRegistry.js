"use strict";

const fs = require("fs");
const path = require("path");
const { readTrackedFile } = require("./tokenizer");

const BRAIN_OPTIONAL_FILES = new Set([
  "analysis_report.md",
  "task.md",
  "implementation_plan.md",
  "walkthrough.md"
]);

function existsPath(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch (_error) {
    return null;
  }
}

function walkFiles(startPath, onFile) {
  const stack = [startPath];
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
      onFile(nextPath, entry);
    }
  }
}

function addEntry(result, seen, filePath, category, includeInEstimate) {
  if (!filePath || seen.has(filePath) || !existsPath(filePath)) {
    return;
  }
  if (
    filePath.endsWith(".metadata.json") ||
    filePath.includes(`${path.sep}.tempmediaStorage${path.sep}`) ||
    filePath.includes(`${path.sep}.system_generated${path.sep}click_feedback${path.sep}`) ||
    filePath.endsWith(".resolved") ||
    filePath.includes(".resolved.")
  ) {
    return;
  }

  const stat = safeStat(filePath);
  if (!stat || !stat.isFile()) {
    return;
  }

  const tracked = readTrackedFile(filePath);
  if (!tracked || !tracked.text.trim()) {
    return;
  }

  seen.add(filePath);
  const entry = {
    path: filePath,
    category,
    includedInEstimate: Boolean(includeInEstimate),
    tokens: tracked.tokens,
    text: tracked.text,
    mtimeMs: tracked.mtimeMs,
    size: tracked.size
  };
  result.entries.push(entry);
}

function addBrainEntries(result, seen, brainDir, includeBrainArtifacts) {
  if (!brainDir || !existsPath(brainDir)) {
    return;
  }

  walkFiles(brainDir, (filePath, entry) => {
    if (entry.name === "output.txt") {
      addEntry(result, seen, filePath, "stepOutput", true);
      return;
    }
    if (includeBrainArtifacts && BRAIN_OPTIONAL_FILES.has(entry.name)) {
      addEntry(result, seen, filePath, "brainArtifact", true);
    }
  });
}

function addWorkspaceEntries(result, seen, workspaceFolders) {
  for (const folder of workspaceFolders) {
    const root = folder.uri.fsPath;
    const geminiPath = path.join(root, "GEMINI.md");
    if (existsPath(geminiPath)) {
      addEntry(result, seen, geminiPath, "workspaceInstructions", true);
    }

    const agentDir = path.join(root, ".agent");
    if (!existsPath(agentDir)) {
      continue;
    }
    walkFiles(agentDir, (filePath) => {
      addEntry(result, seen, filePath, "agentMemory", true);
    });
  }
}

function resolveExtraWatchPath(rawPath, workspaceFolders) {
  if (!rawPath || typeof rawPath !== "string") {
    return null;
  }
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  if (workspaceFolders.length === 0) {
    return null;
  }
  return path.join(workspaceFolders[0].uri.fsPath, rawPath);
}

function addExtraEntries(result, seen, extraWatchPaths, workspaceFolders) {
  for (const rawPath of extraWatchPaths) {
    const resolved = resolveExtraWatchPath(rawPath, workspaceFolders);
    if (!resolved || !existsPath(resolved)) {
      continue;
    }
    const stat = safeStat(resolved);
    if (!stat) {
      continue;
    }
    if (stat.isFile()) {
      addEntry(result, seen, resolved, "extra", true);
      continue;
    }
    walkFiles(resolved, (filePath) => {
      addEntry(result, seen, filePath, "extra", true);
    });
  }
}

function getCategoryPriority(entry) {
  switch (entry.category) {
    case "workspaceInstructions":
      return 0;
    case "agentMemory":
      return 1;
    case "brainArtifact":
      return 2;
    case "stepOutput":
      return 3;
    default:
      return 4;
  }
}

function summarize(entries) {
  const categoryTotals = {};
  let totalTokens = 0;
  let lastUpdatedAt = 0;

  for (const entry of entries) {
    categoryTotals[entry.category] = (categoryTotals[entry.category] || 0) + entry.tokens;
    if (entry.includedInEstimate) {
      totalTokens += entry.tokens;
    }
    if (entry.mtimeMs > lastUpdatedAt) {
      lastUpdatedAt = entry.mtimeMs;
    }
  }

  const summaryEntries = entries
    .slice()
    .sort((left, right) => {
      const priorityDiff = getCategoryPriority(left) - getCategoryPriority(right);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return right.mtimeMs - left.mtimeMs;
    });

  return {
    entries,
    summaryEntries,
    totalTokens,
    categoryTotals,
    lastUpdatedAt
  };
}

function buildArtifactRegistry(options) {
  const result = { entries: [] };
  const seen = new Set();
  addBrainEntries(result, seen, options.brainDir, options.includeBrainArtifacts);
  addWorkspaceEntries(result, seen, options.workspaceFolders || []);
  addExtraEntries(result, seen, options.extraWatchPaths || [], options.workspaceFolders || []);
  return summarize(result.entries);
}

module.exports = {
  buildArtifactRegistry
};
