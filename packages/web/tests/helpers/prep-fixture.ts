import type { PrepResponse } from "../../src/viewer/components/prepare-task-model.js";

/** A `GET /api/hench/prep/:taskId` answer for an actionable task on a branch worktree. */
export function prepFixture(overrides: Partial<PrepResponse> = {}): PrepResponse {
  return {
    task: { id: "task-1", title: "Prep me", status: "pending", level: "task" },
    workspace: { key: null, root: "/repo", branch: "main", isAnchor: false, dirty: false, liveRun: false },
    resolved: {
      vendor: { value: "claude", source: "llm.vendor" },
      model: { value: "claude-sonnet", source: "llm.claude.model" },
      provider: { value: "api", source: "hench.provider" },
      permissionMode: { value: "acceptEdits", source: "autonomous-default" },
      review: { value: false, source: "built-in" },
      reviewModel: { value: "claude-sonnet", source: "llm.claude.reviewModel", vendorDefault: "claude-opus" },
      reviewOptional: { value: false, source: "built-in" },
      skipTestGate: { value: false, source: "built-in" },
      maxTurns: { value: 50, source: "hench.maxTurns" },
      tokenBudget: { value: 0, source: "built-in" },
      fresh: { value: false, source: "built-in" },
      allowDirty: { value: false, source: "built-in" },
    },
    options: [{ key: "provider", values: ["cli", "api"] }],
    refusals: [],
    dir: "/repo",
    detail: { priority: "high", parentChain: ["Epic", "Feature"], criteriaCount: 3 },
    catalog: { vendor: "claude", models: ["claude-sonnet", "claude-opus"], providers: ["cli", "api"] },
    admission: null,
    recommendation: null,
    ...overrides,
  };
}
