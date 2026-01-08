/**
 * Tests for KodaAcpBridge
 */

import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";

// Mock child_process before importing the module
const mockSpawn = jest.fn();
jest.unstable_mockModule("node:child_process", () => ({
  spawn: mockSpawn,
}));

// Mock ACP SDK
jest.unstable_mockModule("@agentclientprotocol/sdk", () => ({
  PROTOCOL_VERSION: "0.1.0",
}));

// Import after mocking
const { KodaAcpBridge } = await import("./koda-bridge.js");

/**
 * Helper to create mock process
 */
function createMockProcess() {
  const proc = new EventEmitter();
  proc.killed = false;
  proc.stdin = {
    writable: true,
    write: jest.fn(),
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn((signal) => {
    proc.killed = true;
    proc.emit("close", 0, signal);
  });

  return proc;
}

describe("KodaAcpBridge", () => {
  let bridge;
  let mockProcess;
  let config;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    config = {
      kodaCommand: "koda",
      extraArgs: [],
      debug: false,
    };

    bridge = new KodaAcpBridge(config, {
      onMessage: jest.fn(),
      onClose: jest.fn(),
      onError: jest.fn(),
    });
  });

  describe("constructor", () => {
    test("initializes with correct defaults", () => {
      expect(bridge.process).toBeNull();
      expect(bridge.initialized).toBe(false);
      expect(bridge.kodaSessionId).toBeNull();
      expect(bridge.requestIdCounter).toBe(1);
    });
  });

  describe("sendRequest", () => {
    test("increments request ID", () => {
      const id1 = bridge.requestIdCounter;
      bridge.process = mockProcess;

      bridge.sendRequest("test", {});

      expect(bridge.requestIdCounter).toBe(id1 + 1);
    });

    test("stores pending request", () => {
      bridge.process = mockProcess;

      bridge.sendRequest("test", {});

      expect(bridge.pendingRequests.size).toBe(1);
    });
  });

  describe("sendNotification", () => {
    test("sends notification without id", () => {
      bridge.process = mockProcess;
      const writeSpy = jest.spyOn(mockProcess.stdin, "write");

      bridge.sendNotification("session/cancel", { sessionId: "123" });

      expect(writeSpy).toHaveBeenCalled();
      const sent = JSON.parse(writeSpy.mock.calls[0][0].replace("\n", ""));
      expect(sent.id).toBeUndefined();
      expect(sent.method).toBe("session/cancel");
    });
  });

  describe("sendResponse", () => {
    test("sends success response", () => {
      bridge.process = mockProcess;
      const writeSpy = jest.spyOn(mockProcess.stdin, "write");

      bridge.sendResponse(1, { data: "test" });

      const sent = JSON.parse(writeSpy.mock.calls[0][0].replace("\n", ""));
      expect(sent.id).toBe(1);
      expect(sent.result).toEqual({ data: "test" });
      expect(sent.error).toBeUndefined();
    });

    test("sends error response", () => {
      bridge.process = mockProcess;
      const writeSpy = jest.spyOn(mockProcess.stdin, "write");

      bridge.sendResponse(1, null, { code: -32000, message: "Error" });

      const sent = JSON.parse(writeSpy.mock.calls[0][0].replace("\n", ""));
      expect(sent.id).toBe(1);
      expect(sent.error).toEqual({ code: -32000, message: "Error" });
    });
  });

  describe("handleMessage", () => {
    test("resolves pending request on success response", async () => {
      bridge.process = mockProcess;

      const promise = bridge.sendRequest("test", {});
      const requestId = bridge.requestIdCounter - 1;

      bridge.handleMessage({
        jsonrpc: "2.0",
        id: requestId,
        result: { success: true },
      });

      const result = await promise;
      expect(result).toEqual({ success: true });
      expect(bridge.pendingRequests.size).toBe(0);
    });

    test("rejects pending request on error response", async () => {
      bridge.process = mockProcess;

      const promise = bridge.sendRequest("test", {});
      const requestId = bridge.requestIdCounter - 1;

      bridge.handleMessage({
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32000, message: "Test error" },
      });

      await expect(promise).rejects.toThrow("Test error");
    });

    test("calls onMessage for notifications", () => {
      const onMessage = jest.fn();
      bridge.onMessage = onMessage;

      bridge.handleMessage({
        jsonrpc: "2.0",
        method: "session/update",
        params: { update: { sessionUpdate: "agent_message_chunk" } },
      });

      expect(onMessage).toHaveBeenCalledWith({
        jsonrpc: "2.0",
        method: "session/update",
        params: { update: { sessionUpdate: "agent_message_chunk" } },
      });
    });
  });

  describe("kill", () => {
    test("kills process with SIGTERM", () => {
      bridge.process = mockProcess;
      const killSpy = jest.spyOn(mockProcess, "kill");

      bridge.kill();

      expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    });
  });

  describe("isRunning", () => {
    test("returns falsy when no process", () => {
      expect(bridge.isRunning()).toBeFalsy();
    });

    test("returns true when process is running", () => {
      bridge.process = mockProcess;
      expect(bridge.isRunning()).toBe(true);
    });

    test("returns false when process is killed", () => {
      bridge.process = mockProcess;
      mockProcess.killed = true;
      expect(bridge.isRunning()).toBe(false);
    });
  });

  describe("sendCancel", () => {
    test("does nothing without session", () => {
      bridge.process = mockProcess;
      const writeSpy = jest.spyOn(mockProcess.stdin, "write");

      bridge.sendCancel();

      expect(writeSpy).not.toHaveBeenCalled();
    });

    test("sends cancel notification with session", () => {
      bridge.process = mockProcess;
      bridge.kodaSessionId = "test-session";
      const writeSpy = jest.spyOn(mockProcess.stdin, "write");

      bridge.sendCancel();

      expect(writeSpy).toHaveBeenCalled();
      const sent = JSON.parse(writeSpy.mock.calls[0][0].replace("\n", ""));
      expect(sent.method).toBe("session/cancel");
      expect(sent.params.sessionId).toBe("test-session");
    });
  });

  describe("sendPrompt", () => {
    test("throws without session", async () => {
      bridge.process = mockProcess;

      await expect(bridge.sendPrompt("test")).rejects.toThrow(
        "Session not created"
      );
    });
  });
});
