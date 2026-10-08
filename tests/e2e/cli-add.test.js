import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runResult, createTmpDir, removeTmpDir, setupRexDir } from "./e2e-helpers.js";

/**
 * Entry for item `slug` (`<slug>.md` for a leaf, `<slug>/index.md` otherwise).
 * readdir joins with the platform separator, so match on `/`-normalised paths.
 */
function findItemEntry(entries, slug) {
  const re = new RegExp(`(^|/)${slug}(\\.md|/index\\.md)$`);
  return entries.find((p) => re.test(p.replaceAll("\\", "/")));
}

/** CRLF to LF, so line-anchored assertions hold on Windows checkouts. */
const lf = (text) => text.replaceAll("\r\n", "\n");

describe("ndx add CLI delegation", { timeout: 30_000 }, () => {
  let tmpDir;

  it("matches item entries written with either path separator", () => {
    const slug = "criteria-item";
    expect(findItemEntry(["test-epic", `test-epic\\${slug}.md`], slug)).toBe(`test-epic\\${slug}.md`);
    expect(findItemEntry([`test-epic/${slug}/index.md`], slug)).toBe(`test-epic/${slug}/index.md`);
    expect(findItemEntry([`test-epic\\${slug}\\index.md`], slug)).toBe(`test-epic\\${slug}\\index.md`);
    expect(findItemEntry(["test-epic", "test-epic\\other.md"], slug)).toBeUndefined();
    expect(lf("a\r\nb")).toBe("a\nb");
  });

  beforeEach(async () => {
    tmpDir = await createTmpDir("ndx-add-e2e-");
    await setupRexDir(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it("delegates manual add to rex without missing-.rex error", () => {
    const { stdout, stderr, code } = runResult(
      ["add", "task", "--title=Regression test item", "--parent=epic-1"],
      { cwd: tmpDir },
    );
    expect(code).toBe(0);
    expect(stderr).not.toContain("Missing");
    expect(stderr).not.toMatch(/stack trace|at \w+/i);
    expect(stdout).toContain("Regression test item");
  });

  it("exits 1 with user-friendly error when .rex is missing", async () => {
    const emptyDir = await createTmpDir("ndx-add-norex-");
    try {
      const { stderr, code } = runResult(["add", "task", "--title=Nope"], {
        cwd: emptyDir,
      });
      expect(code).toBe(1);
      expect(stderr).toContain("Missing");
      expect(stderr).toContain("ndx init");
      expect(stderr).not.toMatch(/at \w+\s*\(/);
    } finally {
      await removeTmpDir(emptyDir);
    }
  });

  it("propagates rex exit code on failure", () => {
    const { code } = runResult(
      ["add", "task", "--title=Orphan", "--parent=nonexistent-id"],
      { cwd: tmpDir },
    );
    expect(code).not.toBe(0);
  });

  it("writes repeated --criterion (both argv forms) and --source to the item's index.md", async () => {
    const { code, stderr } = runResult(
      [
        "add", "task", "--title=Criteria item", "--parent=epic-1",
        "--criterion=Alpha", "--criterion", "Beta", "--criterion=", "--source=ndx-capture",
      ],
      { cwd: tmpDir },
    );
    expect(stderr).not.toMatch(/Error/);
    expect(code).toBe(0);

    const treeDir = join(tmpDir, ".rex", "prd_tree");
    const entries = await readdir(treeDir, { recursive: true });
    const entry = findItemEntry(entries, "criteria-item");
    expect(entry, `no file for the item among: ${entries.join(", ")}`).toBeDefined();
    const md = lf(await readFile(join(treeDir, entry), "utf-8"));
    expect(md).toMatch(/^source: "?ndx-capture"?$/m);
    expect(md).toMatch(/^acceptanceCriteria:\n\s+- "?Alpha"?\n\s+- "?Beta"?\n(?!\s+- )/m);
  });

  it("rejects --criterion in smart mode without waiting on stdin", () => {
    const { code, stderr } = runResult(
      ["add", "some description", "--criterion=A"],
      { cwd: tmpDir, timeout: 15_000 },
    );
    expect(code).not.toBe(0);
    expect(stderr).toContain("--title");
  });
});
