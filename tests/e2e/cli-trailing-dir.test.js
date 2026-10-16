/**
 * Commands whose first positional is not a directory still act on the project
 * their trailing `[dir]` names, not the one the shell happens to be sitting in.
 *
 * `ndx log <event> [dir]` and `ndx move <id> [dir]` both document a trailing
 * `[dir]`, and the matching `rex` subcommands have always read it (the named
 * thing first, an optional directory after). The orchestrator checked
 * `process.cwd()` for `.rex` before delegating, so run from anywhere that is
 * not itself a project — a sibling directory, a scratch dir, `$HOME` — both
 * refused with NDX_CLI_NOT_INITIALIZED naming the *current* directory, and the
 * documented form was unusable exactly where it was needed.
 *
 * `[dir]` cannot come from the shared `resolveDir`, which takes the last
 * positional: with no directory given that is the event name or the item id,
 * so `ndx log task_started` would look for a project at `./task_started` and
 * `ndx move abc --parent=def` at `./abc`. Both now go through
 * `resolveTrailingDir`, which these tests cover from each side.
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

describe("ndx move [dir]", () => {
  /** Two epics, so a move between them is observable. */
  const ITEMS = [
    {
      id: "epic-1",
      level: "epic",
      title: "First Epic",
      status: "pending",
      priority: "medium",
      children: [
        { id: "task-1", level: "task", title: "Movable Task", status: "pending", priority: "medium" },
      ],
    },
    { id: "epic-2", level: "epic", title: "Second Epic", status: "pending", priority: "medium", children: [] },
  ];

  let project;
  let outside;

  beforeAll(async () => {
    project = await createTmpDir("ndx-move-project-");
    outside = await createTmpDir("ndx-move-outside-");
    await setupRexDir(project, { items: ITEMS });
  });

  afterAll(async () => {
    await removeTmpDir(project);
    await removeTmpDir(outside);
  });

  it("reparents in <dir> when run from outside the project", async () => {
    const stdout = run(["move", "task-1", "--parent=epic-2", project], { cwd: outside });

    expect(stdout).toContain("Movable Task");
    expect(stdout).toContain("epic-2");
    // The item really moved in the named project, not just in the message.
    const moved = await readFile(join(project, ".rex", "prd_tree", "second-epic", "index.md"), "utf-8");
    expect(moved).toContain("Movable Task");
  });

  it("does not mistake the item id for a directory", () => {
    // With no trailing dir the id is the only positional, so the precondition
    // must fall back to the cwd rather than resolving ./<id>.
    const { stderr, status } = runFail(["move", "task-1", "--parent=epic-2"], { cwd: outside });
    expect(status).not.toBe(0);
    expect(stderr).toContain(outside);
    expect(stderr).not.toContain("task-1");
  });
});
