/**
 * The hub session's save_draft path check: a relative path stays under the
 * drafts directory, and nothing lands inside a `.git` directory however the
 * path spells it or whatever link it goes through.
 */

import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDraftPath } from "../../../src/server/sidecar/draft-file.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

let root: string;
let drafts: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-draft-file-"));
  drafts = join(root, "drafts");
  mkdirSync(join(root, "repo", ".git", "hooks"), { recursive: true });
});

afterEach(async () => {
  await removeTestDir(root);
});

describe("resolveDraftPath", () => {
  it("resolves a relative path under the drafts directory and keeps an absolute one", () => {
    expect(resolveDraftPath("plan.md", drafts)).toEqual({ ok: true, path: join(drafts, "plan.md") });
    expect(resolveDraftPath(join(root, "elsewhere", "plan.md"), drafts)).toEqual({ ok: true, path: join(root, "elsewhere", "plan.md") });
    expect(resolveDraftPath("../escape.md", drafts).ok).toBe(false);
  });

  it.each([".git", ".GIT", ".Git", ".git.", ".git ", ".git. .", ".git::$INDEX_ALLOCATION", ".GIT .::$INDEX_ALLOCATION"])("refuses a path through %j", (segment) => {
    const result = resolveDraftPath(join(root, "repo", segment, "hooks", "pre-commit"), drafts);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(".git") });
  });

  it("allows a segment that only resembles .git", () => {
    expect(resolveDraftPath(join(root, ".github", "x.md"), drafts).ok).toBe(true);
    expect(resolveDraftPath(join(root, "my.git", "x.md"), drafts).ok).toBe(true);
  });

  it("refuses a path through a symlinked directory that points into .git", () => {
    symlinkSync(join(root, "repo", ".git"), join(root, "innocent"), "junction");
    const result = resolveDraftPath(join(root, "innocent", "hooks", "pre-commit"), drafts);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(".git") });
    expect(resolveDraftPath(join(root, "innocent", "new-dir", "x.md"), drafts).ok).toBe(false);
  });
});
