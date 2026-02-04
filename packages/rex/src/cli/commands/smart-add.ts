import { join, resolve } from "node:path";
import { access, writeFile, readFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { resolveStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import {
  reasonFromDescriptions,
  reasonFromIdeasFile,
  DEFAULT_MODEL,
} from "../../analyze/index.js";
import type { Proposal } from "../../analyze/index.js";
import type { PRDItem } from "../../schema/index.js";

const PENDING_FILE = "pending-smart-proposals.json";

async function hasRexDir(dir: string): Promise<boolean> {
  try {
    await access(join(dir, REX_DIR));
    return true;
  } catch {
    return false;
  }
}

/** Count total items (epics + features + tasks) across proposals. */
export function countProposalItems(proposals: Proposal[]): number {
  let count = 0;
  for (const p of proposals) {
    count++; // epic
    for (const f of p.features) {
      count++; // feature
      count += f.tasks.length;
    }
  }
  return count;
}

/**
 * Format proposals as a readable tree with indentation and item metadata.
 * Shows numbered headers when there are multiple proposals.
 */
export function formatProposalTree(proposals: Proposal[]): string {
  const numbered = proposals.length > 1;
  const lines: string[] = [];

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    const prefix = numbered ? `${i + 1}. ` : "  ";
    lines.push(`${prefix}[epic] ${p.epic.title}`);

    for (const f of p.features) {
      lines.push(`    [feature] ${f.title}`);
      if (f.description) {
        lines.push(`      ${f.description}`);
      }
      for (const t of f.tasks) {
        const pri = t.priority ? ` [${t.priority}]` : "";
        lines.push(`      [task] ${t.title}${pri}`);
        if (t.acceptanceCriteria?.length) {
          for (const ac of t.acceptanceCriteria) {
            lines.push(`        - ${ac}`);
          }
        }
      }
    }

    // Add blank line between proposals
    if (numbered && i < proposals.length - 1) {
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** Filter proposals by their 0-based indices. Out-of-range indices are ignored. */
export function filterProposalsByIndex(
  proposals: Proposal[],
  indices: number[],
): Proposal[] {
  return indices
    .filter((i) => i >= 0 && i < proposals.length)
    .map((i) => proposals[i]);
}

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

/**
 * Parse approval input. Accepts:
 *   "y", "yes", "a", "all" → approve all
 *   "n", "no", "none"       → reject all
 *   "1,3", "1 3", "1, 3"    → approve specific proposals by number (1-based)
 */
export function parseApprovalInput(
  input: string,
  totalProposals: number,
): { approved: number[] } | "all" | "none" {
  const trimmed = input.trim().toLowerCase();

  if (["y", "yes", "a", "all"].includes(trimmed)) return "all";
  if (["n", "no", "none", ""].includes(trimmed)) return "none";

  // Parse comma/space separated numbers (1-based → 0-based), dedup first
  const unique = [
    ...new Set(
      trimmed
        .split(/[\s,]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n) && n >= 1 && n <= totalProposals)
        .map((n) => n - 1), // convert to 0-based
    ),
  ].sort((a, b) => a - b);

  if (unique.length === 0) return "none";
  if (unique.length === totalProposals) return "all";
  return { approved: unique };
}

async function savePending(
  dir: string,
  proposals: Proposal[],
  parentId?: string,
): Promise<void> {
  const filePath = join(dir, REX_DIR, PENDING_FILE);
  await writeFile(filePath, JSON.stringify({ proposals, parentId }, null, 2));
}

async function loadPending(
  dir: string,
): Promise<{ proposals: Proposal[]; parentId?: string } | null> {
  const filePath = join(dir, REX_DIR, PENDING_FILE);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as { proposals: Proposal[]; parentId?: string };
  } catch {
    return null;
  }
}

async function clearPending(dir: string): Promise<void> {
  try {
    await unlink(join(dir, REX_DIR, PENDING_FILE));
  } catch {
    // Already gone
  }
}

async function acceptProposals(
  dir: string,
  proposals: Proposal[],
  parentId?: string,
): Promise<number> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  let addedCount = 0;

  for (const p of proposals) {
    // If scoped to a parent, skip creating the epic and attach features directly
    const epicId = parentId ?? randomUUID();

    if (!parentId) {
      const epicItem: PRDItem = {
        id: epicId,
        title: p.epic.title,
        level: "epic",
        status: "pending",
        source: "smart-add",
      };
      await store.addItem(epicItem);
      addedCount++;
    }

    for (const f of p.features) {
      const featureId = randomUUID();
      const featureItem: PRDItem = {
        id: featureId,
        title: f.title,
        level: "feature",
        status: "pending",
        source: "smart-add",
        description: f.description,
      };
      await store.addItem(featureItem, epicId);
      addedCount++;

      for (const t of f.tasks) {
        const taskId = randomUUID();
        const taskItem: PRDItem = {
          id: taskId,
          title: t.title,
          level: "task",
          status: "pending",
          source: "smart-add",
          description: t.description,
          acceptanceCriteria: t.acceptanceCriteria,
          priority: t.priority as PRDItem["priority"],
          tags: t.tags,
        };
        await store.addItem(taskItem, featureId);
        addedCount++;
      }
    }
  }

  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "smart_add_accept",
    detail: `Added ${addedCount} items from smart add`,
  });

  await clearPending(dir);

  return addedCount;
}

