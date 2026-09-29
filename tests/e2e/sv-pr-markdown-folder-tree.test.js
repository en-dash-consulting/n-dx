/**
 * `sv pr-markdown` on a folder-tree project.
 *
 * This is the regression test for a live defect: the PR markdown's branch-work
 * collector used to read `.rex/prd.md`, which does not exist once a project has
 * migrated to `.rex/prd_tree/`. Every folder-tree project — which is every
 * project — therefore got an empty Completed Work section, and nothing failed
 * to say so. The collector now goes through rex (`rex tree --format=json` and
 * `rex tree-diff --json`), and this test is the one that runs those spawns for
 * real rather than against a double.
 *
 * It deliberately asserts on the *rendered* markdown rather than on the
 * collector's return value: the defect was invisible at every layer except the
 * output a human reads, so that is the layer worth pinning.
 *
 * @see packages/sourcevision/src/analyzers/branch-work-collector.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { run, createTmpDir, removeTmpDir } from "./e2e-helpers.js";

const REX_CLI = join(import.meta.dirname, "../../packages/rex/dist/cli/index.js");

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/**
 * A directory holding a `rex` executable that runs *this* checkout's build.
 *
 * sourcevision spawns a bare `rex` — rex is not one of its dependencies, by
 * design, since two domain packages must not import each other. That leaves the
 * ambient PATH deciding which rex answers, and on a developer machine with a
 * globally linked n-dx that is a different checkout entirely. Putting a shim
 * first on PATH is what makes this test exercise the code under review.
 *
 * Both forms are written because the spawn path differs by platform: POSIX
 * execs the file directly, Windows routes through `cmd.exe`, which resolves
 * `rex` to `rex.cmd`.
 */
async function rexShimDir(root) {
  const binDir = join(root, "shim-bin");
  await mkdir(binDir, { recursive: true });

  // Each invocation appends to this file, so the suite can prove the shim —
  // and therefore this checkout's rex — is what answered, rather than some
  // other rex that happened to be on PATH and happened to work.
  const marker = join(binDir, "invoked.log");

  const posix = join(binDir, "rex");
  await writeFile(
    posix,
    `#!/bin/sh\necho "$@" >> "${marker}"\nexec "${process.execPath}" "${REX_CLI}" "$@"\n`,
    "utf-8",
  );
  await chmod(posix, 0o755);

  await writeFile(
    join(binDir, "rex.cmd"),
    `@echo off\r\n>>"${marker}" echo %*\r\n"${process.execPath}" "${REX_CLI}" %*\r\n`,
    "utf-8",
  );

  return { binDir, marker };
}

