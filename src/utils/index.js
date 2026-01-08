/**
 * Utility Functions
 */

/**
 * Преобразовать значение в boolean
 * @param {any} value
 * @param {boolean} [fallback=false]
 * @returns {boolean}
 */
export function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * Разобрать список аргументов
 * @param {string} raw
 * @returns {string[]}
 */
export function parseArgList(raw) {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fall through
    }
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

/**
 * Разобрать аргументы командной строки сервера
 * @param {string[]} argv
 * @param {Object} [env=process.env]
 * @returns {Object}
 */
export function parseServerArgs(argv, env = process.env) {
  let kodaCommand = env.KODA_CLI_PATH || "koda";
  let extraArgs = parseArgList(env.KODA_CLI_ARGS || "");
  let defaultMode = env.KODA_DEFAULT_MODE || "default";
  let defaultModel = env.KODA_DEFAULT_MODEL || "";
  let debug = parseBool(env.KODA_DEBUG, false);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--koda-path" && argv[i + 1]) {
      kodaCommand = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--koda-args" && argv[i + 1]) {
      extraArgs = parseArgList(argv[i + 1]);
      i++;
      continue;
    }
    if (arg === "--default-mode" && argv[i + 1]) {
      defaultMode = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--default-model" && argv[i + 1]) {
      defaultModel = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--debug") {
      debug = true;
      continue;
    }
    if (arg === "--help") {
      console.log(`KODA Agent Server

Usage:
  node agent_server.mjs [options]

Options:
  --koda-path <path>      Path to the koda CLI (default: koda)
  --koda-args <args>      Extra args as JSON array or space-separated string
  --default-mode <mode>   Default session mode: default, auto_edit, plan, yolo, bypass
  --default-model <model> Default model to use
  --debug                 Enable debug output

Environment Variables:
  KODA_CLI_PATH           Path to koda binary
  KODA_CLI_ARGS           Extra arguments for KODA CLI
  KODA_DEFAULT_MODE       Default session mode
  KODA_DEFAULT_MODEL      Default model
  KODA_DEBUG              Enable debug mode (1/true)
`);
      process.exit(0);
    }
  }

  return {
    kodaCommand,
    extraArgs,
    defaultMode,
    defaultModel,
    debug,
  };
}

/**
 * Логирование в debug режиме
 * @param {boolean} debug
 * @param {...any} args
 */
export function debugLog(debug, ...args) {
  if (debug) {
    console.error("[KODA Agent]", ...args);
  }
}
