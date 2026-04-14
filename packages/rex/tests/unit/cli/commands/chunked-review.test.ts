import { describe, it, expect } from "vitest";
import {
  createReviewState,
  getCurrentChunk,
  formatPaginationHeader,
  formatChunk,
  formatActionMenu,
  buildPrompt,
  parseChunkInput,
  applyAction,
  getAcceptedProposals,
  getRemainingProposals,
  replaceProposals,
  buildBatchRecord,
  formatBatchSummary,
} from "../../../../src/cli/commands/chunked-review-state.js";
import type {
  ChunkReviewState,
  ChunkAction,
  BatchAcceptanceRecord,
  GranularityRequest,
  GranularityAdjustmentRecord,
  ProposalAssessment,
} from "../../../../src/cli/commands/chunked-review-state.js";
import type { Proposal } from "../../../../src/cli/commands/chunked-review-types.js";

// ─── Test fixtures ───────────────────────────────────────────────────

function makeProposal(title: string, featureCount = 1, taskCount = 1): Proposal {
  const features = [];
  for (let f = 0; f < featureCount; f++) {
    const tasks = [];
    for (let t = 0; t < taskCount; t++) {
      tasks.push({
        title: `Task ${t + 1} for ${title} F${f + 1}`,
        source: "test",
        sourceFile: "test.ts",
        priority: "medium" as const,
      });
    }
    features.push({
      title: `Feature ${f + 1} of ${title}`,
      source: "test",
      tasks,
    });
  }
  return {
    epic: { title, source: "test" },
    features,
  };
}

function makeProposals(count: number): Proposal[] {
  return Array.from({ length: count }, (_, i) => makeProposal(`Epic ${i + 1}`));
}

// ─── createReviewState ───────────────────────────────────────────────

describe("createReviewState", () => {
  it("creates state with default chunk size", () => {
    const proposals = makeProposals(10);
    const state = createReviewState(proposals);
    expect(state.offset).toBe(0);
    expect(state.chunkSize).toBe(5);
    expect(state.accepted.size).toBe(0);
    expect(state.rejected.size).toBe(0);
    expect(state.proposals).toBe(proposals);
  });

  it("creates state with custom chunk size", () => {
    const proposals = makeProposals(10);
    const state = createReviewState(proposals, 3);
    expect(state.chunkSize).toBe(3);
  });

  it("clamps chunk size to proposal count", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 10);
    expect(state.chunkSize).toBe(3);
  });

  it("clamps minimum chunk size to 1", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 0);
    expect(state.chunkSize).toBe(1);
  });
});

// ─── getCurrentChunk ─────────────────────────────────────────────────

describe("getCurrentChunk", () => {
  it("returns first chunk", () => {
    const proposals = makeProposals(10);
    const state = createReviewState(proposals, 3);
    const chunk = getCurrentChunk(state);
    expect(chunk.proposals).toHaveLength(3);
    expect(chunk.indices).toEqual([0, 1, 2]);
    expect(chunk.proposals[0].epic.title).toBe("Epic 1");
  });

  it("returns middle chunk", () => {
    const proposals = makeProposals(10);
    const state = { ...createReviewState(proposals, 3), offset: 3 };
    const chunk = getCurrentChunk(state);
    expect(chunk.proposals).toHaveLength(3);
    expect(chunk.indices).toEqual([3, 4, 5]);
    expect(chunk.proposals[0].epic.title).toBe("Epic 4");
  });

  it("returns partial last chunk", () => {
    const proposals = makeProposals(7);
    const state = { ...createReviewState(proposals, 3), offset: 6 };
    const chunk = getCurrentChunk(state);
    expect(chunk.proposals).toHaveLength(1);
    expect(chunk.indices).toEqual([6]);
  });

  it("handles single proposal", () => {
    const proposals = makeProposals(1);
    const state = createReviewState(proposals, 5);
    const chunk = getCurrentChunk(state);
    expect(chunk.proposals).toHaveLength(1);
    expect(chunk.indices).toEqual([0]);
  });
});

// ─── formatPaginationHeader ──────────────────────────────────────────

describe("formatPaginationHeader", () => {
  it("formats first page of many", () => {
    const state = createReviewState(makeProposals(23), 5);
    expect(formatPaginationHeader(state)).toBe("Proposals 1-5 of 23");
  });

  it("formats middle page", () => {
    const state = { ...createReviewState(makeProposals(23), 5), offset: 10 };
    expect(formatPaginationHeader(state)).toBe("Proposals 11-15 of 23");
  });

  it("formats last partial page", () => {
    const state = { ...createReviewState(makeProposals(23), 5), offset: 20 };
    expect(formatPaginationHeader(state)).toBe("Proposals 21-23 of 23");
  });

  it("formats single page", () => {
    const state = createReviewState(makeProposals(3), 5);
    expect(formatPaginationHeader(state)).toBe("Proposals 1-3 of 3");
  });
});

// ─── formatChunk ─────────────────────────────────────────────────────

describe("formatChunk", () => {
  it("shows numbered proposals with epic titles", () => {
    const state = createReviewState(makeProposals(3), 5);
    const output = formatChunk(state);
    expect(output).toContain("1. [epic] Epic 1");
    expect(output).toContain("2. [epic] Epic 2");
    expect(output).toContain("3. [epic] Epic 3");
  });

  it("shows feature and task hierarchy", () => {
    const state = createReviewState(makeProposals(1), 5);
    const output = formatChunk(state);
    expect(output).toContain("[feature]");
    expect(output).toContain("[task]");
  });

  it("shows accepted marker", () => {
    const state = createReviewState(makeProposals(3), 5);
    state.accepted.add(0);
    const output = formatChunk(state);
    expect(output).toContain("1. [epic] Epic 1 ✓");
    expect(output).not.toContain("2. [epic] Epic 2 ✓");
  });

  it("shows rejected marker", () => {
    const state = createReviewState(makeProposals(3), 5);
    state.rejected.add(1);
    const output = formatChunk(state);
    expect(output).toContain("2. [epic] Epic 2 ✗");
  });

  it("uses global numbering not chunk-local", () => {
    const state = { ...createReviewState(makeProposals(10), 3), offset: 6 };
    const output = formatChunk(state);
    expect(output).toContain("7. [epic] Epic 7");
    expect(output).toContain("8. [epic] Epic 8");
    expect(output).toContain("9. [epic] Epic 9");
    expect(output).not.toContain("1. [epic]");
  });

  it("shows priority on tasks", () => {
    const proposals = [makeProposal("Test", 1, 1)];
    const state = createReviewState(proposals, 5);
    const output = formatChunk(state);
    expect(output).toContain("[medium]");
  });

  it("shows epic description when present", () => {
    const proposal: Proposal = {
      epic: { title: "Auth", source: "test", description: "Authentication system" },
      features: [],
    };
    const state = createReviewState([proposal], 5);
    const output = formatChunk(state);
    expect(output).toContain("Authentication system");
  });
});

// ─── formatActionMenu ────────────────────────────────────────────────

describe("formatActionMenu", () => {
  it("includes next when more pages exist", () => {
    const state = createReviewState(makeProposals(10), 3);
    const menu = formatActionMenu(state);
    expect(menu).toContain("n=next");
  });

  it("excludes next on last page", () => {
    const state = { ...createReviewState(makeProposals(3), 5) };
    const menu = formatActionMenu(state);
    expect(menu).not.toContain("n=next");
  });

  it("includes prev when not on first page", () => {
    const state = { ...createReviewState(makeProposals(10), 3), offset: 3 };
    const menu = formatActionMenu(state);
    expect(menu).toContain("p=prev");
  });

  it("excludes prev on first page", () => {
    const state = createReviewState(makeProposals(10), 3);
    const menu = formatActionMenu(state);
    expect(menu).not.toContain("p=prev");
  });

  it("always includes core options", () => {
    const state = createReviewState(makeProposals(10), 3);
    const menu = formatActionMenu(state);
    expect(menu).toContain("a=accept these");
    expect(menu).toContain("A=accept all");
    expect(menu).toContain("R=reject all");
    expect(menu).toContain("d=done");
    expect(menu).toContain("+more");
    expect(menu).toContain("-fewer");
    expect(menu).toContain("#,#=select");
  });
});

// ─── buildPrompt ─────────────────────────────────────────────────────

describe("buildPrompt", () => {
  it("shows simple prompt when nothing accepted", () => {
    const state = createReviewState(makeProposals(5), 3);
    expect(buildPrompt(state)).toBe("> ");
  });

  it("shows accepted count when some accepted", () => {
    const state = createReviewState(makeProposals(5), 3);
    state.accepted.add(0);
    state.accepted.add(2);
    expect(buildPrompt(state)).toBe("(2/5 accepted) > ");
  });
});

// ─── parseChunkInput ─────────────────────────────────────────────────

