/**
 * KODA Agent - главный класс агента
 */

import * as acp from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import process from "node:process";

import { AGENT, SESSION_UPDATE } from "../config/constants.js";
import {
  ModeManager,
  PlanCollector,
  ProfessionalModeHandler,
} from "../session/index.js";
import { ModelManager } from "../models/index.js";
import { PermissionHandler, ToolCallInterceptor } from "../tools/index.js";
import { KodaAcpBridge } from "../bridge/index.js";
import { SlashCommandManager } from "../commands/index.js";

/**
 * @typedef {Object} Session
 * @property {KodaAcpBridge} kodaBridge
 * @property {string} cwd
 * @property {string} model
 * @property {Object|null} pendingPrompt
 * @property {boolean} [restarting]
 */

/**
 * KODA Agent - координирует все компоненты системы
 */
export class KodaAgent {
  /**
   * @param {Object} connection - ACP connection
   * @param {Object} config - Server configuration
   */
  constructor(connection, config) {
    /** @type {Object} */
    this.connection = connection;

    /** @type {Object} */
    this.config = config;

    /** @type {Map<string, Session>} */
    this.sessions = new Map();

    // Initialize managers
    this.modeManager = new ModeManager();
    this.modelManager = new ModelManager(config.defaultModel, {
      debug: config.debug,
      onAuthChange: (isAuth) => this.handleAuthChange(isAuth),
    });
    this.permissionHandler = new PermissionHandler(connection, {
      debug: config.debug,
    });
    this.planCollector = new PlanCollector({ debug: config.debug });
    this.professionalHandler = new ProfessionalModeHandler();

    // Initialize interceptor
    this.interceptor = new ToolCallInterceptor(
      connection,
      {
        permissionHandler: this.permissionHandler,
        modeManager: this.modeManager,
        planCollector: this.planCollector,
      },
      { debug: config.debug }
    );

    // Initialize slash command manager
    this.slashCommands = new SlashCommandManager({
      debug: config.debug,
      onAuthRequest: (sessionId) => this.triggerAuth(sessionId),
      onLogoutRequest: (sessionId) => this.triggerLogout(sessionId),
      onModeChange: (sessionId, mode) =>
        this.handleSlashModeChange(sessionId, mode),
      onModelChange: (sessionId, model) =>
        this.handleSlashModelChange(sessionId, model),
      onClear: (sessionId) => this.handleSlashClear(sessionId),
      onRetry: (sessionId) => this.handleSlashRetry(sessionId),
      getAvailableModelsList: () => this.modelManager.availableModels,
      // Professional mode callbacks
      onPlanApprove: (sessionId) => this.handlePlanApprove(sessionId),
      onPlanSkip: (sessionId) => this.handlePlanSkip(sessionId),
      onPlanReject: (sessionId) => this.handlePlanReject(sessionId),
      getPlanProgress: (sessionId) => this.getPlanProgress(sessionId),
    });

    // Check initial auth status
    this.checkInitialAuth();
  }

  /**
   * @private
   */
  debugLog(...args) {
    if (this.config.debug) {
      console.error("[Agent]", ...args);
    }
  }

  /**
   * Проверить начальный статус аутентификации
   * @private
   */
  async checkInitialAuth() {
    try {
      const isAuth = await this.modelManager.checkAuth();
      this.modelManager.setAuthenticated(isAuth);
      this.debugLog(`Initial auth status: ${isAuth}`);
    } catch (error) {
      this.debugLog("Initial auth check failed:", error.message);
    }
  }

  /**
   * Обработать изменение статуса аутентификации
   * @param {boolean} isAuthenticated
   */
  async handleAuthChange(isAuthenticated) {
    this.debugLog(`Auth status changed to: ${isAuthenticated}`);

    this.modelManager.setAuthenticated(isAuthenticated);
    await this.modelManager.updateAvailableModels();

    this.debugLog(
      `Available models after update: ${this.modelManager.availableModels.map((m) => m.modelId).join(", ")}`
    );
  }

  // ===========================================================================
  // ACP Protocol Methods
  // ===========================================================================

