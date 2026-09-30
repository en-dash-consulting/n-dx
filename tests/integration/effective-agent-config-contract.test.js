/**
 * Contract: the `effective` block of `GET /api/llm/config` must describe what
 * `ndx work` actually does.
 *
 * The dashboard tells the user which vendor, provider and model a flagless run
 * will use. Web cannot import hench to ask — hench is the execution tier,
 * above the domain packages web depends on — so
 * `packages/web/src/server/effective-agent-config.ts` keeps a separately
 * maintained twin of hench's `resolveAgentModel` and of `cmdRun`'s provider
 * gate. A twin that drifts does not fail loudly: the page keeps rendering, and
 * keeps naming a model the run does not use. This test is what catches it.
 *
 * The matrix builds real project directories — `.n-dx.json` plus
 * `.hench/config.json` on the legacy layout — across every vendor and every
 * config shape that changes the answer, then runs each through both sides and
 * compares. Nothing here hardcodes an expected model id: the assertion is
 * agreement, and a fixture whose expected value had to be written down would
 * be pinning this test's opinion rather than hench's behaviour. Two vacuity
 * guards below keep "agreement" from meaning "both returned nothing".
 *
 * ## Why here rather than in cross-package-contracts.test.js
 *
 * The acceptance criterion this inherits named that file, but it is
 * deliberately dist-import-only — its header says so, and it has no
 * mkdtemp/tmpdir harness to build fixtures with. The pure symbol pin (that
 * hench exports `resolveAgentModel` at all) stays there; the fixture matrix
 * lives here, beside `llm-routing-config-roundtrip.test.js`, which is the
 * existing fixture-based analogue of exactly this shape.
 *
 * Imports are from `dist/` for the same reason the other cross-package tests
 * are: package-level vitest aliases resolve `@n-dx/*` to source, which would
 * bypass the compiled boundary these two packages actually meet at.
 *
 * @see packages/web/src/server/effective-agent-config.ts
 * @see packages/hench/src/cli/commands/agent-model.ts
 * @see packages/hench/src/cli/commands/provider-support.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveAgentModel, isProviderSupported } from "../../packages/hench/dist/public.js";
import { resolveEffectiveAgentConfig } from "../../packages/web/dist/server/effective-agent-config.js";
import { loadLLMConfig, DEFAULT_LLM_VENDOR } from "../../packages/llm-client/dist/public.js";

const VENDORS = ["claude", "codex", "google", "local"];

/**
 * A model each vendor can actually run.
 *
 * hench's `resolveAgentModel` throws on a model pinned for a vendor that
 * cannot run it, so the matrix has to pin compatible ones — an incompatible
 * fixture would test the throw, not the chain. `local` is not in
 * `TIER_MODELS` (LM Studio serves whatever is loaded, so the tiers are empty
 * strings and any non-empty id is legitimate).
 */
const PINNED_MODEL = {
  claude: "claude-opus-5",
  codex: "gpt-5.6-sol",
  google: "gemini-2.5-pro",
  local: "qwen3-coder-30b",
};

/** A second, distinct compatible model, so precedence cases can tell the rungs apart. */
const OVERRIDE_MODEL = {
  claude: "claude-haiku-4-5",
  codex: "gpt-5.6-luna",
  google: "gemini-3.5-flash-lite",
  local: "llama-3.3-70b",
};

let projectDir;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-effective-contract-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

/** Write `.n-dx.json` and, when `henchConfig` is given, `.hench/config.json`. */
async function seed(ndxConfig, henchConfig) {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(ndxConfig, null, 2), "utf-8");
  if (henchConfig) {
    await mkdir(join(projectDir, ".hench"), { recursive: true });
    await writeFile(
      join(projectDir, ".hench", "config.json"),
      JSON.stringify(henchConfig, null, 2),
      "utf-8",
    );
  }
}

/**
 * The config shapes that change which rung wins.
 *
 * `legacy` and `legacy+modern` only exist for claude — the top-level
 * `claude.*` block is the only legacy namespace, and `resolveClaudeConfig`
 * folds it in per field with the modern key winning.
 */
