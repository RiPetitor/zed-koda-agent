/**
 * Plan Collector - сбор и управление планами в Plan Mode
 */

/**
 * @typedef {Object} PlanEntry
 * @property {string} content - Описание действия
 * @property {string} status - Статус: pending, completed, failed
 * @property {string} priority - Приоритет: low, medium, high
 * @property {string} toolCallId - ID связанного tool call
 * @property {string} kind - Тип операции
 * @property {Object} rawInput - Входные данные
 */

/**
 * Plan Collector - собирает и управляет планами выполнения
 */
export class PlanCollector {
  /**
   * @param {Object} [options={}]
   * @param {boolean} [options.debug=false]
   */
  constructor(options = {}) {
    /** @type {Map<string, PlanEntry[]>} sessionId -> entries */
    this.plans = new Map();

    /** @type {boolean} */
    this.debug = options.debug || false;
  }

  /**
   * @private
   */
  debugLog(...args) {
    if (this.debug) {
      console.error("[PlanCollector]", ...args);
    }
  }

  /**
   * Добавить запись в план
   * @param {string} sessionId
   * @param {Object} toolCall
   * @returns {PlanEntry}
   */
  addEntry(sessionId, toolCall) {
    if (!this.plans.has(sessionId)) {
      this.plans.set(sessionId, []);
    }

    const plan = this.plans.get(sessionId);
    const entry = {
      content: toolCall.title || "Unknown action",
      status: "pending",
      priority: toolCall.kind === "execute" ? "high" : "medium",
      toolCallId: toolCall.toolCallId,
      kind: toolCall.kind,
      rawInput: toolCall.rawInput,
    };

    plan.push(entry);
    this.debugLog(`Added plan entry for session ${sessionId}:`, entry.content);
    return entry;
  }

  /**
   * Получить план сессии
   * @param {string} sessionId
   * @returns {PlanEntry[]}
   */
  getPlan(sessionId) {
    return this.plans.get(sessionId) || [];
  }

  /**
   * Обновить статус записи по индексу
   * @param {string} sessionId
   * @param {number} index
   * @param {string} status
   */
  updateEntry(sessionId, index, status) {
    const plan = this.plans.get(sessionId);
    if (plan && plan[index]) {
      plan[index].status = status;
    }
  }

  /**
   * Обновить статус записи по toolCallId
   * @param {string} sessionId
   * @param {string} toolCallId
   * @param {string} status
   */
  updateEntryByToolCallId(sessionId, toolCallId, status) {
    const plan = this.plans.get(sessionId);
    if (plan) {
      const entry = plan.find((e) => e.toolCallId === toolCallId);
      if (entry) {
        entry.status = status;
        this.debugLog(`Updated plan entry ${toolCallId} to "${status}"`);
      }
    }
  }

  /**
   * Очистить план сессии
   * @param {string} sessionId
   */
  clearPlan(sessionId) {
    this.plans.delete(sessionId);
    this.debugLog(`Cleared plan for session ${sessionId}`);
  }

  /**
   * Удалить данные сессии
   * @param {string} sessionId
   */
  deleteSession(sessionId) {
    this.plans.delete(sessionId);
  }
}
