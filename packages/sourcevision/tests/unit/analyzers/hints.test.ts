import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadHints } from "../../../src/cli/commands/analyze-phases.js";
import { buildMetaPrompt } from "../../../src/analyzers/enrich-config.js";
import type { Zone, Finding, ZoneCrossing } from "../../../src/schema/index.js";

// ── loadHints ─────────────────────────────────────────────────────────────────

describe("loadHints", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-hints-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when hints.md does not exist", () => {
    expect(loadHints(tmpDir)).toBeUndefined();
  });

  it("returns undefined when hints.md is empty", () => {
    writeFileSync(join(tmpDir, "hints.md"), "");
    expect(loadHints(tmpDir)).toBeUndefined();
  });

  it("returns undefined when hints.md contains only comments", () => {
    writeFileSync(
      join(tmpDir, "hints.md"),
      `<!-- Sourcevision Hints -->
<!-- This is a comment -->
<!-- Another comment -->
`,
    );
    expect(loadHints(tmpDir)).toBeUndefined();
  });

  it("returns content with comments stripped", () => {
    writeFileSync(
      join(tmpDir, "hints.md"),
      `<!-- Sourcevision Hints -->
This is a Next.js project.
<!-- comment in the middle -->
Zones should map to domains.
`,
    );
    const result = loadHints(tmpDir);
    expect(result).toBe("This is a Next.js project.\nZones should map to domains.");
  });

  it("strips multi-line HTML comments", () => {
    writeFileSync(
      join(tmpDir, "hints.md"),
      `<!--
Multi-line
comment
-->
Actual content here.
`,
    );
    const result = loadHints(tmpDir);
    expect(result).toBe("Actual content here.");
  });

  it("returns trimmed content", () => {
    writeFileSync(join(tmpDir, "hints.md"), "  \n  Content with whitespace  \n  ");
    const result = loadHints(tmpDir);
    expect(result).toBe("Content with whitespace");
  });
});

// ── Hints injection into prompts ──────────────────────────────────────────────

describe("hints in buildMetaPrompt", () => {
  const sampleZones: Zone[] = [
    {
      id: "core",
      name: "Core",
      description: "Core module",
      files: ["src/core/a.ts"],
      entryPoints: ["src/core/a.ts"],
      cohesion: 0.8,
      coupling: 0.2,
    },
  ];
  const sampleFindings: Finding[] = [
    { type: "observation", pass: 1, scope: "core", text: "A finding", severity: "info" },
  ];
  const sampleCrossings: ZoneCrossing[] = [];

  it("includes hints when provided", () => {
    const prompt = buildMetaPrompt(sampleZones, sampleFindings, sampleCrossings, "This is a monorepo with domain-driven design.");
    expect(prompt).toContain("Project context from the developer:");
    expect(prompt).toContain("This is a monorepo with domain-driven design.");
  });

  it("omits hints section when hints is undefined", () => {
    const prompt = buildMetaPrompt(sampleZones, sampleFindings, sampleCrossings);
    expect(prompt).not.toContain("Project context from the developer:");
  });

  it("omits hints section when hints is empty string", () => {
    const prompt = buildMetaPrompt(sampleZones, sampleFindings, sampleCrossings, "");
    expect(prompt).not.toContain("Project context from the developer:");
  });
});
