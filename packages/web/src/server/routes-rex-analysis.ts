/**
 * Analysis and proposal routes: analyze, proposals, smart-add, batch-import.
 *
 * These routes trigger rex CLI analysis, manage pending proposals,
 * and handle natural-language-to-PRD conversion.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { exec as foundationExec } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";
import type { WebSocketBroadcaster } from "./websocket.js";
import { loadPRD, appendLog } from "./routes-rex/rex-route-helpers.js";
import { refreshPRDCache } from "./prd-io.js";

import {
  type PRDItem,
  isPriority,
  resolveStore,
  collectAllIds,
  cascadeParentReset,
} from "./rex-gateway.js";

/**
 * Resolve how to invoke the rex CLI for a given analyzed project.
 *
 * Resolution order:
 *  1. Project-local install: `<projectDir>/node_modules/.bin/rex`.
 *  2. The rex CLI resolved from THIS server's own module graph via the
 *     `@n-dx/rex/dist/*` subpath export. This is the correct path for any
 *     normal analyzed project — rex ships with the running n-dx install and
 *     must NOT be looked up under the analyzed project's directory (doing so
 *     produced `Cannot find module
 *     '<projectDir>/packages/rex/dist/cli/index.js'` whenever the dashboard
 *     pointed at a project that isn't the n-dx monorepo itself).
 *     NOTE: rex's package `exports["."]` only has an `import` condition, so
 *     a bare CJS `require.resolve("@n-dx/rex")` throws
 *     ERR_PACKAGE_PATH_NOT_EXPORTED. We resolve the CLI subpath directly,
 *     which matches the `"./dist/*"` export and works under CJS.
 *  3. Monorepo dogfood fallback: `<projectDir>/packages/rex/dist/cli/index.js`
 *     (only valid when analyzing the n-dx repo itself).
 */
function resolveRexCli(projectDir: string): { binPath: string; prefixArgs: string[] } {
  const localBin = join(projectDir, "node_modules", ".bin", "rex");
  if (existsSync(localBin)) return { binPath: localBin, prefixArgs: [] };
  try {
    const req = createRequire(import.meta.url);
    const cli = req.resolve("@n-dx/rex/dist/cli/index.js");
    if (existsSync(cli)) return { binPath: "node", prefixArgs: [cli] };
  } catch {
    /* fall through to dogfood path */
  }
  return {
    binPath: "node",
    prefixArgs: [join(projectDir, "packages", "rex", "dist", "cli", "index.js")],
  };
}

// ---------------------------------------------------------------------------
// Edited proposal types
// ---------------------------------------------------------------------------

/** Edited proposal shape sent from the proposal editor. */
interface EditedProposalTask {
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: string;
  tags?: string[];
  selected: boolean;
}

interface EditedProposalFeature {
  title: string;
  description?: string;
  /** If set, nest tasks under this existing feature instead of creating a new one. */
  existingId?: string;
  tasks: EditedProposalTask[];
  selected: boolean;
}

interface EditedProposal {
  epic: { title: string; description?: string; existingId?: string };
  features: EditedProposalFeature[];
  selected: boolean;
}

/** Validate an edited proposal tree. Returns an array of error messages. */
function validateEditedProposals(proposals: EditedProposal[]): string[] {
  const errors: string[] = [];
  for (let pi = 0; pi < proposals.length; pi++) {
    const p = proposals[pi];
    if (!p.selected) continue;
    if (!p.epic?.title?.trim()) {
      errors.push(`Proposal ${pi + 1}: epic title is required`);
    }
    for (let fi = 0; fi < (p.features ?? []).length; fi++) {
      const f = p.features[fi];
      if (!f.selected) continue;
      if (!f.title?.trim()) {
        errors.push(`Proposal ${pi + 1}, feature ${fi + 1}: title is required`);
      }
      for (let ti = 0; ti < (f.tasks ?? []).length; ti++) {
        const t = f.tasks[ti];
        if (!t.selected) continue;
        if (!t.title?.trim()) {
          errors.push(`Proposal ${pi + 1}, feature ${fi + 1}, task ${ti + 1}: title is required`);
        }
      }
    }
  }
  return errors;
}

