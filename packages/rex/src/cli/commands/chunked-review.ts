import { createInterface } from "node:readline";
import type { Proposal } from "./chunked-review-types.js";
import { info } from "../output.js";

// Re-export all pure logic and types from the state module.
// This preserves the existing public API — all consumers can continue
// importing from "chunked-review.js" without changes.
export {
  // Types
  type GranularityAdjustmentRecord,
  type ChunkReviewState,
  type ChunkAction,
  type GranularityRequest,
  type BatchAcceptanceRecord,
  type GranularityHandler,
  type AssessmentHandler,
  type ModificationHandler,
  type ProposalAssessment,
  // Pure functions
  createReviewState,
  getCurrentChunk,
  formatPaginationHeader,
  formatChunk,
  formatActionMenu,
  buildPrompt,
  parseChunkInput,
  applyAction,
  replaceProposals,
  getAcceptedProposals,
  getRemainingProposals,
  buildBatchRecord,
  formatBatchSummary,
} from "./chunked-review-state.js";

import {
  createReviewState,
  formatPaginationHeader,
  formatChunk,
  formatActionMenu,
  buildPrompt,
  parseChunkInput,
  applyAction,
  replaceProposals,
  getAcceptedProposals,
  getRemainingProposals,
  buildBatchRecord,
  formatBatchSummary,
} from "./chunked-review-state.js";
import type {
  GranularityHandler,
  AssessmentHandler,
  ModificationHandler,
  BatchAcceptanceRecord,
} from "./chunked-review-state.js";

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
 * Returns the proposals the user accepted (may be empty) and a batch record.
 *
 * When `onGranularityAdjust` is provided, the review loop supports `b#` (break down)
 * and `c#` (consolidate) commands that invoke the LLM to adjust proposal granularity.
 *
 * When `onAssess` is provided, the review loop supports `g` (assess) command
 * that invokes the LLM to evaluate proposal granularity and display recommendations.
 *
 * When `onModify` is provided, the review loop supports natural language modification
 * requests that invoke the LLM to revise proposals based on the user's free-form input.
 */
export async function runChunkedReview(
  proposals: Proposal[],
  chunkSize: number = 5,
  onGranularityAdjust?: GranularityHandler,
  onAssess?: AssessmentHandler,
  onModify?: ModificationHandler,
  thresholdWeeks?: number,
): Promise<{ accepted: Proposal[]; remaining: Proposal[]; batchRecord: BatchAcceptanceRecord }> {
  // For single proposal or small batches, use simple y/n
  if (proposals.length <= 1) {
    const answer = await promptLine("Accept this proposal? (y/n) ");
    const isYes = ["y", "yes"].includes(answer.toLowerCase());
    const state = createReviewState(proposals, 1, thresholdWeeks);
    if (isYes) {
      state.accepted.add(0);
    }
    const record = buildBatchRecord(state);
    if (isYes) {
      return { accepted: proposals, remaining: [], batchRecord: record };
    }
    return { accepted: [], remaining: proposals, batchRecord: record };
  }

  let state = createReviewState(proposals, chunkSize, thresholdWeeks);

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
    const { state: newState, done, message, granularityRequest, assessRequested, modificationRequest } = applyAction(state, action);

    if (message) {
      info(message);
    }

    state = newState;

    // Handle granularity adjustments
    if (granularityRequest) {
      if (!onGranularityAdjust) {
        info("Granularity adjustment is not available in this context.");
      } else {
        const targetProposals = granularityRequest.indices.map(
          (i) => state.proposals[i],
        );
        try {
          const adjusted = await onGranularityAdjust(
            targetProposals,
            granularityRequest.kind,
          );
          if (adjusted.length > 0) {
            state = replaceProposals(state, granularityRequest.indices, adjusted, granularityRequest.kind);
            const label = granularityRequest.kind === "break_down"
              ? "broken down"
              : "consolidated";
            info(
              `Replaced ${targetProposals.length} proposal(s) with ${adjusted.length} ${label} proposal(s).`,
            );
          } else {
            info("LLM returned no proposals. Original proposals unchanged.");
          }
        } catch (err) {
          info(`Granularity adjustment failed: ${(err as Error).message}`);
          info("Original proposals unchanged.");
        }
      }
    }

    // Handle granularity assessment
    if (assessRequested) {
      if (!onAssess) {
        info("Granularity assessment is not available in this context.");
      } else {
        try {
          const { assessments, formatted } = await onAssess(state.proposals);
          state = { ...state, lastAssessment: assessments };
          info("");
          info(formatted);
          const actionable = assessments.filter((a) => a.recommendation !== "keep");
          if (actionable.length > 0) {
            info("");
            info("Use 'apply' to apply these recommendations automatically.");
          }
        } catch (err) {
          info(`Granularity assessment failed: ${(err as Error).message}`);
        }
      }
    }

    // Handle natural language modification
    if (modificationRequest) {
      if (!onModify) {
        info("Natural language modification is not available in this context.");
      } else {
        try {
          const modified = await onModify(state.proposals, modificationRequest);
          if (modified.length > 0) {
            // Replace all proposals with the modified set
            state = createReviewState(modified, state.chunkSize, state.thresholdWeeks);
            info(`Proposals updated (${modified.length} proposal${modified.length === 1 ? "" : "s"}).`);
          } else {
            info("Modification returned no proposals. Original proposals unchanged.");
          }
        } catch (err) {
          info(`Modification failed: ${(err as Error).message}`);
          info("Original proposals unchanged.");
        }
      }
    }

    if (done) {
      break;
    }
  }

  const accepted = getAcceptedProposals(state);
  const remaining = getRemainingProposals(state);
  const batchRecord = buildBatchRecord(state);

  // Summary
  info("");
  info(formatBatchSummary(batchRecord));

  return { accepted, remaining, batchRecord };
}
