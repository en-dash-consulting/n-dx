import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseRecommendationsJson,
  formatQueuedTaskSummary,
  readSelfHealAutoConfirm,
  resolveAutoConfirm,
  runConfirmationPrompt,
} from "../../packages/core/self-heal-confirm.js";

describe("parseRecommendationsJson", () => {
  it("returns empty summary for blank input", () => {
    expect(parseRecommendationsJson("")).toEqual({ tasks: [], totalFindings: 0 });
    expect(parseRecommendationsJson("   \n")).toEqual({ tasks: [], totalFindings: 0 });
  });

  it("returns empty summary for invalid JSON", () => {
    expect(parseRecommendationsJson("not json")).toEqual({ tasks: [], totalFindings: 0 });
  });

  it("returns empty summary when payload is not an array", () => {
    expect(parseRecommendationsJson(JSON.stringify({ foo: 1 }))).toEqual({
      tasks: [],
      totalFindings: 0,
    });
  });

  it("collects only level=task entries with finding counts", () => {
    const payload = [
      { level: "epic", title: "Skip epic" },
      { level: "feature", title: "Skip feature" },
      { level: "task", title: "Task A", meta: { findingCount: 3 } },
      { level: "task", title: "Task B", meta: { findingCount: 1 } },
      { level: "task", title: "Task C" }, // no meta — count defaults to 0
    ];
    const summary = parseRecommendationsJson(JSON.stringify(payload));
    expect(summary.tasks).toEqual([
      { title: "Task A", findingCount: 3 },
      { title: "Task B", findingCount: 1 },
      { title: "Task C", findingCount: 0 },
    ]);
    expect(summary.totalFindings).toBe(4);
  });

  it("substitutes a placeholder for missing titles", () => {
    const summary = parseRecommendationsJson(
      JSON.stringify([{ level: "task", meta: { findingCount: 1 } }]),
    );
    expect(summary.tasks).toEqual([{ title: "(untitled task)", findingCount: 1 }]);
  });
});

describe("formatQueuedTaskSummary", () => {
  it("describes a single-iteration run with one task", () => {
    const text = formatQueuedTaskSummary({
      summary: { tasks: [{ title: "Fix thing", findingCount: 2 }], totalFindings: 2 },
      currentIteration: 1,
      totalIterations: 1,
    });
    expect(text).toContain("Queued for iteration 1/1: 1 task (covering 2 findings)");
    expect(text).toContain("1. Fix thing  [2 findings]");
    expect(text).not.toContain("Self-heal will run up to");
  });

  it("notes multi-iteration plans", () => {
    const text = formatQueuedTaskSummary({
      summary: { tasks: [{ title: "Task A", findingCount: 1 }], totalFindings: 1 },
      currentIteration: 1,
      totalIterations: 3,
    });
    expect(text).toContain("Self-heal will run up to 3 iterations");
  });

  it("warns when nothing is queued", () => {
    const text = formatQueuedTaskSummary({
      summary: { tasks: [], totalFindings: 0 },
      currentIteration: 1,
      totalIterations: 1,
    });
    expect(text).toContain("Queued for iteration 1/1: 0 tasks");
    expect(text).toContain("nothing to execute");
  });

  it("truncates long task lists with a 'and N more' footer", () => {
    const tasks = Array.from({ length: 25 }, (_, i) => ({
      title: `Task ${i + 1}`,
      findingCount: 1,
    }));
    const text = formatQueuedTaskSummary({
      summary: { tasks, totalFindings: 25 },
      currentIteration: 1,
      totalIterations: 1,
    });
    expect(text).toContain("20. Task 20");
    expect(text).not.toContain("21. Task 21");
    expect(text).toContain("…and 5 more");
  });
});

