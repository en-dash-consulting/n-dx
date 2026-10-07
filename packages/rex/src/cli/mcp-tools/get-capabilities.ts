import { SCHEMA_VERSION } from "../../schema/index.js";
import { TOOL_VERSION } from "../commands/constants.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

/** Which directory a server is serving and why (see mcp-workspace.ts). */
export interface WorkspaceInfo {
  projectDir: string;
  rexDir: string;
  source: "roots" | "startup";
  startupDir: string;
  /** Present while writes are refused on behalf of an unservable client root. */
  refused?: string;
}

export async function handleGetCapabilities(store: PRDStore, workspace?: WorkspaceInfo): Promise<McpResult> {
  try {
    const config = await store.loadConfig();
    const caps = store.capabilities();
    return textResult(
      JSON.stringify(
        {
          ...(workspace ? { workspace } : {}),
          schemaVersion: SCHEMA_VERSION,
          toolVersion: TOOL_VERSION,
          adapter: caps.adapter,
          supportsTransactions: caps.supportsTransactions,
          supportsWatch: caps.supportsWatch,
          sourcevision: config.sourcevision ?? "disabled",
          future: config.future ?? {},
        },
        null,
        2,
      ),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const getCapabilitiesTool = defineTool({
  name: "get_capabilities",
  description: "Get Rex server capabilities and configuration",
  schema: {},
  access: "read",
  run: (ws) => handleGetCapabilities(ws.store, {
    projectDir: ws.projectDir,
    rexDir: ws.rexDir,
    source: ws.source,
    startupDir: ws.startupDir,
    ...(ws.refused ? { refused: ws.refused } : {}),
  }),
});
