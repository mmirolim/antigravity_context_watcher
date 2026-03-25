"use strict";

const fs = require("fs");

/**
 * Safe positive integer from any value. Returns 0 for null, negative, NaN, or non-numeric.
 */
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

/**
 * Parse an ISO/RFC timestamp string into epoch ms. Returns 0 for falsy or invalid values.
 */
function parseTimestamp(value) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Check if a path points to an existing file.
 */
function existsFile(targetPath) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch (_error) {
    return false;
  }
}

/**
 * Check if a path points to an existing directory.
 */
function existsDir(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch (_error) {
    return false;
  }
}

/**
 * Check if a path exists (file or directory).
 */
function existsPath(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Safe stat that returns null instead of throwing.
 */
function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  toPositiveInteger,
  parseTimestamp,
  existsFile,
  existsDir,
  existsPath,
  safeStat
};
