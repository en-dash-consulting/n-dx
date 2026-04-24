import { join, resolve } from "node:path";
import { access, readFile, unlink } from "node:fs/promises";
import { atomicWriteJSON } from "../../store/atomic-write.js";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import {
  resolveStore,
  FileStore,
  resolvePRDFile,
  findPRDFileForBranch,
  resolveGitBranch,
  resolvePRDFilename,
} from "../../store/index.js";
import { findItem } from "../../core/tree.js";
import { cascadeParentReset } from "../../core/parent-reset.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { classifyLLMError } from "../llm-error-classifier.js";
import { info, warn, result, startSpinner } from "../output.js";
import {
  reasonFromDescriptions,
  reasonFromIdeasFile,
  validateProposalQuality,
  resolveConfiguredModel,
  setLLMConfig,
  setClaudeConfig,
  getAuthMode,
  getLLMVendor,
  applyConsolidationGuard,
} from "../../analyze/index.js";
import type { Proposal, QualityIssue } from "../../analyze/index.js";
import { CHILD_LEVEL, PRIORITY_ORDER, LOE_DEFAULTS } from "../../schema/index.js";
import type { PRDItem, ItemLevel, DuplicateOverrideMarker, LoEConfig } from "../../schema/index.js";
import { loadClaudeConfig, loadLLMConfig } from "../../store/project-config.js";
import { hashPRD } from "../../core/pending-cache.js";
import {
  matchProposalNodesToPRD,
  attachDuplicateReasonsToProposals,
  buildDuplicateOverrideMarkerIndex,
} from "./smart-add-duplicates.js";
import type { ProposalDuplicateMatch, ItemFileMap } from "./smart-add-duplicates.js";
import type { LLMVendor, LLMConfig } from "@n-dx/llm-client";
import { printVendorModelHeader, resolveVendorModel } from "@n-dx/llm-client";
import { formatTaskLoE, formatTaskLoERationale } from "./format-loe.js";
import { resolveVendorCompatibleRexModel } from "../model-resolution.js";

const PENDING_FILE = "pending-smart-proposals.json";

function isLLMDebugEnabled(): boolean {
  const v = process.env.NDX_DEBUG_LLM ?? process.env.NDX_DEBUG;
  return v === "1" || v === "true" || v === "yes";
}

