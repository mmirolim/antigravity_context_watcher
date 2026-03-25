"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { countTokens, isProbablyBinary } = require("../src/tokenizer");

test("countTokens uses a stable approximate heuristic", () => {
  assert.equal(countTokens(""), 0);
  assert.equal(countTokens("abcd"), 1);
  assert.equal(countTokens("abcdefgh"), 2);
});

test("isProbablyBinary detects null bytes", () => {
  assert.equal(isProbablyBinary(Buffer.from("hello")), false);
  assert.equal(isProbablyBinary(Buffer.from([0, 1, 2, 3])), true);
});
