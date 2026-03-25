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
- detects the most recent Antigravity brain session under `~/.gemini/antigravity/brain`
- estimates retained context from tracked text artifacts
- shows the estimate in the status bar
- shows a breakdown document
- copies a new-chat handoff prompt to the clipboard

It does not do these things:
- it does not read an exact provider-side prompt transcript
- it does not track streaming output live
- it does not compact the current chat automatically

The estimate currently counts:
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
ln -s /Users/mirolim/projects/antigravity_context_watcher /tmp/ag-exts-test/local.antigravity-context-watcher-0.0.1
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
local.antigravity-context-watcher@0.0.1
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
  ~/.antigravity/extensions/local.antigravity-context-watcher-0.0.1
```

### 4.2 Verify installation

```bash
~/.antigravity/antigravity/bin/antigravity --list-extensions --show-versions | rg antigravity-context-watcher
```

Expected result:

```text
local.antigravity-context-watcher@0.0.1
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
antigravity-context-watcher-0.0.1.vsix
```

### 5.2 Install the VSIX

```bash
~/.antigravity/antigravity/bin/antigravity \
  --install-extension /Users/mirolim/projects/antigravity_context_watcher/antigravity-context-watcher-0.0.1.vsix
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

Recommended initial settings:

```json
{
  "contextWatcher.includeBrainArtifactsInEstimate": true,
  "contextWatcher.refreshIntervalMs": 3000
}
```

Use `contextWatcher.activeBrainPath` only if auto-detection picks the wrong session and you want to pin one specific brain directory.

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

### 7.5 Copy the new-chat summary

Run:

```text
Context Watcher: Copy New Chat Summary
```

Expected:
- clipboard now contains a continuation prompt
- prompt includes:
  - selected model label
  - estimated retained context
  - last updated timestamp
  - tracked context sections with file paths

### 7.6 Continue in a new Antigravity chat

Open a new chat and paste the copied summary prompt.

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
1. Copy new-chat summary.
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
  --install-extension /Users/mirolim/projects/antigravity_context_watcher/antigravity-context-watcher-0.0.1.vsix
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
5. Confirm the status bar shows a non-zero estimate.
6. Open the breakdown and verify the counted files.
7. Copy the new-chat summary.
8. Paste it into a fresh chat and continue the same task.

If those 8 steps work, the MVP is doing its core job.
