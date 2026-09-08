/**
 * Envelope structure and per-section cost for rex's prompts.
 *
 * The companion to `prompt-text-identity.test.ts`. That file proves the
 * migration did not change what rex sends; this one proves the migration
 * bought something — that every prompt now exposes named sections whose token
 * cost can be attributed individually, which is what the follow-on rewrites
 * need in order to open the largest section first.
 *
 * The invariants that matter:
 *
 * - Assembling an envelope reproduces the paired `*Prompt` function exactly,
 *   so the measured sections are the text that is actually sent.
 * - Section names are unique within a prompt. A duplicate name would split one
 *   part's cost across two identically-labelled rows and silently mislead.
 * - Section names come from the shared vocabulary, so a section's cost is
 *   comparable across builders.
 * - The section costs sum to the whole, so no part of a prompt is unattributed.
 *
 * The builder list itself lives in `__fixtures__/prompt-surfaces.ts`, shared
 * with `prompt-non-redundancy.test.ts` so a new prompt cannot be covered by one
 * suite and missed by the other.
 *
 * @see packages/rex/src/analyze/prompt-envelope.ts — the vocabulary
 * @see packages/llm-client/src/prompt-diagnostics.ts — the shared measurement
 */

import { describe, it, expect } from "vitest";

import {
  REX_PROMPT_SECTIONS,
  rexPrompt,
  rexPromptCosts,
} from "../../../src/analyze/prompt-envelope.js";
import { buildAddEnvelope } from "../../../src/analyze/reason.js";
import { buildDisambiguationEnvelope } from "../../../src/analyze/extract.js";
import {
  REX_PROMPT_SURFACES as SURFACES,
  EXISTING_ITEMS,
  PROJECT_CONTEXT,
} from "./__fixtures__/prompt-surfaces.js";

// ── Structural invariants, applied to every surface ─────────────────────────

describe("every rex prompt is envelope-built", () => {
  it("covers all 19 registered prompt surfaces", () => {
    // Keeps this file honest against scripts/prompt-census.mjs, which declares
    // 19 rex surfaces. A new prompt with no entry here would go unmeasured.
    expect(SURFACES).toHaveLength(19);
  });

  it.each(SURFACES.map((s) => [s.name, s] as const))(
    "%s exposes named, non-empty sections",
    (_name, surface) => {
      expect(surface.envelope.sections.length).toBeGreaterThan(1);
      for (const s of surface.envelope.sections) {
        expect(s.content.length).toBeGreaterThan(0);
        expect(s.name).toBeTruthy();
      }
    },
  );

  it.each(SURFACES.map((s) => [s.name, s] as const))(
    "%s uses section names from the shared vocabulary",
    (_name, surface) => {
      for (const s of surface.envelope.sections) {
        expect(REX_PROMPT_SECTIONS).toContain(s.name);
      }
    },
  );

  it.each(SURFACES.map((s) => [s.name, s] as const))(
    "%s names each section at most once",
    (_name, surface) => {
      const names = surface.envelope.sections.map((s) => s.name);
      expect(names).toEqual([...new Set(names)]);
    },
  );

  it.each(SURFACES.filter((s) => s.assembled !== undefined).map((s) => [s.name, s] as const))(
    "%s assembles to exactly what its prompt function returns",
    (_name, surface) => {
      expect(rexPrompt(surface.envelope, { separator: surface.separator })).toBe(
        surface.assembled,
      );
    },
  );
});

// ── Cost attribution ───────────────────────────────────────────────────────

describe("rex prompt cost is attributable to sections", () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))(
    "%s reports a cost per section, summing to 100%%",
    (_name, surface) => {
      const costs = rexPromptCosts(surface.envelope);

      expect(costs).toHaveLength(surface.envelope.sections.length);
      for (const c of costs) {
        expect(c.tokenEstimate).toBeGreaterThan(0);
      }
      expect(costs.reduce((n, c) => n + c.sharePercent, 0)).toBeCloseTo(100, 6);
    },
  );

  it("names the few-shot example as the single dominant cost of a propose prompt", () => {
    // The finding that makes the follow-on rewrite tractable. Measured at the
    // time of writing, `buildAddEnvelope` over a two-item PRD costs ~1,730
    // tokens and divides as:
    //
    //   example 25% · schema 19% · consolidation 13% · quality 11% ·
    //   anti-patterns 8% · placement 7% · dedup 5% · structure 4% ·
    //   output 3% · role 2% · existing-prd 2% · project-context 1% · input 0.5%
    //
    // So the worked example and the JSON schema are the top two by a wide
    // margin, and the caller's actual description — the only part that is not
    // fixed text — is a rounding error. That is the ordering a rewrite should
    // follow; the assertions below pin the shape of it, not the exact figures.
    const costs = rexPromptCosts(
      buildAddEnvelope("Add dunning.", EXISTING_ITEMS, PROJECT_CONTEXT),
    );
    const byName = new Map(costs.map((c) => [c.name, c]));
    const dominant = [...costs].sort((a, b) => b.tokenEstimate - a.tokenEstimate);

    expect(dominant[0].name).toBe("example");
    expect(dominant[1].name).toBe("schema");

    const example = byName.get("example")!;
    const schema = byName.get("schema")!;
    expect(example.sharePercent + schema.sharePercent).toBeGreaterThan(40);

    // The instructions, not the input, are what this prompt pays for — which
    // is why shortening them is worth doing at all.
    expect(byName.get("input")!.sharePercent).toBeLessThan(2);
    expect(byName.get("role")!.tokenEstimate).toBeLessThan(example.tokenEstimate);
  });

  it("attributes a large input to the input section, not the instructions", () => {
    // The other half of the point: a prompt dominated by caller-supplied
    // context must not read as an expensive instruction set. Shortening
    // instructions here would save nothing.
    const costs = rexPromptCosts(
      buildDisambiguationEnvelope("x".repeat(20_000), new Set(["Billing"])),
    );
    const input = costs.find((c) => c.name === "input");

    expect(input).toBeDefined();
    expect(input!.sharePercent).toBeGreaterThan(80);
  });
});
