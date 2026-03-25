# Antigravity Context Watcher Extension

A VS Code extension for Antigravity IDE focused on one core job first: track retained context for one chosen model in the current Antigravity session, show it clearly, and generate a copy-paste summary prompt for continuing in a new chat.

## Goal

Solve "context blindness" in Antigravity without misleading the user.

The extension must answer:

1. Which model profile should this conversation be counted against?
2. What is the effective context budget for that model in this IDE?
3. How much of that budget is already retained in tracked Antigravity artifacts?
4. When was the estimate last updated?
5. Can the user copy a ready-to-paste summary prompt to continue in a fresh chat?

## V1 Scope

V1 should prioritize correctness and stability over UI polish.

Ship in this order:

1. Prompt the user to choose the active model profile on first use.
2. Track one active Antigravity `brain/` session at a time.
3. Compute a stable token estimate from watched Antigravity text artifacts only.
4. Avoid obvious double counting by counting each tracked file once.
5. Apply model-specific effective budget math correctly.
6. Show a status bar indicator and a simple detailed breakdown view.
7. Generate a clipboard-ready summary prompt for starting a new chat.

## Non-Goals For V1

- No destructive rewriting of Antigravity chat logs.
- No undocumented command integration with Antigravity AI flows.
- No undocumented protobuf conversation parsing as a required path.
- No automatic model discovery as a required V1 feature.
- No streaming token detection in V1.
- No "beautiful" or animation-heavy webview work before the counting engine is proven.
- No hard dependency on network APIs or user API keys.

---

## Core Correctness Decisions

### 1. One Source of Truth For Token Accounting

The extension must not sum every file it can find and call that "actual context."

V1 should use a deterministic tracked-artifact registry for the active Antigravity `brain/` directory plus explicitly configured memory/instruction files.

The registry is the source of truth for the estimate.

Default tracked sources:

- `.system_generated/steps/*/output.txt`
- current workspace `.agent/**` text files
- workspace `GEMINI.md` if present

Optional tracked sources:

- `task.md`
- `implementation_plan.md`
- `walkthrough.md`

V1 should only track one selected/active `brain/` directory at a time. It should not aggregate across multiple historical Antigravity sessions.

Rules:

- Count each tracked file path at most once.
- Exclude metadata files, temp media, binary files, screenshots, and DOM dumps.
- Show categories separately in the breakdown so the user can see what is contributing to the estimate.

This avoids the most obvious double counting without pretending V1 knows Antigravity's exact assembled prompt.

### 2. Assistant Output Must Be Counted, But Only Once

The user is correct that model output matters because finalized output becomes future retained context.

V1 approach:

- Count finalized tracked text only.
- Do not attempt to count streaming tokens.
- Update the estimate after watched files settle.
- Show a `lastUpdatedAt` timestamp so users know the count reflects the last finalized state.

This means assistant output is counted once after it lands in tracked files, not during generation.

### 3. Budget Math Must Support Different Provider Semantics

Not all models expose limits the same way.

The extension must support two budget modes:

- `combined`: one total window shared by input and output
- `separate`: one input window plus a separate max output limit

Regardless of budget mode, every resolved model profile shown in the UI must expose:

- `effectiveMaxInputTokens`
- `effectiveMaxOutputTokens`

And every bundled model profile should keep provider reference data:

- `providerMaxContextTokens?`
- `providerMaxInputTokens?`
- `providerMaxOutputTokens`

Examples:

- Anthropic Claude: treat as `combined`
- OpenAI GPT-OSS: treat as `combined`
- Google Gemini 3.x: treat as `separate`

Rules:

- For `separate`, `effectiveMaxInputTokens` and `effectiveMaxOutputTokens` are direct limits.
- For `combined`, `effectiveMaxInputTokens` is derived from the effective shared window after subtracting the configured output reserve.
- Even in `combined` mode, the extension must still show explicit resolved input and output limits so the user is not looking at an ambiguous shared bucket.

