/**
 * Permission Handler - управление правами доступа к операциям
 */

import { TOOL_TYPE, DANGEROUS_PATTERNS } from "../config/constants.js";

/**
 * Permission Handler - обрабатывает запросы на разрешения
 */
export class PermissionHandler {
  /**
   * @param {Object} connection - ACP connection
   * @param {Object} [options={}]
   * @param {boolean} [options.debug=false]
   */
  constructor(connection, options = {}) {
    /** @type {Object} */
    this.connection = connection;

    /** @type {Map<string, Set<string>>} sessionId -> Set of tool types */
    this.alwaysAllowedTypes = new Map();

    /** @type {boolean} */
    this.debug = options.debug || false;
  }

  /**
   * @private
   */
  debugLog(...args) {
    if (this.debug) {
      console.error("[PermissionHandler]", ...args);
    }
  }

  /**
   * Определить тип инструмента по tool call
   * @param {Object} toolCall
   * @returns {string}
   */
  getToolType(toolCall) {
    const kind = toolCall.kind || "other";
    const title = (toolCall.title || "").toLowerCase();

    // Classify by kind first
    if (kind === "read" || kind === "search") return TOOL_TYPE.READ;
    if (kind === "edit") return TOOL_TYPE.FILE_EDIT;
    if (kind === "delete") return TOOL_TYPE.FILE_DELETE;

    if (kind === "execute") {
      const input = JSON.stringify(toolCall.rawInput || {});
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(input)) return TOOL_TYPE.DANGEROUS_COMMAND;
      }
      return TOOL_TYPE.COMMAND_EXECUTE;
    }

    // Fallback to title-based classification
    if (
      title.includes("read") ||
      title.includes("glob") ||
      title.includes("grep")
    ) {
      return TOOL_TYPE.READ;
    }
    if (
      title.includes("write") ||
      title.includes("edit") ||
      title.includes("create")
    ) {
      return TOOL_TYPE.FILE_EDIT;
    }
    if (title.includes("delete") || title.includes("remove")) {
      return TOOL_TYPE.FILE_DELETE;
    }
    if (
      title.includes("bash") ||
      title.includes("command") ||
      title.includes("run")
    ) {
      return TOOL_TYPE.COMMAND_EXECUTE;
    }

    return TOOL_TYPE.OTHER;
  }

  /**
   * Проверить, нужно ли разрешение
   * @param {string} sessionId
   * @param {string} mode
   * @param {Object} toolCall
   * @returns {boolean}
   */
  needsPermission(sessionId, mode, toolCall) {
    const toolType = this.getToolType(toolCall);

    // Read operations never need permission
    if (toolType === TOOL_TYPE.READ) return false;

    // Bypass mode - no permissions needed
    if (mode === "bypass") return false;

    // Check if always allowed for this session
    const alwaysAllowed = this.alwaysAllowedTypes.get(sessionId);
    if (alwaysAllowed?.has(toolType)) return false;

    // Plan mode - always needs permission (to block execution)
    if (mode === "plan") return true;

    // YOLO mode - only dangerous commands need permission
    if (mode === "yolo") return toolType === TOOL_TYPE.DANGEROUS_COMMAND;

    // Auto-edit mode - file edits are auto-approved
    if (mode === "auto_edit") return toolType !== TOOL_TYPE.FILE_EDIT;

    // Default mode - all write operations need permission
    return true;
  }

  /**
   * Запросить разрешение у пользователя
   * @param {string} sessionId
   * @param {Object} toolCall
   * @param {string} mode
   * @returns {Promise<Object>}
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
      return { outcome: "cancelled", optionId: null };
    }
  }

  /**
   * Удалить данные сессии
   * @param {string} sessionId
   */
  deleteSession(sessionId) {
    this.alwaysAllowedTypes.delete(sessionId);
  }
}