function llmDebug(message: string): void {
  if (isLLMDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.error(`[ndx:rex:smart-add] ${message}`);
  }
}

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
  thresholdWeeks?: number,
): string {
  const numbered = proposals.length > 1;
  const lines: string[] = [];

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];

    if (!parentLevel || parentLevel === "epic") {
      // Default: full epic → feature → task tree
      const prefix = numbered ? `${i + 1}. ` : "  ";
      if (!parentLevel) {
        const epicLabel = p.epic.existingId
          ? `${prefix}📦 Under existing: "${p.epic.title}" (${p.epic.existingId.slice(0, 8)}...)`
          : `${prefix}📦 ${p.epic.title}`;
        lines.push(epicLabel);
      }

      for (let fi = 0; fi < p.features.length; fi++) {
        const f = p.features[fi];
        const isLastFeature = fi === p.features.length - 1;
        const branch = isLastFeature ? "└─" : "├─";
        const featureLabel = f.existingId
          ? `    ${branch} 📋 Under existing: "${f.title}" (${f.existingId.slice(0, 8)}...)`
          : `    ${branch} 📋 ${f.title}`;
        lines.push(featureLabel);
        if (f.description) {
          const cont = isLastFeature ? "  " : "│ ";
          lines.push(`    ${cont}   ${f.description}`);
        }
        for (let ti = 0; ti < f.tasks.length; ti++) {
          const t = f.tasks[ti];
          const isLastTask = ti === f.tasks.length - 1;
          const cont = isLastFeature ? "  " : "│ ";
          const taskBranch = isLastTask ? "└─" : "├─";
          const pri = t.priority ? ` [${t.priority}]` : "";
          const loe = formatTaskLoE(t, thresholdWeeks);
          lines.push(`    ${cont}   ${taskBranch} ○ ${t.title}${pri}${loe}`);
          const rationale = formatTaskLoERationale(t, `    ${cont}   ${isLastTask ? "  " : "│ "}   `);
          if (rationale) lines.push(rationale);
          if (t.acceptanceCriteria?.length) {
            const taskCont = isLastTask ? "  " : "│ ";
            for (const ac of t.acceptanceCriteria) {
              lines.push(`    ${cont}   ${taskCont}   ✓ ${ac}`);
            }
          }
        }
      }
    } else if (parentLevel === "feature") {
      // Parent is a feature — show tasks directly
      for (const f of p.features) {
        for (let ti = 0; ti < f.tasks.length; ti++) {
          const t = f.tasks[ti];
          const isLast = ti === f.tasks.length - 1;
          const branch = isLast ? "└─" : "├─";
          const pri = t.priority ? ` [${t.priority}]` : "";
          const loe = formatTaskLoE(t, thresholdWeeks);
          lines.push(`    ${branch} ○ ${t.title}${pri}${loe}`);
          const rationale = formatTaskLoERationale(t, `    ${isLast ? "  " : "│ "}   `);
          if (rationale) lines.push(rationale);
          if (t.description) {
            const cont = isLast ? "  " : "│ ";
            lines.push(`    ${cont}   ${t.description}`);
          }
          if (t.acceptanceCriteria?.length) {
            const cont = isLast ? "  " : "│ ";
            for (const ac of t.acceptanceCriteria) {
              lines.push(`    ${cont}   ✓ ${ac}`);
            }
          }
        }
      }
    } else if (parentLevel === "task") {
      // Parent is a task — show subtasks
      for (const f of p.features) {
        for (let ti = 0; ti < f.tasks.length; ti++) {
          const t = f.tasks[ti];
          const isLast = ti === f.tasks.length - 1;
          const branch = isLast ? "└─" : "├─";
          const pri = t.priority ? ` [${t.priority}]` : "";
          const loe = formatTaskLoE(t, thresholdWeeks);
          lines.push(`    ${branch} ○ ${t.title}${pri}${loe}`);
          const rationale = formatTaskLoERationale(t, `    ${isLast ? "  " : "│ "}   `);
          if (rationale) lines.push(rationale);
          if (t.description) {
            const cont = isLast ? "  " : "│ ";
            lines.push(`    ${cont}   ${t.description}`);
          }
          if (t.acceptanceCriteria?.length) {
            const cont = isLast ? "  " : "│ ";
            for (const ac of t.acceptanceCriteria) {
              lines.push(`    ${cont}   ✓ ${ac}`);
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

/**
 * Build a summary line showing the breakdown of items by level.
 * Example: "1 epic, 2 features, 5 tasks"
 */
export function formatProposalSummary(
  proposals: Proposal[],
  parentLevel?: ItemLevel,
): string {
  let epics = 0;
  let features = 0;
  let tasks = 0;

  for (const p of proposals) {
    if (!parentLevel) epics++;
    if (!parentLevel || parentLevel === "epic") {
      features += p.features.length;
    }
    for (const f of p.features) {
      tasks += f.tasks.length;
    }
  }

  const parts: string[] = [];
  if (epics > 0) parts.push(`${epics} ${epics === 1 ? "epic" : "epics"}`);
  if (features > 0) parts.push(`${features} ${features === 1 ? "feature" : "features"}`);
  if (tasks > 0) parts.push(`${tasks} ${tasks === 1 ? "task" : "tasks"}`);

  return parts.join(", ");
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

export type DuplicatePromptDecision = "cancel" | "merge" | "proceed";

/**
 * Parse duplicate confirmation input from the explicit override prompt.
 * Empty/invalid input defaults to "cancel" for safety.
 */
export function parseDuplicatePromptInput(input: string): DuplicatePromptDecision {
  const trimmed = input.trim().toLowerCase();
  if (["p", "proceed", "proceed anyway", "force", "force-create", "force create"].includes(trimmed)) {
    return "proceed";
  }
  if (["m", "merge"].includes(trimmed)) return "merge";
  return "cancel";
}

function hasDuplicateMatches(matches: ProposalDuplicateMatch[]): boolean {
  return matches.some((match) => match.duplicate);
}

/**
 * Filter out duplicate matches for proposal nodes that have `existingId` set.
 * These nodes were intentionally placed by the LLM under existing items,
 * so programmatic duplicate detection is redundant and would be confusing.
 */
function filterPlacedDuplicateMatches(
  matches: ProposalDuplicateMatch[],
  proposals: Proposal[],
): ProposalDuplicateMatch[] {
  return matches.filter((match) => {
    const parsed = parseNodeKey(match.node.key);
    if (!parsed) return true;
    const proposal = proposals[parsed.proposalIndex];
    if (!proposal) return true;

    // Skip epics with existingId
    if (parsed.suffix === "epic" && proposal.epic.existingId) return false;

    // Skip features with existingId
    const featureMatch = /^feature:(\d+)$/.exec(parsed.suffix);
    if (featureMatch) {
      const fIdx = parseInt(featureMatch[1], 10);
      if (proposal.features[fIdx]?.existingId) return false;
    }

    return true;
  });
}

function parseNodeKey(key: string): { proposalIndex: number; suffix: string } | null {
  const m = /^p(\d+):(.*)$/.exec(key);
  if (!m) return null;
  const proposalIndex = Number.parseInt(m[1] ?? "", 10);
  const suffix = m[2] ?? "";
  if (!Number.isInteger(proposalIndex) || suffix.length === 0) return null;
  return { proposalIndex, suffix };
}

type MergeableProposalNode =
  | {
      key: string;
      kind: "epic" | "feature";
      title: string;
      description?: string;
    }
  | {
      key: string;
      kind: "task";
      title: string;
      description?: string;
      acceptanceCriteria?: string[];
      priority?: PRDItem["priority"];
      tags?: string[];
    };

interface MergedProposalRecord {
  proposalNodeKey: string;
  proposalTitle: string;
  proposalKind: "epic" | "feature" | "task";
  reason: string;
  score: number;
  mergedAt: string;
  source: "smart-add";
}

type ItemWithMergedProposals = PRDItem & { mergedProposals?: MergedProposalRecord[] };

function normalizeMergeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function mergeDescription(
  existingDescription: string | undefined,
  proposedDescription: string | undefined,
): string | undefined {
  if (!proposedDescription || proposedDescription.trim().length === 0) {
    return existingDescription;
  }
  if (!existingDescription || existingDescription.trim().length === 0) {
    return proposedDescription;
  }
  if (normalizeMergeText(existingDescription) === normalizeMergeText(proposedDescription)) {
    return existingDescription;
  }
  return proposedDescription.length > existingDescription.length
    ? proposedDescription
    : existingDescription;
}

function mergeStringArray(
  existingValues: string[] | undefined,
  proposedValues: string[] | undefined,
): string[] | undefined {
  if ((!existingValues || existingValues.length === 0) && (!proposedValues || proposedValues.length === 0)) {
    return existingValues;
  }
  return [...new Set([...(existingValues ?? []), ...(proposedValues ?? [])])];
}

function mergePriority(
  existingPriority: PRDItem["priority"] | undefined,
  proposedPriority: PRDItem["priority"] | undefined,
): PRDItem["priority"] | undefined {
  if (!proposedPriority) return existingPriority;
  if (!existingPriority) return proposedPriority;
  const existingRank = PRIORITY_ORDER[existingPriority];
  const proposedRank = PRIORITY_ORDER[proposedPriority];
  return proposedRank < existingRank ? proposedPriority : existingPriority;
}

function buildMergeableProposalNodeIndex(
  proposals: Proposal[],
): Record<string, MergeableProposalNode> {
  const index: Record<string, MergeableProposalNode> = {};

  for (let pIdx = 0; pIdx < proposals.length; pIdx++) {
    const proposal = proposals[pIdx];
    index[`p${pIdx}:epic`] = {
      key: `p${pIdx}:epic`,
      kind: "epic",
      title: proposal.epic.title,
      description: proposal.epic.description,
    };

    for (let fIdx = 0; fIdx < proposal.features.length; fIdx++) {
      const feature = proposal.features[fIdx];
      index[`p${pIdx}:feature:${fIdx}`] = {
        key: `p${pIdx}:feature:${fIdx}`,
        kind: "feature",
        title: feature.title,
        description: feature.description,
      };

      for (let tIdx = 0; tIdx < feature.tasks.length; tIdx++) {
        const task = feature.tasks[tIdx];
        index[`p${pIdx}:task:${fIdx}:${tIdx}`] = {
          key: `p${pIdx}:task:${fIdx}:${tIdx}`,
          kind: "task",
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          priority: task.priority as PRDItem["priority"],
          tags: task.tags,
        };
      }
    }
  }

  return index;
}

export async function applyDuplicateProposalMerges(
  dir: string,
  proposals: Proposal[],
  duplicateMatches: ProposalDuplicateMatch[],
): Promise<{
  mergedCount: number;
  mergeTargetsByNodeKey: Record<string, string>;
  reopenedItemIds: string[];
}> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const attributionOptions = { applyAttribution: true, projectDir: dir } as const;
  const proposalNodeIndex = buildMergeableProposalNodeIndex(proposals);
  const mergeTargetsByNodeKey: Record<string, string> = {};
  const reopenedItemIds: string[] = [];
  const mergedAt = new Date().toISOString();
  let mergedCount = 0;

  for (const match of duplicateMatches) {
    if (!match.duplicate || !match.matchedItem) continue;
    if (match.reason === "none") continue;

    const proposalNode = proposalNodeIndex[match.node.key];
    if (!proposalNode) continue;

    const existing = await store.getItem(match.matchedItem.id);
    if (!existing) continue;

    const updates: Partial<ItemWithMergedProposals> = {};

    // Reset completed items that receive new merged content
    if (existing.status === "completed") {
      updates.status = "pending";
      updates.completedAt = undefined;
      reopenedItemIds.push(existing.id);
    }

    const nextDescription = mergeDescription(existing.description, proposalNode.description);
    if (nextDescription !== existing.description) {
      updates.description = nextDescription;
    }

    if (proposalNode.kind === "task") {
      const nextCriteria = mergeStringArray(
        existing.acceptanceCriteria,
        proposalNode.acceptanceCriteria,
      );
      const sameCriteria =
        JSON.stringify(nextCriteria ?? []) === JSON.stringify(existing.acceptanceCriteria ?? []);
      if (!sameCriteria) {
        updates.acceptanceCriteria = nextCriteria;
      }

      const nextPriority = mergePriority(existing.priority, proposalNode.priority);
      if (nextPriority !== existing.priority) {
        updates.priority = nextPriority;
      }

      const nextTags = mergeStringArray(existing.tags, proposalNode.tags);
      const sameTags = JSON.stringify(nextTags ?? []) === JSON.stringify(existing.tags ?? []);
      if (!sameTags) {
        updates.tags = nextTags;
      }
    }

    const mergedRecord: MergedProposalRecord = {
      proposalNodeKey: match.node.key,
      proposalTitle: proposalNode.title,
      proposalKind: proposalNode.kind,
      reason: match.reason,
      score: match.score,
      mergedAt,
      source: "smart-add",
    };
    const existingRecords = ((existing as ItemWithMergedProposals).mergedProposals ?? [])
      .filter((record) => record.proposalNodeKey !== mergedRecord.proposalNodeKey);
    updates.mergedProposals = [...existingRecords, mergedRecord];

    if (Object.keys(updates).length > 0) {
      await store.updateItem(existing.id, updates as Partial<PRDItem>, attributionOptions);
      mergedCount++;
      mergeTargetsByNodeKey[match.node.key] = existing.id;
    }
  }

  return { mergedCount, mergeTargetsByNodeKey, reopenedItemIds };
}

/**
 * Keep only matches for selected proposal indices and remap node keys so the
 * selected subset can be accepted with 0-based contiguous proposal indices.
 */
export function remapDuplicateMatchesForSelectedProposals(
  matches: ProposalDuplicateMatch[],
  selectedProposalIndices: number[],
): ProposalDuplicateMatch[] {
  const remap = new Map<number, number>();
  for (let i = 0; i < selectedProposalIndices.length; i++) {
    remap.set(selectedProposalIndices[i]!, i);
  }

  const remapped: ProposalDuplicateMatch[] = [];
  for (const match of matches) {
    const parsed = parseNodeKey(match.node.key);
    if (!parsed) continue;
    const nextIndex = remap.get(parsed.proposalIndex);
    if (nextIndex === undefined) continue;

    remapped.push({
      ...match,
      node: {
        ...match.node,
        key: `p${nextIndex}:${parsed.suffix}`,
      },
    });
  }
  return remapped;
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

/**
 * Classify an LLM error and return a user-friendly message + suggestion.
 *
 * Thin wrapper around the shared {@link classifyLLMError} that translates
 * smart-add's mode parameter into a context label for the fallback message.
 */
export function classifySmartAddError(
  err: Error,
  mode: "description" | "file",
  vendor: LLMVendor = "claude",
): { message: string; suggestion: string } {
  const context = mode === "file" ? "process ideas file" : "analyze description";
  llmDebug(`classify error vendor=${vendor} mode=${mode} message="${err.message}"`);
  const { message, suggestion } = classifyLLMError(err, vendor, context);
  return { message, suggestion };
}

async function savePending(
  dir: string,
  proposals: Proposal[],
  parentId?: string,
  prdHash?: string,
): Promise<void> {
  const filePath = join(dir, REX_DIR, PENDING_FILE);
  await atomicWriteJSON(filePath, { proposals, parentId, prdHash });
}

async function loadPending(
  dir: string,
): Promise<{ proposals: Proposal[]; parentId?: string; prdHash?: string } | null> {
  const filePath = join(dir, REX_DIR, PENDING_FILE);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as { proposals: Proposal[]; parentId?: string; prdHash?: string };
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

/**
 * Validate that a merge target exists and has the expected level.
 * Returns the merge target ID if valid, or undefined to fall back to creation.
 */
async function validateMergeTarget(
  store: Awaited<ReturnType<typeof resolveStore>>,
  mergeTargetId: string | undefined,
  expectedLevel: ItemLevel,
): Promise<string | undefined> {
  if (!mergeTargetId) return undefined;
  const item = await store.getItem(mergeTargetId);
  if (!item || item.level !== expectedLevel) return undefined;
  return mergeTargetId;
}

async function acceptProposals(
  dir: string,
  proposals: Proposal[],
  options: {
    parentId?: string;
    overrideMarkersByNodeKey?: Record<string, DuplicateOverrideMarker>;
    mergeTargetsByNodeKey?: Record<string, string>;
    mergedCount?: number;
    reopenedItemIds?: string[];
  } = {},
): Promise<number> {
  const {
    parentId,
    overrideMarkersByNodeKey,
    mergeTargetsByNodeKey,
    mergedCount = 0,
    reopenedItemIds = [],
  } = options;
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  // Ensure the current branch's PRD file exists and is the write target.
  if (store instanceof FileStore) {
    const branch = resolveGitBranch(dir);
    if (branch !== "unknown") {
      const resolution = await resolvePRDFile(rexDir, dir);
      store.setCurrentBranchFile(resolution.filename);
    }
  }

  const parentLevel = await resolveParentLevel(dir, parentId);
  const attributionOptions = { applyAttribution: true, projectDir: dir } as const;

  let addedCount = 0;
  // Track newly created container IDs so we can clean up empty ones after merges
  const newContainerIds: string[] = [];
  // Track existing containers reused via existingId so we cascade-reset them
  const reusedContainerIds: string[] = [];

  for (let pIdx = 0; pIdx < proposals.length; pIdx++) {
    const p = proposals[pIdx];
    if (!parentId) {
      // No parent — create a new top-level epic (or reuse existing via existingId)
      const epicMergeTarget = await validateMergeTarget(
        store, mergeTargetsByNodeKey?.[`p${pIdx}:epic`], "epic",
      );
      let epicId = epicMergeTarget ?? randomUUID();
      const epicMarker = overrideMarkersByNodeKey?.[`p${pIdx}:epic`];

      // Check for existingId — LLM-directed placement under existing epic
      const epicExistingRef = p.epic.existingId;
      let epicReused = false;
      if (epicExistingRef && !epicMergeTarget) {
        const doc = await store.loadDocument();
        const existing = findItem(doc.items, epicExistingRef);
        if (existing) {
          epicId = epicExistingRef;
          epicReused = true;
          reusedContainerIds.push(epicExistingRef);
          // Update title if the LLM expanded the scope
          if (p.epic.title && p.epic.title !== existing.item.title) {
            await store.updateItem(epicExistingRef, { title: p.epic.title }, attributionOptions);
          }
        }
        // If not found, fall through to create a new epic (LLM hallucinated the ID)
      }

      if (!epicMergeTarget && !epicReused) {
        await store.addItem({
          id: epicId,
          title: p.epic.title,
          level: "epic",
          status: "pending",
          source: "smart-add",
          ...(epicMarker ? { overrideMarker: epicMarker } : {}),
        }, undefined, attributionOptions);
        addedCount++;
        newContainerIds.push(epicId);
      }

      for (let fIdx = 0; fIdx < p.features.length; fIdx++) {
        const f = p.features[fIdx];
        const featureKey = `p${pIdx}:feature:${fIdx}`;
        const featureMergeTarget = await validateMergeTarget(
          store, mergeTargetsByNodeKey?.[featureKey], "feature",
        );
        let featureId = featureMergeTarget ?? randomUUID();
        const featureMarker = overrideMarkersByNodeKey?.[`p${pIdx}:feature:${fIdx}`];

        // Check for existingId — LLM-directed placement under existing feature
        const featureExistingRef = f.existingId;
        let featureReused = false;
        if (featureExistingRef && !featureMergeTarget) {
          const doc = await store.loadDocument();
          const existing = findItem(doc.items, featureExistingRef);
          if (existing) {
            featureId = featureExistingRef;
            featureReused = true;
            reusedContainerIds.push(featureExistingRef);
            if (f.title && f.title !== existing.item.title) {
              await store.updateItem(featureExistingRef, { title: f.title }, attributionOptions);
            }
          }
        }

        if (!featureMergeTarget && !featureReused) {
          await store.addItem(
            {
              id: featureId,
              title: f.title,
              level: "feature",
              status: "pending",
              source: "smart-add",
              description: f.description,
              ...(featureMarker ? { overrideMarker: featureMarker } : {}),
            },
            epicId,
            attributionOptions,
          );
          addedCount++;
          newContainerIds.push(featureId);
        }

        for (let tIdx = 0; tIdx < f.tasks.length; tIdx++) {
          const t = f.tasks[tIdx];
          const taskKey = `p${pIdx}:task:${fIdx}:${tIdx}`;
          const taskMergeTarget = await validateMergeTarget(
            store, mergeTargetsByNodeKey?.[taskKey], "task",
          );
          if (taskMergeTarget) continue;
          const taskMarker = overrideMarkersByNodeKey?.[`p${pIdx}:task:${fIdx}:${tIdx}`];
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
              ...(taskMarker ? { overrideMarker: taskMarker } : {}),
            },
            featureId,
            attributionOptions,
          );
          addedCount++;
        }
      }
    } else if (parentLevel === "epic") {
      // Parent is an epic — attach features (and their tasks) directly
      for (let fIdx = 0; fIdx < p.features.length; fIdx++) {
        const f = p.features[fIdx];
        const featureKey = `p${pIdx}:feature:${fIdx}`;
        const featureMergeTarget = await validateMergeTarget(
          store, mergeTargetsByNodeKey?.[featureKey], "feature",
        );
        const featureId = featureMergeTarget ?? randomUUID();
        const featureMarker = overrideMarkersByNodeKey?.[`p${pIdx}:feature:${fIdx}`];
        if (!featureMergeTarget) {
          await store.addItem(
            {
              id: featureId,
              title: f.title,
              level: "feature",
              status: "pending",
              source: "smart-add",
              description: f.description,
              ...(featureMarker ? { overrideMarker: featureMarker } : {}),
            },
            parentId,
            attributionOptions,
          );
          addedCount++;
          newContainerIds.push(featureId);
        }

        for (let tIdx = 0; tIdx < f.tasks.length; tIdx++) {
          const t = f.tasks[tIdx];
          const taskKey = `p${pIdx}:task:${fIdx}:${tIdx}`;
          const taskMergeTarget = await validateMergeTarget(
            store, mergeTargetsByNodeKey?.[taskKey], "task",
          );
          if (taskMergeTarget) continue;
          const taskMarker = overrideMarkersByNodeKey?.[`p${pIdx}:task:${fIdx}:${tIdx}`];
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
              ...(taskMarker ? { overrideMarker: taskMarker } : {}),
            },
            featureId,
            attributionOptions,
          );
          addedCount++;
        }
      }
    } else if (parentLevel === "feature") {
      // Parent is a feature — flatten proposal features' tasks as direct
      // children of the feature (level: task)
      for (let fIdx = 0; fIdx < p.features.length; fIdx++) {
        const f = p.features[fIdx];
        for (let tIdx = 0; tIdx < f.tasks.length; tIdx++) {
          const t = f.tasks[tIdx];
          const taskKey = `p${pIdx}:task:${fIdx}:${tIdx}`;
          const taskMergeTarget = await validateMergeTarget(
            store, mergeTargetsByNodeKey?.[taskKey], "task",
          );
          if (taskMergeTarget) continue;
          const taskMarker = overrideMarkersByNodeKey?.[`p${pIdx}:task:${fIdx}:${tIdx}`];
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
              ...(taskMarker ? { overrideMarker: taskMarker } : {}),
            },
            parentId,
            attributionOptions,
          );
          addedCount++;
        }
      }
    } else if (parentLevel === "task") {
      // Parent is a task — flatten everything as subtasks
      for (let fIdx = 0; fIdx < p.features.length; fIdx++) {
        const f = p.features[fIdx];
        for (let tIdx = 0; tIdx < f.tasks.length; tIdx++) {
          const t = f.tasks[tIdx];
          const taskKey = `p${pIdx}:task:${fIdx}:${tIdx}`;
          const taskMergeTarget = await validateMergeTarget(
            store, mergeTargetsByNodeKey?.[taskKey], "subtask",
          );
          if (taskMergeTarget) continue;
          const taskMarker = overrideMarkersByNodeKey?.[`p${pIdx}:task:${fIdx}:${tIdx}`];
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
              ...(taskMarker ? { overrideMarker: taskMarker } : {}),
            },
            parentId,
            attributionOptions,
          );
          addedCount++;
        }
      }
    }
  }

  // Clean up empty containers created during this operation.
  // When all children of a proposed epic/feature were merged with existing items,
  // the parent container was still created but has no children — remove it.
  // Process bottom-up (features before epics) so epic cleanup sees the final state.
  if (newContainerIds.length > 0) {
    // Partition into features (remove first) and epics (remove second)
    const featureIds: string[] = [];
    const epicIds: string[] = [];
    {
      const doc = await store.loadDocument();
      for (const id of newContainerIds) {
        const entry = findItem(doc.items, id);
        if (!entry) continue;
        if (entry.item.level === "feature") featureIds.push(id);
        else epicIds.push(id);
      }
    }
    // Remove childless features first, then childless epics
    for (const containerId of [...featureIds, ...epicIds]) {
      const doc = await store.loadDocument();
      const entry = findItem(doc.items, containerId);
      if (!entry) continue;
      if ((entry.item.children ?? []).length === 0) {
        await store.removeItem(containerId);
        addedCount--;
      }
    }
  }

  // Reset completed ancestors when adding under a completed parent
  await cascadeParentReset(store, parentId, attributionOptions);

  // Reset completed reused containers (existingId) and their ancestors
  for (const id of reusedContainerIds) {
    await cascadeParentReset(store, id, attributionOptions);
  }

  // Cascade-reset reopened merge targets and their ancestors
  for (const id of reopenedItemIds) {
    await cascadeParentReset(store, id, attributionOptions);
  }

  const overrideCount = overrideMarkersByNodeKey
    ? Object.keys(overrideMarkersByNodeKey).length
    : 0;
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "smart_add_accept",
    detail: `Added ${addedCount} items from smart add${parentId ? ` under parent ${parentId}` : ""}${mergedCount > 0 ? ` (${mergedCount} duplicate merge(s))` : ""}${overrideCount > 0 ? ` (${overrideCount} duplicate override marker(s))` : ""}`,
  });

  await clearPending(dir);

  return addedCount;
}

