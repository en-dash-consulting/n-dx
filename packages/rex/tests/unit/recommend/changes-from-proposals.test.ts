import { describe, it, expect } from "vitest";
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
});
