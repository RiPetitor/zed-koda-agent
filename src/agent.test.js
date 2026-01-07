/**
 * Unit tests for KODA Agent modules
 */

// Import all modules at once
import { ModeManager, MODES } from "./modes.js";
import { ModelManager, FREE_MODELS, PREMIUM_MODELS } from "./models.js";
import { PlanCollector } from "./plan.js";
import { PermissionHandler } from "./permissions.js";
import { SlashCommandManager } from "./slash.js";
import { parseBool, parseArgList, parseServerArgs, debugLog } from "./utils.js";

// Mock console.error for debugLog tests
const originalError = console.error;
let errorCalled = false;

beforeEach(() => {
  errorCalled = false;
  console.error = (...args) => {
    errorCalled = true;
  };
});

afterAll(() => {
  console.error = originalError;
});

describe("Utils", () => {
  test("parseBool returns true for truthy values", () => {
    expect(parseBool("true")).toBe(true);
    expect(parseBool("1")).toBe(true);
    expect(parseBool("yes")).toBe(true);
    expect(parseBool("on")).toBe(true);
  });

  test("parseBool returns false for falsy values", () => {
    expect(parseBool("false")).toBe(false);
    expect(parseBool("0")).toBe(false);
    expect(parseBool("no")).toBe(false);
    expect(parseBool("off")).toBe(false);
  });

  test("parseBool returns fallback for empty values", () => {
    expect(parseBool("")).toBe(false);
    expect(parseBool(null, true)).toBe(true);
    expect(parseBool(undefined, true)).toBe(true);
  });

  test("parseArgList returns empty array for empty input", () => {
    expect(parseArgList("")).toEqual([]);
    expect(parseArgList(null)).toEqual([]);
  });

  test("parseArgList parses JSON arrays", () => {
    expect(parseArgList('["arg1", "arg2"]')).toEqual(["arg1", "arg2"]);
  });

  test("parseArgList parses space-separated strings", () => {
    expect(parseArgList("arg1 arg2 arg3")).toEqual(["arg1", "arg2", "arg3"]);
  });

  test("parseServerArgs parses command line arguments", () => {
    const args = parseServerArgs(
      ["--koda-path", "/custom/koda", "--default-mode", "plan", "--debug"],
      {},
    );

    expect(args.kodaCommand).toBe("/custom/koda");
    expect(args.defaultMode).toBe("plan");
    expect(args.debug).toBe(true);
  });

  test("parseServerArgs uses environment variables as defaults", () => {
    const args = parseServerArgs([], {
      KODA_CLI_PATH: "/env/koda",
      KODA_DEFAULT_MODEL: "gemini-2.0-flash",
    });

    expect(args.kodaCommand).toBe("/env/koda");
    expect(args.defaultModel).toBe("gemini-2.0-flash");
  });

  test("debugLog logs when debug is true", () => {
    debugLog(true, "test message");
    expect(errorCalled).toBe(true);
  });

  test("debugLog does not log when debug is false", () => {
    debugLog(false, "test message");
    expect(errorCalled).toBe(false);
  });
});

describe("Modes", () => {
  test("MODES contains all expected modes", () => {
    expect(MODES.map((m) => m.id)).toEqual([
      "default",
      "auto_edit",
      "plan",
      "yolo",
      "bypass",
    ]);
  });

  test("ModeManager stores and retrieves modes", () => {
    const manager = new ModeManager();
    manager.setMode("session1", "plan");
    manager.setMode("session2", "bypass");

    expect(manager.getMode("session1")).toBe("plan");
    expect(manager.getMode("session2")).toBe("bypass");
    expect(manager.getMode("unknown")).toBe("default");
  });

  test("ModeManager throws for unknown modes", () => {
    const manager = new ModeManager();
    expect(() => manager.setMode("session", "unknown")).toThrow("Unknown mode");
  });

  test("getModeConfig returns correct structure", () => {
    const manager = new ModeManager();
    const config = manager.getModeConfig("plan");

    expect(config).toHaveProperty("availableModes");
    expect(config).toHaveProperty("currentModeId", "plan");
    expect(config.availableModes).toHaveLength(5);
  });
});

