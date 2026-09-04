/**
 * Tests for `src/server/prd-refinement.ts` — the parse/diff/apply half of the
 * Ask panel's refine mode.
 *
 * The properties under test are the ones the review surface rests on: the
 * "before" side of every diff comes from the document rather than from the
 * model, a proposal only lists the fields it actually changes, and a proposal
 * whose subject moved on since the answer was generated is refused rather than
 * applied over the top of whoever moved it.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_REFINEMENT_PROPOSALS,
  REFINEMENT_FENCE_TAG,
  applyRefinements,
  describeRefinement,
  itemFingerprint,
  parseAnswerRefinements,
  renderPrdContext,
  splitRefinementBlock,
} from "../../../src/server/prd-refinement.js";
import type { EditRefinement, RefinementProposal } from "../../../src/server/prd-refinement.js";
import type { PRDDocument, PRDItem } from "../../../src/server/rex-gateway.js";

/**
 * Two sibling tasks under one epic, plus a second epic to move things between.
 *
 * `task-a` carries a description and criteria so an edit has something to
 * replace; `task-b` is deliberately near-identical so a merge is legal.
 */
function makeDoc(): PRDDocument {
  return {
    schema: "rex/v1",
    title: "Test Project",
    items: [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "task-a",
            title: "Add the Ask panel",
            level: "task",
            status: "pending",
            priority: "medium",
            description: "Original description.",
            acceptanceCriteria: ["The panel renders", "The panel submits"],
          },
          {
            id: "task-b",
            title: "Add an Ask panel",
            level: "task",
            status: "pending",
            priority: "low",
            description: "A duplicate of the one above.",
            // One criterion overlaps with task-a's and one does not, so a merge
            // has both something to add and something to deduplicate.
            acceptanceCriteria: ["The panel renders", "The panel reports errors"],
          },
        ],
      },
      { id: "epic-2", title: "Epic Two", level: "epic", status: "pending", children: [] },
    ] as PRDItem[],
  };
}

/** Wrap raw proposal JSON in the fenced block the model is asked for. */
function block(json: unknown, prose = "Here is what I would change.\n\n"): string {
  return `${prose}\`\`\`${REFINEMENT_FENCE_TAG}\n${JSON.stringify(json)}\n\`\`\``;
}

/** Find an item anywhere in the tree. */
function find(doc: PRDDocument, id: string): PRDItem | undefined {
  const stack = [...doc.items];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.id === id) return item;
    if (item.children) stack.push(...item.children);
  }
  return undefined;
}

describe("splitRefinementBlock", () => {
  it("lifts the block out of the prose the user reads", () => {
    const { prose, block: raw } = splitRefinementBlock(block([{ op: "edit" }], "Prose here.\n\n"));
    expect(prose).toBe("Prose here.");
    expect(raw).toContain('"op":"edit"');
  });

  it("leaves an answer with no block untouched", () => {
    const answer = "Just prose, and a ```js\nconst x = 1;\n``` fence that is not ours.";
    expect(splitRefinementBlock(answer)).toEqual({ prose: answer, block: null });
  });

  it("takes the last block when the model restates its output", () => {
    const answer = `\`\`\`${REFINEMENT_FENCE_TAG}\n[{"op":"edit","itemId":"first"}]\n\`\`\`\n`
      + `Actually:\n\`\`\`${REFINEMENT_FENCE_TAG}\n[{"op":"edit","itemId":"second"}]\n\`\`\``;
    const { prose, block: raw } = splitRefinementBlock(answer);
    expect(raw).toContain("second");
    expect(raw).not.toContain("first");
    // Both blocks leave the prose, not just the one that won: a stale block
    // rendered as text under a diff built from a different one is worse than
    // no block at all.
    expect(prose).toBe("Actually:");
  });
});

describe("renderPrdContext", () => {
  it("names every item by id, because a proposal is matched back by id", () => {
    const lines = renderPrdContext(makeDoc()).join("\n");
    expect(lines).toContain("`task-a`");
    expect(lines).toContain("`task-b`");
    expect(lines).toContain("Original description.");
    expect(lines).toContain("The panel submits");
    // Placement is stated, so a reparent proposal can be judged against it.
    expect(lines).toContain("parent: `epic-1`");
    expect(lines).toContain("parent: (top level)");
  });

  it("renders nothing for an empty PRD", () => {
    expect(renderPrdContext({ schema: "rex/v1", title: "Empty", items: [] })).toEqual([]);
  });
});