The status bar should primarily show how much retained/input budget is consumed for the next turn, not a misleading single number that ignores provider differences.

### 4. Product Limit != Provider Maximum

The extension must distinguish:

- provider model capability
- Antigravity product-specific effective limit
- user override limit

The effective budget used by the counter must be resolved in this order:

1. User-selected model profile
2. User-configured override for that profile
3. Antigravity-discovered hint, if a stable limit is actually discoverable
4. Conservative bundled effective limit

The model-selection UX in V1 should be manual first:

- on first run, show a QuickPick of known Antigravity model profiles
- persist the chosen profile

Do not assume the IDE exposes the provider maximum.

### 5. V1 Is Estimate-Only

Because Antigravity does not expose a documented conversation log or streaming API to extensions, V1 should be explicit:

- the count is an estimate
- the estimate is based on watched text artifacts
- the tooltip should state this clearly

Do not add a multi-tier confidence system in V1.

If Antigravity later exposes a stable conversation API, exact modes can be added in V2.

---

## Proposed Changes

### Project Scaffolding

#### [NEW] [package.json](/Users/mirolim/projects/antigravity_context_watcher/package.json)

Extension manifest with:

- metadata for `antigravity-context-watcher`
- `activationEvents`: use `onStartupFinished` plus command activation, not `*`
- commands:
  - `contextWatcher.showBreakdown`
  - `contextWatcher.refresh`
  - `contextWatcher.pickModelProfile`
  - `contextWatcher.copyCompactPrompt`
  - `contextWatcher.openSettings`
- configuration:
  - model selection mode
  - user model profiles / overrides
  - warning thresholds
  - output reserve tokens
  - extra watch paths
- engine: recent VS Code API compatible with Antigravity

#### [NEW] [tsconfig.json](/Users/mirolim/projects/antigravity_context_watcher/tsconfig.json)

TypeScript configuration for a Node-based VS Code extension.

#### [NEW] [.vscodeignore](/Users/mirolim/projects/antigravity_context_watcher/.vscodeignore)

Exclude build/test noise from packaging.

#### [NEW] [.gitignore](/Users/mirolim/projects/antigravity_context_watcher/.gitignore)

Standard Node.js and VS Code ignores.

---

## Core Engine

#### [NEW] [src/extension.ts](/Users/mirolim/projects/antigravity_context_watcher/src/extension.ts)

Main entry point.

Responsibilities:

- initialize locator, model catalog, tracker, and UI
- register commands
- restore previous extension state
- dispose watchers and listeners cleanly

#### [NEW] [src/antigravityLocator.ts](/Users/mirolim/projects/antigravity_context_watcher/src/antigravityLocator.ts)

Locate Antigravity data sources on disk.

Responsibilities:

- detect Antigravity app data root:
  - `~/Library/Application Support/Antigravity`
- detect Antigravity workspace roots:
  - `~/.gemini/antigravity/brain`
- locate candidate `brain/<session-id>` directories
- infer the current active session conservatively from recent file activity
- return a structured `AntigravityPaths` object

#### [NEW] [src/modelCatalog.ts](/Users/mirolim/projects/antigravity_context_watcher/src/modelCatalog.ts)

Model discovery and effective budget resolution.

Responsibilities:

- provide bundled Antigravity-facing model profiles
- drive first-run manual model selection
- attach provider reference limits to bundled profiles
- attach effective default limits to bundled profiles
- apply user overrides
- expose:
  - `listAvailableModels()`
  - `getActiveModel()`
  - `resolveEffectiveBudget()`

Important behavior:

- Manual selection is the primary flow in V1.
- Do not collapse model families. `Claude Sonnet 4.6 (Thinking)` and `Claude Opus 4.6 (Thinking)` must remain separate profiles with separate resolved limits.

