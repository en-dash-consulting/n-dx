/**
 * `ndx log <event> [dir]` writes into the project it names, not the one the
 * shell happens to be sitting in.
 *
 * `ndx log --help` documents a trailing `[dir]`, and `rex log` has always read
 * it (event first, an optional directory after), but the orchestrator checked
 * `process.cwd()` for `.rex` before delegating. Run from anywhere that is not
 * itself a project — a sibling directory, a scratch dir, `$HOME` — the command
 * refused with NDX_CLI_NOT_INITIALIZED naming the *current* directory, so the
 * documented form was unusable exactly where it was needed.
 *
 * `[dir]` cannot come from the shared `resolveDir`, which takes the last
 * positional: the first positional here is the event name, so `ndx log
 * task_started` with no directory would look for a project at `./task_started`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { run, runFail, createTmpDir, removeTmpDir, setupRexDir } from "./e2e-helpers.js";

/** Entries the project's execution log holds. */
async function logEntries(projectDir) {
  const raw = await readFile(join(projectDir, ".rex", "execution-log.jsonl"), "utf-8");
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("ndx log [dir]", () => {
  let project;
  let outside;

  beforeAll(async () => {
    project = await createTmpDir("ndx-log-project-");
    outside = await createTmpDir("ndx-log-outside-");
    await setupRexDir(project);
  });

  afterAll(async () => {
    await removeTmpDir(project);
    await removeTmpDir(outside);
  });

  it("writes to <dir>/.rex/execution-log.jsonl when run from outside the project", async () => {
    run(["log", "ran_from_outside", "--detail=written through the dir argument", project], {
      cwd: outside,
    });

    const entries = await logEntries(project);
    expect(entries.map((e) => e.event)).toContain("ran_from_outside");
  });

  it("ties the entry to the item when --item is passed", async () => {
    run(["log", "tied_to_item", "--item=task-1", project], { cwd: outside });

    const entry = (await logEntries(project)).find((e) => e.event === "tied_to_item");
    expect(entry).toBeDefined();
    expect(entry.itemId).toBe("task-1");
  });

  it("still reads the current directory when no dir is given", async () => {
    run(["log", "ran_from_inside"], { cwd: project });

    const entries = await logEntries(project);
    expect(entries.map((e) => e.event)).toContain("ran_from_inside");
  });

  it("does not mistake the event name for a directory", () => {
    // The failure names the directory it checked; it must be the cwd, never
    // a path built from the event name.
    const { stderr, status } = runFail(["log", "some_event"], { cwd: outside });
    expect(status).not.toBe(0);
    expect(stderr).toContain(outside);
    expect(stderr).not.toContain("some_event");
  });
});
