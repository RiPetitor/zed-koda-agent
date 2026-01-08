/**
 * Slash Command Manager - обработка команд через "/"
 */

/**
 * Определения всех slash команд
 */
const COMMANDS = [
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
 * Описания режимов
 */
const MODE_DESCRIPTIONS = {
  default: "Default — спрашивать разрешение на запись",
  auto_edit: "Auto Edit — автоматически разрешать изменения файлов",
  plan: "Plan Mode — только планирование, без выполнения",
  yolo: "Don't Ask — автоматически разрешать всё, кроме опасных команд",
  bypass: "Bypass — полный доступ без проверок",
};

const VALID_MODES = ["default", "auto_edit", "plan", "yolo", "bypass"];

/**
 * Slash Command Manager
 */
export class SlashCommandManager {
  /**
   * @param {Object} [options={}]
   * @param {boolean} [options.debug=false]
   * @param {Function} [options.onAuthRequest]
   * @param {Function} [options.onLogoutRequest]
   * @param {Function} [options.onModeChange]
   * @param {Function} [options.onModelChange]
   * @param {Function} [options.onClear]
   * @param {Function} [options.onRetry]
   * @param {Function} [options.getAvailableModelsList]
   */
  constructor(options = {}) {
    /** @type {boolean} */
    this.debug = options.debug || false;

    /** @type {Function} */
    this.onAuthRequest = options.onAuthRequest || (() => {});

    /** @type {Function} */
    this.onLogoutRequest = options.onLogoutRequest || (() => {});

    /** @type {Function} */
    this.onModeChange = options.onModeChange || (() => {});

    /** @type {Function} */
    this.onModelChange = options.onModelChange || (() => {});

    /** @type {Function} */
    this.onClear = options.onClear || (() => {});

    /** @type {Function} */
    this.onRetry = options.onRetry || (() => {});

    /** @type {Function} */
    this.getAvailableModelsList = options.getAvailableModelsList || (() => []);
  }

  /**
   * @private
   */
  debugLog(...args) {
    if (this.debug) {
      console.error("[SlashCommands]", ...args);
    }
  }

  /**
   * Проверить, является ли текст slash командой
   * @param {string} text
   * @returns {boolean}
   */
  isSlashCommand(text) {
    return text.trim().startsWith("/");
  }

  /**
   * Разобрать команду из текста
   * @param {string} text
   * @returns {{name: string, args: string[]}}
   */
  parseCommand(text) {
    const trimmed = text.trim();
    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);
    return { name, args };
  }

  /**
   * Получить текст справки
   * @returns {string}
   */
  getHelpText() {
    const lines = ["**Доступные команды:**", ""];

    for (const cmd of COMMANDS) {
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
   * @param {Object} command - Parsed command
   * @param {string[]} args - Command arguments
   * @param {Object} [context={}] - Session context
   * @returns {Promise<{handled: boolean, response?: string, action?: Object}>}
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
          response: "",
          action: { type: "auth" },
        };

      case "logout":
        this.debugLog("Logout command triggered");
        await this.onLogoutRequest(sessionId);
        return {
          handled: true,
          response: "",
          action: { type: "logout" },
        };

      case "mode":
        return this.handleModeCommand(args, sessionId, mode);

      case "model":
        return this.handleModelCommand(args, sessionId, currentModel);

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
        return this.handleStatusCommand(mode, currentModel, isAuthenticated);

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
        return {
          handled: true,
          response: `**Доступные режимы:**\n\n${VALID_MODES.join(", ")}`,
        };

      case "models":
        return this.handleModelsCommand(currentModel);

      default:
        return {
          handled: false,
          response: `❌ Неизвестная команда: \`/${name}\`\n\nВведите \`/help\` для списка команд`,
        };
    }
  }

  /**
   * Обработать команду /mode
   * @private
   */
  async handleModeCommand(args, sessionId, currentMode) {
    if (args.length === 0) {
      const description = MODE_DESCRIPTIONS[currentMode] || "Неизвестный режим";
      return {
        handled: true,
        response: `**Текущий режим:** ${currentMode || "default"}\n\n${description}\n\nИзменить: \`/mode <режим>\``,
      };
    }

    const newMode = args[0].toLowerCase();

    if (!VALID_MODES.includes(newMode)) {
      return {
        handled: true,
        response: `❌ Неизвестный режим: \`${newMode}\`\n\nДоступные режимы: ${VALID_MODES.join(", ")}`,
      };
    }

    await this.onModeChange(sessionId, newMode);
    return {
      handled: true,
      response: `✅ Режим изменён на: \`${newMode}\``,
      action: { type: "mode_change", mode: newMode },
    };
  }

  /**
   * Обработать команду /model
   * @private
   */
  async handleModelCommand(args, sessionId, currentModel) {
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
  }

  /**
   * Обработать команду /status
   * @private
   */
  handleStatusCommand(mode, currentModel, isAuthenticated) {
    const authStatus = isAuthenticated
      ? "✅ Аутентифицирован"
      : "⚪ Без аутентификации";

    return {
      handled: true,
      response: `**Статус сессии:**\n\n• Модель: \`${currentModel || "KodaAgent"}\`\n• Режим: \`${mode || "default"}\`\n• Аутентификация: ${authStatus}`,
    };
  }

  /**
   * Обработать команду /models
   * @private
   */
  handleModelsCommand(currentModel) {
    const models = this.getAvailableModelsList();

    if (models.length === 0) {
      return {
        handled: true,
        response: "📋 Список моделей недоступен. Попробуйте позже.",
      };
    }

    const modelList = models
      .map((m, i) => `${i + 1}. \`${m.modelId}\`${m.requiresAuth ? " 🔐" : ""}`)
      .join("\n");

    return {
      handled: true,
      response: `**Доступные модели:**\n\n${modelList}\n\nТекущая: \`${currentModel || models[0]?.modelId}\`\n\nСменить: \`/model <ID>\``,
    };
  }

  /**
   * Проверить, обрабатывается ли команда локально
   * @param {string} text
   * @returns {boolean}
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
   * Получить список команд для ACP
   * @returns {Array}
   */
  getAvailableCommands() {
    return COMMANDS.map((cmd) => {
      const acpCommand = {
        name: cmd.name,
        description: cmd.description,
      };

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