#### [NEW] [src/artifactRegistry.ts](/Users/mirolim/projects/antigravity_context_watcher/src/artifactRegistry.ts)

Build the tracked-artifact registry for the active Antigravity session.

Responsibilities:

- determine the active Antigravity `brain/` directory
- enumerate tracked text files from configured categories
- exclude known non-context noise such as:
  - `.metadata.json`
  - `.resolved*`
  - `.tempmediaStorage/**`
  - screenshots and binary assets
- dedupe by absolute path
- classify artifacts by category for display and compaction
- provide the ordered set of files used for the summary prompt

#### [NEW] [src/contextTracker.ts](/Users/mirolim/projects/antigravity_context_watcher/src/contextTracker.ts)

Central state machine for counts and updates.

Responsibilities:

- watch Antigravity sources outside the workspace using explicit path-based watchers
- debounce file bursts
- maintain the active `ContextSnapshot`
- track:
  - `estimatedTrackedTokens`
  - per-category token totals
  - `lastUpdatedAt`
- emit updates only when the snapshot materially changes

The tracker must never sum both:

- the same tracked file multiple times
- excluded files and included files from overlapping glob sets

#### [NEW] [src/tokenizer.ts](/Users/mirolim/projects/antigravity_context_watcher/src/tokenizer.ts)

Tokenizer abstraction layer.

Responsibilities:

- expose `countTokens(text, profile)`
- support provider/model tokenizer profiles where practical
- fall back to a documented estimate strategy when exact local tokenization is unavailable
- cache counts by file hash / content hash

Notes:

- Tokenizer accuracy differs by provider.
- The extension must record whether the count is exact or estimated.
- If an exact local tokenizer is not available for a provider, use conservative warnings earlier rather than pretending exactness.

#### [NEW] [src/budget.ts](/Users/mirolim/projects/antigravity_context_watcher/src/budget.ts)

Context budget math.

Responsibilities:

- define `BudgetMode = combined | separate`
- define `ModelBudget`:
  - `providerMaxContextTokens?`
  - `providerMaxInputTokens?`
  - `providerMaxOutputTokens`
  - `effectiveContextTokens?`
  - `effectiveMaxInputTokens`
  - `effectiveMaxOutputTokens`
  - `budgetMode`
  - `reservedOutputTokens`
  - `source` (`antigravity`, `userOverride`, `defaultProfile`)
- compute:
  - `inputBudgetUsedPercent`
  - `remainingInputHeadroom`

Rules:

- For `combined`, use:
  - require `effectiveContextTokens`
  - `effectiveMaxInputTokens = effectiveContextTokens - reservedOutputTokens`
- For `separate`, use:
  - `effectiveMaxInputTokens` is provided directly
  - `effectiveMaxOutputTokens` is provided directly
- The UI and diagnostics should always show both effective limits and provider reference limits when available.

#### [NEW] [src/types.ts](/Users/mirolim/projects/antigravity_context_watcher/src/types.ts)

Shared types for models, snapshots, artifact categories, and source metadata.

---

## Model Selection And Default Profiles

The extension should not require the user to edit JSON by hand, but V1 should not depend on Antigravity state discovery either.

### Selection Strategy

1. On first run, prompt the user to choose a bundled model profile.
2. Persist that profile for the workspace or globally.
3. If no choice exists, fall back to a bundled conservative profile.

The model list should preserve distinct Antigravity variants such as:

- `Gemini 3.1 Pro (High)`
- `Gemini 3.1 Pro (Low)`
- `Gemini 3 Flash`
- `Claude Sonnet 4.6 (Thinking)`
- `Claude Opus 4.6 (Thinking)`
- `GPT-OSS 120B (Medium)`

### Bundled Conservative Default Profiles

These are fallback defaults, not hard claims about Antigravity's actual internal caps.

As of March 25, 2026, use:

