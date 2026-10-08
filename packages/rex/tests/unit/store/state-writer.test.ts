/**
 * Per-folder `state.yaml`: the one module that reads and writes tool state.
 *
 * Pins the file contract the rest of v2 builds on: unknown keys survive every
 * write byte for byte, output is a pure function of content, writes refuse to
 * run outside the PRD lock, and `revisedAt` follows `ItemState.revisedAt`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  STATE_FILE_NAME,
  emptyStateFile,
  loadStateFile,
  parseStateYaml,
  saveStateFile,
  serializeStateYaml,
  type ProductSpec,
} from "../../../src/store/state-writer.js";
import { checkV2Rules, specHash, type RuleNode } from "../../../src/schema/v2-rules.js";
import { SCHEMA_VERSION_V2, type StateFile } from "../../../src/schema/v2.js";
import { FileStore } from "../../../src/store/file-adapter.js";
import { FolderTreeStore, ensureFolderTreeRexDir } from "../../../src/store/folder-tree-store.js";
import { withLock } from "../../../src/store/file-lock.js";
import { prdLockPath } from "../../../src/store/paths.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import type { PRDStore } from "../../../src/store/contracts.js";

const ID_A = "0b7f2c1e-0000-4000-8000-00000000000a";
const ID_B = "0b7f2c1e-0000-4000-8000-00000000000b";
const NO_SPECS: ReadonlyMap<string, ProductSpec> = new Map();

let tmpDir: string;
let rexDir: string;
let folder: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "rex-state-writer-"));
  rexDir = join(tmpDir, ".rex");
  await ensureFolderTreeRexDir(rexDir);
  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({ schema: SCHEMA_VERSION, project: "state-writer", adapter: "folder-tree" }),
    "utf-8",
  );
  folder = join(tmpDir, "product", "area");
  await mkdir(folder, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Run `fn` holding the PRD lock, as `withTransaction` does. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  return withLock(prdLockPath(rexDir), fn);
}

function save(file: StateFile, specs = NO_SPECS, now = new Date("2026-10-07T00:00:00.000Z")): Promise<boolean> {
  return locked(() => saveStateFile(folder, file, { rexDir, specs, now: () => now }));
}

async function readState(): Promise<string> {
  return readFile(join(folder, STATE_FILE_NAME), "utf-8");
}

describe("round-trip", () => {
  const WRITTEN_BY_NEWER = [
    `schema: "rex/v2.1"`,
    `items:`,
    `  "${ID_A}":`,
    `    status: "in_progress"`,
    `    futureRow: {"z": 1,  "a": [2, 1]}`,
    `    zz_plain: some plain words`,
    `futureTop: ["kept",   "as-is"]`,
    ``,
  ].join("\n");

  it("keeps unknown keys byte-identical when known fields change", async () => {
    await writeFile(join(folder, STATE_FILE_NAME), WRITTEN_BY_NEWER, "utf-8");
    const file = await loadStateFile(folder);
    file.items[ID_A].status = "completed";
    file.items[ID_A].completedAt = "2026-10-07T01:00:00.000Z";
    await save(file);

    const lines = (await readState()).split("\n");
    expect(lines).toContain(`    futureRow: {"z": 1,  "a": [2, 1]}`);
    expect(lines).toContain(`    zz_plain: some plain words`);
    expect(lines).toContain(`futureTop: ["kept",   "as-is"]`);
    expect(lines).toContain(`schema: "rex/v2.1"`);
    expect(lines).toContain(`    status: "completed"`);
  });

  it("keeps retired keys from an older draft, unconverted, through a write", async () => {
    const old = [`schema: "rex/v2"`, `items:`, `  "${ID_A}":`, `    specReviewed: true`, `  "${ID_B}":`, `    appliedIn: "e3d7052fe"`, ``].join("\n");
    await writeFile(join(folder, STATE_FILE_NAME), old, "utf-8");
    const file = await loadStateFile(folder);
    file.items[ID_B].status = "completed";
    await save(file);

    const reloaded = await loadStateFile(folder);
    expect(reloaded.items[ID_A]).toEqual({ specReviewed: true });
    expect(reloaded.items[ID_B]).toMatchObject({ status: "completed", appliedIn: "e3d7052fe" });
    expect(reloaded.items[ID_B].appliedAt).toBeUndefined();
  });

  it("exposes unknown values to callers, parsed", () => {
    const file = parseStateYaml(WRITTEN_BY_NEWER);
    expect(file.items[ID_A].futureRow).toEqual({ z: 1, a: [2, 1] });
    expect(file.items[ID_A].zz_plain).toBe("some plain words");
    expect(file.futureTop).toEqual(["kept", "as-is"]);
  });

  it("re-emits an unknown key canonically once a caller changes its value", () => {
    const file = parseStateYaml(WRITTEN_BY_NEWER);
    file.items[ID_A].futureRow = { z: 2, a: [2, 1] };
    expect(serializeStateYaml(file)).toContain(`    futureRow: {"a":[2,1],"z":2}\n`);
  });

  it("round-trips every known field through parse and serialize", () => {
    const file: StateFile = {
      schema: SCHEMA_VERSION_V2,
      items: {
        [ID_A]: {
          status: "completed",
          startedAt: "2026-10-01T00:00:00.000Z",
          completedAt: "2026-10-02T00:00:00.000Z",
          activeIntervals: [{ start: "2026-10-01T00:00:00.000Z", end: "2026-10-02T00:00:00.000Z" }],
          metAt: "abc",
          reviewedHash: "abc",
          checks: [{ requirementId: "r1", result: "pass", at: "2026-10-02T00:00:00.000Z", commit: "deadbeef" }],
          appliedAt: "2026-10-02T00:00:00.000Z",
          appliedAmendsHash: "def",
          prs: ["https://github.com/o/r/pull/1"],
          ready: false,
          resolutionDetail: "line one\nline \"two\": # not a comment",
        },
      },
    };
    expect(parseStateYaml(serializeStateYaml(file))).toEqual(file);
  });

  /** A capability that trips no rule, so a tree of them reports only what a test adds. */
  const cleanCapability = (id: string): RuleNode => {
    const spec = { statement: "Users can do a thing", criteria: [{ id: "c1", text: "It works" }] };
    return { id, type: "capability", title: id, slug: id, reviewedHash: specHash(spec), ...spec } as RuleNode;
  };

  it("loads a state.yaml that still carries retired commits, keeps the line, and reports it", async () => {
    const commitsLine = `    commits: [{"hash": "deadbeef", "author": "A", "authorEmail": "a@x", "timestamp": "2026-10-02T00:00:00.000Z"}]`;
    await writeFile(join(folder, STATE_FILE_NAME), [`schema: "rex/v2"`, `items:`, `  "${ID_A}":`, commitsLine, `    status: "in_progress"`, ``].join("\n"), "utf-8");
    const file = await loadStateFile(folder);
    file.items[ID_A].status = "completed";
    await save(file);
    expect((await readState()).split("\n")).toContain(commitsLine);

    const task = { id: ID_A, type: "task", title: "T", slug: "t", ...file.items[ID_A] } as RuleNode;
    const findings = checkV2Rules({ product: [{ id: "a", type: "area", title: "A", slug: "a", children: ["x", "y"].map(cleanCapability) } as RuleNode], changes: [{ id: "c", type: "change", title: "C", slug: "c", touches: ["x"], children: [task] } as RuleNode] }, { now: new Date() });
    expect(findings.map((f) => [f.rule, f.nodeId])).toEqual([["retired-state-field", ID_A]]);
  });

  it("reads CRLF files and a missing file as empty", async () => {
    expect(parseStateYaml(`schema: "rex/v2"\r\nitems:\r\n  "${ID_A}":\r\n    status: "pending"\r\n`).items[ID_A])
      .toEqual({ status: "pending" });
    expect(await loadStateFile(folder)).toEqual(emptyStateFile());
  });

  it("refuses a file with another schema stamp, naming it", async () => {
    await writeFile(join(folder, STATE_FILE_NAME), `schema: "rex/v1"\nitems: {}\n`, "utf-8");
    await expect(loadStateFile(folder)).rejects.toThrow(STATE_FILE_NAME);
  });

  it("refuses malformed structure with a line number", () => {
    expect(() => parseStateYaml(`schema: "rex/v2"\nitems:\n   "${ID_A}":\n`, "x/state.yaml")).toThrow("x/state.yaml:3");
    expect(() => parseStateYaml(`schema: "rex/v2"\nschema: "rex/v2"\nitems: {}\n`)).toThrow(/duplicate/i);
  });
});