describe("Models", () => {
  test("FREE_MODELS contains KodaAgent", () => {
    expect(FREE_MODELS).toContainEqual({
      modelId: "KodaAgent",
      name: "KodaAgent",
      description: expect.any(String),
    });
  });

  test("PREMIUM_MODELS contains Gemini models", () => {
    const modelIds = PREMIUM_MODELS.map((m) => m.modelId);
    expect(modelIds).toContain("gemini-2.5-pro");
    expect(modelIds).toContain("gemini-2.0-flash");
  });

  test("ModelManager shows all models (KODA handles auth)", () => {
    const manager = new ModelManager("", { debug: false });
    // Now we show all models - KODA CLI handles auth internally
    expect(manager.isAuthenticated).toBe(false);
    expect(manager.loadAvailableModels().length).toBe(
      FREE_MODELS.length + PREMIUM_MODELS.length,
    );

    // Verify premium models are marked as requiring auth
    const models = manager.loadAvailableModels();
    const premiumModels = models.filter((m) => m.modelId !== "KodaAgent");
    expect(premiumModels.length).toBe(PREMIUM_MODELS.length);
  });

  test("ModelManager switches to all models when authenticated", () => {
    const manager = new ModelManager("", { debug: false });
    manager.setAuthenticated(true);
    expect(manager.loadAvailableModels().length).toBe(
      FREE_MODELS.length + PREMIUM_MODELS.length,
    );
  });

  test("ModelManager stores per-session models", () => {
    const manager = new ModelManager("", { debug: false });
    manager.setAuthenticated(true); // Enable premium models
    manager.setModel("session1", "gemini-2.0-flash");
    manager.setModel("session2", "gemini-1.5-pro");

    expect(manager.getModel("session1")).toBe("gemini-2.0-flash");
    expect(manager.getModel("session2")).toBe("gemini-1.5-pro");
  });

  test("setModel throws for unknown models", () => {
    const manager = new ModelManager("", { debug: false });
    expect(() => manager.setModel("session", "unknown-model")).toThrow(
      "Unknown model",
    );
  });
});

describe("PlanCollector", () => {
  test("adds entries to plan", () => {
    const collector = new PlanCollector({ debug: false });
    collector.addEntry("session1", {
      title: "Read file",
      toolCallId: "1",
      kind: "read",
    });
    collector.addEntry("session1", {
      title: "Write file",
      toolCallId: "2",
      kind: "edit",
    });

    const result = collector.getPlan("session1");
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Read file");
    expect(result[1].content).toBe("Write file");
  });

  test("returns empty array for unknown session", () => {
    const collector = new PlanCollector({ debug: false });
    expect(collector.getPlan("unknown")).toEqual([]);
  });

  test("clears plan for session", () => {
    const collector = new PlanCollector({ debug: false });
    collector.addEntry("session1", {
      title: "Test",
      toolCallId: "1",
      kind: "read",
    });
    collector.clearPlan("session1");

    expect(collector.getPlan("session1")).toEqual([]);
  });

  test("sets priority based on tool kind", () => {
    const collector = new PlanCollector({ debug: false });
    collector.addEntry("session", {
      title: "Command",
      toolCallId: "1",
      kind: "execute",
    });
    collector.addEntry("session", {
      title: "Read",
      toolCallId: "2",
      kind: "read",
    });

    const result = collector.getPlan("session");
    expect(result[0].priority).toBe("high");
    expect(result[1].priority).toBe("medium");
  });
});

