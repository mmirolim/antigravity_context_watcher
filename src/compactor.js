"use strict";

const path = require("path");
const { countTokens } = require("./tokenizer");

function formatDate(timestamp) {
  if (!timestamp) {
    return "unknown";
  }
  return new Date(timestamp).toLocaleString();
}

function trimToTokens(text, maxTokens) {
  if (maxTokens <= 0 || countTokens(text) <= maxTokens) {
    return text;
  }
  const maxChars = Math.max(100, Math.floor(maxTokens * 4));
  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

function buildSummaryPrompt(snapshot, tokenLimit) {
  const header = [
    "Continue an Antigravity IDE coding session in a new chat.",
    "",
    `Model profile: ${snapshot.activeProfile ? snapshot.activeProfile.label : "Unknown"}`,
    `Estimated retained context: ${snapshot.estimatedTrackedTokens} input tokens`,
    `Effective input budget: ${snapshot.budget ? snapshot.budget.effectiveMaxInputTokens : 0}`,
    `Last updated: ${formatDate(snapshot.lastUpdatedAt)}`,
    "",
    "This context was assembled from tracked Antigravity artifacts and is an estimate, not an exact transcript.",
    "",
    "When continuing, preserve:",
    "- architecture decisions",
    "- file paths and modules already touched",
    "- current objective",
    "- unresolved issues and blockers",
    "- next concrete steps",
    "",
    "Tracked context:"
  ].join("\n");

  const entries = snapshot.summaryEntries || [];
  const baseTokens = countTokens(header);
  const safeLimit = Math.max(baseTokens + 1000, tokenLimit);
  let remaining = safeLimit - baseTokens;
  const sections = [];

  for (const entry of entries) {
    if (!entry.includedInEstimate || remaining <= 0) {
      continue;
    }
    const sectionHeader = `\n## ${entry.category}: ${path.basename(entry.path)}\nPath: ${entry.path}\n`;
    const sectionHeaderTokens = countTokens(sectionHeader);
    if (sectionHeaderTokens >= remaining) {
      break;
    }
    remaining -= sectionHeaderTokens;
    const body = trimToTokens(entry.text, remaining);
    const bodyTokens = countTokens(body);
    remaining -= bodyTokens;
    sections.push(`${sectionHeader}${body}`);
  }

  return `${header}\n${sections.join("\n")}`.trim();
}

module.exports = {
  buildSummaryPrompt
};
