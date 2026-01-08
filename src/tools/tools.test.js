/**
 * Tests for Tools module (Interceptor)
 */

import { jest } from "@jest/globals";
import { ToolCallInterceptor } from "./interceptor.js";
import { PermissionHandler } from "./permission-handler.js";
import { SESSION_UPDATE } from "../config/constants.js";

describe("ToolCallInterceptor", () => {
  let interceptor;
  let mockConnection;
  let mockPermissionHandler;
  let mockModeManager;
  let mockPlanCollector;

  beforeEach(() => {
    mockConnection = {
      sessionUpdate: jest.fn().mockResolvedValue({}),
    };

    mockPermissionHandler = {
      needsPermission: jest.fn(),
      requestPermission: jest.fn(),
      getToolType: jest.fn().mockReturnValue("file_edit"),
    };

    mockModeManager = {
      getMode: jest.fn().mockReturnValue("default"),
    };

    mockPlanCollector = {
      addEntry: jest.fn(),
      getPlan: jest.fn().mockReturnValue([]),
      updateEntryByToolCallId: jest.fn(),
    };

    interceptor = new ToolCallInterceptor(
      mockConnection,
      {
        permissionHandler: mockPermissionHandler,
        modeManager: mockModeManager,
        planCollector: mockPlanCollector,
      },
      { debug: false }
    );
  });

  describe("processSessionUpdate", () => {
    test("forwards non-tool-call updates directly", async () => {
      const update = {
        sessionUpdate: SESSION_UPDATE.AGENT_MESSAGE_CHUNK,
        content: { type: "text", text: "Hello" },
      };

      const result = await interceptor.processSessionUpdate("session1", update);

      expect(result.forward).toBe(true);
      expect(result.update).toEqual(update);
    });

    test("handles tool_call without permission needed", async () => {
      mockPermissionHandler.needsPermission.mockReturnValue(false);

      const toolCall = {
        sessionUpdate: SESSION_UPDATE.TOOL_CALL,
        toolCallId: "tc1",
        title: "Read file",
        kind: "read",
      };

      const result = await interceptor.processSessionUpdate(
        "session1",
        toolCall
      );

      expect(result.forward).toBe(true);
      expect(interceptor.pendingToolCalls.has("tc1")).toBe(true);
    });

    test("handles tool_call with permission granted", async () => {
      mockPermissionHandler.needsPermission.mockReturnValue(true);
      mockPermissionHandler.requestPermission.mockResolvedValue({
        outcome: "allowed",
        optionId: "allow",
      });

      const toolCall = {
        sessionUpdate: SESSION_UPDATE.TOOL_CALL,
        toolCallId: "tc2",
        title: "Write file",
        kind: "edit",
      };

      const result = await interceptor.processSessionUpdate(
        "session1",
        toolCall
      );

      expect(result.forward).toBe(false);
      expect(result.alreadySent).toBe(true);
      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
    });

    test("handles tool_call with permission rejected", async () => {
      mockPermissionHandler.needsPermission.mockReturnValue(true);
      mockPermissionHandler.requestPermission.mockResolvedValue({
        outcome: "cancelled",
        optionId: "reject",
      });

      const toolCall = {
        sessionUpdate: SESSION_UPDATE.TOOL_CALL,
        toolCallId: "tc3",
        title: "Delete file",
        kind: "delete",
      };

      const result = await interceptor.processSessionUpdate(
        "session1",
        toolCall
      );

      expect(result.forward).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.rejected).toBe(true);
      expect(interceptor.blockedToolCalls.has("tc3")).toBe(true);
    });

    test("handles tool_call in plan mode", async () => {
      mockModeManager.getMode.mockReturnValue("plan");
      mockPermissionHandler.needsPermission.mockReturnValue(true);

      const toolCall = {
        sessionUpdate: SESSION_UPDATE.TOOL_CALL,
        toolCallId: "tc4",
        title: "Execute command",
        kind: "execute",
      };

      const result = await interceptor.processSessionUpdate(
        "session1",
        toolCall
      );

      expect(result.forward).toBe(false);
      expect(result.blocked).toBe(true);
      expect(mockPlanCollector.addEntry).toHaveBeenCalledWith(
        "session1",
        toolCall
      );
      expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(3); // pending, plan, blocked
    });
  });

  describe("handleToolCallUpdate", () => {
    test("does not forward updates for blocked tool calls", async () => {
      interceptor.blockedToolCalls.set("tc-blocked", {});

      const update = {
        sessionUpdate: SESSION_UPDATE.TOOL_CALL_UPDATE,
        toolCallId: "tc-blocked",
        status: "completed",
      };

      const result = await interceptor.processSessionUpdate("session1", update);

      expect(result.forward).toBe(false);
    });

    test("forwards updates for non-blocked tool calls", async () => {
      const update = {
        sessionUpdate: SESSION_UPDATE.TOOL_CALL_UPDATE,
        toolCallId: "tc-normal",
        status: "completed",
      };

      const result = await interceptor.processSessionUpdate("session1", update);

      expect(result.forward).toBe(true);
      expect(result.update).toEqual(update);
    });

    test("updates plan entry on completion", async () => {
      const update = {
        sessionUpdate: SESSION_UPDATE.TOOL_CALL_UPDATE,
        toolCallId: "tc-plan",
        status: "completed",
      };

      await interceptor.processSessionUpdate("session1", update);

      expect(mockPlanCollector.updateEntryByToolCallId).toHaveBeenCalledWith(
        "session1",
        "tc-plan",
        "completed"
      );
    });
  });

  describe("clearSession", () => {
    test("clears all maps", () => {
      interceptor.blockedToolCalls.set("tc1", {});
      interceptor.pendingToolCalls.set("tc2", {});

      interceptor.clearSession("session1");

      expect(interceptor.blockedToolCalls.size).toBe(0);
      expect(interceptor.pendingToolCalls.size).toBe(0);
    });
  });
});

