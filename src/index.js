#!/usr/bin/env node
/**
 * KODA Agent Server - Entry Point
 *
 * @module koda-agent
 * @description AI coding assistant for Zed Editor with permission control and planning modes
 */

import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import process from "node:process";

import { KodaAgent } from "./agent/index.js";
import { parseServerArgs } from "./utils/index.js";

// Parse config from command line arguments
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

// Convert Node.js streams to Web Streams for ACP SDK
const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = ndJsonStream(input, output);

// Create ACP connection - it starts listening automatically
new AgentSideConnection((conn) => new KodaAgent(conn, config), stream);
