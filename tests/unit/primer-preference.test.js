/**
 * The startup-context pipe prefers the distilled primer over the full
 * CONTEXT.md.
 *
 * This payload is re-sent on every task and every retry, so which file wins
 * is a per-run cost. The fallback matters as much as the preference: a primer
 * is written best-effort, so its absence is an ordinary state (an LLM-free
 * `--lite` analysis, a skipped distillation) and must not deprive a run of the
 * context it could otherwise have had.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readContextMd } from "../../packages/core/pair-programming.js";

let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-primer-pref-"));
  await mkdir(join(dir, ".sourcevision"), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const CONTEXT = "# CONTEXT\n\nthe full breadth-first analysis document";
const PRIMER = "<!-- sourcevision-primer fingerprint: abc123 -->\n\nsrc/ holds code. Run pnpm test.";

describe("readContextMd — primer preference", () => {
  it("prefers the primer when both exist", async () => {
    await writeFile(join(dir, ".sourcevision", "CONTEXT.md"), CONTEXT);
    await writeFile(join(dir, ".sourcevision", "PRIMER.md"), PRIMER);

    const result = readContextMd(dir);
    expect(result.source).toBe("primer");
    expect(result.content).toContain("pnpm test");
    expect(result.content).not.toContain("breadth-first");
  });

  it("falls back to CONTEXT.md when no primer exists", async () => {
    await writeFile(join(dir, ".sourcevision", "CONTEXT.md"), CONTEXT);

    const result = readContextMd(dir);
    expect(result.source).toBe("context");
    expect(result.content).toContain("breadth-first");
    expect(result.warning).toBeUndefined();
  });

  it("treats an empty primer as absent rather than as empty context", async () => {
    await writeFile(join(dir, ".sourcevision", "CONTEXT.md"), CONTEXT);
    await writeFile(join(dir, ".sourcevision", "PRIMER.md"), "   \n  ");

    const result = readContextMd(dir);
    expect(result.source).toBe("context");
    expect(result.content).toContain("breadth-first");
  });

  it("uses the primer even when CONTEXT.md is missing", async () => {
    await writeFile(join(dir, ".sourcevision", "PRIMER.md"), PRIMER);

    const result = readContextMd(dir);
    expect(result.source).toBe("primer");
    expect(result.warning).toBeUndefined();
  });

  it("warns only when neither file is available", async () => {
    const result = readContextMd(dir);
    expect(result.content).toBeNull();
    expect(result.warning).toMatch(/CONTEXT\.md not found/);
  });
});
