import { describe, it, expect } from "vitest";
import type { PRDItem, Requirement } from "../../../src/schema/v1.js";
import {
  collectRequirements,
  collectRequirementsByCategory,
  collectRequirementsByValidationType,
  validateRequirements,
  validateAutomatedRequirements,
  formatRequirementsValidation,
  buildTraceabilityMatrix,
} from "../../../src/core/requirements.js";
import type { CommandExecutor } from "../../../src/core/requirements.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeReq(overrides: Partial<Requirement> & { id: string; title: string }): Requirement {
  return {
    category: "technical",
    validationType: "automated",
    acceptanceCriteria: ["Must pass"],
    ...overrides,
  };
}

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────

function buildTree(): PRDItem[] {
  return [
    makeItem({
      id: "epic-1",
      title: "Epic One",
      level: "epic",
      requirements: [
        makeReq({
          id: "req-security-1",
          title: "Authentication required",
          category: "security",
          validationType: "manual",
          acceptanceCriteria: ["All endpoints require auth"],
        }),
        makeReq({
          id: "req-perf-1",
          title: "Uptime > 99%",
          category: "performance",
          validationType: "metric",
          validationCommand: "echo 99.5",
          threshold: 99,
          acceptanceCriteria: ["Uptime >= 99%"],
        }),
      ],
      children: [
        makeItem({
          id: "feat-1",
          title: "Feature One",
          level: "feature",
          requirements: [
            makeReq({
              id: "req-compat-1",
              title: "Chrome/Firefox support",
              category: "compatibility",
              validationType: "automated",
              validationCommand: "echo ok",
              acceptanceCriteria: ["Works in Chrome 120+", "Works in Firefox 120+"],
            }),
          ],
          children: [
            makeItem({
              id: "task-1",
              title: "Task One",
              level: "task",
              requirements: [
                makeReq({
                  id: "req-quality-1",
                  title: "Test coverage > 80%",
                  category: "quality",
                  validationType: "metric",
                  validationCommand: "echo 85",
                  threshold: 80,
                  acceptanceCriteria: ["Statement coverage >= 80%"],
                }),
              ],
            }),
            makeItem({
              id: "task-2",
              title: "Task Two",
              level: "task",
            }),
          ],
        }),
      ],
    }),
    makeItem({
      id: "epic-2",
      title: "Epic Two",
      level: "epic",
      requirements: [
        makeReq({
          id: "req-tech-1",
          title: "TypeScript strict mode",
          category: "technical",
          validationType: "automated",
          validationCommand: "tsc --noEmit",
          acceptanceCriteria: ["No TypeScript errors in strict mode"],
        }),
      ],
    }),
  ];
}

// ── Collection ───────────────────────────────────────────────────

describe("collectRequirements", () => {
  it("returns own requirements for a task with requirements", () => {
    const items = buildTree();
    const traced = collectRequirements(items, "task-1");

    const ownReqs = traced.filter((t) => t.sourceItemId === "task-1");
    expect(ownReqs).toHaveLength(1);
    expect(ownReqs[0].requirement.id).toBe("req-quality-1");
  });

  it("inherits requirements from parent chain", () => {
    const items = buildTree();
    const traced = collectRequirements(items, "task-1");

    // task-1 has own (1) + feature (1) + epic (2) = 4 requirements
    expect(traced).toHaveLength(4);

    const ids = traced.map((t) => t.requirement.id);
    expect(ids).toContain("req-quality-1");   // own
    expect(ids).toContain("req-compat-1");    // feature
    expect(ids).toContain("req-security-1");  // epic
    expect(ids).toContain("req-perf-1");      // epic
  });

  it("orders own requirements before parent requirements", () => {
    const items = buildTree();
    const traced = collectRequirements(items, "task-1");

    // Own first, then feature, then epic
    expect(traced[0].requirement.id).toBe("req-quality-1");
    expect(traced[1].requirement.id).toBe("req-compat-1");
    // Epic requirements come last
    expect(traced[2].sourceItemId).toBe("epic-1");
    expect(traced[3].sourceItemId).toBe("epic-1");
  });

  it("returns empty array for item without requirements and no parent requirements", () => {
    const items = [
      makeItem({ id: "lone-task", title: "Lone", level: "epic" }),
    ];
    const traced = collectRequirements(items, "lone-task");
    expect(traced).toHaveLength(0);
  });

  it("returns empty array for nonexistent item", () => {
    const items = buildTree();
    const traced = collectRequirements(items, "does-not-exist");
    expect(traced).toHaveLength(0);
  });

  it("returns only inherited requirements for task without own requirements", () => {
    const items = buildTree();
    const traced = collectRequirements(items, "task-2");

    // task-2 has no own requirements but inherits feature (1) + epic (2) = 3
    expect(traced).toHaveLength(3);
    expect(traced.every((t) => t.sourceItemId !== "task-2")).toBe(true);
  });

  it("includes traceability info (source item details)", () => {
    const items = buildTree();
    const traced = collectRequirements(items, "task-1");

    const epicReq = traced.find((t) => t.requirement.id === "req-security-1");
    expect(epicReq).toBeDefined();
    expect(epicReq!.sourceItemId).toBe("epic-1");
    expect(epicReq!.sourceItemTitle).toBe("Epic One");
    expect(epicReq!.sourceItemLevel).toBe("epic");
  });
});

