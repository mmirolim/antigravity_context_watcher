# Antigravity Context Watcher: Real Antigravity Testing Guide

This guide explains how to test the extension inside the real Antigravity IDE, not just with unit tests.

It covers:
- installing from a local directory
- installing from a VSIX
- setting up the extension
- what to test
- what results to expect

## 1. What This MVP Does

The current MVP does these things:
- lets you choose a model profile manually
- detects the active Antigravity session under `~/.gemini/antigravity/brain`
- uses live Antigravity generator metadata for retained-context totals when available
- falls back to a tracked-artifact estimate when live metadata is unavailable
- shows retained context in the status bar
- shows a breakdown document
- copies a new-chat handoff prompt to the clipboard

It does not do these things:
- it does not read an exact provider-side prompt transcript
- it does not fully decode the opaque `.pb` conversation blob
- it does not track streaming output live
- it does not compact the current chat automatically

In fallback artifact-estimate mode, the watcher counts:
- `task.md`
- `implementation_plan.md`
- `analysis_report.md`
- `walkthrough.md`
- step `output.txt` files
- workspace `GEMINI.md`
- workspace `.agent/**`
- any configured `contextWatcher.extraWatchPaths`

## 2. Prerequisites

You need:
- Antigravity installed
- this repository on disk
- Node.js available in your shell

This extension is plain JavaScript. There is no build step and no `npm install` requirement for the basic local-folder test flow.

Repo path used in examples below:

```bash
/Users/mirolim/projects/antigravity_context_watcher
```

Antigravity CLI path on this machine:

```bash
~/.antigravity/antigravity/bin/antigravity
```

Antigravity user extensions directory on this machine:

```bash
~/.antigravity/extensions
```

## 3. Fastest Safe Test: Isolated Local-Folder Install

This is the best way to test without touching your normal Antigravity profile.

### 3.1 Create an isolated extensions directory

```bash
rm -rf /tmp/ag-user-test /tmp/ag-exts-test
mkdir -p /tmp/ag-exts-test
ln -s /Users/mirolim/projects/antigravity_context_watcher /tmp/ag-exts-test/local.antigravity-context-watcher-0.0.8
```

### 3.2 Verify Antigravity sees the unpacked extension

```bash
~/.antigravity/antigravity/bin/antigravity \
  --list-extensions \
  --show-versions \
  --extensions-dir /tmp/ag-exts-test
```

Expected output should include:

```text
local.antigravity-context-watcher@0.0.8
```

### 3.3 Launch Antigravity with isolated user data

Replace `/path/to/project` with any project you want to test in.

```bash
~/.antigravity/antigravity/bin/antigravity \
  --user-data-dir /tmp/ag-user-test \
  --extensions-dir /tmp/ag-exts-test \
  /path/to/project
```

This runs a clean Antigravity instance with only your test extension directory.

## 4. Install Into Your Normal Antigravity Profile From a Local Directory

Antigravity CLI does not install raw folders directly. `--install-extension` accepts an extension id or a VSIX path, not a local directory.

For a local-directory install, use a symlink or a copied folder inside:

```bash
~/.antigravity/extensions
```

### 4.1 Symlink install

```bash
mkdir -p ~/.antigravity/extensions
ln -sfn /Users/mirolim/projects/antigravity_context_watcher \
  ~/.antigravity/extensions/local.antigravity-context-watcher-0.0.8
```

### 4.2 Verify installation

```bash
~/.antigravity/antigravity/bin/antigravity --list-extensions --show-versions | rg antigravity-context-watcher
```

Expected result:

```text
local.antigravity-context-watcher@0.0.8
```

### 4.3 Restart Antigravity

Close all Antigravity windows and reopen the app.

## 5. Install From a VSIX

This is cleaner if you want a normal install path.

### 5.1 Package the VSIX

From the repository root:

```bash
npx @vscode/vsce package --allow-missing-repository
```

This was verified and produces:

```text
antigravity-context-watcher-0.0.8.vsix
```

### 5.2 Install the VSIX

```bash
~/.antigravity/antigravity/bin/antigravity \
  --install-extension /Users/mirolim/projects/antigravity_context_watcher/antigravity-context-watcher-0.0.8.vsix
```

Then restart Antigravity.

You can also use the Antigravity UI:
- Extensions
- `...` menu
- `Install from VSIX...`

## 6. Initial Setup Inside Antigravity

After Antigravity starts:

1. Open Command Palette.
2. Run `Context Watcher: Pick Model Profile`.
3. Choose the model that matches the Antigravity session you are testing.

Recommended first test choice:
- `Claude Opus 4.6 (Thinking)` if that is what you are actively using

