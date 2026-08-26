/**
 * Unit tests for light-tier model routing in the pre-run commit-message
 * generation path (proposePreRunCommitMessage).
 *
 * Commit-message generation is a mechanical single-shot call, so it should
 * resolve the vendor's light-tier model instead of the run's standard model.
 * The gate passes the run's resolved model in; when that value matches the
 * config-derived standard resolution (no explicit --model override), the
 * light tier is used. A differing model is an explicit override and wins.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { proposePreRunCommitMessage } from "../../../../src/agent/lifecycle/shared.js";
import { defaultRegistry, TIER_MODELS, NEWEST_MODELS } from "../../../../src/prd/llm-gateway.js";
import type { ReviewDiff } from "../../../../src/agent/analysis/review.js";

const diff: ReviewDiff = {
  stat: " 1 file changed, 2 insertions(+)",
  diff: "diff --git a/x.ts b/x.ts\n+added line\n",
};

describe("proposePreRunCommitMessage light-tier routing", () => {
  let tmpDir: string;
  let henchDir: string;
  let capturedModels: Array<string | undefined>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-commit-msg-"));
    henchDir = join(tmpDir, ".hench");
    capturedModels = [];
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue({
      complete: async ({ model }: { prompt: string; model?: string }) => {
        capturedModels.push(model);
        return { text: "feat: add a line to x" };
      },
    } as never);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("uses the light-tier model when the passed model is the standard resolution", async () => {
    // The gate passes the run's resolved model — the config-derived standard
    // model when no --model flag was given.
    const message = await proposePreRunCommitMessage(diff, henchDir, NEWEST_MODELS.claude);

    expect(capturedModels).toEqual([TIER_MODELS.claude.light]);
    expect(message).toBe("feat: add a line to x");
  });

  it("uses the light-tier model when no model is passed at all", async () => {
    await proposePreRunCommitMessage(diff, henchDir);

    expect(capturedModels).toEqual([TIER_MODELS.claude.light]);
  });

  it("honors an explicit model override (differs from the standard resolution)", async () => {
    await proposePreRunCommitMessage(diff, henchDir, "claude-opus-4-7");

    expect(capturedModels).toEqual(["claude-opus-4-7"]);
  });

  it("honors a configured lightModel for the light tier", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: { vendor: "claude", claude: { lightModel: "claude-custom-light" } },
      }),
      "utf-8",
    );

    await proposePreRunCommitMessage(diff, henchDir, NEWEST_MODELS.claude);

    expect(capturedModels).toEqual(["claude-custom-light"]);
  });

  it("falls back to the deterministic message when the provider errors", async () => {
    vi.spyOn(defaultRegistry, "getActiveProvider").mockImplementation(() => {
      throw new Error("no credentials");
    });

    const message = await proposePreRunCommitMessage(diff, henchDir);

    expect(message).toBe("chore: commit local changes before hench run");
  });
});
