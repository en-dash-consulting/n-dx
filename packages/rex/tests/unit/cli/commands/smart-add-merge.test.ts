import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../../../src/cli/commands/init.js";
import { applyDuplicateProposalMerges } from "../../../../src/cli/commands/smart-add.js";
import { resolveStore } from "../../../../src/store/index.js";
import { REX_DIR } from "../../../../src/cli/commands/constants.js";
import type { Proposal } from "../../../../src/analyze/index.js";
import type { ProposalDuplicateMatch } from "../../../../src/cli/commands/smart-add-duplicates.js";

describe("applyDuplicateProposalMerges", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-smart-add-merge-"));
    await cmdInit(tmpDir, {});
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("updates matched existing task and records merged proposal provenance", async () => {
    const store = await resolveStore(join(tmpDir, REX_DIR));
    await store.addItem({
      id: "epic-1",
      title: "Auth Platform",
      level: "epic",
      status: "pending",
    });
    await store.addItem({
      id: "feature-1",
      title: "OAuth Integration",
      level: "feature",
      status: "pending",
      description: "Handle OAuth providers",
    }, "epic-1");
    await store.addItem({
      id: "task-1",
      title: "Implement OAuth callback handler",
      level: "task",
      status: "pending",
      description: "Add callback route.",
      acceptanceCriteria: ["Callback route exists"],
      priority: "medium",
      tags: ["auth"],
    }, "feature-1");

    const proposals: Proposal[] = [
      {
        epic: { title: "Auth Platform", source: "smart-add" },
        features: [
          {
            title: "OAuth Integration",
            source: "smart-add",
            tasks: [
              {
                title: "Implement OAuth callback handler",
                source: "smart-add",
                sourceFile: "",
                description: "Implement callback handler with state verification.",
                acceptanceCriteria: [
                  "Callback route exists",
                  "State parameter is validated",
                ],
                priority: "critical",
                tags: ["security"],
              },
            ],
          },
        ],
      },
    ];

    const duplicateMatches: ProposalDuplicateMatch[] = [
      {
        node: {
          key: "p0:task:0:0",
          kind: "task",
          title: "Implement OAuth callback handler",
        },
        duplicate: true,
        reason: "exact_title",
        score: 1,
        matchedItem: {
          id: "task-1",
          title: "Implement OAuth callback handler",
          level: "task",
          status: "pending",
        },
      },
    ];

    const mergeResult = await applyDuplicateProposalMerges(
      tmpDir,
      proposals,
      duplicateMatches,
    );

    expect(mergeResult.mergedCount).toBe(1);
    expect(mergeResult.mergeTargetsByNodeKey).toEqual({
      "p0:task:0:0": "task-1",
    });

    const updated = await store.getItem("task-1");
    expect(updated?.id).toBe("task-1");
    expect(updated?.description).toBe("Implement callback handler with state verification.");
    expect(updated?.acceptanceCriteria).toEqual([
      "Callback route exists",
      "State parameter is validated",
    ]);
    expect(updated?.priority).toBe("critical");
    expect(updated?.tags).toEqual(["auth", "security"]);
    expect(updated?.mergedProposals).toHaveLength(1);
    expect(updated?.mergedProposals?.[0]?.proposalNodeKey).toBe("p0:task:0:0");
    expect(updated?.mergedProposals?.[0]?.proposalTitle).toBe("Implement OAuth callback handler");
    expect(updated?.mergedProposals?.[0]?.source).toBe("smart-add");
  });

  it("returns zero merges for non-duplicate matches", async () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth Platform", source: "smart-add" },
        features: [
          {
            title: "OAuth Integration",
            source: "smart-add",
            tasks: [
              {
                title: "Implement OAuth callback handler",
                source: "smart-add",
                sourceFile: "",
              },
            ],
          },
        ],
      },
    ];

    const duplicateMatches: ProposalDuplicateMatch[] = [
      {
        node: {
          key: "p0:task:0:0",
          kind: "task",
          title: "Implement OAuth callback handler",
        },
        duplicate: false,
        reason: "none",
        score: 0,
      },
    ];

    const mergeResult = await applyDuplicateProposalMerges(
      tmpDir,
      proposals,
      duplicateMatches,
    );

    expect(mergeResult.mergedCount).toBe(0);
    expect(mergeResult.mergeTargetsByNodeKey).toEqual({});
  });
});
