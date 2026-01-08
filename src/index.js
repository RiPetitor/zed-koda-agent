/**
 * KODA Agent Server - Entry Point
 *
 * @module koda-agent
 * @description AI coding assistant for Zed Editor with permission control and planning modes
 */

import * as acp from "@agentclientprotocol/sdk";
import { KodaAgent } from "./agent/index.js";
import { parseServerArgs } from "./utils/index.js";

/**
 * Запустить сервер KODA Agent
 */
async function main() {
  const config = parseServerArgs(process.argv.slice(2));

  if (config.debug) {
    console.error("[KODA Agent] Starting with config:", {
      kodaCommand: config.kodaCommand,
      extraArgs: config.extraArgs,
      defaultMode: config.defaultMode,
      defaultModel: config.defaultModel || "(auto)",
      debug: config.debug,
    });
  }

  // Create ACP server connection
  const connection = acp.createConnection(
    process.stdin,
    process.stdout,
    (conn) => new KodaAgent(conn, config)
  );

  // Start listening for ACP messages
  await connection.listen();
}

main().catch((error) => {
  console.error("[KODA Agent] Fatal error:", error);
  process.exit(1);
});
