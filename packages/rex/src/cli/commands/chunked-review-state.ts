import type { Proposal } from "../../analyze/index.js";
import { classifyModificationRequest } from "../../analyze/validate-modification.js";
import { formatTaskLoE, formatTaskLoERationale } from "./format-loe.js";
import type { GranularityAdjustmentRecord, BatchAcceptanceRecord } from "../../analyze/batch-types.js";

// Re-export so existing consumers of chunked-review-state keep working.
export type { GranularityAdjustmentRecord, BatchAcceptanceRecord };

const DEFAULT_CHUNK_SIZE = 5;

/** Assessment of a single proposal's task granularity. */
export interface ProposalAssessment {
  proposalIndex: number;
  epicTitle: string;
  recommendation: "break_down" | "consolidate" | "keep";
  reasoning: string;
  issues: string[];
}

/**
 * State maintained across chunk navigation.
 * Tracks which proposals have been accepted, which rejected,
 * and the current page position.
 */
export interface ChunkReviewState {
  /** All proposals under review. */
  proposals: Proposal[];
  /** Current chunk offset (0-based index into proposals). */
  offset: number;
  /** Number of proposals to show per chunk. */
  chunkSize: number;
  /** Indices of accepted proposals. */
  accepted: Set<number>;
  /** Indices of explicitly rejected proposals. */
  rejected: Set<number>;
  /** History of granularity adjustments made during this session. */
  granularityHistory: GranularityAdjustmentRecord[];
  /** Cached assessment from most recent `g` command, for use by `apply` action. */
  lastAssessment?: ProposalAssessment[];
  /** LoE decomposition threshold for flagging oversized tasks in display. */
  thresholdWeeks?: number;
}

/** User's choice from the chunk review menu. */
export type ChunkAction =
  | { kind: "accept" }       // accept current chunk
  | { kind: "accept_all" }   // accept everything
  | { kind: "reject_all" }   // reject everything
  | { kind: "next" }         // show next chunk
  | { kind: "prev" }         // show previous chunk
  | { kind: "more" }         // increase chunk size
  | { kind: "fewer" }        // decrease chunk size
  | { kind: "done" }         // finish review with current selections
  | { kind: "select"; indices: number[] }  // accept specific proposals by number
  | { kind: "break_down"; indices: number[] }  // break down specific proposals into finer granularity
  | { kind: "consolidate"; indices: number[] }  // consolidate specific proposals into coarser granularity
  | { kind: "assess" }       // run LLM-powered granularity assessment
  | { kind: "apply" }        // apply cached assessment recommendations
  | { kind: "break_down_chunk" }   // break down all proposals in current chunk
  | { kind: "consolidate_chunk" }  // consolidate all proposals in current chunk
  | { kind: "modify"; request: string }  // natural language modification request
  | { kind: "unknown" };

/**
 * A granularity adjustment request produced by a break_down or consolidate action.
 * The caller is responsible for invoking the LLM and replacing proposals.
 */
export interface GranularityRequest {
  kind: "break_down" | "consolidate";
  /** 0-based indices of proposals to adjust. */
  indices: number[];
}

/**
 * Handler for granularity adjustment requests.
 * Receives the proposals to adjust and the direction, returns the adjusted proposals.
 * The interactive loop calls this when the user requests break_down or consolidate.
 */
export type GranularityHandler = (
  proposals: Proposal[],
  direction: "break_down" | "consolidate",
) => Promise<Proposal[]>;

/**
 * Handler for LLM-powered granularity assessment.
 * Receives all proposals and returns assessments for each.
 */
export type AssessmentHandler = (
  proposals: Proposal[],
) => Promise<{ assessments: ProposalAssessment[]; formatted: string }>;

/**
 * Handler for natural language proposal modification.
 * Receives the current proposals and the user's modification request,
 * returns revised proposals incorporating the requested changes.
 */
export type ModificationHandler = (
  proposals: Proposal[],
  request: string,
) => Promise<Proposal[]>;

// ─── Pure logic (no I/O, fully testable) ─────────────────────────────

/**
 * Create initial state for a chunked review session.
 */
