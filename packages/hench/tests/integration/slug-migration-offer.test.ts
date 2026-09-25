/**
 * Offering `rex migrate-slugs` at the gate, and stopping rather than continuing.
 *
 * The gate refuses a tree this build would re-slug. Until this landed, that
 * refusal dead-ended the operator with an instruction to go and run the
 * migration by hand. The offer closes that loop — but only halfway on purpose:
 * it runs the migration and then *stops the run*, so the rename gets a commit
 * of its own instead of being swept into whatever commit the task makes next.
 * Continuing would rebuild the 2026-09-17 incident (1,570 re-slugged files
 * merged through green CI) with the human review step deleted.
 *
 * What is pinned here:
 *  - accepting really migrates: the tree on disk is conformant afterwards, and
 *    the report tells the operator to review and commit before re-running
 *  - declining changes nothing — the tree is byte-identical and the caller is
 *    left to rethrow its own refusal
 *  - an autonomous run is never asked, and is told which condition withheld it
 *  - so is a non-terminal run, a CI run, and one that passed `--yes`
 *  - a tree on a *newer* rule gets no offer at all, because migrating there is
 *    a downgrade wearing a migration's name
 *
 * The accept and decline cases spawn the real `rex migrate-slugs` against a real
 * non-conformant tree. A stub would prove the wiring and nothing else, and the
 * property under test — that the tree is left in a reviewable, conformant state
 * — is a property of the command, not of the call.
 *
 * @see packages/hench/src/cli/slug-migration-offer.ts
 * @see packages/rex/src/cli/commands/migrate-slugs.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdir, rename, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  offerSlugMigration,
  resolveRexCli,
  decideOffer,
  runningInCI,
  type RexCliCommand,
} from "../../src/cli/slug-migration-offer.js";
import { readTreeConformanceRefusal } from "../../src/cli/commands/run.js";
import { resolveStore, PRD_TREE_DIRNAME, TREE_META_FILENAME } from "../../src/prd/rex-gateway.js";
import { setupProjectDir, cleanupProjectDir } from "../helpers/index.js";

const DOC = {
  schema: "rex/v1",
  title: "Migration Offer",
  items: [
    {
      id: "epic-abc123",
      title: "Child Process Cleanup And Exit Hygiene",
      level: "epic" as const,
      status: "pending" as const,
      children: [
        {
          id: "task-def456",
          title: "Harden the runner",
          level: "task" as const,
          status: "pending" as const,
        },
      ],
    },
  ],
};

let projectDir: string;
let rexDir: string;
let treeRoot: string;

/** Every file in the tree with its content, for proving a decline wrote nothing. */
async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(current: string, rel: string): Promise<void> {
    for (const entry of await readdir(current)) {
      const abs = join(current, entry);
      const key = rel ? `${rel}/${entry}` : entry;
      if ((await stat(abs)).isDirectory()) await walk(abs, key);
      else out.set(key, await readFile(abs, "utf-8"));
    }
  }
  await walk(dir, "");
  return out;
}

/** Rename the epic directory into the superseded id-qualified form. */
async function reSuffixEpicDir(): Promise<string> {
  const entries = (await readdir(treeRoot)).filter((e) => e !== TREE_META_FILENAME);
  const foreign = "child-process-cleanup-and-exit-epicab";
  await rename(join(treeRoot, entries[0]), join(treeRoot, foreign));
  return foreign;
}

/**
 * Shift the slug-rule marker by `offset`, leaving every path where it is.
 *
 * Relative to whatever the tree was just written with, rather than to an
 * imported `SLUG_RULE_VERSION`: hench reaches rex only through its gateway, and
 * the version constant is not on that surface. The marker the store wrote *is*
 * this build's rule, so reading it back is both accurate and in-bounds.
 */
async function markRule(offset: number): Promise<void> {
  const metaPath = join(rexDir, TREE_META_FILENAME);
  const meta = JSON.parse(await readFile(metaPath, "utf-8")) as { slugRule: number };
  await writeFile(
    metaPath,
    JSON.stringify({ ...meta, slugRule: meta.slugRule + offset }),
    "utf-8",
  );
}

/** The refusal the gate would throw, which is what the offer is built from. */
async function refusal() {
  const found = await readTreeConformanceRefusal(rexDir);
  expect(found).not.toBeNull();
  return found!;
}

/** An interactive run that says yes, with the real CLI and real migration. */
const INTERACTIVE = { autonomous: false, assumeYes: false };

