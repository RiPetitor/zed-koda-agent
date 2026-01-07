#!/usr/bin/env node
/**
 * KODA Agent Server
 *
 * ACP middleware that runs KODA CLI in ACP mode and provides:
 * - Session modes (Default, Accept Edits, Plan Mode, Don't Ask, Bypass)
 * - Permission handling for write operations
 * - Plan collection in Plan Mode
 * - MCP server synchronization
 * - Model selection with authentication support
 */

import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import process from "node:process";

import { KodaAgent } from "./src/agent.js";
import { parseServerArgs, debugLog } from "./src/utils.js";

// Parse configuration
const config = parseServerArgs(process.argv.slice(2), process.env);
debugLog(config.debug, "Starting KODA Agent Server...");

// Set up ACP stream
const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);

// Start agent
new acp.AgentSideConnection((conn) => new KodaAgent(conn, config), stream);