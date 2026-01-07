/**
 * Plan Collector - сбор и управление планами
 */

export class PlanCollector {
  constructor(options = {}) {
    this.plans = new Map(); // sessionId -> PlanEntry[]
    this.debug = options.debug || false;
  }

  debugLog(...args) {
    if (this.debug) {
      console.error("[PlanCollector]", ...args);
    }
  }

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

  getPlan(sessionId) {
    return this.plans.get(sessionId) || [];
  }

  updateEntry(sessionId, index, status) {
    const plan = this.plans.get(sessionId);
    if (plan && plan[index]) {
      plan[index].status = status;
    }
  }

  updateEntryByToolCallId(sessionId, toolCallId, status) {
    const plan = this.plans.get(sessionId);
    if (plan) {
      const entry = plan.find((e) => e.toolCallId === toolCallId);
      if (entry) {
        entry.status = status;
        this.debugLog(
          `Updated plan entry ${toolCallId} to "${status}"`,
        );
      }
    }
  }

  clearPlan(sessionId) {
    this.plans.delete(sessionId);
    this.debugLog(`Cleared plan for session ${sessionId}`);
  }

  deleteSession(sessionId) {
    this.plans.delete(sessionId);
  }

  /**
   * Convert tool call to plan entry
   */
  toolCallToPlanEntry(toolCall) {
    return {
      content: toolCall.title,
      status: "pending",
      priority: toolCall.kind === "execute" ? "high" : "medium",
    };
  }
}