type SmartAddInput = {
  descList: string[];
  accept: boolean;
  parentId?: string;
  filePaths: string[];
  isJson: boolean;
};

type SmartAddContext = {
  existing: PRDItem[];
  parentLevel?: ItemLevel;
  /** Item-to-file ownership map for cross-PRD duplicate detection. */
  itemFileMap?: ItemFileMap;
};

function parseSmartAddInput(
  descriptions: string | string[],
  flags: Record<string, string>,
  multiFlags: Record<string, string[]>,
): SmartAddInput {
  const descList: string[] = Array.isArray(descriptions)
    ? descriptions
    : descriptions ? [descriptions] : [];
  const accept = flags.accept === "true";
  const parentId = flags.parent;
  const filePaths: string[] = multiFlags.file ?? (flags.file ? [flags.file] : []);
  const isJson = flags.format === "json";
  return { descList, accept, parentId, filePaths, isJson };
}

/**
 * Determine whether smart-add is using an explicit vendor model override.
 */
function determineSmartAddModelSource(vendor: LLMVendor, llmConfig: LLMConfig): "configured" | "default" {
  if (vendor === "claude" && llmConfig.claude?.model) {
    return "configured";
  }
  if (vendor === "codex" && llmConfig.codex?.model) {
    return "configured";
  }
  return "default";
}