describe("parseChunkInput", () => {
  const state = createReviewState(makeProposals(10), 5);

  it("parses accept commands", () => {
    expect(parseChunkInput("a", state).kind).toBe("accept");
    expect(parseChunkInput("accept", state).kind).toBe("accept");
    expect(parseChunkInput("  a  ", state).kind).toBe("accept");
  });

  it("parses accept all", () => {
    expect(parseChunkInput("A", state).kind).toBe("accept_all");
    expect(parseChunkInput("all", state).kind).toBe("accept_all");
    expect(parseChunkInput("accept all", state).kind).toBe("accept_all");
  });

  it("parses reject all", () => {
    expect(parseChunkInput("R", state).kind).toBe("reject_all");
    expect(parseChunkInput("r", state).kind).toBe("reject_all");
    expect(parseChunkInput("reject", state).kind).toBe("reject_all");
    expect(parseChunkInput("reject all", state).kind).toBe("reject_all");
  });

  it("parses navigation", () => {
    expect(parseChunkInput("n", state).kind).toBe("next");
    expect(parseChunkInput("next", state).kind).toBe("next");
    expect(parseChunkInput("p", state).kind).toBe("prev");
    expect(parseChunkInput("prev", state).kind).toBe("prev");
    expect(parseChunkInput("back", state).kind).toBe("prev");
  });

  it("parses chunk size changes", () => {
    expect(parseChunkInput("+", state).kind).toBe("more");
    expect(parseChunkInput("more", state).kind).toBe("more");
    expect(parseChunkInput("-", state).kind).toBe("fewer");
    expect(parseChunkInput("fewer", state).kind).toBe("fewer");
    expect(parseChunkInput("less", state).kind).toBe("fewer");
  });

  it("parses done", () => {
    expect(parseChunkInput("d", state).kind).toBe("done");
    expect(parseChunkInput("done", state).kind).toBe("done");
    expect(parseChunkInput("finish", state).kind).toBe("done");
    expect(parseChunkInput("q", state).kind).toBe("done");
    expect(parseChunkInput("quit", state).kind).toBe("done");
  });

  it("parses numeric selection", () => {
    const action = parseChunkInput("1,3,5", state);
    expect(action.kind).toBe("select");
    if (action.kind === "select") {
      expect(action.indices).toEqual([0, 2, 4]); // 1-based → 0-based
    }
  });

  it("parses space-separated numbers", () => {
    const action = parseChunkInput("2 4", state);
    expect(action.kind).toBe("select");
    if (action.kind === "select") {
      expect(action.indices).toEqual([1, 3]);
    }
  });

  it("ignores out-of-range numbers", () => {
    const action = parseChunkInput("1,99", state);
    expect(action.kind).toBe("select");
    if (action.kind === "select") {
      expect(action.indices).toEqual([0]);
    }
  });

  it("deduplicates numbers", () => {
    const action = parseChunkInput("1,1,2", state);
    expect(action.kind).toBe("select");
    if (action.kind === "select") {
      expect(action.indices).toEqual([0, 1]);
    }
  });

  it("returns unknown for invalid input", () => {
    expect(parseChunkInput("xyz", state).kind).toBe("unknown");
    expect(parseChunkInput("", state).kind).toBe("unknown");
  });

  it("returns unknown when all numbers are out of range", () => {
    expect(parseChunkInput("99,100", state).kind).toBe("unknown");
  });
});

// ─── applyAction ─────────────────────────────────────────────────────

describe("applyAction", () => {
  it("accept marks current chunk and auto-advances", () => {
    const state = createReviewState(makeProposals(10), 3);
    const { state: next, done, message } = applyAction(state, { kind: "accept" });

    expect(done).toBe(false);
    // Should accept indices 0, 1, 2
    expect(next.accepted.has(0)).toBe(true);
    expect(next.accepted.has(1)).toBe(true);
    expect(next.accepted.has(2)).toBe(true);
    // Should advance to next chunk
    expect(next.offset).toBe(3);
    expect(message).toContain("1, 2, 3");
  });

  it("accept on last page stays put", () => {
    const state = { ...createReviewState(makeProposals(3), 5) };
    const { state: next } = applyAction(state, { kind: "accept" });
    // No auto-advance since already showing all
    expect(next.offset).toBe(0);
    // But proposals should be accepted
    expect(next.accepted.has(0)).toBe(true);
    expect(next.accepted.has(1)).toBe(true);
    expect(next.accepted.has(2)).toBe(true);
  });

  it("accept removes from rejected set", () => {
    const state = createReviewState(makeProposals(5), 5);
    state.rejected.add(0);
    state.rejected.add(1);
    const { state: next } = applyAction(state, { kind: "accept" });
    expect(next.rejected.has(0)).toBe(false);
    expect(next.rejected.has(1)).toBe(false);
  });

  it("accept_all accepts everything and finishes", () => {
    const state = createReviewState(makeProposals(5), 3);
    const { state: next, done } = applyAction(state, { kind: "accept_all" });
    expect(done).toBe(true);
    expect(next.accepted.size).toBe(5);
    expect(next.rejected.size).toBe(0);
  });

  it("reject_all clears selections and finishes", () => {
    const state = createReviewState(makeProposals(5), 3);
    state.accepted.add(0);
    const { state: next, done } = applyAction(state, { kind: "reject_all" });
    expect(done).toBe(true);
    expect(next.accepted.size).toBe(0);
  });

  it("next advances offset", () => {
    const state = createReviewState(makeProposals(10), 3);
    const { state: next, done } = applyAction(state, { kind: "next" });
    expect(done).toBe(false);
    expect(next.offset).toBe(3);
  });

  it("next on last page shows message", () => {
    const state = { ...createReviewState(makeProposals(3), 5) };
    const { state: next, done, message } = applyAction(state, { kind: "next" });
    expect(done).toBe(false);
    expect(next.offset).toBe(0); // unchanged
    expect(message).toContain("last page");
  });

  it("prev goes back", () => {
    const state = { ...createReviewState(makeProposals(10), 3), offset: 6 };
    const { state: next, done } = applyAction(state, { kind: "prev" });
    expect(done).toBe(false);
    expect(next.offset).toBe(3);
  });

  it("prev on first page shows message", () => {
    const state = createReviewState(makeProposals(10), 3);
    const { state: next, done, message } = applyAction(state, { kind: "prev" });
    expect(done).toBe(false);
    expect(next.offset).toBe(0);
    expect(message).toContain("first page");
  });

  it("more increases chunk size by 5", () => {
    const state = createReviewState(makeProposals(20), 3);
    const { state: next, message } = applyAction(state, { kind: "more" });
    expect(next.chunkSize).toBe(8);
    expect(message).toContain("8");
  });

  it("more clamps to total proposals", () => {
    const state = createReviewState(makeProposals(5), 3);
    const { state: next } = applyAction(state, { kind: "more" });
    expect(next.chunkSize).toBe(5);
  });

  it("more when already showing all shows message", () => {
    const state = createReviewState(makeProposals(3), 3);
    const { message } = applyAction(state, { kind: "more" });
    expect(message).toContain("Already showing all");
  });

  it("fewer decreases chunk size by 5", () => {
    const state = createReviewState(makeProposals(20), 10);
    const { state: next, message } = applyAction(state, { kind: "fewer" });
    expect(next.chunkSize).toBe(5);
    expect(message).toContain("5");
  });

  it("fewer clamps to 1", () => {
    const state = createReviewState(makeProposals(10), 3);
    const { state: next } = applyAction(state, { kind: "fewer" });
    expect(next.chunkSize).toBe(1);
  });

  it("fewer at minimum shows message", () => {
    const state = createReviewState(makeProposals(10), 1);
    const { message } = applyAction(state, { kind: "fewer" });
    expect(message).toContain("minimum");
  });

  it("done finishes with current selections", () => {
    const state = createReviewState(makeProposals(5), 3);
    state.accepted.add(0);
    state.accepted.add(2);
    const { state: next, done } = applyAction(state, { kind: "done" });
    expect(done).toBe(true);
    expect(next.accepted.size).toBe(2);
  });

  it("select toggles proposals on", () => {
    const state = createReviewState(makeProposals(5), 5);
    const { state: next, message } = applyAction(state, {
      kind: "select",
      indices: [1, 3],
    });
    expect(next.accepted.has(1)).toBe(true);
    expect(next.accepted.has(3)).toBe(true);
    expect(next.accepted.has(0)).toBe(false);
    expect(message).toContain("2, 4");
  });

  it("select toggles already-accepted proposals off", () => {
    const state = createReviewState(makeProposals(5), 5);
    state.accepted.add(1);
    const { state: next } = applyAction(state, {
      kind: "select",
      indices: [1],
    });
    expect(next.accepted.has(1)).toBe(false);
  });

  it("select removes from rejected set", () => {
    const state = createReviewState(makeProposals(5), 5);
    state.rejected.add(2);
    const { state: next } = applyAction(state, {
      kind: "select",
      indices: [2],
    });
    expect(next.rejected.has(2)).toBe(false);
    expect(next.accepted.has(2)).toBe(true);
  });

  it("unknown action shows help message", () => {
    const state = createReviewState(makeProposals(5), 3);
    const { done, message } = applyAction(state, { kind: "unknown" });
    expect(done).toBe(false);
    expect(message).toContain("Unknown command");
  });
});

// ─── getAcceptedProposals / getRemainingProposals ────────────────────