/**
 * Compute a confidence score (0-100) for a set of proposals based on quality heuristics.
 * Higher scores indicate more complete, well-structured proposals.
 */
function computeConfidence(proposals: Record<string, unknown>[]): number {
  if (proposals.length === 0) return 0;

  let score = 50; // Base score for having any proposals

  for (const p of proposals) {
    const epic = p.epic as Record<string, unknown> | undefined;
    const features = (p.features ?? []) as Record<string, unknown>[];

    // Epic quality
    if (epic?.title && typeof epic.title === "string" && epic.title.length > 5) score += 5;
    if (epic?.description) score += 3;

    // Feature quality
    for (const f of features) {
      if (f.title && typeof f.title === "string" && f.title.length > 5) score += 2;
      if (f.description) score += 2;

      const tasks = (f.tasks ?? []) as Record<string, unknown>[];
      for (const t of tasks) {
        if (t.title && typeof t.title === "string" && t.title.length > 5) score += 1;
        if (t.description) score += 1;
        if (t.acceptanceCriteria && Array.isArray(t.acceptanceCriteria) && t.acceptanceCriteria.length > 0) score += 2;
        if (t.priority) score += 1;
      }
    }
  }

  return Math.min(100, score);
}

/** Format extension for batch import items. */
const BATCH_FORMAT_EXT: Record<string, string> = {
  text: ".txt",
  markdown: ".md",
  json: ".json",
};

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

