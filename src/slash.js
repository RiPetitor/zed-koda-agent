/**
 * Slash Command Manager - обработка команд через "/" (аналог Claude Code)
 *
 * Поддерживаемые команды:
 * /help - показать справку
 * /auth - запустить аутентификацию
 * /mode [режим] - показать/выбрать режим
 * /model [модель] - показать/выбрать модель
 * /clear - очистить историю
 * /plan - показать текущий план
 * /status - показать статус сессии
 * /retry - повторить последний запрос
 */

export class SlashCommandManager {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.onAuthRequest = options.onAuthRequest || (() => {});
    this.onLogoutRequest = options.onLogoutRequest || (() => {});
    this.onModeChange = options.onModeChange || (() => {});
    this.onModelChange = options.onModelChange || (() => {});
    this.onClear = options.onClear || (() => {});
    this.onRetry = options.onRetry || (() => {});
    this.getAvailableModelsList = options.getAvailableModelsList || (() => []);
  }

  debugLog(...args) {
    if (this.debug) {
      console.error("[SlashCommands]", ...args);
    }
  }

  /**
   * Все доступные slash команды
   */
  static COMMANDS = [
    {
      name: "help",
      description: "Показать справку по командам",
      usage: "/help",
      arguments: [],
    },
    {
      name: "auth",
      description: "Войти через GitHub для доступа к премиум моделям",
      usage: "/auth",
      arguments: [],
    },
    {
      name: "logout",
      description: "Выйти из аккаунта GitHub",
      usage: "/logout",
      arguments: [],
    },
    {
      name: "mode",
      description: "Показать/изменить режим работы",
      usage: "/mode [режим]",
      arguments: [
        {
          name: "mode",
          required: false,
          description: "Режим: default, auto_edit, plan, yolo, bypass",
        },
      ],
    },
    {
      name: "model",
      description: "Показать/изменить модель",
      usage: "/model [модель]",
      arguments: [
        {
          name: "model",
          required: false,
          description: "ID модели (например: gemini-2.0-flash)",
        },
      ],
    },
    {
      name: "clear",
      description: "Очистить историю сессии",
      usage: "/clear",
      arguments: [],
    },
    {
      name: "plan",
      description: "Показать текущий план",
      usage: "/plan",
      arguments: [],
    },
    {
      name: "status",
      description: "Показать статус сессии",
      usage: "/status",
      arguments: [],
    },
    {
      name: "retry",
      description: "Повторить последний запрос",
      usage: "/retry",
      arguments: [],
    },
    {
      name: "cancel",
      description: "Отменить текущую операцию",
      usage: "/cancel",
      arguments: [],
    },
    {
      name: "modes",
      description: "Показать все доступные режимы",
      usage: "/modes",
      arguments: [],
    },
    {
      name: "models",
      description: "Показать все доступные модели",
      usage: "/models",
      arguments: [],
    },
  ];

  /**
   * Проврить, является ли текст slash командой
   */
  isSlashCommand(text) {
    return text.trim().startsWith("/");
  }

  /**
   * Извлечь имя команды и аргументы из текста
   */
  parseCommand(text) {
    const trimmed = text.trim();
    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);
    return { name, args };
  }

  /**
   * Получить справку по всем командам
   */
  getHelpText() {
    const commands = SlashCommandManager.COMMANDS;

    const lines = ["**Доступные команды:**", ""];

    for (const cmd of commands) {
      lines.push(`- \`${cmd.usage}\` — ${cmd.description}`);
    }

    lines.push("");
    lines.push("**Примеры:**");
    lines.push("- `/mode plan` — переключиться в режим планирования");
    lines.push("- `/model deepseek-v3.2` — выбрать модель");
    lines.push("- `/models` — список доступных моделей");

    return lines.join("\n");
  }

  /**
   * Обработать slash команду
   * Возвращает: { handled: boolean, response?: string, action?: object }
   */
  async processCommand(command, args, context = {}) {
    const { name } = command;
    const { sessionId, mode, currentModel, isAuthenticated } = context;

    this.debugLog(`Processing command: /${name} with args:`, args);

    switch (name) {
      case "help":
        return {
          handled: true,
          response: this.getHelpText(),
        };

      case "auth":
        this.debugLog("Auth command triggered");
        await this.onAuthRequest(sessionId);
        return {
          handled: true,
          response: "", // Response is sent by triggerAuth
          action: { type: "auth" },
        };

      case "logout":
        this.debugLog("Logout command triggered");
        await this.onLogoutRequest(sessionId);
        return {
          handled: true,
          response: "", // Response is sent by triggerLogout
          action: { type: "logout" },
        };

      case "mode":
        if (args.length === 0) {
          const modeNames = {
            default: "Default — спрашивать разрешение на запись",
            auto_edit: "Auto Edit — автоматически разрешать изменения файлов",
            plan: "Plan Mode — только планирование, без выполнения",
            yolo: "Don't Ask — автоматически разрешать всё, кроме опасных команд",
            bypass: "Bypass — полный доступ без проверок",
          };
          return {
            handled: true,
            response: `**Текущий режим:** ${mode || "default"}\n\n${modeNames[mode] || "Неизвестный режим"}\n\nИзменить: \`/mode <режим>\``,
          };
        }

        const newMode = args[0].toLowerCase();
        const validModes = ["default", "auto_edit", "plan", "yolo", "bypass"];

        if (!validModes.includes(newMode)) {
          return {
            handled: true,
            response: `❌ Неизвестный режим: \`${newMode}\`\n\nДоступные режимы: ${validModes.join(", ")}`,
          };
        }

        await this.onModeChange(sessionId, newMode);
        return {
          handled: true,
          response: `✅ Режим изменён на: \`${newMode}\``,
          action: { type: "mode_change", mode: newMode },
        };

      case "model":
        if (args.length === 0) {
          return {
            handled: true,
            response: `**Текущая модель:** ${currentModel || "KodaAgent"}\n\nИзменить: \`/model <модель>\`\n\nСписок моделей: \`/models\``,
          };
        }

        const newModel = args[0];
        await this.onModelChange(sessionId, newModel);
        return {
          handled: true,
          response: `✅ Модель изменена на: \`${newModel}\``,
          action: { type: "model_change", model: newModel },
        };

      case "clear":
        await this.onClear(sessionId);
        return {
          handled: true,
          response: "🗑️ История сессии очищена",
          action: { type: "clear" },
        };

      case "plan":
        return {
          handled: true,
          response:
            "📋 Для просмотра плана используйте панель Plan Mode в интерфейсе Zed.",
        };

      case "status":
        const authStatus = isAuthenticated
          ? "✅ Аутентифицирован"
          : "⚪ Без аутентификации";
        return {
          handled: true,
          response: `**Статус сессии:**\n\n• Модель: \`${currentModel || "KodaAgent"}\`\n• Режим: \`${mode || "default"}\`\n• Аутентификация: ${authStatus}`,
        };

      case "retry":
        await this.onRetry(sessionId);
        return {
          handled: true,
          response: "🔄 Повторяю последний запрос...",
          action: { type: "retry" },
        };

      case "cancel":
        return {
          handled: true,
          response: "❌ Операция отменена",
          action: { type: "cancel" },
        };

      case "modes":
        const modeInfo = SlashCommandManager.COMMANDS.find(
          (c) => c.name === "mode",
        );
        return {
          handled: true,
          response: `**Доступные режимы:**\n\n${modeInfo.arguments[0].description}`,
        };

      case "models": {
        const models = this.getAvailableModelsList();
        if (models.length === 0) {
          return {
            handled: true,
            response: "📋 Список моделей недоступен. Попробуйте позже.",
          };
        }
        const modelList = models
          .map(
            (m, i) =>
              `${i + 1}. \`${m.modelId}\`${m.requiresAuth ? " 🔐" : ""}`,
          )
          .join("\n");
        return {
          handled: true,
          response: `**Доступные модели:**\n\n${modelList}\n\nТекущая: \`${currentModel || models[0]?.modelId}\`\n\nСменить: \`/model <ID>\``,
        };
      }

      default:
        return {
          handled: false,
          response: `❌ Неизвестная команда: \`/${name}\`\n\nВведите \`/help\` для списка команд`,
        };
    }
  }

  /**
   * Проверить, нужно ли обрабатывать команду локально или отправлять агенту
   */
  shouldHandleLocally(text) {
    if (!this.isSlashCommand(text)) return false;

    const { name } = this.parseCommand(text);
    const localCommands = [
      "help",
      "auth",
      "logout",
      "mode",
      "model",
      "clear",
      "plan",
      "status",
      "retry",
      "cancel",
      "modes",
      "models",
    ];

    return localCommands.includes(name);
  }

  /**
   * Получить список команд в формате ACP AvailableCommand[]
   * Для отправки через session/update с sessionUpdate: "available_commands_update"
   */
  getAvailableCommands() {
    return SlashCommandManager.COMMANDS.map((cmd) => {
      const acpCommand = {
        name: cmd.name,
        description: cmd.description,
      };

      // Добавляем input hint для команд с аргументами
      if (cmd.arguments && cmd.arguments.length > 0) {
        const arg = cmd.arguments[0];
        acpCommand.input = {
          hint: arg.description || `<${arg.name}>`,
        };
      }

      return acpCommand;
    });
  }
}
