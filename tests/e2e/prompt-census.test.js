/**
 * Prompt census registry enforcement.
 *
 * `scripts/prompt-census.mjs` measures every LLM prompt surface in the repo
 * against a declared registry. A registry is only as good as its staleness
 * checks: rename a builder and the census silently stops counting it, and the
 * baseline quietly improves for no reason. These tests make that fail loudly.
 *
 * They also pin the three properties the baseline's credibility rests on:
 *
 * 1. Both construction styles are measured — single template literals (rex,
 *    sourcevision) and `lines.push(...)` fragment assembly (hench).
 * 2. Counts come from llm-client's estimator, not a second one invented here.
 * 3. Re-running after a change reports a before/after delta, not just a total.
 *
 * If a registry test fails, run `node scripts/prompt-census.mjs --check` for
 * the specific entry.
 *
 * @see docs/analysis/prompt-token-baseline.md — the recorded baseline
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import {
  SURFACES,
  NO_PROMPT_PACKAGES,
  INTERACTIVE_PROMPT_PATTERNS,
  OUT_OF_SCOPE,
  REPRESENTATIVE,
  extractStaticPromptText,
} from "../../scripts/prompt-census.mjs";

const ROOT = join(import.meta.dirname, "../..");
const CENSUS = join(ROOT, "scripts/prompt-census.mjs");
const BASELINE_MD = join(ROOT, "docs/analysis/prompt-token-baseline.md");
const BASELINE_JSON = join(ROOT, "docs/analysis/prompt-token-baseline.json");

const require = createRequire(join(ROOT, "packages/web/package.json"));
const ts = require("typescript");

/** Run the census and return parsed JSON. */
function census(args = []) {
  const out = execFileSync(process.execPath, [CENSUS, "--json", ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function extract(surface) {
  const abs = join(ROOT, surface.file);
  return extractStaticPromptText(ts, readFileSync(abs, "utf-8"), abs, surface.builder);
}

describe("prompt census: registry staleness", () => {
  it("every declared surface resolves to a real builder", () => {
    const missing = [];

    for (const s of SURFACES) {
      const abs = join(ROOT, s.file);
      if (!existsSync(abs)) {
        missing.push(`${s.file} — file not found`);
        continue;
      }
      if (!extract(s)) {
        missing.push(`${s.file} — builder \`${s.builder}\` not found`);
      }
    }

    if (missing.length > 0) {
      expect.fail(
        [
          "SURFACES in scripts/prompt-census.mjs names builders that no longer exist.",
          "A renamed builder drops out of the census silently, and the baseline",
          "improves for no reason. Update the entry or remove it:",
          "",
          ...missing.map((m) => `  - ${m}`),
        ].join("\n"),
      );
    }
  });

  it("every out-of-scope classification still points at real code", () => {
    const stale = [];

    for (const o of OUT_OF_SCOPE) {
      const abs = join(ROOT, o.file);
      if (!existsSync(abs)) {
        stale.push(`${o.file} — file not found`);
        continue;
      }
      if (!readFileSync(abs, "utf-8").includes(o.builder)) {
        stale.push(`${o.file} — \`${o.builder}\` no longer appears in the file`);
      }
    }

    if (stale.length > 0) {
      expect.fail(
        [
          "OUT_OF_SCOPE lists classifications for code that has moved or gone.",
          "Drop the entry — a stale exclusion hides a surface that came back:",
          "",
          ...stale.map((s) => `  - ${s}`),
        ].join("\n"),
      );
    }
  });

  it("no surface is also classified out of scope", () => {
    const overlap = SURFACES.filter((s) =>
      OUT_OF_SCOPE.some((o) => o.file === s.file && o.builder === s.builder),
    );
    expect(overlap.map((s) => `${s.file}::${s.builder}`)).toEqual([]);
  });

  it("every surface carries a purpose", () => {
    const bare = SURFACES.filter((s) => !s.purpose || s.purpose.length < 15);
    expect(bare.map((s) => s.builder)).toEqual([]);
  });
});

describe("prompt census: scope boundaries", () => {
  it("records that web has no LLM prompt surfaces", () => {
    expect(Object.keys(NO_PROMPT_PACKAGES)).toContain("web");
    expect(NO_PROMPT_PACKAGES.web.length).toBeGreaterThan(30);
    expect(SURFACES.filter((s) => s.pkg === "web")).toEqual([]);
  });

  it("web really does compose no prompt text", () => {
    // The claim above is only worth recording if it is checked. web reaches
    // models exclusively through rex/sourcevision behind a gateway, so no
    // file under src/ should be calling a completion entry point directly.
    const offenders = execFileSync(
      "git",
      ["ls-files", "packages/web/src"],
      { cwd: ROOT, encoding: "utf-8" },
    )
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => {
        const src = readFileSync(join(ROOT, f), "utf-8");
        return /\b(spawnClaude|callClaude)\s*\(/.test(src);
      });

    if (offenders.length > 0) {
      expect.fail(
        [
          "packages/web is recorded in NO_PROMPT_PACKAGES as having no LLM prompt",
          "surfaces, but these files call a completion entry point directly:",
          "",
          ...offenders.map((f) => `  - ${f}`),
          "",
          "Either route the call through a gateway or add the surface to SURFACES.",
        ].join("\n"),
      );
    }
  });

  it("interactive readline prompts are named as out of scope", () => {
    expect(INTERACTIVE_PROMPT_PATTERNS.length).toBeGreaterThan(0);

    // The patterns must actually match the functions they claim to cover.
    const knownInteractive = [
      "promptUser",
      "promptLine",
      "promptYesNo",
      "confirmPrompt",
      "defaultPrompt",
      "promptRollbackConfirm",
      "promptForTestCommand",
    ];

    for (const name of knownInteractive) {
      const matched = INTERACTIVE_PROMPT_PATTERNS.some((re) => re.test(name));
      expect(matched, `no pattern classifies \`${name}\` as interactive`).toBe(true);
    }
  });

  it("no registered surface matches an interactive prompt pattern", () => {
    // Guards against the reverse mistake: pulling a readline prompt into the
    // census. rex's `buildPrompt` feeds promptLine and must stay excluded.
    const misfiled = SURFACES.filter((s) =>
      INTERACTIVE_PROMPT_PATTERNS.some((re) => re.test(s.builder)),
    );
    expect(misfiled.map((s) => s.builder)).toEqual([]);
  });
});

describe("prompt census: measurement", () => {
  it("counts fragment-assembled prompts as well as template literals", () => {
    // hench pushes short fragments; rex writes one large template literal.
    // A literal-scanning census undercounts the first, which is the whole
    // reason this tool extracts per builder rather than per file.
    const pushStyle = SURFACES.find((s) => s.builder === "buildSystemPrompt");
    const templateStyle = SURFACES.find((s) => s.builder === "buildAssessmentPrompt");

    const pushed = extract(pushStyle);
    const templated = extract(templateStyle);

    // buildSystemPrompt is ~65 separate `lines.push("...")` calls.
    expect(pushed.literals).toBeGreaterThan(30);
    expect(pushed.ownText.length).toBeGreaterThan(2000);

    // buildAssessmentPrompt is a single template literal of comparable size.
    expect(templated.literals).toBe(1);
    expect(templated.ownText.length).toBeGreaterThan(1000);
  });

  it("resolves prompt text held in module-level constants", () => {
    // reasonForReshape's body holds ~15 tokens of scaffolding; its prompt is
    // four `const PROMPT = \`…\`` declarations. Counting only the body was a
    // 25x undercount before constant resolution landed.
    const surface = SURFACES.find((s) => s.builder === "reasonForReshape");
    const extracted = extract(surface);

    expect([...extracted.constants.keys()]).toEqual(
      expect.arrayContaining(["RESHAPE_SYSTEM_PROMPT", "RESHAPE_FEW_SHOT"]),
    );
    expect(extracted.ownText.length).toBeLessThan(200);
    expect([...extracted.constants.values()].join("").length).toBeGreaterThan(4000);
  });

  it("resolves prompt constants imported from a sibling module", () => {
    // rex keeps PRD_SCHEMA in analyze-shared.ts and interpolates it into
    // builders in reason.ts. Same-file resolution alone misses it.
    const extracted = extract(SURFACES.find((s) => s.builder === "buildAddPrompt"));
    expect([...extracted.constants.keys()]).toContain("PRD_SCHEMA");
  });

  it("uses the llm-client estimator rather than a second one", async () => {
    const { budgetPreflight } = await import(
      "../../packages/llm-client/dist/budget-preflight.js"
    );
    const report = census();

    for (const s of report.surfaces.filter((x) => !x.error)) {
      expect(
        s.fixedTokens,
        `${s.builder} token count does not match budgetPreflight()`,
      ).toBe(budgetPreflight(report.model, s.fixedChars).tokenEstimate);
    }
  });

  it("separates fixed prompt text from per-run context", () => {
    const report = census();
    const rex = report.assembled.rex;

    expect(rex.error).toBeUndefined();
    // The fixture supplies real proposal JSON, so context must be non-zero and
    // the two parts must reconstruct the assembled total.
    expect(rex.contextTokens).toBeGreaterThan(0);
    expect(rex.fixedTokens + rex.contextTokens).toBe(rex.tokens);
  });

  it("reports every package's assembled prompt from a fixed input", () => {
    const report = census();
    for (const pkg of Object.keys(REPRESENTATIVE)) {
      expect(report.assembled[pkg]?.error, `${pkg} dump failed`).toBeUndefined();
      expect(report.assembled[pkg].tokens).toBeGreaterThan(0);
    }
  });

  it("--dump prints the assembled prompt for a package", () => {
    const out = execFileSync(process.execPath, [CENSUS, "--dump", "core"], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    // Body goes to stdout so it can be redirected or diffed on its own.
    expect(out).toContain("You are a code reviewer");
    expect(out).toContain("packages/rex/src/analyze/reason.ts");
  });

  it("--dump is deterministic for the same fixture", () => {
    const run = () =>
      execFileSync(process.execPath, [CENSUS, "--dump", "sourcevision"], {
        cwd: ROOT,
        encoding: "utf-8",
      });
    expect(run()).toBe(run());
  });
});

describe("prompt census: baseline", () => {
  it("the checked-in baseline exists and is well formed", () => {
    expect(existsSync(BASELINE_MD), "docs/analysis/prompt-token-baseline.md").toBe(true);
    expect(existsSync(BASELINE_JSON), "docs/analysis/prompt-token-baseline.json").toBe(true);

    const baseline = JSON.parse(readFileSync(BASELINE_JSON, "utf-8"));
    expect(baseline.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(baseline.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(baseline.totals.perCallTokens).toBeGreaterThan(0);
    expect(baseline.totals.uniqueTokens).toBeGreaterThan(0);
    expect(baseline.surfaces.length).toBe(baseline.totals.surfaces);

    // The unique total deduplicates shared constants, so it can never exceed
    // the per-call total. If it does, the dedup accounting is wrong.
    expect(baseline.totals.uniqueTokens).toBeLessThanOrEqual(baseline.totals.perCallTokens);
  });

  it("the markdown inventory records purpose, scope and reproduction", () => {
    const md = readFileSync(BASELINE_MD, "utf-8");

    for (const pkg of ["rex", "sourcevision", "hench", "core"]) {
      expect(md, `inventory is missing the ${pkg} section`).toContain(`## ${pkg} —`);
    }
    expect(md).toContain("no LLM prompt surfaces");
    expect(md).toContain("interactive readline prompts");
    expect(md).toContain("node scripts/prompt-census.mjs");

    // Every surface must be findable in the document by builder name.
    for (const s of SURFACES) {
      expect(md, `inventory omits \`${s.builder}\``).toContain(`\`${s.builder}\``);
    }
  });

  it("--compare reports a before/after delta, not just the current total", () => {
    // Compare against a doctored copy so a delta is guaranteed, then assert the
    // output names the moved surface and the direction of the change. The copy
    // lives in a temp dir — a crash mid-test must not leave the real baseline
    // rewritten.
    const dir = mkdtempSync(join(tmpdir(), "prompt-census-"));
    try {
      const baseline = JSON.parse(readFileSync(BASELINE_JSON, "utf-8"));
      baseline.surfaces.find((s) => s.builder === "buildReviewerPrompt").fixedTokens += 500;
      baseline.totals.perCallTokens += 500;
      baseline.totals.uniqueTokens += 500;

      const doctored = join(dir, "baseline.json");
      writeFileSync(doctored, JSON.stringify(baseline, null, 2));

      const out = execFileSync(
        process.execPath,
        [CENSUS, "--compare", "--baseline", doctored],
        { cwd: ROOT, encoding: "utf-8" },
      );

      expect(out).toContain("buildReviewerPrompt");
      expect(out).toContain("-500");
      expect(out).toContain("TOTAL per-call");
      expect(out).toContain("TOTAL unique fixed text");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--compare flags a surface that was added or removed since the baseline", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompt-census-"));
    try {
      const baseline = JSON.parse(readFileSync(BASELINE_JSON, "utf-8"));
      // Drop one surface so HEAD looks like it gained one, and invent one so
      // HEAD looks like it lost one. A rewrite that deletes a prompt entirely
      // must show up as REMOVED rather than vanishing from the report.
      const dropped = baseline.surfaces.pop();
      baseline.surfaces.push({
        ...dropped,
        builder: "buildLongGonePrompt",
        file: "packages/rex/src/analyze/reason.ts",
      });
      const doctored = join(dir, "baseline.json");
      writeFileSync(doctored, JSON.stringify(baseline, null, 2));

      const out = execFileSync(
        process.execPath,
        [CENSUS, "--compare", "--baseline", doctored],
        { cwd: ROOT, encoding: "utf-8" },
      );

      expect(out).toContain("NEW");
      expect(out).toContain("buildLongGonePrompt");
      expect(out).toContain("REMOVED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--check exits non-zero when a registered builder disappears", () => {
    // Proves the staleness guard is load-bearing rather than vacuous.
    const src = readFileSync(CENSUS, "utf-8");
    const broken = join(ROOT, "scripts", ".prompt-census-staleness-probe.mjs");
    writeFileSync(
      broken,
      src.replace('builder: "buildReviewerPrompt"', 'builder: "buildReviewerPromptXX"'),
    );

    try {
      let exitCode = 0;
      try {
        execFileSync(process.execPath, [broken, "--check"], {
          cwd: ROOT,
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch (err) {
        exitCode = err.status;
      }
      expect(exitCode).toBe(1);
    } finally {
      rmSync(broken, { force: true });
    }
  });
});
