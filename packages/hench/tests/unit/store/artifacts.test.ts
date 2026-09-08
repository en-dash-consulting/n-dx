import { describe, it, expect } from "vitest";
import {
  HENCH_RUNTIME_GITIGNORE_ENTRIES,
  excludeHenchRuntimeArtifacts,
  isHenchRuntimeArtifact,
  parsePorcelainPath,
} from "../../../src/store/artifacts.js";

describe("isHenchRuntimeArtifact", () => {
  it("matches the artifact directories as git collapses them", () => {
    // `git status --porcelain` reports a wholly untracked directory as the
    // directory itself with a trailing slash — this is the exact form the
    // self-blocking bug surfaced as (`?? .hench/locks/`).
    expect(isHenchRuntimeArtifact(".hench/locks/")).toBe(true);
    expect(isHenchRuntimeArtifact(".hench/runs/")).toBe(true);
    expect(isHenchRuntimeArtifact(".hench/usage-cursors/")).toBe(true);
  });

  it("matches the artifact directories without a trailing slash", () => {
    expect(isHenchRuntimeArtifact(".hench/locks")).toBe(true);
    expect(isHenchRuntimeArtifact(".hench/runs")).toBe(true);
  });

  it("matches files beneath the artifact directories", () => {
    expect(isHenchRuntimeArtifact(".hench/locks/12345.lock")).toBe(true);
    expect(isHenchRuntimeArtifact(".hench/runs/2026-09-03-abc.json")).toBe(true);
    expect(isHenchRuntimeArtifact(".hench/usage-cursors/session-1.json")).toBe(true);
  });

  it("matches the pending-commit scratch file", () => {
    expect(isHenchRuntimeArtifact(".hench-commit-msg.txt")).toBe(true);
  });

  it("does not match operator-authored hench content", () => {
    // .hench/config.json is expected to be tracked — discounting the whole
    // .hench/ tree would hide a real uncommitted config change from the gate.
    expect(isHenchRuntimeArtifact(".hench/config.json")).toBe(false);
    expect(isHenchRuntimeArtifact(".hench/")).toBe(false);
    expect(isHenchRuntimeArtifact(".hench")).toBe(false);
    expect(isHenchRuntimeArtifact(".hench/templates/default.md")).toBe(false);
  });

  it("does not match unrelated paths that merely share a prefix", () => {
    expect(isHenchRuntimeArtifact(".hench-notes/locks/x")).toBe(false);
    expect(isHenchRuntimeArtifact("src/locks/x.ts")).toBe(false);
    expect(isHenchRuntimeArtifact(".hench-commit-msg.txt.bak")).toBe(false);
  });

  it("normalizes backslash separators and a leading ./", () => {
    expect(isHenchRuntimeArtifact(".hench\\locks\\12345.lock")).toBe(true);
    expect(isHenchRuntimeArtifact("./.hench/locks/")).toBe(true);
  });
});

describe("parsePorcelainPath", () => {
  it("reads the path from an untracked entry", () => {
    expect(parsePorcelainPath("?? .hench/locks/")).toBe(".hench/locks/");
  });

  it("reads the path from modified and staged entries", () => {
    expect(parsePorcelainPath(" M src/app.ts")).toBe("src/app.ts");
    expect(parsePorcelainPath("A  src/new.ts")).toBe("src/new.ts");
    expect(parsePorcelainPath("MM src/both.ts")).toBe("src/both.ts");
  });

  it("takes the destination of a rename or copy", () => {
    expect(parsePorcelainPath("R  old/name.ts -> new/name.ts")).toBe("new/name.ts");
    expect(parsePorcelainPath("C  src/a.ts -> src/b.ts")).toBe("src/b.ts");
  });

  it("strips the quotes git adds around paths with special characters", () => {
    expect(parsePorcelainPath('?? "my file.ts"')).toBe("my file.ts");
    expect(parsePorcelainPath('R  "old one.ts" -> "new one.ts"')).toBe("new one.ts");
  });

  it("does not split a non-rename path that contains an arrow", () => {
    // Only R/C statuses carry `old -> new`; splitting unconditionally would
    // truncate a legitimately named file.
    expect(parsePorcelainPath('?? "a -> b.ts"')).toBe("a -> b.ts");
  });
});

describe("excludeHenchRuntimeArtifacts", () => {
  it("drops a lock directory created by the run itself", () => {
    // The reported failure: a freshly-initialized project reads as
    // "1 uncommitted file(s), 0 line(s) changed" and the autonomous run
    // refuses to start against dirt it produced.
    expect(excludeHenchRuntimeArtifacts(["?? .hench/locks/"])).toEqual([]);
  });

  it("keeps genuine operator changes alongside hench artifacts", () => {
    const lines = [
      "?? .hench/locks/",
      " M src/app.ts",
      "?? .hench/runs/run-1.json",
      "A  README.md",
      "?? .hench-commit-msg.txt",
    ];
    expect(excludeHenchRuntimeArtifacts(lines)).toEqual([" M src/app.ts", "A  README.md"]);
  });

  it("keeps an uncommitted hench config change", () => {
    expect(excludeHenchRuntimeArtifacts([" M .hench/config.json"])).toEqual([
      " M .hench/config.json",
    ]);
  });

  it("leaves a clean tree clean", () => {
    expect(excludeHenchRuntimeArtifacts([])).toEqual([]);
  });
});

describe("HENCH_RUNTIME_GITIGNORE_ENTRIES", () => {
  it("covers every entry it declares", () => {
    // The gitignore list and the gate's discount are the same list by
    // construction; this pins that they cannot drift apart.
    for (const entry of HENCH_RUNTIME_GITIGNORE_ENTRIES) {
      expect(isHenchRuntimeArtifact(entry)).toBe(true);
    }
  });
});
