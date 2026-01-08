/**
 * Model Manager - управление моделями и их выбором
 */

import { DEFAULT_MODEL } from "../config/constants.js";
import { fetchModels } from "./api-client.js";
import {
  hasStoredToken,
  deleteToken,
  authenticate as authAuthenticate,
  pollDeviceFlow,
  openBrowser,
} from "../auth/index.js";

/**
 * @typedef {Object} ModelManagerOptions
 * @property {boolean} [debug=false] - Enable debug logging
 * @property {(isAuth: boolean) => void} [onAuthChange] - Auth status change callback
 */

/**
 * Model Manager - управляет доступными моделями и сессиями
 */
export class ModelManager {
  /**
   * @param {string} [defaultModelId=""] - Default model ID
   * @param {ModelManagerOptions} [options={}] - Options
   */
  constructor(defaultModelId = "", options = {}) {
    /** @type {Map<string, string>} sessionId -> modelId */
    this.sessionModels = new Map();

    /** @type {string} */
    this.defaultModelId = defaultModelId;

    /** @type {boolean} */
    this.isAuthenticated = false;

    /** @type {Array<{modelId: string, name: string, description: string, requiresAuth: boolean}>} */
    this.availableModels = [DEFAULT_MODEL];

    /** @type {(isAuth: boolean) => void} */
    this.onAuthChange = options.onAuthChange || (() => {});

    /** @type {boolean} */
    this.debug = options.debug || false;

    // Async init - will update models in background
    this.updateAvailableModels();
  }

  /**
   * @private
   */
  debugLog(...args) {
    if (this.debug) {
      console.error("[ModelManager]", ...args);
    }
  }

  /**
   * Проверить аутентификацию
   * @returns {Promise<boolean>}
   */
  async checkAuth() {
    return hasStoredToken();
  }

  /**
   * Обновить список доступных моделей
   * @returns {Promise<void>}
   */
  async updateAvailableModels() {
    const { freeModels, premiumModels } = await fetchModels(this.debug);

    if (this.isAuthenticated) {
      this.availableModels = [...freeModels, ...premiumModels];
    } else {
      this.availableModels = freeModels;
    }

    this.debugLog(
      `Models (auth=${this.isAuthenticated}):`,
      this.availableModels.map((m) => m.modelId).join(", ")
    );
  }

  /**
   * Запустить аутентификацию
   * @returns {Promise<Object>}
   */
  async authenticate() {
    return authAuthenticate();
  }

  /**
   * Опросить статус авторизации
   * @param {string} deviceCode
   * @param {number} interval
   * @returns {Promise<{success: boolean, token?: string, error?: string}>}
   */
  async pollGitHubDeviceFlow(deviceCode, interval) {
    return pollDeviceFlow(deviceCode, interval);
  }

  /**
   * Открыть браузер
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  async openBrowser(url) {
    return openBrowser(url);
  }

  /**
   * Выход из аккаунта
   * @returns {Promise<{success: boolean, alreadyLoggedOut?: boolean}>}
   */
  async logout() {
    const result = await deleteToken();
    this.setAuthenticated(false);
    this.debugLog("Logged out, credentials removed");
    return result;
  }

  /**
   * Обновить статус аутентификации
   * @returns {Promise<boolean>}
   */
  async updateAuthStatus() {
    const wasAuthenticated = this.isAuthenticated;
    const nowAuthenticated = await this.checkAuth();

    if (wasAuthenticated !== nowAuthenticated) {
      this.isAuthenticated = nowAuthenticated;
      await this.updateAvailableModels();
      this.debugLog(
        `Auth status changed: ${wasAuthenticated} -> ${nowAuthenticated}`
      );
      await this.onAuthChange(nowAuthenticated);
    }

    return this.isAuthenticated;
  }

  /**
   * Установить статус аутентификации
   * @param {boolean} authenticated
   */
  setAuthenticated(authenticated) {
    if (this.isAuthenticated !== authenticated) {
      this.isAuthenticated = authenticated;
      this.updateAvailableModels();
    }
  }

  /**
   * Загрузить доступные модели
   * @returns {Array}
   */
  loadAvailableModels() {
    return this.availableModels;
  }

  /**
   * Получить модель для сессии
   * @param {string} sessionId
   * @returns {string}
   */
  getModel(sessionId) {
    return (
      this.sessionModels.get(sessionId) ||
      this.defaultModelId ||
      this.availableModels[0]?.modelId ||
      ""
    );
  }

  /**
   * Установить модель для сессии
   * @param {string} sessionId
   * @param {string} modelId
   */
  setModel(sessionId, modelId) {
    if (modelId && !this.availableModels.find((m) => m.modelId === modelId)) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    this.sessionModels.set(sessionId, modelId);
  }

  /**
   * Получить конфигурацию моделей
   * @param {string|null} [currentModelId=null]
   * @returns {Object}
   */
  getModelConfig(currentModelId = null) {
    const current =
      currentModelId ||
      this.defaultModelId ||
      this.availableModels[0]?.modelId ||
      "";

    return {
      availableModels: this.availableModels.map((m) => ({
        modelId: m.modelId,
        name: m.name,
        description: m.description,
        requiresAuth: m.requiresAuth || false,
      })),
      currentModelId: current,
    };
  }

  /**
   * Удалить сессию
   * @param {string} sessionId
   */
  deleteSession(sessionId) {
    this.sessionModels.delete(sessionId);
  }
}
