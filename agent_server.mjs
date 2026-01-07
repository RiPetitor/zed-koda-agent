#!/usr/bin/env node
/**
 * KODA Agent Server
 *
 * ACP middleware that runs KODA CLI in ACP mode and provides:
 * - Session modes (Default, Accept Edits, Plan Mode, Don't Ask, Bypass)
 * - Permission handling for write operations
 * - Plan collection in Plan Mode
 * - MCP server synchronization
 */

import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";
import process from "node:process";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_KODA_COMMAND = "koda";
const KILL_TIMEOUT_MS = 5000;
const AGENT_NAME = "koda_agent";
const AGENT_TITLE = "KODA Agent";
const AGENT_VERSION = "0.2.0";

// Debug logging
function debug(...args) {
  if (process.env.KODA_DEBUG === "1" || process.env.KODA_DEBUG === "true") {
    console.error("[KODA Agent]", ...args);
  }
}

// =============================================================================
// Mode Manager
// =============================================================================

class ModeManager {
  static MODES = [
    {
      id: "default",
      name: "Default / По умолчанию",
      description: "Ask permission for all write operations",
    },
    {
      id: "auto_edit",
      name: "Accept Edits / Авто-правки",
      description: "Auto-approve file edits, ask for commands",
    },
    {
      id: "plan",
      name: "Plan Mode / Режим плана",
      description: "Read-only planning, no execution",
    },
    {
      id: "yolo",
      name: "Don't Ask / Без вопросов",
      description: "Auto-approve everything except dangerous commands",
    },
    {
      id: "bypass",
      name: "Bypass / Обход",
      description: "Skip all permission checks",
    },
  ];

  constructor() {
    this.sessionModes = new Map();
  }

  getMode(sessionId) {
    return this.sessionModes.get(sessionId) || "default";
  }

  setMode(sessionId, modeId) {
    if (!ModeManager.MODES.find((m) => m.id === modeId)) {
      throw new Error(`Unknown mode: ${modeId}`);
    }
    this.sessionModes.set(sessionId, modeId);
  }

  getModeConfig() {
    return {
      availableModes: ModeManager.MODES.map((m) => ({
        id: m.id,
        name: m.name,
      })),
      currentModeId: "default",
    };
  }

  deleteSession(sessionId) {
    this.sessionModes.delete(sessionId);
  }
}

// =============================================================================
// Permission Handler
// =============================================================================

class PermissionHandler {
  constructor(connection) {
    this.connection = connection;
    this.alwaysAllowedTypes = new Map(); // sessionId -> Set of tool types
  }

  /**
   * Determine tool type from tool call
   */
  getToolType(toolCall) {
    const kind = toolCall.kind || "other";
    const title = (toolCall.title || "").toLowerCase();

    // Classify by kind first
    if (kind === "read" || kind === "search") return "read";
    if (kind === "edit") return "file_edit";
    if (kind === "delete") return "file_delete";
    if (kind === "execute") {
      // Check for dangerous commands
      const dangerousPatterns = [
        /\brm\s+-rf?\b/,
        /\bsudo\b/,
        /\bchmod\b/,
        /\bchown\b/,
        /\bmkfs\b/,
        /\bdd\b/,
        /\b>\s*\/dev\//,
        /\bformat\b/,
        /\bfdisk\b/,
      ];
      const input = JSON.stringify(toolCall.rawInput || {});
      for (const pattern of dangerousPatterns) {
        if (pattern.test(input)) return "dangerous_command";
      }
      return "command_execute";
    }

    // Fallback to title-based classification
    if (
      title.includes("read") ||
      title.includes("glob") ||
      title.includes("grep")
    ) {
      return "read";
    }
    if (
      title.includes("write") ||
      title.includes("edit") ||
      title.includes("create")
    ) {
      return "file_edit";
    }
    if (title.includes("delete") || title.includes("remove")) {
      return "file_delete";
    }
    if (
      title.includes("bash") ||
      title.includes("command") ||
      title.includes("run")
    ) {
      return "command_execute";
    }

    return "other";
  }

