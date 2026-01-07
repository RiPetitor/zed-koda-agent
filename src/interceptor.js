/**
 * Tool Call Interceptor - перехват и обработка tool calls
 */

export class ToolCallInterceptor {
  constructor(connection, handlers, options = {}) {
    this.connection = connection;
    this.permissionHandler = handlers.permissionHandler;
    this.modeManager = handlers.modeManager;
    this.planCollector = handlers.planCollector;
    this.debug = options.debug || false;

    this.blockedToolCalls = new Map(); // toolCallId -> toolCall
    this.pendingToolCalls = new Map(); // toolCallId -> toolCall
  }

  debugLog(...args) {
    if (this.debug) {
      console.error("[Interceptor]", ...args);
    }
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

    this.debugLog(
      `Tool call: ${toolCall.title}, mode: ${mode}, needsPermission: ${needsPermission}`,
    );

    if (!needsPermission) {
      // Auto-approved, forward directly
      this.pendingToolCalls.set(toolCall.toolCallId, toolCall);
      return { forward: true, update: toolCall };
    }

    // In plan mode, collect and block
    if (mode === "plan") {
      return this.handlePlanMode(sessionId, toolCall);
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

      this.debugLog(`Tool call rejected: ${toolCall.title}`);
      return { forward: false, blocked: true, rejected: true };
    }

    // Permission granted - the tool call was already forwarded
    this.pendingToolCalls.set(toolCall.toolCallId, toolCall);
    this.debugLog(`Tool call approved: ${toolCall.title}`);
    return { forward: false, alreadySent: true };
  }

  /**
   * Handle tool call in plan mode
   */
  async handlePlanMode(sessionId, toolCall) {
    // Add to plan
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

    this.debugLog(`Tool call added to plan: ${toolCall.title}`);
    return { forward: false, blocked: true };
  }

  /**
   * Handle tool call update
   */
  handleToolCallUpdate(sessionId, update) {
    // If this tool call was blocked, don't forward updates
    if (this.blockedToolCalls.has(update.toolCallId)) {
      return { forward: false };
    }

    // Update plan entry if this was a plan mode tool call
    if (update.status === "completed" || update.status === "failed") {
      this.planCollector.updateEntryByToolCallId(
        sessionId,
        update.toolCallId,
        update.status,
      );
    }

    return { forward: true, update };
  }

  /**
   * Clear state for session
   */
  clearSession(sessionId) {
    this.blockedToolCalls.clear();
    this.pendingToolCalls.clear();
  }
}