describe("getAcceptedProposals", () => {
  it("returns only accepted proposals", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);
    state.accepted.add(1);
    state.accepted.add(3);

    const accepted = getAcceptedProposals(state);
    expect(accepted).toHaveLength(2);
    expect(accepted[0].epic.title).toBe("Epic 2");
    expect(accepted[1].epic.title).toBe("Epic 4");
  });

  it("returns empty array when nothing accepted", () => {
    const state = createReviewState(makeProposals(3), 3);
    expect(getAcceptedProposals(state)).toHaveLength(0);
  });

  it("returns all when all accepted", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 3);
    state.accepted.add(0);
    state.accepted.add(1);
    state.accepted.add(2);
    expect(getAcceptedProposals(state)).toHaveLength(3);
  });
});

describe("getRemainingProposals", () => {
  it("returns non-accepted proposals", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);
    state.accepted.add(0);
    state.accepted.add(2);
    state.accepted.add(4);

    const remaining = getRemainingProposals(state);
    expect(remaining).toHaveLength(2);
    expect(remaining[0].epic.title).toBe("Epic 2");
    expect(remaining[1].epic.title).toBe("Epic 4");
  });

  it("returns all when nothing accepted", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 3);
    expect(getRemainingProposals(state)).toHaveLength(3);
  });

  it("returns empty when all accepted", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 3);
    state.accepted.add(0);
    state.accepted.add(1);
    state.accepted.add(2);
    expect(getRemainingProposals(state)).toHaveLength(0);
  });
});

// ─── Integration: multi-step workflow ────────────────────────────────

describe("chunked review workflow", () => {
  it("simulates accept-chunk-by-chunk workflow", () => {
    const proposals = makeProposals(10);
    let state = createReviewState(proposals, 3);

    // Accept first chunk (0-2)
    let result = applyAction(state, { kind: "accept" });
    state = result.state;
    expect(state.accepted.size).toBe(3);
    expect(state.offset).toBe(3); // auto-advanced

    // Accept second chunk (3-5)
    result = applyAction(state, { kind: "accept" });
    state = result.state;
    expect(state.accepted.size).toBe(6);
    expect(state.offset).toBe(6); // auto-advanced

    // Skip third chunk, go to done
    result = applyAction(state, { kind: "done" });
    expect(result.done).toBe(true);

    const accepted = getAcceptedProposals(state);
    const remaining = getRemainingProposals(state);
    expect(accepted).toHaveLength(6);
    expect(remaining).toHaveLength(4);
  });

  it("simulates selective workflow with navigation", () => {
    const proposals = makeProposals(8);
    let state = createReviewState(proposals, 3);

    // Select specific proposals from first page
    let result = applyAction(state, { kind: "select", indices: [0, 2] });
    state = result.state;
    expect(state.accepted.size).toBe(2);

    // Navigate to next page
    result = applyAction(state, { kind: "next" });
    state = result.state;
    expect(state.offset).toBe(3);

    // Accept entire chunk
    result = applyAction(state, { kind: "accept" });
    state = result.state;
    expect(state.accepted.size).toBe(5); // 2 selected + 3 from chunk

    // Navigate back to verify first page still has selections
    result = applyAction(state, { kind: "prev" });
    state = result.state;
    expect(state.offset).toBe(3); // went back from auto-advanced position

    // Done
    result = applyAction(state, { kind: "done" });
    expect(result.done).toBe(true);
    expect(getAcceptedProposals(state)).toHaveLength(5);
  });

  it("simulates resize workflow", () => {
    const proposals = makeProposals(20);
    let state = createReviewState(proposals, 5);

    // Increase chunk size
    let result = applyAction(state, { kind: "more" });
    state = result.state;
    expect(state.chunkSize).toBe(10);

    // Verify we see more proposals
    const chunk = getCurrentChunk(state);
    expect(chunk.proposals).toHaveLength(10);

    // Decrease chunk size
    result = applyAction(state, { kind: "fewer" });
    state = result.state;
    expect(state.chunkSize).toBe(5);
  });
});

// ─── Dynamic chunk resizing (position preservation + pagination) ────

describe("dynamic chunk resizing", () => {
  describe("more command preserves current position", () => {
    it("keeps offset when expanding at the start", () => {
      const proposals = makeProposals(20);
      let state = createReviewState(proposals, 5);
      expect(state.offset).toBe(0);

      const { state: next } = applyAction(state, { kind: "more" });
      // Offset should stay at 0 — user's position preserved
      expect(next.offset).toBe(0);
      expect(next.chunkSize).toBe(10);
    });

    it("keeps offset when expanding in the middle", () => {
      const proposals = makeProposals(20);
      let state = { ...createReviewState(proposals, 5), offset: 5 };

      const { state: next } = applyAction(state, { kind: "more" });
      // Offset should stay at 5 — current proposals stay visible
      expect(next.offset).toBe(5);
      expect(next.chunkSize).toBe(10);
    });

    it("clamps offset back when expanding near the end", () => {
      const proposals = makeProposals(20);
      let state = { ...createReviewState(proposals, 5), offset: 15 };
      // Currently viewing proposals 16-20

      const { state: next } = applyAction(state, { kind: "more" });
      // newSize=10, so offset must clamp to 10 to show 11-20
      expect(next.offset).toBe(10);
      expect(next.chunkSize).toBe(10);
      // Original proposals (16-20) are still visible in the chunk
      const chunk = getCurrentChunk(next);
      expect(chunk.indices).toContain(15); // index 15 = proposal 16
      expect(chunk.indices).toContain(19); // index 19 = proposal 20
    });

    it("current proposals remain visible after expanding", () => {
      const proposals = makeProposals(20);
      let state = { ...createReviewState(proposals, 5), offset: 10 };
      const beforeChunk = getCurrentChunk(state);

      const { state: next } = applyAction(state, { kind: "more" });
      const afterChunk = getCurrentChunk(next);

      // Every proposal visible before should still be visible after
      for (const idx of beforeChunk.indices) {
        expect(afterChunk.indices).toContain(idx);
      }
    });
  });

  describe("fewer command preserves current position", () => {
    it("keeps offset when shrinking at the start", () => {
      const proposals = makeProposals(20);
      let state = createReviewState(proposals, 10);

      const { state: next } = applyAction(state, { kind: "fewer" });
      expect(next.offset).toBe(0);
      expect(next.chunkSize).toBe(5);
    });

    it("keeps offset when shrinking in the middle", () => {
      const proposals = makeProposals(20);
      let state = { ...createReviewState(proposals, 10), offset: 10 };

      const { state: next } = applyAction(state, { kind: "fewer" });
      // Offset preserved — still starts at 10
      expect(next.offset).toBe(10);
      expect(next.chunkSize).toBe(5);
    });

    it("first proposal in view stays visible after shrinking", () => {
      const proposals = makeProposals(20);
      let state = { ...createReviewState(proposals, 10), offset: 5 };
      const firstVisibleBefore = getCurrentChunk(state).indices[0];

      const { state: next } = applyAction(state, { kind: "fewer" });
      const firstVisibleAfter = getCurrentChunk(next).indices[0];

      // The first visible proposal should be the same
      expect(firstVisibleAfter).toBe(firstVisibleBefore);
    });
  });

  describe("pagination display updates after resize", () => {
    it("updates pagination header after more", () => {
      const proposals = makeProposals(20);
      let state = createReviewState(proposals, 5);
      expect(formatPaginationHeader(state)).toBe("Proposals 1-5 of 20");

      const { state: next } = applyAction(state, { kind: "more" });
      expect(formatPaginationHeader(next)).toBe("Proposals 1-10 of 20");
    });

    it("updates pagination header after fewer", () => {
      const proposals = makeProposals(20);
      let state = createReviewState(proposals, 10);
      expect(formatPaginationHeader(state)).toBe("Proposals 1-10 of 20");

      const { state: next } = applyAction(state, { kind: "fewer" });
      expect(formatPaginationHeader(next)).toBe("Proposals 1-5 of 20");
    });

    it("updates pagination header after more on middle page", () => {
      const proposals = makeProposals(20);
      let state = { ...createReviewState(proposals, 5), offset: 10 };
      expect(formatPaginationHeader(state)).toBe("Proposals 11-15 of 20");

      const { state: next } = applyAction(state, { kind: "more" });
      expect(formatPaginationHeader(next)).toBe("Proposals 11-20 of 20");
    });

    it("updates action menu after expanding to show all", () => {
      const proposals = makeProposals(8);
      let state = createReviewState(proposals, 3);
      // Should show next since there are more pages
      expect(formatActionMenu(state)).toContain("n=next");

      // Expand to show all 8
      let { state: next } = applyAction(state, { kind: "more" });
      expect(next.chunkSize).toBe(8);
      // No next button needed when all proposals visible
      expect(formatActionMenu(next)).not.toContain("n=next");
    });
  });

  describe("accepted selections preserved across resize", () => {
    it("preserves accepted set after more", () => {
      const proposals = makeProposals(20);
      let state = createReviewState(proposals, 5);
      // Accept proposals 1-5
      let result = applyAction(state, { kind: "accept" });
      state = result.state;
      expect(state.accepted.size).toBe(5);

      // Resize to show more
      result = applyAction(state, { kind: "more" });
      state = result.state;
      // All previous acceptances should still be there
      expect(state.accepted.size).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(state.accepted.has(i)).toBe(true);
      }
    });

    it("preserves accepted set after fewer", () => {
      const proposals = makeProposals(20);
      let state = createReviewState(proposals, 10);
      // Accept some specific proposals
      state.accepted.add(2);
      state.accepted.add(7);
      state.accepted.add(15);

      const { state: next } = applyAction(state, { kind: "fewer" });
      expect(next.accepted.size).toBe(3);
      expect(next.accepted.has(2)).toBe(true);
      expect(next.accepted.has(7)).toBe(true);
      expect(next.accepted.has(15)).toBe(true);
    });

    it("preserves rejected set after resize", () => {
      const proposals = makeProposals(20);
      let state = createReviewState(proposals, 5);
      state.rejected.add(3);
      state.rejected.add(8);

      const { state: next } = applyAction(state, { kind: "more" });
      expect(next.rejected.size).toBe(2);
      expect(next.rejected.has(3)).toBe(true);
      expect(next.rejected.has(8)).toBe(true);
    });
  });

  describe("resize feedback messages", () => {
    it("more reports new chunk size", () => {
      const proposals = makeProposals(20);
      let state = createReviewState(proposals, 5);
      const { message } = applyAction(state, { kind: "more" });
      expect(message).toBe("Showing 10 proposals per page.");
    });

    it("fewer reports new chunk size", () => {
      const proposals = makeProposals(20);
      let state = createReviewState(proposals, 10);
      const { message } = applyAction(state, { kind: "fewer" });
      expect(message).toBe("Showing 5 proposals per page.");
    });

    it("more at max reports already showing all", () => {
      const proposals = makeProposals(5);
      let state = createReviewState(proposals, 5);
      const { message } = applyAction(state, { kind: "more" });
      expect(message).toBe("Already showing all proposals.");
    });

    it("fewer at min reports already at minimum", () => {
      const proposals = makeProposals(10);
      let state = createReviewState(proposals, 1);
      const { message } = applyAction(state, { kind: "fewer" });
      expect(message).toBe("Already at minimum chunk size.");
    });

    it("resize does not end the review session", () => {
      const proposals = makeProposals(20);
      let state = createReviewState(proposals, 5);

      const moreResult = applyAction(state, { kind: "more" });
      expect(moreResult.done).toBe(false);

      const fewerResult = applyAction(moreResult.state, { kind: "fewer" });
      expect(fewerResult.done).toBe(false);
    });
  });
});

