"use strict";

const path = require("path");
const { Worker } = require("worker_threads");

class FilesystemWorkerClient {
  constructor() {
    this.worker = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.startupError = null;
  }

  ensureWorker() {
    if (this.worker || this.startupError) {
      return this.worker;
    }

    try {
      this.worker = new Worker(path.join(__dirname, "filesystemWorkerThread.js"));
      this.worker.on("message", (message) => {
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.id);
        if (message.ok) {
          pending.resolve(message.result);
          return;
        }
        pending.reject(new Error(message.error || "Filesystem worker request failed."));
      });
      this.worker.on("error", (error) => {
        this.startupError = error;
        for (const pending of this.pending.values()) {
          pending.reject(error);
        }
        this.pending.clear();
      });
      this.worker.on("exit", (code) => {
        this.worker = null;
        if (code !== 0) {
          const error = new Error(`Filesystem worker exited with code ${code}.`);
          this.startupError = error;
          for (const pending of this.pending.values()) {
            pending.reject(error);
          }
          this.pending.clear();
        }
      });
    } catch (error) {
      this.startupError = error;
    }

    return this.worker;
  }

  request(method, payload) {
    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.reject(this.startupError || new Error("Filesystem worker unavailable."));
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, payload });
    });
  }

  resolveActiveBrainTarget(activeBrainPath, workspaceFolderPaths) {
    return this.request("resolveActiveBrainTarget", {
      activeBrainPath,
      workspaceFolderPaths
    });
  }

  buildArtifactRegistry(brainDir, includeBrainArtifacts, extraWatchPaths, workspaceFolderPaths) {
    return this.request("buildArtifactRegistry", {
      brainDir,
      includeBrainArtifacts,
      extraWatchPaths,
      workspaceFolderPaths
    });
  }

  async dispose() {
    const worker = this.worker;
    this.worker = null;
    if (!worker) {
      return;
    }
    try {
      await worker.terminate();
    } catch (_error) {
      // Ignore shutdown errors on dispose.
    }
  }
}

module.exports = {
  FilesystemWorkerClient
};
