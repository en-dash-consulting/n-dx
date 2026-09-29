/**
 * Rex's file access follows the project's folder layout, not a fixed directory.
 *
 * The paths module made the layout resolvable; this asserts the call sites
 * actually go through it. Every command below used to compose `join(dir, ".rex")`
 * itself, so on a `.ndx` project they would have written a second, unused `.rex/`
 * beside the real one and reported an empty PRD — a failure that looks like data
 * loss and produces no error. The legacy half of each pair is the regression
 * guard: routing through the resolver must not move a legacy project's files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdInit } from "../../../src/cli/commands/init.js";
import { cmdAdd } from "../../../src/cli/commands/add.js";
import { resolveStore, resolveRexPaths, PRD_TREE_DIRNAME } from "../../../src/store/index.js";
import { ensureLegacyPrdMigrated } from "../../../src/store/ensure-legacy-prd-migrated.js";
import { SCHEMA_VERSION } from "../../../src/schema/v1.js";

/** Where each layout keeps rex's state, relative to the project root. */
const LAYOUTS = [
  { name: "legacy", container: null, rexDir: ".rex" },
  { name: "ndx", container: ".ndx", rexDir: join(".ndx", "rex") },
] as const;

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "rex-layout-routing-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

/** Put the project on `layout` before any command runs. */
async function applyLayout(container: string | null): Promise<void> {
  if (container) await mkdir(join(projectDir, container), { recursive: true });
}

describe.each(LAYOUTS)("rex file access on the $name layout", ({ container, rexDir }) => {
  it("initializes into the layout's rex directory", async () => {
    await applyLayout(container);

    await cmdInit(projectDir, {});

    expect(resolveRexPaths(projectDir).rexDir).toBe(join(projectDir, rexDir));
    await expect(access(join(projectDir, rexDir, "config.json"))).resolves.toBeUndefined();
  });

  it("writes the folder tree where the layout puts it, and reads it back", async () => {
    await applyLayout(container);
    await cmdInit(projectDir, {});

    await cmdAdd(projectDir, "epic", { title: "Ship it", format: "json" });

    await expect(
      access(join(projectDir, rexDir, PRD_TREE_DIRNAME)),
      "the tree must land under the layout's rex directory",
    ).resolves.toBeUndefined();

    // Resolved the same way a command does, rather than from the literal above:
    // this is the round trip the CLI actually performs.
    const store = await resolveStore(resolveRexPaths(projectDir).rexDir);
    const doc = await store.loadDocument();
    expect(doc.items.map((i) => i.title)).toEqual(["Ship it"]);
  });

  it("does not create the other layout's directory", async () => {
    await applyLayout(container);
    await cmdInit(projectDir, {});

    const unused = container === null ? join(projectDir, ".ndx") : join(projectDir, ".rex");
    await expect(access(unused)).rejects.toThrow();
  });
});

describe("legacy PRD migration follows the layout", () => {
  it("migrates a prd.json that lives inside the .ndx container", async () => {
    await applyLayout(".ndx");
    await cmdInit(projectDir, {});

    const rexDir = resolveRexPaths(projectDir).rexDir;
    await rm(join(rexDir, PRD_TREE_DIRNAME), { recursive: true, force: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: SCHEMA_VERSION,
        title: "Legacy",
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            level: "epic",
            title: "Carried over",
            status: "pending",
            priority: "medium",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            children: [],
          },
        ],
      }),
      "utf-8",
    );

    const result = await ensureLegacyPrdMigrated(projectDir);

    expect(result.migrated).toBe(true);
    // Reported project-relative and posix-separated, so the banner that prints
    // it reads the same on every platform.
    expect(result.folderTreePath).toBe(`.ndx/rex/${PRD_TREE_DIRNAME}`);

    const doc = await (await resolveStore(rexDir)).loadDocument();
    expect(doc.items.map((i) => i.title)).toEqual(["Carried over"]);
    await expect(readFile(join(rexDir, "prd.json.migrated"), "utf-8")).resolves.toContain(
      "Carried over",
    );
  });
});
