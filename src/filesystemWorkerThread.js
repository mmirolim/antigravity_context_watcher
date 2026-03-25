"use strict";

const { parentPort } = require("worker_threads");
const { resolveActiveBrainTarget } = require("./antigravityLocator");
const { buildArtifactRegistry } = require("./artifactRegistry");
const { beginCacheGeneration, sweepCache } = require("./tokenizer");

function makeConfig(values) {
  return {
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    }
  };
}

function makeWorkspaceFolders(paths) {
  return (paths || []).map((fsPath) => ({
    uri: {
      fsPath
    }
  }));
}

function handleResolveActiveBrainTarget(payload) {
  const config = makeConfig({
    activeBrainPath: payload.activeBrainPath || ""
  });
  const workspaceFolders = makeWorkspaceFolders(payload.workspaceFolderPaths);
  return resolveActiveBrainTarget(config, workspaceFolders);
}

function handleBuildArtifactRegistry(payload) {
  beginCacheGeneration();
  try {
    return buildArtifactRegistry({
      brainDir: payload.brainDir || "",
      includeBrainArtifacts: Boolean(payload.includeBrainArtifacts),
      extraWatchPaths: Array.isArray(payload.extraWatchPaths) ? payload.extraWatchPaths : [],
      workspaceFolders: makeWorkspaceFolders(payload.workspaceFolderPaths)
    });
  } finally {
    sweepCache();
  }
}

const handlers = {
  resolveActiveBrainTarget: handleResolveActiveBrainTarget,
  buildArtifactRegistry: handleBuildArtifactRegistry
};

parentPort.on("message", async (message) => {
  const { id, method, payload } = message || {};
  const handler = handlers[method];
  if (!handler) {
    parentPort.postMessage({
      id,
      ok: false,
      error: `Unknown filesystem worker method: ${method || "unknown"}`
    });
    return;
  }

  try {
    const result = await handler(payload || {});
    parentPort.postMessage({
      id,
      ok: true,
      result
    });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }
});
