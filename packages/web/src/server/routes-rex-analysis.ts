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
import { randomUUID } from "node:crypto";
import { exec as foundationExec } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";
import type { WebSocketBroadcaster } from "./websocket.js";
import { insertChild, loadPRD, savePRD, appendLog } from "./routes-rex/rex-route-helpers.js";

import {
  type PRDItem,
  isPriority,
} from "./rex-gateway.js";

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
  tasks: EditedProposalTask[];
  selected: boolean;
}

interface EditedProposal {
  epic: { title: string; description?: string };
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

    // Find the rex CLI binary
    const rexBin = join(ctx.projectDir, "node_modules", ".bin", "rex");
    const rexFallback = join(ctx.projectDir, "packages", "rex", "dist", "cli", "index.js");

    const binPath = existsSync(rexBin) ? rexBin : "node";
    const binArgs = existsSync(rexBin) ? args : [rexFallback, ...args];

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
      doc.items.push(epicItem);
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
        insertChild(doc.items, epicId, featureItem);
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
          insertChild(doc.items, featureId, taskItem);
          addedCount++;
        }
      }
    }

    savePRD(ctx, doc);

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

    let addedCount = 0;
    const selectedProposals = input.proposals.filter((p) => p.selected);

    for (const p of selectedProposals) {
      const epicId = randomUUID();
      const epicItem: PRDItem = {
        id: epicId,
        title: p.epic.title.trim(),
        level: "epic",
        status: "pending",
        source: "web-proposal-editor",
      };
      if (p.epic.description?.trim()) epicItem.description = p.epic.description.trim();
      doc.items.push(epicItem);
      addedCount++;

      for (const f of p.features) {
        if (!f.selected) continue;
        const featureId = randomUUID();
        const featureItem: PRDItem = {
          id: featureId,
          title: f.title.trim(),
          level: "feature",
          status: "pending",
          source: "web-proposal-editor",
        };
        if (f.description?.trim()) featureItem.description = f.description.trim();
        insertChild(doc.items, epicId, featureItem);
        addedCount++;

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
          insertChild(doc.items, featureId, taskItem);
          addedCount++;
        }
      }
    }

    if (addedCount === 0) {
      errorResponse(res, 400, "No items selected for acceptance");
      return true;
    }

    savePRD(ctx, doc);

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
    const args = ["add", "--format=json", "--description", description];
    if (input.parentId) args.push("--parent", input.parentId);
    args.push(ctx.projectDir);

    const rexBin = join(ctx.projectDir, "node_modules", ".bin", "rex");
    const rexFallback = join(ctx.projectDir, "packages", "rex", "dist", "cli", "index.js");

    const binPath = existsSync(rexBin) ? rexBin : "node";
    const binArgs = existsSync(rexBin) ? args : [rexFallback, ...args];

    const cliResult = await foundationExec(binPath, binArgs, {
      cwd: ctx.projectDir,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (cliResult.error && !cliResult.stdout.trim()) {
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

      const rexBin = join(ctx.projectDir, "node_modules", ".bin", "rex");
      const rexFallback = join(ctx.projectDir, "packages", "rex", "dist", "cli", "index.js");

      const binPath = existsSync(rexBin) ? rexBin : "node";
      const binArgs = existsSync(rexBin) ? args : [rexFallback, ...args];

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