// ─── buildBatchRecord ────────────────────────────────────────────────

describe("buildBatchRecord", () => {
  it("records accepted and rejected proposal titles", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);
    state.accepted.add(0);
    state.accepted.add(2);
    state.accepted.add(4);

    const record = buildBatchRecord(state);

    expect(record.totalProposals).toBe(5);
    expect(record.acceptedCount).toBe(3);
    expect(record.rejectedCount).toBe(2);
    expect(record.accepted).toEqual(["Epic 1", "Epic 3", "Epic 5"]);
    expect(record.rejected).toEqual(["Epic 2", "Epic 4"]);
    expect(record.mode).toBe("interactive");
  });

  it("handles all accepted", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 3);
    state.accepted.add(0);
    state.accepted.add(1);
    state.accepted.add(2);

    const record = buildBatchRecord(state);

    expect(record.acceptedCount).toBe(3);
    expect(record.rejectedCount).toBe(0);
    expect(record.rejected).toEqual([]);
    expect(record.mode).toBe("interactive");
  });

  it("handles none accepted", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 3);

    const record = buildBatchRecord(state);

    expect(record.acceptedCount).toBe(0);
    expect(record.rejectedCount).toBe(3);
    expect(record.accepted).toEqual([]);
    expect(record.rejected).toEqual(["Epic 1", "Epic 2", "Epic 3"]);
  });

  it("includes timestamp", () => {
    const proposals = makeProposals(2);
    const state = createReviewState(proposals, 2);
    state.accepted.add(0);

    const record = buildBatchRecord(state);

    expect(record.timestamp).toBeDefined();
    // Should be a valid ISO timestamp
    expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
  });

  it("supports auto-accept mode override", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 3);
    state.accepted.add(0);
    state.accepted.add(1);
    state.accepted.add(2);

    const record = buildBatchRecord(state, "auto");

    expect(record.mode).toBe("auto");
  });

  it("counts items including features and tasks", () => {
    // makeProposal creates 1 feature with 1 task per feature by default
    const proposals = makeProposals(2);
    const state = createReviewState(proposals, 2);
    state.accepted.add(0);
    state.accepted.add(1);

    const record = buildBatchRecord(state);

    // 2 epics + 2 features + 2 tasks = 6 items
    expect(record.acceptedItemCount).toBe(6);
  });

  it("counts items correctly for multi-feature proposals", () => {
    const proposals = [makeProposal("Big Epic", 2, 3)];
    const state = createReviewState(proposals, 1);
    state.accepted.add(0);

    const record = buildBatchRecord(state);

    // 1 epic + 2 features + 6 tasks = 9 items
    expect(record.acceptedItemCount).toBe(9);
  });

  it("reports zero item count when nothing accepted", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 3);

    const record = buildBatchRecord(state);

    expect(record.acceptedItemCount).toBe(0);
  });
});

// ─── formatBatchSummary ──────────────────────────────────────────────

describe("formatBatchSummary", () => {
  it("shows summary with accepted and rejected", () => {
    const record: BatchAcceptanceRecord = {
      timestamp: "2026-02-06T00:00:00.000Z",
      totalProposals: 5,
      acceptedCount: 3,
      rejectedCount: 2,
      acceptedItemCount: 9,
      accepted: ["Auth", "Dashboard", "Settings"],
      rejected: ["Analytics", "Billing"],
      mode: "interactive",
    };

    const summary = formatBatchSummary(record);

    expect(summary).toContain("Accepted 3 of 5 proposals (9 items added to PRD)");
    expect(summary).toContain("✓ Auth");
    expect(summary).toContain("✓ Dashboard");
    expect(summary).toContain("✓ Settings");
    expect(summary).toContain("✗ Analytics");
    expect(summary).toContain("✗ Billing");
  });

  it("shows all-accepted summary without rejected section", () => {
    const record: BatchAcceptanceRecord = {
      timestamp: "2026-02-06T00:00:00.000Z",
      totalProposals: 3,
      acceptedCount: 3,
      rejectedCount: 0,
      acceptedItemCount: 9,
      accepted: ["Auth", "Dashboard", "Settings"],
      rejected: [],
      mode: "auto",
    };

    const summary = formatBatchSummary(record);

    expect(summary).toContain("Accepted all 3 proposals (9 items added to PRD)");
    expect(summary).toContain("✓ Auth");
    expect(summary).not.toContain("✗");
    expect(summary).not.toContain("Skipped");
  });

  it("shows none-accepted summary without accepted section", () => {
    const record: BatchAcceptanceRecord = {
      timestamp: "2026-02-06T00:00:00.000Z",
      totalProposals: 2,
      acceptedCount: 0,
      rejectedCount: 2,
      acceptedItemCount: 0,
      accepted: [],
      rejected: ["Auth", "Dashboard"],
      mode: "interactive",
    };

    const summary = formatBatchSummary(record);

    expect(summary).toContain("No proposals accepted");
    expect(summary).not.toContain("✓");
    expect(summary).toContain("✗ Auth");
    expect(summary).toContain("✗ Dashboard");
  });

  it("shows single proposal summary", () => {
    const record: BatchAcceptanceRecord = {
      timestamp: "2026-02-06T00:00:00.000Z",
      totalProposals: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      acceptedItemCount: 3,
      accepted: ["Auth"],
      rejected: [],
      mode: "interactive",
    };

    const summary = formatBatchSummary(record);

    // 1 out of 1 = all accepted, singular "proposal"
    expect(summary).toContain("Accepted all 1 proposal (3 items added to PRD)");
    expect(summary).toContain("✓ Auth");
  });
});

// ─── Granularity adjustment: parseChunkInput ─────────────────────────

describe("parseChunkInput granularity commands", () => {
  const state = createReviewState(makeProposals(10), 5);

  it("parses break down command with number", () => {
    const action = parseChunkInput("b1", state);
    expect(action.kind).toBe("break_down");
    if (action.kind === "break_down") {
      expect(action.indices).toEqual([0]);
    }
  });

  it("parses break down with multiple numbers", () => {
    const action = parseChunkInput("b1,3,5", state);
    expect(action.kind).toBe("break_down");
    if (action.kind === "break_down") {
      expect(action.indices).toEqual([0, 2, 4]);
    }
  });

  it("parses break down with spaces", () => {
    const action = parseChunkInput("b 2 4", state);
    expect(action.kind).toBe("break_down");
    if (action.kind === "break_down") {
      expect(action.indices).toEqual([1, 3]);
    }
  });

  it("parses 'break down' spelled out", () => {
    const action = parseChunkInput("break down 1,3", state);
    expect(action.kind).toBe("break_down");
    if (action.kind === "break_down") {
      expect(action.indices).toEqual([0, 2]);
    }
  });

  it("parses 'breakdown' as one word", () => {
    const action = parseChunkInput("breakdown 2", state);
    expect(action.kind).toBe("break_down");
    if (action.kind === "break_down") {
      expect(action.indices).toEqual([1]);
    }
  });

  it("parses consolidate command with number", () => {
    const action = parseChunkInput("c1", state);
    expect(action.kind).toBe("consolidate");
    if (action.kind === "consolidate") {
      expect(action.indices).toEqual([0]);
    }
  });

  it("parses consolidate with multiple numbers", () => {
    const action = parseChunkInput("c1,2,3", state);
    expect(action.kind).toBe("consolidate");
    if (action.kind === "consolidate") {
      expect(action.indices).toEqual([0, 1, 2]);
    }
  });

  it("parses 'consolidate' spelled out", () => {
    const action = parseChunkInput("consolidate 3,5", state);
    expect(action.kind).toBe("consolidate");
    if (action.kind === "consolidate") {
      expect(action.indices).toEqual([2, 4]);
    }
  });

  it("ignores out-of-range numbers in granularity commands", () => {
    const action = parseChunkInput("b1,99", state);
    expect(action.kind).toBe("break_down");
    if (action.kind === "break_down") {
      expect(action.indices).toEqual([0]);
    }
  });

  it("falls through to unknown when all numbers out of range", () => {
    const action = parseChunkInput("b99", state);
    // No valid indices → doesn't match break_down, falls through
    expect(action.kind).toBe("unknown");
  });

  it("deduplicates numbers in granularity commands", () => {
    const action = parseChunkInput("c1,1,2", state);
    expect(action.kind).toBe("consolidate");
    if (action.kind === "consolidate") {
      expect(action.indices).toEqual([0, 1]);
    }
  });
});