describe("readSelfHealAutoConfirm", () => {
  it("returns false when .n-dx.json is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "selfheal-cfg-"));
    try {
      expect(readSelfHealAutoConfirm(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false for malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "selfheal-cfg-"));
    try {
      writeFileSync(join(dir, ".n-dx.json"), "{ not json");
      expect(readSelfHealAutoConfirm(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when selfHeal.autoConfirm is absent or non-boolean-true", () => {
    const dir = mkdtempSync(join(tmpdir(), "selfheal-cfg-"));
    try {
      writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({}));
      expect(readSelfHealAutoConfirm(dir)).toBe(false);
      writeFileSync(
        join(dir, ".n-dx.json"),
        JSON.stringify({ selfHeal: { autoConfirm: "yes" } }),
      );
      expect(readSelfHealAutoConfirm(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns true when selfHeal.autoConfirm === true", () => {
    const dir = mkdtempSync(join(tmpdir(), "selfheal-cfg-"));
    try {
      writeFileSync(
        join(dir, ".n-dx.json"),
        JSON.stringify({ selfHeal: { autoConfirm: true } }),
      );
      expect(readSelfHealAutoConfirm(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveAutoConfirm", () => {
  it("returns flag source when --auto is passed", () => {
    expect(resolveAutoConfirm({ argv: ["--auto"], configAutoConfirm: false })).toEqual({
      autoConfirm: true,
      source: "flag",
    });
  });

  it("returns flag source when --yes is passed", () => {
    expect(resolveAutoConfirm({ argv: ["--yes"], configAutoConfirm: false })).toEqual({
      autoConfirm: true,
      source: "flag",
    });
  });

  it("flag wins over config=false", () => {
    expect(resolveAutoConfirm({ argv: ["--auto"], configAutoConfirm: false })).toEqual({
      autoConfirm: true,
      source: "flag",
    });
  });

  it("config-only sets autoConfirm with config source", () => {
    expect(resolveAutoConfirm({ argv: [], configAutoConfirm: true })).toEqual({
      autoConfirm: true,
      source: "config",
    });
  });

  it("neither flag nor config leaves autoConfirm false", () => {
    expect(resolveAutoConfirm({ argv: ["3", "."], configAutoConfirm: false })).toEqual({
      autoConfirm: false,
      source: "none",
    });
  });
});

// ── runConfirmationPrompt ─────────────────────────────────────────────────────
//
// Use captured streams + a stub readline factory so the prompt is fully
// driven from the test, with no real TTY required.

function captureStream() {
  const chunks = [];
  return {
    write: (chunk) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf-8"));
      return true;
    },
    output: () => chunks.join(""),
  };
}

function stubReadline(answer) {
  return () => ({
    question: async () => answer,
    close: () => {},
  });
}

describe("runConfirmationPrompt", () => {
  it("returns 'auto' and prints the summary without reading stdin when autoConfirm", async () => {
    const stdout = captureStream();
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: true,
      isTTY: false,
      streams: { stdout, stderr: captureStream() },
      readlineFactory: () => {
        throw new Error("readline must not be created when autoConfirm=true");
      },
    });
    expect(result.decision).toBe("auto");
    expect(stdout.output()).toContain("QUEUED");
    expect(stdout.output()).toContain("Auto-confirm enabled");
  });

  it("returns 'no-tty' with an explanatory error when not a TTY and not auto-confirmed", async () => {
    const stderr = captureStream();
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: false,
      isTTY: false,
      streams: { stdout: captureStream(), stderr },
      readlineFactory: () => {
        throw new Error("readline must not be created in non-TTY mode");
      },
    });
    expect(result.decision).toBe("no-tty");
    expect(result.message).toContain("--auto");
    expect(result.message).toContain("selfHeal.autoConfirm");
    expect(stderr.output()).toBe(result.message);
  });

  it("returns 'accept' when the user answers 'y'", async () => {
    const stdout = captureStream();
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: false,
      isTTY: true,
      streams: { stdout, stderr: captureStream() },
      readlineFactory: stubReadline("y"),
    });
    expect(result.decision).toBe("accept");
    expect(stdout.output()).toContain("QUEUED");
  });

  it("accepts 'YES' (case-insensitive)", async () => {
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: false,
      isTTY: true,
      streams: { stdout: captureStream(), stderr: captureStream() },
      readlineFactory: stubReadline("YES"),
    });
    expect(result.decision).toBe("accept");
  });

  it("declines on empty answer (default N)", async () => {
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: false,
      isTTY: true,
      streams: { stdout: captureStream(), stderr: captureStream() },
      readlineFactory: stubReadline(""),
    });
    expect(result.decision).toBe("decline");
  });

  it("declines on 'n' / arbitrary input", async () => {
    for (const answer of ["n", "no", "nah", "maybe", " q "]) {
      const result = await runConfirmationPrompt({
        summaryText: "QUEUED",
        autoConfirm: false,
        isTTY: true,
        streams: { stdout: captureStream(), stderr: captureStream() },
        readlineFactory: stubReadline(answer),
      });
      expect(result.decision, `answer=${answer}`).toBe("decline");
    }
  });

  it("declines if readline rejects (e.g. SIGINT during prompt)", async () => {
    const result = await runConfirmationPrompt({
      summaryText: "QUEUED",
      autoConfirm: false,
      isTTY: true,
      streams: { stdout: captureStream(), stderr: captureStream() },
      readlineFactory: () => ({
        question: async () => {
          throw new Error("aborted");
        },
        close: () => {},
      }),
    });
    expect(result.decision).toBe("decline");
  });
});

