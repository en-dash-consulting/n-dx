import { describe, it, expect } from "vitest";
import { SELF_HEAL_TAG, SELF_HEAL_ENV_VAR } from "../../../src/store/self-heal-tag.js";
import {
  changeInputsFromProposals,
  changeInputsFromRecommendations,
  type ProposedWork,
} from "../../../src/recommend/changes-from-proposals.js";

describe("changeInputsFromProposals", () => {
  it("creates a change for each leaf and none for the containers above it", () => {
    const work: ProposedWork[] = [
      {
        title: "Code Health: 4 findings across 2 zones",
        children: [
          {
            title: "Fix coupling in rex-cli (2 findings)",
            children: [
              { title: "Fix coupling in rex-cli: a.ts imports b.ts" },
              { title: "Fix coupling in rex-cli: c.ts imports d.ts" },
            ],
          },
        ],
      },
    ];

    const inputs = changeInputsFromProposals(work);

    expect(inputs.map((i) => i.title)).toEqual([
      "Fix coupling in rex-cli: a.ts imports b.ts",
      "Fix coupling in rex-cli: c.ts imports d.ts",
    ]);
    expect(inputs.every((i) => i.type === "change")).toBe(true);
  });

  it("carries intent, criteria, priority, source and tags onto the change", () => {
    const [input] = changeInputsFromProposals([
      {
        title: "Fix coupling in rex-cli",
        description: "- rex-cli imports sourcevision",
        acceptanceCriteria: ["No cross-package import remains"],
        priority: "critical",
        source: "sourcevision",
        tags: ["code-health"],
      },
    ]);

    expect(input).toEqual({
      type: "change",
      title: "Fix coupling in rex-cli",
      description: "- rex-cli imports sourcevision",
      acceptanceCriteria: ["No cross-package import remains"],
      priority: "critical",
      source: "sourcevision",
      tags: ["code-health"],
    });
  });

  it("creates the container itself when it proposed no children", () => {
    const inputs = changeInputsFromProposals([
      { title: "Lone epic", children: [] },
      { title: "Feature with no tasks", children: undefined },
    ]);
    expect(inputs.map((i) => i.title)).toEqual(["Lone epic", "Feature with no tasks"]);
  });

  it("skips a leaf a scanner marked completed, cancelled or deleted", () => {
    const inputs = changeInputsFromProposals([
      { title: "Already done", status: "completed" },
      { title: "Abandoned", status: "cancelled" },
      { title: "Removed", status: "deleted" },
      { title: "Still to do", status: "pending" },
      { title: "No status" },
    ]);
    expect(inputs.map((i) => i.title)).toEqual(["Still to do", "No status"]);
  });

  it("keeps a pending task under a container the scanner marked completed", () => {
    const inputs = changeInputsFromProposals([
      { title: "Testing", status: "completed", children: [{ title: "Cover the parser" }] },
    ]);
    expect(inputs.map((i) => i.title)).toEqual(["Cover the parser"]);
  });

  it("skips a blank title", () => {
    expect(changeInputsFromProposals([{ title: "   " }])).toEqual([]);
  });
});

describe("changeInputsFromRecommendations", () => {
  const recommendations = [
    { id: "epic", title: "Code Health: 3 findings across 1 zone", source: "sourcevision", tags: ["code-health"] },
    { id: "feat", parentId: "epic", title: "Fix coupling in rex-cli (2 findings)", source: "sourcevision", tags: ["code-health"] },
    { parentId: "feat", title: "Fix coupling in rex-cli: a.ts", source: "sourcevision", tags: ["code-health"] },
    { parentId: "feat", title: "Fix coupling in rex-cli: b.ts", source: "sourcevision", tags: ["code-health"] },
  ];

  it("creates a change per task recommendation, and none for the epic or the feature", () => {
    const inputs = changeInputsFromRecommendations(recommendations);

    expect(inputs.map((i) => i.title)).toEqual([
      "Fix coupling in rex-cli: a.ts",
      "Fix coupling in rex-cli: b.ts",
    ]);
    expect(inputs.every((i) => i.type === "change")).toBe(true);
    expect(inputs.every((i) => i.tags?.includes("code-health"))).toBe(true);
  });

  it("creates a recommendation whose parent is not in the batch rather than dropping it", () => {
    const inputs = changeInputsFromRecommendations([
      { parentId: "a-feature-accepted-on-an-earlier-run", title: "Orphan task" },
    ]);
    expect(inputs.map((i) => i.title)).toEqual(["Orphan task"]);
  });

  it("creates each recommendation once when one is reachable both ways", () => {
    const inputs = changeInputsFromRecommendations([
      { id: "feat", parentId: "missing-epic", title: "Feature" },
      { parentId: "feat", title: "Task" },
    ]);
    expect(inputs.map((i) => i.title)).toEqual(["Task"]);
  });

  // ── The self-heal loop's identity on v2 ──────────────────────────

  describe("self-heal identity", () => {
    /** Run `fn` with NDX_SELF_HEAL set, restoring whatever was there. */
    function withSelfHealEnv<T>(fn: () => T): T {
      const prev = process.env[SELF_HEAL_ENV_VAR];
      process.env[SELF_HEAL_ENV_VAR] = "1";
      try {
        return fn();
      } finally {
        if (prev === undefined) delete process.env[SELF_HEAL_ENV_VAR];
        else process.env[SELF_HEAL_ENV_VAR] = prev;
      }
    }

    it("carries finding hashes across as finding: tags", () => {
      // v2 has no recommendationMeta, so the hashes travel as tags — the same
      // format the v1 scanner writes and hench reads back.
      const inputs = changeInputsFromProposals([
        { title: "Fix the thing", meta: { findingHashes: ["abc123def456", "0f0f0f0f0f0f"] } },
      ]);
      expect(inputs[0]!.tags).toEqual(["finding:abc123def456", "finding:0f0f0f0f0f0f"]);
    });

    it("keeps the proposal's own tags alongside the hashes", () => {
      const inputs = changeInputsFromProposals([
        { title: "Fix", tags: ["code-health"], meta: { findingHashes: ["abc123def456"] } },
      ]);
      expect(inputs[0]!.tags).toEqual(["code-health", "finding:abc123def456"]);
    });

    it("adds no tags when there are no hashes and no tags", () => {
      expect(changeInputsFromProposals([{ title: "Fix" }])[0]!.tags).toBeUndefined();
    });

    it("stamps the self-heal tag during a self-heal run", () => {
      // Without this, `hench --tags=self-heal` cannot select the change the
      // self-heal run just filed, so the loop never works it.
      const inputs = withSelfHealEnv(() =>
        changeInputsFromProposals([{ title: "Fix", meta: { findingHashes: ["abc123def456"] } }]),
      );
      expect(inputs[0]!.tags).toContain(SELF_HEAL_TAG);
      expect(inputs[0]!.tags).toContain("finding:abc123def456");
    });

    it("does not stamp the self-heal tag outside a self-heal run", () => {
      const inputs = changeInputsFromProposals([{ title: "Fix", tags: ["code-health"] }]);
      expect(inputs[0]!.tags).not.toContain(SELF_HEAL_TAG);
    });

    it("carries hashes through the flat recommendation shape too", () => {
      // `rex recommend --accept` builds this shape; it is the path that broke.
      const inputs = changeInputsFromRecommendations([
        { title: "Fix", meta: { findingHashes: ["abc123def456"] } },
      ]);
      expect(inputs[0]!.tags).toEqual(["finding:abc123def456"]);
    });
  });

});
