import { z } from "zod";
import { resolveRemoteStore, SyncEngine } from "../../store/index.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

/**
 * The remote adapter and sync engine are parameters rather than direct
 * imports so a test can drive the handler against a stub remote without a
 * configured adapter. The tool below supplies the real pair.
 */
export async function handleSyncWithRemote(
  store: PRDStore,
  rexDir: string,
  args: { direction?: string; adapter?: string },
  resolveRemote: (dir: string, adapter: string) => Promise<any>,
  Engine: new (store: PRDStore, remote: any) => any,
): Promise<McpResult> {
  try {
    const syncDirection = args.direction ?? "sync";
    const adapterName = args.adapter ?? "notion";

    let remote;
    try {
      remote = await resolveRemote(rexDir, adapterName);
    } catch {
      return textResult(
        `Adapter "${adapterName}" is not configured. Run 'rex adapter add ${adapterName}' to configure it.`,
        true,
      );
    }

    const engine = new Engine(store, remote);

    let report;
    switch (syncDirection) {
      case "push":
        report = await engine.push();
        break;
      case "pull":
        report = await engine.pull();
        break;
      default:
        report = await engine.sync();
        break;
    }

    await store.appendLog({
      timestamp: report.timestamp,
      event: "sync_completed",
      detail: `${syncDirection} sync with ${adapterName}: ${report.pushed.length} pushed, ${report.pulled.length} pulled, ${report.conflicts.length} conflicts`,
    });

    return textResult(JSON.stringify(report, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const syncWithRemoteTool = defineTool({
  name: "sync_with_remote",
  description: "Sync local PRD with a remote adapter (e.g. Notion)",
  schema: {
    direction: z.enum(["push", "pull", "sync"]).optional().describe("Sync direction (default: sync)"),
    adapter: z.string().optional().describe("Adapter name (default: notion)"),
  },
  access: "write",
  run: (ws, args) => handleSyncWithRemote(ws.store, ws.rexDir, args, resolveRemoteStore, SyncEngine),
});
