import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createFakeMcpServer(name?: string, extra?: (server: McpServer) => void): McpServer;

/** The call-card tools: a rich write, two list reads for field hints, and a write that fails validation. */
export function addCallCardTools(server: McpServer): void;