Useful settings to know:
- `contextWatcher.activeModelId`
- `contextWatcher.activeBrainPath`
- `contextWatcher.includeBrainArtifactsInEstimate`
- `contextWatcher.extraWatchPaths`
- `contextWatcher.compactorTokenLimit`
- `contextWatcher.refreshIntervalMs`
- `contextWatcher.fullRefreshIntervalMs`

Recommended initial settings:

```json
{
  "contextWatcher.includeBrainArtifactsInEstimate": true,
  "contextWatcher.refreshIntervalMs": 30000,
  "contextWatcher.fullRefreshIntervalMs": 300000
}
```

Use `contextWatcher.activeBrainPath` only if auto-detection picks the wrong session and you want to pin one specific brain directory.

### 6.1 Per-model effective budget overrides

If Antigravity gives a model less context than the provider technically supports, set the effective limits manually.

Recommended path:

1. Run `Context Watcher: Copy Model Budget Override Template`.
2. Open your Antigravity settings JSON.
3. Paste the copied snippet.
4. Edit the values for the models you care about.

Use `contextWatcher.modelBudgetOverrides` for this.

Example:

```json
{
  "contextWatcher.modelBudgetOverrides": {
    "gemini-3-flash": {
      "effectiveMaxInputTokens": 256000,
      "effectiveMaxOutputTokens": 8192
    },
    "claude-sonnet-4-6-thinking": {
      "effectiveContextTokens": 200000,
      "effectiveMaxOutputTokens": 64000,
      "reservedOutputTokens": 16000
    }
  }
}
```

Notes:
- use `effectiveMaxInputTokens` and `effectiveMaxOutputTokens` for separate-budget models like Gemini
- use `effectiveContextTokens`, `effectiveMaxOutputTokens`, and optionally `reservedOutputTokens` for combined-budget models like Claude
- these values are watcher-side effective limits, not provider marketing limits

## 7. Real-World Test Flow

Use this sequence for the first real test.

### 7.1 Start or continue a real Antigravity chat

Open a real project in Antigravity and do actual work with the agent so Antigravity writes files under:

```bash
~/.gemini/antigravity/brain
```

### 7.2 Confirm the status bar appears

Expected:
- if no model is selected, status bar should show `AG: Pick Model`
- after model selection, it should show something like `AG Est. 4.3k / 168.0k (3%)`

### 7.3 Open the breakdown

Run:

```text
Context Watcher: Show Breakdown
```

Expected:
- selected model is shown
- active session path is shown
- estimated tracked tokens is non-zero once the session has brain files
- counted files list includes the files actually being counted

### 7.4 Force a refresh

Run:

```text
Context Watcher: Refresh
```

Expected:
- status bar updates immediately
- if Antigravity wrote more session data, the token count should go up or stay stable, not jump randomly

### 7.5 Copy the new-chat handoff

Run:

```text
Context Watcher: Copy New Chat Handoff
```

Expected:
- clipboard now contains a continuation prompt
- prompt includes:
  - selected model label
  - estimated retained context
  - last updated timestamp
  - tracked context sections with file paths

### 7.6 Continue in a new Antigravity chat

Open a new chat and paste the copied handoff prompt.

Expected:
- the new chat should have enough context to continue the task
- the pasted prompt should mention current objective, touched files, and next steps

## 8. What To Test

Focus on these core cases first.

### Case 1: Manual model selection is the source of truth

Steps:
1. Pick `Claude Opus 4.6 (Thinking)`.
2. Note the denominator in the status bar.
3. Switch to `Gemini 3.1 Pro (High)`.
4. Note the denominator again.

Expected:
- denominator changes when the selected model changes
- if no model is selected, extension should not silently fall back to some other model

### Case 2: Auto-detected session is correct

Steps:
1. Make one Antigravity session active.
2. Run `Context Watcher: Show Breakdown`.
3. Compare the shown session path with the latest directory under `~/.gemini/antigravity/brain`.

Expected:
- the path should match the currently active or most recently updated session

If not:
- set `contextWatcher.activeBrainPath` manually and retest

### Case 3: Core brain artifacts are counted

Steps:
1. Check the breakdown file list.
2. Verify that files like these appear when present:
   - `task.md`
   - `implementation_plan.md`
   - `analysis_report.md`
   - `walkthrough.md`

Expected:
- these files appear under `brainArtifact`
- estimated token count is greater than zero for an active session

### Case 4: Workspace instructions are counted

Steps:
1. Add or edit `GEMINI.md` in the workspace.
2. Optionally add notes under `.agent/`.
3. Refresh.

Expected:
- count goes up
- breakdown shows `workspaceInstructions` and `agentMemory`

### Case 5: Summary prompt is usable

Steps:
1. Copy the new-chat handoff.
2. Paste into a new Antigravity chat.
3. Ask the agent to continue the exact task.