async function initializeSmartAddLLM(dir: string, format?: string): Promise<void> {
  const rexConfigDir = join(dir, REX_DIR);
  const llmConfig = await loadLLMConfig(rexConfigDir);
  setLLMConfig(llmConfig);
  const claudeConfig = await loadClaudeConfig(rexConfigDir);
  setClaudeConfig(claudeConfig);

  const vendor = getLLMVendor();
  llmDebug(`resolved vendor=${vendor ?? "unknown"} configDir=${rexConfigDir}`);
  if (vendor) {
    const resolvedModel = await resolveSmartAddModel(dir);
    const defaultModel = resolveVendorModel(vendor, llmConfig);
    const modelSource = resolvedModel && resolvedModel !== defaultModel
      ? "configured"
      : determineSmartAddModelSource(vendor, llmConfig);
    printVendorModelHeader(vendor, llmConfig, {
      format,
      resolvedModel,
      modelSource,
    });
  }
  if (format !== "json") {
    const authMode = getAuthMode();
    llmDebug(`resolved authMode=${authMode ?? "unknown"}`);
    if (authMode === "api") {
      info("Using direct API authentication.");
    }
  }
}

async function replayCachedIfRequested(
  dir: string,
  input: SmartAddInput,
  format?: string,
): Promise<boolean> {
  if (!(input.accept && input.descList.length === 0 && input.filePaths.length === 0 && !format)) {
    return false;
  }
  const cached = await loadPending(dir);
  if (!cached || cached.proposals.length === 0) return false;

  // Staleness detection: compare current PRD hash with cached hash
  if (cached.prdHash) {
    const rexDir = join(dir, REX_DIR);
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    const currentHash = hashPRD(doc.items);
    if (currentHash !== cached.prdHash) {
      warn("PRD has changed since proposals were generated");
      await clearPending(dir);
      return false;
    }
  }

  info(`Accepting ${cached.proposals.length} cached proposal(s)...`);
  const added = await acceptProposals(dir, cached.proposals, { parentId: cached.parentId });
  result(`Added ${added} items to PRD.`);
  return true;
}

