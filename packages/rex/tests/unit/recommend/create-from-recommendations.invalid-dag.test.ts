import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore } from "../../../src/store/index.js";
import { createItemsFromRecommendations } from "../../../src/recommend/create-from-recommendations.js";
import { readPRD, writePRD } from "../../helpers/rex-dir-test-support.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

async function writeFixtureProject(
  dir: string,
  items: PRDItem[] = [],
): Promise<void> {
  writePRD(dir, {
    schema: "rex/v1",
    title: "test-project",
    items,
  } as PRDDocument);
  await writeFile(join(dir, ".rex", "log.ndjson"), "");
}

async function readPrd(dir: string): Promise<{ items: PRDItem[] }> {
  return readPRD(dir);
}

describe("createItemsFromRecommendations invalid existing DAG handling", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-recommend-invalid-dag-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails before creation when the existing PRD contains orphan blockedBy references", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "existing-task",
        title: "Existing task",
        status: "blocked",
        level: "task",
        blockedBy: ["missing-task"],
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "New recommendation",
          level: "epic",
          description: "Should not be created",
          priority: "high",
          source: "sourcevision",
        },
      ]),
    ).rejects.toThrow(
      /Existing PRD DAG is invalid before adding recommendations: .*Orphan reference: "existing-task" blocked by unknown "missing-task".*Run 'rex fix'/,
    );

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(1);
  });
});
