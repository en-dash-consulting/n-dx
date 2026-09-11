/**
 * `ndx prd` dispatch contract: the subcommand group actually drives rex, and
 * malformed invocations fail up front with an actionable message.
 *
 * Two concerns share this file because they share the surface:
 *
 * - **Flag shape.** The orchestrator's flag model keeps only `-`-prefixed
 *   tokens and treats the last bare token as the project directory, so in
 *   `ndx prd export --out bundle.json .` the path was dropped from the spawn
 *   and rex received `--out .` — an attempted write to the project directory
 *   itself, failing with a raw rename error and a stray tmp file beside the
 *   project. rex's own parser accepts the space form; the garbling was purely
 *   this tier, so this tier rejects the form up front.
 *
 * - **Dispatch.** `handlePrd` finds the subcommand positionally, drops it by
 *   index, maps `import` → rex `import-bundle`, and forwards flags — code a
 *   refactor breaks without any rex-tier test noticing. The round-trip block
 *   pins the whole chain through the orchestrator, and the error-path block
 *   pins the messages, including prototype-property names like `constructor`
 *   that a plain-object subcommand lookup would resolve to inherited junk.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { run, runFail, createTmpDir, removeTmpDir } from "./e2e-helpers.js";

describe("ndx prd rejects space-separated path flags", () => {
  let projectDir;

  beforeEach(async () => {
    projectDir = await createTmpDir("ndx-prd-args-");
  });

  afterEach(async () => {
    await removeTmpDir(projectDir);
  });

  /** Everything beside the project dir that carries its name — stray tmp files land there. */
  function siblingsOfProject() {
    return readdirSync(dirname(projectDir)).filter(
      (entry) => entry.startsWith(basename(projectDir)) && entry !== basename(projectDir),
    );
  }

  function expectRejected(args, flag) {
    const { status, stdout, stderr } = runFail(args);
    const output = stdout + stderr;

    expect(status).not.toBe(0);
    expect(output).toMatch(new RegExp(`${flag} needs a value`));
    expect(output).toMatch(new RegExp(`${flag}=`));
    // Rejected before anything ran: no project state, no stray temp files.
    expect(readdirSync(projectDir)).toEqual([]);
    expect(siblingsOfProject()).toEqual([]);
  }

  it("refuses `ndx prd export --out <path>`", () => {
    expectRejected(["prd", "export", "--out", "bundle.json", projectDir], "--out");
  });

  it("refuses `ndx prd import --in <path>`", () => {
    expectRejected(["prd", "import", "--in", "bundle.json", projectDir], "--in");
  });

  it("refuses `ndx prd export --item <ref>`", () => {
    expectRejected(
      ["prd", "export", "--item", "my-epic", "--out=bundle.json", projectDir],
      "--item",
    );
  });

  it("refuses `ndx prd export --format <name>`", () => {
    expectRejected(
      ["prd", "export", "--format", "narrative", "--out=prd.md", projectDir],
      "--format",
    );
  });

  it("still reports an unknown subcommand ahead of flag shape", () => {
    const { status, stdout, stderr } = runFail(["prd", "bogus", "--out", "x", projectDir]);
    expect(status).not.toBe(0);
    expect(stdout + stderr).toMatch(/Unknown 'ndx prd' subcommand: bogus/);
  });
});

describe("ndx prd subcommand errors", () => {
  it("reports a missing subcommand with a usage hint", () => {
    const { status, stdout, stderr } = runFail(["prd"]);
    expect(status).not.toBe(0);
    const output = stdout + stderr;
    expect(output).toMatch(/Missing 'ndx prd' subcommand/);
    expect(output).toMatch(/ndx prd export --out=/);
  });

  it("treats a prototype-property name as unknown, not as a command", () => {
    // A plain-object lookup resolves "constructor" to Object's inherited
    // constructor — truthy — and spawns a stringified function as a rex
    // command. The subcommand table must answer only for its own keys.
    for (const name of ["constructor", "toString", "hasOwnProperty"]) {
      const { status, stdout, stderr } = runFail(["prd", name]);
      expect(status, name).not.toBe(0);
      expect(stdout + stderr, name).toMatch(
        new RegExp(`Unknown 'ndx prd' subcommand: ${name}`),
      );
    }
  });
});

describe("ndx prd round trip", { timeout: 120_000 }, () => {
  let srcDir;
  let dstDir;

  beforeEach(async () => {
    srcDir = await createTmpDir("ndx-prd-src-");
    dstDir = await createTmpDir("ndx-prd-dst-");
  });

  afterEach(async () => {
    await removeTmpDir(srcDir);
    await removeTmpDir(dstDir);
  });

  /** Flatten bundle items to id -> {parentId, title, blockedBy} for order-independent comparison. */
  function flatten(items, parentId = null, out = new Map()) {
    for (const item of items) {
      out.set(item.id, { parentId, title: item.title, blockedBy: item.blockedBy ?? [] });
      if (item.children) flatten(item.children, item.id, out);
    }
    return out;
  }

  it("imports, exports, and re-imports a bundle entirely through the orchestrator", async () => {
    // Fixture bundle: two epics with a cross-epic dependency, so hierarchy
    // and edges both have to survive the trip. Schema literal matches rex's
    // SCHEMA_VERSION ("rex/v1"); a bump there should break this loudly.
    const fixture = join(srcDir, "fixture.json");
    await writeFile(
      fixture,
      JSON.stringify({
        bundle: "rex/prd-bundle",
        bundleVersion: 1,
        schema: "rex/v1",
        title: "Orchestrated PRD",
        exportedAt: "2026-01-01T00:00:00.000Z",
        items: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            title: "Epic A",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                title: "Task B",
                level: "task",
                status: "blocked",
                blockedBy: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
              },
            ],
          },
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            title: "Epic C",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                title: "Task D",
                level: "task",
                status: "pending",
              },
            ],
          },
        ],
      }),
    );

    run(["rex", "init", srcDir]);
    const imported = run(["prd", "import", `--in=${fixture}`, srcDir]);
    expect(imported).toMatch(/Imported 4 new items/);

    const bundleA = join(srcDir, "out.json");
    const exported = run(["prd", "export", `--out=${bundleA}`, srcDir]);
    expect(exported).toMatch(/Exported 4 items/);
    expect(existsSync(bundleA)).toBe(true);

    run(["rex", "init", dstDir]);
    run(["prd", "import", `--in=${bundleA}`, dstDir]);

    const bundleB = join(dstDir, "roundtrip.json");
    run(["prd", "export", `--out=${bundleB}`, dstDir]);

    const a = JSON.parse(readFileSync(bundleA, "utf-8"));
    const b = JSON.parse(readFileSync(bundleB, "utf-8"));
    expect(a.bundle).toBe("rex/prd-bundle");
    expect(flatten(b.items)).toEqual(flatten(a.items));
  });
});
