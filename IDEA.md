## Problim:
Search information on antigravity ide from Google and existing extensions and new new can be made it is based on vscode.
The main issue I got is no way to see actual context size of model, how much already used in particular chat and summarize it. It makes using it harder because of the context fills up, model response become dumb and can't now when to switch or summarize chat.
Find extension which solve this problem or think how to create one.

## Possible solution proposed by Gemini 3.1Pro
Running blind on context size in an AI-driven environment is a fast track to degraded model performance. When the context window maxes out, the AI loses the plot, starts hallucinating, or drops crucial architectural details. Antigravity IDE is powerful with its multi-agent orchestration and local `.agent` memory system, but native, granular token visibility is currently a weak point.

Here are the existing extensions that tackle this issue, followed by a blueprint on how to build a custom solution that tracks and actively manages your context.

### Existing Extensions to Fix Context Blindness

**1. Toolkit for Antigravity (by n2ns)**
This is the closest community-built solution tailored specifically for the Antigravity IDE ecosystem.
* **What it does:** Adds a performance dashboard and a status bar indicator for your AI operations.
* **Key Features:** It tracks your API quota, but crucially, it monitors your "Brain Tasks" and cache size. You can see the exact size of your conversation caches and clear them to instantly free up memory.
* **The Catch:** It focuses heavily on cache size and quotas rather than a live, token-by-token countdown inside the editor view.

**2. Claude Context Bar**
If you are utilizing Claude Sonnet 4.6 within Antigravity, you can leverage extensions built for the Claude ecosystem.
* **What it does:** Injects a real-time context window percentage directly into your status bar.
* **Key Features:** It reads the background JSONL logs to give you an accurate token count and auto-detects the context limit of the active model. It features color-coded warnings (Yellow at 50%, Red at 75%) so you know exactly when to start wrapping up a chat.

**3. Tokenlint**
A highly accurate, general-purpose token counter that integrates perfectly into VS Code forks.
* **What it does:** Delivers real-time token counts for open files, workspaces, or selected text blocks.
* **Key Features:** It helps you manually gauge exactly how much context you are feeding the agent *before* you execute a command, preventing accidental context-bloat.

---

### How to Build a Custom Context Tracker & Summarizer

If the off-the-shelf tools don't fit your exact workflow, building a custom extension is the right move. Since Antigravity is a direct fork of Visual Studio Code, you have full access to the VS Code Extension API. 

Here is the technical blueprint to build an extension that tracks tokens and automatically summarizes bloated chats:

**Step 1: The Core Mechanism (File Watching)**
Antigravity stores its persistent context in the local project directory (specifically inside the `.agent/` workspace folder) and in local temporary chat logs. Your extension needs to initialize a file watcher (`vscode.workspace.createFileSystemWatcher`) that monitors these specific files for changes every time the AI generates a response.

**Step 2: Live Tokenization**
Instead of guessing context based on file size, integrate an open-source tokenizer library directly into your extension. Every time the tracked files update, the extension tokenizes the raw text and calculates the exact usage against the active model's limit (e.g., 200k for Claude, or the massive 1M+ for Gemini 3.1 Pro).

**Step 3: The Status Bar UI**
Inject a dynamic indicator into the VS Code Status Bar using `vscode.window.createStatusBarItem()`.
* Make it actionable: `🟢 45k / 200k Tokens`.
* Clicking the status bar item should trigger a command that opens a webview panel, breaking down exactly what is eating the context (e.g., "Chat History: 30k tokens", "Workspace Files: 15k tokens").

**Step 4: The Auto-Summarizer (The Fix)**
This is where you solve the "dumb model" problem. Register a command (`vscode.commands.registerCommand`) called "Compact Context."
* **The Trigger:** You can run this manually, or have the extension trigger it automatically when context hits an 85% threshold.
* **The Execution:** The extension pulls the raw conversation log and sends a background API call to a cheaper, lightning-fast model (like Gemini 3 Flash) with a strict system prompt: *"Summarize this developer conversation. Retain all code snippets, architectural decisions, and current objectives. Discard pleasantries, false starts, and resolved debugging steps."*
* **The Result:** The extension overwrites the bloated chat log with this dense, information-rich summary. You instantly free up the context window while keeping the primary AI agent focused and intelligent.