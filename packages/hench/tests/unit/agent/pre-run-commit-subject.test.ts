/**
 * The deterministic pre-run commit subject.
 *
 * Two properties matter more than the exact wording, and both are asserted
 * on every case: the subject is one line within the conventional bound, and
 * it never claims an intent the file list does not prove. The second is the
 * reason `feat` and `fix` appear nowhere in this file — a commit type is a
 * claim that ends up in a changelog, and this builder has no way to know it.
 */

import { describe, it, expect } from "vitest";
import {
  buildPreRunCommitSubject,
  inferCommitType,
  inferScopes,
} from "../../../src/agent/lifecycle/pre-run-commit-subject.js";
import { COMMIT_SUBJECT_MAX_LENGTH } from "../../../src/agent/lifecycle/commit-subject.js";

describe("inferCommitType", () => {
  it("calls an all-markdown change docs", () => {
    expect(inferCommitType(["README.md", "docs/architecture/x.md"])).toBe("docs");
  });

  it("calls a change under a docs directory docs, whatever the extension", () => {
    expect(inferCommitType(["docs/diagrams/flow.svg", "docs/notes.md"])).toBe("docs");
  });

  it("calls an all-test change test", () => {
    expect(inferCommitType([
      "packages/web/tests/unit/thing.test.ts",
      "packages/rex/src/store/x.spec.ts",
    ])).toBe("test");
  });

  it("calls tests plus their documentation test", () => {
    expect(inferCommitType(["tests/e2e/x.test.js", "docs/testing.md"])).toBe("test");
  });

  it("falls back to chore once any source file is involved", () => {
    expect(inferCommitType(["src/index.ts", "tests/index.test.ts"])).toBe("chore");
    expect(inferCommitType(["src/index.ts"])).toBe("chore");
  });

  it("never infers feat or fix", () => {
    const guesses = [
      ["src/features/new-thing.ts"],
      ["src/fix-the-bug.ts"],
      ["packages/web/src/feature.ts", "CHANGELOG.md"],
    ].map((paths) => inferCommitType(paths));
    expect(guesses.every((g) => g === "chore")).toBe(true);
  });

  it("calls an empty list chore", () => {
    expect(inferCommitType([])).toBe("chore");
  });
});

describe("inferScopes", () => {
  it("looks through monorepo container directories to the package name", () => {
    expect(inferScopes([
      "packages/web/src/a.ts",
      "packages/rex/src/b.ts",
      "packages/web/src/c.ts",
    ])).toEqual(["rex", "web"]);
  });

  it("uses the first segment for a non-container top level", () => {
    expect(inferScopes(["src/a.ts", "scripts/b.mjs"])).toEqual(["scripts", "src"]);
  });

  it("calls a repository-root file root", () => {
    expect(inferScopes(["README.md", "package.json"])).toEqual(["root"]);
  });

  it("sorts, so the subject does not depend on git's output order", () => {
    expect(inferScopes(["packages/zed/a.ts", "packages/alpha/b.ts"])).toEqual(["alpha", "zed"]);
  });
});

describe("buildPreRunCommitSubject", () => {
  it("names the areas, the file count and the size", () => {
    const subject = buildPreRunCommitSubject(
      ["packages/web/src/a.ts", "packages/rex/src/b.ts"],
      { linesChanged: 340 },
    );
    expect(subject).toBe("chore(rex,web): pre-run checkpoint, 2 files, 340 lines");
  });

  it("uses the singular for one file and one line", () => {
    expect(buildPreRunCommitSubject(["packages/web/src/a.ts"], { linesChanged: 1 }))
      .toBe("chore(web): pre-run checkpoint, 1 file, 1 line");
  });

  it("omits the size when it is unknown or zero", () => {
    // Untracked-only changes measure zero lines against HEAD.
    expect(buildPreRunCommitSubject(["packages/web/src/new.ts"], { linesChanged: 0 }))
      .toBe("chore(web): pre-run checkpoint, 1 file");
    expect(buildPreRunCommitSubject(["packages/web/src/new.ts"]))
      .toBe("chore(web): pre-run checkpoint, 1 file");
  });

  it("drops the scope when the change is too broad for one to mean anything", () => {
    const subject = buildPreRunCommitSubject(
      ["a/x.ts", "b/x.ts", "c/x.ts", "d/x.ts"],
      { linesChanged: 12 },
    );
    expect(subject).toBe("chore: pre-run checkpoint, 4 files, 12 lines");
  });

  it("carries the inferred type through", () => {
    expect(buildPreRunCommitSubject(["docs/a.md", "docs/b.md"], { linesChanged: 9 }))
      .toBe("docs(docs): pre-run checkpoint, 2 files, 9 lines");
  });

  it("stays within the conventional subject bound on hostile input", () => {
    const longScopes = ["packages/" + "a".repeat(60) + "/x.ts", "packages/" + "b".repeat(60) + "/y.ts"];
    const subject = buildPreRunCommitSubject(longScopes, { linesChanged: 999_999 });
    expect(subject.length).toBeLessThanOrEqual(COMMIT_SUBJECT_MAX_LENGTH);
    expect(subject).not.toContain("\n");
  });

  it("is a single line with no quoting, fencing or preamble to strip", () => {
    const subject = buildPreRunCommitSubject(["packages/web/src/a.ts"], { linesChanged: 3 });
    expect(subject).not.toMatch(/^["'`]/);
    expect(subject).not.toContain("```");
    expect(subject.split("\n")).toHaveLength(1);
  });

  it("normalises Windows separators and porcelain quoting", () => {
    expect(buildPreRunCommitSubject(['"packages\\web\\src\\a.ts"'], { linesChanged: 2 }))
      .toBe("chore(web): pre-run checkpoint, 1 file, 2 lines");
  });

  it("ignores blank entries rather than counting them as files", () => {
    expect(buildPreRunCommitSubject(["packages/web/src/a.ts", "", "   "], { linesChanged: 2 }))
      .toBe("chore(web): pre-run checkpoint, 1 file, 2 lines");
  });

  it("is deterministic — the same input always gives the same subject", () => {
    const paths = ["packages/web/src/a.ts", "packages/rex/src/b.ts", "docs/c.md"];
    const first = buildPreRunCommitSubject(paths, { linesChanged: 42 });
    for (let i = 0; i < 5; i++) {
      expect(buildPreRunCommitSubject(paths, { linesChanged: 42 })).toBe(first);
    }
    // ...and does not depend on the order git happened to list them in.
    expect(buildPreRunCommitSubject([...paths].reverse(), { linesChanged: 42 })).toBe(first);
  });
});
