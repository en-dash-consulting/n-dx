import { join } from "node:path";
import { resolveStore, resolveRemoteStore, SyncEngine, resolveRexPaths } from "../../store/index.js";
import { CLIError } from "../errors.js";

import { info, result } from "../output.js";
import type { SyncDirection, SyncReport } from "../../store/index.js";

/**
 * `rex sync` — synchronize the local PRD with a remote adapter.
 *
 * Flags:
 *   --push             Push local changes to remote only
 *   --pull             Pull remote changes to local only
 *   --adapter=<name>   Adapter name (default: notion)
 *   --format=json      Machine-readable output
 *   --dry-run          Preview sync without writing
 */
export async function cmdSync(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = resolveRexPaths(dir).rexDir;

  const direction: SyncDirection =
    flags.push === "true" ? "push" :
    flags.pull === "true" ? "pull" :
    "sync";

  const adapterName = flags.adapter || "notion";
  const formatJson = flags.format === "json";
  const dryRun = flags["dry-run"] === "true";

  // Resolve stores
  const local = await resolveStore(rexDir);

  let remote;
  try {
    remote = await resolveRemoteStore(rexDir, adapterName);
  } catch (err) {
    throw new CLIError(
      `Adapter "${adapterName}" is not configured.`,
      `Run 'rex adapter add ${adapterName}' to configure it.`,
    );
  }

  const engine = new SyncEngine(local, remote);

  if (dryRun) {
    // Load both documents and report what would change
    const localDoc = await local.loadDocument();
    const remoteDoc = await remote.loadDocument();

    const localIds = new Set(collectIds(localDoc.items));
    const remoteIds = new Set(collectIds(remoteDoc.items));

    const localOnly = [...localIds].filter((id) => !remoteIds.has(id));
    const remoteOnly = [...remoteIds].filter((id) => !localIds.has(id));
    const shared = [...localIds].filter((id) => remoteIds.has(id));

    const preview = {
      direction,
      dryRun: true,
      localItems: localIds.size,
      remoteItems: remoteIds.size,
      wouldPush: direction !== "pull" ? localOnly.length : 0,
      wouldPull: direction !== "push" ? remoteOnly.length : 0,
      shared: shared.length,
    };

    if (formatJson) {
      result(JSON.stringify(preview, null, 2));
    } else {
      info(`Dry run — ${adapterName} adapter (${direction})`);
      info(`  Local items:  ${localIds.size}`);
      info(`  Remote items: ${remoteIds.size}`);
      info(`  Shared:       ${shared.length}`);
      if (direction !== "pull") {
        info(`  Would push:   ${localOnly.length}`);
      }
      if (direction !== "push") {
        info(`  Would pull:   ${remoteOnly.length}`);
      }
      result("\nNo changes written (dry run).");
    }
    return;
  }

  // Execute sync
  let report: SyncReport;
  switch (direction) {
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

  // Log the sync event
  await local.appendLog({
    timestamp: report.timestamp,
    event: "sync_completed",
    detail: `${direction} sync with ${adapterName}: ${report.pushed.length} pushed, ${report.pulled.length} pulled, ${report.conflicts.length} conflicts`,
  });

  if (formatJson) {
    result(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable output
  info(`Sync completed — ${adapterName} adapter (${direction})`);
  if (report.pushed.length > 0) info(`  Pushed:    ${report.pushed.length}`);
  if (report.pulled.length > 0) info(`  Pulled:    ${report.pulled.length}`);
  if (report.skipped.length > 0) info(`  Skipped:   ${report.skipped.length}`);
  if (report.deleted.length > 0) info(`  Deleted:   ${report.deleted.length}`);
  if (report.conflicts.length > 0) info(`  Conflicts: ${report.conflicts.length}`);
  if (report.errors.length > 0) {
    info(`  Errors:    ${report.errors.length}`);
    for (const e of report.errors) {
      info(`    ${e.itemId}: ${e.error}`);
    }
  }
  if (
    report.pushed.length === 0 &&
    report.pulled.length === 0 &&
    report.conflicts.length === 0
  ) {
    result("Already in sync.");
  } else {
    result("Done.");
  }
}

/** Recursively collect all item IDs from a PRD item tree. */
function collectIds(items: Array<{ id: string; children?: Array<{ id: string; children?: unknown[] }> }>): string[] {
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
    if (item.children) {
      ids.push(...collectIds(item.children as Array<{ id: string; children?: Array<{ id: string; children?: unknown[] }> }>));
    }
  }
  return ids;
}