// ── Prompt-gate matrix ────────────────────────────────────────────────────────
//
// Verify how `resolveAutoConfirm` + `runConfirmationPrompt` interact for the
// four canonical bypass-source combinations: flag-only, config-only, both,
// and neither. These regressions guard the precedence contract documented
// in `ndx self-heal --help` (CLI flag wins; flag absence does not cancel
// config=true; neither falls through to the prompt).

function runGate({ argv, configAutoConfirm, isTTY, answer }) {
  const resolution = resolveAutoConfirm({ argv, configAutoConfirm });
  const stdout = captureStream();
  const stderr = captureStream();
  return runConfirmationPrompt({
    summaryText: "QUEUED",
    autoConfirm: resolution.autoConfirm,
    isTTY,
    streams: { stdout, stderr },
    readlineFactory: answer === undefined
      ? () => {
          throw new Error("readline must not be created when bypassed");
        }
      : stubReadline(answer),
  }).then((result) => ({ resolution, result, stdout, stderr }));
}

describe("prompt-gate combinations (flag × config)", () => {
  it("flag-only: --auto with config=false bypasses prompt (source=flag)", async () => {
    const { resolution, result } = await runGate({
      argv: ["--auto"],
      configAutoConfirm: false,
      isTTY: true,
    });
    expect(resolution).toEqual({ autoConfirm: true, source: "flag" });
    expect(result.decision).toBe("auto");
  });

  it("flag-only: --yes with config=false bypasses prompt (source=flag)", async () => {
    const { resolution, result } = await runGate({
      argv: ["--yes"],
      configAutoConfirm: false,
      isTTY: true,
    });
    expect(resolution).toEqual({ autoConfirm: true, source: "flag" });
    expect(result.decision).toBe("auto");
  });

  it("config-only: no flag with config=true bypasses prompt (source=config)", async () => {
    const { resolution, result } = await runGate({
      argv: [],
      configAutoConfirm: true,
      isTTY: true,
    });
    expect(resolution).toEqual({ autoConfirm: true, source: "config" });
    expect(result.decision).toBe("auto");
  });

  it("both-set: --auto with config=true bypasses prompt — flag wins for attribution", async () => {
    const { resolution, result } = await runGate({
      argv: ["--auto"],
      configAutoConfirm: true,
      isTTY: true,
    });
    // Flag takes precedence so the source is reported as "flag", letting the
    // caller log/audit which signal triggered the bypass.
    expect(resolution).toEqual({ autoConfirm: true, source: "flag" });
    expect(result.decision).toBe("auto");
  });

  it("neither-set: TTY prompts and accepts on 'y'", async () => {
    const { resolution, result } = await runGate({
      argv: [],
      configAutoConfirm: false,
      isTTY: true,
      answer: "y",
    });
    expect(resolution).toEqual({ autoConfirm: false, source: "none" });
    expect(result.decision).toBe("accept");
  });

  it("neither-set: TTY prompts and declines on empty input", async () => {
    const { resolution, result } = await runGate({
      argv: [],
      configAutoConfirm: false,
      isTTY: true,
      answer: "",
    });
    expect(resolution).toEqual({ autoConfirm: false, source: "none" });
    expect(result.decision).toBe("decline");
  });

  it("neither-set: non-TTY fails fast with no stdin read", async () => {
    const { resolution, result, stderr } = await runGate({
      argv: [],
      configAutoConfirm: false,
      isTTY: false,
    });
    expect(resolution).toEqual({ autoConfirm: false, source: "none" });
    expect(result.decision).toBe("no-tty");
    expect(stderr.output()).toContain("--auto");
    expect(stderr.output()).toContain("selfHeal.autoConfirm");
  });

  it("flag-only on non-TTY still bypasses (scheduled / CI invocation)", async () => {
    const { resolution, result } = await runGate({
      argv: ["--auto"],
      configAutoConfirm: false,
      isTTY: false,
    });
    expect(resolution).toEqual({ autoConfirm: true, source: "flag" });
    expect(result.decision).toBe("auto");
  });

  it("config-only on non-TTY still bypasses (scheduled / CI invocation)", async () => {
    const { resolution, result } = await runGate({
      argv: [],
      configAutoConfirm: true,
      isTTY: false,
    });
    expect(resolution).toEqual({ autoConfirm: true, source: "config" });
    expect(result.decision).toBe("auto");
  });
});

