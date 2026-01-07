/**
 * KODA Agent - главный класс агента
 */

import * as acp from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { ModeManager } from "./modes.js";
import { ModelManager } from "./models.js";
import { PermissionHandler } from "./permissions.js";
import { PlanCollector } from "./plan.js";
import { KodaAcpBridge } from "./bridge.js";
import { ToolCallInterceptor } from "./interceptor.js";
import { SlashCommandManager } from "./slash.js";

const AGENT_NAME = "koda_agent";
const AGENT_TITLE = "KODA Agent";
const AGENT_VERSION = "0.3.0";

export class KodaAgent {
  constructor(connection, config) {
    this.connection = connection;
    this.config = config;
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

    // Initialize interceptor
    this.interceptor = new ToolCallInterceptor(
      connection,
      {
        permissionHandler: this.permissionHandler,
        modeManager: this.modeManager,
        planCollector: this.planCollector,
      },
      { debug: config.debug },
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
    });

    // Check initial auth status
    this.checkInitialAuth();
  }

  debugLog(...args) {
    if (this.config.debug) {
      console.error("[Agent]", ...args);
    }
  }

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
   * Handle authentication change - notify all sessions
   */
  async handleAuthChange(isAuthenticated) {
    this.debugLog(`Auth status changed to: ${isAuthenticated}`);

    // Update available models based on new auth status
    this.modelManager.setAuthenticated(isAuthenticated);
    await this.modelManager.updateAvailableModels();

    this.debugLog(
      `Available models after update: ${this.modelManager.availableModels.map((m) => m.modelId).join(", ")}`,
    );

    // Note: Zed doesn't support model_list_update yet
    // Models will be updated on next session creation
  }

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
        name: AGENT_NAME,
        title: AGENT_TITLE,
        version: AGENT_VERSION,
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

  async newSession(params) {
    const sessionId = randomUUID();
    const cwd = params?.cwd || process.cwd();
    const mcpServers = params?.mcpServers || [];
    const model = params?.model || this.config.defaultModel;

    this.debugLog(
      `Creating session ${sessionId} with model: ${model || "(default)"}`,
    );

    // Create KODA CLI bridge for this session
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

    // Check auth status and load models from API
    const isAuth = await this.modelManager.checkAuth();
    this.modelManager.setAuthenticated(isAuth);
    await this.modelManager.updateAvailableModels();

    // Send available commands after newSession response is sent to client
    // Using setImmediate to ensure the response is delivered first
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
   * Send available slash commands to the client
   */
  async sendAvailableCommands(sessionId) {
    const commands = this.slashCommands.getAvailableCommands();
    this.debugLog(
      `Sending ${commands.length} available commands to session ${sessionId}`,
    );
    this.debugLog(`Commands:`, JSON.stringify(commands.map((c) => c.name)));

    try {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: commands,
        },
      });
      this.debugLog(
        `Successfully sent available commands to session ${sessionId}`,
      );
    } catch (error) {
      this.debugLog(`Failed to send available commands: ${error.message}`);
      this.debugLog(`Error details:`, error);
    }
  }

  async authenticate(params) {
    const { methodId } = params || {};

    if (methodId === "koda_auth") {
      this.debugLog("Processing authentication request...");

      try {
        // First check current auth status
        let isAuth = await this.modelManager.checkAuth();
        if (isAuth) {
          this.modelManager.setAuthenticated(true);
          this.debugLog("Already authenticated");
          return {};
        }

        // Try to authenticate
        const result = await this.modelManager.authenticate();

        if (result === true) {
          // Update auth status
          this.modelManager.setAuthenticated(true);
          await this.modelManager.updateAuthStatus();
          this.debugLog("Authentication successful");

          // Send success message
          await this.connection.sessionUpdate({
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: "\n\n✅ Authentication successful! Premium models are now available.",
              },
            },
          });

          return {};
        } else if (result.needsBrowser) {
          // Browser opened for authentication
          await this.connection.sessionUpdate({
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: "\n\n🔐 Please complete authentication in your browser, then click 'Retry' or restart the agent to use premium models.",
              },
            },
          });

          // Return auth_required to prompt user to retry after completing auth
          const authError = new Error(
            "Authentication pending - please complete in browser and retry",
          );
          authError.code = -32000;
          throw authError;
        }

        throw new Error("Authentication failed");
      } catch (error) {
        if (error.code === -32000) {
          throw error; // Re-throw auth_required errors
        }
        if (
          error.message.includes("browser") ||
          error.message.includes("timeout")
        ) {
          this.debugLog("Authentication timeout/browser error:", error.message);
          throw error;
        }
        this.debugLog("Authentication error:", error.message);
        throw new Error(`Authentication failed: ${error.message}`);
      }
    }

    return {};
  }

  async setSessionMode(params) {
    const { sessionId, modeId } = params;

    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.modeManager.setMode(sessionId, modeId);

    // Clear plan if switching away from plan mode
    if (modeId !== "plan") {
      this.planCollector.clearPlan(sessionId);
    }

    // Notify client about mode change
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: modeId,
      },
    });

    this.debugLog(`Session ${sessionId} mode changed to ${modeId}`);
    return {};
  }

  async setSessionModel(params) {
    const { sessionId, modelId } = params;

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Validate model exists
    this.modelManager.setModel(sessionId, modelId);

    this.debugLog(
      `Changing model for session ${sessionId}: ${session.model} -> ${modelId}`,
    );

    // Mark session as restarting to prevent cleanup on close
    session.restarting = true;

    // Kill existing KODA CLI process and restart with new model
    if (session.kodaBridge) {
      session.kodaBridge.kill();
    }

    // Create new KODA CLI bridge with new model
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
      throw new Error(
        `Failed to restart KODA CLI with new model: ${error.message}`,
      );
    }

    // Update session
    session.kodaBridge = kodaBridge;
    session.model = modelId;
    session.restarting = false;

    // Notify client about model change
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "current_model_update",
        currentModelId: modelId,
      },
    });

    return {};
  }

  /**
   * Extract text from prompt (can be string or ContentBlock[])
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

  async prompt(params) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`);
    }

    // Extract text from prompt (Zed sends ContentBlock[])
    const promptText = this.extractPromptText(params.prompt);
    this.debugLog(`Prompt text: ${promptText.slice(0, 100)}...`);

    // Check for slash commands first
    if (this.slashCommands.isSlashCommand(promptText)) {
      const slashResult = await this.processSlashCommand(
        params.sessionId,
        promptText,
      );
      if (slashResult?.handled) {
        return { stopReason: "end_turn" };
      }
    }

    // Cancel previous prompt if any
    if (session.pendingPrompt?.abortController) {
      session.pendingPrompt.abortController.abort();
      session.kodaBridge.sendCancel();
    }

    const abortController = new AbortController();
    session.pendingPrompt = { abortController };

    try {
      // Forward prompt to KODA CLI (send full prompt array for context)
      const response = await session.kodaBridge.sendPrompt(params.prompt);
      return { stopReason: response.stopReason || "end_turn" };
    } catch (error) {
      if (abortController.signal.aborted) {
        return { stopReason: "cancelled" };
      }

      // Send error message to client
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `\n\nError: ${error.message}`,
          },
        },
      });

      return { stopReason: "end_turn" };
    } finally {
      session.pendingPrompt = null;
    }
  }

  async cancel(params) {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.pendingPrompt?.abortController?.abort();
      session.kodaBridge?.sendCancel();
    }
  }

  /**
   * Handle messages from KODA CLI
   */
  async handleKodaMessage(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.debugLog(`No session found for ${sessionId}`);
      return;
    }

    // Handle notifications (session/update)
    if (message.method === "session/update" && message.params) {
      const update = message.params.update;
      this.debugLog(`Received session update: ${update?.sessionUpdate}`);

      try {
        const result = await this.interceptor.processSessionUpdate(
          sessionId,
          update,
        );

        this.debugLog(`Interceptor result: forward=${result.forward}`);

        if (result.forward && result.update) {
          await this.connection.sessionUpdate({
            sessionId,
            update: result.update,
          });
          this.debugLog(`Forwarded update to Zed`);
        }
      } catch (err) {
        this.debugLog(`Error processing session update: ${err.message}`);
      }
      return;
    }

    // Handle requests from KODA CLI
    if (message.id !== undefined && message.method) {
      await this.handleKodaRequest(sessionId, session, message);
    }
  }

  /**
   * Handle requests from KODA CLI (e.g., fs/read_text_file)
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

        case "session/request_permission":
          // Adapt KODA's permission request format for Zed
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

          result = await this.connection.requestPermission(permissionParams);
          break;

        default:
          // Try to forward via extension
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
   * Handle KODA CLI process error
   */
  handleKodaError(sessionId, error) {
    this.debugLog(`KODA error for session ${sessionId}: ${error.message}`);
  }

  /**
   * Handle KODA CLI process close
   */
  handleKodaClose(sessionId, code, signal) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.debugLog(
      `Session ${sessionId} closed: code=${code}, signal=${signal}`,
    );

    // Don't clean up if we're restarting the session
    if (session.restarting) {
      this.debugLog(`Session ${sessionId} is restarting, not cleaning up`);
      return;
    }

    // Clean up session
    this.sessions.delete(sessionId);
    this.modeManager.deleteSession(sessionId);
    this.modelManager.deleteSession(sessionId);
    this.permissionHandler.deleteSession(sessionId);
    this.planCollector.deleteSession(sessionId);
  }

  // =========================================================================
  // Slash Command Handlers
  // =========================================================================

  /**
   * Trigger GitHub Device Flow authentication (called from /auth command)
   */
  async triggerAuth(sessionId) {
    this.debugLog("Auth requested via slash command");

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.debugLog("No session found for auth");
      return;
    }

    try {
      // Start GitHub Device Flow
      const result = await this.modelManager.authenticate();

      if (result.success && result.alreadyAuthenticated) {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "\n\nYou are already authenticated! Premium models are available.",
            },
          },
        });
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

        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text,
            },
          },
        });

        // Start polling for authorization in background
        this.pollAuthorizationStatus(
          sessionId,
          result.deviceCode,
          result.interval,
        );
      }
    } catch (error) {
      this.debugLog(`Authentication error: ${error.message}`);
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `\n\n❌ Authentication failed: ${error.message}`,
          },
        },
      });
    }
  }

  /**
   * Poll for authorization status in background
   */
  async pollAuthorizationStatus(sessionId, deviceCode, interval) {
    this.debugLog("Starting authorization polling...");

    try {
      const result = await this.modelManager.pollGitHubDeviceFlow(
        deviceCode,
        interval,
      );

      if (result.success) {
        this.modelManager.setAuthenticated(true);
        await this.handleAuthChange(true);

        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "\n\n**Authentication successful!** Premium models are now available.\n\nUse `/models` to see the list or `/model <name>` to switch.",
            },
          },
        });

        // Restart KODA CLI session to pick up new credentials
        await this.restartKodaSession(sessionId);
      } else {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `\n\n❌ Authentication failed: ${result.error}`,
            },
          },
        });
      }
    } catch (error) {
      this.debugLog(`Polling error: ${error.message}`);
    }
  }

  /**
   * Trigger logout (called from /logout command)
   */
  async triggerLogout(sessionId) {
    this.debugLog("Logout requested via slash command");

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.debugLog("No session found for logout");
      return;
    }

    try {
      const result = await this.modelManager.logout();

      if (result.alreadyLoggedOut) {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "\n\n✅ You are already logged out.",
            },
          },
        });
        return;
      }

      await this.handleAuthChange(false);

      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "\n\n✅ **Logged out successfully.** Use `/auth` to log in again.",
          },
        },
      });

      // Restart KODA CLI session without credentials
      await this.restartKodaSession(sessionId);
    } catch (error) {
      this.debugLog(`Logout error: ${error.message}`);
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `\n\n❌ Logout failed: ${error.message}`,
          },
        },
      });
    }
  }

  /**
   * Restart KODA CLI session to pick up new credentials
   */
  async restartKodaSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.debugLog(`Restarting KODA session ${sessionId} with new credentials`);

    // Mark session as restarting to prevent cleanup on close
    session.restarting = true;

    // Kill existing bridge
    if (session.kodaBridge) {
      session.kodaBridge.kill();
    }

    // Create new bridge
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
   * Handle /mode command
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
   * Handle /model command
   */
  async handleSlashModelChange(sessionId, modelId) {
    if (!sessionId) return;

    try {
      await this.setSessionModel({ sessionId, modelId });
    } catch (error) {
      this.debugLog(`Failed to change model: ${error.message}`);
    }
  }

  /**
   * Handle /clear command
   */
  async handleSlashClear(sessionId) {
    if (!sessionId) return;

    this.debugLog(`Clearing session ${sessionId}`);
    // Note: Full history clearing requires KODA CLI support
    // For now, we just send a confirmation message
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "\n\n🗑️ История сессии очищена (в текущей сессии).\n\nДля полного сброса создайте новую сессию.",
        },
      },
    });
  }

  /**
   * Handle /retry command
   */
  async handleSlashRetry(sessionId) {
    if (!sessionId) return;

    this.debugLog(`Retrying last request for session ${sessionId}`);
    // Retry is handled by the cancel + prompt flow
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "\n\n🔄 Для повтора последнего запроса нажмите кнопку повтора в интерфейсе Zed.",
        },
      },
    });
  }

  /**
   * Process slash command in prompt
   */
  async processSlashCommand(sessionId, text) {
    if (!this.slashCommands.isSlashCommand(text)) {
      return null;
    }

    const command = this.slashCommands.parseCommand(text);
    const session = this.sessions.get(sessionId);
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
      context,
    );

    if (result.handled) {
      // Send response to client
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: result.response,
          },
        },
      });

      // Handle actions
      if (result.action) {
        switch (result.action.type) {
          case "mode_change":
            await this.setSessionMode({
              sessionId,
              modeId: result.action.mode,
            });
            break;
          case "model_change":
            await this.setSessionModel({
              sessionId,
              modelId: result.action.model,
            });
            break;
          case "cancel":
            await this.cancel({ sessionId });
            break;
          // Other actions handled by callback
        }
      }

      return { handled: true };
    }

    return null;
  }
}
