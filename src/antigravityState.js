"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE_STATE_KEYS = [
  "memento/workbench.parts.editor",
  "memento/antigravity.jetskiArtifactsEditor",
  "history.entries"
];

const WORKSPACE_KEY_WEIGHTS = {
  "memento/workbench.parts.editor": 80,
  "memento/antigravity.jetskiArtifactsEditor": 40,
  "history.entries": 20
};

function existsFile(targetPath) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch (_error) {
    return false;
  }
}

function existsDir(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function getApplicationSupportRoot() {
  return path.join(os.homedir(), "Library", "Application Support", "Antigravity", "User");
}

function getGlobalStorageDbPath() {
  return path.join(getApplicationSupportRoot(), "globalStorage", "state.vscdb");
}

function getWorkspaceStorageRoot() {
  return path.join(getApplicationSupportRoot(), "workspaceStorage");
}

function getConversationRoot() {
  return path.join(os.homedir(), ".gemini", "antigravity", "conversations");
}

function getOptionalDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch (_error) {
    return null;
  }
}

function withDatabase(dbPath, callback) {
  const DatabaseSync = getOptionalDatabaseSync();
  if (!DatabaseSync || !existsFile(dbPath)) {
    return null;
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readonly: true });
    return callback(db);
  } catch (_error) {
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch (_error) {
        // Ignore close errors for best-effort diagnostics.
      }
    }
  }
}

function readStateValues(dbPath, keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return {};
  }

  const placeholders = keys.map(() => "?").join(", ");
  return withDatabase(dbPath, (db) => {
    const rows = db.prepare(
      `select key, value from ItemTable where key in (${placeholders})`
    ).all(...keys);
    const map = {};
    for (const row of rows) {
      map[row.key] = typeof row.value === "string" ? row.value : "";
    }
    return map;
  }) || {};
}

function readSingleStateValue(dbPath, key) {
  const values = readStateValues(dbPath, [key]);
  return typeof values[key] === "string" ? values[key] : "";
}

function listWorkspaceStateDbs() {
  const root = getWorkspaceStorageRoot();
  if (!existsDir(root)) {
    return [];
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "state.vscdb"))
    .filter((dbPath) => existsFile(dbPath));
}

function extractBrainSessionStats(text) {
  const stats = new Map();
  if (!text || typeof text !== "string") {
    return stats;
  }

  const pattern = /\/\.gemini\/antigravity\/brain\/([0-9a-f-]{36})\//gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const sessionId = match[1];
    stats.set(sessionId, (stats.get(sessionId) || 0) + 1);
  }
  return stats;
}

function getConversationFileInfo(sessionId) {
  if (!sessionId) {
    return {
      path: "",
      exists: false,
      size: 0,
      mtimeMs: 0
    };
  }

  const conversationPath = path.join(getConversationRoot(), `${sessionId}.pb`);
  try {
    const stat = fs.statSync(conversationPath);
    return {
      path: conversationPath,
      exists: stat.isFile(),
      size: stat.size,
      mtimeMs: stat.mtimeMs
    };
  } catch (_error) {
    return {
      path: conversationPath,
      exists: false,
      size: 0,
      mtimeMs: 0
    };
  }
}

function listConversationCandidates(getBrainRoot, limit = 8) {
  const conversationRoot = getConversationRoot();
  if (!existsDir(conversationRoot)) {
    return [];
  }

  const candidates = [];
  for (const entry of fs.readdirSync(conversationRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".pb")) {
      continue;
    }
    const sessionId = entry.name.slice(0, -3);
    const conversation = getConversationFileInfo(sessionId);
    const brainDir = path.join(getBrainRoot(), sessionId);
    candidates.push({
      sessionId,
      brainDir: existsDir(brainDir) ? brainDir : "",
      brainDirPath: brainDir,
      conversation
    });
  }

  candidates.sort((left, right) => right.conversation.mtimeMs - left.conversation.mtimeMs);
  return candidates.slice(0, Math.max(1, limit));
}

function buildWorkspaceSessionCandidates(workspaceFolders, getBrainRoot) {
  const dbPaths = listWorkspaceStateDbs();
  const workspacePaths = (workspaceFolders || [])
    .map((folder) => folder && folder.uri && folder.uri.fsPath)
    .filter(Boolean);
  const candidates = [];

  for (const dbPath of dbPaths) {
    const values = readStateValues(dbPath, WORKSPACE_STATE_KEYS);
    const dbStat = fs.statSync(dbPath);
    const workspaceMatched = workspacePaths.some((workspacePath) =>
      Object.values(values).some((value) => value.includes(workspacePath))
    );

    const sessionScores = new Map();
    const sessionSources = new Map();
    for (const [key, value] of Object.entries(values)) {
      const stats = extractBrainSessionStats(value);
      for (const [sessionId, count] of stats.entries()) {
        const baseScore = count * 10 + (WORKSPACE_KEY_WEIGHTS[key] || 0);
        const nextScore = (sessionScores.get(sessionId) || 0) + baseScore;
        sessionScores.set(sessionId, nextScore);

        const sources = sessionSources.get(sessionId) || [];
        if (!sources.includes(key)) {
          sources.push(key);
        }
        sessionSources.set(sessionId, sources);
      }
    }

    for (const [sessionId, score] of sessionScores.entries()) {
      const finalScore = score + (workspaceMatched ? 500 : 0);
      candidates.push({
        sessionId,
        brainDir: path.join(getBrainRoot(), sessionId),
        sourceDbPath: dbPath,
        sourceKeys: sessionSources.get(sessionId) || [],
        workspaceMatched,
        score: finalScore,
        dbMtimeMs: dbStat.mtimeMs
      });
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.dbMtimeMs - left.dbMtimeMs;
  });

  return candidates;
}

