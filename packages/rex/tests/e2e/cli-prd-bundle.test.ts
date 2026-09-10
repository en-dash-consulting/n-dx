/**
 * E2E tests for the portable PRD bundle: `rex export` / `rex import-bundle`.
 *
 * The headline guarantee is fidelity — a bundle exported from one project and
 * imported into an empty one must reproduce an equivalent tree, not a lossy
 * approximation. The rest of the suite covers the guard rails: the bundle may
 * not be written into the PRD tree, a bundle from a newer rex is refused
 * before anything is written, merge never overwrites local content, and
 * replace will not run unattended without --yes.
 *
 * ## Why the source project is seeded by importing a bundle
 *
 * The obvious setup — hand-write the source tree with the `writePRD` test
 * helper — makes the fidelity assertion measure the wrong thing. That helper
 * emits its own simplified markdown (an absent priority comes back as
 * "medium"; a tag list comes back as a bare string), so a comparison against
 * it reports normalisation quirks of the fixture writer as bundle data loss.
 * Seeding through `rex import-bundle` puts the production serializer on both
 * ends, and the fixture bundle — whose fields this file controls exactly —
 * becomes the baseline the exported bundle is checked against.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writePRD, readPRD } from "../helpers/rex-dir-test-support.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import type { PRDItem } from "../../src/schema/index.js";

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

const EPIC_ONE = "11111111-1111-4111-8111-111111111111";
const FEATURE_ONE = "22222222-2222-4222-8222-222222222222";
const TASK_ONE = "33333333-3333-4333-8333-333333333333";
const EPIC_TWO = "44444444-4444-4444-8444-444444444444";
const TASK_TWO = "55555555-5555-4555-8555-555555555555";

// Cross-epic tree used by the scoped-export block.
const ALPHA_EPIC = "a0000000-0000-4000-8000-000000000001";
const ALPHA_ONE = "a0000000-0000-4000-8000-000000000002";
const ALPHA_TASK = "a0000000-0000-4000-8000-000000000003";
const ALPHA_TWO = "a0000000-0000-4000-8000-000000000004";
const ALPHA_SPARE = "a0000000-0000-4000-8000-000000000005";
const BETA_EPIC = "b0000000-0000-4000-8000-000000000001";
const BETA_ONE = "b0000000-0000-4000-8000-000000000002";
const BETA_TASK = "b0000000-0000-4000-8000-000000000003";
const BETA_TWO = "b0000000-0000-4000-8000-000000000004";

const ATTRIBUTION = "Someone Else <someone@example.com>";

const UUID_SHAPED = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/**
 * Vocabulary the narrative rendering must never emit.
 *
 * Listed literally rather than derived from `VALID_STATUSES` so this stays a
 * black-box assertion about the document: it holds even if someone renames or
 * removes an enum member, and it fails loudly if a new status is added without
 * being given prose.
 */
const INTERNAL_TOKENS = [
  "pending",
  "in_progress",
  "completed",
  "failing",
  "deferred",
  "blocked",
  "cancelled",
  "deleted",
  "critical",
  "high",
  "medium",
  "low",
  "blockedby",
  "acceptancecriteria",
];

/**
 * Run the CLI and return stdout + stderr combined.
 *
 * Both streams matter here: `result()` writes to stdout while `warn()` — which
 * carries the collision report — writes to stderr.
 */
function run(args: string[], expectFail = false): string {
  const proc = spawnSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 20000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = (proc.stdout ?? "") + (proc.stderr ?? "");
  if (proc.status !== 0 && !expectFail) {
    throw new Error(`rex ${args.join(" ")} exited ${proc.status}:\n${output}`);
  }
  return output;
}

/** Slice the JSON object out of output that may also carry informational lines. */
function jsonPayload(output: string): string {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`No JSON object in output:\n${output}`);
  return output.slice(start, end + 1);
}

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return { status: "pending", level: "task", ...overrides };
}

/**
 * Source items covering every field the bundle claims to preserve: two epics,
 * all three levels, a cross-epic dependency, tags, and attribution.
 *
 * `priority` and `acceptanceCriteria` are set on every item deliberately. The
 * folder tree fills both in when they are absent, and the point of this
 * fixture is to measure the bundle, not the tree's defaulting.
 */