describe("collectRequirementsByCategory", () => {
  it("filters by category", () => {
    const items = buildTree();
    const security = collectRequirementsByCategory(items, "task-1", "security");

    expect(security).toHaveLength(1);
    expect(security[0].requirement.id).toBe("req-security-1");
  });

  it("returns empty for category with no matches", () => {
    const items = buildTree();
    const a11y = collectRequirementsByCategory(items, "task-1", "accessibility");
    expect(a11y).toHaveLength(0);
  });
});

describe("collectRequirementsByValidationType", () => {
  it("filters by validation type", () => {
    const items = buildTree();
    const manual = collectRequirementsByValidationType(items, "task-1", "manual");

    expect(manual).toHaveLength(1);
    expect(manual[0].requirement.id).toBe("req-security-1");
  });

  it("filters metric requirements", () => {
    const items = buildTree();
    const metric = collectRequirementsByValidationType(items, "task-1", "metric");

    expect(metric).toHaveLength(2); // perf-1 (epic) + quality-1 (own)
  });
});

// ── Validation ───────────────────────────────────────────────────

describe("validateRequirements", () => {
  it("marks manual requirements as needing review", async () => {
    const items = buildTree();
    const executor: CommandExecutor = async () => ({ exitCode: 0, stdout: "", stderr: "" });

    const summary = await validateRequirements(items, "task-1", executor);

    const manual = summary.results.find((r) => r.requirementId === "req-security-1");
    expect(manual).toBeDefined();
    expect(manual!.passed).toBe(false);
    expect(manual!.reason).toContain("Manual review required");
  });

  it("passes automated requirement when command exits 0", async () => {
    const items = buildTree();
    const executor: CommandExecutor = async () => ({ exitCode: 0, stdout: "ok\n", stderr: "" });

    const summary = await validateRequirements(items, "task-1", executor);

    const auto = summary.results.find((r) => r.requirementId === "req-compat-1");
    expect(auto).toBeDefined();
    expect(auto!.passed).toBe(true);
  });

  it("fails automated requirement when command exits non-zero", async () => {
    const items = buildTree();
    const executor: CommandExecutor = async (cmd) => {
      if (cmd === "echo ok") return { exitCode: 1, stdout: "", stderr: "fail" };
      return { exitCode: 0, stdout: "100", stderr: "" };
    };

    const summary = await validateRequirements(items, "task-1", executor);

    const auto = summary.results.find((r) => r.requirementId === "req-compat-1");
    expect(auto!.passed).toBe(false);
    expect(auto!.reason).toContain("exit code 1");
  });

  it("passes metric requirement when value meets threshold", async () => {
    const items = buildTree();
    const executor: CommandExecutor = async (cmd) => {
      if (cmd === "echo 99.5") return { exitCode: 0, stdout: "99.5", stderr: "" };
      if (cmd === "echo 85") return { exitCode: 0, stdout: "85", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const summary = await validateRequirements(items, "task-1", executor);

    const perf = summary.results.find((r) => r.requirementId === "req-perf-1");
    expect(perf!.passed).toBe(true);
    expect(perf!.measuredValue).toBe(99.5);
    expect(perf!.threshold).toBe(99);
  });

  it("fails metric requirement when value below threshold", async () => {
    const items = buildTree();
    const executor: CommandExecutor = async (cmd) => {
      if (cmd === "echo 99.5") return { exitCode: 0, stdout: "99.5", stderr: "" };
      if (cmd === "echo 85") return { exitCode: 0, stdout: "60", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const summary = await validateRequirements(items, "task-1", executor);

    const quality = summary.results.find((r) => r.requirementId === "req-quality-1");
    expect(quality!.passed).toBe(false);
    expect(quality!.measuredValue).toBe(60);
    expect(quality!.threshold).toBe(80);
    expect(quality!.reason).toContain("below threshold");
  });

  it("fails when metric output cannot be parsed", async () => {
    const items = buildTree();
    const executor: CommandExecutor = async () => ({ exitCode: 0, stdout: "no numbers here", stderr: "" });

    const summary = await validateRequirements(items, "task-1", executor);

    const metric = summary.results.find((r) => r.requirementId === "req-perf-1");
    expect(metric!.passed).toBe(false);
    expect(metric!.reason).toContain("Could not parse");
  });

  it("fails when no executor is provided", async () => {
    const items = buildTree();

    const summary = await validateRequirements(items, "task-1");

    const auto = summary.results.find((r) => r.requirementId === "req-compat-1");
    expect(auto!.passed).toBe(false);
    expect(auto!.reason).toContain("No command executor");
  });

  it("handles executor errors gracefully", async () => {
    const items = buildTree();
    const executor: CommandExecutor = async () => {
      throw new Error("command not found");
    };

    const summary = await validateRequirements(items, "task-1", executor);

    const auto = summary.results.find((r) => r.requirementId === "req-compat-1");
    expect(auto!.passed).toBe(false);
    expect(auto!.reason).toContain("command not found");
  });

  it("computes correct summary totals", async () => {
    const items = buildTree();
    // Return values that meet all metric thresholds (quality: 80, perf: 99)
    const executor: CommandExecutor = async (cmd) => {
      if (cmd === "echo 99.5") return { exitCode: 0, stdout: "99.5", stderr: "" };
      if (cmd === "echo 85") return { exitCode: 0, stdout: "85", stderr: "" };
      return { exitCode: 0, stdout: "100", stderr: "" };
    };

    const summary = await validateRequirements(items, "task-1", executor);

    // 4 total requirements: 1 manual (fails), 1 automated (passes), 2 metric (pass)
    expect(summary.total).toBe(4);
    expect(summary.passed).toBe(3);        // automated + 2 metric
    expect(summary.manualReviewRequired).toBe(1);
    expect(summary.allPassed).toBe(false);  // manual doesn't pass
  });

  it("returns empty results for item with no requirements", async () => {
    const items = [makeItem({ id: "bare", title: "Bare", level: "epic" })];
    const summary = await validateRequirements(items, "bare");

    expect(summary.total).toBe(0);
    expect(summary.allPassed).toBe(true);
    expect(summary.results).toHaveLength(0);
  });

  it("fails requirement without validationCommand (non-manual)", async () => {
    const items = [
      makeItem({
        id: "t1",
        title: "Task",
        level: "epic",
        requirements: [
          makeReq({
            id: "r1",
            title: "No command",
            validationType: "automated",
            // no validationCommand
          }),
        ],
      }),
    ];
    const executor: CommandExecutor = async () => ({ exitCode: 0, stdout: "", stderr: "" });
    const summary = await validateRequirements(items, "t1", executor);

    expect(summary.results[0].passed).toBe(false);
    expect(summary.results[0].reason).toContain("No validation command configured");
  });
});

describe("validateAutomatedRequirements", () => {
  it("excludes manual requirements from the gate", async () => {
    const items = buildTree();
    const executor: CommandExecutor = async (cmd) => {
      if (cmd === "echo 99.5") return { exitCode: 0, stdout: "99.5", stderr: "" };
      if (cmd === "echo 85") return { exitCode: 0, stdout: "85", stderr: "" };
      return { exitCode: 0, stdout: "100", stderr: "" };
    };

    const summary = await validateAutomatedRequirements(items, "task-1", executor);

    // Should have 3 results: 1 automated + 2 metric (no manual)
    expect(summary.total).toBe(3);
    expect(summary.manualReviewRequired).toBe(0);
    expect(summary.allPassed).toBe(true);
  });

  it("fails when an automated requirement fails", async () => {
    const items = buildTree();
    const executor: CommandExecutor = async (cmd) => {
      if (cmd === "echo ok") return { exitCode: 1, stdout: "", stderr: "error" };
      if (cmd === "echo 99.5") return { exitCode: 0, stdout: "99.5", stderr: "" };
      if (cmd === "echo 85") return { exitCode: 0, stdout: "85", stderr: "" };
      return { exitCode: 0, stdout: "100", stderr: "" };
    };

    const summary = await validateAutomatedRequirements(items, "task-1", executor);

    expect(summary.allPassed).toBe(false);
    expect(summary.failed).toBe(1);
  });
});

// ── Formatting ───────────────────────────────────────────────────

describe("formatRequirementsValidation", () => {
  it("reports no requirements", () => {
    const output = formatRequirementsValidation({
      itemId: "t1",
      allPassed: true,
      total: 0,
      passed: 0,
      failed: 0,
      manualReviewRequired: 0,
      results: [],
    });
    expect(output).toBe("No requirements to validate.");
  });

  it("includes pass/fail counts", () => {
    const output = formatRequirementsValidation({
      itemId: "t1",
      allPassed: false,
      total: 3,
      passed: 2,
      failed: 1,
      manualReviewRequired: 0,
      results: [
        {
          requirementId: "r1",
          requirementTitle: "Passes",
          passed: true,
          validationType: "automated",
          reason: "OK",
          sourceItemId: "t1",
        },
        {
          requirementId: "r2",
          requirementTitle: "Fails",
          passed: false,
          validationType: "automated",
          reason: "exit code 1",
          sourceItemId: "t1",
        },
        {
          requirementId: "r3",
          requirementTitle: "Also passes",
          passed: true,
          validationType: "metric",
          reason: "Metric 90 meets threshold 80",
          sourceItemId: "t1",
        },
      ],
    });

    expect(output).toContain("2/3 passed");
    expect(output).toContain("\u2713"); // checkmark
    expect(output).toContain("\u2717"); // X mark
  });

  it("includes manual review count", () => {
    const output = formatRequirementsValidation({
      itemId: "t1",
      allPassed: false,
      total: 1,
      passed: 0,
      failed: 0,
      manualReviewRequired: 1,
      results: [
        {
          requirementId: "r1",
          requirementTitle: "Manual check",
          passed: false,
          validationType: "manual",
          reason: "Manual review required",
          sourceItemId: "t1",
        },
      ],
    });

    expect(output).toContain("Manual review needed: 1");
  });
});

// ── Traceability ─────────────────────────────────────────────────

describe("buildTraceabilityMatrix", () => {
  it("maps each requirement to its defining items", () => {
    const items = buildTree();
    const matrix = buildTraceabilityMatrix(items);

    expect(matrix.size).toBe(5); // 5 unique requirements in the tree

    const secReq = matrix.get("req-security-1");
    expect(secReq).toBeDefined();
    expect(secReq!.requirement.title).toBe("Authentication required");
    expect(secReq!.appliesTo).toContain("epic-1");
  });

  it("returns empty map for tree without requirements", () => {
    const items = [makeItem({ id: "bare", title: "Bare", level: "epic" })];
    const matrix = buildTraceabilityMatrix(items);
    expect(matrix.size).toBe(0);
  });
});

// ── Schema validation (requirements in PRD items) ────────────────

// Import validateDocument for end-to-end schema validation tests.
import { validateDocument } from "../../../src/schema/validate.js";

describe("requirements schema validation", () => {

  it("accepts items with valid requirements", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "e1",
          title: "Epic",
          status: "pending",
          level: "epic",
          requirements: [
            {
              id: "r1",
              title: "TypeScript strict",
              category: "technical",
              validationType: "automated",
              acceptanceCriteria: ["No TS errors"],
              validationCommand: "tsc --noEmit",
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts items without requirements (backward compat)", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "pending",
          level: "task",
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts requirements with all optional fields", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "pending",
          level: "task",
          requirements: [
            {
              id: "r1",
              title: "Performance gate",
              description: "Ensure response time is within bounds",
              category: "performance",
              validationType: "metric",
              acceptanceCriteria: ["P95 < 200ms", "P99 < 500ms"],
              validationCommand: "measure-latency",
              threshold: 200,
              priority: "high",
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects requirements with invalid category", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "pending",
          level: "task",
          requirements: [
            {
              id: "r1",
              title: "Bad category",
              category: "non_existent",
              validationType: "automated",
              acceptanceCriteria: [],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects requirements with invalid validation type", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "pending",
          level: "task",
          requirements: [
            {
              id: "r1",
              title: "Bad type",
              category: "technical",
              validationType: "magic",
              acceptanceCriteria: [],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects requirements missing required fields", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "pending",
          level: "task",
          requirements: [
            {
              id: "r1",
              // missing title, category, validationType, acceptanceCriteria
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts all valid requirement categories", () => {
    const categories = ["technical", "performance", "security", "accessibility", "compatibility", "quality"];
    for (const category of categories) {
      const result = validateDocument({
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Task",
            status: "pending",
            level: "task",
            requirements: [
              {
                id: "r1",
                title: "Test",
                category,
                validationType: "automated",
                acceptanceCriteria: [],
              },
            ],
          },
        ],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("accepts all valid validation types", () => {
    const types = ["automated", "manual", "metric"];
    for (const validationType of types) {
      const result = validateDocument({
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Task",
            status: "pending",
            level: "task",
            requirements: [
              {
                id: "r1",
                title: "Test",
                category: "technical",
                validationType,
                acceptanceCriteria: [],
              },
            ],
          },
        ],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("accepts empty requirements array", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "pending",
          level: "task",
          requirements: [],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects requirements with unknown fields (strict mode)", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "pending",
          level: "task",
          requirements: [
            {
              id: "r1",
              title: "Test",
              category: "technical",
              validationType: "automated",
              acceptanceCriteria: [],
              unknownField: "should fail",
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});
