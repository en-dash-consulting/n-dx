/**
 * Repo-level test of the rex-state git merge driver: branches that each write
 * a folder's v2 `state.yaml` merge through `rex merge-state`.
 *
 * Spawns real git with the driver registered the way `ndx init` registers it,
 * pointing at the built CLI (dist/) because git launches the driver as a
 * separate process. Requires `pnpm build` to have run.
 *
 * @see packages/rex/src/cli/commands/merge-state.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import type { ItemState } from "../../src/schema/v2.js";
import { specHash } from "../../src/schema/v2-rules.js";
import { parseStateYaml, serializeStateYaml } from "../../src/store/state-writer.js";

const CLI_DIST = resolve(import.meta.dirname, "../../dist/cli/index.js");

const FOLDER = ".rex/product/checkout";
const STATE_PATH = `${FOLDER}/state.yaml`;
const CAPABILITY = "a0000000-0000-4000-8000-000000000001";
const CHILD_A = "b0000000-0000-4000-8000-000000000002";
const CHILD_B = "c0000000-0000-4000-8000-000000000003";

const SPEC_0 = { statement: "A shopper can pay by card.", criteria: [{ id: "c1", text: "Charged once" }] };
const SPEC_1 = { statement: "A shopper can pay by card or wallet.", criteria: [{ id: "c1", text: "Charged once" }] };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

function capabilityDoc(spec: typeof SPEC_0): string {
  return [
    "---",
    `id: "${CAPABILITY}"`,
    'type: "capability"',
    'title: "Pay"',
    'slug: "checkout"',
    `statement: ${JSON.stringify(spec.statement)}`,
    `criteria: ${JSON.stringify(spec.criteria)}`,
    "---",
    "",
  ].join("\n");
}

function leafDoc(id: string, slug: string): string {
  return ["---", `id: "${id}"`, 'type: "constraint"', `title: "${slug}"`, `slug: "${slug}"`, 'statement: "Holds."', "---", ""].join("\n");
}

describe("rex-state merge driver in a real repository", () => {
  let repo: string;

  const writeState = (items: Record<string, ItemState>): Promise<void> =>
    writeFile(join(repo, STATE_PATH), serializeStateYaml({ schema: "rex/v2", items }), "utf-8");
  const readState = async (): Promise<Record<string, ItemState>> =>
    parseStateYaml(await readFile(join(repo, STATE_PATH), "utf-8")).items;

  beforeEach(async () => {
    await access(CLI_DIST).catch(() => {
      throw new Error(`Built CLI not found at ${CLI_DIST} — run 'pnpm build' before this test.`);
    });

    repo = await mkdtemp(join(tmpdir(), "rex-merge-state-"));
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    // Register the driver the way ndx init does.
    git(repo, "config", "merge.rex-state.name", "n-dx PRD state merge");
    git(
      repo,
      "config",
      "merge.rex-state.driver",
      `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_DIST)} merge-state %O %A %B %P`,
    );
    await writeFile(join(repo, ".gitattributes"), ".rex/product/**/state.yaml merge=rex-state\n", "utf-8");

    await mkdir(join(repo, FOLDER), { recursive: true });
    await writeFile(join(repo, FOLDER, "index.md"), capabilityDoc(SPEC_0), "utf-8");
    await writeState({ [CAPABILITY]: { status: "in_progress" } });
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "base");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("merges concurrent child adds in one folder cleanly", async () => {
    git(repo, "checkout", "-b", "branch-a");
    await writeFile(join(repo, FOLDER, "child-a.md"), leafDoc(CHILD_A, "child-a"), "utf-8");
    await writeState({ [CAPABILITY]: { status: "in_progress" }, [CHILD_A]: { status: "pending" } });
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "add child a");

    git(repo, "checkout", "main");
    git(repo, "checkout", "-b", "branch-b");
    await writeFile(join(repo, FOLDER, "child-b.md"), leafDoc(CHILD_B, "child-b"), "utf-8");
    await writeState({ [CAPABILITY]: { status: "in_progress" }, [CHILD_B]: { status: "pending" } });
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "add child b");

    git(repo, "merge", "branch-a", "-m", "merge");

    expect(await readState()).toEqual({
      [CAPABILITY]: { status: "in_progress" },
      [CHILD_A]: { status: "pending" },
      [CHILD_B]: { status: "pending" },
    });
  });

  it("recomputes a metAt both branches changed from the node's spec", async () => {
    // Branch A re-verifies the capability at its unchanged spec, with the later stamp …
    git(repo, "checkout", "-b", "branch-a");
    await writeState({ [CAPABILITY]: { status: "in_progress", metAt: specHash(SPEC_0), lastModified: "2026-10-03T00:00:00Z" } });
    git(repo, "commit", "-am", "met at spec 0");

    // … branch B revises the spec and meets it.
    git(repo, "checkout", "main");
    git(repo, "checkout", "-b", "branch-b");
    await writeFile(join(repo, FOLDER, "index.md"), capabilityDoc(SPEC_1), "utf-8");
    await writeState({ [CAPABILITY]: { status: "in_progress", metAt: specHash(SPEC_1), lastModified: "2026-10-02T00:00:00Z" } });
    git(repo, "commit", "-am", "revise and meet spec 1");

    git(repo, "merge", "branch-a", "-m", "merge");

    // The merged spec is branch B's, so its hash is the met hash, not the later side's.
    expect(await readFile(join(repo, FOLDER, "index.md"), "utf-8")).toBe(capabilityDoc(SPEC_1));
    expect((await readState())[CAPABILITY]).toEqual({
      status: "in_progress",
      metAt: specHash(SPEC_1),
      lastModified: "2026-10-03T00:00:00Z",
    });
  });

  it("leaves conflict markers and an unmerged path when nothing decides a status", async () => {
    git(repo, "checkout", "-b", "branch-a");
    await writeState({ [CAPABILITY]: { status: "deferred" } });
    git(repo, "commit", "-am", "defer");

    git(repo, "checkout", "main");
    git(repo, "checkout", "-b", "branch-b");
    await writeState({ [CAPABILITY]: { status: "blocked" } });
    git(repo, "commit", "-am", "block");

    expect(() => git(repo, "merge", "branch-a", "-m", "merge")).toThrow();

    const conflicted = await readFile(join(repo, STATE_PATH), "utf-8");
    expect(conflicted).toContain('<<<<<<< ours\n    status: "blocked"\n=======\n    status: "deferred"\n>>>>>>> theirs');
    expect(git(repo, "status", "--porcelain")).toMatch(/^UU\s+\.rex\/product\/checkout\/state\.yaml$/m);
  });
});
