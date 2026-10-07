import { z } from "zod";
import { appendExecutionLogEntry } from "../../core/execution-log.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleAppendLog(
  store: PRDStore,
  args: { event: string; itemId?: string; detail?: string },
): Promise<McpResult> {
  try {
    await appendExecutionLogEntry(store, args);
    return textResult(JSON.stringify({ logged: true, event: args.event }));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const appendLogTool = defineTool({
  name: "append_log",
  description: "Append a structured log entry to the execution log",
  schema: {
    event: z.string().describe("Event name"),
    itemId: z.string().optional().describe("Related item ID"),
    detail: z.string().optional().describe("Event details"),
  },
  access: "write",
  run: (ws, args) => handleAppendLog(ws.store, args),
});
