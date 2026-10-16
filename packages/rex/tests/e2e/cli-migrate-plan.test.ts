/**
 * E2E: `rex migrate-plan` writes a reviewable plan and nothing else.
 *
 * The guarantee under test is the one that makes planning safe to run on a
 * real project: it reads the PRD and writes two files outside `.rex/`, and
 * the folder tree comes back byte-for-byte as it went in. The second
 * guarantee is reproducibility — re-planning an unchanged tree produces an
 * identical file, which is what lets a reviewer diff two plans and see only
 * what the PRD actually changed.
 *
 * Every run here is `--rules-only`: the model passes cost money and need a
 * vendor, and what these tests assert — the files written, the tree left
 * alone, determinism — is settled by the rules pass.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir, symlink, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writePRD } from "../helpers/rex-dir-test-support.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import type { PRDItem } from "../../src/schema/index.js";

const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");

const AREA_EPIC = "11111111-1111-4111-8111-111111111111";
const CAPABILITY = "22222222-2222-4222-8222-222222222222";
const CHANGE_TASK = "33333333-3333-4333-8333-333333333333";
const CONSTRAINT = "44444444-4444-4444-8444-444444444444";
const RELEASE_EPIC = "55555555-5555-4555-8555-555555555555";
const RELEASE_CHILD = "66666666-6666-4666-8666-666666666666";

function item(id: string, level: PRDItem["level"], title: string, children: PRDItem[] = [], extra: Partial<PRDItem> = {}): PRDItem {
  return { id, level, title, status: "pending", priority: "medium", children, ...extra } as PRDItem;
}

/**
 * A tree with one of each classification the summary has a section for: an
 * area epic holding a capability and a constraint, a completed task under the
 * capability, and a release epic that dissolves.
 */
function seed(dir: string): void {
  writePRD(dir, {
    schema: SCHEMA_VERSION,
    title: "Planning fixture",
    items: [
      item(AREA_EPIC, "epic", "Rex", [
        item(
          CAPABILITY,
          "feature",
          "Task selection",
          [item(CHANGE_TASK, "task", "Add priority ordering", [], { status: "completed", completedAt: "2026-09-01T00:00:00.000Z" })],
          {
            status: "completed",
            description: "Picks the next actionable task by priority and dependencies.",
            acceptanceCriteria: ["Blocked tasks are skipped"],
          },
        ),
        item(CONSTRAINT, "feature", "PRD storage isolation", [], {
          description: "Concurrent writers are refused rather than merged.",
        }),
      ]),
      item(RELEASE_EPIC, "epic", "ndx 0.9.0", [item(RELEASE_CHILD, "feature", "Prepare the release notes")]),
    ],
  });
}

/** Every file under the PRD tree, path → contents, for an exact before/after comparison. */
async function snapshotTree(dir: string): Promise<Record<string, string>> {
  const root = join(dir, ".rex", PRD_TREE_DIRNAME);
  const out: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[relative(root, full).replace(/\\/g, "/")] = await readFile(full, "utf-8");
    }
  }
  await walk(root);
  return out;
}

