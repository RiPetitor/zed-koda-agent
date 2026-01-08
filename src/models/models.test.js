/**
 * Tests for Models module
 */

import { jest } from "@jest/globals";

// Store original fetch
const originalFetch = global.fetch;

describe("API Client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("fetchModels", () => {
    test("fetches and parses models from API", async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            koda_data: [
              {
                id: "KodaAgent",
                owned_by: "KODA",
                context_length: 128000,
              },
            ],
            data: [
              {
                id: "gemini-2.0-flash",
                owned_by: "Google",
                context_length: 1000000,
              },
              {
                id: "claude-3-opus",
                owned_by: "Anthropic",
                context_length: 200000,
              },
            ],
          }),
      });

      // Import fresh to avoid cache
      const { fetchModels, invalidateCache } = await import("./api-client.js");
      invalidateCache();

      const result = await fetchModels(false);

      expect(result.freeModels).toHaveLength(1);
      expect(result.freeModels[0].modelId).toBe("KodaAgent");
      expect(result.freeModels[0].requiresAuth).toBe(false);

      expect(result.premiumModels).toHaveLength(2);
      expect(result.premiumModels[0].modelId).toBe("gemini-2.0-flash");
      expect(result.premiumModels[0].requiresAuth).toBe(true);
    });

    test("returns default model on API error", async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { fetchModels, invalidateCache } = await import("./api-client.js");
      invalidateCache();

      const result = await fetchModels(false);

      expect(result.freeModels).toHaveLength(1);
      expect(result.freeModels[0].modelId).toBe("KodaAgent");
      expect(result.premiumModels).toHaveLength(0);
    });

    test("returns default model on network error", async () => {
      global.fetch.mockRejectedValue(new Error("Network error"));

      const { fetchModels, invalidateCache } = await import("./api-client.js");
      invalidateCache();

      const result = await fetchModels(false);

      expect(result.freeModels).toHaveLength(1);
      expect(result.freeModels[0].modelId).toBe("KodaAgent");
    });

    test("uses cache on subsequent calls", async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            koda_data: [
              { id: "KodaAgent", owned_by: "KODA", context_length: 128000 },
            ],
            data: [],
          }),
      });

      const { fetchModels, invalidateCache } = await import("./api-client.js");
      invalidateCache();

      await fetchModels(false);
      await fetchModels(false);
      await fetchModels(false);

      // Should only call fetch once due to caching
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("ModelManager - additional tests", () => {
  let ModelManager;

  beforeEach(async () => {
    const module = await import("./model-manager.js");
    ModelManager = module.ModelManager;
  });

  describe("getModelConfig", () => {
    test("returns correct structure", () => {
      const manager = new ModelManager("", { debug: false });
      const config = manager.getModelConfig("KodaAgent");

      expect(config).toHaveProperty("availableModels");
      expect(config).toHaveProperty("currentModelId", "KodaAgent");
      expect(Array.isArray(config.availableModels)).toBe(true);
    });

    test("uses first available model if current not specified", () => {
      const manager = new ModelManager("", { debug: false });
      const config = manager.getModelConfig();

      expect(config.currentModelId).toBe("KodaAgent");
    });
  });

  describe("getModel", () => {
    test("returns session model if set", () => {
      const manager = new ModelManager("default-model", { debug: false });
      manager.sessionModels.set("session1", "KodaAgent");

      expect(manager.getModel("session1")).toBe("KodaAgent");
    });

    test("returns default model if session model not set", () => {
      const manager = new ModelManager("default-model", { debug: false });

      expect(manager.getModel("unknown-session")).toBe("default-model");
    });

    test("returns first available model if no default", () => {
      const manager = new ModelManager("", { debug: false });

      expect(manager.getModel("unknown")).toBe("KodaAgent");
    });
  });

  describe("deleteSession", () => {
    test("removes session from map", () => {
      const manager = new ModelManager("", { debug: false });
      manager.sessionModels.set("session1", "model1");

      manager.deleteSession("session1");

      expect(manager.sessionModels.has("session1")).toBe(false);
    });
  });

  describe("loadAvailableModels", () => {
    test("returns available models array", () => {
      const manager = new ModelManager("", { debug: false });
      const models = manager.loadAvailableModels();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe("onAuthChange callback", () => {
    test("is called when authentication changes", () => {
      const callback = jest.fn();
      const manager = new ModelManager("", {
        debug: false,
        onAuthChange: callback,
      });

      // Simulate auth change
      manager.onAuthChange(true);

      expect(callback).toHaveBeenCalledWith(true);
    });
  });
});
