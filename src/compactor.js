"use strict";

const path = require("path");
const { countTokens } = require("./tokenizer");
const { analyzeLiveUsage } = require("./liveUsageAnalysis");

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
  const liveUsageAnalysis = analyzeLiveUsage(snapshot);
  const usageLabel = snapshot.usageSource === "liveGeneratorMetadata"
    ? "Live retained context"
    : "Estimated retained context";
  const sourceNote = snapshot.usageSource === "liveGeneratorMetadata"
    ? "This context uses live Antigravity trajectory metadata for token usage and includes recent trajectory steps plus supporting artifacts."
    : "This context was assembled from tracked Antigravity artifacts and is an estimate, not an exact transcript.";
  const headerLines = [
    "Continue an Antigravity IDE coding session in a new chat.",
    "",
    `Model profile: ${snapshot.activeProfile ? snapshot.activeProfile.label : "Unknown"}`,
    `Detected live model: ${snapshot.detectedModelLabel || "unknown"}`,
    `${usageLabel}: ${snapshot.estimatedTrackedTokens} input tokens`,
    `Supporting artifact estimate: ${snapshot.artifactEstimateTokens || 0} input tokens`,
    `Effective input budget: ${snapshot.budget ? snapshot.budget.effectiveMaxInputTokens : 0}`,
    `Last updated: ${formatDate(snapshot.lastUpdatedAt)}`,
    "",
    sourceNote,
    ""
  ];

  if (snapshot.usageSource === "liveGeneratorMetadata" && snapshot.liveLatestGeneration) {
    headerLines.push(
      `Decoded recent live-step tokens: ${liveUsageAnalysis.decodedRecentStepTokens}`,
      `Retained tokens not explained by decoded live steps: ${liveUsageAnalysis.unexplainedRetainedTokens}`
    );
    if (liveUsageAnalysis.hiddenContextLikely) {
      headerLines.push(
        "Antigravity appears to preload substantial hidden context beyond the decoded live steps.",
        "Preserve workspace assumptions and project state explicitly in the next chat."
      );
    }
    headerLines.push("");
  }

  headerLines.push(
    "When continuing, preserve:",
    "- architecture decisions",
    "- file paths and modules already touched",
    "- current objective",
    "- unresolved issues and blockers",
    "- next concrete steps",
    "",
    "Tracked context:"
  );

  const header = headerLines.join("\n");

  const entries = snapshot.summaryEntries || [];
  const baseTokens = countTokens(header);
  const safeLimit = Math.max(baseTokens + 1000, tokenLimit);
  let remaining = safeLimit - baseTokens;
  const sections = [];

  for (const entry of entries) {
    const includeInHandoff = entry.includedInHandoff !== false && (entry.includedInHandoff || entry.includedInEstimate);
    if (!includeInHandoff || remaining <= 0) {
      continue;
    }
    const label = entry.liveStepIndex != null
      ? `step ${entry.liveStepIndex} (${entry.liveStepType || "unknown"})`
      : path.basename(entry.path);
    const sectionHeader = `\n## ${entry.category}: ${label}\nPath: ${entry.path}\n`;
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

function buildSummarizeCurrentChatPrompt(snapshot, tokenLimit) {
  const targetTokens = Math.max(1000, Math.floor(tokenLimit));

  return [
    "Summarize this current Antigravity chat so I can continue it efficiently in a fresh chat.",
    "",
    `Use at most ${targetTokens} tokens.`,
    "Use the chat history and current session context already available to you.",
    "Do not copy long excerpts from earlier messages or generated outputs unless a very short quote is necessary.",
    "Summarize large generated prose, code, or lists instead of reproducing them.",
    "",
    "Include only what is needed to continue correctly in the next chat:",
    "- current goal",
    "- current state and what is already done",
    "- key technical decisions and constraints",
    "- files, artifacts, commands, or modules that matter",
    "- unresolved bugs, risks, assumptions, and blockers",
    "- exact next steps",
    "- a short paste-ready starter prompt for the next chat",
    "",
    "Prefer concrete file paths, function names, commands, and constraints over prose.",
    "Do not include filler, pleasantries, or commentary about being an AI assistant.",
    "Do not mention token counts, context counters, or that this summary was requested by an extension.",
    "Format the result as a compact handoff for a new coding chat with these headings:",
    "Goal",
    "Current State",
    "Key Decisions",
    "Files And Artifacts",
    "Open Issues",
    "Next Steps",
    "Starter Prompt"
  ].join("\n").trim();
}

module.exports = {
  buildSummaryPrompt,
  buildSummarizeCurrentChatPrompt
};