function run(args: string[], expectFail = false): string {
  const proc = spawnSync("node", [cliPath, ...args], { encoding: "utf-8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
  const output = (proc.stdout ?? "") + (proc.stderr ?? "");
  if (proc.status !== 0 && !expectFail) throw new Error(`rex ${args.join(" ")} exited ${proc.status}:\n${output}`);
  if (proc.status === 0 && expectFail) throw new Error(`rex ${args.join(" ")} unexpectedly succeeded:\n${output}`);
  return output;
}

describe("rex migrate-plan", () => {
  let dir: string;
  let outPath: string;
  let summaryPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rex-migrate-plan-"));
    outPath = join(dir, "out", "migration-plan.json");
    summaryPath = join(dir, "out", "migration-plan.md");
    seed(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the plan and its summary, and leaves the PRD tree untouched", async () => {
    const before = await snapshotTree(dir);

    run(["migrate-plan", "--rules-only", `--out=${outPath}`, dir]);

    expect(existsSync(outPath)).toBe(true);
    expect(existsSync(summaryPath)).toBe(true);
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it("lists every v1 item with its target, the proposed areas with notes, and the proposed constraints", async () => {
    run(["migrate-plan", "--rules-only", `--out=${outPath}`, dir]);

    const plan = JSON.parse(await readFile(outPath, "utf-8"));
    // One entry per v1 item, keyed by its id, each carrying a target.
    expect(Object.keys(plan.entries).sort()).toEqual(
      [AREA_EPIC, CAPABILITY, CHANGE_TASK, CONSTRAINT, RELEASE_EPIC, RELEASE_CHILD].sort(),
    );
    for (const entry of Object.values<{ target?: string }>(plan.entries)) expect(entry.target).toBeTruthy();
    expect(plan.entries[AREA_EPIC].target).toBe("area");
    expect(plan.entries[RELEASE_EPIC].target).toBe("release");

    const summary = await readFile(summaryPath, "utf-8");
    expect(summary).toContain("## Proposed areas");
    expect(summary).toContain("## Proposed constraints");
    expect(summary).toContain("## Items");
    // Every item appears in the items table under its own id.
    for (const id of [AREA_EPIC, CAPABILITY, CHANGE_TASK, CONSTRAINT, RELEASE_EPIC, RELEASE_CHILD]) {
      expect(summary).toContain(`\`${id}\``);
    }
    // The area row carries the notes the classifier attached to it.
    const area = plan.summary.areas.find((a: { id: string }) => a.id === AREA_EPIC);
    expect(area).toBeDefined();
    for (const note of area.notes) expect(summary).toContain(note);
    expect(plan.summary.constraints.map((c: { source: string }) => c.source)).toContain(CONSTRAINT);
  });

  it("re-plans an unchanged tree into byte-identical files", async () => {
    run(["migrate-plan", "--rules-only", `--out=${outPath}`, dir]);
    const firstPlan = await readFile(outPath, "utf-8");
    const firstSummary = await readFile(summaryPath, "utf-8");

    run(["migrate-plan", "--rules-only", `--out=${outPath}`, dir]);

    expect(await readFile(outPath, "utf-8")).toBe(firstPlan);
    expect(await readFile(summaryPath, "utf-8")).toBe(firstSummary);
  });

  describe("re-plan cut time", () => {
    const OLD_CUT = "2020-01-01T00:00:00.000Z";
    const plan = async (): Promise<{ header: { cutAt: string } }> => JSON.parse(await readFile(outPath, "utf-8"));

    /** An analysis whose "task selection" zone lists `files`, each created on disk. */
    async function analyse(files: string[]): Promise<void> {
      await mkdir(join(dir, ".sourcevision"), { recursive: true });
      for (const file of files) await writeFile(join(dir, file), "export {};\n");
      await writeFile(
        join(dir, ".sourcevision", "zones.json"),
        JSON.stringify({ zones: [{ id: "task-selection", name: "Task selection", files }] }),
      );
    }

    it("reuses the earlier cut time while the PRD and the analysis are unchanged", async () => {
      await analyse(["selection.ts"]);
      run(["migrate-plan", "--rules-only", `--cut-at=${OLD_CUT}`, `--out=${outPath}`, dir]);
      const output = run(["migrate-plan", "--rules-only", `--out=${outPath}`, dir]);
      expect((await plan()).header.cutAt).toBe(OLD_CUT);
      expect(output).not.toContain("cut time was reset");
    });

    it("resets the cut time, and says so, when the earlier plan was made from a different PRD", async () => {
      run(["migrate-plan", "--rules-only", `--cut-at=${OLD_CUT}`, `--out=${outPath}`, dir]);
      writePRD(dir, {
        schema: SCHEMA_VERSION,
        title: "Another project",
        items: [item(AREA_EPIC, "epic", "Something else")],
      });

      const output = run(["migrate-plan", "--rules-only", `--out=${outPath}`, dir]);

      expect((await plan()).header.cutAt).not.toBe(OLD_CUT);
      expect(output).toContain("cut time was reset");
    });

    it("resets the cut time when only the sourcevision analysis changed", async () => {
      await analyse(["selection.ts"]);
      run(["migrate-plan", "--rules-only", `--cut-at=${OLD_CUT}`, `--out=${outPath}`, dir]);
      await analyse(["selection.ts", "ordering.ts"]);

      const output = run(["migrate-plan", "--rules-only", `--out=${outPath}`, dir]);

      expect((await plan()).header.cutAt).not.toBe(OLD_CUT);
      expect(output).toContain("cut time was reset");
    });

    it("lets --cut-at override a changed source", async () => {
      await analyse(["selection.ts"]);
      run(["migrate-plan", "--rules-only", `--cut-at=${OLD_CUT}`, `--out=${outPath}`, dir]);
      await analyse(["selection.ts", "ordering.ts"]);
      const newCut = "2021-02-03T00:00:00.000Z";

      const output = run(["migrate-plan", "--rules-only", `--cut-at=${newCut}`, `--out=${outPath}`, dir]);

      expect((await plan()).header.cutAt).toBe(newCut);
      expect(output).not.toContain("cut time was reset");
    });
  });

  it("refuses to write inside the rex directory", async () => {
    // The legacy backend path, which would be read *as* the PRD on a checkout
    // without the tree. The fixture writer leaves one there, so the assertion
    // is that it comes back untouched rather than that it is absent.
    const legacy = join(dir, ".rex", "prd.json");
    const before = await readFile(legacy, "utf-8");
    const output = run(["migrate-plan", "--rules-only", `--out=${legacy}`, dir], true);
    expect(output).toContain("Refusing to write");
    expect(await readFile(legacy, "utf-8")).toBe(before);
  });

  describe("state-directory guard compares real paths", () => {
    const refused = (target: string, flag = "out"): void => {
      const args = flag === "out"
        ? [`--out=${target}`]
        : [`--out=${outPath}`, `--summary=${target}`];
      const output = run(["migrate-plan", "--rules-only", ...args, dir], true);
      expect(output).toContain("Refusing to write");
      expect(existsSync(target)).toBe(false);
    };

    it.runIf(process.platform === "darwin" || process.platform === "win32")(
      "refuses a case variant of the rex directory",
      async () => {
        // Only meaningful where the volume folds case.
        if (!existsSync(join(dir, ".REX"))) return;
        refused(join(dir, ".REX", "plan.json"));
      },
    );

    it.skipIf(process.platform === "win32")("refuses a path through a symlink to the rex directory", async () => {
      await symlink(join(dir, ".rex"), join(dir, "alias"));
      refused(join(dir, "alias", "plan.json"));
    });

    it("refuses the real-path alias of the rex directory (/tmp vs /private/tmp)", async () => {
      refused(join(await realpath(dir), ".rex", "plan.json"));
    });

    it("refuses --out=.ndx/plan.json on a legacy layout and creates no .ndx/", async () => {
      refused(join(dir, ".ndx", "plan.json"));
      expect(existsSync(join(dir, ".ndx"))).toBe(false);
    });

    it("holds --summary to the same guard", async () => {
      refused(join(dir, ".ndx", "plan.md"), "summary");
      expect(existsSync(join(dir, ".ndx"))).toBe(false);
      expect(existsSync(outPath)).toBe(false);
    });
  });

  it("refuses a --summary inside the rex directory, before writing the plan", async () => {
    run(["migrate-plan", "--rules-only", `--out=${outPath}`, `--summary=${join(dir, ".rex", "prd.md")}`, dir], true);
    expect(existsSync(outPath)).toBe(false);
    expect(existsSync(join(dir, ".rex", "prd.md"))).toBe(false);
  });

  it("refuses a --summary that is the --out path, rather than overwriting the plan it just wrote", async () => {
    // The summary is written after the plan, so sharing the path destroyed the
    // plan in the same run and still reported success; the next run then
    // refused the Markdown as "not a migration plan file".
    await mkdir(join(dir, "out"), { recursive: true });
    const output = run(["migrate-plan", "--rules-only", `--out=${outPath}`, `--summary=${outPath}`, dir], true);
    expect(output).toContain("name the same file");
    expect(existsSync(outPath)).toBe(false);
  });

  it("refuses an --out that is not a plan file rather than overwriting it", async () => {
    await mkdir(join(dir, "out"), { recursive: true });
    await writeFile(outPath, "{}\n", "utf-8");
    const output = run(["migrate-plan", "--rules-only", `--out=${outPath}`, dir], true);
    expect(output).toContain("not a migration plan file");
    expect(await readFile(outPath, "utf-8")).toBe("{}\n");
  });

  it("names the registered migrations when asked for one that does not exist", () => {
    const output = run(["migrate-plan", "--rules-only", "--migration=v2-to-v3", `--out=${outPath}`, dir], true);
    expect(output).toContain("v1-to-v2");
  });
});