// ── Regression: recommendations → tagged PRD items → execution gate ───────────
//
// Guards the pipeline ordering invariant:
//   1. `rex recommend --accept` seeds the PRD folder tree with self-heal-items
//      tagged tasks (simulated by directly writing the folder tree).
//   2. After persistence the tag survives a full parse (no data loss).
//   3. The confirmation gate's accept path returns a decision that allows
//      the hench execution phase to proceed.
//
// Failure here means either the tag was silently dropped during PRD
// persistence, or the gate was wired after the PRD write in a way that
// could suppress execution even when the user confirmed.

describe("regression: recommendations → PRD tagged items → execution gate", () => {
  it("items written to prd_tree with self-heal-items tag remain readable, and gate-accept signals execution proceeds", async () => {
    const { parseFolderTree, SELF_HEAL_TAG } = await import(
      "../../packages/rex/dist/public.js"
    );

    const dir = mkdtempSync(join(tmpdir(), "sh-regression-"));
    const treeDir = join(dir, "prd_tree");
    const epicDir = join(treeDir, "test-epic");
    const featDir = join(epicDir, "test-feature");
    const taskDir = join(featDir, "fix-anti-pattern");

    // Seed the folder tree as `rex recommend --accept` would (simulated).
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      join(epicDir, "index.md"),
      '---\nid: "epic-1"\nlevel: "epic"\ntitle: "Test Epic"\nstatus: "pending"\n---\n',
    );
    writeFileSync(
      join(featDir, "index.md"),
      '---\nid: "feat-1"\nlevel: "feature"\ntitle: "Test Feature"\nstatus: "pending"\n---\n',
    );
    writeFileSync(
      join(taskDir, "index.md"),
      `---\nid: "task-1"\nlevel: "task"\ntitle: "Fix anti-pattern"\nstatus: "pending"\npriority: "high"\ntags:\n  - "${SELF_HEAL_TAG}"\n---\n`,
    );

    try {
      // Step 1: verify the tag survives a full folder-tree parse.
      const { items } = await parseFolderTree(treeDir);
      const task = items
        .flatMap((e) => e.children ?? [])
        .flatMap((f) => f.children ?? [])
        .find((t) => t.id === "task-1");

      expect(task, "seeded task must be parseable from folder tree").toBeDefined();
      expect(task.tags, `task must carry ${SELF_HEAL_TAG} tag after PRD persistence`).toContain(
        SELF_HEAL_TAG,
      );

      // Step 2: verify the confirmation gate's accept path signals execution
      // should proceed (decision is "auto" when autoConfirm=true — the same
      // code path used by --auto / --yes / selfHeal.autoConfirm=true).
      const stdout = captureStream();
      const result = await runConfirmationPrompt({
        summaryText: "Queued: 1 task (1 finding)\n  1. Fix anti-pattern  [1 finding]",
        autoConfirm: true,
        isTTY: false,
        streams: { stdout, stderr: captureStream() },
        readlineFactory: () => {
          throw new Error("readline must not be called when autoConfirm=true");
        },
      });

      expect(result.decision, "gate-accept must return 'auto' so execution proceeds").toBe("auto");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
