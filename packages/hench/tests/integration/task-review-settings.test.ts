/**
 * A task's saved `reviewMode` and `reviewVendor`.
 *
 * Precedence, per setting: CLI flag (`--review-mode`, `--reviewer`, `--review`,
 * `--no-review`) > the task's saved `run` > `hench.review.*` > the default. A
 * saved value this run cannot honour is skipped with a warning and never stops
 * a loop; only a flag the operator typed is refused.
 *
 * @see packages/hench/src/cli/commands/run-settings.ts — the shared resolver
 * @see packages/rex/src/schema/v1.ts — `RunSettings.reviewMode`, `reviewVendor`
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LLMConfig, LLMVendor } from "@n-dx/llm-client";
import { parseReviewOptions, resolveTaskRunSettings } from "../../src/cli/commands/run-settings.js";
import type { TaskRunSettings } from "../../src/cli/commands/run-settings.js";
import { resolveRun } from "../../src/cli/commands/run-resolve.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/index.js";
import type { HenchConfig, ReviewConfig } from "../../src/schema/index.js";
import type { PRDItem } from "../../src/prd/rex-gateway.js";
import { resolveStore } from "../../src/prd/rex-gateway.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

const task = (run: unknown) => ({ id: "t-1", title: "Saved", run }) as Pick<PRDItem, "id" | "title" | "run">;

function resolveFor(
  options: {
    flags?: Record<string, string>;
    config?: Partial<HenchConfig>;
    vendor?: LLMVendor;
    llm?: LLMConfig;
    item?: Pick<PRDItem, "id" | "title" | "run">;
  } = {},
): TaskRunSettings {
  const vendor = options.vendor ?? "claude";
  return resolveTaskRunSettings({
    flags: options.flags ?? {},
    config: { ...DEFAULT_HENCH_CONFIG(), ...options.config } as HenchConfig,
    configuredHenchKeys: new Set(Object.keys(options.config ?? {})),
    llmConfig: { ...options.llm, vendor },
    vendor,
    autonomous: true,
    ...(options.item ? { item: options.item } : {}),
  });
}

const withReview = (review: ReviewConfig): Partial<HenchConfig> => ({ review });
const codes = (r: TaskRunSettings) => r.warnings.map((w) => w.code);

describe("flags", () => {
  it("--review-mode states the mode outright, and is a cli-flag", () => {
    for (const mode of ["off", "self", "pair"] as const) {
      expect(resolveFor({ flags: { "review-mode": mode } }).reviewMode).toEqual({ value: mode, source: "cli-flag" });
    }
    expect(resolveFor({ flags: { "review-mode": "pair" } }).review.value).toBe(true);
    expect(resolveFor({ flags: { "review-mode": "off" } }).review.value).toBe(false);
  });

  it("refuses a value outside off|self|pair and a reviewer outside claude|codex", () => {
    expect(() => parseReviewOptions({ "review-mode": "both" })).toThrow(/--review-mode must be one of off, self, pair/);
    expect(() => parseReviewOptions({ "review-mode": "true" })).toThrow(/--review-mode must be one of/);
    expect(() => parseReviewOptions({ reviewer: "google" })).toThrow(/--reviewer must be one of claude, codex/);
  });

  it("refuses --review-mode alongside a --review or --no-review that says otherwise", () => {
    expect(() => parseReviewOptions({ review: "true", "review-mode": "off" })).toThrow(/--review was passed with --review-mode=off/);
    expect(() => parseReviewOptions({ "no-review": "true", "review-mode": "self" })).toThrow(/--no-review/);
    expect(() => parseReviewOptions({ "no-review": "true", "review-mode": "pair" })).toThrow(/--no-review/);
    // `--review` is "some review"; the mode says which.
    expect(() => parseReviewOptions({ review: "true", "review-mode": "self" })).not.toThrow();
    expect(() => parseReviewOptions({ review: "true", "review-mode": "pair" })).not.toThrow();
    expect(() => parseReviewOptions({ "no-review": "true", "review-mode": "off" })).not.toThrow();
  });

  it("lets a review companion ride on --review-mode self or pair, and refuses it on off", () => {
    expect(() => parseReviewOptions({ "review-mode": "pair", "review-model": "m" })).not.toThrow();
    expect(() => parseReviewOptions({ "review-mode": "self", "review-optional": "true" })).not.toThrow();
    expect(() => parseReviewOptions({ "review-mode": "off", "review-model": "m" })).toThrow(/--no-review/);
  });

  it("takes --reviewer for pair, or alone for a task that saved pair; refuses it with another review", () => {
    expect(() => parseReviewOptions({ "review-mode": "pair", reviewer: "codex" })).not.toThrow();
    expect(() => parseReviewOptions({ review: "true", "review-mode": "pair", reviewer: "codex" })).not.toThrow();
    expect(() => parseReviewOptions({ reviewer: "codex" })).not.toThrow();
    for (const flags of [
      { "review-mode": "self", reviewer: "codex" },
      { "review-mode": "off", reviewer: "codex" },
      { review: "true", reviewer: "codex" },
      { "no-review": "true", reviewer: "codex" },
    ]) {
      expect(() => parseReviewOptions(flags), JSON.stringify(flags)).toThrow(/--reviewer only applies to pair review/);
    }
  });
});

describe("a task's saved reviewMode", () => {
  it("applies as task.run, with the project default as its fallback source", () => {
    const r = resolveFor({ item: task({ reviewMode: "pair" }) });
    expect(r.reviewMode).toEqual({ value: "pair", source: "task.run" });
    expect(r.review).toEqual({ value: true, source: "task.run" });
    expect(r.reviewPairError).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it("outranks the project's mode and the task's own boolean review", () => {
    expect(resolveFor({ config: withReview({ mode: "self" }), item: task({ reviewMode: "off" }) }).reviewMode)
      .toEqual({ value: "off", source: "task.run" });
    expect(resolveFor({ item: task({ review: false, reviewMode: "self" }) }).reviewMode)
      .toEqual({ value: "self", source: "task.run" });
  });

  it("is overruled by every review flag", () => {
    const saved = task({ reviewMode: "pair" });
    expect(resolveFor({ item: saved, flags: { "review-mode": "self" } }).reviewMode)
      .toEqual({ value: "self", source: "cli-flag" });
    expect(resolveFor({ item: saved, flags: { review: "true" } }).reviewMode)
      .toEqual({ value: "self", source: "cli-flag" });
    expect(resolveFor({ item: saved, flags: { "no-review": "true" } }).reviewMode)
      .toEqual({ value: "off", source: "cli-flag" });
  });

  it("falls to the boolean review, then the project, when pair cannot be honoured — with a warning", () => {
    // google has no CLI to pair with.
    const noCli = resolveFor({ vendor: "google", item: task({ reviewMode: "pair", review: false }) });
    expect(noCli.reviewMode).toEqual({ value: "off", source: "task.run" });
    expect(codes(noCli)).toEqual(["saved-review-mode-skipped"]);
    expect(noCli.reviewPairError).toBeUndefined();

    // The API provider has no CLI session to spawn a reviewer on.
    const api = resolveFor({ config: { provider: "api" }, item: task({ reviewMode: "pair" }) });
    expect(api.reviewMode).toEqual({ value: "off", source: "built-in" });
    expect(codes(api)).toEqual(["saved-review-mode-skipped"]);
    expect(api.reviewPairError).toBeUndefined();

    // The project's own reviewer is the executor: self review under another name.
    const clash = resolveFor({
      config: withReview({ vendor: "claude" }),
      item: task({ reviewMode: "pair" }),
    });
    expect(clash.reviewMode.source).not.toBe("task.run");
    expect(codes(clash)).toEqual(["saved-review-mode-skipped"]);
    expect(clash.warnings[0].message).toContain('"Saved"');
  });

  it("still refuses a pair the operator typed on a flag", () => {
    const r = resolveFor({ config: { provider: "api" }, flags: { "review-mode": "pair" } });
    expect(r.reviewMode).toEqual({ value: "pair", source: "cli-flag" });
    expect(r.reviewPairError?.message).toMatch(/requires the CLI provider/);
  });
});

describe("a task's saved reviewVendor", () => {
  it("is the pair reviewer, as task.run, over hench.review.vendor", () => {
    const r = resolveFor({
      vendor: "codex",
      config: withReview({ vendor: "claude" }),
      item: task({ reviewMode: "pair", reviewVendor: "claude" }),
    });
    expect(r.reviewVendor).toEqual({ value: "claude", source: "task.run" });
    expect(r.warnings).toEqual([]);
  });

  it("is overruled by --reviewer", () => {
    // claude executes; the task saves codex; the operator asks for codex too, as a flag.
    const r = resolveFor({ flags: { reviewer: "codex" }, item: task({ reviewMode: "pair", reviewVendor: "codex" }) });
    expect(r.reviewVendor).toEqual({ value: "codex", source: "cli-flag" });
  });

  it("equal to the executor is skipped with a warning, and the run continues as pair", () => {
    const r = resolveFor({ vendor: "claude", item: task({ reviewMode: "pair", reviewVendor: "claude" }) });
    expect(r.reviewMode).toEqual({ value: "pair", source: "task.run" });
    expect(r.reviewVendor).toEqual({ value: "codex", source: "built-in" });
    expect(r.reviewPairError).toBeUndefined();
    expect(codes(r)).toEqual(["saved-review-vendor-skipped"]);
    expect(r.warnings[0].message).toMatch(/executor's own vendor/);
  });

  it("is skipped, to hench.review.vendor, when it is the executor", () => {
    const r = resolveFor({
      vendor: "codex",
      config: withReview({ vendor: "claude" }),
      item: task({ reviewMode: "pair", reviewVendor: "codex" }),
    });
    expect(r.reviewVendor).toEqual({ value: "claude", source: "hench.review.vendor" });
  });

  it("is skipped on an executor with no CLI to pair with", () => {
    const r = resolveFor({
      vendor: "local",
      flags: { "review-mode": "pair" },
      item: task({ reviewVendor: "codex" }),
    });
    expect(r.reviewVendor.source).not.toBe("task.run");
    expect(codes(r)).toContain("saved-review-vendor-skipped");
  });

  it("says nothing when the mode in force is not pair: it is a pair-only setting", () => {
    const r = resolveFor({ item: task({ reviewMode: "self", reviewVendor: "claude" }) });
    expect(r.warnings).toEqual([]);
  });

  it("a flag-typed --reviewer equal to the executor is refused, not skipped", () => {
    const r = resolveFor({ flags: { "review-mode": "pair", reviewer: "claude" } });
    expect(r.reviewPairError?.message).toMatch(/same vendor as the executor/);
  });

  it("moves the reviewer's model to the reviewer's vendor", () => {
    const r = resolveFor({
      vendor: "codex",
      llm: { claude: { reviewModel: "claude-sonnet-4-6" } },
      item: task({ reviewMode: "pair", reviewVendor: "claude" }),
    });
    expect(r.reviewModel).toMatchObject({ value: "claude-sonnet-4-6", source: "llm.claude.reviewModel" });
  });
});

// ---------------------------------------------------------------------------
// `--resolve`
// ---------------------------------------------------------------------------

const DOC = {
  schema: "rex/v1",
  title: "Saved review settings",
  items: [
    {
      id: "epic-1",
      title: "Epic",
      level: "epic" as const,
      status: "pending" as const,
      children: [
        {
          id: "t-pair",
          title: "Pair-reviewed task",
          level: "task" as const,
          status: "pending" as const,
          run: { reviewMode: "pair", reviewVendor: "codex" },
        },
        {
          id: "t-clash",
          title: "Task naming the executor as its reviewer",
          level: "task" as const,
          status: "pending" as const,
          run: { reviewMode: "pair", reviewVendor: "claude" },
        },
        { id: "t-plain", title: "Task with none", level: "task" as const, status: "pending" as const },
      ],
    },
  ],
};

describe("ndx work --resolve", () => {
  let projectDir: string;
  let rexDir: string;

  beforeEach(async () => {
    ({ projectDir, rexDir } = await setupProjectDir("hench-task-review-settings-"));
    await (await resolveStore(rexDir)).saveDocument(DOC as never);
    await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }), "utf-8");
    // A repository's own cli_path applies only once it is trusted; the user's
    // ignored .n-dx.local.json, where `ndx config` writes it, always applies.
    await writeFile(
      join(projectDir, ".n-dx.local.json"),
      JSON.stringify({ llm: { claude: { cli_path: process.execPath } } }),
      "utf-8",
    );
    await writeFile(join(projectDir, ".gitignore"), ".n-dx.local.json\n", "utf-8");
    commitGitFixtureBaseline(projectDir);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  it("reports both saved values with source task.run, and what each falls back to", async () => {
    const r = await resolveRun(projectDir, { task: "t-pair" });

    expect(r.saved).toEqual({ reviewMode: "pair", reviewVendor: "codex" });
    expect(r.resolved.reviewMode).toEqual({
      value: "pair",
      source: "task.run",
      fallback: { value: "off", source: "built-in" },
    });
    expect(r.resolved.reviewVendor).toEqual({
      value: "codex",
      source: "task.run",
      fallback: { value: "codex", source: "built-in" },
    });
    expect(r.resolved.review).toMatchObject({ value: true, source: "task.run" });
    expect(r.refusals).toEqual([]);
  });

  it("lets the flags override them, as cli-flag", async () => {
    const r = await resolveRun(projectDir, { task: "t-pair", "review-mode": "self" });
    expect(r.resolved.reviewMode).toEqual({ value: "self", source: "cli-flag" });

    const off = await resolveRun(projectDir, { task: "t-pair", "no-review": "true" });
    expect(off.resolved.reviewMode).toEqual({ value: "off", source: "cli-flag" });

    const reviewer = await resolveRun(projectDir, { task: "t-pair", reviewer: "claude" });
    expect(reviewer.resolved.reviewVendor).toEqual({ value: "claude", source: "cli-flag" });
    // claude is the executor: a typed reviewer that is the executor is refused.
    expect(reviewer.refusals.map((x) => x.code)).toContain("provider-unsupported");
  });

  it("skips a saved reviewVendor equal to the executor, warns, and does not refuse", async () => {
    const r = await resolveRun(projectDir, { task: "t-clash" });

    expect(r.resolved.reviewMode).toMatchObject({ value: "pair", source: "task.run" });
    expect(r.resolved.reviewVendor).toEqual({ value: "codex", source: "built-in" });
    expect(r.warnings.map((w) => w.code)).toContain("saved-review-vendor-skipped");
    expect(r.refusals).toEqual([]);
  });

  it("leaves a task with no saved review settings on the project's defaults", async () => {
    const r = await resolveRun(projectDir, { task: "t-plain" });
    expect(r.resolved.reviewMode).toEqual({ value: "off", source: "built-in" });
    expect(r.resolved.reviewVendor).toEqual({ value: "codex", source: "built-in" });
    expect(r.review.rounds).toEqual({ value: 2, source: "built-in" });
  });

  it("lists the two options with their flags and values", async () => {
    const { options } = await resolveRun(projectDir, { task: "t-plain" });
    expect(options.find((o) => o.key === "reviewMode")).toMatchObject({
      flag: "review-mode",
      type: "enum",
      values: ["off", "self", "pair"],
      scope: "task",
    });
    expect(options.find((o) => o.key === "reviewVendor")).toMatchObject({
      flag: "reviewer",
      type: "enum",
      values: ["claude", "codex"],
      scope: "task",
    });
  });
});
