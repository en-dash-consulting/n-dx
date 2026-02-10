import { join, resolve } from "node:path";
import { access, writeFile, readFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { resolveStore } from "../../store/index.js";
import { findItem } from "../../core/tree.js";
import { cascadeParentReset } from "../../core/cascade-reset.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, warn, result } from "../output.js";
import {
  reasonFromDescriptions,
  reasonFromIdeasFile,
  validateProposalQuality,
  DEFAULT_MODEL,
  setClaudeConfig,
  getAuthMode,
} from "../../analyze/index.js";
import type { Proposal, QualityIssue } from "../../analyze/index.js";
import { CHILD_LEVEL } from "../../schema/index.js";
import type { PRDItem, ItemLevel } from "../../schema/index.js";
import { loadClaudeConfig } from "../../store/project-config.js";

const PENDING_FILE = "pending-smart-proposals.json";

async function hasRexDir(dir: string): Promise<boolean> {
  try {
    await access(join(dir, REX_DIR));
    return true;
  } catch {
    return false;
  }
}

/**
 * Count total items that will be added across proposals.
 *
 * When `parentLevel` is provided, the count reflects which items actually get
 * created (e.g. when scoped to an epic, the epic itself is not counted; when
 * scoped to a feature, only tasks are counted).
 */
export function countProposalItems(
  proposals: Proposal[],
  parentLevel?: ItemLevel,
): number {
  let count = 0;
  for (const p of proposals) {
    if (!parentLevel) {
      count++; // epic
    }
    if (!parentLevel || parentLevel === "epic") {
      for (const f of p.features) {
        count++; // feature
        count += f.tasks.length;
      }
    } else {
      // feature or task parent — only task-level items are created
      for (const f of p.features) {
        count += f.tasks.length;
      }
    }
  }
  return count;
}

/**
 * Format proposals as a readable tree with indentation and item metadata.
 * Shows numbered headers when there are multiple proposals.
 *
 * When `parentLevel` is provided, the display adapts to show items at the
 * correct hierarchy level relative to the parent (e.g. when the parent is
 * a feature, proposal features' tasks are shown as tasks under that feature).
 */
export function formatProposalTree(
  proposals: Proposal[],
  parentLevel?: ItemLevel,
): string {
  const numbered = proposals.length > 1;
  const lines: string[] = [];

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];

    if (!parentLevel || parentLevel === "epic") {
      // Default: full epic → feature → task tree
      const prefix = numbered ? `${i + 1}. ` : "  ";
      if (!parentLevel) {
        lines.push(`${prefix}[epic] ${p.epic.title}`);
      }

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
    } else if (parentLevel === "feature") {
      // Parent is a feature — show tasks directly
      for (const f of p.features) {
        for (const t of f.tasks) {
          const pri = t.priority ? ` [${t.priority}]` : "";
          lines.push(`    [task] ${t.title}${pri}`);
          if (t.description) {
            lines.push(`      ${t.description}`);
          }
          if (t.acceptanceCriteria?.length) {
            for (const ac of t.acceptanceCriteria) {
              lines.push(`      - ${ac}`);
            }
          }
        }
      }
    } else if (parentLevel === "task") {
      // Parent is a task — show subtasks
      for (const f of p.features) {
        for (const t of f.tasks) {
          const pri = t.priority ? ` [${t.priority}]` : "";
          lines.push(`    [subtask] ${t.title}${pri}`);
          if (t.description) {
            lines.push(`      ${t.description}`);
          }
          if (t.acceptanceCriteria?.length) {
            for (const ac of t.acceptanceCriteria) {
              lines.push(`      - ${ac}`);
            }
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

/**
 * Parse granularity adjustment input from the approval prompt.
 * Accepts:
 *   "b1,3" or "b 1 3" or "break down 1,3"  → break down proposals 1 and 3
 *   "c1,3" or "c 1 3" or "consolidate 1,3"  → consolidate proposals 1 and 3
 *
 * Returns null if the input is not a granularity command.
 */
export function parseGranularityInput(
  input: string,
  totalProposals: number,
): { direction: "break_down" | "consolidate"; indices: number[] } | null {
  const raw = input.trim();

  // Break down: "b1,3" or "break down 1,3" or "b 1 3"
  const breakMatch = raw.match(/^[bB](?:reak\s*down)?\s*(.+)$/i);
  if (breakMatch) {
    const indices = parseNumericList(breakMatch[1], totalProposals);
    if (indices.length > 0) {
      return { direction: "break_down", indices };
    }
  }

  // Consolidate: "c1,3" or "consolidate 1,3" or "c 1 3"
  const consolidateMatch = raw.match(/^[cC](?:onsolidate)?\s*(.+)$/i);
  if (consolidateMatch) {
    const indices = parseNumericList(consolidateMatch[1], totalProposals);
    if (indices.length > 0) {
      return { direction: "consolidate", indices };
    }
  }

  return null;
}

/**
 * Parse comma/space-separated 1-based numbers into sorted, deduplicated 0-based indices.
 */
function parseNumericList(input: string, total: number): number[] {
  return [...new Set(
    input
      .trim()
      .split(/[\s,]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n) && n >= 1 && n <= total)
      .map((n) => n - 1),
  )].sort((a, b) => a - b);
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

/**
 * Resolve the level of the parent item when parentId is provided.
 * Returns null when the parent does not exist or no parentId is given.
 */
async function resolveParentLevel(
  dir: string,
  parentId: string | undefined,
): Promise<ItemLevel | null> {
  if (!parentId) return null;
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();
  const entry = findItem(doc.items, parentId);
  return entry?.item.level ?? null;
}

/**
 * Format quality issues as a human-readable warning block.
 * Returns empty string when there are no issues.
 */
export function formatQualityWarnings(issues: QualityIssue[]): string {
  if (issues.length === 0) return "";

  const lines: string[] = ["Quality warnings:"];
  for (const issue of issues) {
    const icon = issue.level === "error" ? "✗" : "⚠";
    lines.push(`  ${icon} ${issue.message}`);
    lines.push(`    at ${issue.path}`);
  }
  return lines.join("\n");
}

async function acceptProposals(
  dir: string,
  proposals: Proposal[],
  parentId?: string,
): Promise<number> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const parentLevel = await resolveParentLevel(dir, parentId);

  let addedCount = 0;

  for (const p of proposals) {
    if (!parentId) {
      // No parent — create a new top-level epic with features and tasks beneath
      const epicId = randomUUID();
      await store.addItem({
        id: epicId,
        title: p.epic.title,
        level: "epic",
        status: "pending",
        source: "smart-add",
      });
      addedCount++;

      for (const f of p.features) {
        const featureId = randomUUID();
        await store.addItem(
          {
            id: featureId,
            title: f.title,
            level: "feature",
            status: "pending",
            source: "smart-add",
            description: f.description,
          },
          epicId,
        );
        addedCount++;

        for (const t of f.tasks) {
          await store.addItem(
            {
              id: randomUUID(),
              title: t.title,
              level: "task",
              status: "pending",
              source: "smart-add",
              description: t.description,
              acceptanceCriteria: t.acceptanceCriteria,
              priority: t.priority as PRDItem["priority"],
              tags: t.tags,
            },
            featureId,
          );
          addedCount++;
        }
      }
    } else if (parentLevel === "epic") {
      // Parent is an epic — attach features (and their tasks) directly
      for (const f of p.features) {
        const featureId = randomUUID();
        await store.addItem(
          {
            id: featureId,
            title: f.title,
            level: "feature",
            status: "pending",
            source: "smart-add",
            description: f.description,
          },
          parentId,
        );
        addedCount++;

        for (const t of f.tasks) {
          await store.addItem(
            {
              id: randomUUID(),
              title: t.title,
              level: "task",
              status: "pending",
              source: "smart-add",
              description: t.description,
              acceptanceCriteria: t.acceptanceCriteria,
              priority: t.priority as PRDItem["priority"],
              tags: t.tags,
            },
            featureId,
          );
          addedCount++;
        }
      }
    } else if (parentLevel === "feature") {
      // Parent is a feature — flatten proposal features' tasks as direct
      // children of the feature (level: task)
      for (const f of p.features) {
        for (const t of f.tasks) {
          await store.addItem(
            {
              id: randomUUID(),
              title: t.title,
              level: "task",
              status: "pending",
              source: "smart-add",
              description: t.description,
              acceptanceCriteria: t.acceptanceCriteria,
              priority: t.priority as PRDItem["priority"],
              tags: t.tags,
            },
            parentId,
          );
          addedCount++;
        }
      }
    } else if (parentLevel === "task") {
      // Parent is a task — flatten everything as subtasks
      for (const f of p.features) {
        for (const t of f.tasks) {
          await store.addItem(
            {
              id: randomUUID(),
              title: t.title,
              level: "subtask",
              status: "pending",
              source: "smart-add",
              description: t.description,
              acceptanceCriteria: t.acceptanceCriteria,
              priority: t.priority as PRDItem["priority"],
              tags: t.tags,
            },
            parentId,
          );
          addedCount++;
        }
      }
    }
  }

  // Reset completed ancestors when adding under a completed parent
  await cascadeParentReset(store, parentId);

  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "smart_add_accept",
    detail: `Added ${addedCount} items from smart add${parentId ? ` under parent ${parentId}` : ""}`,
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

  // Load unified Claude config and initialize the client abstraction layer
  const rexConfigDir = join(dir, REX_DIR);
  const claudeConfig = await loadClaudeConfig(rexConfigDir);
  setClaudeConfig(claudeConfig);

  // Display which authentication method will be used for LLM calls
  if (flags.format !== "json") {
    const authMode = getAuthMode();
    if (authMode === "api") {
      info("Using direct API authentication.");
    }
  }

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

  // Validate parent if provided and resolve its level
  let parentLevel: ItemLevel | undefined;
  if (parentId) {
    const parentEntry = findItem(existing, parentId);
    if (!parentEntry) {
      throw new CLIError(
        `Parent "${parentId}" not found.`,
        "Check the ID with 'rex status' and try again.",
      );
    }
    parentLevel = parentEntry.item.level;
    if (parentLevel === "subtask") {
      throw new CLIError(
        "Cannot add children under a subtask.",
        "Subtasks are leaf nodes. Specify a task, feature, or epic as the parent.",
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
      const reasonResult = await reasonFromIdeasFile(resolved, existing, {
        model,
        dir,
        parentId,
      });
      proposals = reasonResult.proposals;
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
      const reasonResult = await reasonFromDescriptions(descList, existing, {
        model,
        dir,
        parentId,
      });
      proposals = reasonResult.proposals;
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

  // Validate proposal quality
  const qualityIssues = validateProposalQuality(proposals);

  // JSON mode without --accept: return proposals for external tools
  if (flags.format === "json" && !accept) {
    result(JSON.stringify({ proposals, qualityIssues }, null, 2));
    return;
  }

  // Display proposed structure
  const itemCount = countProposalItems(proposals, parentLevel);
  if (flags.format !== "json") {
    if (parentId && parentLevel) {
      info(`\nProposed additions under parent ${parentId} (${itemCount} items):`);
    } else {
      info(`\nProposed structure (${itemCount} items):`);
    }
    info(formatProposalTree(proposals, parentLevel));

    // Show quality warnings if any
    if (qualityIssues.length > 0) {
      warn("");
      warn(formatQualityWarnings(qualityIssues));
    }

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
      result(JSON.stringify({ proposals, added, qualityIssues }, null, 2));
    } else {
      if (qualityIssues.length > 0) {
        warn(`Accepted with ${qualityIssues.length} quality warning(s).`);
      }
      result(`Added ${added} items to PRD.`);
    }
  } else if (process.stdin.isTTY) {
    // Interactive approval flow with granularity adjustment support
    const { adjustGranularity } = await import("../../analyze/index.js");
    const resolvedModel = model ?? DEFAULT_MODEL;

    let currentProposals = proposals;
    let done = false;

    while (!done) {
      const prompt = currentProposals.length > 1
        ? `Accept proposals? (y=all / n=none / b#=break down / c#=consolidate / 1,2,...=select) `
        : `Accept this proposal? (y/n / b1=break down / c1=consolidate) `;

      const answer = await promptUser(prompt);

      // Check for granularity commands before parsing approval
      const granularityResult = parseGranularityInput(answer, currentProposals.length);

      if (granularityResult) {
        const targetProposals = granularityResult.indices.map(
          (i) => currentProposals[i],
        );
        const label = granularityResult.direction === "break_down"
          ? "Breaking down"
          : "Consolidating";
        info(`${label} proposal(s) ${granularityResult.indices.map((i) => i + 1).join(", ")}...`);

        try {
          const adjusted = await adjustGranularity(
            targetProposals,
            granularityResult.direction,
            resolvedModel,
          );
          if (adjusted.proposals.length > 0) {
            // Replace targeted proposals with adjusted ones
            const newProposals = [...currentProposals];
            // Remove originals (in reverse to preserve indices)
            const sorted = [...granularityResult.indices].sort((a, b) => b - a);
            for (const idx of sorted) {
              newProposals.splice(idx, 1);
            }
            const insertAt = Math.min(...granularityResult.indices);
            newProposals.splice(insertAt, 0, ...adjusted.proposals);
            currentProposals = newProposals;

            const actionLabel = granularityResult.direction === "break_down"
              ? "broken down"
              : "consolidated";
            info(
              `Replaced ${targetProposals.length} proposal(s) with ${adjusted.proposals.length} ${actionLabel} proposal(s).`,
            );

            // Re-display the proposal tree
            const itemCount = countProposalItems(currentProposals, parentLevel);
            info(`\nUpdated structure (${itemCount} items):`);
            info(formatProposalTree(currentProposals, parentLevel));
            info("");

            // Update cache with adjusted proposals
            if (await hasRexDir(dir)) {
              await savePending(dir, currentProposals, parentId);
            }
          } else {
            info("LLM returned no proposals. Original proposals unchanged.");
          }
        } catch (err) {
          info(`Granularity adjustment failed: ${(err as Error).message}`);
          info("Original proposals unchanged.");
        }
        continue; // Re-prompt
      }

      const decision = parseApprovalInput(answer, currentProposals.length);

      if (decision === "all") {
        const added = await acceptProposals(dir, currentProposals, parentId);
        result(`Added ${added} items to PRD.`);
        done = true;
      } else if (decision === "none") {
        info("Proposals saved. Run `rex add --accept` to accept later.");
        done = true;
      } else {
        // Selective approval
        const selected = filterProposalsByIndex(currentProposals, decision.approved);
        const names = selected.map((p) => p.epic.title).join(", ");
        info(`Accepting: ${names}`);
        const added = await acceptProposals(dir, selected, parentId);
        result(`Added ${added} items to PRD.`);

        // Cache remaining proposals for later
        const rejected = currentProposals.filter((_, i) => !decision.approved.includes(i));
        if (rejected.length > 0) {
          await savePending(dir, rejected, parentId);
          info(
            `${rejected.length} proposal(s) saved. Run \`rex add --accept\` to accept later.`,
          );
        }
        done = true;
      }
    }
  } else {
    // Non-interactive without --accept: just show
    info("Proposals saved. Run `rex add --accept` to accept later.");
  }
}
