/**
 * GitHub OAuth Device Flow
 * Реализация аутентификации через GitHub Device Flow
 */

import { spawn } from "node:child_process";
import { GITHUB, TIMEOUTS } from "../config/constants.js";
import { saveToken, hasStoredToken } from "./token-storage.js";

/**
 * @typedef {Object} DeviceFlowResult
 * @property {string} deviceCode - Device code for polling
 * @property {string} userCode - Code to show to user
 * @property {string} verificationUri - URL for user to visit
 * @property {number} expiresIn - Expiration time in seconds
 * @property {number} interval - Polling interval in seconds
 */

/**
 * @typedef {Object} PollResult
 * @property {boolean} success - Whether authorization succeeded
 * @property {string} [token] - Access token if successful
 * @property {string} [error] - Error message if failed
 */

/**
 * Запустить GitHub Device Flow
 * @returns {Promise<DeviceFlowResult>}
 */
export async function startDeviceFlow() {
  const response = await fetch(GITHUB.DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `client_id=${GITHUB.CLIENT_ID}&scope=${GITHUB.SCOPE}`,
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || GITHUB.DEVICE_URL,
    expiresIn: data.expires_in,
    interval: data.interval || TIMEOUTS.AUTH_POLL_INTERVAL_SEC,
  };
}

/**
 * Опросить GitHub на предмет завершения авторизации
 * @param {string} deviceCode - Device code from startDeviceFlow
 * @param {number} [interval=5] - Polling interval in seconds
 * @param {number} [maxAttempts=60] - Maximum polling attempts
 * @returns {Promise<PollResult>}
 */
export async function pollDeviceFlow(
  deviceCode,
  interval = TIMEOUTS.AUTH_POLL_INTERVAL_SEC,
  maxAttempts = TIMEOUTS.AUTH_POLL_MAX_ATTEMPTS
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    const response = await fetch(GITHUB.ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `client_id=${GITHUB.CLIENT_ID}&device_code=${deviceCode}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
    });

    const data = await response.json();

    if (data.access_token) {
      await saveToken(data.access_token);
      return { success: true, token: data.access_token };
    }

    if (data.error === "authorization_pending") {
      continue;
    }

    if (data.error === "slow_down") {
      interval = (data.interval || interval) + 5;
      continue;
    }

    if (data.error === "expired_token") {
      return { success: false, error: "Code expired. Please try again." };
    }

    if (data.error === "access_denied") {
      return { success: false, error: "Access denied by user." };
    }

    return { success: false, error: data.error_description || data.error };
  }

  return { success: false, error: "Timeout waiting for authorization." };
}

/**
 * Открыть URL в браузере пользователя
 * @param {string} url - URL to open
 * @returns {Promise<boolean>} - Whether browser was opened
 */
export async function openBrowser(url) {
  const platform = process.platform;

  let command;
  let args;

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
    proc.on("error", () => resolve(false));
    proc.on("spawn", () => resolve(true));
  });
}

/**
 * Выполнить полную аутентификацию
 * @returns {Promise<Object>} - Result with pending status or success
 */
export async function authenticate() {
  if (await hasStoredToken()) {
    return { success: true, alreadyAuthenticated: true };
  }

  const deviceFlow = await startDeviceFlow();
  const browserOpened = await openBrowser(deviceFlow.verificationUri);

  return {
    success: false,
    pending: true,
    userCode: deviceFlow.userCode,
    verificationUri: deviceFlow.verificationUri,
    deviceCode: deviceFlow.deviceCode,
    interval: deviceFlow.interval,
    expiresIn: deviceFlow.expiresIn,
    browserOpened,
  };
}
