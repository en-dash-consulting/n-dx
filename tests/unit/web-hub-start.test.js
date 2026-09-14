/**
 * Hub-mode `ndx start` — the pure pieces: main-worktree parsing, project-id
 * slugging, and the collision rule for the registry.
 *
 * The id rule matters because it decides where a registration LANDS: a wrong
 * answer either splits one repo across two hub entries (same repo, new id on
 * every start) or silently merges two different repos into one entry (name
 * collision without the discriminator). Both directions are pinned here.
 *
 * @see packages/core/web.js — runHubStart and friends
 */

import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  parseMainWorktree,
  slugifyProjectId,
  deriveProjectId,
  hubStateDir,
} from "../../packages/core/web.js";

describe("parseMainWorktree", () => {
  it("returns the first worktree entry — the main worktree by git's contract", () => {
    const porcelain = [
      "worktree C:/repos/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree C:/repos/feature-wt",
      "HEAD def456",
      "branch refs/heads/feature",
      "",
    ].join("\n");
    expect(parseMainWorktree(porcelain)).toBe("C:/repos/main");
  });

  it("handles POSIX paths and returns null for no entries", () => {
    expect(parseMainWorktree("worktree /home/u/repo\nHEAD abc\n")).toBe("/home/u/repo");
    expect(parseMainWorktree("")).toBeNull();
    expect(parseMainWorktree("HEAD abc\n")).toBeNull();
  });
});

describe("slugifyProjectId", () => {
  it.each([
    ["My Project", "my-project"],
    ["n-dx", "n-dx"],
    ["Hub Repo A", "hub-repo-a"],
    ["weird///name!!", "weird-name"],
    ["--leading-junk", "leading-junk"],
    ["dots.and_underscores", "dots.and_underscores"],
  ])("slugs %j to %j", (input, expected) => {
    expect(slugifyProjectId(input)).toBe(expected);
  });

  it("never returns an empty id", () => {
    expect(slugifyProjectId("!!!")).toBe("project");
    expect(slugifyProjectId("")).toBe("project");
  });
});

describe("deriveProjectId", () => {
  const repoA = join(homedir(), "repos", "alpha");
  const repoB = join(homedir(), "repos", "beta");

  it("uses the plain slug when the registry has no entry for it", () => {
    expect(deriveProjectId("Alpha", repoA, {}, "https://x/alpha.git")).toBe("alpha");
  });

  it("keeps the stable id when the same repo re-registers", () => {
    const registry = { alpha: { repoRoot: repoA } };
    expect(deriveProjectId("Alpha", repoA, registry, "https://x/alpha.git")).toBe("alpha");
  });

  it("appends a 6-char origin hash only for a DIFFERENT repo with the same name", () => {
    const registry = { alpha: { repoRoot: repoA } };
    const id = deriveProjectId("Alpha", repoB, registry, "https://x/other-alpha.git");
    expect(id).toMatch(/^alpha-[0-9a-f]{6}$/);
    // Deterministic: the same origin always yields the same discriminator.
    expect(deriveProjectId("Alpha", repoB, registry, "https://x/other-alpha.git")).toBe(id);
  });

  it("falls back to hashing the repo root when there is no origin remote", () => {
    const registry = { alpha: { repoRoot: repoA } };
    const id = deriveProjectId("Alpha", repoB, registry, null);
    expect(id).toMatch(/^alpha-[0-9a-f]{6}$/);
  });
});

describe("hubStateDir", () => {
  const saved = process.env.N_DX_HUB_DIR;

  afterEach(() => {
    if (saved === undefined) delete process.env.N_DX_HUB_DIR;
    else process.env.N_DX_HUB_DIR = saved;
  });

  it("defaults to ~/.n-dx and honours the N_DX_HUB_DIR test seam", () => {
    delete process.env.N_DX_HUB_DIR;
    expect(hubStateDir()).toBe(join(homedir(), ".n-dx"));
    process.env.N_DX_HUB_DIR = "C:/tmp/hub-under-test";
    expect(hubStateDir()).toBe("C:/tmp/hub-under-test");
  });
});