export function createReviewState(
  proposals: Proposal[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  thresholdWeeks?: number,
): ChunkReviewState {
  return {
    proposals,
    offset: 0,
    chunkSize: Math.max(1, Math.min(chunkSize, proposals.length)),
    accepted: new Set(),
    rejected: new Set(),
    granularityHistory: [],
    thresholdWeeks,
  };
}

/**
 * Get the current chunk of proposals to display.
 * Returns the slice of proposals and their original indices.
 */
export function getCurrentChunk(
  state: ChunkReviewState,
): { proposals: Proposal[]; indices: number[] } {
  const end = Math.min(state.offset + state.chunkSize, state.proposals.length);
  const indices: number[] = [];
  const proposals: Proposal[] = [];
  for (let i = state.offset; i < end; i++) {
    indices.push(i);
    proposals.push(state.proposals[i]);
  }
  return { proposals, indices };
}

/**
 * Format the pagination header: "Proposals 1-5 of 23"
 */
export function formatPaginationHeader(state: ChunkReviewState): string {
  const start = state.offset + 1;
  const end = Math.min(state.offset + state.chunkSize, state.proposals.length);
  const total = state.proposals.length;

  if (total <= state.chunkSize) {
    return `Proposals 1-${total} of ${total}`;
  }
  return `Proposals ${start}-${end} of ${total}`;
}

/**
 * Format a chunk of proposals for display.
 * Uses 1-based numbering relative to the full list.
 */
export function formatChunk(
  state: ChunkReviewState,
  existingItems?: import("../../schema/index.js").PRDItem[],
  formatDiff?: (proposals: Proposal[], existing: import("../../schema/index.js").PRDItem[]) => string,
): string {
  const { proposals, indices } = getCurrentChunk(state);
  const lines: string[] = [];

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    const globalIdx = indices[i] + 1; // 1-based display number
    const status = state.accepted.has(indices[i])
      ? " ✓"
      : state.rejected.has(indices[i])
        ? " ✗"
        : "";

    lines.push(`${globalIdx}. [epic] ${p.epic.title}${status}`);
    if (p.epic.description) {
      lines.push(`   ${p.epic.description}`);
    }
    for (const f of p.features) {
      lines.push(`     [feature] ${f.title}`);
      for (const t of f.tasks) {
        const pri = t.priority ? ` [${t.priority}]` : "";
        if (t.decomposition) {
          const loeLabel = t.loe !== undefined ? `${t.loe}w` : "?";
          const thresholdLabel = `${t.decomposition.thresholdWeeks}w`;
          lines.push(`       [task] ${t.title}${pri} ⚡ decomposed (LoE: ${loeLabel} > ${thresholdLabel} threshold)`);
          for (const child of t.decomposition.children) {
            const childPri = child.priority ? ` [${child.priority}]` : "";
            const childLoe = formatTaskLoE(child, state.thresholdWeeks);
            lines.push(`         ↳ ${child.title}${childPri}${childLoe}`);
            const childRationale = formatTaskLoERationale(child, "            ");
            if (childRationale) lines.push(childRationale);
          }
        } else {
          const loe = formatTaskLoE(t, state.thresholdWeeks);
          lines.push(`       [task] ${t.title}${pri}${loe}`);
          const rationale = formatTaskLoERationale(t, "         ");
          if (rationale) lines.push(rationale);
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * Format the action menu shown below each chunk.
 */
export function formatActionMenu(state: ChunkReviewState): string {
  const total = state.proposals.length;
  const hasNext = state.offset + state.chunkSize < total;
  const hasPrev = state.offset > 0;

  const options: string[] = [];

  options.push("a=accept these");
  if (hasNext) options.push("n=next");
  if (hasPrev) options.push("p=prev");
  options.push("+more");
  options.push("-fewer");
  options.push("A=accept all");
  options.push("R=reject all");
  options.push("b#=break down");
  options.push("c#=consolidate");
  options.push("ba=break chunk");
  options.push("ca=consolidate chunk");
  options.push("g=assess");
  if (state.lastAssessment && state.lastAssessment.length > 0) {
    options.push("apply=apply assessment");
  }
  options.push("d=done");
  options.push("#,#=select");
  options.push("or type a change");

  return `[${options.join(" | ")}]`;
}

/**
 * Build the prompt string shown to the user.
 */
export function buildPrompt(state: ChunkReviewState): string {
  const accepted = state.accepted.size;
  const total = state.proposals.length;

  if (accepted > 0) {
    return `(${accepted}/${total} accepted) > `;
  }
  return "> ";
}

/**
 * Parse a string of comma/space-separated 1-based numbers into
 * deduplicated, sorted 0-based indices within the valid range.
 */
function parseNumericIndices(input: string, total: number): number[] {
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
 * Parse user input into a ChunkAction.
 */
export function parseChunkInput(
  input: string,
  state: ChunkReviewState,
): ChunkAction {
  const raw = input.trim();
  const trimmed = raw.toLowerCase();

  // Case-sensitive: capital A = accept all, capital R = reject all
  if (raw === "A") return { kind: "accept_all" };
  if (raw === "R") return { kind: "reject_all" };

  // Accept current chunk
  if (["a", "accept"].includes(trimmed)) return { kind: "accept" };

  // Accept all
  if (["all", "accept all"].includes(trimmed)) return { kind: "accept_all" };

  // Reject all
  if (["r", "reject", "reject all"].includes(trimmed)) return { kind: "reject_all" };

  // Next chunk
  if (["n", "next"].includes(trimmed)) return { kind: "next" };

  // Previous chunk
  if (["p", "prev", "previous", "back"].includes(trimmed)) return { kind: "prev" };

  // Show more
  if (trimmed === "+" || trimmed === "more") return { kind: "more" };

  // Show fewer
  if (trimmed === "-" || trimmed === "fewer" || trimmed === "less") return { kind: "fewer" };

  // Done
  if (["d", "done", "finish", "q", "quit"].includes(trimmed)) return { kind: "done" };

  // Assess granularity
  if (["g", "assess", "granularity"].includes(trimmed)) return { kind: "assess" };

  // Apply cached assessment recommendations
  if (["apply", "apply assessment"].includes(trimmed)) return { kind: "apply" };

  // Break down current chunk: "ba" or "break all"
  if (["ba", "break all", "break chunk"].includes(trimmed)) return { kind: "break_down_chunk" };

  // Consolidate current chunk: "ca" or "consolidate all"
  if (["ca", "consolidate all", "consolidate chunk"].includes(trimmed)) return { kind: "consolidate_chunk" };

  // Break down: "b1,3" or "break down 1,3" or "b 1 3"
  const breakMatch = raw.match(/^[bB](?:reak\s*down)?\s*(.+)$/i);
  if (breakMatch) {
    const indices = parseNumericIndices(breakMatch[1], state.proposals.length);
    if (indices.length > 0) {
      return { kind: "break_down", indices };
    }
  }

  // Consolidate: "c1,3" or "consolidate 1,3" or "c 1 3"
  const consolidateMatch = raw.match(/^[cC](?:onsolidate)?\s*(.+)$/i);
  if (consolidateMatch) {
    const indices = parseNumericIndices(consolidateMatch[1], state.proposals.length);
    if (indices.length > 0) {
      return { kind: "consolidate", indices };
    }
  }

  // Numeric selection (1-based, comma or space separated)
  const nums = trimmed
    .split(/[\s,]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));

  if (nums.length > 0) {
    // Convert to 0-based indices, filter valid range
    const indices = [...new Set(
      nums
        .filter((n) => n >= 1 && n <= state.proposals.length)
        .map((n) => n - 1),
    )].sort((a, b) => a - b);

    if (indices.length > 0) {
      return { kind: "select", indices };
    }
  }

  // Natural language modification detection:
  // If the input contains a recognized action verb (add, remove, change, split, etc.)
  // treat it as a modification request rather than unknown.
  if (raw.trim()) {
    const classification = classifyModificationRequest(raw.trim());
    if (classification.intent !== "unknown") {
      return { kind: "modify", request: raw.trim() };
    }
  }

  return { kind: "unknown" };
}

/**
 * Apply an action to the review state, returning the updated state.
 * Returns null if the review session should end.
 *
 * When the action is "break_down" or "consolidate", the result includes a
 * `granularityRequest` that the caller should handle by invoking the LLM
 * and then calling `replaceProposals()` with the result.
 */
export function applyAction(
  state: ChunkReviewState,
  action: ChunkAction,
): { state: ChunkReviewState; done: boolean; message?: string; granularityRequest?: GranularityRequest; assessRequested?: boolean; modificationRequest?: string } {
  const total = state.proposals.length;

  switch (action.kind) {
    case "accept": {
      const { indices } = getCurrentChunk(state);
      const newAccepted = new Set(state.accepted);
      const newRejected = new Set(state.rejected);
      for (const idx of indices) {
        newAccepted.add(idx);
        newRejected.delete(idx);
      }

      // Auto-advance to next chunk if available
      const hasNext = state.offset + state.chunkSize < total;
      const newOffset = hasNext
        ? state.offset + state.chunkSize
        : state.offset;

      return {
        state: {
          ...state,
          accepted: newAccepted,
          rejected: newRejected,
          offset: newOffset,
        },
        done: false,
        message: `Accepted proposals ${indices.map((i) => i + 1).join(", ")}.`,
      };
    }

    case "accept_all": {
      const newAccepted = new Set<number>();
      for (let i = 0; i < total; i++) newAccepted.add(i);
      return {
        state: { ...state, accepted: newAccepted, rejected: new Set() },
        done: true,
      };
    }

    case "reject_all": {
      return {
        state: { ...state, accepted: new Set(), rejected: new Set() },
        done: true,
      };
    }

    case "next": {
      const hasNext = state.offset + state.chunkSize < total;
      if (!hasNext) {
        return { state, done: false, message: "Already at last page." };
      }
      return {
        state: { ...state, offset: state.offset + state.chunkSize },
        done: false,
      };
    }

    case "prev": {
      if (state.offset === 0) {
        return { state, done: false, message: "Already at first page." };
      }
      const newOffset = Math.max(0, state.offset - state.chunkSize);
      return {
        state: { ...state, offset: newOffset },
        done: false,
      };
    }

    case "more": {
      const newSize = Math.min(state.chunkSize + 5, total);
      if (newSize === state.chunkSize) {
        return { state, done: false, message: "Already showing all proposals." };
      }
      // Clamp offset so we don't go out of bounds
      const newOffset = Math.min(state.offset, Math.max(0, total - newSize));
      return {
        state: { ...state, chunkSize: newSize, offset: newOffset },
        done: false,
        message: `Showing ${newSize} proposals per page.`,
      };
    }

    case "fewer": {
      const newSize = Math.max(1, state.chunkSize - 5);
      if (newSize === state.chunkSize) {
        return { state, done: false, message: "Already at minimum chunk size." };
      }
      return {
        state: { ...state, chunkSize: newSize },
        done: false,
        message: `Showing ${newSize} proposals per page.`,
      };
    }

    case "done": {
      return { state, done: true };
    }

    case "select": {
      const newAccepted = new Set(state.accepted);
      const newRejected = new Set(state.rejected);
      for (const idx of action.indices) {
        // Toggle: if already accepted, un-accept; otherwise accept
        if (newAccepted.has(idx)) {
          newAccepted.delete(idx);
        } else {
          newAccepted.add(idx);
          newRejected.delete(idx);
        }
      }
      return {
        state: { ...state, accepted: newAccepted, rejected: newRejected },
        done: false,
        message: `Toggled proposals ${action.indices.map((i) => i + 1).join(", ")}.`,
      };
    }

    case "break_down": {
      // Signal to the caller that selected proposals need LLM breakdown.
      // The caller replaces these proposals with finer-grained versions.
      return {
        state,
        done: false,
        message: `Breaking down proposal(s) ${action.indices.map((i) => i + 1).join(", ")}...`,
        granularityRequest: { kind: "break_down", indices: action.indices },
      };
    }

    case "consolidate": {
      // Signal to the caller that selected proposals need LLM consolidation.
      // The caller replaces these proposals with consolidated versions.
      return {
        state,
        done: false,
        message: `Consolidating proposal(s) ${action.indices.map((i) => i + 1).join(", ")}...`,
        granularityRequest: { kind: "consolidate", indices: action.indices },
      };
    }

    case "assess": {
      // Signal to the caller to run LLM-powered granularity assessment.
      return {
        state,
        done: false,
        message: "Assessing proposal granularity...",
        assessRequested: true,
      };
    }

    case "apply": {
      // Apply cached assessment recommendations. The caller handles the LLM calls.
      if (!state.lastAssessment || state.lastAssessment.length === 0) {
        return {
          state,
          done: false,
          message: "No assessment available. Run 'g' first to assess granularity.",
        };
      }
      // Build granularity requests from assessment recommendations.
      // Process break_down and consolidate groups separately.
      const breakDownIndices = state.lastAssessment
        .filter((a) => a.recommendation === "break_down")
        .map((a) => a.proposalIndex)
        .filter((i) => i >= 0 && i < total);
      const consolidateIndices = state.lastAssessment
        .filter((a) => a.recommendation === "consolidate")
        .map((a) => a.proposalIndex)
        .filter((i) => i >= 0 && i < total);

      if (breakDownIndices.length === 0 && consolidateIndices.length === 0) {
        return {
          state,
          done: false,
          message: "Assessment found no proposals needing adjustment. All are appropriately sized.",
        };
      }

      // Prefer break_down first; if both exist, do break_down.
      // The caller can re-run apply to process the remaining direction.
      if (breakDownIndices.length > 0) {
        return {
          state,
          done: false,
          message: `Applying assessment: breaking down proposal(s) ${breakDownIndices.map((i) => i + 1).join(", ")}...`,
          granularityRequest: { kind: "break_down", indices: breakDownIndices },
        };
      }
      return {
        state,
        done: false,
        message: `Applying assessment: consolidating proposal(s) ${consolidateIndices.map((i) => i + 1).join(", ")}...`,
        granularityRequest: { kind: "consolidate", indices: consolidateIndices },
      };
    }

    case "break_down_chunk": {
      // Break down all proposals in the current chunk.
      const { indices } = getCurrentChunk(state);
      return {
        state,
        done: false,
        message: `Breaking down all proposals in current chunk (${indices.map((i) => i + 1).join(", ")})...`,
        granularityRequest: { kind: "break_down", indices },
      };
    }

    case "consolidate_chunk": {
      // Consolidate all proposals in the current chunk.
      const { indices } = getCurrentChunk(state);
      return {
        state,
        done: false,
        message: `Consolidating all proposals in current chunk (${indices.map((i) => i + 1).join(", ")})...`,
        granularityRequest: { kind: "consolidate", indices },
      };
    }

    case "modify": {
      return {
        state,
        done: false,
        message: "Modifying proposals...",
        modificationRequest: action.request,
      };
    }

    case "unknown": {
      return {
        state,
        done: false,
        message: "Unknown command. Use a/n/p/b#/c#/ba/ca/g/apply/+/-/A/R/d or enter proposal numbers.",
      };
    }
  }
}

/**
 * Replace specific proposals in the review state with new ones.
 * Used after an LLM granularity adjustment (break_down or consolidate).
 *
 * - `indices`: 0-based indices of proposals to replace
 * - `replacements`: new proposals to insert at the positions of the originals
 * - `direction`: the kind of adjustment (for history tracking)
 *
 * Accepted/rejected sets are updated: indices pointing to replaced proposals
 * are removed, and remaining indices are shifted to account for length changes.
 * The adjustment is recorded in `granularityHistory`.
 */
export function replaceProposals(
  state: ChunkReviewState,
  indices: number[],
  replacements: Proposal[],
  direction?: "break_down" | "consolidate",
): ChunkReviewState {
  // Sort indices descending so removals don't shift earlier indices
  const sorted = [...indices].sort((a, b) => b - a);

  // Build the new proposal array: remove originals, insert replacements at
  // the position of the first (lowest) original index.
  const newProposals = [...state.proposals];
  for (const idx of sorted) {
    newProposals.splice(idx, 1);
  }
  const insertAt = Math.min(...indices);
  newProposals.splice(insertAt, 0, ...replacements);

  // Rebuild accepted/rejected sets with shifted indices
  const newAccepted = new Set<number>();
  const newRejected = new Set<number>();

  const removedSet = new Set(indices);

  // Map old index → new index (accounting for removals and insertion)
  for (const oldIdx of state.accepted) {
    if (removedSet.has(oldIdx)) continue;
    const newIdx = mapIndex(oldIdx, indices, replacements.length);
    newAccepted.add(newIdx);
  }
  for (const oldIdx of state.rejected) {
    if (removedSet.has(oldIdx)) continue;
    const newIdx = mapIndex(oldIdx, indices, replacements.length);
    newRejected.add(newIdx);
  }

  // Clamp offset to valid range
  const maxOffset = Math.max(0, newProposals.length - state.chunkSize);
  const offset = Math.min(state.offset, maxOffset);

  // Record the adjustment in history
  const historyEntry: GranularityAdjustmentRecord | undefined = direction
    ? {
        direction,
        originalTitles: indices.map((i) => state.proposals[i].epic.title),
        resultTitles: replacements.map((p) => p.epic.title),
        timestamp: new Date().toISOString(),
      }
    : undefined;

  return {
    proposals: newProposals,
    offset,
    chunkSize: Math.min(state.chunkSize, newProposals.length),
    accepted: newAccepted,
    rejected: newRejected,
    granularityHistory: historyEntry
      ? [...state.granularityHistory, historyEntry]
      : state.granularityHistory,
    // Clear cached assessment since proposal indices have changed
    lastAssessment: undefined,
    thresholdWeeks: state.thresholdWeeks,
  };
}

/**
 * Map an old proposal index to its new position after removing `removedIndices`
 * and inserting `insertCount` replacements at the first removed position.
 */
function mapIndex(
  oldIdx: number,
  removedIndices: number[],
  insertCount: number,
): number {
  const insertAt = Math.min(...removedIndices);
  const removedBefore = removedIndices.filter((r) => r < oldIdx).length;

  // After removing, shift down
  let newIdx = oldIdx - removedBefore;

  // If the old index was after the insertion point, shift up by insertion count
  if (oldIdx > insertAt) {
    newIdx += insertCount;
  }

  return newIdx;
}

/**
 * Get the accepted proposals from the final state.
 */
export function getAcceptedProposals(state: ChunkReviewState): Proposal[] {
  return state.proposals.filter((_, i) => state.accepted.has(i));
}

/**
 * Get the remaining (not accepted) proposals from the final state.
 */
export function getRemainingProposals(state: ChunkReviewState): Proposal[] {
  return state.proposals.filter((_, i) => !state.accepted.has(i));
}

// ─── Batch acceptance tracking ───────────────────────────────────────

/**
 * Count the total items (epic + features + tasks) in a set of proposals.
 */
function countItems(proposals: Proposal[]): number {
  let count = 0;
  for (const p of proposals) {
    count++; // epic
    for (const f of p.features) {
      count++; // feature
      count += f.tasks.length; // tasks
    }
  }
  return count;
}

/**
 * Build a batch acceptance record from the final review state.
 * Pure function — no I/O.
 */
export function buildBatchRecord(
  state: ChunkReviewState,
  mode: BatchAcceptanceRecord["mode"] = "interactive",
): BatchAcceptanceRecord {
  const accepted = getAcceptedProposals(state);
  const remaining = getRemainingProposals(state);

  const record: BatchAcceptanceRecord = {
    timestamp: new Date().toISOString(),
    totalProposals: state.proposals.length,
    acceptedCount: accepted.length,
    rejectedCount: remaining.length,
    acceptedItemCount: countItems(accepted),
    accepted: accepted.map((p) => p.epic.title),
    rejected: remaining.map((p) => p.epic.title),
    mode,
  };

  if (state.granularityHistory.length > 0) {
    record.granularityAdjustments = [...state.granularityHistory];
  }

  return record;
}

/**
 * Format a human-readable summary of a batch acceptance decision.
 * Pure function — returns a multi-line string.
 */
export function formatBatchSummary(record: BatchAcceptanceRecord): string {
  const lines: string[] = [];

  // Header line
  if (record.acceptedCount === 0) {
    lines.push("No proposals accepted.");
  } else if (record.acceptedCount === record.totalProposals) {
    const label = record.totalProposals === 1 ? "proposal" : "proposals";
    lines.push(
      `Accepted all ${record.totalProposals} ${label} (${record.acceptedItemCount} items added to PRD).`,
    );
  } else {
    const label = record.acceptedCount === 1 ? "proposal" : "proposals";
    lines.push(
      `Accepted ${record.acceptedCount} of ${record.totalProposals} ${label} (${record.acceptedItemCount} items added to PRD).`,
    );
  }

  // Accepted list
  if (record.accepted.length > 0) {
    lines.push("");
    for (const title of record.accepted) {
      lines.push(`  ✓ ${title}`);
    }
  }

  // Rejected list
  if (record.rejected.length > 0) {
    lines.push("");
    lines.push("Skipped:");
    for (const title of record.rejected) {
      lines.push(`  ✗ ${title}`);
    }
  }

  // Granularity adjustments
  if (record.granularityAdjustments && record.granularityAdjustments.length > 0) {
    lines.push("");
    const adjustmentLabel = record.granularityAdjustments.length === 1
      ? "1 granularity adjustment"
      : `${record.granularityAdjustments.length} granularity adjustments`;
    lines.push(`Granularity: ${adjustmentLabel} applied during review.`);
    for (const adj of record.granularityAdjustments) {
      const icon = adj.direction === "break_down" ? "⬇" : "⬆";
      const label = adj.direction === "break_down" ? "broke down" : "consolidated";
      lines.push(
        `  ${icon} ${label} ${adj.originalTitles.join(", ")} → ${adj.resultTitles.join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}