// ─── Granularity adjustment: applyAction ─────────────────────────────

describe("applyAction granularity", () => {
  it("break_down returns granularity request", () => {
    const state = createReviewState(makeProposals(5), 5);
    const { state: next, done, message, granularityRequest } = applyAction(
      state,
      { kind: "break_down", indices: [0, 2] },
    );

    expect(done).toBe(false);
    expect(message).toContain("Breaking down");
    expect(message).toContain("1, 3");
    expect(granularityRequest).toBeDefined();
    expect(granularityRequest!.kind).toBe("break_down");
    expect(granularityRequest!.indices).toEqual([0, 2]);
    // State is unchanged — caller handles the replacement
    expect(next).toBe(state);
  });

  it("consolidate returns granularity request", () => {
    const state = createReviewState(makeProposals(5), 5);
    const { state: next, done, message, granularityRequest } = applyAction(
      state,
      { kind: "consolidate", indices: [1, 3, 4] },
    );

    expect(done).toBe(false);
    expect(message).toContain("Consolidating");
    expect(message).toContain("2, 4, 5");
    expect(granularityRequest).toBeDefined();
    expect(granularityRequest!.kind).toBe("consolidate");
    expect(granularityRequest!.indices).toEqual([1, 3, 4]);
  });

  it("other actions do not return granularity request", () => {
    const state = createReviewState(makeProposals(5), 5);
    const { granularityRequest } = applyAction(state, { kind: "accept" });
    expect(granularityRequest).toBeUndefined();
  });
});

// ─── replaceProposals ────────────────────────────────────────────────

describe("replaceProposals", () => {
  it("replaces a single proposal with multiple", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);

    const replacements = [
      makeProposal("Replacement A"),
      makeProposal("Replacement B"),
      makeProposal("Replacement C"),
    ];

    const newState = replaceProposals(state, [2], replacements);

    expect(newState.proposals).toHaveLength(7); // 5 - 1 + 3
    expect(newState.proposals[0].epic.title).toBe("Epic 1");
    expect(newState.proposals[1].epic.title).toBe("Epic 2");
    expect(newState.proposals[2].epic.title).toBe("Replacement A");
    expect(newState.proposals[3].epic.title).toBe("Replacement B");
    expect(newState.proposals[4].epic.title).toBe("Replacement C");
    expect(newState.proposals[5].epic.title).toBe("Epic 4");
    expect(newState.proposals[6].epic.title).toBe("Epic 5");
  });

  it("replaces multiple proposals with fewer (consolidation)", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);

    const replacements = [makeProposal("Consolidated")];

    const newState = replaceProposals(state, [1, 2, 3], replacements);

    expect(newState.proposals).toHaveLength(3); // 5 - 3 + 1
    expect(newState.proposals[0].epic.title).toBe("Epic 1");
    expect(newState.proposals[1].epic.title).toBe("Consolidated");
    expect(newState.proposals[2].epic.title).toBe("Epic 5");
  });

  it("preserves accepted set with shifted indices", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);
    state.accepted.add(0); // Epic 1 (before replacement, stays at 0)
    state.accepted.add(4); // Epic 5 (will shift)

    const replacements = [
      makeProposal("R1"),
      makeProposal("R2"),
    ];

    const newState = replaceProposals(state, [2], replacements);

    // Epic 1 is still at index 0
    expect(newState.accepted.has(0)).toBe(true);
    // Epic 5 was at index 4, after replacing index 2 with 2 items:
    // new indices: 0=Epic1, 1=Epic2, 2=R1, 3=R2, 4=Epic4, 5=Epic5
    expect(newState.accepted.has(5)).toBe(true);
    expect(newState.accepted.size).toBe(2);
  });

  it("removes accepted status of replaced proposals", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);
    state.accepted.add(2); // Will be replaced

    const newState = replaceProposals(state, [2], [makeProposal("New")]);

    // The replaced proposal's acceptance should be gone
    expect(newState.accepted.size).toBe(0);
  });

  it("removes rejected status of replaced proposals", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);
    state.rejected.add(2); // Will be replaced

    const newState = replaceProposals(state, [2], [makeProposal("New")]);

    expect(newState.rejected.size).toBe(0);
  });

  it("clamps offset to valid range after consolidation", () => {
    const proposals = makeProposals(10);
    const state = { ...createReviewState(proposals, 5), offset: 5 };

    // Replace 7 proposals with 1, leaving only 4 total
    const newState = replaceProposals(
      state,
      [1, 2, 3, 4, 5, 6, 7],
      [makeProposal("One")],
    );

    expect(newState.proposals).toHaveLength(4); // 10 - 7 + 1
    expect(newState.offset).toBeLessThanOrEqual(
      Math.max(0, newState.proposals.length - newState.chunkSize),
    );
  });

  it("clamps chunk size to new proposal count", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);

    // Replace 3 proposals with 1, leaving only 3 total
    const newState = replaceProposals(
      state,
      [1, 2, 3],
      [makeProposal("One")],
    );

    expect(newState.proposals).toHaveLength(3);
    expect(newState.chunkSize).toBeLessThanOrEqual(3);
  });

  it("handles replacing first proposal", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 3);

    const newState = replaceProposals(
      state,
      [0],
      [makeProposal("New First"), makeProposal("New Second")],
    );

    expect(newState.proposals).toHaveLength(4);
    expect(newState.proposals[0].epic.title).toBe("New First");
    expect(newState.proposals[1].epic.title).toBe("New Second");
    expect(newState.proposals[2].epic.title).toBe("Epic 2");
    expect(newState.proposals[3].epic.title).toBe("Epic 3");
  });

  it("handles replacing last proposal", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 3);

    const newState = replaceProposals(
      state,
      [2],
      [makeProposal("New Last A"), makeProposal("New Last B")],
    );

    expect(newState.proposals).toHaveLength(4);
    expect(newState.proposals[0].epic.title).toBe("Epic 1");
    expect(newState.proposals[1].epic.title).toBe("Epic 2");
    expect(newState.proposals[2].epic.title).toBe("New Last A");
    expect(newState.proposals[3].epic.title).toBe("New Last B");
  });
});

// ─── formatActionMenu with granularity options ───────────────────────

describe("formatActionMenu granularity options", () => {
  it("includes break down option", () => {
    const state = createReviewState(makeProposals(5), 3);
    const menu = formatActionMenu(state);
    expect(menu).toContain("b#=break down");
  });

  it("includes consolidate option", () => {
    const state = createReviewState(makeProposals(5), 3);
    const menu = formatActionMenu(state);
    expect(menu).toContain("c#=consolidate");
  });
});

// ─── Granularity workflow integration ────────────────────────────────