/** Analysis and proposal routes: analyze, proposals, smart-add, batch-import. */
export function routeProposals(
  path: string, method: string,
  req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  // POST /api/rex/analyze — trigger analysis
  if (path === "analyze" && method === "POST") {
    return handleAnalyze(req, res, ctx, broadcast);
  }

  // GET /api/rex/proposals — get pending proposals
  if (path === "proposals" && method === "GET") {
    return handleGetProposals(res, ctx);
  }

  // POST /api/rex/proposals/accept — accept pending proposals
  if (path === "proposals/accept" && method === "POST") {
    return handleAcceptProposals(req, res, ctx, broadcast);
  }

  // POST /api/rex/proposals/accept-edited — accept edited proposals (inline-edited data)
  if (path === "proposals/accept-edited" && method === "POST") {
    return handleAcceptEditedProposals(req, res, ctx, broadcast);
  }

  // POST /api/rex/smart-add-preview — generate proposals from natural language (real-time preview)
  if (path === "smart-add-preview" && method === "POST") {
    return handleSmartAddPreview(req, res, ctx);
  }

  // POST /api/rex/batch-import — process multiple ideas from various sources
  if (path === "batch-import" && method === "POST") {
    return handleBatchImport(req, res, ctx, broadcast);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** Handle POST /api/rex/analyze — trigger analysis via CLI subprocess */
async function handleAnalyze(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      accept?: boolean;
      noLlm?: boolean;
      lite?: boolean;
    };

    const args = ["analyze", "--format=json"];
    if (input.accept) args.push("--accept");
    if (input.noLlm) args.push("--no-llm");
    if (input.lite) args.push("--lite");
    args.push(ctx.projectDir);

    // Resolve the rex CLI from this server's own install (see resolveRexCli)
    const { binPath, prefixArgs } = resolveRexCli(ctx.projectDir);
    const binArgs = [...prefixArgs, ...args];

    const result = await foundationExec(binPath, binArgs, {
      cwd: ctx.projectDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      // Try to parse JSON from stdout even on error (CLI may exit non-zero but still output)
      try {
        const parsed = JSON.parse(result.stdout);
        jsonResponse(res, 200, { ok: true, ...parsed });
      } catch {
        errorResponse(res, 500, `Analysis failed: ${result.stderr || result.error.message}`);
      }
    } else {
      try {
        const parsed = JSON.parse(result.stdout);
        if (broadcast) {
          broadcast({
            type: "rex:prd-changed",
            timestamp: new Date().toISOString(),
          });
        }
        jsonResponse(res, 200, { ok: true, ...parsed });
      } catch {
        // Non-JSON output — return as plain result
        jsonResponse(res, 200, { ok: true, output: result.stdout.trim() });
      }
    }
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Handle GET /api/rex/proposals — get pending proposals */
function handleGetProposals(
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const pendingPath = join(ctx.rexDir, "pending-proposals.json");
  if (!existsSync(pendingPath)) {
    jsonResponse(res, 200, { proposals: [] });
    return true;
  }
  try {
    const raw = readFileSync(pendingPath, "utf-8");
    const proposals = JSON.parse(raw);
    jsonResponse(res, 200, { proposals });
  } catch {
    jsonResponse(res, 200, { proposals: [] });
  }
  return true;
}

/** Handle POST /api/rex/proposals/accept — accept pending proposals */
async function handleAcceptProposals(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      /** Indices of proposals to accept. If not provided, accept all. */
      indices?: number[];
    };

    const pendingPath = join(ctx.rexDir, "pending-proposals.json");
    if (!existsSync(pendingPath)) {
      errorResponse(res, 404, "No pending proposals");
      return true;
    }

    const raw = readFileSync(pendingPath, "utf-8");
    const allProposals = JSON.parse(raw) as Array<{
      epic: { title: string; source: string; description?: string };
      features: Array<{
        title: string;
        source: string;
        description?: string;
        tasks: Array<{
          title: string;
          source: string;
          sourceFile: string;
          description?: string;
          acceptanceCriteria?: string[];
          priority?: string;
          tags?: string[];
        }>;
      }>;
    }>;

    // Filter to selected indices, or accept all
    const toAccept = input.indices
      ? input.indices.filter((i) => i >= 0 && i < allProposals.length).map((i) => allProposals[i])
      : allProposals;

    if (toAccept.length === 0) {
      errorResponse(res, 400, "No valid proposals to accept");
      return true;
    }

    // See handleAcceptEditedProposals: write through the rex store so items
    // land in the folder tree (the authoritative source per CLAUDE.md), not
    // the legacy prd.md that the watcher overwrites.
    const store = await resolveStore(ctx.rexDir);
    let addedCount = 0;

    for (const p of toAccept) {
      const epicId = randomUUID();
      const epicItem: PRDItem = {
        id: epicId,
        title: p.epic.title,
        level: "epic",
        status: "pending",
        source: p.epic.source,
      };
      if (p.epic.description) epicItem.description = p.epic.description;
      await store.addItem(epicItem);
      addedCount++;

      for (const f of p.features) {
        const featureId = randomUUID();
        const featureItem: PRDItem = {
          id: featureId,
          title: f.title,
          level: "feature",
          status: "pending",
          source: f.source,
        };
        if (f.description) featureItem.description = f.description;
        await store.addItem(featureItem, epicId);
        addedCount++;

        for (const t of f.tasks) {
          const taskId = randomUUID();
          const taskItem: PRDItem = {
            id: taskId,
            title: t.title,
            level: "task",
            status: "pending",
            source: t.source,
          };
          if (t.description) taskItem.description = t.description;
          if (t.acceptanceCriteria) taskItem.acceptanceCriteria = t.acceptanceCriteria;
          if (t.priority && isPriority(t.priority)) taskItem.priority = t.priority;
          if (t.tags) taskItem.tags = t.tags;
          await store.addItem(taskItem, featureId);
          addedCount++;
        }
      }
    }

    // Refresh the cache from the store so the dashboard sees the new items
    // immediately (see handleAcceptEditedProposals for context).
    refreshPRDCache(ctx.rexDir, await store.loadDocument());

    // Remove accepted proposals from pending (keep remaining)
    if (input.indices && input.indices.length < allProposals.length) {
      const remaining = allProposals.filter((_, i) => !input.indices!.includes(i));
      if (remaining.length > 0) {
        writeFileSync(pendingPath, JSON.stringify(remaining, null, 2));
      } else {
        try { writeFileSync(pendingPath, "[]"); } catch { /* ignore */ }
      }
    } else {
      // All accepted — clear pending
      try { writeFileSync(pendingPath, "[]"); } catch { /* ignore */ }
    }

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "analyze_accept",
      detail: `Accepted ${toAccept.length} proposals (${addedCount} items) via web`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 200, { ok: true, acceptedCount: toAccept.length, addedCount });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Handle POST /api/rex/proposals/accept-edited — accept edited proposals with inline changes */
async function handleAcceptEditedProposals(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      proposals: EditedProposal[];
      /** If true, only validate — don't commit changes. */
      validateOnly?: boolean;
    };

    if (!Array.isArray(input.proposals) || input.proposals.length === 0) {
      errorResponse(res, 400, "No proposals provided");
      return true;
    }

    // Validate
    const errors = validateEditedProposals(input.proposals);
    if (input.validateOnly) {
      jsonResponse(res, 200, { ok: errors.length === 0, errors });
      return true;
    }
    if (errors.length > 0) {
      errorResponse(res, 400, `Validation failed: ${errors.join("; ")}`);
      return true;
    }

    // Write through the rex store so items land in the folder tree
    // (.rex/prd_tree/), the authoritative source per CLAUDE.md. Respect
    // `existingId` on epic/feature so smart-placement nests under the
    // matched container instead of creating a duplicate.
    const store = await resolveStore(ctx.rexDir);
    const knownIds = new Set(collectAllIds((await store.loadDocument()).items));
    // Parents whose status may need reverting from `completed` to `pending`
    // after we nest a new task underneath them. Deduped so we only cascade
    // each branch once at the end.
    const parentsToCascade = new Set<string>();
    let addedCount = 0;
    const selectedProposals = input.proposals.filter((p) => p.selected);

    for (const p of selectedProposals) {
      let epicId: string;
      if (p.epic.existingId && knownIds.has(p.epic.existingId)) {
        epicId = p.epic.existingId;
        console.log(`[accept-edited] reuse epic id=${epicId} title="${p.epic.title}"`);
      } else {
        if (p.epic.existingId) {
          console.log(
            `[accept-edited] payload epic.existingId="${p.epic.existingId}" not found in PRD — creating new`,
          );
        } else {
          console.log(`[accept-edited] no existingId for epic "${p.epic.title}" — creating new`);
        }
        epicId = randomUUID();
        const epicItem: PRDItem = {
          id: epicId,
          title: p.epic.title.trim(),
          level: "epic",
          status: "pending",
          source: "web-proposal-editor",
        };
        if (p.epic.description?.trim()) epicItem.description = p.epic.description.trim();
        await store.addItem(epicItem);
        knownIds.add(epicId);
        addedCount++;
      }

      for (const f of p.features) {
        if (!f.selected) continue;
        let featureId: string;
        if (f.existingId && knownIds.has(f.existingId)) {
          featureId = f.existingId;
          console.log(`[accept-edited] reuse feature id=${featureId} title="${f.title}"`);
        } else {
          featureId = randomUUID();
          const featureItem: PRDItem = {
            id: featureId,
            title: f.title.trim(),
            level: "feature",
            status: "pending",
            source: "web-proposal-editor",
          };
          if (f.description?.trim()) featureItem.description = f.description.trim();
          await store.addItem(featureItem, epicId);
          knownIds.add(featureId);
          addedCount++;
        }

        for (const t of f.tasks) {
          if (!t.selected) continue;
          const taskId = randomUUID();
          const taskItem: PRDItem = {
            id: taskId,
            title: t.title.trim(),
            level: "task",
            status: "pending",
            source: "web-proposal-editor",
          };
          if (t.description?.trim()) taskItem.description = t.description.trim();
          if (t.acceptanceCriteria?.length) taskItem.acceptanceCriteria = t.acceptanceCriteria;
          if (t.priority && isPriority(t.priority)) taskItem.priority = t.priority;
          if (t.tags?.length) taskItem.tags = t.tags;
          await store.addItem(taskItem, featureId);
          knownIds.add(taskId);
          parentsToCascade.add(featureId);
          addedCount++;
        }
      }
    }

    // Reset any completed feature/epic in the chain back to `pending` now
    // that they have a new in-progress task underneath them.
    for (const parentId of parentsToCascade) {
      const { resetItems } = await cascadeParentReset(store, parentId);
      for (const item of resetItems) {
        console.log(`[accept-edited] reset ${item.level} id=${item.id} title="${item.title}" -> pending`);
      }
    }

    if (addedCount === 0) {
      errorResponse(res, 400, "No items selected for acceptance");
      return true;
    }

    // Refresh the cache from the store so the next GET /api/rex/prd in the
    // same tick sees the new items (the folder-tree watcher would catch up
    // eventually, but we want immediate visibility for the dashboard).
    refreshPRDCache(ctx.rexDir, await store.loadDocument());

    // Clear pending proposals file
    const pendingPath = join(ctx.rexDir, "pending-proposals.json");
    if (existsSync(pendingPath)) {
      try { writeFileSync(pendingPath, "[]"); } catch { /* ignore */ }
    }

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "proposals_edited_accept",
      detail: `Accepted ${selectedProposals.length} edited proposals (${addedCount} items) via proposal editor`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 200, { ok: true, acceptedCount: selectedProposals.length, addedCount });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Handle POST /api/rex/smart-add-preview — generate proposals from natural language */
async function handleSmartAddPreview(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      text: string;
      parentId?: string;
    };

    if (!input.text || typeof input.text !== "string" || input.text.trim().length === 0) {
      errorResponse(res, 400, "Text is required");
      return true;
    }

    // Minimum length to avoid wasteful LLM calls
    if (input.text.trim().length < 5) {
      jsonResponse(res, 200, { proposals: [], confidence: 0, qualityIssues: [] });
      return true;
    }

    // Use rex CLI add (smart mode) with --format=json (no --accept = preview mode).
    // Pass description via --description flag (not positional) to prevent any
    // stale UI text from being concatenated into the argument list.
    const description = String(input.text).trim();
    // The dashboard preview is a draft the user reviews — `--fast` forces the
    // vendor's light tier (e.g. haiku) so the CLI provider completes well
    // within the timeout from a daemonized server. The user-driven CLI
    // `n-dx add` keeps the configured top-tier model.
    const args = ["add", "--format=json", "--fast", "--description", description];
    if (input.parentId) args.push("--parent", input.parentId);
    args.push(ctx.projectDir);

    const { binPath, prefixArgs } = resolveRexCli(ctx.projectDir);
    const binArgs = [...prefixArgs, ...args];

    // Smart add does a full LLM round-trip to generate a proposal tree.
    // The Claude CLI provider (no API key needed) normally returns in well
    // under a minute; a timeout here means the spawned `claude` process
    // itself stalled in the server context (e.g. token refresh with no TTY,
    // or a different PATH/env than your shell) — not a missing API key.
    const SMART_ADD_TIMEOUT_MS = 240_000;
    const startedAt = Date.now();
    console.log(`[smart-add-preview] spawn`, { binPath, binArgs, cwd: ctx.projectDir });
    const cliResult = await foundationExec(binPath, binArgs, {
      cwd: ctx.projectDir,
      timeout: SMART_ADD_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    const elapsedMs = Date.now() - startedAt;
    console.log(`[smart-add-preview] finished in ${elapsedMs}ms`, {
      exitCode: cliResult.exitCode,
      stdoutBytes: cliResult.stdout.length,
      stderrBytes: cliResult.stderr.length,
    });
    if (cliResult.stderr.trim()) {
      console.log(`[smart-add-preview] stderr:\n${cliResult.stderr.trim()}`);
    }

    if (cliResult.error && !cliResult.stdout.trim()) {
      if (cliResult.exitCode === null) {
        throw new Error(
          `Smart add timed out after ${SMART_ADD_TIMEOUT_MS / 1000}s — the LLM call never returned. ` +
            `The Claude CLI provider is in use (this is normal without an API key). ` +
            `Verify the CLI works from the environment that launched the dashboard: ` +
            `\`time claude -p "hi"\`. If that hangs, the \`claude\` CLI isn't usable there ` +
            `(re-auth with \`claude\`, or run \`ndx start\` from a shell where it works). ` +
            `An API key (\`n-dx config claude.api_key\`) is an optional faster path, not required.` +
            (cliResult.stderr.trim() ? `\n\nstderr:\n${cliResult.stderr.trim()}` : ""),
        );
      }
      throw new Error(cliResult.stderr || cliResult.error.message);
    }

    try {
      const parsed = JSON.parse(cliResult.stdout);
      const proposals = parsed.proposals ?? [];

      // Compute a confidence score based on proposal quality
      const confidence = computeConfidence(Array.isArray(proposals) ? proposals : []);

      jsonResponse(res, 200, {
        proposals: Array.isArray(proposals) ? proposals : [],
        confidence,
        qualityIssues: parsed.qualityIssues ?? [],
      });
    } catch {
      // Non-JSON output — return empty
      jsonResponse(res, 200, { proposals: [], confidence: 0, qualityIssues: [] });
    }
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/** Handle POST /api/rex/batch-import — process multiple ideas with consolidated review */
async function handleBatchImport(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      items: Array<{
        content: string;
        format?: "text" | "markdown" | "json";
        source?: string;
      }>;
      parentId?: string;
      /** If true, accept proposals immediately without returning for review. */
      accept?: boolean;
    };

    if (!Array.isArray(input.items) || input.items.length === 0) {
      errorResponse(res, 400, "At least one import item is required");
      return true;
    }

    // Validate items
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      if (!item.content || typeof item.content !== "string" || item.content.trim().length === 0) {
        errorResponse(res, 400, `Item ${i + 1} has empty content`);
        return true;
      }
    }

    // Write items to temp files and build --file args for rex CLI
    const tmpDir = mkdtempSync(join(tmpdir(), "rex-batch-"));
    const filePaths: string[] = [];
    const itemSources: string[] = [];

    try {
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const format = item.format ?? "text";
        const ext = BATCH_FORMAT_EXT[format] ?? ".txt";
        const fileName = `batch-${i}${ext}`;
        const filePath = join(tmpDir, fileName);
        writeFileSync(filePath, item.content, "utf-8");
        filePaths.push(filePath);
        itemSources.push(item.source ?? fileName);
      }

      // Build rex CLI args: add --format=json --file=<f1> --file=<f2> ...
      const args = ["add", "--format=json"];
      if (input.parentId) args.push("--parent", input.parentId);
      if (input.accept) args.push("--accept");
      for (const fp of filePaths) {
        args.push(`--file=${fp}`);
      }
      args.push(ctx.projectDir);

      const { binPath, prefixArgs } = resolveRexCli(ctx.projectDir);
      const binArgs = [...prefixArgs, ...args];

      const cliResult = await foundationExec(binPath, binArgs, {
        cwd: ctx.projectDir,
        timeout: 120_000, // 2 minutes — batch may take longer
        maxBuffer: 10 * 1024 * 1024,
      });

      if (cliResult.error && !cliResult.stdout.trim()) {
        throw new Error(cliResult.stderr || cliResult.error.message);
      }

      // Parse the JSON output from rex CLI
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(cliResult.stdout);
      } catch {
        jsonResponse(res, 200, {
          proposals: [],
          confidence: 0,
          qualityIssues: [],
          itemCount: input.items.length,
          itemSources,
        });
        return true;
      }

      const proposals = parsed.proposals ?? [];
      const proposalArray = Array.isArray(proposals) ? proposals : [];
      const confidence = computeConfidence(proposalArray as Record<string, unknown>[]);

      // If accept mode was used, proposals were already committed
      if (input.accept && parsed.added) {
        appendLog(ctx, {
          timestamp: new Date().toISOString(),
          event: "batch_import_accept",
          detail: `Batch imported ${input.items.length} items (${parsed.added} PRD items added) from: ${itemSources.join(", ")}`,
        });

        if (broadcast) {
          broadcast({
            type: "rex:prd-changed",
            timestamp: new Date().toISOString(),
          });
        }
      }

      jsonResponse(res, 200, {
        proposals: proposalArray,
        confidence,
        qualityIssues: parsed.qualityIssues ?? [],
        itemCount: input.items.length,
        itemSources,
        added: parsed.added ?? 0,
      });
    } finally {
      // Clean up temp files
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}
