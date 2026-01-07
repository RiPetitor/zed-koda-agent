/**
 * Model Manager - управление моделями и аутентификацией
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GitHub OAuth App Client ID (from KODA CLI)
const GITHUB_CLIENT_ID = "Ov23li5pZhE4aeH5fTSE";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_DEVICE_URL = "https://github.com/login/device";

// KODA API
const KODA_MODELS_API = "https://api.kodacode.ru/v1/models";

// KODA credentials path
const KODA_CONFIG_DIR = path.join(os.homedir(), ".config", "koda");
const KODA_CREDENTIALS_FILE = path.join(KODA_CONFIG_DIR, "credentials.json");

// Cache for models
let cachedModels = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class ModelManager {
  constructor(defaultModelId = "", options = {}) {
    this.sessionModels = new Map(); // sessionId -> modelId
    this.defaultModelId = defaultModelId;
    this.isAuthenticated = false;
    this.availableModels = [
      // Default model until API loads
      {
        modelId: "KodaAgent",
        name: "KodaAgent",
        description: "Default KODA model",
        requiresAuth: false,
      },
    ];
    this.onAuthChange = options.onAuthChange || (() => {});
    this.debug = options.debug || false;
    // Async init - will update models in background
    this.updateAvailableModels();
  }

  /**
   * Fetch models from KODA API
   */
  async fetchModelsFromAPI() {
    const now = Date.now();

    // Return cached if still valid
    if (cachedModels && now - cacheTimestamp < CACHE_TTL_MS) {
      this.debugLog("Using cached models");
      return cachedModels;
    }

    try {
      this.debugLog("Fetching models from KODA API...");
      const response = await fetch(KODA_MODELS_API);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // Parse models from API response
      const freeModels = (data.koda_data || [])
        .filter((m) => m.id === "KodaAgent") // Only KodaAgent for agents
        .map((m) => ({
          modelId: m.id,
          name: m.id,
          description: `${m.owned_by} model (${Math.round(m.context_length / 1000)}k context)`,
          requiresAuth: false,
        }));

      const premiumModels = (data.data || []).map((m) => ({
        modelId: m.id,
        name: m.id,
        description: `${m.owned_by} (${Math.round(m.context_length / 1000)}k context)`,
        requiresAuth: true,
      }));

      cachedModels = { freeModels, premiumModels };
      cacheTimestamp = now;

      this.debugLog(
        `Fetched ${freeModels.length} free + ${premiumModels.length} premium models`,
      );
      return cachedModels;
    } catch (error) {
      this.debugLog("Failed to fetch models from API:", error.message);

      // Fallback to default model
      return {
        freeModels: [
          {
            modelId: "KodaAgent",
            name: "KodaAgent",
            description: "Default KODA model",
            requiresAuth: false,
          },
        ],
        premiumModels: [],
      };
    }
  }

  async updateAvailableModels() {
    const { freeModels, premiumModels } = await this.fetchModelsFromAPI();

    // Show all models - free always available, premium only if authenticated
    if (this.isAuthenticated) {
      this.availableModels = [...freeModels, ...premiumModels];
    } else {
      this.availableModels = freeModels;
    }

    this.debugLog(
      `Models (auth=${this.isAuthenticated}):`,
      this.availableModels.map((m) => m.modelId).join(", "),
    );
  }

  debugLog(...args) {
    if (this.debug) {
      console.error("[ModelManager]", ...args);
    }
  }

  /**
   * Проверить аутентификацию по наличию credentials файла
   */
  async checkAuth() {
    try {
      const data = await fs.readFile(KODA_CREDENTIALS_FILE, "utf8");
      const creds = JSON.parse(data);
      return !!creds.githubToken;
    } catch {
      return false;
    }
  }

  /**
   * Запустить GitHub Device Flow аутентификацию
   * Возвращает объект с user_code и verification_uri для показа пользователю
   */
  async startGitHubDeviceFlow() {
    this.debugLog("Starting GitHub Device Flow...");

    const response = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `client_id=${GITHUB_CLIENT_ID}&scope=read:user`,
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();
    this.debugLog("Device code response:", data);

    // data содержит: device_code, user_code, verification_uri, expires_in, interval
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri || GITHUB_DEVICE_URL,
      expiresIn: data.expires_in,
      interval: data.interval || 5,
    };
  }

  /**
   * Опросить GitHub на предмет завершения авторизации
   */
  async pollGitHubDeviceFlow(deviceCode, interval = 5, maxAttempts = 60) {
    this.debugLog("Polling for GitHub authorization...");

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));

      const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `client_id=${GITHUB_CLIENT_ID}&device_code=${deviceCode}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
      });

      const data = await response.json();
      this.debugLog(`Poll attempt ${attempt + 1}:`, data.error || "got token");

      if (data.access_token) {
        // Успех! Сохраняем токен
        await this.saveGitHubToken(data.access_token);
        return { success: true, token: data.access_token };
      }

      if (data.error === "authorization_pending") {
        // Пользователь ещё не авторизовался, продолжаем
        continue;
      }

      if (data.error === "slow_down") {
        // GitHub просит замедлиться
        interval = (data.interval || interval) + 5;
        continue;
      }

      if (data.error === "expired_token") {
        return { success: false, error: "Code expired. Please try again." };
      }

      if (data.error === "access_denied") {
        return { success: false, error: "Access denied by user." };
      }

      // Другая ошибка
      return { success: false, error: data.error_description || data.error };
    }

    return { success: false, error: "Timeout waiting for authorization." };
  }

  /**
   * Сохранить GitHub токен в файл credentials KODA
   */
  async saveGitHubToken(token) {
    try {
      await fs.mkdir(KODA_CONFIG_DIR, { recursive: true });
      await fs.writeFile(
        KODA_CREDENTIALS_FILE,
        JSON.stringify({ githubToken: token }, null, 2),
        { mode: 0o600 },
      );
      this.debugLog("GitHub token saved to", KODA_CREDENTIALS_FILE);
    } catch (error) {
      this.debugLog("Failed to save token:", error.message);
      throw error;
    }
  }

  /**
   * Удалить credentials (logout)
   */
  async logout() {
    try {
      await fs.unlink(KODA_CREDENTIALS_FILE);
      this.setAuthenticated(false);
      this.debugLog("Logged out, credentials removed");
      return { success: true };
    } catch (error) {
      if (error.code === "ENOENT") {
        // Файл не существует - уже разлогинен
        this.setAuthenticated(false);
        return { success: true, alreadyLoggedOut: true };
      }
      this.debugLog("Logout error:", error.message);
      throw error;
    }
  }

  /**
   * Открыть URL в браузере
   */
  async openBrowser(url) {
    const { spawn } = await import("node:child_process");
    const platform = process.platform;

    let command;
    let args;

    if (platform === "darwin") {
      command = "open";
      args = [url];
    } else if (platform === "win32") {
      command = "cmd";
      args = ["/c", "start", url];
    } else {
      // Linux
      command = "xdg-open";
      args = [url];
    }

    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        stdio: "ignore",
        detached: true,
      });
      proc.unref();
      proc.on("error", () => resolve(false));
      proc.on("spawn", () => resolve(true));
    });
  }

  /**
   * Выполнить полную аутентификацию через GitHub Device Flow
   * Возвращает объект с информацией для отображения пользователю
   */
  async authenticate() {
    // Проверяем, не авторизованы ли уже
    if (await this.checkAuth()) {
      this.debugLog("Already authenticated");
      return { success: true, alreadyAuthenticated: true };
    }

    try {
      // Запускаем Device Flow
      const deviceFlow = await this.startGitHubDeviceFlow();

      // Пытаемся открыть браузер
      const browserOpened = await this.openBrowser(deviceFlow.verificationUri);

      return {
        success: false,
        pending: true,
        userCode: deviceFlow.userCode,
        verificationUri: deviceFlow.verificationUri,
        deviceCode: deviceFlow.deviceCode,
        interval: deviceFlow.interval,
        expiresIn: deviceFlow.expiresIn,
        browserOpened,
      };
    } catch (error) {
      this.debugLog("Auth error:", error.message);
      throw error;
    }
  }

  /**
   * Обновить статус аутентификации
   */
  async updateAuthStatus() {
    const wasAuthenticated = this.isAuthenticated;
    const nowAuthenticated = await this.checkAuth();

    if (wasAuthenticated !== nowAuthenticated) {
      this.isAuthenticated = nowAuthenticated;
      this.updateAvailableModels();
      this.debugLog(
        `Auth status changed: ${wasAuthenticated} -> ${nowAuthenticated}`,
      );

      // Уведомляем об изменении
      await this.onAuthChange(nowAuthenticated);
    }

    return this.isAuthenticated;
  }

  setAuthenticated(authenticated) {
    if (this.isAuthenticated !== authenticated) {
      this.isAuthenticated = authenticated;
      this.updateAvailableModels();
    }
  }

  loadAvailableModels() {
    return this.availableModels;
  }

  getModel(sessionId) {
    return (
      this.sessionModels.get(sessionId) ||
      this.defaultModelId ||
      this.availableModels[0]?.modelId ||
      ""
    );
  }

  setModel(sessionId, modelId) {
    if (modelId && !this.availableModels.find((m) => m.modelId === modelId)) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    this.sessionModels.set(sessionId, modelId);
  }

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

  deleteSession(sessionId) {
    this.sessionModels.delete(sessionId);
  }
}