  /**
   * Check if permission is needed based on mode and tool type
   */
  needsPermission(sessionId, mode, toolCall) {
    const toolType = this.getToolType(toolCall);

    // Read operations never need permission
    if (toolType === "read") return false;

    // Bypass mode - no permissions needed
    if (mode === "bypass") return false;

    // Check if always allowed for this session
    const alwaysAllowed = this.alwaysAllowedTypes.get(sessionId);
    if (alwaysAllowed?.has(toolType)) return false;

    // Plan mode - always needs permission (to block execution)
    if (mode === "plan") return true;

    // YOLO mode - only dangerous commands need permission
    if (mode === "yolo") return toolType === "dangerous_command";

    // Auto-edit mode - file edits are auto-approved
    if (mode === "auto_edit") {
      return toolType !== "file_edit";
    }

    // Default mode - all write operations need permission
    return true;
  }

  /**
   * Request permission from user
   */
  async requestPermission(sessionId, toolCall, mode) {
    const toolType = this.getToolType(toolCall);

    // In plan mode, we don't actually request permission - just block
    if (mode === "plan") {
      return { outcome: "blocked", optionId: "plan_blocked" };
    }

    const options = [
      {
        optionId: "allow",
        name: "Allow / Разрешить",
        kind: "allow_once",
      },
      {
        optionId: "allow_always",
        name: "Allow Always / Разрешать всегда",
        kind: "allow_always",
      },
      {
        optionId: "reject",
        name: "Reject / Отклонить",
        kind: "reject_once",
      },
    ];

    try {
      const response = await this.connection.requestPermission({
        sessionId,
        toolCall: {
          toolCallId: toolCall.toolCallId,
          title: toolCall.title,
          kind: toolCall.kind,
          status: toolCall.status,
          locations: toolCall.locations,
          rawInput: toolCall.rawInput,
        },
        options,
      });

      // Handle "Allow Always"
      if (response.outcome.optionId === "allow_always") {
        if (!this.alwaysAllowedTypes.has(sessionId)) {
          this.alwaysAllowedTypes.set(sessionId, new Set());
        }
        this.alwaysAllowedTypes.get(sessionId).add(toolType);
      }

      return response.outcome;
    } catch (error) {
      // If permission request fails, treat as rejected
      return { outcome: "cancelled", optionId: null };
    }
  }

  deleteSession(sessionId) {
    this.alwaysAllowedTypes.delete(sessionId);
  }
}

// =============================================================================
// Plan Collector
// =============================================================================

class PlanCollector {
  constructor() {
    this.plans = new Map(); // sessionId -> PlanEntry[]
  }

  addEntry(sessionId, toolCall) {
    if (!this.plans.has(sessionId)) {
      this.plans.set(sessionId, []);
    }

    const plan = this.plans.get(sessionId);
    plan.push({
      content: toolCall.title || "Unknown action",
      status: "pending",
      priority: toolCall.kind === "execute" ? "high" : "medium",
    });
  }

  getPlan(sessionId) {
    return this.plans.get(sessionId) || [];
  }

  clearPlan(sessionId) {
    this.plans.delete(sessionId);
  }

  deleteSession(sessionId) {
    this.plans.delete(sessionId);
  }
}

// =============================================================================
// KODA ACP Bridge
// =============================================================================