Expected:
- the agent can continue with the same objective
- the summary is readable and contains the important files and decisions

### Case 6: Pinned session path works

Steps:
1. Set `contextWatcher.activeBrainPath` to a specific session directory.
2. Refresh.

Expected:
- breakdown shows that exact session path
- count is stable even if another Antigravity session becomes newer

## 9. What Good Results Look Like

The MVP is behaving correctly if:
- the extension loads in Antigravity without errors
- the status bar appears reliably
- model selection is explicit
- the active session path is correct
- the estimate is stable and understandable
- the breakdown lists the actual counted files
- the copied summary is useful in a new chat

## 10. Failure Checklist

If the extension appears but the count is `0`:
- confirm a real Antigravity session exists under `~/.gemini/antigravity/brain`
- confirm `contextWatcher.includeBrainArtifactsInEstimate` is `true`
- open the breakdown and inspect the counted files list
- set `contextWatcher.activeBrainPath` to a known session directory

If the extension follows the wrong chat after a tab switch:
- run `Context Watcher: Pick Active Session`
- pin the exact chat you want to track
- use `Context Watcher: Clear Pinned Session` to return to auto-detection
- open diagnostics and check whether `Resolution source` is `Visible Antigravity tab` or `Configured brain path`

If the extension does not load:
- run `antigravity --list-extensions --show-versions | rg antigravity-context-watcher`
- verify the installed folder name or VSIX install
- restart Antigravity fully

If the wrong model budget is shown:
- run `Context Watcher: Pick Model Profile`
- verify `contextWatcher.activeModelId`

If the copied summary is too long or too short:
- adjust `contextWatcher.compactorTokenLimit`

## 11. Useful Commands

List installed extensions:

```bash
~/.antigravity/antigravity/bin/antigravity --list-extensions --show-versions
```

Package VSIX:

```bash
cd /Users/mirolim/projects/antigravity_context_watcher
npx @vscode/vsce package --allow-missing-repository
```

Install VSIX:

```bash
~/.antigravity/antigravity/bin/antigravity \
  --install-extension /Users/mirolim/projects/antigravity_context_watcher/antigravity-context-watcher-0.0.8.vsix
```

Run an isolated Antigravity instance for testing:

```bash
~/.antigravity/antigravity/bin/antigravity \
  --user-data-dir /tmp/ag-user-test \
  --extensions-dir /tmp/ag-exts-test \
  /path/to/project
```

## 12. Recommended First Acceptance Pass

Use this exact pass for the first real validation:

1. Install with the isolated local-folder method.
2. Open a real project in Antigravity.
3. Start a real Antigravity task so a brain session is written.
4. Pick the exact model profile you are using.
5. If auto-detection picks the wrong chat, run `Context Watcher: Pick Active Session`.
6. Confirm the status bar shows a non-zero estimate.
7. Open the breakdown and verify the counted files or live usage section.
8. Copy the new-chat handoff.
9. Paste it into a fresh chat and continue the same task.

If those 9 steps work, the MVP is doing its core job.

## 13. Token Validation Pass

Use a fresh chat so the deltas stay easy to interpret.

1. Pick the correct model profile.
2. If needed, pin the chat with `Context Watcher: Pick Active Session`.
3. Send this prompt:

```text
Reply with exactly 200 lines.
Each line must be:
Line N: apple banana cherry delta echo foxtrot golf hotel india juliet kilo lima
Replace N with the line number from 1 to 200.
No intro. No outro.
```

4. Refresh and note:
- `Latest generation output tokens`
- `Retained context after latest generation`

5. Send this prompt:

```text
Reply with exactly: OK
```

6. Refresh again and verify:
- `Latest generation output tokens` is now very small
- `Latest generation input tokens` remains large because the previous 200-line answer is now retained context
- `Cache read tokens` or `uncached input tokens` increases relative to a fresh chat

This validates that the watcher is following retained-context growth in the right direction, even though provider-exact tokenization can still vary by backend and caching behavior.

## 14. Concrete Gemini 3 Flash Scenario

Use this when you want one repeatable multi-step test with clear expected trends.

### 14.1 Why use Gemini 3 Flash

- it is fast, so you can run several turns quickly
- it has a very large input budget, so the session should not hit limits during the test
- because the input budget is about `1,000,000`, the status-bar percent may stay at `0%` or `1%`

For this scenario, compare absolute fields, not the status-bar percentage.

### 14.2 Setup

1. Start a fresh Antigravity chat.
2. In Context Watcher, run `Pick Model Profile`.
3. Select `Gemini 3 Flash`.
4. If needed, run `Pick Active Session` and pin the fresh chat.
5. Open `Show Diagnostics` once and note these baseline fields:
- `Detected live model`
- `Session id`
- `Resolution source`
- `Usage source`
- `Retained context tokens`
- `Decoded recent live-step tokens`
- `Retained tokens not explained by decoded live steps`
- `Latest generation input tokens`
- `Latest generation output tokens`

