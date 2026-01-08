/**
 * KODA API Client - загрузка моделей с API
 */

import { KODA_API, DEFAULT_MODEL } from "../config/constants.js";

/** @type {{ freeModels: Model[], premiumModels: Model[] } | null} */
let cachedModels = null;

/** @type {number} */
let cacheTimestamp = 0;

/**
 * @typedef {Object} Model
 * @property {string} modelId - Model ID
 * @property {string} name - Display name
 * @property {string} description - Model description
 * @property {boolean} requiresAuth - Whether auth is required
 */

/**
 * @typedef {Object} ModelsResult
 * @property {Model[]} freeModels - Free tier models
 * @property {Model[]} premiumModels - Premium tier models
 */

/**
 * Fetch models from KODA API
 * @param {boolean} [debug=false] - Enable debug logging
 * @returns {Promise<ModelsResult>}
 */
export async function fetchModels(debug = false) {
  const now = Date.now();

  // Return cached if still valid
  if (cachedModels && now - cacheTimestamp < KODA_API.MODELS_CACHE_TTL_MS) {
    debug && console.error("[API] Using cached models");
    return cachedModels;
  }

  try {
    debug && console.error("[API] Fetching models from KODA API...");
    const response = await fetch(KODA_API.MODELS_URL);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    // Parse models from API response
    const freeModels = (data.koda_data || [])
      .filter((m) => m.id === "KodaAgent")
      .map((m) => ({
        modelId: m.id,
        name: m.id,
        description: `${m.owned_by} model (${Math.round(m.context_length / 1000)}k context)`,
        requiresAuth: false,
      }));

    const premiumModels = (data.data || []).map((m) => ({
      modelId: m.id,
      name: m.id,
      description: `${m.owned_by} (${Math.round(m.context_length / 1000)}k context)`,
      requiresAuth: true,
    }));

    cachedModels = { freeModels, premiumModels };
    cacheTimestamp = now;

    debug &&
      console.error(
        `[API] Fetched ${freeModels.length} free + ${premiumModels.length} premium models`
      );

    return cachedModels;
  } catch (error) {
    debug && console.error("[API] Failed to fetch models:", error.message);

    // Fallback to default model
    return {
      freeModels: [DEFAULT_MODEL],
      premiumModels: [],
    };
  }
}

/**
 * Invalidate models cache
 */
export function invalidateCache() {
  cachedModels = null;
  cacheTimestamp = 0;
}