class KodaAcpBridge {
  constructor(config, onMessage, onClose) {
    this.config = config;
    this.onMessage = onMessage;
    this.onClose = onClose;
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
      }
    });

    // Handle stderr (for debugging)
    this.process.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (this.config.debug) {
        process.stderr.write(`[KODA stderr] ${text}`);
      }
    });

    // Handle process close
    this.process.on("close", (code, signal) => {
      this.onClose?.(code, signal);
    });

    this.process.on("error", (error) => {
      this.onClose?.(1, error.message);
    });

    // Initialize connection with KODA CLI
    await this.initialize();
  }

  /**
   * Initialize ACP connection with KODA CLI
   */
  async initialize() {
    const response = await this.sendRequest("initialize", {
      protocolVersion: acp.PROTOCOL_VERSION,
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
    return response;
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
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }

  /**
   * Handle incoming message from KODA CLI
   */
  handleMessage(message) {
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
    this.onMessage?.(message);
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
}

// =============================================================================
// Tool Call Interceptor
// =============================================================================

class ToolCallInterceptor {
  constructor(connection, permissionHandler, modeManager, planCollector) {
    this.connection = connection;
    this.permissionHandler = permissionHandler;
    this.modeManager = modeManager;
    this.planCollector = planCollector;
    this.blockedToolCalls = new Map(); // toolCallId -> toolCall
    this.pendingToolCalls = new Map(); // toolCallId -> toolCall
  }

  /**
   * Process session update from KODA CLI
   * Returns: { forward: boolean, update?: object, blocked?: boolean }
   */
  async processSessionUpdate(sessionId, update) {
    const mode = this.modeManager.getMode(sessionId);

    // Handle tool_call notifications
    if (update.sessionUpdate === "tool_call") {
      return await this.handleToolCall(sessionId, mode, update);
    }

    // Handle tool_call_update notifications
    if (update.sessionUpdate === "tool_call_update") {
      return this.handleToolCallUpdate(sessionId, update);
    }

    // Forward other updates directly
    return { forward: true, update };
  }

  /**
   * Handle new tool call
   */
  async handleToolCall(sessionId, mode, toolCall) {
    const needsPermission = this.permissionHandler.needsPermission(
      sessionId,
      mode,
      toolCall,
    );

    if (!needsPermission) {
      // Auto-approved, forward directly
      this.pendingToolCalls.set(toolCall.toolCallId, toolCall);
      return { forward: true, update: toolCall };
    }

    // In plan mode, collect and block
    if (mode === "plan") {
      this.planCollector.addEntry(sessionId, toolCall);
      this.blockedToolCalls.set(toolCall.toolCallId, toolCall);

      // Send the tool call as "pending" first
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          ...toolCall,
          sessionUpdate: "tool_call",
          status: "pending",
        },
      });

      // Send plan update
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "plan",
          entries: this.planCollector.getPlan(sessionId),
        },
      });

      // Update tool call as blocked
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.toolCallId,
          status: "failed",
          rawOutput: {
            blocked: true,
            reason: "Plan mode - execution blocked",
          },
        },
      });

      return { forward: false, blocked: true };
    }

    // Forward the tool call first (to show in UI as pending)
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        ...toolCall,
        sessionUpdate: "tool_call",
        status: "pending",
      },
    });

    // Request permission
    const outcome = await this.permissionHandler.requestPermission(
      sessionId,
      toolCall,
      mode,
    );

    if (outcome.outcome === "cancelled" || outcome.optionId === "reject") {
      this.blockedToolCalls.set(toolCall.toolCallId, toolCall);

      // Update tool call as rejected
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.toolCallId,
          status: "failed",
          rawOutput: {
            rejected: true,
            reason: "User rejected the operation",
          },
        },
      });

      return { forward: false, blocked: true, rejected: true };
    }

    // Permission granted - the tool call was already forwarded
    this.pendingToolCalls.set(toolCall.toolCallId, toolCall);
    return { forward: false, alreadySent: true };
  }

  /**
   * Handle tool call update
   */
  handleToolCallUpdate(sessionId, update) {
    // If this tool call was blocked, don't forward updates
    if (this.blockedToolCalls.has(update.toolCallId)) {
      return { forward: false };
    }

    // Forward update
    return { forward: true, update };
  }

  /**
   * Clear state for session
   */
  clearSession(sessionId) {
    // Clear blocked and pending tool calls for this session
    // (We don't track by session, so clear all for simplicity)
    this.blockedToolCalls.clear();
    this.pendingToolCalls.clear();
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseArgList(raw) {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fall through
    }
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

function parseServerArgs(argv) {
  let kodaCommand = process.env.KODA_CLI_PATH || DEFAULT_KODA_COMMAND;
  let extraArgs = parseArgList(process.env.KODA_CLI_ARGS || "");
  let defaultMode = process.env.KODA_DEFAULT_MODE || "default";
  let defaultModel = process.env.KODA_DEFAULT_MODEL || "";
  let debug = parseBool(process.env.KODA_DEBUG, false);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--koda-path" && argv[i + 1]) {
      kodaCommand = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--koda-args" && argv[i + 1]) {
      extraArgs = parseArgList(argv[i + 1]);
      i++;
      continue;
    }
    if (arg === "--default-mode" && argv[i + 1]) {
      defaultMode = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--default-model" && argv[i + 1]) {
      defaultModel = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--debug") {
      debug = true;
      continue;
    }
    if (arg === "--help") {
      console.log(`KODA Agent Server

Usage:
  node agent_server.mjs [options]

Options:
  --koda-path <path>      Path to the koda CLI (default: koda)
  --koda-args <args>      Extra args as JSON array or space-separated string
  --default-mode <mode>   Default session mode: default, auto_edit, plan, yolo, bypass
  --default-model <model> Default model to use
  --debug                 Enable debug output

Environment Variables:
  KODA_CLI_PATH           Path to koda binary
  KODA_CLI_ARGS           Extra arguments for KODA CLI
  KODA_DEFAULT_MODE       Default session mode
  KODA_DEFAULT_MODEL      Default model
  KODA_DEBUG              Enable debug mode (1/true)
`);
      process.exit(0);
    }
  }

  return {
    kodaCommand,
    extraArgs,
    defaultMode,
    defaultModel,
    debug,
  };
}