async function resolveSmartAddModel(
  dir: string,
  requestedModel?: string,
): Promise<string | undefined> {
  if (requestedModel) {
    llmDebug(`effective model=${requestedModel}`);
    return requestedModel;
  }

  try {
    const rexDir = join(dir, REX_DIR);
    const llmConfig = await loadLLMConfig(rexDir);
    const vendor = llmConfig.vendor ?? getLLMVendor() ?? "claude";
    const configuredModel = resolveVendorModel(vendor, llmConfig);
    const hasVendorModelOverride =
      (vendor === "claude" && typeof llmConfig.claude?.model === "string" && llmConfig.claude.model.trim().length > 0) ||
      (vendor === "codex" && typeof llmConfig.codex?.model === "string" && llmConfig.codex.model.trim().length > 0);

    if (hasVendorModelOverride) {
      llmDebug(`effective model=${configuredModel}`);
      return configuredModel;
    }

    const store = await resolveStore(rexDir);
    const config = await store.loadConfig();
    const model = resolveVendorCompatibleRexModel(vendor, config.model);
    const effectiveModel = model ?? configuredModel;
    llmDebug(`effective model=${effectiveModel}`);
    return effectiveModel;
  } catch {
    const resolvedModel = resolveConfiguredModel();
    llmDebug(`effective model=${resolvedModel}`);
    return resolvedModel;
  }
}