describe("granularity adjustment workflow", () => {
  it("break down then accept workflow", () => {
    const proposals = makeProposals(3);
    let state = createReviewState(proposals, 3);

    // User requests break down of proposal 2
    const { granularityRequest } = applyAction(state, {
      kind: "break_down",
      indices: [1],
    });
    expect(granularityRequest).toBeDefined();

    // Simulate LLM returning 2 broken-down proposals
    const brokenDown = [
      makeProposal("Epic 2 Part A"),
      makeProposal("Epic 2 Part B"),
    ];
    state = replaceProposals(state, [1], brokenDown);
    expect(state.proposals).toHaveLength(4);
    expect(state.proposals[1].epic.title).toBe("Epic 2 Part A");
    expect(state.proposals[2].epic.title).toBe("Epic 2 Part B");

    // Accept all
    const { state: finalState, done } = applyAction(state, { kind: "accept_all" });
    expect(done).toBe(true);
    expect(getAcceptedProposals(finalState)).toHaveLength(4);
  });

  it("consolidate then accept workflow", () => {
    const proposals = makeProposals(5);
    let state = createReviewState(proposals, 5);

    // User requests consolidation of proposals 2, 3, 4
    const { granularityRequest } = applyAction(state, {
      kind: "consolidate",
      indices: [1, 2, 3],
    });
    expect(granularityRequest).toBeDefined();

    // Simulate LLM returning 1 consolidated proposal
    const consolidated = [makeProposal("Combined Epic")];
    state = replaceProposals(state, [1, 2, 3], consolidated);
    expect(state.proposals).toHaveLength(3);
    expect(state.proposals[0].epic.title).toBe("Epic 1");
    expect(state.proposals[1].epic.title).toBe("Combined Epic");
    expect(state.proposals[2].epic.title).toBe("Epic 5");

    // Accept all
    const { state: finalState, done } = applyAction(state, { kind: "accept_all" });
    expect(done).toBe(true);
    expect(getAcceptedProposals(finalState)).toHaveLength(3);
  });

  it("preserves selections across granularity adjustments", () => {
    const proposals = makeProposals(5);
    let state = createReviewState(proposals, 5);

    // Accept proposals 1 and 5
    state.accepted.add(0);
    state.accepted.add(4);

    // Replace proposal 3 with 2 broken-down proposals
    state = replaceProposals(state, [2], [
      makeProposal("Part A"),
      makeProposal("Part B"),
    ]);

    // Original acceptances should be preserved
    expect(state.accepted.has(0)).toBe(true); // Epic 1 still at 0
    // Epic 5 shifted from index 4 to index 5 (one extra proposal inserted)
    expect(state.accepted.has(5)).toBe(true);
    expect(state.accepted.size).toBe(2);
  });

  it("unknown action message mentions granularity commands", () => {
    const state = createReviewState(makeProposals(5), 3);
    const { message } = applyAction(state, { kind: "unknown" });
    expect(message).toContain("b#");
    expect(message).toContain("c#");
    expect(message).toContain("g");
  });
});

// ─── Granularity assessment ──────────────────────────────────────────

describe("parseChunkInput assess", () => {
  const state = createReviewState(makeProposals(5), 3);

  it("parses 'g' as assess", () => {
    expect(parseChunkInput("g", state).kind).toBe("assess");
  });

  it("parses 'assess' as assess", () => {
    expect(parseChunkInput("assess", state).kind).toBe("assess");
  });

  it("parses 'granularity' as assess", () => {
    expect(parseChunkInput("granularity", state).kind).toBe("assess");
  });
});

describe("applyAction assess", () => {
  it("returns assessRequested flag", () => {
    const state = createReviewState(makeProposals(5), 5);
    const { state: next, done, message, assessRequested } = applyAction(
      state,
      { kind: "assess" },
    );

    expect(done).toBe(false);
    expect(message).toContain("Assessing");
    expect(assessRequested).toBe(true);
    // State is unchanged — caller handles the assessment
    expect(next).toBe(state);
  });

  it("other actions do not return assessRequested", () => {
    const state = createReviewState(makeProposals(5), 5);
    const { assessRequested } = applyAction(state, { kind: "accept" });
    expect(assessRequested).toBeUndefined();
  });
});

describe("formatActionMenu assess option", () => {
  it("includes assess option", () => {
    const state = createReviewState(makeProposals(5), 3);
    const menu = formatActionMenu(state);
    expect(menu).toContain("g=assess");
  });
});

// ─── Batch granularity commands: parseChunkInput ─────────────────────

describe("parseChunkInput batch granularity commands", () => {
  const state = createReviewState(makeProposals(10), 5);

  it("parses 'ba' as break_down_chunk", () => {
    expect(parseChunkInput("ba", state).kind).toBe("break_down_chunk");
  });

  it("parses 'break all' as break_down_chunk", () => {
    expect(parseChunkInput("break all", state).kind).toBe("break_down_chunk");
  });

  it("parses 'break chunk' as break_down_chunk", () => {
    expect(parseChunkInput("break chunk", state).kind).toBe("break_down_chunk");
  });

  it("parses 'ca' as consolidate_chunk", () => {
    expect(parseChunkInput("ca", state).kind).toBe("consolidate_chunk");
  });

  it("parses 'consolidate all' as consolidate_chunk", () => {
    expect(parseChunkInput("consolidate all", state).kind).toBe("consolidate_chunk");
  });

  it("parses 'consolidate chunk' as consolidate_chunk", () => {
    expect(parseChunkInput("consolidate chunk", state).kind).toBe("consolidate_chunk");
  });

  it("parses 'apply' as apply", () => {
    expect(parseChunkInput("apply", state).kind).toBe("apply");
  });

  it("parses 'apply assessment' as apply", () => {
    expect(parseChunkInput("apply assessment", state).kind).toBe("apply");
  });
});

// ─── Batch granularity commands: applyAction ─────────────────────────

describe("applyAction batch granularity", () => {
  it("break_down_chunk returns granularity request for current chunk indices", () => {
    const state = createReviewState(makeProposals(10), 3);
    const { state: next, done, message, granularityRequest } = applyAction(
      state,
      { kind: "break_down_chunk" },
    );

    expect(done).toBe(false);
    expect(message).toContain("Breaking down all proposals in current chunk");
    expect(message).toContain("1, 2, 3");
    expect(granularityRequest).toBeDefined();
    expect(granularityRequest!.kind).toBe("break_down");
    expect(granularityRequest!.indices).toEqual([0, 1, 2]);
    // State is unchanged — caller handles replacement
    expect(next).toBe(state);
  });

  it("break_down_chunk uses correct indices on non-first page", () => {
    const state = { ...createReviewState(makeProposals(10), 3), offset: 6 };
    const { granularityRequest } = applyAction(
      state,
      { kind: "break_down_chunk" },
    );

    expect(granularityRequest!.indices).toEqual([6, 7, 8]);
  });

  it("consolidate_chunk returns granularity request for current chunk indices", () => {
    const state = createReviewState(makeProposals(10), 3);
    const { state: next, done, message, granularityRequest } = applyAction(
      state,
      { kind: "consolidate_chunk" },
    );

    expect(done).toBe(false);
    expect(message).toContain("Consolidating all proposals in current chunk");
    expect(message).toContain("1, 2, 3");
    expect(granularityRequest).toBeDefined();
    expect(granularityRequest!.kind).toBe("consolidate");
    expect(granularityRequest!.indices).toEqual([0, 1, 2]);
    expect(next).toBe(state);
  });

  it("consolidate_chunk handles partial last page", () => {
    const state = { ...createReviewState(makeProposals(7), 3), offset: 6 };
    const { granularityRequest } = applyAction(
      state,
      { kind: "consolidate_chunk" },
    );

    // Only one proposal on the last page
    expect(granularityRequest!.indices).toEqual([6]);
  });
});

// ─── Apply cached assessment ─────────────────────────────────────────

describe("applyAction apply", () => {
  it("returns error message when no assessment cached", () => {
    const state = createReviewState(makeProposals(5), 5);
    const { done, message, granularityRequest } = applyAction(
      state,
      { kind: "apply" },
    );

    expect(done).toBe(false);
    expect(message).toContain("No assessment available");
    expect(granularityRequest).toBeUndefined();
  });

  it("returns error message for empty assessment", () => {
    const state: ChunkReviewState = {
      ...createReviewState(makeProposals(5), 5),
      lastAssessment: [],
    };
    const { message, granularityRequest } = applyAction(
      state,
      { kind: "apply" },
    );

    expect(message).toContain("No assessment available");
    expect(granularityRequest).toBeUndefined();
  });

  it("returns message when all proposals are appropriately sized", () => {
    const state: ChunkReviewState = {
      ...createReviewState(makeProposals(3), 3),
      lastAssessment: [
        { proposalIndex: 0, epicTitle: "E1", recommendation: "keep", reasoning: "", issues: [] },
        { proposalIndex: 1, epicTitle: "E2", recommendation: "keep", reasoning: "", issues: [] },
        { proposalIndex: 2, epicTitle: "E3", recommendation: "keep", reasoning: "", issues: [] },
      ],
    };
    const { message, granularityRequest } = applyAction(
      state,
      { kind: "apply" },
    );

    expect(message).toContain("no proposals needing adjustment");
    expect(granularityRequest).toBeUndefined();
  });

  it("applies break_down recommendations first", () => {
    const state: ChunkReviewState = {
      ...createReviewState(makeProposals(5), 5),
      lastAssessment: [
        { proposalIndex: 0, epicTitle: "E1", recommendation: "keep", reasoning: "", issues: [] },
        { proposalIndex: 1, epicTitle: "E2", recommendation: "break_down", reasoning: "too broad", issues: ["issue1"] },
        { proposalIndex: 2, epicTitle: "E3", recommendation: "consolidate", reasoning: "too fine", issues: ["issue2"] },
        { proposalIndex: 3, epicTitle: "E4", recommendation: "break_down", reasoning: "too broad", issues: ["issue3"] },
        { proposalIndex: 4, epicTitle: "E5", recommendation: "keep", reasoning: "", issues: [] },
      ],
    };
    const { message, granularityRequest } = applyAction(
      state,
      { kind: "apply" },
    );

    expect(message).toContain("breaking down");
    expect(message).toContain("2, 4");
    expect(granularityRequest).toBeDefined();
    expect(granularityRequest!.kind).toBe("break_down");
    expect(granularityRequest!.indices).toEqual([1, 3]);
  });

  it("applies consolidate recommendations when no break_down", () => {
    const state: ChunkReviewState = {
      ...createReviewState(makeProposals(5), 5),
      lastAssessment: [
        { proposalIndex: 0, epicTitle: "E1", recommendation: "keep", reasoning: "", issues: [] },
        { proposalIndex: 1, epicTitle: "E2", recommendation: "consolidate", reasoning: "too fine", issues: [] },
        { proposalIndex: 2, epicTitle: "E3", recommendation: "consolidate", reasoning: "too fine", issues: [] },
      ],
    };
    const { message, granularityRequest } = applyAction(
      state,
      { kind: "apply" },
    );

    expect(message).toContain("consolidating");
    expect(message).toContain("2, 3");
    expect(granularityRequest).toBeDefined();
    expect(granularityRequest!.kind).toBe("consolidate");
    expect(granularityRequest!.indices).toEqual([1, 2]);
  });

  it("filters out-of-range assessment indices", () => {
    const state: ChunkReviewState = {
      ...createReviewState(makeProposals(3), 3),
      lastAssessment: [
        { proposalIndex: 0, epicTitle: "E1", recommendation: "break_down", reasoning: "", issues: [] },
        { proposalIndex: 99, epicTitle: "E99", recommendation: "break_down", reasoning: "", issues: [] },
      ],
    };
    const { granularityRequest } = applyAction(
      state,
      { kind: "apply" },
    );

    expect(granularityRequest!.indices).toEqual([0]);
  });
});

