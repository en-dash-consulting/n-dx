/**
 * The startup-context pipe prefers the distilled primer over the full
 * CONTEXT.md — but only while the primer is current.
 *
 * This payload is re-sent on every task and every retry, so which file wins is
 * a per-run cost. Two failure directions matter and are asserted here:
 *
 * - The fallback: a primer is written best-effort, so its absence is an
 *   ordinary state (an LLM-free `--lite` analysis, a skipped distillation) and
 *   must not deprive a run of the context it could otherwise have had.
 * - The freshness check: `sourcevision analyze` leaves an old primer in place
 *   when it cannot distil a new one, so existence is not currency. Serving a
 *   primer stamped against an earlier analysis would describe the repo as it
 *   was — with the same confidence as a current description, to every task in
 *   the loop. Stale is worse than absent, so it is ignored, not trusted.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readContextMd,
  assembleNdxContext,
  sourcevisionAnalysisFingerprint,
} from "../../packages/core/pair-programming.js";

let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-primer-pref-"));
  await mkdir(join(dir, ".sourcevision"), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const CONTEXT = "# CONTEXT\n\nthe full breadth-first analysis document";
const PRIMER_BODY = "src/ holds code. Run pnpm test.";

const ANALYZED_AT = "2026-08-17T13:41:10.697Z";
const GIT_SHA = "abc123";

/** Independent restatement of the stamp format, so the test pins the contract. */
function fingerprintOf(analyzedAt, gitSha) {
  return createHash("sha256").update(`${analyzedAt} ${gitSha}`).digest("hex").slice(0, 16);
}

function stamp(fingerprint, body = PRIMER_BODY) {
  return `<!-- sourcevision-primer fingerprint: ${fingerprint} -->\n\n${body}\n`;
}

async function writeManifest(analyzedAt = ANALYZED_AT, gitSha = GIT_SHA) {
  await writeFile(
    join(dir, ".sourcevision", "manifest.json"),
    JSON.stringify({ analyzedAt, gitSha }),
    "utf-8",
  );
}

const writeContext = () => writeFile(join(dir, ".sourcevision", "CONTEXT.md"), CONTEXT);
const writePrimer = (content) => writeFile(join(dir, ".sourcevision", "PRIMER.md"), content);

describe("sourcevisionAnalysisFingerprint", () => {
  it("hashes the two manifest fields a re-analysis changes", async () => {
    await writeManifest();
    expect(sourcevisionAnalysisFingerprint(dir)).toBe(fingerprintOf(ANALYZED_AT, GIT_SHA));
  });

  it("changes when the analysis is re-run or the commit moves", async () => {
    await writeManifest();
    const before = sourcevisionAnalysisFingerprint(dir);

    await writeManifest("2026-08-28T09:00:00.000Z", GIT_SHA);
    expect(sourcevisionAnalysisFingerprint(dir)).not.toBe(before);

    await writeManifest(ANALYZED_AT, "def456");
    expect(sourcevisionAnalysisFingerprint(dir)).not.toBe(before);
  });

  it("returns a sentinel rather than throwing when there is no manifest", () => {
    expect(sourcevisionAnalysisFingerprint(dir)).toBe("unknown");
  });
});

describe("readContextMd — primer preference", () => {
  it("prefers a fresh primer when both exist", async () => {
    await writeManifest();
    await writeContext();
    await writePrimer(stamp(fingerprintOf(ANALYZED_AT, GIT_SHA)));

    const result = readContextMd(dir);
    expect(result.source).toBe("primer");
    expect(result.content).toContain("pnpm test");
    expect(result.content).not.toContain("breadth-first");
  });

  it("ignores a primer stamped against an earlier analysis", async () => {
    await writeManifest();
    await writeContext();
    await writePrimer(stamp(fingerprintOf("2026-01-01T00:00:00.000Z", "0ldsha")));

    const result = readContextMd(dir);
    expect(result.source).toBe("context");
    expect(result.content).toContain("breadth-first");
    expect(result.content).not.toContain("pnpm test");
  });

  it("ignores an unstamped primer — no marker means no way to date it", async () => {
    await writeManifest();
    await writeContext();
    await writePrimer(PRIMER_BODY);

    const result = readContextMd(dir);
    expect(result.source).toBe("context");
  });

  it("falls back to CONTEXT.md when no primer exists", async () => {
    await writeManifest();
    await writeContext();

    const result = readContextMd(dir);
    expect(result.source).toBe("context");
    expect(result.content).toContain("breadth-first");
    expect(result.warning).toBeUndefined();
  });

  it("treats an empty primer as absent rather than as empty context", async () => {
    await writeManifest();
    await writeContext();
    await writePrimer("   \n  ");

    const result = readContextMd(dir);
    expect(result.source).toBe("context");
    expect(result.content).toContain("breadth-first");
  });

  it("uses the primer even when CONTEXT.md is missing", async () => {
    await writeManifest();
    await writePrimer(stamp(fingerprintOf(ANALYZED_AT, GIT_SHA)));

    const result = readContextMd(dir);
    expect(result.source).toBe("primer");
    expect(result.warning).toBeUndefined();
  });

  it("serves a primer stamped 'unknown' when there is no manifest to date it against", async () => {
    // Both sides agree on the sentinel, so a manifest-less project is a match
    // rather than a permanent mismatch.
    await writePrimer(stamp("unknown"));

    const result = readContextMd(dir);
    expect(result.source).toBe("primer");
  });

  it("warns only when neither file is available", () => {
    const result = readContextMd(dir);
    expect(result.content).toBeNull();
    expect(result.warning).toMatch(/CONTEXT\.md not found/);
  });
});

describe("assembleNdxContext — which document reaches the agent", () => {
  // No .rex/ in these fixtures, so the PRD excerpt is always a warning; the
  // assertions are about which codebase document the payload carries.
  it("carries the primer when it is fresh", async () => {
    await writeManifest();
    await writeContext();
    await writePrimer(stamp(fingerprintOf(ANALYZED_AT, GIT_SHA)));

    const { text } = assembleNdxContext(dir);
    expect(text).toContain("pnpm test");
    expect(text).not.toContain("breadth-first");
  });

  it("carries CONTEXT.md when the primer is stale", async () => {
    await writeManifest();
    await writeContext();
    await writePrimer(stamp(fingerprintOf("2026-01-01T00:00:00.000Z", "0ldsha")));

    const { text } = assembleNdxContext(dir);
    expect(text).toContain("breadth-first");
    expect(text).not.toContain("pnpm test");
  });

  it("carries CONTEXT.md when the primer is absent", async () => {
    await writeManifest();
    await writeContext();

    const { text } = assembleNdxContext(dir);
    expect(text).toContain("breadth-first");
  });

  it("reports the missing document rather than failing when neither exists", () => {
    const { text, warnings } = assembleNdxContext(dir);
    expect(text).toBeNull();
    expect(warnings.some((w) => /CONTEXT\.md not found/.test(w))).toBe(true);
  });
});
