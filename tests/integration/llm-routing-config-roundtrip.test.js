/**
 * End-to-end contract: routing config set through `ndx config` must actually
 * change what `resolveTaskModel` returns.
 *
 * The three layers are independently plausible and still fail together — the
 * CLI can write a key the loader's whitelist drops, or write it nested where
 * the loader expects a flat map. Either way the user sets a route, sees no
 * error, and gets the old model. This test walks the whole path: CLI write →
 * `.n-dx.json` → `loadLLMConfig` → `resolveTaskModel`.
 *
 * @see packages/core/config.js — validators and flat-map path handling
 * @see packages/llm-client/src/llm-config.ts — the extractor whitelist
 * @see packages/llm-client/src/config.ts — resolveTaskModel
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  loadLLMConfig,
  resolveTaskModel,
  resolveVendorModel,
  TIER_MODELS,
  resolveModel,
} from "../../packages/llm-client/dist/public.js";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

let projectDir;

function config(...args) {
  return execFileSync("node", [CLI_PATH, "config", ...args, projectDir], {
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 60_000,
  });
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-routing-roundtrip-"));
  // Seed the vendor by writing the file rather than via `ndx config
  // llm.vendor`: that path runs a vendor preflight that reaches for the
  // real CLI binary, which made this setup both slow and flaky. The routing
  // keys under test need no preflight.
  await writeFile(
    join(projectDir, ".n-dx.json"),
    JSON.stringify({ llm: { vendor: "claude" } }, null, 2),
    "utf-8",
  );
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("routing config reaches resolveTaskModel", () => {
  it("a route set via the CLI changes the resolved tier and model", async () => {
    // Baseline: the agent loop is standard by registry default.
    let llmConfig = await loadLLMConfig(projectDir);
    expect(resolveTaskModel("agent.execute", llmConfig).tier).toBe("standard");

    config("llm.routes.agent.execute", "heavy");

    llmConfig = await loadLLMConfig(projectDir);
    const resolved = resolveTaskModel("agent.execute", llmConfig);
    expect(resolved.tier).toBe("heavy");
    expect(resolved.model).toBe(resolveModel(TIER_MODELS.claude.heavy));
  });

  it("writes the dotted task class as a flat key the loader can read", async () => {
    config("llm.routes.agent.execute", "heavy");

    // The nesting failure mode: { routes: { agent: { execute } } } would be
    // dropped by the flat-map extractor, so the route would silently no-op.
    const raw = JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8"));
    expect(raw.llm.routes).toEqual({ "agent.execute": "heavy" });

    const llmConfig = await loadLLMConfig(projectDir);
    expect(llmConfig.routes).toEqual({ "agent.execute": "heavy" });
  });

  it("a tier-map override set via the CLI changes the model for that tier", async () => {
    config("llm.tiers.claude.light", "claude-haiku-4-5-custom");

    const llmConfig = await loadLLMConfig(projectDir);
    const resolved = resolveTaskModel("git.commit-message", llmConfig);
    expect(resolved.tier).toBe("light");
    expect(resolved.model).toBe("claude-haiku-4-5-custom");
  });

  it("a glob route set via the CLI applies to every class under the prefix", async () => {
    config("llm.routes.prd.*", "heavy");

    const llmConfig = await loadLLMConfig(projectDir);
    expect(resolveTaskModel("prd.rename", llmConfig).tier).toBe("heavy");
    expect(resolveTaskModel("prd.merge", llmConfig).tier).toBe("heavy");
    // Classes outside the prefix keep their registry defaults.
    expect(resolveTaskModel("code.classify", llmConfig).tier).toBe("light");
  });

  it("an effort level set via the CLI is returned by the resolver", async () => {
    config("llm.effort.agent.execute", "high");

    const llmConfig = await loadLLMConfig(projectDir);
    expect(resolveTaskModel("agent.execute", llmConfig).effort).toBe("high");
  });

  it("llm.model acts as the standard-tier shorthand without touching light", async () => {
    config("llm.model", "claude-opus-5");

    const llmConfig = await loadLLMConfig(projectDir);
    expect(resolveTaskModel("prd.propose", llmConfig).model).toBe("claude-opus-5");
    // Light-routed classes are unaffected — that is what makes it a
    // standard-tier shorthand rather than a global override.
    expect(resolveTaskModel("prd.rename", llmConfig).model).toBe(
      resolveVendorModel("claude", {}, "light"),
    );
  });

  it("escalation settings round-trip with their JSON types intact", async () => {
    config("llm.escalation.enabled", "true");
    config("llm.escalation.maxSteps", "1");

    const llmConfig = await loadLLMConfig(projectDir);
    expect(llmConfig.escalation).toEqual({ enabled: true, maxSteps: 1 });
  });
});
