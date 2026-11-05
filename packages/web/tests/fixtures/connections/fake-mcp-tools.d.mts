import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function createFakeMcpServer(name?: string, extra?: (server: McpServer) => void): McpServer;

/** The call-card tools: a rich write, two list reads for field hints, and a write that fails validation. */
export function addCallCardTools(server: McpServer): void;

/** A tool's answer in place of the canned one; undefined keeps the canned answer. */
export type CaosReply = (args: Record<string, unknown>) => CallToolResult | undefined;

/** CAOS's work-item tools by name and input schema, answering canned data (or `replies`); never the real server. */
export function addCaosTools(server: McpServer, replies?: Record<string, CaosReply>): void;