describe("determinism", () => {
  function build(order: "forward" | "reverse"): StateFile {
    const a = { status: "in_progress" as const, startedAt: "2026-10-01T00:00:00.000Z", extra: { b: 1, a: 2 } };
    const b = { checks: [{ result: "fail" as const, at: "2026-10-03T00:00:00.000Z", requirementId: "r2" }], metAt: "h" };
    const rows: Array<[string, Record<string, unknown>]> = [[ID_A, a], [ID_B, b]];
    const reorder = <T,>(xs: T[]): T[] => (order === "forward" ? xs : [...xs].reverse());
    const items = Object.fromEntries(
      reorder(rows).map(([id, row]) => [id, Object.fromEntries(reorder(Object.entries(row)))]),
    );
    return order === "forward"
      ? { schema: SCHEMA_VERSION_V2, items, zeta: 1, alpha: 2 }
      : { alpha: 2, zeta: 1, items, schema: SCHEMA_VERSION_V2 };
  }

  it("serializes the same content to the same bytes whatever the insertion order", () => {
    expect(serializeStateYaml(build("reverse"))).toBe(serializeStateYaml(build("forward")));
  });

  it("writes known keys in schema order, rows by id, LF endings and a final newline", () => {
    const text = serializeStateYaml(build("reverse"));
    expect(text).toBe(
      [
        `schema: "rex/v2"`,
        `items:`,
        `  "${ID_A}":`,
        `    status: "in_progress"`,
        `    startedAt: "2026-10-01T00:00:00.000Z"`,
        `    extra: {"a":2,"b":1}`,
        `  "${ID_B}":`,
        `    metAt: "h"`,
        `    checks: [{"at":"2026-10-03T00:00:00.000Z","requirementId":"r2","result":"fail"}]`,
        `alpha: 2`,
        `zeta: 1`,
        ``,
      ].join("\n"),
    );
    expect(text).not.toContain("\r");
  });

  it("is stable under repeated round-trips and leaves an unchanged file untouched", async () => {
    await save(build("forward"));
    const first = await readState();
    expect(serializeStateYaml(parseStateYaml(first))).toBe(first);

    const old = new Date("2020-01-01T00:00:00.000Z");
    await utimes(join(folder, STATE_FILE_NAME), old, old);
    expect(await save(parseStateYaml(first))).toBe(false);
    expect((await stat(join(folder, STATE_FILE_NAME))).mtime.getTime()).toBe(old.getTime());
  });

  it("writes an empty item map as {} and drops empty rows", () => {
    expect(serializeStateYaml({ schema: SCHEMA_VERSION_V2, items: { [ID_A]: {} } })).toBe(`schema: "rex/v2"\nitems: {}\n`);
  });
});