export async function cmdSmartAdd(
  dir: string,
  descriptions: string | string[],
  flags: Record<string, string>,
  multiFlags: Record<string, string[]> = {},
): Promise<void> {
  // Normalise to array for uniform handling
  const descList: string[] = Array.isArray(descriptions)
    ? descriptions
    : descriptions ? [descriptions] : [];
  if (!(await hasRexDir(dir))) {
    throw new CLIError(
      `Rex directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'rex init' if using rex standalone.",
    );
  }

  const accept = flags.accept === "true";
  const parentId = flags.parent;
  const filePaths: string[] = multiFlags.file ?? (flags.file ? [flags.file] : []);

  // --accept with no descriptions/files: replay cached proposals
  if (accept && descList.length === 0 && filePaths.length === 0 && !flags.format) {
    const cached = await loadPending(dir);
    if (cached && cached.proposals.length > 0) {
      info(`Accepting ${cached.proposals.length} cached proposal(s)...`);
      const added = await acceptProposals(dir, cached.proposals, cached.parentId);
      result(`Added ${added} items to PRD.`);
      return;
    }
    // No cache — fall through to error on missing descriptions
  }

  // Resolve model: --model flag → config.model → DEFAULT_MODEL
  let model: string | undefined = flags.model;
  if (!model) {
    try {
      const rexDir = join(dir, REX_DIR);
      const store = await resolveStore(rexDir);
      const config = await store.loadConfig();
      if (config.model) {
        model = config.model;
      }
    } catch {
      // Config unreadable — fall through to default
    }
  }

  // Load existing PRD for context
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();
  const existing = doc.items;

  // Validate parent if provided
  if (parentId) {
    const { findItem } = await import("../../core/tree.js");
    const parentEntry = findItem(existing, parentId);
    if (!parentEntry) {
      throw new CLIError(
        `Parent "${parentId}" not found.`,
        "Check the ID with 'rex status' and try again.",
      );
    }
  }

  let proposals: Proposal[];

  if (filePaths.length > 0) {
    // File-based idea import mode
    const resolved = filePaths.map((fp) => resolve(dir, fp));

    if (flags.format !== "json") {
      const label = resolved.length === 1
        ? `ideas file: ${resolved[0]}`
        : `${resolved.length} ideas files`;
      info(`Reading ${label}...`);
    }

    try {
      proposals = await reasonFromIdeasFile(resolved, existing, {
        model,
        dir,
        parentId,
      });
    } catch (err) {
      throw new CLIError(
        `Failed to process ideas file: ${(err as Error).message}`,
        "Check the file path and try again.",
      );
    }
  } else {
    // Description-based mode (single or multiple descriptions)
    if (flags.format !== "json") {
      const label = descList.length > 1
        ? `Analyzing ${descList.length} descriptions with LLM...`
        : "Analyzing description with LLM...";
      info(label);
    }

    try {
      proposals = await reasonFromDescriptions(descList, existing, {
        model,
        dir,
        parentId,
      });
    } catch (err) {
      throw new CLIError(
        `LLM analysis failed: ${(err as Error).message}`,
        "Check your API key and network connection, then try again.",
      );
    }
  }

  if (proposals.length === 0) {
    if (flags.format === "json") {
      result(JSON.stringify({ proposals: [], added: 0 }, null, 2));
    } else {
      result("LLM returned no proposals for the given description.");
    }
    return;
  }

  // JSON mode without --accept: return proposals for external tools
  if (flags.format === "json" && !accept) {
    result(JSON.stringify({ proposals }, null, 2));
    return;
  }

  // Display proposed structure
  const itemCount = countProposalItems(proposals);
  if (flags.format !== "json") {
    info(`\nProposed structure (${itemCount} items):`);
    info(formatProposalTree(proposals));
    info("");
  }

  // Cache proposals so they can be accepted later without re-running
  if (await hasRexDir(dir)) {
    await savePending(dir, proposals, parentId);
  }

  if (accept) {
    // Non-interactive: accept immediately
    const added = await acceptProposals(dir, proposals, parentId);
    if (flags.format === "json") {
      result(JSON.stringify({ proposals, added }, null, 2));
    } else {
      result(`Added ${added} items to PRD.`);
    }
  } else if (process.stdin.isTTY) {
    // Interactive approval flow
    const prompt = proposals.length > 1
      ? `Accept proposals? (y=all / n=none / 1,2,...=select) `
      : `Accept this proposal? (y/n) `;

    const answer = await promptUser(prompt);
    const decision = parseApprovalInput(answer, proposals.length);

    if (decision === "all") {
      const added = await acceptProposals(dir, proposals, parentId);
      result(`Added ${added} items to PRD.`);
    } else if (decision === "none") {
      info("Proposals saved. Run `rex add --accept` to accept later.");
    } else {
      // Selective approval
      const selected = filterProposalsByIndex(proposals, decision.approved);
      const names = selected.map((p) => p.epic.title).join(", ");
      info(`Accepting: ${names}`);
      const added = await acceptProposals(dir, selected, parentId);
      result(`Added ${added} items to PRD.`);

      // Cache remaining proposals for later
      const rejected = proposals.filter((_, i) => !decision.approved.includes(i));
      if (rejected.length > 0) {
        await savePending(dir, rejected, parentId);
        info(
          `${rejected.length} proposal(s) saved. Run \`rex add --accept\` to accept later.`,
        );
      }
    }
  } else {
    // Non-interactive without --accept: just show
    info("Proposals saved. Run `rex add --accept` to accept later.");
  }
}
