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
} from "../../../../src/cli/commands/chunked-review.js";
import type {
  ChunkReviewState,
  ChunkAction,
} from "../../../../src/cli/commands/chunked-review.js";
import type { Proposal } from "../../../../src/analyze/index.js";

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
