import { describe, it, expect } from "vitest";
import { buildProposals } from "../../../src/analyze/propose.js";
import type { ScanResult } from "../../../src/analyze/scanners.js";

function makeScanResult(overrides: Partial<ScanResult> & { name: string }): ScanResult {
  return {
    source: "test",
    sourceFile: "test.ts",
    kind: "feature",
    ...overrides,
  };
}

describe("buildProposals", () => {
  it("groups results by epic inferred from tags", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Login", kind: "feature", tags: ["Auth"] }),
      makeScanResult({ name: "validates email", kind: "task", tags: ["Auth"], sourceFile: "test.ts" }),
      makeScanResult({ name: "Dashboard", kind: "feature", tags: ["UI"] }),
    ];

    const proposals = buildProposals(results);

    expect(proposals.length).toBe(2);
    const authEpic = proposals.find((p) => p.epic.title === "Auth");
    expect(authEpic).toBeDefined();
    expect(authEpic!.features.length).toBeGreaterThanOrEqual(1);

    const uiEpic = proposals.find((p) => p.epic.title === "UI");
    expect(uiEpic).toBeDefined();
  });

  it("deduplicates results with same name and kind", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Login", kind: "feature", tags: ["Auth"], sourceFile: "a.ts" }),
      makeScanResult({ name: "Login", kind: "feature", tags: ["Auth"], sourceFile: "b.ts" }),
      makeScanResult({ name: "Login", kind: "task", tags: ["Auth"], sourceFile: "a.ts" }),
    ];

    const proposals = buildProposals(results);
    const authEpic = proposals.find((p) => p.epic.title === "Auth");
    // Should have one feature named Login (deduped) and one task named Login
    const featureCount = authEpic!.features.filter((f) => f.title === "Login").length;
    expect(featureCount).toBe(1);
  });

  it("sorts by priority (critical first)", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Low priority fix", kind: "task", priority: "low", tags: ["General"], sourceFile: "a.ts" }),
      makeScanResult({ name: "Critical bug", kind: "task", priority: "critical", tags: ["General"], sourceFile: "a.ts" }),
      makeScanResult({ name: "Feature A", kind: "feature", tags: ["General"], sourceFile: "a.ts" }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    const general = proposals.find((p) => p.epic.title === "General");
    expect(general).toBeDefined();

    // Find the feature with tasks
    const featureWithTasks = general!.features.find((f) => f.tasks.length > 0);
    if (featureWithTasks && featureWithTasks.tasks.length >= 2) {
      expect(featureWithTasks.tasks[0].title).toBe("Critical bug");
      expect(featureWithTasks.tasks[1].title).toBe("Low priority fix");
    }
  });

  it("places tasks under features from same sourceFile", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Auth Feature", kind: "feature", tags: ["Auth"], sourceFile: "auth.test.ts" }),
      makeScanResult({ name: "validates token", kind: "task", tags: ["Auth"], sourceFile: "auth.test.ts" }),
      makeScanResult({ name: "checks expiry", kind: "task", tags: ["Auth"], sourceFile: "auth.test.ts" }),
    ];

    const proposals = buildProposals(results);
    const authEpic = proposals.find((p) => p.epic.title === "Auth");
    expect(authEpic).toBeDefined();

    const authFeature = authEpic!.features.find((f) => f.title === "Auth Feature");
    expect(authFeature).toBeDefined();
    expect(authFeature!.tasks.length).toBe(2);
  });

  it("handles explicit epics from scan results", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Components", kind: "epic", source: "sourcevision" }),
      makeScanResult({ name: "Button", kind: "feature", tags: ["Components"], source: "sourcevision" }),
    ];

    const proposals = buildProposals(results);
    const comp = proposals.find(
      (p) => p.epic.title.toLowerCase() === "components",
    );
    expect(comp).toBeDefined();
    expect(comp!.features.some((f) => f.title === "Button")).toBe(true);
  });

  it("returns empty array for empty input", () => {
    const proposals = buildProposals([]);
    expect(proposals).toEqual([]);
  });

  it("creates implicit features for orphan tasks", () => {
    const results: ScanResult[] = [
      makeScanResult({
        name: "fix bug",
        kind: "task",
        tags: ["General"],
        sourceFile: "bugs.test.ts",
      }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBe(1);
    // Should have created an implicit feature
    expect(proposals[0].features.length).toBe(1);
    expect(proposals[0].features[0].tasks.length).toBe(1);
    expect(proposals[0].features[0].tasks[0].title).toBe("fix bug");
  });

  it("matches tasks to features by shared tags within the same epic", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Auth System", kind: "feature", tags: ["Auth", "security"], sourceFile: "auth.ts" }),
      makeScanResult({ name: "validate JWT", kind: "task", tags: ["Auth", "security"], sourceFile: "jwt.ts" }),
      makeScanResult({ name: "hash passwords", kind: "task", tags: ["Auth", "security"], sourceFile: "crypto.ts" }),
    ];

    const proposals = buildProposals(results);
    const authEpic = proposals.find((p) => p.epic.title === "Auth");
    expect(authEpic).toBeDefined();

    const authFeature = authEpic!.features.find((f) => f.title === "Auth System");
    expect(authFeature).toBeDefined();
    // Tasks share tags with the feature, so they should be grouped under it
    expect(authFeature!.tasks.length).toBe(2);
  });

  it("uses descriptive title for implicit features instead of raw file path", () => {
    const results: ScanResult[] = [
      makeScanResult({
        name: "fix memory leak",
        kind: "task",
        tags: ["Performance"],
        sourceFile: "src/utils/memory-handler.ts",
      }),
      makeScanResult({
        name: "add cache invalidation",
        kind: "task",
        tags: ["Performance"],
        sourceFile: "src/utils/memory-handler.ts",
      }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBe(1);
    const feat = proposals[0].features[0];
    // Implicit feature should derive a descriptive title, not use the raw path
    expect(feat.title).not.toBe("src/utils/memory-handler.ts");
    expect(feat.title).toMatch(/Memory Handler/i);
  });

  it("propagates description from explicit epics to proposal epics", () => {
    const results: ScanResult[] = [
      makeScanResult({
        name: "Infrastructure",
        kind: "epic",
        source: "sourcevision",
        description: "Core infrastructure and build tooling",
      }),
      makeScanResult({
        name: "CI Pipeline",
        kind: "feature",
        tags: ["Infrastructure"],
        source: "sourcevision",
      }),
    ];

    const proposals = buildProposals(results);
    const infra = proposals.find((p) => p.epic.title === "Infrastructure");
    expect(infra).toBeDefined();
    // Epics should carry their descriptions through to proposals
    expect(infra!.epic).toHaveProperty("description");
    expect((infra!.epic as any).description).toBe("Core infrastructure and build tooling");
  });

  it("groups multiple orphan tasks from same file under one implicit feature", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "fix null pointer crash", kind: "task", tags: ["Backend"], sourceFile: "api/routes.ts" }),
      makeScanResult({ name: "add request validation middleware", kind: "task", tags: ["Backend"], sourceFile: "api/routes.ts" }),
      makeScanResult({ name: "implement rate limiting", kind: "task", tags: ["Backend"], sourceFile: "api/routes.ts" }),
    ];

    const proposals = buildProposals(results);
    const backend = proposals.find((p) => p.epic.title === "Backend");
    expect(backend).toBeDefined();
    // All three tasks from the same file should be under one feature
    expect(backend!.features.length).toBe(1);
    expect(backend!.features[0].tasks.length).toBe(3);
  });

  it("preserves features without tasks (context-only features)", () => {
    const results: ScanResult[] = [
      makeScanResult({
        name: "API Tests",
        kind: "feature",
        tags: ["Testing"],
        source: "test",
        description: "Test coverage: 5 test files",
      }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBe(1);
    expect(proposals[0].features[0].title).toBe("API Tests");
    expect(proposals[0].features[0].tasks.length).toBe(0);
    expect(proposals[0].features[0].description).toBe("Test coverage: 5 test files");
  });

  it("removes empty epics that have no features and no tasks", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Empty Epic", kind: "epic", source: "sourcevision" }),
      makeScanResult({ name: "Real Feature", kind: "feature", tags: ["Other"], source: "sourcevision" }),
    ];

    const proposals = buildProposals(results);
    // The empty epic has no features, so it should be filtered out
    expect(proposals.some((p) => p.epic.title === "Empty Epic")).toBe(false);
    expect(proposals.length).toBe(1);
    expect(proposals[0].features[0].title).toBe("Real Feature");
  });

  it("uses explicit epic field to group features and tasks", () => {
    const results: ScanResult[] = [
      makeScanResult({ name: "Login Form", kind: "feature", epic: "Authentication", sourceFile: "login.ts" }),
      makeScanResult({ name: "validate credentials", kind: "task", epic: "Authentication", sourceFile: "login.ts" }),
      makeScanResult({ name: "Dashboard Widget", kind: "feature", epic: "UI", sourceFile: "widget.ts" }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBe(2);

    const authEpic = proposals.find((p) => p.epic.title === "Authentication");
    expect(authEpic).toBeDefined();
    expect(authEpic!.features.some((f) => f.title === "Login Form")).toBe(true);

    const uiEpic = proposals.find((p) => p.epic.title === "UI");
    expect(uiEpic).toBeDefined();
  });

  it("explicit epic field takes precedence over tag-based inference", () => {
    const results: ScanResult[] = [
      makeScanResult({
        name: "Metrics Collector",
        kind: "feature",
        tags: ["Monitoring"],  // Would infer epic "Monitoring"
        epic: "Observability",  // But explicit epic overrides
        sourceFile: "metrics.ts",
      }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBe(1);
    // Should use the explicit epic, not the tag
    expect(proposals[0].epic.title).toBe("Observability");
  });

  it("places tasks under cross-epic features when sourceFile matches", () => {
    const results: ScanResult[] = [
      // Feature in "Backend" epic
      makeScanResult({ name: "API Routes", kind: "feature", tags: ["Backend"], sourceFile: "api/routes.ts" }),
      // Task that infers to "Frontend" epic but shares sourceFile with Backend feature
      makeScanResult({ name: "add CORS header", kind: "task", tags: ["Frontend"], sourceFile: "api/routes.ts" }),
    ];

    const proposals = buildProposals(results);
    const backend = proposals.find((p) => p.epic.title === "Backend");
    expect(backend).toBeDefined();

    const apiFeature = backend!.features.find((f) => f.title === "API Routes");
    expect(apiFeature).toBeDefined();
    // Task should be placed under the cross-epic feature due to sourceFile match
    expect(apiFeature!.tasks.length).toBe(1);
    expect(apiFeature!.tasks[0].title).toBe("add CORS header");
  });

  it("sorts features by feature-level priority when they have no tasks", () => {
    const results: ScanResult[] = [
      makeScanResult({
        name: "Low Priority Feature",
        kind: "feature",
        tags: ["Project"],
        priority: "low",
        sourceFile: "low.ts",
      }),
      makeScanResult({
        name: "Critical Feature",
        kind: "feature",
        tags: ["Project"],
        priority: "critical",
        sourceFile: "critical.ts",
      }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBe(1);
    // Critical feature should come first
    expect(proposals[0].features[0].title).toBe("Critical Feature");
    expect(proposals[0].features[1].title).toBe("Low Priority Feature");
  });

  it("excludes epic tag from tag overlap to avoid false matches", () => {
    // Both items share the "Auth" epic tag but have no other tag overlap.
    // The task should NOT be placed under the feature by tag matching
    // (it should create an implicit feature instead).
    const results: ScanResult[] = [
      makeScanResult({ name: "OAuth Provider", kind: "feature", tags: ["Auth", "oauth"], sourceFile: "oauth.ts" }),
      makeScanResult({ name: "fix session bug", kind: "task", tags: ["Auth", "sessions"], sourceFile: "session.ts" }),
    ];

    const proposals = buildProposals(results);
    const authEpic = proposals.find((p) => p.epic.title === "Auth");
    expect(authEpic).toBeDefined();

    const oauthFeature = authEpic!.features.find((f) => f.title === "OAuth Provider");
    expect(oauthFeature).toBeDefined();
    // Task has no tag overlap beyond the epic tag, so it should NOT be under OAuth Provider
    expect(oauthFeature!.tasks.length).toBe(0);
    // Instead it should be under an implicit feature
    expect(authEpic!.features.length).toBe(2);
  });

  it("sorts proposals by highest-priority feature when features have own priority", () => {
    const results: ScanResult[] = [
      makeScanResult({
        name: "Nice to have",
        kind: "feature",
        tags: ["Low"],
        priority: "low",
        sourceFile: "low.ts",
      }),
      makeScanResult({
        name: "Critical fix",
        kind: "feature",
        tags: ["High"],
        priority: "critical",
        sourceFile: "high.ts",
      }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBe(2);
    // Proposal with critical feature should come first
    expect(proposals[0].epic.title).toBe("High");
    expect(proposals[1].epic.title).toBe("Low");
  });

  it("never surfaces an internal finding: tag as the epic title", () => {
    // Regression: scanners.ts pushes `finding:<hash>` (and, when present,
    // `finding-category:<category>`) onto a result's tags purely for the
    // accept/re-analyze feedback loop. A global-scope finding with no zone
    // has an empty tags array before that push, so `finding:<hash>` lands
    // at tags[0] — and inferEpic's "use the first tag" fallback used to
    // take it literally, producing an epic titled e.g. "finding:c508fa330029"
    // in the Project Scan UI (confirmed live against a real project).
    const results: ScanResult[] = [
      makeScanResult({
        name: "Circular dependency between modules",
        kind: "task",
        source: "sourcevision",
        tags: ["finding:c508fa330029", "finding-category:circular-dep"],
        sourceFile: "src/app.ts",
      }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBe(1);
    expect(proposals[0].epic.title).not.toContain("finding:");
    expect(proposals[0].epic.title).not.toContain("finding-category:");
    // No zone/scope tag survives filtering, so it falls through to the
    // source-based default rather than any tag at all.
    expect(proposals[0].epic.title).toBe("SourceVision");
  });

  it("groups multiple zone-less findings under the same shared epic instead of one epic each", () => {
    // Before the fix, each finding's unique hash tag made it its own
    // grouping key, so N unrelated global findings produced N separate
    // single-item epics instead of the one shared bucket the "fall back to
    // source type" branch of inferEpic was always meant to produce.
    const results: ScanResult[] = [
      makeScanResult({ name: "Finding A", kind: "task", source: "sourcevision", tags: ["finding:aaa111"], sourceFile: "a.ts" }),
      makeScanResult({ name: "Finding B", kind: "task", source: "sourcevision", tags: ["finding:bbb222"], sourceFile: "b.ts" }),
    ];

    const proposals = buildProposals(results);
    expect(proposals.length).toBe(1);
    expect(proposals[0].epic.title).toBe("SourceVision");
  });

  it("still prefers a genuine display tag over a finding: marker when both are present", () => {
    const results: ScanResult[] = [
      makeScanResult({
        name: "Refactor auth flow",
        kind: "task",
        tags: ["finding:zzz999", "Auth"],
        sourceFile: "auth.ts",
      }),
    ];

    const proposals = buildProposals(results);
    expect(proposals[0].epic.title).toBe("Auth");
  });
});
