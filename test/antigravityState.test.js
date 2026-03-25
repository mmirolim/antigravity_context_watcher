"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decodeBase64PrintableStrings,
  decodeModelConfigNames,
  extractBrainSessionStats
} = require("../src/antigravityState");

test("extractBrainSessionStats counts workspace-linked brain sessions", () => {
  const text = [
    "file:///Users/test/.gemini/antigravity/brain/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/task.md",
    "file:///Users/test/.gemini/antigravity/brain/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/task.md.resolved",
    "file:///Users/test/.gemini/antigravity/brain/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/implementation_plan.md"
  ].join("\n");

  const stats = extractBrainSessionStats(text);

  assert.equal(stats.get("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), 2);
  assert.equal(stats.get("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"), 1);
});

test("decodeModelConfigNames extracts model labels from encoded config blobs", () => {
  const rawValue = JSON.stringify([
    "Cg5HZW1pbmkgMyBGbGFzaBIDCPoHKAFYAWIGAgEFAwQIeg0NAACAPxIGCIaKv80GkgEUChBhcHBsaWNhdGlvbi9qc29uEAGSARMKD2FwcGxpY2F0aW9uL3BkZhABkgETCg9hcHBsaWNhdGlvbi9ydGYQAZIBHAoYYXBwbGljYXRpb24veC1pcHluYitqc29uEAGSARwKGGFwcGxpY2F0aW9uL3gtamF2YXNjcmlwdBABkgEdChlhcHBsaWNhdGlvbi94LXB5dGhvbi1jb2RlEAGSARwKGGFwcGxpY2F0aW9uL3gtdHlwZXNjcmlwdBABkgEaChZhdWRpby93ZWJtO2NvZGVjcz1vcHVzEAGSAQ4KCmltYWdlL2hlaWMQAZIBDgoKaW1hZ2UvaGVpZhABkgEOCgppbWFnZS9qcGVnEAGSAQ0KCWltYWdlL3BuZxABkgEOCgppbWFnZS93ZWJwEAGSAQwKCHRleHQvY3NzEAGSAQwKCHRleHQvY3N2EAGSAQ0KCXRleHQvaHRtbBABkgETCg90ZXh0L2phdmFzY3JpcHQQAZIBEQoNdGV4dC9tYXJrZG93bhABkgEOCgp0ZXh0L3BsYWluEAGSAQwKCHRleHQvcnRmEAGSAREKDXRleHQveC1weXRob24QAZIBGAoUdGV4dC94LXB5dGhvbi1zY3JpcHQQAZIBFQoRdGV4dC94LXR5cGVzY3JpcHQQAZIBDAoIdGV4dC94bWwQAZIBFQoRdmlkZW8vYXVkaW8vczE2bGUQAZIBEwoPdmlkZW8vYXVkaW8vd2F2EAGSARIKDnZpZGVvL2pwZWcyMDAwEAGSAQ0KCXZpZGVvL21wNBABkgEYChR2aWRlby90ZXh0L3RpbWVzdGFtcBABkgEdChl2aWRlby92aWRlb2ZyYW1lL2pwZWcyMDAwEAGSAQ4KCnZpZGVvL3dlYm0QAQ=="
  ]);

  const names = decodeModelConfigNames(rawValue);

  assert.deepEqual(names, ["Gemini 3 Flash"]);
});

test("decodeBase64PrintableStrings exposes readable state hints", () => {
  const strings = decodeBase64PrintableStrings(
    "CjAKJmxhc3Rfc2VsZWN0ZWRfYWdlbnRfbW9kZWxfc2VudGluZWxfa2V5EgYKBEVJSUk="
  );

  assert.equal(strings.includes("last_selected_agent_model_sentinel_key"), true);
  assert.equal(strings.includes("EIII"), true);
});
