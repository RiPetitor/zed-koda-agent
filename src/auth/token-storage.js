/**
 * Token Storage - управление хранением токенов аутентификации
 */

import { promises as fs } from "node:fs";
import { PATHS } from "../config/constants.js";

/**
 * Проверить наличие сохранённого токена
 * @returns {Promise<boolean>}
 */
export async function hasStoredToken() {
  try {
    const data = await fs.readFile(PATHS.CREDENTIALS_FILE, "utf8");
    const creds = JSON.parse(data);
    return !!creds.githubToken;
  } catch {
    return false;
  }
}

/**
 * Получить сохранённый токен
 * @returns {Promise<string|null>}
 */
export async function getStoredToken() {
  try {
    const data = await fs.readFile(PATHS.CREDENTIALS_FILE, "utf8");
    const creds = JSON.parse(data);
    return creds.githubToken || null;
  } catch {
    return null;
  }
}

/**
 * Сохранить токен
 * @param {string} token - GitHub access token
 * @returns {Promise<void>}
 */
export async function saveToken(token) {
  await fs.mkdir(PATHS.CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    PATHS.CREDENTIALS_FILE,
    JSON.stringify({ githubToken: token }, null, 2),
    { mode: 0o600 }
  );
}

/**
 * Удалить сохранённый токен
 * @returns {Promise<{success: boolean, alreadyLoggedOut?: boolean}>}
 */
export async function deleteToken() {
  try {
    await fs.unlink(PATHS.CREDENTIALS_FILE);
    return { success: true };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { success: true, alreadyLoggedOut: true };
    }
    throw error;
  }
}
