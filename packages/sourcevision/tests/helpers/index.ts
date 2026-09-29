/**
 * Shared test helpers and fixtures for sourcevision test suite.
 * Consolidates duplicate inventory, zone, and manifest builders used across test files.
 */

import { existsSync as existsSyncFn, readFileSync as readFileSyncFn } from "node:fs";
import { join as joinPath } from "node:path";

/**
 * Creates a minimal file inventory entry for testing.
 */
export function makeFileEntry(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    path: "src/example.ts",
    language: "typescript",
    role: "source",
    ...overrides,
  };
}

/**
 * Creates a minimal inventory for testing.
 */
export function makeInventory(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    files: [],
    aggregates: {},
    ...overrides,
  };
}

/**
 * Creates a minimal zone for testing.
 */
export function makeZone(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "zone-1",
    name: "Test Zone",
    members: [],
    edges: [],
    ...overrides,
  };
}

/**
 * Creates multiple zones for testing.
 */
export function makeZones(count: number = 3): Record<string, unknown>[] {
  const zones: Record<string, unknown>[] = [];
  for (let i = 1; i <= count; i++) {
    zones.push(
      makeZone({
        id: `zone-${i}`,
        name: `Zone ${i}`,
      }),
    );
  }
  return zones;
}

/**
 * Creates an import edge for testing.
 */
export function makeEdge(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    from: "src/a.ts",
    to: "src/b.ts",
    type: "direct",
    ...overrides,
  };
}

/**
 * Creates minimal imports list for testing.
 */
export function makeImports(count: number = 3): Record<string, unknown>[] {
  const imports: Record<string, unknown>[] = [];
  for (let i = 1; i <= count; i++) {
    imports.push(
      makeEdge({
        from: `src/${i}.ts`,
        to: `src/${i + 1}.ts`,
      }),
    );
  }
  return imports;
}

/**
 * Creates a minimal manifest for testing.
 */
export function makeManifest(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: "sourcevision/v1",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a minimal manifest for quick test setup.
 */
export function minimalManifest(): Record<string, unknown> {
  return {
    schema: "sourcevision/v1",
    timestamp: "2024-01-01T00:00:00Z",
  };
}

/**
 * Creates a minimal inventory for quick test setup.
 */
export function minimalInventory(): Record<string, unknown> {
  return {
    files: [],
  };
}

/**
 * Creates a test data object with inventory and zones.
 */
export function makeTestData(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    inventory: makeInventory(),
    zones: makeZones(3),
    edges: makeImports(5),
    ...overrides,
  };
}

/**
 * Creates a finding object for testing.
 */
export function makeFinding(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "observation",
    severity: "info",
    title: "Test finding",
    description: "A test finding",
    ...overrides,
  };
}

/**
 * Creates a scan result for testing.
 */
export function makeScanResult(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    status: "success",
    findings: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a record/log entry for testing.
 */
export function makeRecord(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "record-1",
    timestamp: new Date().toISOString(),
    action: "test",
    ...overrides,
  };
}

/**
 * Writes a simple mock PRD for testing.
 */
export function writePRD(content: string): { path: string; content: string } {
  return { path: "prd.md", content };
}

/**
 * Creates a subtask or subitems fixture for testing.
 */
export function makeSubAnalysis(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    name: "sub-analysis",
    results: [],
    ...overrides,
  };
}

/**
 * Creates a task/item reference for testing.
 */
export function makeTask(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "task-1",
    title: "Test task",
    status: "pending",
    ...overrides,
  };
}

/**
 * Creates a test item for testing.
 */
export function makeItem(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "item-1",
    title: "Test item",
    ...overrides,
  };
}

/**
 * Mocks a Claude API response for testing.
 */
export function mockClaudeResponse(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "resp-1",
    content: [{ type: "text", text: "Test response" }],
    ...overrides,
  };
}

/**
 * Mocks a Claude API error for testing.
 */
export function mockClaudeError(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    status: 400,
    error: { type: "invalid_request_error", message: "Test error" },
    ...overrides,
  };
}

/** Every completed id in a fixture PRD tree, in walk order. */
export function completedIn(items: { status?: string; id?: string; children?: unknown[] }[]): string[] {
  return items.flatMap((item) => [
    ...(item.status === "completed" && item.id ? [item.id] : []),
    ...(item.children ? completedIn(item.children as typeof items) : []),
  ]);
}

/**
 * A rex double for the PR-markdown pipeline, serving a `.rex/prd.json` fixture.
 *
 * In production the collector spawns the real rex CLI twice — `rex tree
 * --format=json` for the PRD and `rex tree-diff --json` for what this branch
 * completed. Tests that are about what the *renderer* does with that pair use
 * this instead, which keeps them independent of a built rex on PATH and of the
 * fixture's git history. Which items count as branch work is rex's decision and
 * is tested in rex's own suite and in the collector's.
 *
 * `completed` defaults to every completed id, matching what rex reports when
 * the base branch has no PRD. Pass it explicitly to model a base branch that
 * had already completed something.
 */
export function fixtureRex(
  dir: string,
  completed?: string[],
): { readPRD: () => never; diffCompleted: () => Set<string> } {
  const load = (): { items: unknown[] } | null => {
    const path = joinPath(dir, ".rex", "prd.json");
    if (!existsSyncFn(path)) return null;
    const raw = readFileSyncFn(path, "utf-8");
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // An unparseable fixture stands for a PRD rex could not read, which rex
      // reports as "no document" rather than by failing. Mirrored here so the
      // malformed-input tests exercise the same path as production.
      return null;
    }
  };

  return {
    readPRD: () => load() as never,
    diffCompleted: () =>
      new Set(completed ?? completedIn((load()?.items ?? []) as Parameters<typeof completedIn>[0])),
  };
}
