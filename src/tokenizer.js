"use strict";

const fs = require("fs");

// Generation-based cache: entries not accessed during the latest refresh
// cycle are evicted on the next sweep. This prevents unbounded growth from
// stale session files that are no longer part of the active artifact set.
const fileCache = new Map();
let currentGeneration = 0;

function countTokens(text) {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

function isProbablyBinary(buffer) {
  if (!buffer || buffer.length === 0) {
    return false;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if (byte < 7 || (byte > 14 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length > 0.05;
}

function readTrackedFile(filePath) {
  const stat = fs.statSync(filePath);
  const signature = `${stat.size}:${stat.mtimeMs}`;
  const cached = fileCache.get(filePath);
  if (cached && cached.signature === signature) {
    cached.generation = currentGeneration;
    return cached.value;
  }

  const buffer = fs.readFileSync(filePath);
  if (isProbablyBinary(buffer)) {
    const value = null;
    fileCache.set(filePath, { signature, value, generation: currentGeneration });
    return value;
  }

  const text = buffer.toString("utf8");
  const value = {
    text,
    tokens: countTokens(text),
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
  fileCache.set(filePath, { signature, value, generation: currentGeneration });
  return value;
}

/**
 * Advance to a new cache generation. Call this at the start of each refresh
 * cycle so that accessed entries are stamped with the new generation.
 */
function beginCacheGeneration() {
  currentGeneration += 1;
}

/**
 * Evict cache entries that were not accessed during the current generation.
 * Call this after a refresh cycle completes. Files from previous sessions or
 * no-longer-tracked paths are removed, keeping memory proportional to the
 * active artifact set.
 */
function sweepCache() {
  for (const [key, entry] of fileCache) {
    if (entry.generation < currentGeneration) {
      fileCache.delete(key);
    }
  }
}

module.exports = {
  countTokens,
  readTrackedFile,
  isProbablyBinary,
  beginCacheGeneration,
  sweepCache
};
