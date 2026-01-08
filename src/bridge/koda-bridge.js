/**
 * KODA ACP Bridge - двунаправленный ACP прокси к KODA CLI
 * Оптимизирован для минимальной латентности
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { AGENT, TIMEOUTS } from "../config/constants.js";

/**
 * KODA ACP Bridge - связь с KODA CLI через stdio
 */
export class KodaAcpBridge {
  /**
   * @param {Object} config - Server configuration
   * @param {Object} [callbacks={}] - Event callbacks
   */
  constructor(config, callbacks = {}) {
    this.config = config;
    this.onMessage = callbacks.onMessage || (() => {});
    this.onClose = callbacks.onClose || (() => {});
    this.onError = callbacks.onError || ((err) => console.error(err));

    this.process = null;
    this.pendingRequests = new Map();
    this.requestIdCounter = 1;
    this.initialized = false;
    this.kodaSessionId = null;

    // Buffer for incomplete JSON lines
    this._buffer = "";
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
   */
  async spawn(cwd, options = {}) {
    const args = ["--experimental-acp", "--approval-mode", "yolo"];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (this.config.extraArgs?.length) {
      args.push(...this.config.extraArgs);
    }

    this.debugLog(
      "Spawning KODA CLI:",
      this.config.kodaCommand,
      args.join(" ")
    );

    this.process = spawn(this.config.kodaCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: {
        ...process.env,
        NO_COLOR: "1",
        // Disable buffering in child process
        PYTHONUNBUFFERED: "1",
        NODE_OPTIONS: "--no-warnings",
      },
    });

    // Direct stream parsing - faster than readline
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => this._handleChunk(chunk));

    this.process.stderr.on("data", (chunk) => {
      if (this.config.debug) {
        process.stderr.write(`[KODA stderr] ${chunk}`);
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
   * Обработка входящих данных - прямой парсинг без readline
   * @private
   */
  _handleChunk(chunk) {
    this._buffer += chunk;

    // Process complete lines
    let newlineIndex;
    while ((newlineIndex = this._buffer.indexOf("\n")) !== -1) {
      const line = this._buffer.slice(0, newlineIndex).trim();
      this._buffer = this._buffer.slice(newlineIndex + 1);

      if (line) {
        try {
          const message = JSON.parse(line);
          // Use setImmediate to not block the event loop
          setImmediate(() => this.handleMessage(message));
        } catch {
          this.debugLog("Failed to parse JSON:", line.slice(0, 100));
        }
      }
    }
  }

  /**
   * Инициализировать ACP соединение
   * @private
   */
  async initialize() {
    const { PROTOCOL_VERSION } = await import("@agentclientprotocol/sdk");

    const response = await this.sendRequest("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
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

    // Auto-skip authentication
    if (response.authMethods?.length > 0) {
      const skipMethod = response.authMethods.find((m) => m.id === "skip");
      if (skipMethod) {
        this.debugLog("Skipping authentication");
        try {
          await this.sendRequest("authenticate", { methodId: "skip" });
        } catch {
          // Ignore skip auth errors
        }
      }
    }

    return response;
  }

  /**
   * Аутентифицировать в KODA CLI
   */
  async authenticate(methodId = "github") {
    this.debugLog(`Authenticating with method: ${methodId}`);
    const response = await this.sendRequest("authenticate", { methodId });
    this.debugLog("Authentication successful");
    return response;
  }

  /**
   * Создать новую сессию
   */
  async createSession(cwd, mcpServers = []) {
    const response = await this.sendRequest("session/new", { cwd, mcpServers });
    this.kodaSessionId = response.sessionId;
    this.debugLog("Session created:", this.kodaSessionId);
    return response;
  }

  /**
   * Отправить prompt
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
   * Отменить операцию
   */
  sendCancel() {
    if (!this.kodaSessionId) return;
    this.sendNotification("session/cancel", { sessionId: this.kodaSessionId });
  }

  /**
   * Отправить запрос и ждать ответа
   */
  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.requestIdCounter++;
      this.pendingRequests.set(id, { resolve, reject });
      this._write({ jsonrpc: "2.0", id, method, params });
    });
  }

  /**
   * Отправить нотификацию
   */
  sendNotification(method, params) {
    this._write({ jsonrpc: "2.0", method, params });
  }

  /**
   * Отправить ответ
   */
  sendResponse(id, result, error = null) {
    const message = error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result };
    this._write(message);
  }

  /**
   * Записать сообщение - оптимизировано
   * @private
   */
  _write(message) {
    if (!this.process?.stdin?.writable) return;
    // Direct write without try-catch overhead for hot path
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }

  /**
   * Обработать сообщение
   * @private
   */
  handleMessage(message) {
    this.debugLog("Received:", JSON.stringify(message).slice(0, 200));

    // Response to our request
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

    // Notification or request from KODA CLI
    this.onMessage(message);
  }

  /**
   * Завершить процесс
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
   * Проверить статус
   */
  isRunning() {
    return this.process && !this.process.killed;
  }
}