function fixtureItems(): PRDItem[] {
  return [
    makeItem({
      id: EPIC_ONE,
      title: "First Epic",
      level: "epic",
      status: "in_progress",
      description: "The first epic",
      priority: "high",
      acceptanceCriteria: [],
      children: [
        makeItem({
          id: FEATURE_ONE,
          title: "First Feature",
          level: "feature",
          priority: "high",
          tags: ["alpha", "beta"],
          acceptanceCriteria: ["the feature works"],
          children: [
            makeItem({
              id: TASK_ONE,
              title: "First Task",
              description: "Does the first thing",
              acceptanceCriteria: ["it does the first thing", "it is tested"],
              priority: "medium",
              tags: ["alpha"],
              source: "ndx-capture",
              lastModifiedBy: ATTRIBUTION,
            }),
          ],
        }),
      ],
    }),
    makeItem({
      id: EPIC_TWO,
      title: "Second Epic",
      level: "epic",
      priority: "medium",
      acceptanceCriteria: [],
      children: [
        makeItem({
          id: TASK_TWO,
          title: "Second Task",
          status: "blocked",
          priority: "low",
          blockedBy: [TASK_ONE],
          acceptanceCriteria: [],
        }),
      ],
    }),
  ];
}

/** Fields the round-trip is required to preserve, flattened by id for comparison. */
const FIDELITY_FIELDS = [
  "title",
  "level",
  "status",
  "priority",
  "description",
  "acceptanceCriteria",
  "tags",
  "blockedBy",
  "source",
  "lastModifiedBy",
] as const;

interface FlatEntry {
  parentId: string | null;
  fields: Record<string, unknown>;
}

/** Flatten a tree to `id -> {parentId, fields}` so hierarchy and content compare independently of ordering. */
function flatten(items: PRDItem[], parentId: string | null = null): Map<string, FlatEntry> {
  const out = new Map<string, FlatEntry>();
  for (const item of items) {
    const fields: Record<string, unknown> = {};
    for (const key of FIDELITY_FIELDS) {
      if (item[key] !== undefined) fields[key] = item[key];
    }
    out.set(item.id, { parentId, fields });
    if (item.children) {
      for (const [id, entry] of flatten(item.children, item.id)) out.set(id, entry);
    }
  }
  return out;
}

