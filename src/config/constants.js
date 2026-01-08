/**
 * Application Constants
 * Централизованное хранилище всех констант приложения
 */

// =============================================================================
// Agent Info
// =============================================================================

export const AGENT = {
  NAME: "koda_agent",
  TITLE: "KODA Agent",
  VERSION: "0.4.0",
};

// =============================================================================
// GitHub OAuth
// =============================================================================

export const GITHUB = {
  CLIENT_ID: "Ov23li5pZhE4aeH5fTSE",
  DEVICE_CODE_URL: "https://github.com/login/device/code",
  ACCESS_TOKEN_URL: "https://github.com/login/oauth/access_token",
  DEVICE_URL: "https://github.com/login/device",
  SCOPE: "read:user",
};

// =============================================================================
// KODA API
// =============================================================================

export const KODA_API = {
  MODELS_URL: "https://api.kodacode.ru/v1/models",
  MODELS_CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
};

// =============================================================================
// File Paths
// =============================================================================

import path from "node:path";
import os from "node:os";

export const PATHS = {
  CONFIG_DIR: path.join(os.homedir(), ".config", "koda"),
  get CREDENTIALS_FILE() {
    return path.join(this.CONFIG_DIR, "credentials.json");
  },
};

// =============================================================================
// Session Modes
// =============================================================================

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
    id: "professional",
    name: "Professional / Профессионал",
    description: "Plan first, then execute step by step with approval",
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

export const MODE_IDS = MODES.map((m) => m.id);

// =============================================================================
// ACP Session Update Types
// =============================================================================

export const SESSION_UPDATE = {
  AGENT_MESSAGE_CHUNK: "agent_message_chunk",
  USER_MESSAGE_CHUNK: "user_message_chunk",
  TOOL_CALL: "tool_call",
  TOOL_CALL_UPDATE: "tool_call_update",
  PLAN: "plan",
  AVAILABLE_COMMANDS: "available_commands_update",
  CURRENT_MODE: "current_mode_update",
};

// =============================================================================
// Tool Types for Permission Handling
// =============================================================================

export const TOOL_TYPE = {
  READ: "read",
  FILE_EDIT: "file_edit",
  FILE_DELETE: "file_delete",
  COMMAND_EXECUTE: "command_execute",
  DANGEROUS_COMMAND: "dangerous_command",
  OTHER: "other",
};

// =============================================================================
// Dangerous Command Patterns
// =============================================================================

export const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\b/,
  /\bsudo\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bmkfs\b/,
  /\bdd\b/,
  /\b>\s*\/dev\//,
  /\bformat\b/,
  /\bfdisk\b/,
];

// =============================================================================
// Timeouts
// =============================================================================

export const TIMEOUTS = {
  KILL_PROCESS_MS: 5000,
  AUTH_POLL_MAX_ATTEMPTS: 60,
  AUTH_POLL_INTERVAL_SEC: 5,
};

// =============================================================================
// Default Model
// =============================================================================

export const DEFAULT_MODEL = {
  modelId: "KodaAgent",
  name: "KodaAgent",
  description: "Default KODA model",
  requiresAuth: false,
};