async function loadSmartAddContext(
  dir: string,
  parentId?: string,
): Promise<SmartAddContext> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();
  const existing = doc.items;

  // Extract item-to-file map for cross-PRD duplicate detection.
  // FileStore populates this map as a side effect of loadDocument().
  const itemFileMap: ItemFileMap | undefined =
    store instanceof FileStore ? store.getItemFileMap() : undefined;

  if (!parentId) return { existing, itemFileMap };

  const parentEntry = findItem(existing, parentId);
  if (!parentEntry) {
    throw new CLIError(
      `Parent "${parentId}" not found.`,
      "Check the ID with 'rex status' and try again.",
    );
  }

  const parentLevel = parentEntry.item.level;
  if (parentLevel === "subtask") {
    throw new CLIError(
      "Cannot add children under a subtask.",
      "Subtasks are leaf nodes. Specify a task, feature, or epic as the parent.",
    );
  }

  return { existing, parentLevel, itemFileMap };
}

async function generateSmartAddProposals(params: {
  dir: string;
  existing: PRDItem[];
  parentId?: string;
  model?: string;
  descList: string[];
  filePaths: string[];
  isJson: boolean;
}): Promise<Proposal[]> {
  const { dir, existing, parentId, model, descList, filePaths, isJson } = params;
  const effectiveModel = resolveConfiguredModel(model);

  if (filePaths.length > 0) {
    const resolved = filePaths.map((fp) => resolve(dir, fp));
    const label = resolved.length === 1
      ? `Reading ideas file: ${resolved[0]}`
      : `Reading ${resolved.length} ideas files`;
    const spinner = !isJson ? startSpinner(`${label}...`) : null;

    try {
      spinner?.update(`Processing ideas files...`);
      const reasonResult = await reasonFromIdeasFile(resolved, existing, {
        model: effectiveModel,
        dir,
        parentId,
      });
      const proposals = reasonResult.proposals;
      const method = reasonResult.tokenUsage.calls > 0
        ? `via LLM (${effectiveModel})`
        : "from file structure";
      spinner?.stop(proposals.length > 0 ? `Generated ${proposals.length} proposal(s) ${method}.` : undefined);
      return proposals;
    } catch (err) {
      spinner?.stop();
      const classified = classifySmartAddError(err as Error, "file", getLLMVendor() ?? "claude");
      throw new CLIError(classified.message, classified.suggestion);
    }
  }

  const descLabel = descList.length > 1
    ? `Analyzing ${descList.length} descriptions`
    : "Analyzing description";
  const stdinLabel = !process.stdin.isTTY ? " (from piped input)" : "";
  const spinner = !isJson
    ? startSpinner(`${descLabel} with LLM (${effectiveModel})${stdinLabel}...`)
    : null;

  try {
    const reasonResult = await reasonFromDescriptions(descList, existing, {
      model: effectiveModel,
      dir,
      parentId,
    });
    const proposals = reasonResult.proposals;
    spinner?.stop(proposals.length > 0 ? `Generated ${proposals.length} proposal(s).` : undefined);
    return proposals;
  } catch (err) {
    spinner?.stop();
    const classified = classifySmartAddError(err as Error, "description", getLLMVendor() ?? "claude");
    throw new CLIError(classified.message, classified.suggestion);
  }
}

function emitNoSmartAddProposals(isJson: boolean): void {
  if (isJson) {
    result(JSON.stringify({ proposals: [], added: 0 }, null, 2));
  } else {
    result("No proposals could be generated from the given input.");
  }
}

function renderSmartAddProposals(params: {
  proposals: Proposal[];
  parentId?: string;
  parentLevel?: ItemLevel;
  qualityIssues: QualityIssue[];
  isJson: boolean;
  thresholdWeeks?: number;
  targetFile?: string;
}): void {
  const { proposals, parentId, parentLevel, qualityIssues, isJson, thresholdWeeks, targetFile } = params;
  if (isJson) return;

  const summary = formatProposalSummary(proposals, parentLevel);
  if (parentId && parentLevel) {
    info(`\nProposed additions under parent ${parentId} (${summary}):`);
  } else {
    info(`\nProposed structure (${summary}):`);
  }
  info(formatProposalTree(proposals, parentLevel, thresholdWeeks));
  if (targetFile && targetFile !== "prd.json") {
    info(`  Target file: ${targetFile}`);
  }

  if (qualityIssues.length > 0) {
    warn("");
    warn(formatQualityWarnings(qualityIssues));
  }

  info("");
}

async function maybeCacheSmartAddProposals(
  dir: string,
  proposals: Proposal[],
  parentId?: string,
  prdHash?: string,
): Promise<void> {
  if (await hasRexDir(dir)) {
    await savePending(dir, proposals, parentId, prdHash);
  }
}

