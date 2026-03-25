"use strict";

const path = require("path");
const { getBrainRoot } = require("./antigravityLocator");

function getAutoPinSessionId(snapshot) {
  if (
    snapshot
    && snapshot.diagnosticsActiveSession
    && snapshot.diagnosticsActiveSession.sessionId
  ) {
    return snapshot.diagnosticsActiveSession.sessionId;
  }

  return snapshot
    && snapshot.activeTabSelection
    && snapshot.activeTabSelection.sessionId
    ? snapshot.activeTabSelection.sessionId
    : "";
}

function getVisibleSessionBrainPath(snapshot) {
  const sessionId = getAutoPinSessionId(snapshot);
  if (!sessionId) {
    return "";
  }
  return path.join(getBrainRoot(), sessionId);
}

function resolveAutoPinBrainPath(snapshot, currentPinnedPath, enabled) {
  if (!enabled) {
    return "";
  }

  const visibleBrainPath = getVisibleSessionBrainPath(snapshot);
  if (!visibleBrainPath) {
    return "";
  }

  const visibleSessionId = getAutoPinSessionId(snapshot);
  const alreadyFollowingVisible =
    snapshot.sessionId
    && snapshot.sessionId === visibleSessionId
    && snapshot.resolutionSource !== "configuredPath";
  if (alreadyFollowingVisible) {
    return "";
  }

  if (currentPinnedPath === visibleBrainPath) {
    return "";
  }

  return visibleBrainPath;
}

module.exports = {
  getAutoPinSessionId,
  getVisibleSessionBrainPath,
  resolveAutoPinBrainPath
};
