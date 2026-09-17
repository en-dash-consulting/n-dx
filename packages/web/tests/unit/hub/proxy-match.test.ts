import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { matchProjectByDir } from "../../../src/hub/index.js";
import type { ProjectView } from "../../../src/hub/index.js";

function view(id: string, repoRoot: string, worktrees: string[] = []): ProjectView {
  return {
    id, name: id, repoRoot, worktrees: [repoRoot, ...worktrees], ndxBin: "/x.js", port: 1, pid: 1, lastSeen: null,
    status: { state: "healthy", pid: 1, port: 1, attached: false, respawns: 0, lastHealthAt: null, lastError: null },
  };
}

describe("matchProjectByDir", () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-match-")));
  const a = join(root, "a");
  const aWt = join(root, "a-feature");
  const b = join(root, "b");
  const nested = join(b, "packages", "x");
  for (const d of [a, aWt, b, nested]) mkdirSync(d, { recursive: true });
  const projects = [view("a", a, [aWt]), view("b", b)];

  it("matches the repository root, a subdirectory, and a registered worktree", () => {
    expect(matchProjectByDir(projects, a)?.id).toBe("a");
    expect(matchProjectByDir(projects, nested)?.id).toBe("b");
    expect(matchProjectByDir(projects, join(aWt, "src"))?.id).toBe("a");
  });

  it("does not match a sibling that merely shares a prefix", () => {
    // "a-feature" is a's worktree, but "a-other" is nobody's.
    expect(matchProjectByDir([view("a", a)], join(root, "a-other"))).toBeNull();
    expect(matchProjectByDir(projects, root)).toBeNull();
  });

  it("prefers the deepest containing root", () => {
    const inner = view("inner", nested);
    expect(matchProjectByDir([...projects, inner], join(nested, "deep"))?.id).toBe("inner");
  });

  rmSync(root, { recursive: true, force: true });
});
