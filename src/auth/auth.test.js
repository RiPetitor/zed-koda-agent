/**
 * Tests for Auth module
 */

import { jest } from "@jest/globals";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock fs
jest.unstable_mockModule("node:fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    unlink: jest.fn(),
  },
}));

// Import after mocking
const { hasStoredToken, getStoredToken, saveToken, deleteToken } = await import(
  "./token-storage.js"
);

const mockFs = (await import("node:fs")).promises;

describe("Token Storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("hasStoredToken", () => {
    test("returns true when token exists", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ githubToken: "test-token" })
      );

      const result = await hasStoredToken();

      expect(result).toBe(true);
    });

    test("returns false when token is empty", async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({ githubToken: "" }));

      const result = await hasStoredToken();

      expect(result).toBe(false);
    });

    test("returns false when file does not exist", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      const result = await hasStoredToken();

      expect(result).toBe(false);
    });

    test("returns false when JSON is invalid", async () => {
      mockFs.readFile.mockResolvedValue("invalid json");

      const result = await hasStoredToken();

      expect(result).toBe(false);
    });
  });

  describe("getStoredToken", () => {
    test("returns token when exists", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ githubToken: "my-token" })
      );

      const result = await getStoredToken();

      expect(result).toBe("my-token");
    });

    test("returns null when file does not exist", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      const result = await getStoredToken();

      expect(result).toBeNull();
    });

    test("returns null when token field is missing", async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({}));

      const result = await getStoredToken();

      expect(result).toBeNull();
    });
  });

  describe("saveToken", () => {
    test("creates directory and saves token", async () => {
      mockFs.mkdir.mockResolvedValue();
      mockFs.writeFile.mockResolvedValue();

      await saveToken("new-token");

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(".config/koda"),
        { recursive: true }
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("credentials.json"),
        JSON.stringify({ githubToken: "new-token" }, null, 2),
        { mode: 0o600 }
      );
    });
  });

  describe("deleteToken", () => {
    test("deletes file and returns success", async () => {
      mockFs.unlink.mockResolvedValue();

      const result = await deleteToken();

      expect(result).toEqual({ success: true });
      expect(mockFs.unlink).toHaveBeenCalled();
    });

    test("returns alreadyLoggedOut when file does not exist", async () => {
      const error = new Error("ENOENT");
      error.code = "ENOENT";
      mockFs.unlink.mockRejectedValue(error);

      const result = await deleteToken();

      expect(result).toEqual({ success: true, alreadyLoggedOut: true });
    });

    test("throws on other errors", async () => {
      const error = new Error("Permission denied");
      error.code = "EACCES";
      mockFs.unlink.mockRejectedValue(error);

      await expect(deleteToken()).rejects.toThrow("Permission denied");
    });
  });
});

describe("GitHub OAuth", () => {
  // Mock fetch
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("startDeviceFlow", () => {
    test("returns device flow data on success", async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            device_code: "device123",
            user_code: "USER-CODE",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }),
      });

      const { startDeviceFlow } = await import("./github-oauth.js");
      const result = await startDeviceFlow();

      expect(result).toEqual({
        deviceCode: "device123",
        userCode: "USER-CODE",
        verificationUri: "https://github.com/login/device",
        expiresIn: 900,
        interval: 5,
      });
    });

    test("throws on API error", async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { startDeviceFlow } = await import("./github-oauth.js");

      await expect(startDeviceFlow()).rejects.toThrow("GitHub API error: 500");
    });
  });

  describe("pollDeviceFlow", () => {
    test("returns success when token received", async () => {
      // First call returns pending, second returns token
      global.fetch
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ error: "authorization_pending" }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ access_token: "github-token" }),
        });

      mockFs.mkdir.mockResolvedValue();
      mockFs.writeFile.mockResolvedValue();

      const { pollDeviceFlow } = await import("./github-oauth.js");

      // Use short interval for test
      const result = await pollDeviceFlow("device123", 0.01, 5);

      expect(result.success).toBe(true);
      expect(result.token).toBe("github-token");
    });

    test("returns error on expired token", async () => {
      global.fetch.mockResolvedValue({
        json: () => Promise.resolve({ error: "expired_token" }),
      });

      const { pollDeviceFlow } = await import("./github-oauth.js");
      const result = await pollDeviceFlow("device123", 0.01, 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain("expired");
    });

    test("returns error on access denied", async () => {
      global.fetch.mockResolvedValue({
        json: () => Promise.resolve({ error: "access_denied" }),
      });

      const { pollDeviceFlow } = await import("./github-oauth.js");
      const result = await pollDeviceFlow("device123", 0.01, 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain("denied");
    });

    test("returns timeout error after max attempts", async () => {
      global.fetch.mockResolvedValue({
        json: () => Promise.resolve({ error: "authorization_pending" }),
      });

      const { pollDeviceFlow } = await import("./github-oauth.js");
      const result = await pollDeviceFlow("device123", 0.01, 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Timeout");
    });
  });
});