describe("PermissionHandler - additional tests", () => {
  let handler;

  beforeEach(() => {
    handler = new PermissionHandler(
      { requestPermission: jest.fn() },
      { debug: false }
    );
  });

  describe("getToolType - edge cases", () => {
    test("classifies by title when kind is missing", () => {
      expect(handler.getToolType({ title: "Read file.txt" })).toBe("read");
      expect(handler.getToolType({ title: "Write config" })).toBe("file_edit");
      expect(handler.getToolType({ title: "Delete temp" })).toBe("file_delete");
      expect(handler.getToolType({ title: "Run bash" })).toBe(
        "command_execute"
      );
    });

    test("returns other for unknown operations", () => {
      expect(handler.getToolType({ title: "Unknown operation" })).toBe("other");
      expect(handler.getToolType({})).toBe("other");
    });

    test("detects dangerous patterns", () => {
      // These patterns are explicitly in DANGEROUS_PATTERNS
      const dangerousCommands = [
        "rm -rf /tmp",
        "rm -r /home",
        "sudo apt install",
        "chmod 777 file",
        "chown root file",
        "mkfs /dev/sda",
        "dd if=/dev/zero of=/dev/sda",
      ];

      for (const cmd of dangerousCommands) {
        const result = handler.getToolType({
          kind: "execute",
          rawInput: { command: cmd },
        });
        expect(result).toBe("dangerous_command");
      }
    });

    test("does not flag safe commands as dangerous", () => {
      const safeCommands = [
        "ls -la",
        "cat file.txt",
        "echo hello",
        "npm install",
      ];

      for (const cmd of safeCommands) {
        const result = handler.getToolType({
          kind: "execute",
          rawInput: { command: cmd },
        });
        expect(result).toBe("command_execute");
      }
    });
  });

  describe("needsPermission - mode combinations", () => {
    test("auto_edit mode auto-approves file edits", () => {
      const editTool = { kind: "edit", title: "Edit file" };
      const cmdTool = { kind: "execute", title: "Run command" };

      expect(handler.needsPermission("s1", "auto_edit", editTool)).toBe(false);
      expect(handler.needsPermission("s1", "auto_edit", cmdTool)).toBe(true);
    });

    test("yolo mode only blocks dangerous commands", () => {
      const editTool = { kind: "edit", title: "Edit" };
      const safeTool = { kind: "execute", rawInput: { command: "ls" } };
      const dangerousTool = {
        kind: "execute",
        rawInput: { command: "rm -rf /" },
      };

      expect(handler.needsPermission("s1", "yolo", editTool)).toBe(false);
      expect(handler.needsPermission("s1", "yolo", safeTool)).toBe(false);
      expect(handler.needsPermission("s1", "yolo", dangerousTool)).toBe(true);
    });
  });

  describe("deleteSession", () => {
    test("removes session data", () => {
      handler.alwaysAllowedTypes.set("session1", new Set(["file_edit"]));

      handler.deleteSession("session1");

      expect(handler.alwaysAllowedTypes.has("session1")).toBe(false);
    });
  });
});