describe("sv pr-markdown on a folder-tree project", () => {
  let root;
  let projectDir;
  let markdown;
  let shimBin;
  let shimMarker;

  beforeAll(async () => {
    root = await createTmpDir("ndx-e2e-pr-md-tree-");
    projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });

    // A folder-tree PRD, written by rex's own serializer so the fixture is a
    // real tree rather than this test's idea of one.
    const { serializeFolderTree } = await import("../../packages/rex/dist/public.js");
    const treeRoot = join(projectDir, ".rex", "prd_tree");
    await mkdir(treeRoot, { recursive: true });
    await mkdir(join(projectDir, ".sourcevision"), { recursive: true });

    const epic = (tasks) => [
      {
        id: "epic-auth",
        title: "Auth System",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "feat-login",
            title: "Login Flow",
            level: "feature",
            status: "in_progress",
            children: tasks,
          },
        ],
      },
    ];

    // main: nothing finished yet.
    await serializeFolderTree(
      epic([
        { id: "task-jwt", title: "Implement JWT tokens", level: "task", status: "pending" },
      ]),
      treeRoot,
    );

    git(projectDir, ["init", "-b", "main"]);
    git(projectDir, ["config", "user.email", "test@example.com"]);
    git(projectDir, ["config", "user.name", "Test User"]);
    git(projectDir, ["add", "."]);
    git(projectDir, ["commit", "-m", "PRD on main"]);

    // The branch finishes it.
    git(projectDir, ["checkout", "-b", "feature/jwt"]);
    await serializeFolderTree(
      epic([
        {
          id: "task-jwt",
          title: "Implement JWT tokens",
          level: "task",
          status: "completed",
          completedAt: "2026-01-15T10:00:00.000Z",
        },
      ]),
      treeRoot,
    );
    git(projectDir, ["add", "."]);
    git(projectDir, ["commit", "-m", "complete JWT task"]);

    const shim = await rexShimDir(root);
    shimBin = shim.binDir;
    shimMarker = shim.marker;
    runPrMarkdown();

    markdown = await readFile(join(projectDir, ".sourcevision", "pr-markdown.md"), "utf-8");
  });

  /** Run `sv pr-markdown` with this checkout's rex first on PATH. */
  function runPrMarkdown() {
    run(["sv", "pr-markdown", "."], {
      cwd: projectDir,
      env: {
        ...process.env,
        PATH: `${shimBin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
      },
    });
  }

  afterAll(async () => {
    if (root) await removeTmpDir(root);
  });

  it("gets its answers from this checkout's rex", async () => {
    // Without this, a passing suite could mean some other rex on PATH answered
    // — which on a machine with a globally linked n-dx is a different checkout.
    const invocations = await readFile(shimMarker, "utf-8");
    expect(invocations).toContain("tree --format=json");
    expect(invocations).toContain("tree-diff --json");
  });

  it("names the work the branch completed", () => {
    // The defect: this section rendered "No completed work items on this
    // branch." on every folder-tree project.
    expect(markdown).toContain("## Completed Work");
    expect(markdown).not.toContain("No completed work items on this branch.");
    expect(markdown).toContain("Implement JWT tokens");
  });

  it("carries the hierarchy the item sits in", () => {
    expect(markdown).toContain("Auth System");
    expect(markdown).toContain("Login Flow");
  });

  it("reports the branch it was generated for", () => {
    expect(markdown).toContain("`feature/jwt`");
    expect(markdown).toContain("`main`");
  });

  it("counts only what this branch finished", () => {
    expect(markdown).toContain("**Completed items:** 1");
  });

  it("never reads the legacy .rex/prd.md", async () => {
    // The fixture has no prd.md at all, so the assertions above already prove
    // the folder tree was the source. This makes the requirement explicit:
    // a reintroduced prd.md must not become the source again.
    await writeFile(
      join(projectDir, ".rex", "prd.md"),
      "---\nschema: rex/v1\ntitle: Decoy\n---\n\n# Decoy PRD\n",
      "utf-8",
    );

    runPrMarkdown();

    const regenerated = await readFile(
      join(projectDir, ".sourcevision", "pr-markdown.md"),
      "utf-8",
    );
    expect(regenerated).toContain("Implement JWT tokens");
    expect(regenerated).not.toContain("Decoy");
  });
});

/**
 * A PRD larger than `execFileSync`'s default stdout buffer.
 *
 * The collector reads the whole PRD as JSON over a pipe. `execFileSync` caps
 * stdout at 1 MiB by default and does not truncate past it — it kills the child
 * and throws `ENOBUFS`, which the collector cannot tell apart from "this project
 * has no PRD". The result is an empty Completed Work section on exactly the
 * large, real projects the report is for; n-dx's own PRD serialises to 3.2 MiB.
 *
 * This suite stands in for such a project with a rex stub, so it costs a couple
 * of megabytes of string rather than the thousands of files a genuine tree of
 * that size would need. It fails with the default buffer and passes with an
 * explicit one.
 */
describe("sv pr-markdown on a PRD larger than the default stdout buffer", () => {
  let root;
  let projectDir;
  let markdown;

  beforeAll(async () => {
    root = await createTmpDir("ndx-e2e-pr-md-big-");
    projectDir = join(root, "project");
    await mkdir(join(projectDir, ".sourcevision"), { recursive: true });
    await mkdir(join(projectDir, ".rex"), { recursive: true });

    // One reportable task plus enough ballast to pass 1 MiB. The ballast is
    // pending, so it never reaches the rendered markdown — only the pipe.
    const ballast = "x".repeat(4096);
    const padding = Array.from({ length: 400 }, (_, i) => ({
      id: `pad-${i}`,
      title: `Padding ${i}`,
      level: "task",
      status: "pending",
      description: ballast,
    }));

    const tree = {
      items: [
        {
          id: "epic-big",
          title: "Big Epic",
          level: "epic",
          status: "in_progress",
          children: [
            {
              id: "feat-big",
              title: "Big Feature",
              level: "feature",
              status: "in_progress",
              children: [
                {
                  id: "task-real",
                  title: "Task in a large PRD",
                  level: "task",
                  status: "completed",
                  completedAt: "2026-01-15T10:00:00.000Z",
                },
                ...padding,
              ],
            },
          ],
        },
      ],
    };

    const treeJson = JSON.stringify(tree, null, 2);
    expect(Buffer.byteLength(treeJson, "utf-8")).toBeGreaterThan(1024 * 1024);

    const stubDir = join(root, "stub-bin");
    await mkdir(stubDir, { recursive: true });
    const treePath = join(stubDir, "tree.json");
    await writeFile(treePath, treeJson, "utf-8");

    // One stub script for both platforms; the shell wrappers only forward argv.
    const stubJs = join(stubDir, "rex-stub.js");
    await writeFile(
      stubJs,
      [
        "const { readFileSync } = require('node:fs');",
        "const args = process.argv.slice(2);",
        "if (args.includes('tree-diff')) {",
        "  process.stdout.write(JSON.stringify({ completed: [{ id: 'task-real' }] }));",
        "} else {",
        `  process.stdout.write(readFileSync(${JSON.stringify(treePath)}, 'utf-8'));`,
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    const posix = join(stubDir, "rex");
    await writeFile(posix, `#!/bin/sh\nexec "${process.execPath}" "${stubJs}" "$@"\n`, "utf-8");
    await chmod(posix, 0o755);
    await writeFile(
      join(stubDir, "rex.cmd"),
      `@echo off\r\n"${process.execPath}" "${stubJs}" %*\r\n`,
      "utf-8",
    );

    run(["sv", "pr-markdown", "."], {
      cwd: projectDir,
      env: {
        ...process.env,
        PATH: `${stubDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
      },
    });

    markdown = await readFile(join(projectDir, ".sourcevision", "pr-markdown.md"), "utf-8");
  });

  afterAll(async () => {
    if (root) await removeTmpDir(root);
  });

  it("still reports the completed work", () => {
    // With the default 1 MiB buffer the read throws ENOBUFS, the collector
    // reads that as "no PRD", and this section is empty.
    expect(markdown).not.toContain("No completed work items on this branch.");
    expect(markdown).toContain("Task in a large PRD");
  });
});