async function runInteractiveSmartAddApproval(params: {
  dir: string;
  existing: PRDItem[];
  proposals: Proposal[];
  duplicateMatches: ProposalDuplicateMatch[];
  parentId?: string;
  parentLevel?: ItemLevel;
  model?: string;
  thresholdWeeks?: number;
  itemFileMap?: ItemFileMap;
}): Promise<void> {
  const { dir, existing, parentId, parentLevel, model, thresholdWeeks, itemFileMap } = params;
  const { adjustGranularity } = await import("../../analyze/index.js");
  const resolvedModel = model;
  let currentProposals = params.proposals;
  let currentDuplicateMatches = params.duplicateMatches;
  let done = false;

  while (!done) {
    const prompt = currentProposals.length > 1
      ? "Accept proposals? (y=all / n=none / b#=break down / c#=consolidate / 1,2,...=select) "
      : "Accept this proposal? (y/n / b1=break down / c1=consolidate) ";

    const answer = await promptUser(prompt);
    const granularityResult = parseGranularityInput(answer, currentProposals.length);

    if (granularityResult) {
      const targetProposals = granularityResult.indices.map((i) => currentProposals[i]);
      const label = granularityResult.direction === "break_down"
        ? "Breaking down"
        : "Consolidating";
      const adjSpinner = startSpinner(
        `${label} proposal(s) ${granularityResult.indices.map((i) => i + 1).join(", ")}...`,
      );

      try {
        const adjusted = await adjustGranularity(
          targetProposals,
          granularityResult.direction,
          resolvedModel,
        );
        if (adjusted.proposals.length > 0) {
          const newProposals = [...currentProposals];
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
          adjSpinner.stop(
            `Replaced ${targetProposals.length} proposal(s) with ${adjusted.proposals.length} ${actionLabel} proposal(s).`,
          );

          const updatedSummary = formatProposalSummary(currentProposals, parentLevel);
          info(`\nUpdated structure (${updatedSummary}):`);
          info(formatProposalTree(currentProposals, parentLevel, thresholdWeeks));
          info("");

          currentDuplicateMatches = filterPlacedDuplicateMatches(
            matchProposalNodesToPRD(currentProposals, existing, itemFileMap),
            currentProposals,
          );
          await maybeCacheSmartAddProposals(dir, currentProposals, parentId, hashPRD(existing));
        } else {
          adjSpinner.stop("LLM returned no proposals. Original proposals unchanged.");
        }
      } catch (err) {
        adjSpinner.stop();
        const classified = classifySmartAddError(err as Error, "description");
        info(`Granularity adjustment failed: ${classified.message}`);
        info("Original proposals unchanged.");
      }
      continue;
    }

    const decision = parseApprovalInput(answer, currentProposals.length);
    if (decision === "all") {
      let overrideMarkersByNodeKey: Record<string, DuplicateOverrideMarker> | undefined;
      let mergeTargetsByNodeKey: Record<string, string> | undefined;
      let mergedCount = 0;
      let reopenedItemIds: string[] = [];
      if (hasDuplicateMatches(currentDuplicateMatches)) {
        info("Duplicate matches were detected in the selected proposals.");
        info("Choose action: c=cancel / m=merge with existing / p=proceed anyway");
        const duplicateAnswer = await promptUser("Duplicate action (c/m/p): ");
        const duplicateDecision = parseDuplicatePromptInput(duplicateAnswer);
        if (duplicateDecision === "merge") {
          const mergeResult = await applyDuplicateProposalMerges(
            dir,
            currentProposals,
            currentDuplicateMatches,
          );
          mergeTargetsByNodeKey = mergeResult.mergeTargetsByNodeKey;
          mergedCount = mergeResult.mergedCount;
          reopenedItemIds = mergeResult.reopenedItemIds;
        }
        if (duplicateDecision === "cancel") {
          info("Cancelled. No items were created.");
          done = true;
          continue;
        }
        if (duplicateDecision === "proceed") {
          overrideMarkersByNodeKey = buildDuplicateOverrideMarkerIndex(
            currentDuplicateMatches,
            new Date().toISOString(),
          );
        }
      }

      const added = await acceptProposals(dir, currentProposals, {
        parentId,
        overrideMarkersByNodeKey,
        mergeTargetsByNodeKey,
        mergedCount,
        reopenedItemIds,
      });
      if (mergedCount > 0) {
        result(`Merged ${mergedCount} duplicate node(s) and added ${added} new item(s) to PRD.`);
      } else {
        result(`Added ${added} items to PRD.`);
      }
      done = true;
      continue;
    }

    if (decision === "none") {
      info("Proposals saved. Run `rex add --accept` to accept later.");
      done = true;
      continue;
    }

    const selected = filterProposalsByIndex(currentProposals, decision.approved);
    const names = selected.map((p) => p.epic.title).join(", ");
    info(`Accepting: ${names}`);
    const selectedMatches = remapDuplicateMatchesForSelectedProposals(
      currentDuplicateMatches,
      decision.approved,
    );

    let overrideMarkersByNodeKey: Record<string, DuplicateOverrideMarker> | undefined;
    let mergeTargetsByNodeKey: Record<string, string> | undefined;
    let mergedCount = 0;
    let reopenedItemIds: string[] = [];
    let usedMergeDecision = false;
    if (hasDuplicateMatches(selectedMatches)) {
      info("Duplicate matches were detected in the selected proposals.");
      info("Choose action: c=cancel / m=merge with existing / p=proceed anyway");
      const duplicateAnswer = await promptUser("Duplicate action (c/m/p): ");
      const duplicateDecision = parseDuplicatePromptInput(duplicateAnswer);
      if (duplicateDecision === "merge") {
        const mergeResult = await applyDuplicateProposalMerges(
          dir,
          selected,
          selectedMatches,
        );
        mergeTargetsByNodeKey = mergeResult.mergeTargetsByNodeKey;
        mergedCount = mergeResult.mergedCount;
        reopenedItemIds = mergeResult.reopenedItemIds;
        usedMergeDecision = true;
      }
      if (duplicateDecision === "cancel") {
        info("Cancelled. No items were created.");
        done = true;
        continue;
      }
      if (duplicateDecision === "proceed") {
        overrideMarkersByNodeKey = buildDuplicateOverrideMarkerIndex(
          selectedMatches,
          new Date().toISOString(),
        );
      }
    }

    const added = await acceptProposals(dir, selected, {
      parentId,
      overrideMarkersByNodeKey,
      mergeTargetsByNodeKey,
      mergedCount,
      reopenedItemIds,
    });
    if (mergedCount > 0) {
      result(`Merged ${mergedCount} duplicate node(s) and added ${added} new item(s) to PRD.`);
    } else {
      result(`Added ${added} items to PRD.`);
    }

    const rejected = currentProposals.filter((_, i) => !decision.approved.includes(i));
    if (rejected.length > 0 && !usedMergeDecision) {
      await savePending(dir, rejected, parentId, hashPRD(existing));
      info(`${rejected.length} proposal(s) saved. Run \`rex add --accept\` to accept later.`);
    } else if (rejected.length > 0 && usedMergeDecision) {
      info(`${rejected.length} unselected proposal(s) were cancelled and not written.`);
    }
    done = true;
  }
}

