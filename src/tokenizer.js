"use strict";

const fs = require("fs");

const fileCache = new Map();

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
    return cached.value;
  }

  const buffer = fs.readFileSync(filePath);
  if (isProbablyBinary(buffer)) {
    const value = null;
    fileCache.set(filePath, { signature, value });
    return value;
  }

  const text = buffer.toString("utf8");
  const value = {
    text,
    tokens: countTokens(text),
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
  fileCache.set(filePath, { signature, value });
  return value;
}

module.exports = {
  countTokens,
  readTrackedFile,
  isProbablyBinary
};
