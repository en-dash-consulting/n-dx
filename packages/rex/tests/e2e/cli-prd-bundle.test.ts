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

    it("refuses --item for bundle export, pointing at the narrative rendering", () => {
      const output = run(["export", `--out=${bundlePath}`, `--item=${EPIC_ONE}`, sourceDir], true);
      expect(output).toMatch(/--item is not supported for bundle export yet/);
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