describe("PermissionHandler", () => {
  test("classifies tool types correctly", () => {
    const handler = new PermissionHandler(
      { requestPermission: () => {} },
      { debug: false },
    );

    expect(handler.getToolType({ kind: "read" })).toBe("read");
    expect(handler.getToolType({ kind: "edit" })).toBe("file_edit");
    expect(handler.getToolType({ kind: "delete" })).toBe("file_delete");
    expect(handler.getToolType({ kind: "execute" })).toBe("command_execute");
  });

  test("detects dangerous commands", () => {
    const handler = new PermissionHandler(
      { requestPermission: () => {} },
      { debug: false },
    );

    const dangerousTool = {
      kind: "execute",
      rawInput: { command: "rm -rf /tmp/*" },
    };
    expect(handler.getToolType(dangerousTool)).toBe("dangerous_command");

    const safeTool = {
      kind: "execute",
      rawInput: { command: "echo hello" },
    };
    expect(handler.getToolType(safeTool)).toBe("command_execute");
  });

  test("needsPermission returns false for read operations", () => {
    const handler = new PermissionHandler(
      { requestPermission: () => {} },
      { debug: false },
    );
    const tool = { kind: "read", title: "Read file" };

    expect(handler.needsPermission("session", "default", tool)).toBe(false);
    expect(handler.needsPermission("session", "bypass", tool)).toBe(false);
    expect(handler.needsPermission("session", "plan", tool)).toBe(false);
  });

  test("bypass mode never needs permission", () => {
    const handler = new PermissionHandler(
      { requestPermission: () => {} },
      { debug: false },
    );
    const tool = { kind: "edit", title: "Write file" };

    expect(handler.needsPermission("session", "bypass", tool)).toBe(false);
  });

  test("plan mode always needs permission for writes", () => {
    const handler = new PermissionHandler(
      { requestPermission: () => {} },
      { debug: false },
    );
    const tool = { kind: "edit", title: "Write file" };

    expect(handler.needsPermission("session", "plan", tool)).toBe(true);
  });

  test("alwaysAllowed prevents permission requests", () => {
    const handler = new PermissionHandler(
      { requestPermission: () => {} },
      { debug: false },
    );

    // Simulate "Allow Always" was clicked
    handler.alwaysAllowedTypes.set("session", new Set(["file_edit"]));

    const tool = { kind: "edit", title: "Write file", toolCallId: "1" };
    expect(handler.needsPermission("session", "default", tool)).toBe(false);
  });
});