// ─── Granularity history tracking in replaceProposals ────────────────

describe("replaceProposals granularity history", () => {
  it("records break_down in granularity history", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);

    const replacements = [makeProposal("Part A"), makeProposal("Part B")];
    const newState = replaceProposals(state, [2], replacements, "break_down");

    expect(newState.granularityHistory).toHaveLength(1);
    expect(newState.granularityHistory[0].direction).toBe("break_down");
    expect(newState.granularityHistory[0].originalTitles).toEqual(["Epic 3"]);
    expect(newState.granularityHistory[0].resultTitles).toEqual(["Part A", "Part B"]);
    expect(newState.granularityHistory[0].timestamp).toBeDefined();
  });

  it("records consolidate in granularity history", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);

    const replacements = [makeProposal("Combined")];
    const newState = replaceProposals(state, [1, 2, 3], replacements, "consolidate");

    expect(newState.granularityHistory).toHaveLength(1);
    expect(newState.granularityHistory[0].direction).toBe("consolidate");
    expect(newState.granularityHistory[0].originalTitles).toEqual(["Epic 2", "Epic 3", "Epic 4"]);
    expect(newState.granularityHistory[0].resultTitles).toEqual(["Combined"]);
  });

  it("accumulates history across multiple adjustments", () => {
    const proposals = makeProposals(5);
    let state = createReviewState(proposals, 5);

    // First adjustment: break down proposal 3
    state = replaceProposals(state, [2], [makeProposal("A"), makeProposal("B")], "break_down");
    expect(state.granularityHistory).toHaveLength(1);

    // Second adjustment: consolidate proposals 1 and 2
    state = replaceProposals(state, [0, 1], [makeProposal("Merged")], "consolidate");
    expect(state.granularityHistory).toHaveLength(2);
    expect(state.granularityHistory[0].direction).toBe("break_down");
    expect(state.granularityHistory[1].direction).toBe("consolidate");
  });

  it("does not record history when direction is omitted", () => {
    const proposals = makeProposals(5);
    const state = createReviewState(proposals, 5);

    const newState = replaceProposals(state, [2], [makeProposal("New")]);
    expect(newState.granularityHistory).toHaveLength(0);
  });

  it("clears lastAssessment after replacing proposals", () => {
    const state: ChunkReviewState = {
      ...createReviewState(makeProposals(5), 5),
      lastAssessment: [
        { proposalIndex: 0, epicTitle: "E1", recommendation: "keep", reasoning: "", issues: [] },
      ],
    };

    const newState = replaceProposals(state, [0], [makeProposal("New")], "break_down");
    expect(newState.lastAssessment).toBeUndefined();
  });

  it("preserves granularity history across replaceProposals calls", () => {
    const proposals = makeProposals(5);
    let state = createReviewState(proposals, 5);

    state = replaceProposals(state, [0], [makeProposal("R1"), makeProposal("R2")], "break_down");
    expect(state.granularityHistory).toHaveLength(1);

    // History from first call should persist through second
    state = replaceProposals(state, [3], [makeProposal("R3")], "consolidate");
    expect(state.granularityHistory).toHaveLength(2);
    // Verify first entry is still there
    expect(state.granularityHistory[0].direction).toBe("break_down");
    expect(state.granularityHistory[0].originalTitles).toEqual(["Epic 1"]);
  });
});

// ─── Granularity tracking in batch records ───────────────────────────

describe("buildBatchRecord granularity tracking", () => {
  it("includes granularity adjustments when present", () => {
    const proposals = makeProposals(5);
    let state = createReviewState(proposals, 5);
    state = replaceProposals(state, [2], [makeProposal("Part A"), makeProposal("Part B")], "break_down");
    state.accepted.add(0);
    state.accepted.add(1);

    const record = buildBatchRecord(state);
    expect(record.granularityAdjustments).toBeDefined();
    expect(record.granularityAdjustments).toHaveLength(1);
    expect(record.granularityAdjustments![0].direction).toBe("break_down");
    expect(record.granularityAdjustments![0].originalTitles).toEqual(["Epic 3"]);
  });

  it("omits granularityAdjustments when no adjustments made", () => {
    const proposals = makeProposals(3);
    const state = createReviewState(proposals, 3);
    state.accepted.add(0);

    const record = buildBatchRecord(state);
    expect(record.granularityAdjustments).toBeUndefined();
  });

  it("includes multiple adjustments in batch record", () => {
    const proposals = makeProposals(5);
    let state = createReviewState(proposals, 5);
    state = replaceProposals(state, [0], [makeProposal("A1"), makeProposal("A2")], "break_down");
    state = replaceProposals(state, [3, 4], [makeProposal("C1")], "consolidate");
    state.accepted.add(0);

    const record = buildBatchRecord(state);
    expect(record.granularityAdjustments).toHaveLength(2);
    expect(record.granularityAdjustments![0].direction).toBe("break_down");
    expect(record.granularityAdjustments![1].direction).toBe("consolidate");
  });
});

// ─── formatBatchSummary with granularity adjustments ─────────────────

describe("formatBatchSummary granularity", () => {
  it("shows granularity adjustments section when present", () => {
    const record: BatchAcceptanceRecord = {
      timestamp: "2026-02-06T00:00:00.000Z",
      totalProposals: 5,
      acceptedCount: 3,
      rejectedCount: 2,
      acceptedItemCount: 9,
      accepted: ["Auth", "Dashboard", "Settings"],
      rejected: ["Analytics", "Billing"],
      mode: "interactive",
      granularityAdjustments: [
        {
          direction: "break_down",
          originalTitles: ["Auth"],
          resultTitles: ["Auth Login", "Auth Signup"],
          timestamp: "2026-02-06T00:00:00.000Z",
        },
      ],
    };

    const summary = formatBatchSummary(record);
    expect(summary).toContain("1 granularity adjustment");
    expect(summary).toContain("⬇");
    expect(summary).toContain("broke down");
    expect(summary).toContain("Auth → Auth Login, Auth Signup");
  });

  it("shows plural label for multiple adjustments", () => {
    const record: BatchAcceptanceRecord = {
      timestamp: "2026-02-06T00:00:00.000Z",
      totalProposals: 5,
      acceptedCount: 5,
      rejectedCount: 0,
      acceptedItemCount: 15,
      accepted: ["A", "B", "C", "D", "E"],
      rejected: [],
      mode: "interactive",
      granularityAdjustments: [
        {
          direction: "break_down",
          originalTitles: ["A"],
          resultTitles: ["A1", "A2"],
          timestamp: "2026-02-06T00:00:00.000Z",
        },
        {
          direction: "consolidate",
          originalTitles: ["B", "C"],
          resultTitles: ["BC"],
          timestamp: "2026-02-06T00:00:00.000Z",
        },
      ],
    };

    const summary = formatBatchSummary(record);
    expect(summary).toContain("2 granularity adjustments");
    expect(summary).toContain("⬇");
    expect(summary).toContain("⬆");
    expect(summary).toContain("broke down A → A1, A2");
    expect(summary).toContain("consolidated B, C → BC");
  });

  it("omits granularity section when no adjustments", () => {
    const record: BatchAcceptanceRecord = {
      timestamp: "2026-02-06T00:00:00.000Z",
      totalProposals: 3,
      acceptedCount: 3,
      rejectedCount: 0,
      acceptedItemCount: 9,
      accepted: ["Auth", "Dashboard", "Settings"],
      rejected: [],
      mode: "interactive",
    };

    const summary = formatBatchSummary(record);
    expect(summary).not.toContain("Granularity");
    expect(summary).not.toContain("adjustment");
  });
});

// ─── formatActionMenu with batch commands ────────────────────────────

