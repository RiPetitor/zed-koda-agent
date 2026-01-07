/**
 * Mode Manager - управление режимами сессии
 */

export const MODES = [
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

export class ModeManager {
  constructor() {
    this.sessionModes = new Map(); // sessionId -> modeId
  }

  getMode(sessionId) {
    return this.sessionModes.get(sessionId) || "default";
  }

  setMode(sessionId, modeId) {
    const mode = MODES.find((m) => m.id === modeId);
    if (!mode) {
      throw new Error(`Unknown mode: ${modeId}`);
    }
    this.sessionModes.set(sessionId, modeId);
  }

  getModeConfig(currentModeId = "default") {
    return {
      availableModes: MODES.map((m) => ({
        id: m.id,
        name: m.name,
      })),
      currentModeId,
    };
  }

  deleteSession(sessionId) {
    this.sessionModes.delete(sessionId);
  }
}