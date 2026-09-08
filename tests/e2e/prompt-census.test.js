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
 * 1. Every construction style is measured — `lines.push(...)` fragment assembly
 *    (hench), template literals (core), and section envelopes (rex,
 *    sourcevision). Each looks different to an AST scanner, and a census that
 *    handled only one of them would undercount the others to near zero.
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
    // hench pushes many short fragments; core writes a handful of large
    // template literals. A literal-scanning census undercounts the first,
    // which is the whole reason this tool extracts per builder rather than
    // per file. Both must land in the same order of magnitude of text.
    const pushed = extract(SURFACES.find((s) => s.builder === "buildSystemPrompt"));
    const templated = extract(SURFACES.find((s) => s.builder === "buildReviewerPrompt"));

    // buildSystemPrompt is ~65 separate `lines.push("...")` calls.
    expect(pushed.literals).toBeGreaterThan(30);
    expect(pushed.ownText.length).toBeGreaterThan(2000);

    // buildReviewerPrompt is a few large template literals of comparable bulk.
    expect(templated.literals).toBeLessThan(15);
    expect(templated.ownText.length).toBeGreaterThan(1000);
  });

  it("counts section-envelope prompts, whose literals are per-section", () => {
    // Since the envelope migration, rex and sourcevision build prompts as a
    // list of named sections rather than one template literal. That turns one
    // large literal into many medium ones — a shape neither of the styles
    // above has — so it needs its own guard. Before helper-following landed,
    // factoring shared text into a `placementContent()` helper dropped it from
    // the count entirely and silently shrank the baseline.
    const assessment = extract(SURFACES.find((s) => s.builder === "buildAssessmentEnvelope"));

    expect(assessment.literals).toBeGreaterThan(10);
    expect(assessment.ownText.length).toBeGreaterThan(1000);

    // buildAddEnvelope reaches most of its text through helpers and constants,
    // so own text alone would be a large undercount.
    const add = extract(SURFACES.find((s) => s.builder === "buildAddEnvelope"));
    expect([...add.constants.keys()]).toEqual(
      expect.arrayContaining(["placementContent", "TASK_QUALITY_RULES"]),
    );
    expect([...add.constants.values()].join("").length).toBeGreaterThan(add.ownText.length);
  });

  it("resolves prompt text held in module-level constants", () => {
    // buildReshapeEnvelope's body holds ~15 tokens of scaffolding; its prompt
    // is a few `const PROMPT = \`…\`` declarations plus a mode-switching
    // helper. Counting only the body was a 25x undercount before constant
    // resolution landed, and helper-following keeps it that way now that the
    // three-way role switch lives in reshapeRoleContent().
    const extracted = extract(SURFACES.find((s) => s.builder === "buildReshapeEnvelope"));

    expect([...extracted.constants.keys()]).toEqual(
      expect.arrayContaining(["reshapeRoleContent", "RESHAPE_FEW_SHOT"]),
    );
    expect(extracted.ownText.length).toBeLessThan(200);
    expect([...extracted.constants.values()].join("").length).toBeGreaterThan(4000);
  });

  it("resolves prompt constants imported from a sibling module", () => {
    // rex keeps PRD_SCHEMA in analyze-shared.ts and interpolates it into
    // builders in reason.ts. Same-file resolution alone misses it.
    const extracted = extract(SURFACES.find((s) => s.builder === "buildAddEnvelope"));
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

  it("splits every dump fixture, so a renamed surface cannot drop one", () => {
    // The split is computed by matching `REPRESENTATIVE[pkg].surface` against a
    // registered builder name. A miss is not an error — the split is simply
    // omitted — so the envelope rename took rex's and sourcevision's splits away
    // and nothing said so. Asserting the field exists for every package is what
    // makes that failure audible.
    const report = census();

    for (const pkg of Object.keys(REPRESENTATIVE)) {
      const a = report.assembled[pkg];
      expect(a.error, `${pkg} dump failed`).toBeUndefined();
      expect(
        a.fixedTokens,
        `${pkg}: REPRESENTATIVE.surface \`${a.surface}\` does not resolve to a ` +
          "registered builder, so its fixed/context split was silently dropped",
      ).toBeGreaterThan(0);

      // Either the assembled path carried context, or the builder is
      // branch-conditional and the unreached text is reported instead.
      const accounted = a.contextTokens !== undefined || a.unreachedTokens !== undefined;
      expect(accounted, `${pkg}: neither context nor unreached text reported`).toBe(true);
    }
  });

  it("reports a per-section split for every envelope-built package", () => {
    // The whole point of moving rex and sourcevision onto PromptEnvelope: a
    // rewrite needs to know which *section* carries a prompt's cost, not just
    // which builder. Without this the migration is a refactor with nothing to
    // show for it, so the artifact is pinned rather than left to drift.
    const report = census();

    for (const pkg of ["rex", "sourcevision", "hench"]) {
      const a = report.assembled[pkg];
      expect(a.sections, `${pkg} reports no section split`).toBeDefined();
      expect(a.sections.length).toBeGreaterThan(1);

      for (const s of a.sections) {
        expect(s.name, `${pkg} has an unnamed section`).toBeTruthy();
        expect(s.tokens).toBeGreaterThan(0);
      }

      // Sections must account for the assembled prompt, or the split is a
      // partial view masquerading as a full one. Separators between sections
      // mean the parts sum to slightly under the whole.
      const summed = a.sections.reduce((n, s) => n + s.chars, 0);
      expect(summed).toBeGreaterThan(a.chars * 0.9);
      expect(summed).toBeLessThanOrEqual(a.chars);
    }
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

  // ── Provenance ────────────────────────────────────────────────────────────
  //
  // The recorded baseline once named commit 3dda8b5b while containing
  // JSON_OBJECT_ONLY, a constant that first exists in 0b57e2eb — a descendant.
  // `--write` had run against a dirty tree and stamped `.git/HEAD` regardless,
  // so the published artifact attributed its numbers to code that did not
  // contain them, and `--compare` reported "(no surface changed)" across a
  // range that demonstrably had.
  //
  // Note what would NOT have caught it: the token counts were correct. Only
  // the attribution was wrong. So these tests check the stamp, and the
  // staleness test below checks measured content — two different failures.

  it("refuses to record a baseline from a dirty tree", () => {
    // Made dirty with an untracked file so the assertion holds whatever state
    // the developer's tree happens to be in when the suite runs.
    const marker = join(ROOT, ".prompt-census-dirty-probe.tmp");
    const before = readFileSync(BASELINE_JSON, "utf-8");
    writeFileSync(marker, "dirty\n");

    try {
      let exitCode = 0;
      let stderr = "";
      try {
        execFileSync(process.execPath, [CENSUS, "--write"], {
          cwd: ROOT,
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch (err) {
        exitCode = err.status;
        stderr = err.stderr ?? "";
      }

      expect(exitCode, "--write should refuse a dirty tree").toBe(1);
      expect(stderr).toMatch(/dirty|uncommitted/i);
      expect(
        readFileSync(BASELINE_JSON, "utf-8"),
        "refusal must happen before anything is written",
      ).toBe(before);
    } finally {
      rmSync(marker, { force: true });
    }
  });

  it("marks the stamp when --allow-dirty overrides the refusal", () => {
    // The override must not be able to produce a stamp indistinguishable from
    // a clean recording — that is the whole defect. Writes to a temp output so
    // the real baseline is never touched.
    const dir = mkdtempSync(join(tmpdir(), "prompt-census-"));
    const marker = join(ROOT, ".prompt-census-dirty-probe2.tmp");
    const before = readFileSync(BASELINE_JSON, "utf-8");
    writeFileSync(marker, "dirty\n");

    try {
      const out = join(dir, "baseline.json");
      execFileSync(
        process.execPath,
        [CENSUS, "--write", "--allow-dirty", "--out", out],
        { cwd: ROOT, encoding: "utf-8", stdio: "pipe" },
      );

      const recorded = JSON.parse(readFileSync(out, "utf-8"));
      expect(recorded.dirty, "a dirty recording must say so").toBe(true);
      expect(
        recorded.commit,
        "a dirty recording must not present a bare commit sha as its provenance",
      ).toMatch(/-dirty$/);
      expect(
        readFileSync(BASELINE_JSON, "utf-8"),
        "--out must redirect the write, not additionally rewrite the real baseline",
      ).toBe(before);
    } finally {
      rmSync(marker, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the checked-in baseline still describes what the repo measures now", () => {
    // Staleness, checked on measured content rather than on the commit sha.
    // A "stamp must equal HEAD" assertion cannot work: recording the baseline
    // dirties the baseline files, so committing them puts HEAD one ahead of
    // the stamp and the check would fail after every legitimate re-record.
    // The content hash only moves when the measurements actually move.
    const recorded = JSON.parse(readFileSync(BASELINE_JSON, "utf-8"));
    const fresh = census();

    expect(
      recorded.contentHash,
      "baseline predates content hashing — re-record it with " +
        "`node scripts/prompt-census.mjs --write`",
    ).toBeTruthy();

    expect(
      fresh.contentHash,
      [
        "The checked-in prompt-token baseline no longer describes this repo.",
        "A prompt surface or skill body changed without the baseline being",
        "re-recorded, so docs/analysis/prompt-token-baseline.md is stating",
        "figures that are no longer true.",
        "",
        "Fix: node scripts/prompt-census.mjs --write",
        "",
        `  baseline per-call: ${recorded.totals?.perCallTokens}`,
        `  current  per-call: ${fresh.totals?.perCallTokens}`,
        `  baseline skills:   ${recorded.totals?.skillTokens}`,
        `  current  skills:   ${fresh.totals?.skillTokens}`,
      ].join("\n"),
    ).toBe(recorded.contentHash);
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
