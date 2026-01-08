/**
 * Tool Call Interceptor - перехват и обработка tool calls
 */

import { SESSION_UPDATE } from "../config/constants.js";

/**
 * Tool Call Interceptor - перехватывает tool calls и применяет политики
 */
export class ToolCallInterceptor {
  /**
   * @param {Object} connection - ACP connection
   * @param {Object} handlers - Handler instances
   * @param {Object} handlers.permissionHandler
   * @param {Object} handlers.modeManager
   * @param {Object} handlers.planCollector
   * @param {Object} [options={}]
   * @param {boolean} [options.debug=false]
   */
  constructor(connection, handlers, options = {}) {
    /** @type {Object} */
    this.connection = connection;

    /** @type {Object} */
    this.permissionHandler = handlers.permissionHandler;

    /** @type {Object} */
    this.modeManager = handlers.modeManager;

    /** @type {Object} */
    this.planCollector = handlers.planCollector;

    /** @type {boolean} */
    this.debug = options.debug || false;

    /** @type {Map<string, Object>} toolCallId -> toolCall */
    this.blockedToolCalls = new Map();

    /** @type {Map<string, Object>} toolCallId -> toolCall */
    this.pendingToolCalls = new Map();
  }

  /**
   * @private
   */
  debugLog(...args) {
    if (this.debug) {
      console.error("[Interceptor]", ...args);
    }
  }

  /**
   * Обработать session update от KODA CLI
   * @param {string} sessionId
   * @param {Object} update
   * @returns {Promise<{forward: boolean, update?: Object, blocked?: boolean}>}
   */
  async processSessionUpdate(sessionId, update) {
    const mode = this.modeManager.getMode(sessionId);

    if (update.sessionUpdate === SESSION_UPDATE.TOOL_CALL) {
      return this.handleToolCall(sessionId, mode, update);
    }

    if (update.sessionUpdate === SESSION_UPDATE.TOOL_CALL_UPDATE) {
      return this.handleToolCallUpdate(sessionId, update);
    }

    return { forward: true, update };
  }

  /**
   * Обработать новый tool call
   * @private
   * @param {string} sessionId
   * @param {string} mode
   * @param {Object} toolCall
   * @returns {Promise<Object>}
   */
  async handleToolCall(sessionId, mode, toolCall) {
    const needsPermission = this.permissionHandler.needsPermission(
      sessionId,
      mode,
      toolCall
    );

    this.debugLog(
      `Tool call: ${toolCall.title}, mode: ${mode}, needsPermission: ${needsPermission}`
    );

    if (!needsPermission) {
      this.pendingToolCalls.set(toolCall.toolCallId, toolCall);
      return { forward: true, update: toolCall };
    }

    if (mode === "plan") {
      return this.handlePlanMode(sessionId, toolCall);
    }

    // Forward the tool call first (to show in UI as pending)
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        ...toolCall,
        sessionUpdate: SESSION_UPDATE.TOOL_CALL,
        status: "pending",
      },
    });

    // Request permission
    const outcome = await this.permissionHandler.requestPermission(
      sessionId,
      toolCall,
      mode
    );

    if (outcome.outcome === "cancelled" || outcome.optionId === "reject") {
      this.blockedToolCalls.set(toolCall.toolCallId, toolCall);

      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: SESSION_UPDATE.TOOL_CALL_UPDATE,
          toolCallId: toolCall.toolCallId,
          status: "failed",
          rawOutput: {
            rejected: true,
            reason: "User rejected the operation",
          },
        },
      });

      this.debugLog(`Tool call rejected: ${toolCall.title}`);
      return { forward: false, blocked: true, rejected: true };
    }

    this.pendingToolCalls.set(toolCall.toolCallId, toolCall);
    this.debugLog(`Tool call approved: ${toolCall.title}`);
    return { forward: false, alreadySent: true };
  }

  /**
   * Обработать tool call в plan mode
   * @private
   * @param {string} sessionId
   * @param {Object} toolCall
   * @returns {Promise<Object>}
   */
  async handlePlanMode(sessionId, toolCall) {
    this.planCollector.addEntry(sessionId, toolCall);
    this.blockedToolCalls.set(toolCall.toolCallId, toolCall);

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        ...toolCall,
        sessionUpdate: SESSION_UPDATE.TOOL_CALL,
        status: "pending",
      },
    });

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: SESSION_UPDATE.PLAN,
        entries: this.planCollector.getPlan(sessionId),
      },
    });

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: SESSION_UPDATE.TOOL_CALL_UPDATE,
        toolCallId: toolCall.toolCallId,
        status: "failed",
        rawOutput: {
          blocked: true,
          reason: "Plan mode - execution blocked",
        },
      },
    });

    this.debugLog(`Tool call added to plan: ${toolCall.title}`);
    return { forward: false, blocked: true };
  }

  /**
   * Обработать обновление tool call
   * @private
   * @param {string} sessionId
   * @param {Object} update
   * @returns {Object}
   */
  handleToolCallUpdate(sessionId, update) {
    if (this.blockedToolCalls.has(update.toolCallId)) {
      return { forward: false };
    }

    if (update.status === "completed" || update.status === "failed") {
      this.planCollector.updateEntryByToolCallId(
        sessionId,
        update.toolCallId,
        update.status
      );
    }

    return { forward: true, update };
  }

  /**
   * Очистить состояние сессии
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    this.blockedToolCalls.clear();
    this.pendingToolCalls.clear();
  }
}