  /**
   * Инициализация агента (ACP initialize)
   * @returns {Object}
   */
  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          embeddedContext: true,
          image: true,
        },
        mcpCapabilities: {},
      },
      agentInfo: {
        name: AGENT.NAME,
        title: AGENT.TITLE,
        version: AGENT.VERSION,
      },
      authMethods: [
        {
          id: "koda_auth",
          name: "KODA Authentication",
          description:
            "Authenticate to access premium models (Gemini 2.5 Pro, 2.0 Flash, etc.)",
        },
      ],
    };
  }

  /**
   * Создать новую сессию (ACP session/new)
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async newSession(params) {
    const sessionId = randomUUID();
    const cwd = params?.cwd || process.cwd();
    const mcpServers = params?.mcpServers || [];
    const model = params?.model || this.config.defaultModel;

    this.debugLog(
      `Creating session ${sessionId} with model: ${model || "(default)"}`
    );

    // Create KODA CLI bridge
    const kodaBridge = new KodaAcpBridge(this.config, {
      onMessage: (message) => this.handleKodaMessage(sessionId, message),
      onClose: (code, signal) => this.handleKodaClose(sessionId, code, signal),
      onError: (error) => this.handleKodaError(sessionId, error),
    });

    try {
      await kodaBridge.spawn(cwd, { model });
      await kodaBridge.createSession(cwd, mcpServers);
    } catch (error) {
      throw new Error(`Failed to start KODA CLI: ${error.message}`);
    }

    this.sessions.set(sessionId, {
      kodaBridge,
      cwd,
      model,
      pendingPrompt: null,
    });

    this.modeManager.setMode(sessionId, this.config.defaultMode);
    this.modelManager.setModel(sessionId, model);

    // Check auth and load models
    const isAuth = await this.modelManager.checkAuth();
    this.modelManager.setAuthenticated(isAuth);
    await this.modelManager.updateAvailableModels();

    // Send available commands after response
    setImmediate(() => {
      this.sendAvailableCommands(sessionId);
    });

    return {
      sessionId,
      modes: this.modeManager.getModeConfig(),
      models: this.modelManager.getModelConfig(model),
    };
  }

  /**
   * Отправить доступные команды клиенту
   * @private
   * @param {string} sessionId
   */
  async sendAvailableCommands(sessionId) {
    const commands = this.slashCommands.getAvailableCommands();
    this.debugLog(`Sending ${commands.length} available commands`);

    try {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: SESSION_UPDATE.AVAILABLE_COMMANDS,
          availableCommands: commands,
        },
      });
    } catch (error) {
      this.debugLog(`Failed to send available commands: ${error.message}`);
    }
  }

  /**
   * Аутентификация (ACP authenticate)
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async authenticate(params) {
    const { methodId } = params || {};

    if (methodId !== "koda_auth") {
      return {};
    }

    this.debugLog("Processing authentication request...");

    try {
      const isAuth = await this.modelManager.checkAuth();
      if (isAuth) {
        this.modelManager.setAuthenticated(true);
        this.debugLog("Already authenticated");
        return {};
      }

      const result = await this.modelManager.authenticate();

      if (result === true) {
        this.modelManager.setAuthenticated(true);
        await this.modelManager.updateAuthStatus();
        this.debugLog("Authentication successful");

        await this.sendMessage(
          null,
          "\n\n✅ Authentication successful! Premium models are now available."
        );

        return {};
      }

      if (result.needsBrowser) {
        await this.sendMessage(
          null,
          "\n\n🔐 Please complete authentication in your browser, then click 'Retry' or restart the agent to use premium models."
        );

        const authError = new Error(
          "Authentication pending - please complete in browser and retry"
        );
        authError.code = -32000;
        throw authError;
      }

      throw new Error("Authentication failed");
    } catch (error) {
      if (error.code === -32000) {
        throw error;
      }
      this.debugLog("Authentication error:", error.message);
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Изменить режим сессии (ACP session/setMode)
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async setSessionMode(params) {
    const { sessionId, modeId } = params;

    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.modeManager.setMode(sessionId, modeId);

    if (modeId !== "plan") {
      this.planCollector.clearPlan(sessionId);
    }

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: SESSION_UPDATE.CURRENT_MODE,
        currentModeId: modeId,
      },
    });

    this.debugLog(`Session ${sessionId} mode changed to ${modeId}`);
    return {};
  }

  /**
   * Изменить модель сессии (ACP session/setModel)
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async unstable_setSessionModel(params) {
    const { sessionId, modelId } = params;

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.modelManager.setModel(sessionId, modelId);
    this.debugLog(`Changing model: ${session.model} -> ${modelId}`);

    session.restarting = true;

    if (session.kodaBridge) {
      session.kodaBridge.kill();
    }

    const kodaBridge = new KodaAcpBridge(this.config, {
      onMessage: (message) => this.handleKodaMessage(sessionId, message),
      onClose: (code, signal) => this.handleKodaClose(sessionId, code, signal),
      onError: (error) => this.handleKodaError(sessionId, error),
    });

    try {
      await kodaBridge.spawn(session.cwd, { model: modelId });
      await kodaBridge.createSession(session.cwd, []);
    } catch (error) {
      session.restarting = false;
      throw new Error(`Failed to restart with new model: ${error.message}`);
    }

    session.kodaBridge = kodaBridge;
    session.model = modelId;
    session.restarting = false;

    // Note: current_model_update not supported by Zed, model change confirmed via agent message
    this.debugLog(`Model changed to: ${modelId}`);

    return {};
  }

  /**
   * Обработать prompt (ACP session/prompt)
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async prompt(params) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`);
    }

    const promptText = this.extractPromptText(params.prompt);
    this.debugLog(`Prompt text: ${promptText.slice(0, 100)}...`);

    // Check for slash commands
    if (this.slashCommands.isSlashCommand(promptText)) {
      const slashResult = await this.processSlashCommand(
        params.sessionId,
        promptText
      );
      if (slashResult?.handled) {
        return { stopReason: "end_turn" };
      }
    }

    // Cancel previous prompt
    if (session.pendingPrompt?.abortController) {
      session.pendingPrompt.abortController.abort();
      session.kodaBridge.sendCancel();
    }

    const abortController = new AbortController();
    session.pendingPrompt = { abortController };

    try {
      const response = await session.kodaBridge.sendPrompt(params.prompt);
      return { stopReason: response.stopReason || "end_turn" };
    } catch (error) {
      if (abortController.signal.aborted) {
        return { stopReason: "cancelled" };
      }

      await this.sendMessage(params.sessionId, `\n\nError: ${error.message}`);
      return { stopReason: "end_turn" };
    } finally {
      session.pendingPrompt = null;
    }
  }

  /**
   * Отменить операцию (ACP session/cancel)
   * @param {Object} params
   */
  async cancel(params) {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.pendingPrompt?.abortController?.abort();
      session.kodaBridge?.sendCancel();
    }
  }

  // ===========================================================================
  // KODA CLI Message Handlers
  // ===========================================================================

  /**
   * Обработать сообщение от KODA CLI
   * @private
   * @param {string} sessionId
   * @param {Object} message
   */
  async handleKodaMessage(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.debugLog(`No session found for ${sessionId}`);
      return;
    }

    if (message.method === "session/update" && message.params) {
      const update = message.params.update;
      this.debugLog(`Received session update: ${update?.sessionUpdate}`);

      try {
        const result = await this.interceptor.processSessionUpdate(
          sessionId,
          update
        );

        if (result.forward && result.update) {
          await this.connection.sessionUpdate({
            sessionId,
            update: result.update,
          });
        }
      } catch (err) {
        this.debugLog(`Error processing session update: ${err.message}`);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      await this.handleKodaRequest(sessionId, session, message);
    }
  }

  /**
   * Обработать запрос от KODA CLI
   * @private
   * @param {string} sessionId
   * @param {Session} session
   * @param {Object} message
   */
  async handleKodaRequest(sessionId, session, message) {
    const { id, method, params } = message;
    this.debugLog(`KODA request: ${method}`);

    try {
      let result;

      switch (method) {
        case "fs/read_text_file":
          result = await this.connection.readTextFile({
            sessionId,
            path: params.path,
            line: params.line,
            limit: params.limit,
          });
          break;

        case "fs/write_text_file":
          result = await this.connection.writeTextFile({
            sessionId,
            path: params.path,
            content: params.content,
          });
          break;

        case "terminal/new":
          result = await this.connection.newTerminal({
            sessionId,
            cwd: params.cwd,
          });
          break;

        case "terminal/send_input":
          result = await this.connection.sendTerminalInput({
            sessionId,
            terminalId: params.terminalId,
            input: params.input,
          });
          break;

        case "terminal/close":
          result = await this.connection.closeTerminal({
            sessionId,
            terminalId: params.terminalId,
          });
          break;

        case "session/request_permission":
          result = await this.handlePermissionRequest(sessionId, params);
          break;

        default:
          try {
            result = await this.connection.extMethod(method, params);
          } catch (extErr) {
            this.debugLog(`extMethod failed: ${extErr.message}`);
            session.kodaBridge.sendResponse(id, null, {
              code: -32601,
              message: `Method not found: ${method}`,
            });
            return;
          }
      }

      session.kodaBridge.sendResponse(id, result);
    } catch (error) {
      this.debugLog(`Error handling ${method}: ${error.message}`);
      session.kodaBridge.sendResponse(id, null, {
        code: -32000,
        message: error.message || "Unknown error",
      });
    }
  }

  /**
   * Обработать запрос разрешения от KODA CLI
   * @private
   * @param {string} sessionId
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async handlePermissionRequest(sessionId, params) {
    const permissionParams = {
      sessionId,
      options: params.options || [],
    };

    if (params.toolCall) {
      permissionParams.toolCall = params.toolCall;
    } else {
      permissionParams.toolCall = {
        toolCallId: params.toolCallId || `permission_${Date.now()}`,
        title: params.title || params.message || "Permission required",
        kind: params.kind || "edit",
        status: "pending",
      };
    }

    return this.connection.requestPermission(permissionParams);
  }

  /**
   * Обработать ошибку KODA CLI
   * @private
   * @param {string} sessionId
   * @param {Error} error
   */
  handleKodaError(sessionId, error) {
    this.debugLog(`KODA error for session ${sessionId}: ${error.message}`);
  }

  /**
   * Обработать закрытие KODA CLI
   * @private
   * @param {string} sessionId
   * @param {number} code
   * @param {string} signal
   */
  handleKodaClose(sessionId, code, signal) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.debugLog(
      `Session ${sessionId} closed: code=${code}, signal=${signal}`
    );

    if (session.restarting) {
      this.debugLog(`Session ${sessionId} is restarting, not cleaning up`);
      return;
    }

    this.sessions.delete(sessionId);
    this.modeManager.deleteSession(sessionId);
    this.modelManager.deleteSession(sessionId);
    this.permissionHandler.deleteSession(sessionId);
    this.planCollector.deleteSession(sessionId);
    this.professionalHandler.reset();
  }

  // ===========================================================================
  // Slash Command Handlers
  // ===========================================================================

  /**
   * Обработать slash команду
   * @private
   * @param {string} sessionId
   * @param {string} text
   * @returns {Promise<Object|null>}
   */
  async processSlashCommand(sessionId, text) {
    if (!this.slashCommands.isSlashCommand(text)) {
      return null;
    }

    const command = this.slashCommands.parseCommand(text);
    const context = {
      sessionId,
      mode: this.modeManager.getMode(sessionId),
      currentModel: this.modelManager.getModel(sessionId),
      isAuthenticated: this.modelManager.isAuthenticated,
    };

    this.debugLog(`Processing slash command: ${text}`);

    const result = await this.slashCommands.processCommand(
      command,
      command.args,
      context
    );

    if (result.handled) {
      await this.sendMessage(sessionId, result.response);

      if (result.action) {
        switch (result.action.type) {
          case "mode_change":
            await this.setSessionMode({
              sessionId,
              modeId: result.action.mode,
            });
            break;
          case "model_change":
            await this.unstable_setSessionModel({
              sessionId,
              modelId: result.action.model,
            });
            break;
          case "cancel":
            await this.cancel({ sessionId });
            break;
        }
      }

      return { handled: true };
    }

    return null;
  }

  /**
   * Запустить аутентификацию через /auth
   * @private
   * @param {string} sessionId
   */
  async triggerAuth(sessionId) {
    this.debugLog("Auth requested via slash command");

    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const result = await this.modelManager.authenticate();

      if (result.success && result.alreadyAuthenticated) {
        await this.sendMessage(
          sessionId,
          "\n\nYou are already authenticated! Premium models are available."
        );
        return;
      }

      if (result.pending) {
        const browserStatus = result.browserOpened
          ? "✓ Browser opened"
          : "→ Open: github.com/login/device";

        const text = `
**GitHub Authentication**

# ${result.userCode}

${browserStatus}

Waiting for authorization...`;

        await this.sendMessage(sessionId, text);
        this.pollAuthorizationStatus(
          sessionId,
          result.deviceCode,
          result.interval
        );
      }
    } catch (error) {
      this.debugLog(`Authentication error: ${error.message}`);
      await this.sendMessage(
        sessionId,
        `\n\n❌ Authentication failed: ${error.message}`
      );
    }
  }

  /**
   * Опрос статуса авторизации
   * @private
   * @param {string} sessionId
   * @param {string} deviceCode
   * @param {number} interval
   */
  async pollAuthorizationStatus(sessionId, deviceCode, interval) {
    this.debugLog("Starting authorization polling...");

    try {
      const result = await this.modelManager.pollGitHubDeviceFlow(
        deviceCode,
        interval
      );

      if (result.success) {
        this.modelManager.setAuthenticated(true);
        await this.handleAuthChange(true);

        await this.sendMessage(
          sessionId,
          "\n\n**Authentication successful!** Premium models are now available.\n\nUse `/models` to see the list or `/model <name>` to switch."
        );

        await this.restartKodaSession(sessionId);
      } else {
        await this.sendMessage(
          sessionId,
          `\n\n❌ Authentication failed: ${result.error}`
        );
      }
    } catch (error) {
      this.debugLog(`Polling error: ${error.message}`);
    }
  }

  /**
   * Выход из аккаунта через /logout
   * @private
   * @param {string} sessionId
   */
  async triggerLogout(sessionId) {
    this.debugLog("Logout requested via slash command");

    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const result = await this.modelManager.logout();

      if (result.alreadyLoggedOut) {
        await this.sendMessage(sessionId, "\n\n✅ You are already logged out.");
        return;
      }

      await this.handleAuthChange(false);
      await this.sendMessage(
        sessionId,
        "\n\n✅ **Logged out successfully.** Use `/auth` to log in again."
      );

      await this.restartKodaSession(sessionId);
    } catch (error) {
      this.debugLog(`Logout error: ${error.message}`);
      await this.sendMessage(
        sessionId,
        `\n\n❌ Logout failed: ${error.message}`
      );
    }
  }

  /**
   * Перезапустить KODA CLI сессию
   * @private
   * @param {string} sessionId
   */
  async restartKodaSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.debugLog(`Restarting KODA session ${sessionId}`);

    session.restarting = true;

    if (session.kodaBridge) {
      session.kodaBridge.kill();
    }

    const kodaBridge = new KodaAcpBridge(this.config, {
      onMessage: (message) => this.handleKodaMessage(sessionId, message),
      onClose: (code, signal) => this.handleKodaClose(sessionId, code, signal),
      onError: (error) => this.handleKodaError(sessionId, error),
    });

    try {
      await kodaBridge.spawn(session.cwd, { model: session.model });
      await kodaBridge.createSession(session.cwd, []);
      session.kodaBridge = kodaBridge;
      session.restarting = false;
      this.debugLog(`Session ${sessionId} restarted successfully`);
    } catch (error) {
      session.restarting = false;
      this.debugLog(`Failed to restart session: ${error.message}`);
    }
  }

  /**
   * Обработчик /mode
   * @private
   */
  async handleSlashModeChange(sessionId, modeId) {
    if (!sessionId) return;
    try {
      await this.setSessionMode({ sessionId, modeId });
    } catch (error) {
      this.debugLog(`Failed to change mode: ${error.message}`);
    }
  }

  /**
   * Обработчик /model
   * @private
   */
  async handleSlashModelChange(sessionId, modelId) {
    if (!sessionId) return;
    try {
      await this.unstable_setSessionModel({ sessionId, modelId });
    } catch (error) {
      this.debugLog(`Failed to change model: ${error.message}`);
    }
  }

  /**
   * Обработчик /clear
   * @private
   */
  async handleSlashClear(sessionId) {
    if (!sessionId) return;
    this.debugLog(`Clearing session ${sessionId}`);
    await this.sendMessage(
      sessionId,
      "\n\n🗑️ История сессии очищена (в текущей сессии).\n\nДля полного сброса создайте новую сессию."
    );
  }

  /**
   * Обработчик /retry
   * @private
   */
  async handleSlashRetry(sessionId) {
    if (!sessionId) return;
    this.debugLog(`Retrying last request for session ${sessionId}`);
    await this.sendMessage(
      sessionId,
      "\n\n🔄 Для повтора последнего запроса нажмите кнопку повтора в интерфейсе Zed."
    );
  }

  // ===========================================================================
  // Professional Mode Handlers
  // ===========================================================================

  /**
   * Одобрить план или текущий шаг (Professional mode)
   * @private
   * @param {string} sessionId
   * @returns {{success: boolean, message: string}}
   */
  handlePlanApprove(_sessionId) {
    if (!this.professionalHandler.hasPlan()) {
      return { success: false, message: "Нет активного плана для одобрения" };
    }

    if (this.professionalHandler.isPlanPendingApproval()) {
      const approved = this.professionalHandler.approvePlan();
      if (approved) {
        const step = this.professionalHandler.getCurrentStep();
        return {
          success: true,
          message: `План одобрен. Готов к выполнению шага 1: ${step?.title || ""}`,
        };
      }
      return { success: false, message: "Не удалось одобрить план" };
    }

    if (this.professionalHandler.isStepAwaitingApproval()) {
      const step = this.professionalHandler.approveCurrentStep();
      if (step) {
        return {
          success: true,
          message: `Выполняю шаг: ${step.title}`,
        };
      }
      return { success: false, message: "Не удалось одобрить шаг" };
    }

    return { success: false, message: "Нет ожидающих одобрения элементов" };
  }

  /**
   * Пропустить текущий шаг (Professional mode)
   * @private
   * @param {string} sessionId
   * @returns {{success: boolean, message: string}}
   */
  handlePlanSkip(_sessionId) {
    if (!this.professionalHandler.hasPlan()) {
      return { success: false, message: "Нет активного плана" };
    }

    const currentStep = this.professionalHandler.getCurrentStep();
    if (!currentStep) {
      return { success: false, message: "Нет текущего шага для пропуска" };
    }

    const hasNext = this.professionalHandler.skipCurrentStep();
    if (hasNext) {
      const nextStep = this.professionalHandler.getCurrentStep();
      return {
        success: true,
        message: `Шаг "${currentStep.title}" пропущен. Следующий: ${nextStep?.title || ""}`,
      };
    }

    return {
      success: true,
      message: `Шаг "${currentStep.title}" пропущен. План завершён.`,
    };
  }

  /**
   * Отклонить план (Professional mode)
   * @private
   * @param {string} sessionId
   * @returns {{success: boolean, message: string}}
   */
  handlePlanReject(_sessionId) {
    if (!this.professionalHandler.hasPlan()) {
      return { success: false, message: "Нет активного плана для отклонения" };
    }

    this.professionalHandler.rejectPlan();
    return {
      success: true,
      message: "План отклонён. Вы можете отправить новую задачу.",
    };
  }

  /**
   * Получить прогресс плана (Professional mode)
   * @private
   * @param {string} sessionId
   * @returns {string|null}
   */
  getPlanProgress(_sessionId) {
    if (!this.professionalHandler.hasPlan()) {
      return null;
    }

    return this.professionalHandler.formatPlanForDisplay();
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Извлечь текст из prompt
   * @private
   * @param {string|Array} prompt
   * @returns {string}
   */
  extractPromptText(prompt) {
    if (typeof prompt === "string") {
      return prompt;
    }
    if (Array.isArray(prompt)) {
      return prompt
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    }
    return String(prompt);
  }

  /**
   * Отправить сообщение агента
   * @private
   * @param {string|null} sessionId
   * @param {string} text
   */
  async sendMessage(sessionId, text) {
    if (!text) return;

    const update = {
      sessionUpdate: SESSION_UPDATE.AGENT_MESSAGE_CHUNK,
      content: {
        type: "text",
        text,
      },
    };

    if (sessionId) {
      await this.connection.sessionUpdate({ sessionId, update });
    } else {
      await this.connection.sessionUpdate({ update });
    }
  }
}