| Model | Provider | Budget Mode | Provider Reference | Effective Default For Counting |
| --- | --- | --- | --- | --- |
| `Gemini 3.1 Pro (High)` | Google | `separate` | input `1,048,576`, output `65,536` | input `1,000,000`, output `64,000` |
| `Gemini 3.1 Pro (Low)` | Google | `separate` | input `1,048,576`, output `65,536` | input `1,000,000`, output `64,000` |
| `Gemini 3 Flash` | Google | `separate` | input `1,048,576`, output `65,536` | input `1,000,000`, output `64,000` |
| `Claude Sonnet 4.6 (Thinking)` | Anthropic | `combined` | `200,000` standard shared, `1,000,000` beta shared, output `64,000` | shared `200,000`, resolved input `184,000`, output `64,000` |
| `Claude Opus 4.6 (Thinking)` | Anthropic | `combined` | `200,000` standard shared, `1,000,000` beta shared, output `128,000` | shared `200,000`, resolved input `168,000`, output `128,000` |
| `GPT-OSS 120B (Medium)` | OpenAI | `combined` | shared `131,072`, output `131,072` | shared `131,072`, resolved input `122,880`, output `131,072` |

Why conservative:

- Official provider docs may expose larger or beta limits than the IDE actually gives users.
- Antigravity may set lower internal caps for latency, reliability, or cost control.
- User overrides must always be supported.

### User Overrides

Add support for explicit overrides per model:

- `effectiveContextTokens`
- `effectiveMaxInputTokens`
- `effectiveMaxOutputTokens`
- `reservedOutputTokens`
- `budgetMode`

This allows the user to set a smaller safe limit if the real IDE behavior is more restrictive than provider docs.

For `combined` models:

- `effectiveContextTokens` remains the authoritative total window
- `effectiveMaxInputTokens` is the resolved post-reserve value the UI should display
- changing `reservedOutputTokens` recomputes `effectiveMaxInputTokens`

---

## Clipboard Summarizer

#### [NEW] [src/compactor.ts](/Users/mirolim/projects/antigravity_context_watcher/src/compactor.ts)

Low-risk V1 summary helper.

Responsibilities:

- gather recent tracked text artifacts up to a configurable token cap
- generate a summarization prompt suitable for pasting into a fresh AI chat
- include the current model label and current estimate in the prompt header
- include instructions to preserve architecture decisions, file paths, current objective, unresolved issues, and next steps
- copy that prompt to the clipboard
- show a confirmation toast with the token count and last updated timestamp

Rules:

- never modify Antigravity-managed files
- never claim to compact the live conversation automatically
- clearly label the prompt as based on tracked-artifact estimates
- optimize for "continue in new chat" rather than irreversible compaction

---

## Status Bar UI

#### [NEW] [src/statusBar.ts](/Users/mirolim/projects/antigravity_context_watcher/src/statusBar.ts)

Minimal, stable status bar item.

Display format example:

- `AG Est. 142k / 184k (77%)`

Tooltip should show:

- active model
- budget source
- estimate disclaimer
- effective max input
- effective max output
- provider reference limits
- last updated timestamp

Thresholds:

- green: healthy
- yellow: warning
- orange: nearing limit
- red: critical

Use text/color only. Keep it simple.

---

## Breakdown View

#### [NEW] [src/breakdownView.ts](/Users/mirolim/projects/antigravity_context_watcher/src/breakdownView.ts)

Simple detailed view for correctness-first diagnostics.

Responsibilities:

- show active model and budget source
- show budget mode (`combined` or `separate`)
- show:
  - estimated tracked tokens
  - effective max input tokens
  - effective max output tokens
  - provider reference limits
  - remaining input headroom
  - last updated timestamp
- show top token contributors by tracked artifact bucket
- show which artifact categories are included in the estimate

Avoid complex custom HTML styling in v1.

---

## Configuration

Extension settings should include:

