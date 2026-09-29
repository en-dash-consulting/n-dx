/**
 * `rex init` must agree with the layout it actually wrote to.
 *
 * The regression this pins: init resolved its target through the paths module
 * (so a project with `.ndx/` present got `.ndx/rex/`) while the .gitignore
 * entries and the success line were still written as `.rex/...` literals. The
 * effect is not cosmetic — `.ndx/rex/execution-log.jsonl` was created while
 * only `.rex/execution-log*.jsonl` was ignored, so a generated log stayed
 * trackable and got committed by accident.
 *
 * Both layouts are covered, because a test on the new layout alone would pass
 * against a build that had simply swapped one literal for another.
 *
 * @see packages/rex/src/cli/commands/init.ts
 * @see packages/rex/src/store/paths.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../src/cli/commands/init.js";

describe("rex init is layout-aware", () => {
  let dir: string;
  let logged: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rex-init-layout-"));
    logged = [];
    // init reports the path it used; that line is part of the contract here,
    // so it is captured rather than silenced.
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("ignores and reports .rex/ on a legacy project", async () => {
    await cmdInit(dir, {});

    const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".rex/execution-log*.jsonl");
    expect(gitignore).toContain(".rex/n-dx_workflow.md");
    expect(gitignore).not.toContain(".ndx/rex/");

    expect(logged.join("\n")).toContain("Initialized .rex/");
  });

  it("ignores and reports .ndx/rex/ when the project is on the new layout", async () => {
    // A `.ndx/` directory at the root is what selects the new layout.
    await mkdir(join(dir, ".ndx"), { recursive: true });

    await cmdInit(dir, {});

    const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
    // The entry has to name the directory init actually wrote to.
    expect(gitignore).toContain(".ndx/rex/execution-log*.jsonl");
    expect(gitignore).toContain(".ndx/rex/n-dx_workflow.md");
    // And must not carry the legacy pattern, which would ignore a path nothing
    // writes to and leave the real log trackable — the reported bug.
    expect(gitignore).not.toContain(".rex/execution-log*.jsonl");

    expect(logged.join("\n")).toContain("Initialized .ndx/rex/");
  });

  it("covers the log it actually created, on either layout", async () => {
    // The check that would have caught the bug regardless of wording: whatever
    // path init wrote the log to must be matched by an entry it added.
    await mkdir(join(dir, ".ndx"), { recursive: true });
    await cmdInit(dir, {});

    const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
    const logDir = gitignore
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.endsWith("/execution-log*.jsonl"))
      ?.replace("/execution-log*.jsonl", "");

    expect(logDir).toBe(".ndx/rex");
    // The file is really there, under the directory the entry names.
    await expect(readFile(join(dir, ".ndx", "rex", "execution-log.jsonl"), "utf-8")).resolves.toBe("");
  });
});
