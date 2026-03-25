"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildArtifactRegistry } = require("../src/artifactRegistry");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ag-context-test-"));
}

test("buildArtifactRegistry counts tracked files once and ignores noise", () => {
  const root = makeTempDir();
  const brainDir = path.join(root, "brain", "session");
  const stepsDir = path.join(brainDir, ".system_generated", "steps", "1");
  const tempMediaDir = path.join(brainDir, ".tempmediaStorage");
  const workspaceDir = path.join(root, "workspace");
  const agentDir = path.join(workspaceDir, ".agent", "rules");

  fs.mkdirSync(stepsDir, { recursive: true });
  fs.mkdirSync(tempMediaDir, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });

  fs.writeFileSync(path.join(stepsDir, "output.txt"), "assistant output");
  fs.writeFileSync(path.join(brainDir, "task.md"), "task doc");
  fs.writeFileSync(path.join(tempMediaDir, "dom_1.txt"), "ignore this");
  fs.writeFileSync(path.join(workspaceDir, "GEMINI.md"), "workspace instructions");
  fs.writeFileSync(path.join(agentDir, "allow.md"), "rule text");

  const registry = buildArtifactRegistry({
    brainDir,
    workspaceFolders: [{ uri: { fsPath: workspaceDir } }],
    includeBrainArtifacts: false,
    extraWatchPaths: []
  });

  assert.equal(registry.entries.some((entry) => entry.path.endsWith("dom_1.txt")), false);
  assert.equal(registry.entries.some((entry) => entry.path.endsWith("task.md")), false);
  assert.equal(registry.entries.some((entry) => entry.path.endsWith("output.txt")), true);
  assert.equal(registry.entries.some((entry) => entry.path.endsWith("GEMINI.md")), true);
  assert.equal(registry.entries.some((entry) => entry.path.endsWith("allow.md")), true);
});

test("buildArtifactRegistry can include optional brain artifacts", () => {
  const root = makeTempDir();
  const brainDir = path.join(root, "brain", "session");
  fs.mkdirSync(brainDir, { recursive: true });
  fs.writeFileSync(path.join(brainDir, "analysis_report.md"), "analysis doc");
  fs.writeFileSync(path.join(brainDir, "implementation_plan.md"), "plan doc");

  const registry = buildArtifactRegistry({
    brainDir,
    workspaceFolders: [],
    includeBrainArtifacts: true,
    extraWatchPaths: []
  });

  assert.equal(registry.entries.some((entry) => entry.path.endsWith("analysis_report.md")), true);
  assert.equal(registry.entries.some((entry) => entry.path.endsWith("implementation_plan.md")), true);
});