- `contextWatcher.modelSelectionMode`: `manual | autoHint`
- `contextWatcher.activeModelId`
- `contextWatcher.modelProfiles`
- `contextWatcher.warningThreshold`
- `contextWatcher.criticalThreshold`
- `contextWatcher.reservedOutputTokens`
- `contextWatcher.includeBrainArtifactsInEstimate`
- `contextWatcher.compactorTokenLimit`
- `contextWatcher.extraWatchPaths`
- `contextWatcher.refreshIntervalMs`

Recommended schema for `modelProfiles`:

```json
[
  {
    "id": "claude-sonnet-4-6-thinking",
    "label": "Claude Sonnet 4.6 (Thinking)",
    "provider": "anthropic",
    "budgetMode": "combined",
    "providerMaxContextTokens": 200000,
    "providerMaxOutputTokens": 64000,
    "effectiveContextTokens": 200000,
    "effectiveMaxInputTokens": 184000,
    "effectiveMaxOutputTokens": 64000,
    "reservedOutputTokens": 16000
  }
]
```

---

## Verification Plan

### Automated Tests

Since correctness is the core risk, V1 needs real automated coverage.

#### [NEW] [src/test/contextTracker.test.ts](/Users/mirolim/projects/antigravity_context_watcher/src/test/contextTracker.test.ts)

Test:

- each tracked file path is counted once
- excluded files are ignored
- optional brain artifacts can be toggled into the estimate

#### [NEW] [src/test/budget.test.ts](/Users/mirolim/projects/antigravity_context_watcher/src/test/budget.test.ts)

Test:

- `combined` budget math
- `separate` budget math
- user override precedence
- effective limits vs provider reference limits

#### [NEW] [src/test/modelCatalog.test.ts](/Users/mirolim/projects/antigravity_context_watcher/src/test/modelCatalog.test.ts)

Test:

- manual-first selection flow
- manual profile selection
- conservative defaults for current Antigravity models

#### [NEW] [src/test/compactor.test.ts](/Users/mirolim/projects/antigravity_context_watcher/src/test/compactor.test.ts)

Test:

- generated clipboard prompt includes the selected model label
- prompt is capped by configured token budget
- prompt includes estimate disclaimer and last updated time
- prompt is usable as a "start new chat with this summary" handoff

#### [NEW] [src/test/fixtures/](/Users/mirolim/projects/antigravity_context_watcher/src/test/fixtures/)

Fixtures should include:

- sample Antigravity `brain` directories
- duplicate path / overlap cases
- included vs excluded artifact cases
- compactor samples

### Manual Tests

1. Install and launch the extension host.
2. On first run, verify the extension prompts for model selection.
3. Open a workspace with one active Antigravity session.
4. Verify the extension selects or prompts for one current `brain/` directory only.
5. Verify the estimate updates after watched files change.
6. Verify manual model overrides immediately change the budget denominator.
7. Verify a Claude profile and a Gemini profile produce different budget math.
8. Run the clipboard summarizer and verify the generated prompt is copied and suitable for starting a new chat.

---

## Risks And Open Questions

1. Antigravity stores important state in internal formats, including protobuf files and SQLite-backed state. Their schema may change.
2. Antigravity may not expose a stable public API for available models or current model selection.
3. Exact local tokenization may not be equally available for every provider.
4. Some artifacts in `brain/` are tool outputs, not full conversation history, so V1 remains estimate-only by design.
5. Selecting the current active `brain/` directory may need a manual fallback when several sessions were updated recently.

Because of these risks, V1 should keep manual model selection, explicit estimate labeling, and user model/budget overrides.

---

## Summary

The corrected plan for v1 is:

1. Let the user choose the model profile first.
2. Track one current Antigravity session only.
3. Estimate retained context from watched Antigravity text artifacts only.
4. Count finalized tracked output once, with no streaming logic.
5. Apply model-specific effective budget math while preserving provider reference limits.
6. Show the result clearly as an estimate.
7. Include a non-destructive clipboard summary prompt for starting a new chat.
