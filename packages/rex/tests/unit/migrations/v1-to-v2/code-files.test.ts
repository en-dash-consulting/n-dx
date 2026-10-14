import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../../src/schema/v1.js";
import { classifyV1Tree } from "../../../../src/migrations/v1-to-v2/migration-plan.js";
import { draftCapabilitySpecs } from "../../../../src/migrations/v1-to-v2/capability-spec.js";
import { readCapabilityCodeFiles } from "../../../../src/migrations/v1-to-v2/code-files.js";

let seq = 0;
function item(level: ItemLevel, title: string, children: PRDItem[] = [], status: ItemStatus = "completed", extra: Partial<PRDItem> = {}): PRDItem {
  seq += 1;
  return { id: `${level}-${seq}`, level, title, status, children, ...extra };
}

const TEST_FILES = [
  "packages/rex/tests/unit/core/next-task.test.ts",
  "packages/web/tests/unit/live-tab.test.ts",
];

/** Two capabilities: one the analysis knows about, one it does not. */
function tree(): PRDItem[] {
  return [
    item("epic", "Rex", [
      item("feature", "Task selection", [], "completed", {
        description: "Picks the next actionable task by priority and dependencies.",
        acceptanceCriteria: ["Selection honours blockedBy", "The next task is chosen by priority"],
      }),
      item("feature", "Billing portal", [], "completed", {
        description: "Shows invoices and payment methods.",
        acceptanceCriteria: ["Invoices list the amount charged"],
      }),
    ]),
  ];
}

const ZONES = {
  zones: [
    {
      id: "rex-task-selection",
      name: "Rex Task Selection",
      description: "Chooses the next task",
      files: ["packages/rex/src/core/next-task.ts", "packages/rex/src/core/ready.ts", "packages/rex/tests/unit/core/next-task.test.ts"],
    },
    { id: "web-viewer", name: "Web Viewer", description: "The dashboard", files: ["packages/web/src/viewer/graph.ts"] },
  ],
};

const IMPORTS = {
  edges: [
    { from: "packages/rex/tests/unit/core/next-task.test.ts", to: "packages/rex/src/core/priority.ts" },
    { from: "packages/rex/tests/unit/core/next-task.test.ts", to: "packages/rex/tests/helpers/fixture.test.ts" },
    { from: "packages/rex/src/core/next-task.ts", to: "packages/rex/src/core/tree.ts" },
  ],
};

async function writeAnalysis(dir: string, files: Record<string, unknown>): Promise<void> {
  const svDir = join(dir, ".sourcevision");
  await mkdir(svDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(svDir, name), JSON.stringify(body), "utf-8");
  }
}

describe("readCapabilityCodeFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-code-files-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("builds the map from zones and the files a capability's tests exercise, and the drafter's specs carry it", async () => {
    await writeAnalysis(tempDir, { "zones.json": ZONES, "imports.json": IMPORTS });
    const items = tree();

    const codeFiles = await readCapabilityCodeFiles(tempDir, items, { testFiles: TEST_FILES });

    const selection = items[0]!.children![0]!.id;
    expect(codeFiles[selection]).toEqual([
      // From the matching zone, its own test file dropped…
      "packages/rex/src/core/next-task.ts",
      // …plus what that test imports, the test it imports dropped.
      "packages/rex/src/core/priority.ts",
      "packages/rex/src/core/ready.ts",
    ]);
    // No zone and no test names the other capability.
    expect(codeFiles[items[0]!.children![1]!.id]).toBeUndefined();

    const specs = draftCapabilitySpecs(classifyV1Tree(items), items, { testFiles: TEST_FILES, codeFiles });
    expect(specs.find((s) => s.title === "Task selection")!.codeFiles).toEqual(codeFiles[selection]);
    expect(specs.find((s) => s.title === "Billing portal")!.codeFiles).toEqual([]);
  });

  it("returns an empty map with no .sourcevision directory, leaving the plan unchanged", async () => {
    const items = tree();

    const codeFiles = await readCapabilityCodeFiles(tempDir, items, { testFiles: TEST_FILES });

    expect(codeFiles).toEqual({});
    const withReader = draftCapabilitySpecs(classifyV1Tree(items), items, { testFiles: TEST_FILES, codeFiles });
    const without = draftCapabilitySpecs(classifyV1Tree(items), items, { testFiles: TEST_FILES });
    expect(withReader).toEqual(without);
    expect(withReader.every((s) => s.codeFiles.length === 0)).toBe(true);
  });

  it("reads the legacy flat zone array and survives a missing imports.json", async () => {
    await writeAnalysis(tempDir, { "zones.json": ZONES.zones });
    const items = tree();

    const codeFiles = await readCapabilityCodeFiles(tempDir, items, { testFiles: TEST_FILES });

    expect(codeFiles[items[0]!.children![0]!.id]).toEqual(["packages/rex/src/core/next-task.ts", "packages/rex/src/core/ready.ts"]);
  });

  it("drops a zone tie too wide to name one capability", async () => {
    const generic = {
      zones: [
        { id: "a-task-selection", name: "Task Selection A", files: ["a.ts"] },
        { id: "b-task-selection", name: "Task Selection B", files: ["b.ts"] },
        { id: "c-task-selection", name: "Task Selection C", files: ["c.ts"] },
      ],
    };
    await writeAnalysis(tempDir, { "zones.json": generic });
    const items = tree();

    const codeFiles = await readCapabilityCodeFiles(tempDir, items, { testFiles: TEST_FILES });

    expect(codeFiles[items[0]!.children![0]!.id]).toBeUndefined();
  });

  it("matches a zone on the title alone, so criteria words cannot reach an unrelated zone", async () => {
    await writeAnalysis(tempDir, {
      "zones.json": { zones: [{ id: "web-import-graph", name: "Import Graph", files: ["packages/web/src/viewer/views/import-graph/model.ts"] }] },
    });
    const items = [
      item("epic", "Sourcevision", [
        item("feature", "Zone detection", [], "completed", { acceptanceCriteria: ["Zones are detected from the import graph"] }),
      ]),
    ];

    const codeFiles = await readCapabilityCodeFiles(tempDir, items, { testFiles: TEST_FILES });

    expect(codeFiles[items[0]!.children![0]!.id]).toBeUndefined();
  });

  it("caps the files one capability carries, keeping the paths that name it", async () => {
    const wide = {
      zones: [
        {
          id: "rex-task-selection",
          name: "Rex Task Selection",
          files: [...Array(10).keys()].map((i) => `packages/rex/src/other/file-${i}.ts`).concat("packages/rex/src/core/selection.ts"),
        },
      ],
    };
    await writeAnalysis(tempDir, { "zones.json": wide });
    const items = tree();

    const codeFiles = await readCapabilityCodeFiles(tempDir, items, { testFiles: TEST_FILES, maxFiles: 2 });

    const files = codeFiles[items[0]!.children![0]!.id]!;
    expect(files).toHaveLength(2);
    expect(files).toContain("packages/rex/src/core/selection.ts");
  });
});
