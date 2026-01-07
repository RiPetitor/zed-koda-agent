/**
 * Permission Handler - управление правами доступа
 */

export class PermissionHandler {
  constructor(connection, options = {}) {
    this.connection = connection;
    this.alwaysAllowedTypes = new Map(); // sessionId -> Set of tool types
    this.debug = options.debug || false;
  }

  debugLog(...args) {
    if (this.debug) {
      console.error("[PermissionHandler]", ...args);
    }
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
        this.debugLog(`Always allowing "${toolType}" for session ${sessionId}`);
      }

      return response.outcome;
    } catch (error) {
      this.debugLog("Permission request failed:", error.message);
      // If permission request fails, treat as rejected
      return { outcome: "cancelled", optionId: null };
    }
  }

  deleteSession(sessionId) {
    this.alwaysAllowedTypes.delete(sessionId);
  }
}