describe("parseAnswerRefinements — edits", () => {
  it("takes the before side from the document, not from the model", () => {
    const doc = makeDoc();
    const { proposals } = parseAnswerRefinements(
      block([{
        op: "edit",
        itemId: "task-a",
        description: "A sharper description.",
        // The model's idea of the current text is deliberately wrong. It must
        // not reach the diff: a misquoted "before" is a diff that understates
        // what accepting it would destroy.
        currentDescription: "Something the item never said.",
        rationale: "The original does not say what done looks like.",
      }]),
      doc,
    );

    expect(proposals).toHaveLength(1);
    const diff = proposals[0].diffs.find((d) => d.field === "description");
    expect(diff?.before).toEqual(["Original description."]);
    expect(diff?.after).toEqual(["A sharper description."]);
  });

  it("lists exactly the fields it changes and no others", () => {
    const doc = makeDoc();
    const { proposals } = parseAnswerRefinements(
      block([{
        op: "edit",
        itemId: "task-a",
        // Repeated unchanged — must not appear as a diff.
        description: "Original description.",
        priority: "high",
      }]),
      doc,
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0].diffs.map((d) => d.field)).toEqual(["priority"]);
    expect((proposals[0] as EditRefinement).updates).toEqual({ priority: "high" });
  });

  it("drops a proposal that changes nothing, and says why", () => {
    const doc = makeDoc();
    const { proposals, notes } = parseAnswerRefinements(
      block([{ op: "edit", itemId: "task-a", description: "Original description." }]),
      doc,
    );
    expect(proposals).toEqual([]);
    expect(notes.join(" ")).toContain("already there");
  });

  it("refuses a priority the schema does not define", () => {
    const doc = makeDoc();
    const { proposals, notes } = parseAnswerRefinements(
      block([{ op: "edit", itemId: "task-a", priority: "urgent" }]),
      doc,
    );
    expect(proposals).toEqual([]);
    expect(notes.join(" ")).toContain("not a valid priority");
  });

  it("drops a proposal against an id that is not in the PRD", () => {
    const { proposals, notes } = parseAnswerRefinements(
      block([{ op: "edit", itemId: "invented", description: "x" }]),
      makeDoc(),
    );
    expect(proposals).toEqual([]);
    expect(notes.join(" ")).toContain("unknown item");
  });

  it("reports a malformed block instead of pretending there was none", () => {
    const answer = `Prose.\n\n\`\`\`${REFINEMENT_FENCE_TAG}\n{not json\n\`\`\``;
    const { proposals, notes } = parseAnswerRefinements(answer, makeDoc());
    expect(proposals).toEqual([]);
    expect(notes.join(" ")).toContain("not valid JSON");
  });

  it("caps the batch and says the rest were dropped", () => {
    const doc = makeDoc();
    const many = Array.from({ length: MAX_REFINEMENT_PROPOSALS + 3 }, (_unused, i) => ({
      op: "edit",
      itemId: "task-a",
      description: `Rewrite number ${i}.`,
    }));
    const { proposals, notes } = parseAnswerRefinements(block(many), doc);
    expect(proposals).toHaveLength(MAX_REFINEMENT_PROPOSALS);
    expect(notes.join(" ")).toContain(`first ${MAX_REFINEMENT_PROPOSALS}`);
  });
});