async function finalizeSmartAdd(params: {
  dir: string;
  existing: PRDItem[];
  proposals: Proposal[];
  duplicateMatches: ProposalDuplicateMatch[];
  qualityIssues: QualityIssue[];
  accept: boolean;
  parentId?: string;
  isJson: boolean;
  parentLevel?: ItemLevel;
  model?: string;
  thresholdWeeks?: number;
  itemFileMap?: ItemFileMap;
}): Promise<void> {
  const {
    dir,
    existing,
    proposals,
    duplicateMatches,
    qualityIssues,
    accept,
    parentId,
    isJson,
    parentLevel,
    model,
    thresholdWeeks,
    itemFileMap,
  } = params;

  await maybeCacheSmartAddProposals(dir, proposals, parentId, hashPRD(existing));

  if (accept) {
    if (hasDuplicateMatches(duplicateMatches)) {
      if (isJson) {
        result(JSON.stringify({
          proposals,
          added: 0,
          qualityIssues,
          duplicateGuard: "blocked_requires_interactive_confirmation",
        }, null, 2));
        return;
      }
      warn("Duplicate matches detected. Explicit confirmation is required.");
      info("No items were created. Re-run without --accept to choose Cancel, Merge, or Proceed anyway.");
      return;
    }

    const added = await acceptProposals(dir, proposals, { parentId });
    if (isJson) {
      result(JSON.stringify({ proposals, added, qualityIssues }, null, 2));
      return;
    }

    if (qualityIssues.length > 0) {
      warn(`Accepted with ${qualityIssues.length} quality warning(s).`);
    }
    result(`Added ${added} items to PRD.`);
    return;
  }

  if (process.stdin.isTTY) {
    await runInteractiveSmartAddApproval({
      dir,
      existing,
      proposals,
      duplicateMatches,
      parentId,
      parentLevel,
      model,
      thresholdWeeks,
      itemFileMap,
    });
    return;
  }

  info("Proposals saved. Run `rex add --accept` to accept later.");
}

export async function cmdSmartAdd(
  dir: string,
  descriptions: string | string[],
  flags: Record<string, string>,
  multiFlags: Record<string, string[]> = {},
): Promise<void> {
  const input = parseSmartAddInput(descriptions, flags, multiFlags);

  if (!(await hasRexDir(dir))) {
    throw new CLIError(
      `Rex directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'rex init' if using rex standalone.",
    );
  }

  await initializeSmartAddLLM(dir, flags.format);
  if (await replayCachedIfRequested(dir, input, flags.format)) {
    return;
  }

  const model = await resolveSmartAddModel(dir, flags.model);
  const { existing, parentLevel, itemFileMap } = await loadSmartAddContext(dir, input.parentId);
  const proposals = await generateSmartAddProposals({
    dir,
    existing,
    parentId: input.parentId,
    model,
    descList: input.descList,
    filePaths: input.filePaths,
    isJson: input.isJson,
  });

  if (proposals.length === 0) {
    emitNoSmartAddProposals(input.isJson);
    return;
  }

  // Load LoE config for consolidation guard and LoE display
  let loeConfig: LoEConfig | undefined;
  try {
    const rexDir = join(dir, REX_DIR);
    const store = await resolveStore(rexDir);
    const config = await store.loadConfig();
    loeConfig = config.loe;
  } catch {
    // Config unreadable — use defaults
  }
  const thresholdWeeks = loeConfig?.taskThresholdWeeks ?? LOE_DEFAULTS.taskThresholdWeeks;

  // Post-processing consolidation guard: reduce over-granular LLM output
  let consolidatedProposals = proposals;
  {
    const guardResult = await applyConsolidationGuard(
      consolidatedProposals,
      loeConfig,
      model,
    );

    if (guardResult.triggered) {
      consolidatedProposals = guardResult.proposals;
      if (!input.isJson) {
        if (guardResult.reduced) {
          info(
            `Consolidation guard: reduced from ${guardResult.originalTaskCount} to ${guardResult.finalTaskCount} tasks (ceiling: ${guardResult.ceiling}).`,
          );
        } else if (guardResult.warning) {
          warn(guardResult.warning);
        }
      }
    }
  }

  const duplicateMatches = filterPlacedDuplicateMatches(
    matchProposalNodesToPRD(consolidatedProposals, existing, itemFileMap),
    consolidatedProposals,
  );
  const proposalsWithReasons = attachDuplicateReasonsToProposals(consolidatedProposals, duplicateMatches);
  const qualityIssues = validateProposalQuality(proposalsWithReasons);
  if (input.isJson && !input.accept) {
    result(JSON.stringify({ proposals: proposalsWithReasons, qualityIssues }, null, 2));
    return;
  }

  // Resolve target filename for approval display (read-only, no file creation)
  let targetFile: string | undefined;
  {
    const rexDir = join(dir, REX_DIR);
    const branch = resolveGitBranch(dir);
    if (branch !== "unknown") {
      const existingBranchFile = await findPRDFileForBranch(rexDir, branch);
      targetFile = existingBranchFile ?? resolvePRDFilename(dir) ?? undefined;
    }
  }

  renderSmartAddProposals({
    proposals: proposalsWithReasons,
    parentId: input.parentId,
    parentLevel,
    qualityIssues,
    isJson: input.isJson,
    thresholdWeeks,
    targetFile,
  });

  await finalizeSmartAdd({
    dir,
    existing,
    proposals: proposalsWithReasons,
    duplicateMatches,
    qualityIssues,
    accept: input.accept,
    parentId: input.parentId,
    isJson: input.isJson,
    parentLevel,
    model,
    thresholdWeeks,
    itemFileMap,
  });
}
