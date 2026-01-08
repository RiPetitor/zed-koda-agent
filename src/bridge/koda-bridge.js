/**
 * KODA ACP Bridge - двунаправленный ACP прокси к KODA CLI
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";
import { AGENT, TIMEOUTS } from "../config/constants.js";

/**
 * KODA ACP Bridge - связь с KODA CLI через stdio
 */
export class KodaAcpBridge {
  /**
   * @param {Object} config - Server configuration
   * @param {Object} [callbacks={}] - Event callbacks
   * @param {Function} [callbacks.onMessage] - Message handler
   * @param {Function} [callbacks.onClose] - Close handler
   * @param {Function} [callbacks.onError] - Error handler
   */
  constructor(config, callbacks = {}) {
    /** @type {Object} */
    this.config = config;

    /** @type {Function} */
    this.onMessage = callbacks.onMessage || (() => {});

    /** @type {Function} */
    this.onClose = callbacks.onClose || (() => {});

    /** @type {Function} */
    this.onError = callbacks.onError || ((err) => console.error(err));

    /** @type {ChildProcess|null} */
    this.process = null;

    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    this.pendingRequests = new Map();

    /** @type {number} */
    this.requestIdCounter = 1;

    /** @type {readline.Interface|null} */
    this.readline = null;

    /** @type {boolean} */
    this.initialized = false;

    /** @type {string|null} */
    this.kodaSessionId = null;
  }

  /**
   * @private
   */
  debugLog(...args) {
    if (this.config.debug) {
      console.error("[Bridge]", ...args);
    }
  }

  /**
   * Запустить KODA CLI в ACP режиме
   * @param {string} cwd - Working directory
   * @param {Object} [options={}]
   * @param {string} [options.model] - Model to use
   * @returns {Promise<void>}
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

    this.debugLog("Spawning KODA CLI:", this.config.kodaCommand, args.join(" "));

    this.process = spawn(this.config.kodaCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    });

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
        this.debugLog("Failed to parse JSON:", line.slice(0, 100));
      }
    });

    this.process.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (this.config.debug) {
        process.stderr.write(`[KODA stderr] ${text}`);
      }
    });

    this.process.on("close", (code, signal) => {
      this.debugLog(`KODA process closed: code=${code}, signal=${signal}`);
      this.onClose(code, signal);
    });

    this.process.on("error", (error) => {
      this.debugLog("Process error:", error.message);
      this.onError(error);
      this.onClose(1, error.message);
    });

    await this.initialize();
  }

  /**
   * Инициализировать ACP соединение
   * @private
   * @returns {Promise<Object>}
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
        name: AGENT.NAME,
        title: AGENT.TITLE,
        version: AGENT.VERSION,
      },
    });

    this.initialized = true;
    this.debugLog("Initialized successfully");

    // Auto-skip authentication on init
    if (response.authMethods?.length > 0) {
      const skipMethod = response.authMethods.find((m) => m.id === "skip");
      if (skipMethod) {
        this.debugLog("Skipping authentication for now");
        try {
          await this.sendRequest("authenticate", { methodId: "skip" });
        } catch (e) {
          this.debugLog("Skip auth failed:", e.message);
        }
      }
    }

    return response;
  }

  /**
   * Аутентифицировать в KODA CLI
   * @param {string} [methodId="github"]
   * @returns {Promise<Object>}
   */
  async authenticate(methodId = "github") {
    this.debugLog(`Authenticating with method: ${methodId}`);
    try {
      const response = await this.sendRequest("authenticate", { methodId });
      this.debugLog("Authentication successful");
      return response;
    } catch (error) {
      this.debugLog(`Authentication failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Создать новую сессию в KODA CLI
   * @param {string} cwd
   * @param {Array} [mcpServers=[]]
   * @returns {Promise<Object>}
   */
  async createSession(cwd, mcpServers = []) {
    const response = await this.sendRequest("session/new", {
      cwd,
      mcpServers,
    });
    this.kodaSessionId = response.sessionId;
    this.debugLog("Session created:", this.kodaSessionId);
    return response;
  }

  /**
   * Отправить prompt в KODA CLI
   * @param {string|Array} prompt
   * @returns {Promise<Object>}
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
   * Отменить текущую операцию
   */
  sendCancel() {
    if (!this.kodaSessionId) return;

    this.sendNotification("session/cancel", {
      sessionId: this.kodaSessionId,
    });
  }

  /**
   * Отправить запрос и ждать ответа
   * @param {string} method
   * @param {Object} params
   * @returns {Promise<Object>}
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
   * Отправить нотификацию (без ответа)
   * @param {string} method
   * @param {Object} params
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
   * Отправить ответ на запрос KODA CLI
   * @param {number} id
   * @param {Object|null} result
   * @param {Object|null} [error=null]
   */
  sendResponse(id, result, error = null) {
    const message = error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result };
    this.writeMessage(message);
  }

  /**
   * Записать JSON сообщение в stdin KODA CLI
   * @private
   * @param {Object} message
   */
  writeMessage(message) {
    if (!this.process?.stdin?.writable) {
      this.debugLog("stdin not writable");
      return;
    }
    try {
      this.process.stdin.write(JSON.stringify(message) + "\n");
    } catch (error) {
      this.debugLog("Write error:", error.message);
    }
  }

  /**
   * Обработать входящее сообщение от KODA CLI
   * @private
   * @param {Object} message
   */
  handleMessage(message) {
    this.debugLog("Received:", JSON.stringify(message).slice(0, 200));

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
   * Завершить процесс KODA CLI
   */
  kill() {
    if (this.process) {
      this.process.kill("SIGTERM");
      setTimeout(() => {
        if (this.process) {
          this.process.kill("SIGKILL");
        }
      }, TIMEOUTS.KILL_PROCESS_MS);
    }
  }

  /**
   * Проверить, работает ли процесс
   * @returns {boolean}
   */
  isRunning() {
    return this.process && !this.process.killed;
  }
}