describe("parseAnswerRefinements — reparent and merge", () => {
  it("diffs a reparent by the parent it names, not by the id", () => {
    const { proposals } = parseAnswerRefinements(
      block([{ op: "reparent", itemId: "task-a", parentId: "epic-2" }]),
      makeDoc(),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].diffs).toEqual([
      { field: "parent", before: ["Epic One"], after: ["Epic Two"] },
    ]);
  });

  it("refuses a move that would put an item under a level that cannot hold it", () => {
    const { proposals, notes } = parseAnswerRefinements(
      block([{ op: "reparent", itemId: "epic-1", parentId: "task-a" }]),
      makeDoc(),
    );
    expect(proposals).toEqual([]);
    expect(notes.join(" ")).toMatch(/cannot sit under|cannot be moved under/);
  });

  it("refuses a move into the item's own subtree", () => {
    const { proposals, notes } = parseAnswerRefinements(
      block([{ op: "reparent", itemId: "epic-1", parentId: "epic-1" }]),
      makeDoc(),
    );
    expect(proposals).toEqual([]);
    expect(notes.join(" ")).toContain("its own parent");
  });

  it("diffs a merge on the item that survives", () => {
    const { proposals } = parseAnswerRefinements(
      block([{ op: "merge", itemId: "task-b", intoId: "task-a" }]),
      makeDoc(),
    );
    expect(proposals).toHaveLength(1);
    const criteria = proposals[0].diffs.find((d) => d.field === "acceptanceCriteria");
    // task-a's own two criteria are the before; the merge adds task-b's unique
    // one, and the criterion they share is not doubled up.
    expect(criteria?.before).toEqual(["The panel renders", "The panel submits"]);
    expect(criteria?.after).toContain("The panel reports errors");
    expect(criteria?.after.filter((c) => c === "The panel renders")).toHaveLength(1);
    // The absorbed item's description is folded into the survivor's, so that
    // field is part of what the user is approving too.
    const description = proposals[0].diffs.find((d) => d.field === "description");
    expect(description?.before).toEqual(["Original description."]);
    expect(description?.after.join(" ")).toContain("A duplicate of the one above.");
  });

  it("lists no field diff when the merge changes nothing on the survivor", () => {
    const doc = makeDoc();
    // The duplicate carries nothing the survivor does not already have, so the
    // only effect of the merge is that the duplicate goes away. The card says
    // so rather than rendering an empty diff.
    const taskB = find(doc, "task-b")!;
    taskB.description = undefined;
    taskB.acceptanceCriteria = ["The panel renders"];

    const { proposals } = parseAnswerRefinements(
      block([{ op: "merge", itemId: "task-b", intoId: "task-a" }]),
      doc,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].diffs).toEqual([]);
  });

  it("refuses a merge between items that are not siblings", () => {
    const { proposals, notes } = parseAnswerRefinements(
      block([{ op: "merge", itemId: "task-a", intoId: "epic-2" }]),
      makeDoc(),
    );
    expect(proposals).toEqual([]);
    expect(notes.join(" ")).toMatch(/same level|siblings/);
  });
});

