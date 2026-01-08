/**
 * Mode Manager - управление режимами сессии
 */

import { MODES } from "../config/constants.js";

/**
 * Mode Manager - управляет режимами работы сессий
 */
export class ModeManager {
  constructor() {
    /** @type {Map<string, string>} sessionId -> modeId */
    this.sessionModes = new Map();
  }

  /**
   * Получить текущий режим сессии
   * @param {string} sessionId
   * @returns {string}
   */
  getMode(sessionId) {
    return this.sessionModes.get(sessionId) || "default";
  }

  /**
   * Установить режим для сессии
   * @param {string} sessionId
   * @param {string} modeId
   * @throws {Error} If mode is unknown
   */
  setMode(sessionId, modeId) {
    const mode = MODES.find((m) => m.id === modeId);
    if (!mode) {
      throw new Error(`Unknown mode: ${modeId}`);
    }
    this.sessionModes.set(sessionId, modeId);
  }

  /**
   * Получить конфигурацию режимов для ACP
   * @param {string} [currentModeId="default"]
   * @returns {Object}
   */
  getModeConfig(currentModeId = "default") {
    return {
      availableModes: MODES.map((m) => ({
        id: m.id,
        name: m.name,
      })),
      currentModeId,
    };
  }

  /**
   * Удалить данные сессии
   * @param {string} sessionId
   */
  deleteSession(sessionId) {
    this.sessionModes.delete(sessionId);
  }
}