beforeEach(async () => {
  ({ projectDir, rexDir } = await setupProjectDir("hench-slug-offer-"));
  treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  await (await resolveStore(rexDir)).saveDocument(DOC as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
});

describe("offering the slug migration at the gate", () => {
  // The whole point. Not a stub: the tree really is re-slugged, and the check
  // that it worked is that the gate no longer refuses it.
  it("migrates the tree when the operator accepts, then stops", async () => {
    const foreign = await reSuffixEpicDir();
    const before = await refusal();
    expect(before.migratable).toBe(true);

    const prompt = vi.fn(async () => true);
    const printed: string[] = [];
    const result = await offerSlugMigration(projectDir, before, INTERACTIVE, {
      isTTY: true,
      prompt,
      write: (t) => printed.push(t),
      env: { ...process.env, CI: "" },
    });

    expect(result.outcome).toBe("migrated");
    // The offending path is named before the question is asked — the operator
    // is approving a rename they have been shown, not a promise about one.
    expect(printed.join("")).toContain(foreign);
    expect(prompt).toHaveBeenCalledTimes(1);

    // The tree is genuinely conformant now, judged by the same gate that refused it.
    expect(await readTreeConformanceRefusal(rexDir)).toBeNull();
    expect((await readdir(treeRoot)).includes(foreign)).toBe(false);

    // And the operator is told to commit it before starting a run again, which
    // is the property the whole "stop rather than continue" design exists for.
    const report = (result as { outcome: "migrated"; report: string }).report;
    expect(report).toMatch(/review/i);
    expect(report).toMatch(/commit/i);
    expect(report).toContain("rex restore");
    // Counts come from the spawned command's own JSON, so a non-zero rename
    // count is the proof that a real `rex migrate-slugs` ran and did the work
    // — without it this test would still pass if the offer silently no-opped
    // and something else happened to leave the tree conformant.
    expect(report).toMatch(/Migrated the PRD tree: [1-9]\d* entr(y|ies) renamed/);
  });

  it("changes nothing when the operator declines", async () => {
    await reSuffixEpicDir();
    const before = await snapshotTree(treeRoot);

    const result = await offerSlugMigration(projectDir, await refusal(), INTERACTIVE, {
      isTTY: true,
      prompt: async () => false,
      write: () => {},
      env: { ...process.env, CI: "" },
    });

    expect(result.outcome).toBe("declined");
    expect(await snapshotTree(treeRoot)).toEqual(before);
    // Still refused, so the caller rethrows the refusal it already had.
    expect(await readTreeConformanceRefusal(rexDir)).not.toBeNull();
  });

  // An unattended run has nobody to look at the diff before it is committed,
  // and that review is the entire safeguard. Withholding has to be silent about
  // nothing: the run is told which condition withheld it.
  it("never asks an autonomous run, and says why", async () => {
    await reSuffixEpicDir();
    const before = await snapshotTree(treeRoot);
    const prompt = vi.fn(async () => true);

    const result = await offerSlugMigration(
      projectDir,
      await refusal(),
      { autonomous: true, assumeYes: false },
      { isTTY: true, prompt, write: () => {}, env: { ...process.env, CI: "" } },
    );

    expect(result).toMatchObject({ outcome: "withheld", reason: "autonomous" });
    expect((result as { note: string }).note).toMatch(/--auto/);
    expect(prompt).not.toHaveBeenCalled();
    expect(await snapshotTree(treeRoot)).toEqual(before);
  });

  // `assertSlugRuleAdoptable` refuses this direction, so an offer here would
  // send the operator into a command that declines — and if it did not decline,
  // the two builds would ping-pong whole-tree renames between them.
  it("makes no offer at all for a tree on a newer rule", async () => {
    await markRule(+1);
    const found = await refusal();
    expect(found.migratable).toBe(false);
    const prompt = vi.fn(async () => true);

    const result = await offerSlugMigration(projectDir, found, INTERACTIVE, {
      isTTY: true,
      prompt,
      write: () => {},
      env: { ...process.env, CI: "" },
    });

    // "no-offer", not "withheld": the refusal already tells the operator to
    // upgrade rex and *not* to migrate, so adding "an offer was withheld"
    // would contradict the advice they are reading.
    expect(result).toEqual({ outcome: "no-offer" });
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe("who may be offered the migration", () => {
  const CLI: RexCliCommand = { command: "node", args: ["rex"], label: "rex migrate-slugs" };
  const base = {
    migratable: true,
    autonomous: false,
    assumeYes: false,
    isTTY: true,
    ci: false,
    cli: CLI as RexCliCommand | undefined,
  };

  it("offers an interactive run with a resolvable rex", () => {
    expect(decideOffer(base)).toEqual({ offer: true });
  });

  it.each([
    ["autonomous", { autonomous: true }],
    ["ci", { ci: true }],
    ["not-a-terminal", { isTTY: false }],
    ["assume-yes", { assumeYes: true }],
    ["no-rex-cli", { cli: undefined }],
  ])("withholds the offer for %s, with a note saying so", (reason, override) => {
    const decision = decideOffer({ ...base, ...override });

    expect(decision).toMatchObject({ outcome: "withheld", reason });
    expect((decision as { note: string }).note.length).toBeGreaterThan(0);
  });

  // Ordered ahead of every other condition so the newer-rule refusal never
  // acquires an "offer withheld" sentence contradicting its own advice.
  it("reports no-offer for a newer rule even when every other condition would withhold", () => {
    expect(
      decideOffer({ ...base, migratable: false, autonomous: true, isTTY: false, cli: undefined }),
    ).toEqual({ outcome: "no-offer" });
  });
});

describe("locating the rex CLI to migrate with", () => {
  // Without this the offer can never be made in the monorepo, and every accept
  // test above would be passing against a resolution that does not work.
  it("resolves a rex CLI from hench's own module graph", () => {
    const cli = resolveRexCli({});

    expect(cli).toBeDefined();
    expect(cli!.args[cli!.args.length - 1]).toMatch(/rex[\\/]dist[\\/]cli[\\/]index\.js$/);
  });

  // NDX_CLI_PATH is inherited by every descendant of `ndx`, so a nested
  // invocation can be handed a path to an install that has nothing to do with
  // this hench. resolveLauncherCli rejects those; the fallback still answers.
  it("ignores a launcher path naming a foreign install", () => {
    const cli = resolveRexCli({ NDX_CLI_PATH: "/nonexistent/ndx/cli.js" });

    expect(cli).toBeDefined();
    expect(cli!.label).toBe("rex migrate-slugs");
  });
});

describe("detecting CI", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["0", false],
    ["false", false],
    ["1", true],
    ["true", true],
  ])("reads CI=%s as %s", (value, expected) => {
    expect(runningInCI(value === undefined ? {} : { CI: value })).toBe(expected);
  });
});