// =============================================================================
// KODA Agent
// =============================================================================

class KodaAgent {
  constructor(connection, config) {
    this.connection = connection;
    this.config = config;
    this.sessions = new Map();
    this.modeManager = new ModeManager();
    this.permissionHandler = new PermissionHandler(connection);
    this.planCollector = new PlanCollector();
    this.interceptor = new ToolCallInterceptor(
      connection,
      this.permissionHandler,
      this.modeManager,
      this.planCollector,
    );
  }

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          embeddedContext: true,
          image: true,
        },
        mcpCapabilities: {},
      },
      agentInfo: {
        name: AGENT_NAME,
        title: AGENT_TITLE,
        version: AGENT_VERSION,
      },
      authMethods: [],
    };
  }

  async newSession(params) {
    const sessionId = randomUUID();
    const cwd = params?.cwd || process.cwd();
    const mcpServers = params?.mcpServers || [];

    // Create KODA CLI bridge for this session
    const kodaBridge = new KodaAcpBridge(
      this.config,
      (message) => this.handleKodaMessage(sessionId, message),
      (code, signal) => this.handleKodaClose(sessionId, code, signal),
    );

    try {
      await kodaBridge.spawn(cwd, {
        model: this.config.defaultModel,
      });

      // Create session in KODA CLI
      await kodaBridge.createSession(cwd, mcpServers);
    } catch (error) {
      throw new Error(`Failed to start KODA CLI: ${error.message}`);
    }

    this.sessions.set(sessionId, {
      kodaBridge,
      cwd,
      pendingPrompt: null,
    });

    this.modeManager.setMode(sessionId, this.config.defaultMode);

    return {
      sessionId,
      modes: this.modeManager.getModeConfig(),
    };
  }

  async authenticate() {
    return {};
  }

  async setSessionMode(params) {
    const { sessionId, modeId } = params;

    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.modeManager.setMode(sessionId, modeId);

    // Clear plan if switching away from plan mode
    if (modeId !== "plan") {
      this.planCollector.clearPlan(sessionId);
    }

    // Notify client about mode change
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: modeId,
      },
    });

    return {};
  }

  async prompt(params) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`);
    }

    // Cancel previous prompt if any
    if (session.pendingPrompt?.abortController) {
      session.pendingPrompt.abortController.abort();
      session.kodaBridge.sendCancel();
    }

    const abortController = new AbortController();
    session.pendingPrompt = { abortController };

    try {
      // Forward prompt to KODA CLI
      const response = await session.kodaBridge.sendPrompt(params.prompt);
      return { stopReason: response.stopReason || "end_turn" };
    } catch (error) {
      if (abortController.signal.aborted) {
        return { stopReason: "cancelled" };
      }

      // Send error message to client
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `\n\nError: ${error.message}`,
          },
        },
      });

      return { stopReason: "end_turn" };
    } finally {
      session.pendingPrompt = null;
    }
  }

  async cancel(params) {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.pendingPrompt?.abortController?.abort();
      session.kodaBridge?.sendCancel();
    }
  }

  /**
   * Handle messages from KODA CLI
   */
  async handleKodaMessage(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      debug("No session found for", sessionId);
      return;
    }

    debug("Received from KODA:", JSON.stringify(message).slice(0, 300));

    // Handle notifications (session/update)
    if (message.method === "session/update" && message.params) {
      try {
        const result = await this.interceptor.processSessionUpdate(
          sessionId,
          message.params.update,
        );

        if (result.forward && result.update) {
          await this.connection.sessionUpdate({
            sessionId,
            update: result.update,
          });
        }
      } catch (err) {
        debug("Error processing session update:", err.message);
      }
      return;
    }

    // Handle requests from KODA CLI
    if (message.id !== undefined && message.method) {
      debug("KODA request:", message.method, message.id);
      await this.handleKodaRequest(sessionId, session, message);
    }
  }

  /**
   * Handle requests from KODA CLI (e.g., fs/read_text_file)
   */
  async handleKodaRequest(sessionId, session, message) {
    const { id, method, params } = message;

    debug(
      "handleKodaRequest:",
      method,
      "params:",
      JSON.stringify(params).slice(0, 200),
    );

    try {
      let result;

      switch (method) {
        case "fs/read_text_file":
          debug("Reading file:", params.path);
          result = await this.connection.readTextFile({
            sessionId,
            path: params.path,
            line: params.line,
            limit: params.limit,
          });
          debug("Read result:", result ? "success" : "empty");
          break;

        case "fs/write_text_file":
          debug("Writing file:", params.path);
          result = await this.connection.writeTextFile({
            sessionId,
            path: params.path,
            content: params.content,
          });
          debug("Write result:", result ? "success" : "empty");
          break;

        case "session/request_permission":
          debug("Requesting permission, params:", JSON.stringify(params));
          // KODA CLI sends its own permission request format
          // We need to adapt it for Zed's expected format
          const permissionParams = {
            sessionId,
            options: params.options || [],
          };

          // If KODA provides toolCall, use it; otherwise create a minimal one
          if (params.toolCall) {
            permissionParams.toolCall = params.toolCall;
          } else {
            // Create a synthetic toolCall for Zed UI
            permissionParams.toolCall = {
              toolCallId: params.toolCallId || `permission_${Date.now()}`,
              title: params.title || params.message || "Permission required",
              kind: params.kind || "edit",
              status: "pending",
            };
          }

          debug(
            "Sending permission request to Zed:",
            JSON.stringify(permissionParams).slice(0, 300),
          );
          result = await this.connection.requestPermission(permissionParams);
          debug("Permission result:", JSON.stringify(result));
          break;

        default:
          debug("Unknown method, trying extMethod:", method);
          // Unknown method - try to forward via extension
          try {
            result = await this.connection.extMethod(method, params);
          } catch (extErr) {
            debug("extMethod failed:", extErr.message);
            session.kodaBridge.sendResponse(id, null, {
              code: -32601,
              message: `Method not found: ${method}`,
            });
            return;
          }
      }

      debug("Sending response for", method);
      session.kodaBridge.sendResponse(id, result);
    } catch (error) {
      debug("Error in handleKodaRequest:", error.message, error.stack);
      session.kodaBridge.sendResponse(id, null, {
        code: -32000,
        message: error.message || "Unknown error",
      });
    }
  }

  /**
   * Handle KODA CLI process close
   */
  handleKodaClose(sessionId, code, signal) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clean up session
    this.sessions.delete(sessionId);
    this.modeManager.deleteSession(sessionId);
    this.permissionHandler.deleteSession(sessionId);
    this.planCollector.deleteSession(sessionId);
  }
}

// =============================================================================
// Main
// =============================================================================

const config = parseServerArgs(process.argv.slice(2));

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);

new acp.AgentSideConnection((conn) => new KodaAgent(conn, config), stream);
