import { createInterface } from "node:readline";
import type { Proposal } from "../../analyze/index.js";
import { info, result } from "../output.js";

const DEFAULT_CHUNK_SIZE = 5;

// ─── Pure logic (no I/O, fully testable) ─────────────────────────────

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
  | { kind: "unknown" };

/**
 * Create initial state for a chunked review session.
 */
export function createReviewState(
  proposals: Proposal[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): ChunkReviewState {
  return {
    proposals,
    offset: 0,
    chunkSize: Math.max(1, Math.min(chunkSize, proposals.length)),
    accepted: new Set(),
    rejected: new Set(),
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
        lines.push(`       [task] ${t.title}${pri}`);
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
  options.push("d=done");
  options.push("#,#=select");

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

  return { kind: "unknown" };
}

/**
 * Apply an action to the review state, returning the updated state.
 * Returns null if the review session should end.
 */
export function applyAction(
  state: ChunkReviewState,
  action: ChunkAction,
): { state: ChunkReviewState; done: boolean; message?: string } {
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

    case "unknown": {
      return {
        state,
        done: false,
        message: "Unknown command. Use a/n/p/+/-/A/R/d or enter proposal numbers.",
      };
    }
  }
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

// ─── Interactive I/O (thin wrapper) ──────────────────────────────────

function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Run the interactive chunked review loop.
 * Returns the proposals the user accepted (may be empty).
 */
export async function runChunkedReview(
  proposals: Proposal[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<{ accepted: Proposal[]; remaining: Proposal[] }> {
  // For single proposal or small batches, use simple y/n
  if (proposals.length <= 1) {
    const answer = await promptLine("Accept this proposal? (y/n) ");
    if (["y", "yes"].includes(answer.toLowerCase())) {
      return { accepted: proposals, remaining: [] };
    }
    return { accepted: [], remaining: proposals };
  }

  let state = createReviewState(proposals, chunkSize);

  // Main review loop
  while (true) {
    info("");
    info(formatPaginationHeader(state));
    info("─".repeat(40));
    info(formatChunk(state));
    info("");
    info(formatActionMenu(state));

    const input = await promptLine(buildPrompt(state));
    const action = parseChunkInput(input, state);
    const { state: newState, done, message } = applyAction(state, action);

    if (message) {
      info(message);
    }

    state = newState;

    if (done) {
      break;
    }
  }

  const accepted = getAcceptedProposals(state);
  const remaining = getRemainingProposals(state);

  // Summary
  if (accepted.length > 0) {
    info(`\nAccepting ${accepted.length} of ${proposals.length} proposals.`);
  } else {
    info("\nNo proposals accepted.");
  }

  return { accepted, remaining };
}