describe("rex export / import-bundle", { timeout: 120_000 }, () => {
  let sourceDir: string;
  let targetDir: string;
  let bundlePath: string;
  let fixturePath: string;

  beforeEach(async () => {
    sourceDir = await mkdtemp(join(tmpdir(), "rex-bundle-src-"));
    targetDir = await mkdtemp(join(tmpdir(), "rex-bundle-dst-"));
    bundlePath = join(sourceDir, "prd-bundle.json");
    fixturePath = join(sourceDir, "fixture-bundle.json");

    // Seed the source project through the production write path.
    await writeFile(
      fixturePath,
      JSON.stringify({
        bundle: "rex/prd-bundle",
        bundleVersion: 1,
        schema: SCHEMA_VERSION,
        title: "Portable PRD",
        exportedAt: "2026-01-01T00:00:00.000Z",
        items: fixtureItems(),
      }),
    );
    run(["init", sourceDir]);
    run(["import-bundle", `--in=${fixturePath}`, sourceDir]);
  });

  afterEach(async () => {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  });

  async function readBundle(path = bundlePath): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  }

  describe("export", () => {
    it("writes a single JSON bundle carrying every item and the schema version", async () => {
      const output = run(["export", `--out=${bundlePath}`, sourceDir]);

      const bundle = await readBundle();
      expect(bundle.bundle).toBe("rex/prd-bundle");
      expect(bundle.bundleVersion).toBe(1);
      expect(bundle.schema).toBe(SCHEMA_VERSION);
      expect(bundle.title).toBe("Portable PRD");
      expect(output).toContain("5 items");
      expect(flatten(bundle.items as PRDItem[]).size).toBe(5);
    });

    it("reports the export as JSON when asked", () => {
      const output = run(["export", `--out=${bundlePath}`, "--format=json", sourceDir]);
      const parsed = JSON.parse(jsonPayload(output)) as Record<string, unknown>;
      expect(parsed.items).toBe(5);
      expect(parsed.schema).toBe(SCHEMA_VERSION);
    });

    it("refuses to write the bundle inside the PRD tree", () => {
      const inside = join(sourceDir, ".rex", PRD_TREE_DIRNAME, "bundle.json");
      const output = run(["export", `--out=${inside}`, sourceDir], true);

      expect(output).toMatch(/Refusing to write a bundle inside/);
      expect(existsSync(inside)).toBe(false);
    });

    it("requires --out", () => {
      expect(run(["export", sourceDir], true)).toMatch(/Missing --out path/);
    });

    it("rejects an unknown --format rather than silently writing a bundle", () => {
      const output = run(["export", `--out=${bundlePath}`, "--format=prose", sourceDir], true);
      expect(output).toMatch(/Unknown --format "prose"/);
      expect(existsSync(bundlePath)).toBe(false);
    });

  });

  /**
   * Scoped export carries one item between machines. The risk is not the
   * subtree — it is everything the subtree silently needs: a task blocked by
   * an item in a different epic, and the containers that place both. These
   * tests are about the closure and the report on it.
   */
  describe("scoped export", () => {
    /**
     * Replace the source PRD with a tree that has somewhere to reach.
     *
     * Two epics, each with two features, and a cross-epic dependency from a
     * task in the first to a task in the second — so a scope on ALPHA_ONE has
     * to leave its own epic to stay importable, and has three items it must
     * leave behind.
     */
    async function seedCrossEpic(): Promise<void> {
      const path = join(sourceDir, "cross-epic.json");
      await writeFile(
        path,
        JSON.stringify({
          bundle: "rex/prd-bundle",
          bundleVersion: 1,
          schema: SCHEMA_VERSION,
          title: "Portable PRD",
          exportedAt: "2026-01-01T00:00:00.000Z",
          items: [
            makeItem({
              id: ALPHA_EPIC,
              title: "Alpha Epic",
              level: "epic",
              children: [
                makeItem({
                  id: ALPHA_ONE,
                  title: "Alpha One",
                  level: "feature",
                  children: [makeItem({ id: ALPHA_TASK, title: "Alpha Task", blockedBy: [BETA_TASK] })],
                }),
                makeItem({
                  id: ALPHA_TWO,
                  title: "Alpha Two",
                  level: "feature",
                  children: [makeItem({ id: ALPHA_SPARE, title: "Alpha Spare" })],
                }),
              ],
            }),
            makeItem({
              id: BETA_EPIC,
              title: "Beta Epic",
              level: "epic",
              children: [
                makeItem({
                  id: BETA_ONE,
                  title: "Beta One",
                  level: "feature",
                  children: [makeItem({ id: BETA_TASK, title: "Beta Task" })],
                }),
                makeItem({ id: BETA_TWO, title: "Beta Two", level: "feature" }),
              ],
            }),
          ],
        }),
      );
      run(["import-bundle", `--in=${path}`, "--replace", "--yes", sourceDir]);
    }

    beforeEach(seedCrossEpic);

    it("carries the requested subtree, the cross-epic blocker, and both ancestor chains", async () => {
      run(["export", `--item=${ALPHA_ONE}`, `--out=${bundlePath}`, sourceDir]);

      const present = flatten((await readBundle()).items as PRDItem[]);

      // Requested: the feature and the task beneath it.
      expect(present.has(ALPHA_ONE)).toBe(true);
      expect(present.has(ALPHA_TASK)).toBe(true);
      // Dependency closure: the blocker in the other epic.
      expect(present.has(BETA_TASK)).toBe(true);
      // Ancestors, so both land at their original depth.
      expect(present.get(ALPHA_ONE)?.parentId).toBe(ALPHA_EPIC);
      expect(present.get(BETA_TASK)?.parentId).toBe(BETA_ONE);
      expect(present.get(BETA_ONE)?.parentId).toBe(BETA_EPIC);
      expect(present.get(BETA_EPIC)?.parentId).toBeNull();
      // Nothing the closure did not need.
      expect([...present.keys()].sort()).toEqual(
        [ALPHA_EPIC, ALPHA_ONE, ALPHA_TASK, BETA_EPIC, BETA_ONE, BETA_TASK].sort(),
      );
    });

    it("resolves a folder slug to the same item as its uuid", async () => {
      run(["export", `--item=${ALPHA_ONE}`, `--out=${bundlePath}`, sourceDir]);
      const byId = await readBundle();

      const bySlugPath = join(sourceDir, "by-slug.json");
      run(["export", "--item=alpha-one", `--out=${bySlugPath}`, sourceDir]);
      const bySlug = await readBundle(bySlugPath);

      expect(flatten(bySlug.items as PRDItem[])).toEqual(flatten(byId.items as PRDItem[]));
    });

    it("leaves no blockedBy edge pointing outside the bundle", async () => {
      run(["export", `--item=${ALPHA_ONE}`, `--out=${bundlePath}`, sourceDir]);

      const items = (await readBundle()).items as PRDItem[];
      const present = flatten(items);

      const targets: string[] = [];
      for (const [, entry] of present) {
        for (const target of (entry.fields.blockedBy as string[] | undefined) ?? []) {
          targets.push(target);
        }
      }

      expect(targets).toEqual([BETA_TASK]);
      for (const target of targets) expect(present.has(target)).toBe(true);
    });

    it("reports the requested subtree separately from what the closure pulled in", () => {
      const output = run(["export", `--item=${ALPHA_ONE}`, `--out=${bundlePath}`, sourceDir]);

      expect(output).toContain("6 items");
      expect(output).toMatch(/Scoped to "Alpha One": 2 requested items/);
      expect(output).toMatch(/Closure pulled in 1 blocking item and 3 ancestor containers/);
    });

    it("reports the scope as JSON when asked", () => {
      const output = run([
        "export",
        `--item=${ALPHA_ONE}`,
        `--out=${bundlePath}`,
        "--format=json",
        sourceDir,
      ]);

      const parsed = JSON.parse(jsonPayload(output)) as Record<string, unknown>;
      const scope = parsed.scope as Record<string, unknown>;

      expect(parsed.items).toBe(6);
      expect(scope.item).toEqual({
        id: ALPHA_ONE,
        title: "Alpha One",
        path: "alpha-epic/alpha-one",
      });
      expect(scope.requested).toBe(2);
      expect(scope.dependencies).toBe(1);
      expect(scope.ancestors).toBe(3);
      expect(scope.droppedEdges).toEqual([]);
    });

    it("round-trips a scoped bundle into an empty project with hierarchy and edges intact", () => {
      run(["export", `--item=${ALPHA_ONE}`, `--out=${bundlePath}`, sourceDir]);
      run(["init", targetDir]);
      run(["import-bundle", `--in=${bundlePath}`, targetDir]);

      const imported = flatten(readPRD(targetDir).items);

      expect([...imported.keys()].sort()).toEqual(
        [ALPHA_EPIC, ALPHA_ONE, ALPHA_TASK, BETA_EPIC, BETA_ONE, BETA_TASK].sort(),
      );
      expect(imported.get(ALPHA_ONE)?.parentId).toBe(ALPHA_EPIC);
      expect(imported.get(ALPHA_TASK)?.parentId).toBe(ALPHA_ONE);
      expect(imported.get(BETA_TASK)?.parentId).toBe(BETA_ONE);
      expect(imported.get(ALPHA_TASK)?.fields.blockedBy).toEqual([BETA_TASK]);
    });

    it("fails clearly on an unknown --item, writing no bundle", () => {
      const output = run(["export", "--item=nope", `--out=${bundlePath}`, sourceDir], true);
      expect(output).toMatch(/No PRD item matches --item="nope"/);
      expect(existsSync(bundlePath)).toBe(false);
    });

    it("refuses an ambiguous --item instead of exporting one of the candidates", () => {
      writePRD(sourceDir, {
        schema: SCHEMA_VERSION,
        title: "Portable PRD",
        items: [
          makeItem({
            id: ALPHA_EPIC,
            title: "Alpha Epic",
            level: "epic",
            children: [
              makeItem({ id: ALPHA_ONE, title: "Shared Title", level: "feature" }),
              makeItem({ id: ALPHA_TWO, title: "Shared Title", level: "feature" }),
            ],
          }),
        ],
      });

      const output = run(["export", "--item=Shared Title", `--out=${bundlePath}`, sourceDir], true);

      expect(output).toMatch(/matches 2 items/);
      expect(output).toMatch(new RegExp(ALPHA_ONE));
      expect(output).toMatch(new RegExp(ALPHA_TWO));
      expect(existsSync(bundlePath)).toBe(false);
    });

    it("refuses a valueless --item instead of exporting the whole PRD", () => {
      const output = run(["export", "--item", `--out=${bundlePath}`, sourceDir], true);
      expect(output).toMatch(/--item needs a value/);
      expect(existsSync(bundlePath)).toBe(false);
    });
  });

  /**
   * The narrative rendering shares this command's flag parsing, so its
   * coverage lives here. The renderer's own prose rules are unit-tested in
   * tests/unit/core/prd-narrative.test.ts; what matters at this level is that
   * the CLI selects it, scopes it, and refuses the same unsafe paths.
   */
  describe("narrative export", () => {
    let narrativePath: string;

    beforeEach(() => {
      narrativePath = join(sourceDir, "prd.md");
    });

    async function renderNarrativeDoc(extra: string[] = []): Promise<string> {
      run(["export", "--format=narrative", `--out=${narrativePath}`, ...extra, sourceDir]);
      return readFile(narrativePath, "utf-8");
    }

    it("writes prose Markdown while the default format stays the JSON bundle", async () => {
      const output = run(["export", "--format=narrative", `--out=${narrativePath}`, sourceDir]);
      expect(output).toMatch(/narrative document/);
      expect(await renderNarrativeDoc()).toMatch(/^# Portable PRD\n/);

      run(["export", `--out=${bundlePath}`, sourceDir]);
      expect((await readBundle()).bundle).toBe("rex/prd-bundle");
    });

    it("leaks no uuids, slugs or enum tokens from a real tree", async () => {
      const markdown = await renderNarrativeDoc(["--include-completed"]);

      expect(markdown).not.toMatch(UUID_SHAPED);
      expect(markdown).not.toContain(PRD_TREE_DIRNAME);
      for (const token of INTERNAL_TOKENS) {
        expect(markdown.toLowerCase(), `"${token}" leaked`).not.toMatch(
          new RegExp(`\\b${token}\\b`),
        );
      }
    });

    it("renders the dependency as sequencing prose, not an id", async () => {
      const markdown = await renderNarrativeDoc();
      expect(markdown).toContain("This follows on from “First Task”.");
    });

    it("scopes to a subtree by id", async () => {
      const markdown = await renderNarrativeDoc([`--item=${EPIC_TWO}`]);
      expect(markdown).toMatch(/^# Second Epic\n/);
      expect(markdown).not.toContain("First Feature");
    });

    it("scopes to a subtree by folder slug", async () => {
      const markdown = await renderNarrativeDoc(["--item=first-feature"]);
      expect(markdown).toMatch(/^# First Feature\n/);
      expect(markdown).toContain("## First Task");
      expect(markdown).not.toContain("Second Epic");
    });

    it("fails clearly on an unknown --item, writing nothing", () => {
      const output = run(
        ["export", "--format=narrative", `--out=${narrativePath}`, "--item=nope", sourceDir],
        true,
      );
      expect(output).toMatch(/No PRD item matches --item="nope"/);
      expect(existsSync(narrativePath)).toBe(false);
    });

    it("lists the candidates for an ambiguous --item instead of picking one", () => {
      writePRD(sourceDir, {
        schema: SCHEMA_VERSION,
        title: "Portable PRD",
        items: [
          makeItem({ id: EPIC_ONE, title: "Shared Title", level: "epic" }),
          makeItem({ id: EPIC_TWO, title: "Shared Title", level: "epic" }),
        ],
      });

      const output = run(
        ["export", "--format=narrative", `--out=${narrativePath}`, "--item=Shared Title", sourceDir],
        true,
      );

      expect(output).toMatch(/matches 2 items/);
      expect(output).toMatch(new RegExp(EPIC_ONE));
      expect(output).toMatch(new RegExp(EPIC_TWO));
      expect(existsSync(narrativePath)).toBe(false);
    });

    it("refuses a valueless --item instead of rendering the whole PRD", () => {
      const output = run(
        ["export", "--format=narrative", `--out=${narrativePath}`, "--item", sourceDir],
        true,
      );
      expect(output).toMatch(/--item needs a value/);
    });

    it("refuses to write the document inside the PRD tree", () => {
      const inside = join(sourceDir, ".rex", PRD_TREE_DIRNAME, "index.md");
      const output = run(
        ["export", "--format=narrative", `--out=${inside}`, sourceDir],
        true,
      );
      expect(output).toMatch(/Refusing to write a narrative document inside/);
    });

    it("tells the operator the output is one-way", () => {
      const output = run(["export", "--format=narrative", `--out=${narrativePath}`, sourceDir]);
      expect(output).toMatch(/one-way/);
      expect(output).toMatch(/rex export --out=<path\.json>/);
    });
  });

  describe("round-trip fidelity", () => {
    it("exports every field the source tree holds", async () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      const exported = await readBundle();

      expect(flatten(exported.items as PRDItem[])).toEqual(flatten(fixtureItems()));
    });

    it("reproduces an equivalent tree in an empty project", async () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      run(["init", targetDir]);
      run(["import-bundle", `--in=${bundlePath}`, targetDir]);

      const before = flatten(readPRD(sourceDir).items);
      const after = flatten(readPRD(targetDir).items);

      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [id, expected] of before) {
        const actual = after.get(id);
        expect(actual, `item ${id} missing after import`).toBeDefined();
        expect(actual?.parentId, `parent of ${id}`).toBe(expected.parentId);
        expect(actual?.fields, `fields of ${id}`).toEqual(expected.fields);
      }
    });

    it("preserves the cross-epic dependency edge", () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      run(["init", targetDir]);
      run(["import-bundle", `--in=${bundlePath}`, targetDir]);

      const after = flatten(readPRD(targetDir).items);
      expect(after.get(TASK_TWO)?.fields.blockedBy).toEqual([TASK_ONE]);
    });

    it("gives an attribution-only item a sync-visible timestamp without losing its author", () => {
      // TASK_ONE arrives from the fixture with lastModifiedBy but no
      // lastModified. Left that way it would be invisible to remote sync
      // forever (isModifiedSinceSync treats a missing timestamp as "never
      // modified"), so import defaults it to the bundle's exportedAt.
      const findTask = (items: PRDItem[]): PRDItem | undefined => {
        for (const item of items) {
          if (item.id === TASK_ONE) return item;
          const hit = item.children && findTask(item.children);
          if (hit) return hit;
        }
        return undefined;
      };

      const seeded = findTask(readPRD(sourceDir).items);
      expect(seeded?.lastModifiedBy).toBe(ATTRIBUTION);
      expect(seeded?.lastModified).toBe("2026-01-01T00:00:00.000Z");
    });

    it("preserves attribution metadata rather than re-stamping it", () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      run(["init", targetDir]);
      run(["import-bundle", `--in=${bundlePath}`, targetDir]);

      const after = flatten(readPRD(targetDir).items);
      expect(after.get(TASK_ONE)?.fields.lastModifiedBy).toBe(ATTRIBUTION);
    });

    it("records the exporting branch and commit as provenance", async () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      const bundle = await readBundle();
      // The temp dir is not a git repo, so provenance may be absent — but when
      // present it must be a shape import ignores rather than depends on.
      if (bundle.exportedFrom !== undefined) {
        expect(bundle.exportedFrom).toBeTypeOf("object");
      }
      expect(bundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("version gate", () => {
    it("refuses a bundle whose schema is newer than the running rex, writing nothing", async () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      const bundle = await readBundle();
      bundle.schema = "rex/v1.9";
      const tampered = join(sourceDir, "newer.json");
      await writeFile(tampered, JSON.stringify(bundle));

      run(["init", targetDir]);
      const output = run(["import-bundle", `--in=${tampered}`, targetDir], true);

      expect(output).toMatch(/newer than this rex supports/);
      expect(readPRD(targetDir).items).toHaveLength(0);
    });

    it("refuses a bundle whose envelope version is newer", async () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      const bundle = await readBundle();
      bundle.bundleVersion = 99;
      const tampered = join(sourceDir, "newer-envelope.json");
      await writeFile(tampered, JSON.stringify(bundle));

      run(["init", targetDir]);
      const output = run(["import-bundle", `--in=${tampered}`, targetDir], true);

      expect(output).toMatch(/Bundle format version 99 is newer/);
      expect(readPRD(targetDir).items).toHaveLength(0);
    });

    it("refuses a file that is not a bundle", async () => {
      const notABundle = join(sourceDir, "random.json");
      await writeFile(notABundle, JSON.stringify({ hello: "world" }));
      run(["init", targetDir]);

      expect(run(["import-bundle", `--in=${notABundle}`, targetDir], true)).toMatch(
        /not a rex PRD bundle/i,
      );
    });

    it("refuses a bundle carrying the same item id twice, in merge and replace modes alike", async () => {
      // Hand-crafted — export can never produce this, which is exactly why
      // import has to check: bundles arrive from outside rex's write path.
      const dupe = join(sourceDir, "duplicate-ids.json");
      await writeFile(
        dupe,
        JSON.stringify({
          bundle: "rex/prd-bundle",
          bundleVersion: 1,
          schema: SCHEMA_VERSION,
          title: "Duplicate Ids",
          exportedAt: "2026-01-01T00:00:00.000Z",
          items: [
            makeItem({ id: EPIC_ONE, title: "First claim", level: "epic" }),
            makeItem({ id: EPIC_ONE, title: "Second claim", level: "epic" }),
          ],
        }),
      );
      run(["init", targetDir]);

      const merged = run(["import-bundle", `--in=${dupe}`, targetDir], true);
      expect(merged).toMatch(new RegExp(EPIC_ONE));
      expect(merged).toMatch(/Nothing was written to the PRD/);
      expect(readPRD(targetDir).items).toHaveLength(0);

      const replaced = run(
        ["import-bundle", `--in=${dupe}`, "--replace", "--yes", targetDir],
        true,
      );
      expect(replaced).toMatch(/Nothing was written to the PRD/);
      expect(readPRD(targetDir).items).toHaveLength(0);
    });

    it("refuses malformed JSON", async () => {
      const broken = join(sourceDir, "broken.json");
      await writeFile(broken, "{ not json");
      run(["init", targetDir]);

      expect(run(["import-bundle", `--in=${broken}`, targetDir], true)).toMatch(/not valid JSON/);
    });

    it("requires --in", () => {
      run(["init", targetDir]);
      expect(run(["import-bundle", targetDir], true)).toMatch(/Missing --in path/);
    });
  });

  describe("collision policy", () => {
    /** Seed the target project with one of the bundle's ids, holding different content. */
    function seedTargetWithDivergentItem(): void {
      writePRD(targetDir, {
        schema: SCHEMA_VERSION,
        title: "Local PRD",
        items: [
          makeItem({
            id: EPIC_ONE,
            title: "First Epic renamed locally",
            level: "epic",
            status: "in_progress",
          }),
        ],
      });
    }

    it("merge keeps the local copy and reports the differing id", () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      seedTargetWithDivergentItem();

      const output = run(["import-bundle", `--in=${bundlePath}`, targetDir]);

      expect(output).toMatch(new RegExp(EPIC_ONE));
      expect(output).toMatch(/local copy was kept/);

      const after = flatten(readPRD(targetDir).items);
      expect(after.get(EPIC_ONE)?.fields.title).toBe("First Epic renamed locally");
      // The bundle's descendants are still grafted onto the kept item.
      expect(after.get(FEATURE_ONE)?.parentId).toBe(EPIC_ONE);
      expect(after.size).toBe(5);
    });

    it("replace refuses to run unattended without --yes", () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      seedTargetWithDivergentItem();

      const output = run(["import-bundle", `--in=${bundlePath}`, "--replace", targetDir], true);

      expect(output).toMatch(/Replace declined/);
      expect(flatten(readPRD(targetDir).items).size).toBe(1);
    });

    it("replace overwrites the tree with --yes", () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      seedTargetWithDivergentItem();

      run(["import-bundle", `--in=${bundlePath}`, "--replace", "--yes", targetDir]);

      const after = flatten(readPRD(targetDir).items);
      expect(after.size).toBe(5);
      expect(after.get(EPIC_ONE)?.fields.title).toBe("First Epic");
    });

    it("re-importing the same bundle is a no-op", () => {
      run(["export", `--out=${bundlePath}`, sourceDir]);
      run(["init", targetDir]);
      run(["import-bundle", `--in=${bundlePath}`, targetDir]);
      const first = flatten(readPRD(targetDir).items);

      const output = run(["import-bundle", `--in=${bundlePath}`, "--format=json", targetDir]);
      const parsed = JSON.parse(jsonPayload(output)) as { added: number; collisions: unknown[] };

      expect(parsed.added).toBe(0);
      expect(parsed.collisions).toHaveLength(5);
      expect([...flatten(readPRD(targetDir).items).keys()].sort()).toEqual(
        [...first.keys()].sort(),
      );
    });
  });
});
