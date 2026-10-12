/**
 * A throwaway project with a PRD, sourcevision output and hench runs, on
 * either layout, for the projection tests. The rex trees are rex's own
 * fixtures: the v2 tree (product and change layers) and the v1 `known-prd`
 * folder tree.
 */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveLayout } from "../../src/llm-gateway.js";

const REX_FIXTURES = resolve(import.meta.dirname, "../../../rex/tests/fixtures");
export const V2_TREE = join(REX_FIXTURES, "v2-tree");
export const V1_TREE = join(REX_FIXTURES, "folder-tree", "known-prd");

export interface ProjectOptions {
  layout?: "ndx" | "legacy";
  prd?: "v1" | "v2" | "none";
  sourcevision?: boolean;
  runs?: boolean;
}

export const ZONES = {
  zones: [
    { id: "checkout", name: "Checkout", description: "Paying for things", files: ["src/checkout/pay.ts", "src/checkout/cart.ts"], entryPoints: ["src/checkout/pay.ts"], cohesion: 0.8, coupling: 0.2,
      subZones: [{ id: "checkout-wallets", name: "Wallets", description: "", files: ["src/checkout/cart.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 }] },
    { id: "catalog", name: "Catalog", description: "What is for sale", files: ["src/catalog/list.ts"], entryPoints: [], cohesion: 0.7, coupling: 0.3 },
  ],
  crossings: [
    { from: "src/checkout/pay.ts", to: "src/catalog/list.ts", fromZone: "checkout", toZone: "catalog" },
    { from: "src/checkout/cart.ts", to: "src/catalog/list.ts", fromZone: "checkout", toZone: "catalog" },
  ],
  unzoned: [],
};

export const COMPONENTS = {
  components: [
    { file: "src/checkout/pay.ts", name: "PayButton", kind: "function", line: 12 },
    { file: "src/elsewhere/Loose.tsx", name: "Loose", kind: "arrow", line: 1 },
  ],
  usageEdges: [],
  routeModules: [],
  routeTree: [],
  serverRoutes: [],
  summary: {},
};

export const INVENTORY = {
  files: [
    { path: "src/checkout/pay.ts", size: 10, language: "typescript", lineCount: 40, role: "source", category: "code", hash: "a" },
    { path: "src/catalog/list.ts", size: 10, language: "typescript", lineCount: 12, role: "source", category: "code", hash: "b" },
  ],
  summary: {},
};

export function runRecord(id: string, taskId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    taskId,
    taskTitle: `Work on ${taskId}`,
    startedAt: "2026-10-01T10:00:00.000Z",
    finishedAt: "2026-10-01T10:20:00.000Z",
    status: "completed",
    turns: 7,
    tokenUsage: {},
    tokens: { input: 1000, output: 200, cached: 0, total: 1200 },
    toolCalls: [],
    model: "claude-sonnet-5",
    vendor: "claude",
    branch: "main",
    commits: [{ sha: "a".repeat(40), subject: "Do the thing" }],
    structuredSummary: { filesChanged: ["src/checkout/pay.ts"], filesRead: [], commandsExecuted: [], testsRun: [] },
    ...extra,
  };
}

export function makeProject(options: ProjectOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), "graview-project-"));
  const mode = options.layout ?? "legacy";
  if (mode === "ndx") mkdirSync(join(root, ".ndx"));
  const layout = resolveLayout(root);

  const prd = options.prd ?? "v2";
  if (prd === "v2") cpSync(V2_TREE, layout.rexDir, { recursive: true });
  else if (prd === "v1") cpSync(V1_TREE, join(layout.rexDir, "prd_tree"), { recursive: true });

  if (options.sourcevision !== false) {
    mkdirSync(layout.sourcevisionDir, { recursive: true });
    writeFileSync(join(layout.sourcevisionDir, "zones.json"), JSON.stringify(ZONES));
    writeFileSync(join(layout.sourcevisionDir, "components.json"), JSON.stringify(COMPONENTS));
    writeFileSync(join(layout.sourcevisionDir, "inventory.json"), JSON.stringify(INVENTORY));
  }

  if (options.runs !== false) {
    const runs = join(layout.henchDir, "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, "run-1.json"), JSON.stringify(runRecord("run-1", "orphan-task")));
    writeFileSync(join(runs, "run-2.json.gz"), gzipSync(JSON.stringify(runRecord("run-2", "orphan-task", { commits: [] }))));
    writeFileSync(join(runs, "run-1.json.gz"), gzipSync(JSON.stringify(runRecord("run-1", "orphan-task", { turns: 99 }))));
    writeFileSync(join(runs, ".tmp-run.json"), "{ not json");
  }
  return root;
}