function readPrintableRuns(buffer, minLength) {
  const runs = [];
  let current = [];

  const pushCurrent = () => {
    if (current.length >= minLength) {
      runs.push(Buffer.from(current).toString("utf8"));
    }
    current = [];
  };

  for (const byte of buffer) {
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
      current.push(byte);
    } else {
      pushCurrent();
    }
  }
  pushCurrent();
  return runs;
}

function decodeBase64PrintableStrings(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  try {
    const buffer = Buffer.from(value, "base64");
    const strings = [];
    for (const run of readPrintableRuns(buffer, 4)) {
      for (const segment of run.split(/\r?\n/)) {
        const trimmed = segment.trim().replace(/^[^A-Za-z0-9]+/, "");
        if (trimmed && /[A-Za-z]/.test(trimmed)) {
          strings.push(trimmed);
        }
      }
    }
    return Array.from(new Set(strings));
  } catch (_error) {
    return [];
  }
}

function readVarint(buffer, offset) {
  let result = 0n;
  let shift = 0n;
  let position = offset;

  while (position < buffer.length) {
    const byte = BigInt(buffer[position]);
    result |= (byte & 0x7fn) << shift;
    position += 1;
    if ((byte & 0x80n) === 0n) {
      return [result, position];
    }
    shift += 7n;
  }

  return [null, offset + 1];
}

function decodeModelConfigNames(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  let encodedItems;
  try {
    encodedItems = JSON.parse(value);
  } catch (_error) {
    return [];
  }

  if (!Array.isArray(encodedItems)) {
    return [];
  }

  const names = new Set();

  for (const encoded of encodedItems) {
    if (typeof encoded !== "string" || !encoded) {
      continue;
    }
    let buffer;
    try {
      buffer = Buffer.from(encoded, "base64");
    } catch (_error) {
      continue;
    }

    let offset = 0;
    while (offset < buffer.length) {
      const [tag, next] = readVarint(buffer, offset);
      if (tag === null) {
        break;
      }
      const field = Number(tag >> 3n);
      const wire = Number(tag & 7n);
      if (wire === 2) {
        const [length, dataOffset] = readVarint(buffer, next);
        if (length === null) {
          break;
        }
        const end = dataOffset + Number(length);
        if (end > buffer.length) {
          break;
        }
        if (field === 1) {
          const text = buffer.subarray(dataOffset, end).toString("utf8");
          if (/[A-Za-z]{3,}/.test(text)) {
            names.add(text);
          }
        }
        offset = end;
        continue;
      }
      if (wire === 0) {
        const [, end] = readVarint(buffer, next);
        offset = end;
        continue;
      }
      if (wire === 1) {
        offset = next + 8;
        continue;
      }
      if (wire === 5) {
        offset = next + 4;
        continue;
      }
      offset += 1;
    }
  }

  return Array.from(names);
}

function readGlobalModelHints() {
  const dbPath = getGlobalStorageDbPath();
  const values = readStateValues(dbPath, [
    "antigravity_allowed_command_model_configs",
    "antigravityUnifiedStateSync.modelPreferences",
    "antigravityUnifiedStateSync.modelCredits"
  ]);

  return {
    dbPath,
    modelConfigNames: decodeModelConfigNames(values["antigravity_allowed_command_model_configs"] || ""),
    modelPreferencesStrings: decodeBase64PrintableStrings(values["antigravityUnifiedStateSync.modelPreferences"] || ""),
    modelCreditsStrings: decodeBase64PrintableStrings(values["antigravityUnifiedStateSync.modelCredits"] || "")
  };
}

function buildDiagnostics(workspaceFolders, getBrainRoot, resolvedTarget) {
  const workspaceCandidates = buildWorkspaceSessionCandidates(workspaceFolders, getBrainRoot);
  const globalHints = readGlobalModelHints();
  return {
    sqliteAvailable: Boolean(getOptionalDatabaseSync()),
    globalStorageDbPath: globalHints.dbPath,
    workspaceStorageRoot: getWorkspaceStorageRoot(),
    workspaceCandidates,
    latestConversations: listConversationCandidates(getBrainRoot, 8),
    globalHints,
    resolvedTarget
  };
}

module.exports = {
  buildDiagnostics,
  buildWorkspaceSessionCandidates,
  decodeBase64PrintableStrings,
  decodeModelConfigNames,
  extractBrainSessionStats,
  getConversationFileInfo,
  getGlobalStorageDbPath,
  getWorkspaceStorageRoot,
  listConversationCandidates,
  readSingleStateValue
};
