/**
 * What a rex MCP tool module declares.
 *
 * Each tool under `cli/mcp-tools/` owns its own name, description, input
 * schema and access kind alongside its handler, so a change to one tool
 * touches one file. `mcp.ts` registers whatever `registry.ts` lists and holds
 * no per-tool knowledge of its own.
 */

import type { ZodRawShape, ZodTypeAny, objectOutputType } from "zod";
import type { RexWorkspace } from "../mcp-workspace.js";
import type { McpResult } from "./result.js";

/**
 * Whether a call writes the PRD or claims. Writes are refused while the
 * client's root cannot be served; reads answer from the startup dir.
 */
export type Access = "read" | "write";

/** Arguments as the SDK parses them from a tool's own schema. */
type ArgsOf<S extends ZodRawShape> = objectOutputType<S, ZodTypeAny>;

/**
 * A registered tool, with its argument type erased.
 *
 * The registry holds tools whose schemas differ, so the array cannot be typed
 * against any one of them, and the SDK re-derives each callback's argument
 * type from the schema passed beside it. `any` is what lets one array hold
 * all of them; it is confined to {@link defineTool}'s return, which is the
 * only place a tool loses its argument type. Inside each tool module the
 * schema and handler are still checked against each other.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly schema: ZodRawShape;
  /** A function when the kind depends on the arguments (e.g. `merge_items` previewing). */
  readonly access: Access | ((args: any) => Access);
  readonly run: (ws: RexWorkspace, args: any) => Promise<McpResult>;
}

/** Declare a tool, inferring its argument type from its own schema. */
export function defineTool<S extends ZodRawShape>(definition: {
  name: string;
  description: string;
  schema: S;
  access: Access | ((args: ArgsOf<S>) => Access);
  run: (ws: RexWorkspace, args: ArgsOf<S>) => Promise<McpResult>;
}): ToolDefinition {
  return definition as ToolDefinition;
}