function shapesFor(vendor) {
  const pinned = PINNED_MODEL[vendor];
  const override = OVERRIDE_MODEL[vendor];

  const shapes = [
    {
      name: "nothing configured",
      ndx: { llm: { vendor } },
      hench: undefined,
    },
    {
      name: "modern llm.<vendor>.model only",
      ndx: { llm: { vendor, [vendor]: { model: pinned } } },
      hench: undefined,
    },
    {
      name: "vendor-neutral llm.model set",
      ndx: { llm: { vendor, model: pinned } },
      hench: undefined,
    },
    {
      name: "llm.model outranks llm.<vendor>.model",
      ndx: { llm: { vendor, model: pinned, [vendor]: { model: override } } },
      hench: undefined,
    },
    {
      name: "hench.models.<vendor> set",
      ndx: { llm: { vendor } },
      hench: { models: { [vendor]: override } },
    },
    {
      name: "hench.models.<vendor> outranks llm.<vendor>.model",
      ndx: { llm: { vendor, [vendor]: { model: pinned } } },
      hench: { models: { [vendor]: override } },
    },
    {
      name: "hench.models set for another vendor only",
      ndx: { llm: { vendor, [vendor]: { model: pinned } } },
      hench: { models: { [vendor === "claude" ? "codex" : "claude"]: "some-other-model" } },
    },
    {
      name: "agent.execute routed to the heavy tier",
      ndx: { llm: { vendor, routes: { "agent.execute": "heavy" } } },
      hench: undefined,
    },
  ];

  if (vendor === "claude") {
    shapes.push(
      {
        name: "legacy claude.* keys only",
        ndx: { llm: { vendor }, claude: { model: pinned } },
        hench: undefined,
      },
      {
        name: "legacy and modern claude keys both set",
        ndx: { llm: { vendor, claude: { model: pinned } }, claude: { model: override } },
        hench: undefined,
      },
    );
  }

  return shapes;
}

describe("web's effective-agent-config twin agrees with hench", () => {
  for (const vendor of VENDORS) {
    for (const shape of shapesFor(vendor)) {
      it(`${vendor}: ${shape.name}`, async () => {
        await seed(shape.ndx, shape.hench);

        const web = await resolveEffectiveAgentConfig(projectDir);

        // hench reads the same two files: `.n-dx.json` (+ local overlay)
        // through this same loader, and `models` out of `.hench/config.json`.
        const llmConfig = await loadLLMConfig(projectDir);
        const hench = resolveAgentModel({
          vendor,
          henchModels: shape.hench?.models,
          llmConfig,
        });

        expect(web.model).toBe(hench.model);
        expect(web.modelSource).toBe(hench.source);

        // Vacuity guard: `toBe` between two undefineds would pass for every
        // row above. A cloud vendor always resolves to some model id.
        if (vendor !== "local") {
          expect(typeof web.model).toBe("string");
          expect(web.model.length).toBeGreaterThan(0);
        }
        expect(["hench-override", "configured", "default"]).toContain(web.modelSource);
      });
    }
  }

  it("reports the vendor hench would resolve", async () => {
    // hench's `resolveLLMVendor` is `llmConfig.vendor ?? DEFAULT_LLM_VENDOR`
    // over llm-client's own constant, which is the rule restated here.
    for (const vendor of VENDORS) {
      await seed({ llm: { vendor } });
      expect((await resolveEffectiveAgentConfig(projectDir)).vendor).toBe(vendor);
    }

    await seed({});
    expect((await resolveEffectiveAgentConfig(projectDir)).vendor).toBe(DEFAULT_LLM_VENDOR);
  });

  it("covers every rung of the chain the route can reach", async () => {
    // Vacuity guard for the matrix as a whole: if a refactor made every shape
    // resolve to "default", every row above would still agree and the test
    // would be pinning nothing. All three reachable sources must appear.
    const seen = new Set();
    for (const vendor of VENDORS) {
      for (const shape of shapesFor(vendor)) {
        await seed(shape.ndx, shape.hench);
        seen.add((await resolveEffectiveAgentConfig(projectDir)).modelSource);
      }
    }
    expect([...seen].sort()).toEqual(["configured", "default", "hench-override"]);
  });
});

describe("web's provider switch agrees with hench's isProviderSupported", () => {
  for (const vendor of VENDORS) {
    for (const configured of ["cli", "api"]) {
      it(`${vendor} + provider=${configured}`, async () => {
        await seed({ llm: { vendor } }, { provider: configured });

        const { provider } = await resolveEffectiveAgentConfig(projectDir);

        if (isProviderSupported(vendor, configured)) {
          // Supported: reported untouched.
          expect(provider).toBe(configured);
        } else if (configured === "cli") {
          // hench auto-switches an unsupported "cli"; the result must be one
          // hench accepts, checked against hench's own predicate rather than
          // against a literal restated here.
          expect(provider).toBe("api");
          expect(isProviderSupported(vendor, provider)).toBe(true);
        } else {
          // Unsupported "api" — codex only. hench refuses the run outright
          // rather than switching, so there is nothing to switch to and the
          // configured value is reported unchanged.
          expect(provider).toBe(configured);
          expect(isProviderSupported(vendor, provider)).toBe(false);
        }
      });
    }
  }

  it("defaults to hench's own default provider when .hench/config.json is absent", async () => {
    await seed({ llm: { vendor: "claude" } });
    expect((await resolveEffectiveAgentConfig(projectDir)).provider).toBe("cli");
  });

  it("exercises both the pass-through and the auto-switch branch", async () => {
    // Vacuity guard: the matrix above must actually reach the switch.
    await seed({ llm: { vendor: "google" } }, { provider: "cli" });
    expect((await resolveEffectiveAgentConfig(projectDir)).provider).toBe("api");

    await seed({ llm: { vendor: "claude" } }, { provider: "cli" });
    expect((await resolveEffectiveAgentConfig(projectDir)).provider).toBe("cli");
  });
});
