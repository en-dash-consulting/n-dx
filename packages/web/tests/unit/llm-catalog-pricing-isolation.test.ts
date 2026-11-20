/** Pricing coverage must not grant built-in Codex selection or execute access. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODEL_COSTS, TIER_MODELS, isModelCompatibleWithVendor } from "@n-dx/llm-client";
import { buildLlmCatalog, validateCatalogModel } from "../../src/server/routes-llm.js";
import { validateRunOptions } from "../../src/server/run-options.js";
import type { LiveVendorProbe } from "../../src/server/llm-catalog.js";

const probe = vi.hoisted(() => vi.fn());
vi.mock("../../src/server/llm-catalog.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/llm-catalog.js")>()),
  getLiveVendorProbe: probe,
}));

// The retained catalog plus PR3's three explicit defaults, independent of price coverage.
const BUILT_IN_CODEX = ["gpt-5.4-mini", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gpt-6-luna", "gpt-6.1-sol"];
const pricingOnly = Object.keys(MODEL_COSTS)
  .filter((id) => isModelCompatibleWithVendor("codex", id) && !BUILT_IN_CODEX.includes(id));
const failedProbe: LiveVendorProbe = {
  listing: { ok: false, reason: "Model list request failed" },
  checkedAt: "2026-11-19T00:00:00.000Z",
  cli: { found: false, version: null, path: null },
};
let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-catalog-pricing-"));
  // Invalid local endpoint avoids unrelated network I/O in these in-process tests.
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({
    llm: { vendor: "codex", local: { port: 70000 } },
  }));
  probe.mockReset().mockResolvedValue(failedProbe);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("Codex catalog pricing isolation", () => {
  it.each(["API key not configured", "Model list request failed"])("keeps the explicit fallback models when %s", async (reason) => {
    probe.mockResolvedValue({ ...failedProbe, listing: { ok: false, reason } });
    const catalog = await buildLlmCatalog(projectDir, false);
    expect(catalog.codex).toMatchObject({ models: BUILT_IN_CODEX, source: "built-in", reason, checkedAt: failedProbe.checkedAt });
    expect(pricingOnly.length).toBeGreaterThan(0);
    for (const model of pricingOnly) expect(catalog.codex.models).not.toContain(model);
  });

  it.each(BUILT_IN_CODEX)("accepts built-in %s without probing", async (model) => {
    expect(await validateRunOptions(projectDir, { model, review: true, reviewModel: model })).toEqual({
      ok: true, options: { model, review: true, reviewModel: model },
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it.each(pricingOnly)("refuses pricing-only %s for execution and review when the live probe fails", async (model) => {
    for (const key of ["model", "reviewModel"]) {
      expect(await validateRunOptions(projectDir, { review: true, [key]: model })).toEqual({
        ok: false, key, error: `Run option "${key}": Cannot check model "${model}" in the codex catalog: Model list request failed`,
      });
    }
    expect(probe).toHaveBeenCalledWith("codex", projectDir, { provider: "cli" });
  });

  it.each(["gpt-client-only-9", "gpt-live-only-9", "gpt-6.1-sol-20261116"])("accepts literal %s only when the live list reports it", async (model) => {
    probe.mockResolvedValue({ ...failedProbe, listing: { ok: true, models: [model] } });
    expect((await buildLlmCatalog(projectDir, false)).codex).toMatchObject({ source: "live", models: [model] });
    expect(await validateRunOptions(projectDir, { model, review: true, reviewModel: model })).toEqual({
      ok: true, options: { model, review: true, reviewModel: model },
    });
    probe.mockResolvedValue(failedProbe);
    expect(await validateCatalogModel(projectDir, "codex", model)).toBe(`Cannot check model "${model}" in the codex catalog: Model list request failed`);
  });

  it("refuses a pricing-only id omitted from a successful live listing", async () => {
    probe.mockResolvedValue({ ...failedProbe, listing: { ok: true, models: ["gpt-live-only-9"] } });
    expect(await validateCatalogModel(projectDir, "codex", "gpt-5.4"))
      .toBe('Model "gpt-5.4" is not in the codex catalog.');
  });

  it("preserves a configured literal pin without adding it to the fallback list", async () => {
    const model = "gpt-6.1-sol-20261116";
    await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({
      llm: { vendor: "codex", codex: { model }, local: { port: 70000 } },
    }));
    const catalog = await buildLlmCatalog(projectDir, false);
    expect(catalog.codex.defaultModel).toBe(model);
    expect(catalog.codex.models).toEqual(BUILT_IN_CODEX);
  });

  it("preserves Claude and Google catalogs and local validation", async () => {
    const catalog = await buildLlmCatalog(projectDir, false);
    for (const vendor of ["claude", "google"] as const) {
      const expected = [...new Set([
        ...Object.values(TIER_MODELS[vendor]),
        ...Object.keys(MODEL_COSTS).filter((id) => isModelCompatibleWithVendor(vendor, id)),
      ])].sort();
      expect(catalog[vendor].models).toEqual(expected);
      for (const model of expected) expect(await validateCatalogModel(projectDir, vendor, model)).toBeNull();
    }
    expect(await validateCatalogModel(projectDir, "local", "arbitrary-local-pin")).toBeNull();
  });
});
