/**
 * `hench.review.*` — the project rung of the review settings.
 *
 * Precedence for the review pass: `--review` / `--no-review` > the task's saved
 * `run.review` > `hench.review.mode` > off. `self` is today's `--review`;
 * `pair` is a recognised value that runs no review until pair review exists,
 * and must never fall back to self review.
 *
 * @see packages/hench/src/cli/commands/run-settings.ts — the shared resolver
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LLMConfig, LLMVendor } from "@n-dx/llm-client";
import { resolveTaskRunSettings } from "../../src/cli/commands/run-settings.js";
import type { TaskRunSettings } from "../../src/cli/commands/run-settings.js";
import { resolveRun } from "../../src/cli/commands/run-resolve.js";
import { DEFAULT_HENCH_CONFIG, HENCH_SCHEMA_VERSION } from "../../src/schema/index.js";
import type { HenchConfig, ReviewConfig } from "../../src/schema/index.js";
import { HenchConfigSchema } from "../../src/schema/validate.js";
import type { PRDItem } from "../../src/prd/rex-gateway.js";
import { resolveStore } from "../../src/prd/rex-gateway.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

function resolveFor(
  options: {
    flags?: Record<string, string>;
    config?: Partial<HenchConfig>;
    vendor?: LLMVendor;
    item?: Pick<PRDItem, "id" | "title" | "run">;
  } = {},
): TaskRunSettings {
  const vendor = options.vendor ?? "claude";
  const llm: LLMConfig = { vendor };
  return resolveTaskRunSettings({
    flags: options.flags ?? {},
    config: { ...DEFAULT_HENCH_CONFIG(), ...options.config } as HenchConfig,
    configuredHenchKeys: new Set(Object.keys(options.config ?? {})),
    llmConfig: llm,
    vendor,
    autonomous: true,
    ...(options.item ? { item: options.item } : {}),
  });
}

const withReview = (review: ReviewConfig): Partial<HenchConfig> => ({ review });
const savedReview = (review: boolean) => ({ id: "t-1", title: "Saved", run: { review } }) as Pick<PRDItem, "id" | "title" | "run">;

describe("hench.review.mode", () => {
  it("is off, from built-in, when nothing sets it", () => {
    const r = resolveFor();
    expect(r.reviewMode).toEqual({ value: "off", source: "built-in" });
    expect(r.review).toEqual({ value: false, source: "built-in" });
    expect(r.reviewRounds).toEqual({ value: 2, source: "built-in" });
    expect(r.warnings).toEqual([]);
  });

  it("self runs the review pass exactly as --review does, naming the key", () => {
    const configured = resolveFor({ config: withReview({ mode: "self" }) });
    const flagged = resolveFor({ flags: { review: "true" } });

    expect(configured.review).toEqual({ value: true, source: "hench.review.mode" });
    expect(configured.reviewMode).toEqual({ value: "self", source: "hench.review.mode" });
    expect(configured.reviewModel.value).toBe(flagged.reviewModel.value);
    expect(configured.reviewOptional).toEqual(flagged.reviewOptional);
  });

  it("is overruled by --no-review, --review and a task's saved review", () => {
    const self = withReview({ mode: "self" });
    expect(resolveFor({ config: self, flags: { "no-review": "true" } }).review).toEqual({
      value: false,
      source: "cli-flag",
    });
    expect(resolveFor({ config: self, item: savedReview(false) }).review).toEqual({
      value: false,
      source: "task.run",
    });
    const pair = withReview({ mode: "pair" });
    expect(resolveFor({ config: pair, flags: { review: "true" } }).reviewMode).toEqual({
      value: "self",
      source: "cli-flag",
    });
    expect(resolveFor({ config: pair, item: savedReview(true) }).review).toEqual({
      value: true,
      source: "task.run",
    });
  });

  it("drops a configured self review on the API provider with a warning, not a refusal", () => {
    const r = resolveFor({ config: { provider: "api", ...withReview({ mode: "self" }) } });
    expect(r.review).toEqual({ value: false, source: "vendor-unsupported" });
    expect(r.warnings.map((w) => w.code)).toContain("configured-review-unsupported");
  });

  it("pair runs no review, says so once, and never falls back to self review", () => {
    const r = resolveFor({ config: withReview({ mode: "pair" }) });
    expect(r.reviewMode).toEqual({ value: "pair", source: "hench.review.mode" });
    expect(r.review.value).toBe(false);
    expect(r.warnings.filter((w) => w.code === "pair-review-unavailable")).toHaveLength(1);
    expect(r.warnings[0]!.message).toMatch(/not available yet/);
    expect(r.reviewPairError).toBeUndefined();
  });
});

describe("hench.review.vendor and hench.review.rounds", () => {
  it("defaults the reviewer to the executor's other CLI vendor", () => {
    expect(resolveFor({ vendor: "claude" }).reviewVendor).toEqual({ value: "codex", source: "built-in" });
    expect(resolveFor({ vendor: "codex" }).reviewVendor).toEqual({ value: "claude", source: "built-in" });
  });

  it("reports the configured reviewer and rounds with their keys", () => {
    const r = resolveFor({ config: withReview({ mode: "pair", vendor: "codex", rounds: 3 }) });
    expect(r.reviewVendor).toEqual({ value: "codex", source: "hench.review.vendor" });
    expect(r.reviewRounds).toEqual({ value: 3, source: "hench.review.rounds" });
  });

  it("refuses pair mode when the reviewer is the executor's own vendor", () => {
    const r = resolveFor({ config: withReview({ mode: "pair", vendor: "claude" }), vendor: "claude" });
    expect(r.reviewPairError?.message).toMatch(/same vendor as the executor/);
  });

  it("refuses pair mode for an executor that is not claude or codex", () => {
    const r = resolveFor({ config: withReview({ mode: "pair" }), vendor: "google" });
    expect(r.reviewPairError?.message).toMatch(/executor that is claude or codex/);
  });

  it("refuses pair mode on the API provider", () => {
    const r = resolveFor({ config: { provider: "api", ...withReview({ mode: "pair" }) } });
    expect(r.reviewPairError?.message).toMatch(/requires the CLI provider/);
  });

  it("does not refuse when --no-review turns pair off", () => {
    const r = resolveFor({
      config: withReview({ mode: "pair", vendor: "claude" }),
      flags: { "no-review": "true" },
    });
    expect(r.reviewPairError).toBeUndefined();
  });
});

describe("the schema", () => {
  const parse = (review: unknown) => HenchConfigSchema.safeParse({ ...DEFAULT_HENCH_CONFIG(), schema: HENCH_SCHEMA_VERSION, review });

  it("accepts every documented value", () => {
    expect(parse({ mode: "pair", vendor: "codex", rounds: 3 }).success).toBe(true);
    expect(parse({ mode: "off", vendor: "claude", rounds: 1 }).success).toBe(true);
  });

  it("refuses a mode, vendor or round count outside the documented set", () => {
    expect(parse({ mode: "sometimes" }).success).toBe(false);
    expect(parse({ vendor: "google" }).success).toBe(false);
    expect(parse({ rounds: 4 }).success).toBe(false);
    expect(parse({ rounds: 0 }).success).toBe(false);
    expect(parse({ rounds: 1.5 }).success).toBe(false);
  });
});

const DOC = {
  schema: "rex/v1",
  title: "Review settings",
  items: [
    {
      id: "epic-1",
      title: "Epic",
      level: "epic" as const,
      status: "pending" as const,
      children: [{ id: "t-plain", title: "Plain task", level: "task" as const, status: "pending" as const }],
    },
  ],
};

describe("ndx work --resolve reports the review settings and their sources", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    ({ projectDir, henchDir, rexDir } = await setupProjectDir("hench-review-settings-"));
    await (await resolveStore(rexDir)).saveDocument(DOC as never);
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", claude: { cli_path: process.execPath } } }),
      "utf-8",
    );
    commitGitFixtureBaseline(projectDir);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  it("names built-in for each, then the hench.review.* key once the project sets it", async () => {
    const before = await resolveRun(projectDir, { task: "t-plain" });
    expect(before.review.mode).toEqual({ value: "off", source: "built-in" });
    expect(before.review.vendor).toEqual({ value: "codex", source: "built-in" });
    expect(before.review.rounds).toEqual({ value: 2, source: "built-in" });

    const path = join(henchDir, "config.json");
    const { readFile } = await import("node:fs/promises");
    const config = JSON.parse(await readFile(path, "utf-8")) as HenchConfig;
    await writeFile(path, JSON.stringify({ ...config, review: { mode: "self", vendor: "codex", rounds: 3 } }), "utf-8");

    const after = await resolveRun(projectDir, { task: "t-plain" });
    expect(after.review.mode).toEqual({ value: "self", source: "hench.review.mode" });
    expect(after.review.vendor).toEqual({ value: "codex", source: "hench.review.vendor" });
    expect(after.review.rounds).toEqual({ value: 3, source: "hench.review.rounds" });
    expect(after.resolved.review).toEqual({ value: true, source: "hench.review.mode" });
  });
});
