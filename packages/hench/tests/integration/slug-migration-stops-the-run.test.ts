/**
 * Accepting the migration at the gate stops the run; it does not continue into
 * the task.
 *
 * This is the acceptance criterion the whole design turns on, and it is not
 * provable from `offerSlugMigration` alone — that function reports "migrated"
 * and returns, and whether the agent then runs anyway is a property of
 * `cmdRun`. Continuing would put the whole-tree rename into whatever commit the
 * task makes next, under a message about something else, which is the
 * 2026-09-17 incident with the human review step deleted rather than automated.
 *
 * The offer module is stubbed here on purpose: the real migration is exercised
 * against a real tree in `slug-migration-offer.test.ts`, and what needs pinning
 * at this level is the *control flow* out of the gate. Stubbing it also means
 * the accept path can be driven without a terminal.
 *
 * @see packages/hench/src/cli/commands/run.ts — the gate in cmdRun
 * @see packages/hench/tests/integration/slug-migration-offer.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

vi.mock("../../src/agent/lifecycle/loop.js", () => ({ agentLoop: vi.fn() }));
vi.mock("../../src/cli/slug-migration-offer.js", () => ({
  offerSlugMigration: vi.fn(),
}));

import { agentLoop } from "../../src/agent/lifecycle/loop.js";
import { offerSlugMigration } from "../../src/cli/slug-migration-offer.js";
import { cmdRun } from "../../src/cli/commands/run.js";
import { resolveStore, PRD_TREE_DIRNAME, TREE_META_FILENAME } from "../../src/prd/rex-gateway.js";
import { loadConfig, saveConfig } from "../../src/store/config.js";
import { setupProjectDir, cleanupProjectDir, commitGitFixtureBaseline } from "../helpers/index.js";

const DOC = {
  schema: "rex/v1",
  title: "Migration Stops The Run",
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
let henchDir: string;
let rexDir: string;
let treeRoot: string;

const mockedAgentLoop = agentLoop as unknown as Mock;
const mockedOffer = offerSlugMigration as unknown as Mock;

/** What a mismatched build leaves behind: a path under the superseded rule. */
async function reSuffixEpicDir(): Promise<void> {
  const entries = (await readdir(treeRoot)).filter((e) => e !== TREE_META_FILENAME);
  await rename(join(treeRoot, entries[0]), join(treeRoot, "child-process-cleanup-and-exit-epicab"));
}

beforeEach(async () => {
  ({ projectDir, henchDir, rexDir } = await setupProjectDir("hench-slug-offer-run-"));
  treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  await (await resolveStore(rexDir)).saveDocument(DOC as never);

  // The API provider keeps cmdRun off the vendor-CLI preflight, which would
  // otherwise need a `claude` binary on the machine running the suite.
  const config = await loadConfig(henchDir);
  await saveConfig(henchDir, { ...config, provider: "api", loopPauseMs: 0 });
  commitGitFixtureBaseline(projectDir);

  mockedAgentLoop.mockReset();
  mockedOffer.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
});

describe("cmdRun after the migration offer", () => {
  it("stops without executing the task when the migration ran", async () => {
    await reSuffixEpicDir();
    mockedOffer.mockResolvedValue({
      outcome: "migrated",
      report: "Migrated the PRD tree: 2 entries renamed. Review it, commit it, then start again.",
    });

    // Resolves rather than throwing: the migration succeeded, so this is not a
    // failure and must not be reported as one.
    await expect(cmdRun(projectDir, {})).resolves.toBeUndefined();

    // The task never ran, which is the point — the rename gets its own commit.
    expect(mockedAgentLoop).not.toHaveBeenCalled();
    // And nothing was claimed on the way past.
    expect(existsSync(join(projectDir, ".git", "ndx"))).toBe(false);
  });

  it("rethrows the refusal with the withheld note when the offer was withheld", async () => {
    await reSuffixEpicDir();
    mockedOffer.mockResolvedValue({
      outcome: "withheld",
      reason: "autonomous",
      note: "This run is autonomous (--auto, --loop or --epic-by-epic), so it was not offered.",
    });

    // The suggestion carries the note; the message still carries the diagnosis
    // of the tree, because "you were not offered the fix" is a fact about this
    // run, not a different problem with the repository.
    const err = await cmdRun(projectDir, { auto: "true" }).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/rex migrate-slugs/);
    expect((err as { suggestion?: string }).suggestion).toContain("not offered");
    expect((err as { suggestion?: string }).suggestion).toContain("Nothing has been claimed");
    expect(mockedAgentLoop).not.toHaveBeenCalled();
  });

  it("rethrows the refusal unchanged when the operator declines", async () => {
    await reSuffixEpicDir();
    mockedOffer.mockResolvedValue({ outcome: "declined" });

    const err = await cmdRun(projectDir, {}).catch((e: Error) => e);

    expect((err as Error).message).toMatch(/rex migrate-slugs/);
    // No trailing explanation about a withheld offer — they were asked, and
    // said no. The standing advice is the whole suggestion.
    expect((err as { suggestion?: string }).suggestion).not.toContain("not offered");
    expect(mockedAgentLoop).not.toHaveBeenCalled();
  });

  // A conformant tree must not reach the offer at all: consulting it would put
  // a subprocess resolution and a TTY check on the ordinary startup path.
  it("never consults the offer for a conformant tree", async () => {
    mockedAgentLoop.mockResolvedValue({
      run: {
        id: "run-1",
        taskId: "task-def456",
        taskTitle: "Harden the runner",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: "completed",
        turns: 1,
        tokenUsage: { input: 10, output: 5 },
        toolCalls: [],
        commits: [],
        uncommittedPaths: [],
        model: "test-model",
      },
    });

    await cmdRun(projectDir, { auto: "true" });

    expect(mockedOffer).not.toHaveBeenCalled();
    expect(mockedAgentLoop).toHaveBeenCalledTimes(1);
  });

  // The autonomous decision is made from the flags, and `--epic-by-epic` is
  // parsed further down cmdRun than the gate is. Reading it from the wrong
  // place would offer a migration to an unattended run.
  it.each([
    ["--auto", { auto: "true" }],
    ["--loop", { loop: "true" }],
    ["--epic-by-epic", { "epic-by-epic": "true" }],
    ["--yes", { yes: "true" }],
  ])("tells the offer that %s is unattended", async (_label, flags) => {
    await reSuffixEpicDir();
    mockedOffer.mockResolvedValue({ outcome: "withheld", reason: "autonomous", note: "n" });

    await cmdRun(projectDir, flags).catch(() => {});

    expect(mockedOffer).toHaveBeenCalledTimes(1);
    const run = mockedOffer.mock.calls[0][2] as { autonomous: boolean; assumeYes: boolean };
    expect(run.autonomous || run.assumeYes).toBe(true);
  });
});