Expected baseline:
- `Detected live model` should be `Gemini 3 Flash`
- `Usage source` should ideally be `Live Antigravity generator metadata`
- `Retained context tokens` may already be large, sometimes tens of thousands of tokens
- do not assume a fresh visible chat means near-zero retained context
- Antigravity can preload hidden workspace, system, retrieved, and cached context before the visible chat grows

### 14.3 Fresh-chat hidden preload sanity check

Send this prompt:

```text
hi
```

If the reply already references your project or ongoing task, Antigravity is injecting hidden context before you provide any meaningful visible chat history.

After it finishes, refresh and compare:
- `Retained context tokens`
- `Decoded recent live-step tokens`
- `Retained tokens not explained by decoded live steps`

Expected watcher behavior:
- `Retained context tokens` can already be very large
- `Decoded recent live-step tokens` can stay tiny
- `Retained tokens not explained by decoded live steps` can dominate the total

Real observation from March 25, 2026:
- a fresh `Gemini 3 Flash` chat that only received `hi` reported `42409` retained tokens
- only one decoded visible response step was surfaced, at `57` tokens
- this is strong evidence that Antigravity preloads substantial hidden context by default

### 14.4 Prompt 1: Force a medium-sized deterministic output

Send this prompt:

```text
Reply with exactly 120 lines.
Each line must be in this format:
Line N: alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu
Replace N with the line number from 1 to 120.
No intro.
No outro.
No blank lines.
```

Expected model output:
- exactly 120 lines
- each line follows the requested template
- no extra explanation before or after

After it finishes, run `Context Watcher: Refresh` and compare:
- `Latest generation output tokens`
- `Latest generation input tokens`
- `Retained context after latest generation`

Expected watcher behavior:
- `Latest generation output tokens` should be clearly non-trivial and much larger than a short reply
- `Latest generation input tokens` may already be large because a fresh Antigravity chat can start with hidden retained context
- compare Prompt 1 against the fresh-chat baseline, not against zero
- `Retained context after latest generation` should jump up noticeably from baseline

### 14.5 Prompt 2: Tiny reply to prove prior output is now retained context

Send this prompt:

```text
Reply with exactly: OK
```

Expected model output:
- exactly `OK`

Refresh again and compare against Prompt 1.

Expected watcher behavior:
- `Latest generation output tokens` should now be tiny
- `Latest generation input tokens` should be much larger than Prompt 1 because the 120-line answer is now part of retained context
- `Retained context after latest generation` should stay at least as high as after Prompt 1, and usually rise a bit more

### 14.6 Prompt 3: Summarize prior content briefly

Send this prompt:

```text
Summarize the 120-line output from earlier into exactly 8 bullets.
Each bullet must be under 12 words.
Do not quote full lines.
```

Expected model output:
- exactly 8 bullets
- compact summary language
- much shorter than Prompt 1 output

Refresh again and compare against Prompt 2.

Expected watcher behavior:
- `Latest generation output tokens` should be larger than Prompt 2 and much smaller than Prompt 1
- `Latest generation input tokens` should remain high because the earlier large output is still in context
- `Retained context after latest generation` should increase again

### 14.7 What to compare after each turn

Record these fields in a small table:

- `Detected live model`
- `Session id`
- `Resolution source`
- `Usage source`
- `Decoded recent live-step tokens`
- `Retained tokens not explained by decoded live steps`
- `Latest generation input tokens`
- `Latest generation output tokens`
- `Retained context after latest generation`
- `Conversation file size`

Healthy result pattern:

- `Session id` stays the same for all three prompts
- `Detected live model` stays `Gemini 3 Flash`
- `Latest generation output tokens` follows this pattern:
  - Prompt 1: high
  - Prompt 2: very low
  - Prompt 3: medium
- `Latest generation input tokens` follows this pattern:
  - Prompt 1: can already be high even in a fresh visible chat
  - Prompt 2: similar to or higher than Prompt 1
  - Prompt 3: similar to or higher than Prompt 2
- `Retained context after latest generation` should be monotonic:
  - Prompt 1 < Prompt 2 <= Prompt 3
- `Retained tokens not explained by decoded live steps` can remain large for the whole run
- `Conversation file size` should grow after each prompt

### 14.8 What does not need to match exactly

Do not expect exact token counts from the written prompt alone.

These values can vary by backend behavior:
- tokenizer details
- provider-side prompt framing
- cached prompt reads
- hidden system/tool instructions
- workspace and retrieved context Antigravity injects before or between visible turns

For Gemini 3 Flash, the test is successful if the watcher shows the correct directional changes across the three turns.