describe("applyRefinements", () => {
  /** Generate proposals against one document, to apply against another. */
  function proposalsFor(doc: PRDDocument, raw: unknown[]): RefinementProposal[] {
    return parseAnswerRefinements(block(raw), doc).proposals;
  }

  it("applies an edit to the item it names", () => {
    const doc = makeDoc();
    const proposals = proposalsFor(doc, [{
      op: "edit",
      itemId: "task-a",
      description: "A sharper description.",
      acceptanceCriteria: ["Exactly one criterion"],
    }]);

    const outcomes = applyRefinements(doc, proposals);
    expect(outcomes).toEqual([{ id: "r1", itemId: "task-a", status: "applied" }]);
    expect(find(doc, "task-a")?.description).toBe("A sharper description.");
    expect(find(doc, "task-a")?.acceptanceCriteria).toEqual(["Exactly one criterion"]);
  });

  it("refuses an edit whose item changed after the answer was generated", () => {
    const generatedAgainst = makeDoc();
    const proposals = proposalsFor(generatedAgainst, [{
      op: "edit",
      itemId: "task-a",
      description: "A sharper description.",
    }]);

    // Another writer got there first. This is the whole point of the
    // fingerprint: applying over the top would silently revert their work.
    const onDisk = makeDoc();
    find(onDisk, "task-a")!.description = "Someone else rewrote this.";

    const outcomes = applyRefinements(onDisk, proposals);
    expect(outcomes[0].status).toBe("stale");
    expect(outcomes[0].detail).toContain("changed since this proposal was generated");
    expect(find(onDisk, "task-a")?.description).toBe("Someone else rewrote this.");
  });

  it("ignores changes to items the proposal does not touch", () => {
    const generatedAgainst = makeDoc();
    const proposals = proposalsFor(generatedAgainst, [{
      op: "edit", itemId: "task-a", priority: "high",
    }]);

    const onDisk = makeDoc();
    find(onDisk, "task-b")!.description = "Unrelated edit elsewhere.";

    expect(applyRefinements(onDisk, proposals)[0].status).toBe("applied");
    expect(find(onDisk, "task-a")?.priority).toBe("high");
  });

  it("refuses a reparent whose item has already been moved", () => {
    const generatedAgainst = makeDoc();
    const proposals = proposalsFor(generatedAgainst, [{
      op: "reparent", itemId: "task-a", parentId: "epic-2",
    }]);

    // Someone else moved it there first. The content fingerprint still holds —
    // the item's text did not change — so this must be caught by the parent
    // check, not by the fingerprint.
    const onDisk = makeDoc();
    const moved = onDisk.items[0].children!.splice(0, 1)[0];
    onDisk.items[1].children!.push(moved);

    const outcomes = applyRefinements(onDisk, proposals);
    expect(outcomes[0].status).toBe("stale");
    expect(outcomes[0].detail).toContain("already been moved");
  });

  it("applies a reparent, and the item leaves its old parent", () => {
    const doc = makeDoc();
    const proposals = proposalsFor(doc, [{
      op: "reparent", itemId: "task-a", parentId: "epic-2",
    }]);
    expect(applyRefinements(doc, proposals)[0].status).toBe("applied");
    expect(doc.items[0].children?.map((c) => c.id)).toEqual(["task-b"]);
    expect(doc.items[1].children?.map((c) => c.id)).toEqual(["task-a"]);
  });

  it("applies a merge, removing the absorbed sibling", () => {
    const doc = makeDoc();
    const proposals = proposalsFor(doc, [{ op: "merge", itemId: "task-b", intoId: "task-a" }]);
    expect(applyRefinements(doc, proposals)[0].status).toBe("applied");
    expect(find(doc, "task-b")).toBeUndefined();
    expect(find(doc, "task-a")?.acceptanceCriteria).toContain("The panel submits");
  });

  it("refuses a merge whose surviving sibling changed, not only the absorbed one", () => {
    const generatedAgainst = makeDoc();
    const proposals = proposalsFor(generatedAgainst, [
      { op: "merge", itemId: "task-b", intoId: "task-a" },
    ]);

    // The merge combines both items' content, so the reviewed result depends on
    // the survivor's text as much as on the duplicate's.
    const onDisk = makeDoc();
    find(onDisk, "task-a")!.acceptanceCriteria = ["Something else entirely"];

    const outcomes = applyRefinements(onDisk, proposals);
    expect(outcomes[0].status).toBe("stale");
    expect(find(onDisk, "task-b")).toBeDefined();
  });

  it("refuses a proposal whose item was deleted", () => {
    const generatedAgainst = makeDoc();
    const proposals = proposalsFor(generatedAgainst, [{
      op: "edit", itemId: "task-a", priority: "high",
    }]);

    const onDisk = makeDoc();
    onDisk.items[0].children = onDisk.items[0].children!.filter((c) => c.id !== "task-a");

    const outcomes = applyRefinements(onDisk, proposals);
    expect(outcomes[0].status).toBe("stale");
    expect(outcomes[0].detail).toContain("no longer in the PRD");
  });

  it("keeps applying the rest of a batch when one goes stale", () => {
    const generatedAgainst = makeDoc();
    const proposals = proposalsFor(generatedAgainst, [
      { op: "edit", itemId: "task-a", priority: "high" },
      { op: "edit", itemId: "task-b", priority: "high" },
    ]);

    const onDisk = makeDoc();
    find(onDisk, "task-a")!.description = "Changed by someone else.";

    const outcomes = applyRefinements(onDisk, proposals);
    expect(outcomes.map((o) => o.status)).toEqual(["stale", "applied"]);
    expect(find(onDisk, "task-b")?.priority).toBe("high");
  });
});

describe("itemFingerprint", () => {
  it("changes with content and not with placement or status", () => {
    const base: PRDItem = {
      id: "x", title: "T", level: "task", status: "pending", description: "d",
    };
    const original = itemFingerprint(base);

    expect(itemFingerprint({ ...base, status: "completed" })).toBe(original);
    expect(itemFingerprint({ ...base, tags: ["new"] })).toBe(original);
    expect(itemFingerprint({ ...base, description: "d2" })).not.toBe(original);
    expect(itemFingerprint({ ...base, priority: "high" })).not.toBe(original);
  });

  it("cannot be forged by a value containing the field separator", () => {
    const a: PRDItem = { id: "x", title: "A", level: "task", status: "pending", description: "B" };
    const b: PRDItem = { id: "x", title: "A B", level: "task", status: "pending" };
    expect(itemFingerprint(a)).not.toBe(itemFingerprint(b));
  });
});

describe("describeRefinement", () => {
  it("names the operation and the item for the execution log", () => {
    const doc = makeDoc();
    const { proposals } = parseAnswerRefinements(
      block([
        { op: "edit", itemId: "task-a", priority: "high" },
        { op: "merge", itemId: "task-b", intoId: "task-a" },
      ]),
      doc,
    );
    expect(describeRefinement(proposals[0])).toContain("priority");
    expect(describeRefinement(proposals[0])).toContain("Add the Ask panel");
    expect(describeRefinement(proposals[1])).toContain("merged");
  });
});
