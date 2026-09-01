/**
 * Restore routes: list and restore PRD tree snapshots.
 *
 * Snapshots are written automatically by mutating commands (reorganize, prune,
 * reshape, fix) via `core/backup-snapshots.ts` before those commands run. The
 * dashboard exposes one-click "apply" triggers for all four, but until this
 * module existed there was no in-app way to undo a bad apply — the CLI's own
 * `rex restore` was the only recovery path.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ServerContext } from "../types.js";
import { jsonResponse, errorResponse, readBody } from "../response-utils.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { appendLog } from "./rex-route-helpers.js";
import { getAvailableBackups, restoreFromBackup, isValidSnapshotId } from "../rex-gateway.js";

/** Render a snapshot id back into a readable ISO timestamp for display. */
function formatSnapshotId(id: string): string {
  // Ids are ISO-8601 with colons replaced by dashes (Windows-safe on disk) —
  // put the colons back for display only. Mirrors rex's own CLI formatting in
  // packages/rex/src/cli/commands/restore.ts so the two surfaces agree.
  return id.replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3");
}

/** Count files in a snapshot so the UI can show size before restoring. */
async function countFiles(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) total += await countFiles(join(dir, entry.name));
    else total++;
  }
  return total;
}

interface SnapshotSummary {
  id: string;
  timestamp: string;
  files: number;
  isLatest: boolean;
}

/** Restore routes: list available snapshots and restore one. */
export function routeRestore(
  path: string, method: string,
  req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  // GET /api/rex/backups — list available PRD tree snapshots
  if (path === "backups" && method === "GET") {
    return handleListBackups(res, ctx);
  }

  // POST /api/rex/restore — restore the PRD tree from a snapshot
  if (path === "restore" && method === "POST") {
    return handleRestore(req, res, ctx, broadcast);
  }

  return false;
}

/** Handle GET /api/rex/backups — list snapshots, newest first. */
async function handleListBackups(res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  const ids = await getAvailableBackups(ctx.rexDir);
  const backupsDir = join(ctx.rexDir, ".backups");

  const snapshots: SnapshotSummary[] = [];
  for (const [index, id] of ids.entries()) {
    const files = await countFiles(join(backupsDir, `prd_tree_${id}`));
    snapshots.push({
      id,
      timestamp: formatSnapshotId(id),
      files,
      isLatest: index === 0,
    });
  }

  jsonResponse(res, 200, { ok: true, snapshots });
  return true;
}

/** Handle POST /api/rex/restore — restore from a specific snapshot id. */
async function handleRestore(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      /** Snapshot id from GET /api/rex/backups. Required — this is a destructive, explicit operation. */
      id?: string;
      /** Confirmation token — must match the snapshot's own file count to prevent stale/mis-clicked restores. */
      confirmFiles?: number;
    };

    if (!input.id) {
      errorResponse(res, 400, "Missing required field: id");
      return true;
    }

    if (!isValidSnapshotId(input.id)) {
      errorResponse(res, 400, `Invalid snapshot id: ${input.id}`);
      return true;
    }

    const backupsDir = join(ctx.rexDir, ".backups");
    const targetPath = join(backupsDir, `prd_tree_${input.id}`);
    const exists = await stat(targetPath).then((s) => s.isDirectory()).catch(() => false);
    if (!exists) {
      errorResponse(res, 404, `Snapshot not found: ${input.id}`);
      return true;
    }

    const fileCount = await countFiles(targetPath);
    if (input.confirmFiles !== undefined && input.confirmFiles !== fileCount) {
      errorResponse(
        res, 409,
        `Stale restore request: expected ${input.confirmFiles} files but snapshot has ${fileCount}. Refresh the snapshot list.`,
      );
      return true;
    }

    await restoreFromBackup(ctx.rexDir, input.id);

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "prd_restored",
      detail: `Restored PRD tree from snapshot ${formatSnapshotId(input.id)} (${fileCount} files, via web)`,
    });

    if (broadcast) {
      broadcast({ type: "rex:prd-changed", timestamp: new Date().toISOString() });
    }

    jsonResponse(res, 200, { ok: true, restored: input.id, files: fileCount });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}