describe("SlashCommandManager", () => {
  test("isSlashCommand detects commands", () => {
    const manager = new SlashCommandManager({ debug: false });

    expect(manager.isSlashCommand("/help")).toBe(true);
    expect(manager.isSlashCommand("/auth")).toBe(true);
    expect(manager.isSlashCommand("/mode plan")).toBe(true);
    expect(manager.isSlashCommand("normal text")).toBe(false);
    expect(manager.isSlashCommand("  /command")).toBe(true);
  });

  test("parseCommand extracts name and args", () => {
    const manager = new SlashCommandManager({ debug: false });

    const result1 = manager.parseCommand("/help");
    expect(result1.name).toBe("help");
    expect(result1.args).toEqual([]);

    const result2 = manager.parseCommand("/mode plan");
    expect(result2.name).toBe("mode");
    expect(result2.args).toEqual(["plan"]);

    const result3 = manager.parseCommand("/model gemini-2.0-flash");
    expect(result3.name).toBe("model");
    expect(result3.args).toEqual(["gemini-2.0-flash"]);
  });

  test("COMMANDS contains all expected commands", () => {
    const names = SlashCommandManager.COMMANDS.map((c) => c.name);
    expect(names).toContain("help");
    expect(names).toContain("auth");
    expect(names).toContain("mode");
    expect(names).toContain("model");
    expect(names).toContain("clear");
    expect(names).toContain("plan");
    expect(names).toContain("status");
    expect(names).toContain("retry");
  });

  test("getHelpText returns formatted help", () => {
    const manager = new SlashCommandManager({ debug: false });
    const help = manager.getHelpText();

    expect(help).toContain("/help");
    expect(help).toContain("/auth");
    expect(help).toContain("Доступные команды");
  });

  test("processCommand /help returns help text", async () => {
    const manager = new SlashCommandManager({ debug: false });
    const result = await manager.processCommand(
      { name: "help", args: [] },
      [],
      {},
    );

    expect(result.handled).toBe(true);
    expect(result.response).toContain("/help");
  });

  test("processCommand /mode without args returns current mode", async () => {
    const manager = new SlashCommandManager({ debug: false });
    const result = await manager.processCommand(
      { name: "mode", args: [] },
      [],
      { mode: "plan" },
    );

    expect(result.handled).toBe(true);
    expect(result.response).toContain("plan");
  });

  test("processCommand /mode with valid mode returns success", async () => {
    const manager = new SlashCommandManager({ debug: false });

    // Pass command object directly (as it would be from parseCommand)
    const command = manager.parseCommand("/mode bypass");
    const result = await manager.processCommand(command, command.args, {
      sessionId: "s123",
    });

    expect(result.handled).toBe(true);
    expect(result.response).toContain("bypass");
    expect(result.response).toContain("изменён");
  });

  test("processCommand /mode with invalid mode returns error", async () => {
    const manager = new SlashCommandManager({ debug: false });
    const result = await manager.processCommand(
      { name: "mode", args: ["invalid"] },
      [],
      {},
    );

    expect(result.handled).toBe(true);
    expect(result.response).toContain("Неизвестный режим");
  });

  test("processCommand /auth triggers auth callback", async () => {
    let called = false;
    const manager = new SlashCommandManager({
      debug: false,
      onAuthRequest: () => {
        called = true;
      },
    });

    const result = await manager.processCommand(
      { name: "auth", args: [] },
      [],
      {},
    );

    expect(result.handled).toBe(true);
    expect(result.action.type).toBe("auth");
    expect(called).toBe(true);
  });

  test("processCommand /clear triggers clear callback", async () => {
    let called = false;
    const manager = new SlashCommandManager({
      debug: false,
      onClear: () => {
        called = true;
      },
    });

    const result = await manager.processCommand(
      { name: "clear", args: [] },
      [],
      { sessionId: "s123" },
    );

    expect(result.handled).toBe(true);
    expect(result.action.type).toBe("clear");
    expect(called).toBe(true);
  });

  test("shouldHandleLocally returns true for valid commands", () => {
    const manager = new SlashCommandManager({ debug: false });

    expect(manager.shouldHandleLocally("/help")).toBe(true);
    expect(manager.shouldHandleLocally("/mode plan")).toBe(true);
    expect(manager.shouldHandleLocally("normal text")).toBe(false);
  });

  test("processCommand /status returns session status", async () => {
    const manager = new SlashCommandManager({ debug: false });
    const result = await manager.processCommand(
      { name: "status", args: [] },
      [],
      {
        mode: "default",
        currentModel: "gemini-2.0-flash",
        isAuthenticated: true,
      },
    );

    expect(result.handled).toBe(true);
    expect(result.response).toContain("gemini-2.0-flash");
    expect(result.response).toContain("Аутентифицирован");
  });

  test("processCommand /models returns model info", async () => {
    const manager = new SlashCommandManager({ debug: false });
    const result = await manager.processCommand(
      { name: "models", args: [] },
      [],
      {},
    );

    expect(result.handled).toBe(true);
    expect(result.response).toContain("/model");
  });

  test("processCommand /cancel returns cancel message", async () => {
    const manager = new SlashCommandManager({ debug: false });
    const result = await manager.processCommand(
      { name: "cancel", args: [] },
      [],
      {},
    );

    expect(result.handled).toBe(true);
    expect(result.response).toContain("отменена");
  });

  test("processCommand /retry triggers retry callback", async () => {
    let called = false;
    const manager = new SlashCommandManager({
      debug: false,
      onRetry: () => {
        called = true;
      },
    });

    const result = await manager.processCommand(
      { name: "retry", args: [] },
      [],
      { sessionId: "s123" },
    );

    expect(result.handled).toBe(true);
    expect(result.action.type).toBe("retry");
    expect(called).toBe(true);
  });

  test("getAvailableCommands returns ACP-compatible format", () => {
    const manager = new SlashCommandManager({ debug: false });
    const commands = manager.getAvailableCommands();

    expect(Array.isArray(commands)).toBe(true);
    expect(commands.length).toBe(SlashCommandManager.COMMANDS.length);

    // Check required fields
    for (const cmd of commands) {
      expect(cmd).toHaveProperty("name");
      expect(cmd).toHaveProperty("description");
      expect(typeof cmd.name).toBe("string");
      expect(typeof cmd.description).toBe("string");
    }

    // Check command with input hint
    const modeCmd = commands.find((c) => c.name === "mode");
    expect(modeCmd).toBeDefined();
    expect(modeCmd.input).toBeDefined();
    expect(modeCmd.input.hint).toBeDefined();

    // Check command without input
    const helpCmd = commands.find((c) => c.name === "help");
    expect(helpCmd).toBeDefined();
    expect(helpCmd.input).toBeUndefined();
  });
});