describe("locking", () => {
  const STORES: Array<{ name: string; create: (dir: string) => PRDStore }> = [
    { name: "FileStore", create: (dir) => new FileStore(dir) },
    { name: "FolderTreeStore", create: (dir) => new FolderTreeStore(dir) },
  ];

  it("refuses to write outside the PRD lock and writes nothing", async () => {
    const file = emptyStateFile();
    file.items[ID_A] = { status: "completed" };
    await expect(saveStateFile(folder, file, { rexDir, specs: NO_SPECS })).rejects.toThrow(/withTransaction/);
    await expect(stat(join(folder, STATE_FILE_NAME))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(STORES)("writes inside $name.withTransaction", async ({ create }) => {
    const store = create(rexDir);
    await store.saveDocument({ schema: SCHEMA_VERSION, title: "t", items: [] });
    await store.withTransaction(async () => {
      const file = await loadStateFile(folder);
      file.items[ID_A] = { status: "completed" };
      await saveStateFile(folder, file, { rexDir, specs: NO_SPECS });
    });
    expect((await loadStateFile(folder)).items[ID_A]).toEqual({ status: "completed" });
  });

  it("refuses a write holding another workspace's lock", async () => {
    const otherRex = join(tmpDir, "other", ".rex");
    await mkdir(otherRex, { recursive: true });
    await expect(
      withLock(prdLockPath(otherRex), () => saveStateFile(folder, emptyStateFile(), { rexDir, specs: NO_SPECS })),
    ).rejects.toThrow(/withTransaction/);
  });

  it("refuses an invalid row before touching disk", async () => {
    const file = emptyStateFile();
    file.items[ID_A] = { status: "finished" as never };
    await expect(save(file)).rejects.toThrow(/status/);
    await expect(stat(join(folder, STATE_FILE_NAME))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("revisedAt", () => {
  const MET: ProductSpec = { statement: "Users can export.", criteria: [{ id: "c1", text: "CSV" }] };
  const EDIT_1: ProductSpec = { statement: "Users can export.", criteria: [{ id: "c1", text: "CSV and JSON" }] };
  const EDIT_2: ProductSpec = { statement: "Users can export reports.", criteria: [{ id: "c1", text: "CSV and JSON" }] };
  const t = (day: number): Date => new Date(Date.UTC(2026, 9, day));

  async function step(spec: ProductSpec, day: number, mutate?: (file: StateFile) => void): Promise<StateFile> {
    const file = await loadStateFile(folder);
    mutate?.(file);
    await save(file, new Map([[ID_A, spec]]), t(day));
    return loadStateFile(folder);
  }

  beforeEach(async () => {
    await save({ schema: SCHEMA_VERSION_V2, items: { [ID_A]: { metAt: specHash(MET) } } });
  });

  it("is not set while the spec still hashes to metAt", async () => {
    expect((await step(MET, 1)).items[ID_A].revisedAt).toBeUndefined();
  });

  it("is stamped by the first edit and kept across later edits and state writes", async () => {
    expect((await step(EDIT_1, 1)).items[ID_A].revisedAt).toBe(t(1).toISOString());
    expect((await step(EDIT_2, 2)).items[ID_A].revisedAt).toBe(t(1).toISOString());
    const after = await step(EDIT_2, 3, (file) => {
      file.items[ID_A].reviewedHash = specHash(EDIT_2);
      file.items[ID_A].checks = [{ requirementId: "r1", result: "pass", at: t(3).toISOString() }];
    });
    expect(after.items[ID_A].revisedAt).toBe(t(1).toISOString());
  });

  it("is cleared by a revert to the met text, so the next revision starts its own age", async () => {
    await step(EDIT_1, 1);
    expect((await step(MET, 2)).items[ID_A].revisedAt).toBeUndefined();
    expect((await step(EDIT_1, 5)).items[ID_A].revisedAt).toBe(t(5).toISOString());
  });

  it("is cleared by a re-stamp of metAt", async () => {
    await step(EDIT_1, 1);
    const after = await step(EDIT_1, 2, (file) => {
      file.items[ID_A].metAt = specHash(EDIT_1);
    });
    expect(after.items[ID_A].revisedAt).toBeUndefined();
    expect((await step(EDIT_2, 4)).items[ID_A].revisedAt).toBe(t(4).toISOString());
  });

  it("is never set on a node that was never met", async () => {
    await locked(async () => {
      const file = await loadStateFile(folder);
      file.items[ID_B] = { reviewedHash: specHash(EDIT_1) };
      await saveStateFile(folder, file, { rexDir, specs: new Map([[ID_B, EDIT_1]]), now: () => t(1) });
    });
    expect((await loadStateFile(folder)).items[ID_B].revisedAt).toBeUndefined();
  });

  it("is left alone for nodes the write names no spec for", async () => {
    await step(EDIT_1, 1);
    const file = await loadStateFile(folder);
    await save(file, NO_SPECS, t(9));
    expect((await loadStateFile(folder)).items[ID_A].revisedAt).toBe(t(1).toISOString());
  });
});