describe("formatActionMenu batch granularity options", () => {
  it("includes break chunk option", () => {
    const state = createReviewState(makeProposals(5), 3);
    const menu = formatActionMenu(state);
    expect(menu).toContain("ba=break chunk");
  });

  it("includes consolidate chunk option", () => {
    const state = createReviewState(makeProposals(5), 3);
    const menu = formatActionMenu(state);
    expect(menu).toContain("ca=consolidate chunk");
  });

  it("shows apply option when assessment is cached", () => {
    const state: ChunkReviewState = {
      ...createReviewState(makeProposals(5), 3),
      lastAssessment: [
        { proposalIndex: 0, epicTitle: "E1", recommendation: "break_down", reasoning: "", issues: [] },
      ],
    };
    const menu = formatActionMenu(state);
    expect(menu).toContain("apply=apply assessment");
  });

  it("hides apply option when no assessment cached", () => {
    const state = createReviewState(makeProposals(5), 3);
    const menu = formatActionMenu(state);
    expect(menu).not.toContain("apply=apply assessment");
  });

  it("hides apply option when assessment is empty", () => {
    const state: ChunkReviewState = {
      ...createReviewState(makeProposals(5), 3),
      lastAssessment: [],
    };
    const menu = formatActionMenu(state);
    expect(menu).not.toContain("apply=apply assessment");
  });
});

// ─── createReviewState includes granularityHistory ───────────────────

describe("createReviewState granularity fields", () => {
  it("initializes with empty granularity history", () => {
    const state = createReviewState(makeProposals(5));
    expect(state.granularityHistory).toEqual([]);
  });

  it("initializes without lastAssessment", () => {
    const state = createReviewState(makeProposals(5));
    expect(state.lastAssessment).toBeUndefined();
  });
});

// ─── End-to-end batch granularity workflow ────────────────────────────

describe("batch granularity workflow", () => {
  it("assess → apply → accept workflow", () => {
    const proposals = makeProposals(5);
    let state = createReviewState(proposals, 5);

    // Simulate assessment cached
    state = {
      ...state,
      lastAssessment: [
        { proposalIndex: 0, epicTitle: "Epic 1", recommendation: "keep", reasoning: "", issues: [] },
        { proposalIndex: 1, epicTitle: "Epic 2", recommendation: "break_down", reasoning: "too broad", issues: [] },
        { proposalIndex: 2, epicTitle: "Epic 3", recommendation: "keep", reasoning: "", issues: [] },
        { proposalIndex: 3, epicTitle: "Epic 4", recommendation: "consolidate", reasoning: "too fine", issues: [] },
        { proposalIndex: 4, epicTitle: "Epic 5", recommendation: "keep", reasoning: "", issues: [] },
      ],
    };

    // Apply: should break down first
    const { granularityRequest: req1 } = applyAction(state, { kind: "apply" });
    expect(req1!.kind).toBe("break_down");
    expect(req1!.indices).toEqual([1]);

    // Simulate LLM break down
    state = replaceProposals(state, [1], [makeProposal("E2a"), makeProposal("E2b")], "break_down");
    expect(state.granularityHistory).toHaveLength(1);
    // Assessment should be cleared
    expect(state.lastAssessment).toBeUndefined();

    // Accept all
    const { state: finalState, done } = applyAction(state, { kind: "accept_all" });
    expect(done).toBe(true);
    expect(getAcceptedProposals(finalState)).toHaveLength(6);

    // Build batch record includes history
    const record = buildBatchRecord(finalState);
    expect(record.granularityAdjustments).toHaveLength(1);
    expect(record.granularityAdjustments![0].direction).toBe("break_down");
  });

  it("break chunk → navigate → consolidate chunk workflow", () => {
    const proposals = makeProposals(10);
    let state = createReviewState(proposals, 3);

    // Break down current chunk (0-2)
    const { granularityRequest: req1 } = applyAction(state, { kind: "break_down_chunk" });
    expect(req1!.indices).toEqual([0, 1, 2]);

    // Simulate LLM returning 6 proposals (2 per original)
    const broken = Array.from({ length: 6 }, (_, i) => makeProposal(`Broken ${i + 1}`));
    state = replaceProposals(state, [0, 1, 2], broken, "break_down");
    expect(state.proposals).toHaveLength(13);

    // Navigate to next chunk
    const { state: navState } = applyAction(state, { kind: "next" });
    state = navState;
    expect(state.offset).toBe(3);

    // Consolidate current chunk (3-5)
    const { granularityRequest: req2 } = applyAction(state, { kind: "consolidate_chunk" });
    expect(req2!.indices).toEqual([3, 4, 5]);

    // Simulate LLM consolidation
    state = replaceProposals(state, [3, 4, 5], [makeProposal("Consolidated")], "consolidate");

    // Verify history
    expect(state.granularityHistory).toHaveLength(2);
    expect(state.granularityHistory[0].direction).toBe("break_down");
    expect(state.granularityHistory[1].direction).toBe("consolidate");

    // Accept all
    const { state: final } = applyAction(state, { kind: "accept_all" });
    const record = buildBatchRecord(final);
    expect(record.granularityAdjustments).toHaveLength(2);
  });

  it("unknown action message includes new commands", () => {
    const state = createReviewState(makeProposals(5), 3);
    const { message } = applyAction(state, { kind: "unknown" });
    expect(message).toContain("ba");
    expect(message).toContain("ca");
    expect(message).toContain("apply");
  });
});

// ─── Natural language modification detection ──────────────────────────

describe("parseChunkInput natural language modification", () => {
  const state = createReviewState(makeProposals(5), 3);

  it("detects 'add a caching feature' as modify", () => {
    const action = parseChunkInput("add a caching feature", state);
    expect(action.kind).toBe("modify");
    if (action.kind === "modify") {
      expect(action.request).toBe("add a caching feature");
    }
  });

  it("detects 'remove the login task' as modify", () => {
    const action = parseChunkInput("remove the login task", state);
    expect(action.kind).toBe("modify");
    if (action.kind === "modify") {
      expect(action.request).toBe("remove the login task");
    }
  });

  it("detects 'change priority of auth tasks to high' as modify", () => {
    const action = parseChunkInput("change priority of auth tasks to high", state);
    expect(action.kind).toBe("modify");
    if (action.kind === "modify") {
      expect(action.request).toBe("change priority of auth tasks to high");
    }
  });

  it("detects 'split the auth epic into separate login and signup epics' as modify", () => {
    const action = parseChunkInput("split the auth epic into separate login and signup epics", state);
    expect(action.kind).toBe("modify");
    if (action.kind === "modify") {
      expect(action.request).toBe("split the auth epic into separate login and signup epics");
    }
  });

  it("detects 'merge the first two proposals together' as modify", () => {
    const action = parseChunkInput("merge the first two proposals together", state);
    expect(action.kind).toBe("modify");
    if (action.kind === "modify") {
      expect(action.request).toBe("merge the first two proposals together");
    }
  });

  it("preserves exact user input in the request field", () => {
    const input = "  Add a new feature for error handling  ";
    const action = parseChunkInput(input, state);
    expect(action.kind).toBe("modify");
    if (action.kind === "modify") {
      // Input is trimmed
      expect(action.request).toBe("Add a new feature for error handling");
    }
  });

  it("does not treat standard commands as modify", () => {
    // These should retain their original behavior, not be treated as NL
    expect(parseChunkInput("a", state).kind).toBe("accept");
    expect(parseChunkInput("n", state).kind).toBe("next");
    expect(parseChunkInput("p", state).kind).toBe("prev");
    expect(parseChunkInput("d", state).kind).toBe("done");
    expect(parseChunkInput("A", state).kind).toBe("accept_all");
    expect(parseChunkInput("R", state).kind).toBe("reject_all");
    expect(parseChunkInput("b1", state).kind).toBe("break_down");
    expect(parseChunkInput("c1,2", state).kind).toBe("consolidate");
    expect(parseChunkInput("1,3", state).kind).toBe("select");
    expect(parseChunkInput("g", state).kind).toBe("assess");
    expect(parseChunkInput("ba", state).kind).toBe("break_down_chunk");
    expect(parseChunkInput("ca", state).kind).toBe("consolidate_chunk");
    expect(parseChunkInput("apply", state).kind).toBe("apply");
  });

  it("returns unknown for very short unrecognized input", () => {
    // Single word without NL verb should still be unknown
    expect(parseChunkInput("xyz", state).kind).toBe("unknown");
    expect(parseChunkInput("", state).kind).toBe("unknown");
    expect(parseChunkInput("  ", state).kind).toBe("unknown");
    expect(parseChunkInput("hi", state).kind).toBe("unknown");
  });
});

// ─── applyAction modify ──────────────────────────────────────────────

describe("applyAction modify", () => {
  it("returns modificationRequest with the user's text", () => {
    const state = createReviewState(makeProposals(5), 5);
    const { state: next, done, message, modificationRequest } = applyAction(
      state,
      { kind: "modify", request: "add a caching feature" },
    );

    expect(done).toBe(false);
    expect(message).toContain("Modifying proposals");
    expect(modificationRequest).toBe("add a caching feature");
    // State is unchanged — caller handles the LLM call
    expect(next).toBe(state);
  });

  it("other actions do not return modificationRequest", () => {
    const state = createReviewState(makeProposals(5), 5);
    const { modificationRequest } = applyAction(state, { kind: "accept" });
    expect(modificationRequest).toBeUndefined();
  });
});

// ─── formatActionMenu includes modify hint ───────────────────────────

describe("formatActionMenu modify hint", () => {
  it("includes natural language hint in action menu", () => {
    const state = createReviewState(makeProposals(5), 3);
    const menu = formatActionMenu(state);
    expect(menu).toContain("or type a change");
  });
});
