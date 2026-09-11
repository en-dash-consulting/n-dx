import { describe, it, expect } from "vitest";
import {
  createLivelockDetector,
  DEFAULT_LIVELOCK_THRESHOLD,
  DEFAULT_LIVELOCK_WINDOW,
  isProgressTool,
} from "../../../../src/agent/analysis/livelock.js";

describe("livelock detector", () => {
  it("fires once the same call repeats to the threshold", () => {
    const detector = createLivelockDetector({ threshold: 3 });

    expect(detector.record({ tool: "BashOutput", input: { bash_id: "b1" } })).toBeNull();
    expect(detector.record({ tool: "BashOutput", input: { bash_id: "b1" } })).toBeNull();

    const hit = detector.record({ tool: "BashOutput", input: { bash_id: "b1" } });
    expect(hit).not.toBeNull();
    expect(hit!.tool).toBe("BashOutput");
    expect(hit!.repeats).toBe(3);
    expect(hit!.message).toContain("BashOutput");
    expect(hit!.message).toContain("3 times");
  });

  it("treats calls separated by other work as repeats of the same cycle", () => {
    // The observed livelock (GH #362) was a repeating *cycle*, not adjacent
    // identical calls: relaunch suite → sleep → poll dead task → re-read the
    // same diff. Adjacency would never have caught it.
    const detector = createLivelockDetector({ threshold: 3 });
    let hit = null;
    for (let cycle = 0; cycle < 3; cycle++) {
      detector.record({ tool: "Bash", input: { command: "pnpm test" } });
      detector.record({ tool: "Bash", input: { command: "sleep 90" } });
      hit = detector.record({ tool: "Bash", input: { command: "git diff" } });
    }
    expect(hit).not.toBeNull();
    expect(hit!.message).toContain("git diff");
  });

  it("ignores argument key order", () => {
    const detector = createLivelockDetector({ threshold: 2 });
    detector.record({ tool: "Read", input: { file_path: "a.ts", offset: 1 } });
    expect(detector.record({ tool: "Read", input: { offset: 1, file_path: "a.ts" } })).not.toBeNull();
  });

  it("does not fire for a long run of distinct calls", () => {
    const detector = createLivelockDetector();
    for (let i = 0; i < 500; i++) {
      expect(detector.record({ tool: "Read", input: { file_path: `file-${i}.ts` } })).toBeNull();
    }
  });

  it("does not fire when repeats fall outside the window", () => {
    const detector = createLivelockDetector({ threshold: 3, window: 5 });
    for (let i = 0; i < 10; i++) {
      detector.record({ tool: "Bash", input: { command: "git status" } });
      detector.record({ tool: "Read", input: { file_path: `a-${i}.ts` } });
      detector.record({ tool: "Read", input: { file_path: `b-${i}.ts` } });
      detector.record({ tool: "Read", input: { file_path: `c-${i}.ts` } });
      detector.record({ tool: "Read", input: { file_path: `d-${i}.ts` } });
      expect(detector.record({ tool: "Read", input: { file_path: `e-${i}.ts` } })).toBeNull();
    }
  });

  it("forgets history when the agent changes a file", () => {
    // A fix loop legitimately re-runs the same failing command: run test, edit,
    // run test again. The edit is the progress signal that clears the count.
    const detector = createLivelockDetector({ threshold: 3 });
    for (let i = 0; i < 20; i++) {
      expect(detector.record({ tool: "Bash", input: { command: "pnpm test" } })).toBeNull();
      detector.record({ tool: "Edit", input: { file_path: "src/thing.ts" } });
    }
  });

  it("separates repeats by result when results are observable", () => {
    // Polling a task that is still producing output is progress; polling one
    // that returns the same bytes forever is not.
    const progressing = createLivelockDetector({ threshold: 3 });
    for (let i = 0; i < 20; i++) {
      expect(
        progressing.record({ tool: "BashOutput", input: { bash_id: "b1" }, output: `line ${i}` }),
      ).toBeNull();
    }

    const stalled = createLivelockDetector({ threshold: 3 });
    stalled.record({ tool: "BashOutput", input: { bash_id: "b1" }, output: "" });
    stalled.record({ tool: "BashOutput", input: { bash_id: "b1" }, output: "" });
    expect(stalled.record({ tool: "BashOutput", input: { bash_id: "b1" }, output: "" })).not.toBeNull();
  });

  it("is disabled by a non-positive threshold", () => {
    const detector = createLivelockDetector({ threshold: 0 });
    for (let i = 0; i < 100; i++) {
      expect(detector.record({ tool: "Bash", input: { command: "sleep 90" } })).toBeNull();
    }
  });

  it("reports the same detection only once", () => {
    const detector = createLivelockDetector({ threshold: 2 });
    detector.record({ tool: "Bash", input: { command: "sleep 90" } });
    expect(detector.record({ tool: "Bash", input: { command: "sleep 90" } })).not.toBeNull();
    expect(detector.record({ tool: "Bash", input: { command: "sleep 90" } })).toBeNull();
  });

  it("names the repeated call with its arguments", () => {
    const detector = createLivelockDetector({ threshold: 2 });
    detector.record({ tool: "Bash", input: { command: "pnpm test" } });
    const hit = detector.record({ tool: "Bash", input: { command: "pnpm test" } })!;
    expect(hit.message).toContain("pnpm test");
  });

  it("classifies file-mutating tools across both provider vocabularies", () => {
    for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit", "write_file"]) {
      expect(isProgressTool(tool)).toBe(true);
    }
    for (const tool of ["Read", "Bash", "BashOutput", "Grep", "run_command"]) {
      expect(isProgressTool(tool)).toBe(false);
    }
  });

  it("remembers the first detection for callers that check per turn", () => {
    const detector = createLivelockDetector({ threshold: 2 });
    expect(detector.detected).toBeNull();

    detector.record({ tool: "Bash", input: { command: "sleep 90" } });
    detector.record({ tool: "Bash", input: { command: "sleep 90" } });
    expect(detector.detected).not.toBeNull();
    expect(detector.detected!.tool).toBe("Bash");

    detector.reset();
    expect(detector.detected).toBeNull();
  });

  it("ships defaults that tolerate normal repetition", () => {
    expect(DEFAULT_LIVELOCK_THRESHOLD).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_LIVELOCK_WINDOW).toBeGreaterThan(DEFAULT_LIVELOCK_THRESHOLD);
  });
});
