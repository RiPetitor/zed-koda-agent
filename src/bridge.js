/**
 * KODA ACP Bridge - двунаправленный ACP прокси к KODA CLI
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

const KILL_TIMEOUT_MS = 5000;
const AGENT_NAME = "koda_agent";
const AGENT_TITLE = "KODA Agent";
const AGENT_VERSION = "0.2.0";

export class KodaAcpBridge {
  constructor(config, callbacks = {}) {
    this.config = config;
    this.onMessage = callbacks.onMessage || (() => {});
    this.onClose = callbacks.onClose || (() => {});
    this.onError = callbacks.onError || ((err) => console.error(err));
    this.process = null;
    this.pendingRequests = new Map();
    this.requestIdCounter = 1;
    this.readline = null;
    this.initialized = false;
    this.kodaSessionId = null;
  }

  /**
   * Spawn KODA CLI in ACP mode
   */
  async spawn(cwd, options = {}) {
    const args = [
      "--experimental-acp",
      "--approval-mode",
      "yolo", // We handle permissions ourselves
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (this.config.extraArgs?.length) {
      args.push(...this.config.extraArgs);
    }

    this.config.debug &&
      console.error(
        "[Bridge] Spawning KODA CLI:",
        this.config.kodaCommand,
        args.join(" "),
      );

    this.process = spawn(this.config.kodaCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    });

    // Set up ndjson line reader for stdout
    this.readline = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });

    this.readline.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (e) {
        // Ignore non-JSON lines (could be debug output)
        this.config.debug &&
          console.error("[Bridge] Failed to parse JSON:", line.slice(0, 100));
      }
    });

    // Handle stderr (for debugging and auth URLs)
    this.process.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (this.config.debug) {
        process.stderr.write(`[KODA stderr] ${text}`);
      }
      // Check for auth URL and try to open browser
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        this.config.debug &&
          console.error(`[Bridge] Found URL: ${urlMatch[0]}`);
      }
    });

    // Handle process close
    this.process.on("close", (code, signal) => {
      this.config.debug &&
        console.error(
          `[Bridge] KODA process closed: code=${code}, signal=${signal}`,
        );
      this.onClose(code, signal);
    });

    this.process.on("error", (error) => {
      this.config.debug &&
        console.error("[Bridge] Process error:", error.message);
      this.onError(error);
      this.onClose(1, error.message);
    });

    // Initialize connection with KODA CLI
    await this.initialize();
  }

  /**
   * Initialize ACP connection with KODA CLI
   */
  async initialize() {
    const { PROTOCOL_VERSION } = await import("@agentclientprotocol/sdk");

    const response = await this.sendRequest("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      },
      clientInfo: {
        name: AGENT_NAME,
        title: AGENT_TITLE,
        version: AGENT_VERSION,
      },
    });

    this.initialized = true;
    this.config.debug && console.error("[Bridge] Initialized successfully");

    // Auto-skip authentication on init (user can auth later via /auth)
    if (response.authMethods?.length > 0) {
      const skipMethod = response.authMethods.find((m) => m.id === "skip");
      if (skipMethod) {
        this.config.debug &&
          console.error("[Bridge] Skipping authentication for now");
        try {
          await this.sendRequest("authenticate", { methodId: "skip" });
        } catch (e) {
          this.config.debug &&
            console.error("[Bridge] Skip auth failed:", e.message);
        }
      }
    }

    return response;
  }

  /**
   * Authenticate with KODA CLI
   */
  async authenticate(methodId = "github") {
    this.config.debug &&
      console.error(`[Bridge] Authenticating with method: ${methodId}`);
    try {
      const response = await this.sendRequest("authenticate", { methodId });
      this.config.debug && console.error("[Bridge] Authentication successful");
      return response;
    } catch (error) {
      this.config.debug &&
        console.error(`[Bridge] Authentication failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a new session in KODA CLI
   */
  async createSession(cwd, mcpServers = []) {
    const response = await this.sendRequest("session/new", {
      cwd,
      mcpServers,
    });
    this.kodaSessionId = response.sessionId;
    this.config.debug &&
      console.error("[Bridge] Session created:", this.kodaSessionId);
    return response;
  }

  /**
   * Send prompt to KODA CLI
   */
  async sendPrompt(prompt) {
    if (!this.kodaSessionId) {
      throw new Error("Session not created");
    }

    return this.sendRequest("session/prompt", {
      sessionId: this.kodaSessionId,
      prompt,
    });
  }

  /**
   * Cancel current operation
   */
  sendCancel() {
    if (!this.kodaSessionId) return;

    this.sendNotification("session/cancel", {
      sessionId: this.kodaSessionId,
    });
  }

  /**
   * Send request to KODA CLI and wait for response
   */
  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.requestIdCounter++;
      this.pendingRequests.set(id, { resolve, reject });

      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.writeMessage(message);
    });
  }

  /**
   * Send notification to KODA CLI (no response expected)
   */
  sendNotification(method, params) {
    const message = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.writeMessage(message);
  }

  /**
   * Send response to KODA CLI request
   */
  sendResponse(id, result, error = null) {
    const message = error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result };
    this.writeMessage(message);
  }

  /**
   * Write JSON message to KODA CLI stdin
   */
  writeMessage(message) {
    if (!this.process?.stdin?.writable) {
      this.config.debug && console.error("[Bridge] stdin not writable");
      return;
    }
    try {
      this.process.stdin.write(JSON.stringify(message) + "\n");
    } catch (error) {
      this.config.debug &&
        console.error("[Bridge] Write error:", error.message);
    }
  }

  /**
   * Handle incoming message from KODA CLI
   */
  handleMessage(message) {
    this.config.debug &&
      console.error(
        "[Bridge] Received:",
        JSON.stringify(message).slice(0, 200),
      );

    // Handle response to our request
    if (
      message.id !== undefined &&
      (message.result !== undefined || message.error)
    ) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message || "Unknown error"));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Handle notification or request from KODA CLI
    this.onMessage(message);
  }

  /**
   * Kill the KODA CLI process
   */
  kill() {
    if (this.process) {
      this.process.kill("SIGTERM");
      setTimeout(() => {
        if (this.process) {
          this.process.kill("SIGKILL");
        }
      }, KILL_TIMEOUT_MS);
    }
  }

  /**
   * Check if process is running
   */
  isRunning() {
    return this.process && !this.process.killed;
  }
}
