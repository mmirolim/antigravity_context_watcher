"use strict";

const TRACE_COMMANDS = [
  "antigravity.getDiagnostics",
  "antigravity.getWorkbenchTrace",
  "antigravity.getManagerTrace"
];

const TOKEN_KEY_RE = /(token|tokens|maxinput|maxoutput|prompt|completion)/i;
const MODEL_KEY_RE = /model/i;
const TEXT_KEY_RE = /(prompt|message|response|content|text|history|input|output)/i;
const MAX_SCAN_NODES = 50000;
const MAX_HITS_PER_KIND = 20;

function summarizeText(value, maxLength = 180) {
  if (typeof value !== "string") {
    return "";
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 12)} ...[truncated]`;
}

function pushCapped(list, item) {
  if (list.length >= MAX_HITS_PER_KIND) {
    return;
  }
  list.push(item);
}

function parseTracePayload(raw) {
  if (raw == null) {
    return {
      rawType: "null",
      rawText: "",
      parsedValue: null,
      parsed: false
    };
  }

  if (typeof raw === "string") {
    try {
      return {
        rawType: "string",
        rawText: raw,
        parsedValue: JSON.parse(raw),
        parsed: true
      };
    } catch (_error) {
      return {
        rawType: "string",
        rawText: raw,
        parsedValue: null,
        parsed: false
      };
    }
  }

  try {
    const rawText = JSON.stringify(raw);
    return {
      rawType: Array.isArray(raw) ? "array" : typeof raw,
      rawText,
      parsedValue: raw,
      parsed: true
    };
  } catch (_error) {
    return {
      rawType: Array.isArray(raw) ? "array" : typeof raw,
      rawText: "",
      parsedValue: raw,
      parsed: true
    };
  }
}

function scanTraceValue(value, sessionId) {
  const result = {
    nodeCount: 0,
    truncated: false,
    sessionHits: [],
    tokenHits: [],
    modelHints: [],
    textHits: []
  };

  const seen = new Set();
  const stack = [{ value, path: "$" }];

  while (stack.length > 0) {
    const current = stack.pop();
    result.nodeCount += 1;
    if (result.nodeCount > MAX_SCAN_NODES) {
      result.truncated = true;
      break;
    }

    const currentValue = current.value;
    const path = current.path;
    const lowerPath = path.toLowerCase();

    if (currentValue == null) {
      continue;
    }

    if (typeof currentValue === "string") {
      if (sessionId && currentValue.includes(sessionId)) {
        pushCapped(result.sessionHits, {
          path,
          preview: summarizeText(currentValue)
        });
      }
      if (MODEL_KEY_RE.test(lowerPath) && currentValue.trim()) {
        pushCapped(result.modelHints, {
          path,
          value: summarizeText(currentValue, 120)
        });
      }
      if (TEXT_KEY_RE.test(lowerPath) && currentValue.trim()) {
        pushCapped(result.textHits, {
          path,
          preview: summarizeText(currentValue)
        });
      }
      continue;
    }

    if (typeof currentValue === "number") {
      if (TOKEN_KEY_RE.test(lowerPath)) {
        pushCapped(result.tokenHits, {
          path,
          value: currentValue
        });
      }
      continue;
    }

    if (typeof currentValue !== "object") {
      continue;
    }

    if (seen.has(currentValue)) {
      continue;
    }
    seen.add(currentValue);

    if (Array.isArray(currentValue)) {
      for (let index = currentValue.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: currentValue[index],
          path: `${path}[${index}]`
        });
      }
      continue;
    }

    const entries = Object.entries(currentValue);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, nextValue] = entries[index];
      stack.push({
        value: nextValue,
        path: `${path}.${key}`
      });
    }
  }

  return result;
}

async function probeRuntimeTraces(vscode, sessionId) {
  const availableCommands = await vscode.commands.getCommands(true);
  const antigravityCommands = availableCommands
    .filter((commandId) => commandId.startsWith("antigravity."))
    .sort();

  const traces = [];
  for (const commandId of TRACE_COMMANDS) {
    const available = availableCommands.includes(commandId);
    if (!available) {
      traces.push({
        commandId,
        available: false,
        error: "Command not available in this Antigravity build.",
        rawType: "",
        rawLength: 0,
        parsed: false,
        scan: {
          nodeCount: 0,
          truncated: false,
          sessionHits: [],
          tokenHits: [],
          modelHints: [],
          textHits: []
        }
      });
      continue;
    }

    try {
      const raw = await vscode.commands.executeCommand(commandId);
      const parsed = parseTracePayload(raw);
      const scan = scanTraceValue(parsed.parsedValue, sessionId);
      if (!parsed.parsed && parsed.rawText && sessionId && parsed.rawText.includes(sessionId)) {
        scan.sessionHits.push({
          path: "$raw",
          preview: summarizeText(parsed.rawText)
        });
      }
      traces.push({
        commandId,
        available: true,
        error: "",
        rawType: parsed.rawType,
        rawLength: parsed.rawText.length,
        parsed: parsed.parsed,
        scan
      });
    } catch (error) {
      traces.push({
        commandId,
        available: true,
        error: error && error.message ? error.message : String(error),
        rawType: "",
        rawLength: 0,
        parsed: false,
        scan: {
          nodeCount: 0,
          truncated: false,
          sessionHits: [],
          tokenHits: [],
          modelHints: [],
          textHits: []
        }
      });
    }
  }

  return {
    antigravityCommands,
    traces
  };
}

module.exports = {
  TRACE_COMMANDS,
  parseTracePayload,
  probeRuntimeTraces,
  scanTraceValue,
  summarizeText
};
