/**
 * `ndx install-sample` / `destroy-sample` write the sample PRD items in the
 * layout the project has: a change with two tasks on a v2 tree (and no
 * `prd_tree/`), the hand-written epic tree on a v1 one.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTmpDir, removeTmpDir, run, runFail, setupRexDir } from "./e2e-helpers.js";

const V2_FIXTURE = join(import.meta.dirname, "../../packages/rex/tests/fixtures/v2-tree");

/** Every `.md` file under `dir`, relative, recursively. */
async function mdFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) out.push(join(entry.parentPath, entry.name));
  }
  return out;
}

async function titlesIn(dir) {
  const titles = [];
  for (const file of await mdFiles(dir)) {
    const title = /^title: "?(.+?)"?$/m.exec(await readFile(file, "utf8"))?.[1];
    if (title) titles.push(title);
  }
  return titles;
}

describe("ndx install-sample / destroy-sample", () => {
  let dir;

  beforeEach(async () => {
    dir = await createTmpDir("ndx-install-sample-");
  });
  afterEach(async () => {
    await removeTmpDir(dir);
  });

  it("v2: adds a change with two tasks, creates no prd_tree/, and destroy removes them", async () => {
    const rexDir = join(dir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v2", project: "p", adapter: "file", sourcevision: "auto" }));
    await cp(V2_FIXTURE, rexDir, { recursive: true });
    const before = await titlesIn(join(rexDir, "changes"));

    run(["install-sample", dir]);

    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
    expect(existsSync(join(dir, "sample-app", "app.js"))).toBe(true);
    const added = (await titlesIn(join(rexDir, "changes"))).filter((t) => !before.includes(t));
    expect(added.sort()).toEqual(["Add Dark Mode", "Fix Counter Bug", "Sample App Improvements"]);

    run(["destroy-sample", dir]);

    expect(existsSync(join(dir, "sample-app"))).toBe(false);
    expect(await titlesIn(join(rexDir, "changes"))).toEqual(before);
    expect(existsSync(join(rexDir, "changes", "inbox"))).toBe(false);
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
  });

  it("v2: destroy-sample fails naming the holder while the PRD lock is held, deleting nothing", async () => {
    const rexDir = join(dir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v2", project: "p", adapter: "file", sourcevision: "auto" }));
    await cp(V2_FIXTURE, rexDir, { recursive: true });
    run(["install-sample", dir]);
    const before = await titlesIn(join(rexDir, "changes"));

    await writeFile(join(rexDir, "prd.lock"), JSON.stringify({ pid: process.pid, token: "t", timestamp: new Date().toISOString() }));
    const failed = runFail(["destroy-sample", dir]);

    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain(`Held by PID ${process.pid}`);
    expect(await titlesIn(join(rexDir, "changes"))).toEqual(before);
    expect(existsSync(join(dir, "sample-app"))).toBe(true);
  });

  it("v1: writes the epic tree under prd_tree/ and destroy removes it", async () => {
    await setupRexDir(dir);
    const tree = join(dir, ".rex", "prd_tree");
    await mkdir(tree, { recursive: true });

    run(["install-sample", dir]);

    expect(await titlesIn(tree)).toEqual(
      expect.arrayContaining(["Sample App Improvements", "Interactive Elements", "Fix Counter Bug", "Add Dark Mode"]),
    );
    expect(existsSync(join(dir, ".rex", "product"))).toBe(false);

    run(["destroy-sample", dir]);

    expect(await mdFiles(tree)).toEqual([]);
  });
});
