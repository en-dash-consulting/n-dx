/**
 * Ask context assembly — bounds, degradation, and the "nothing to ground on"
 * signal.
 *
 * These are the properties the endpoint depends on but cannot observe: a
 * bundle that grows with the repository would fail on the vendor's side as an
 * opaque 400, and a half-written artifact from an interrupted analyze run must
 * cost one section rather than the whole answer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../../src/server/types.js";
import { assembleAskContext } from "../../../src/server/sourcevision-ask-context.js";

function fileEntry(index: number, lineCount: number) {
  return {
    path: `src/mod-${index}.ts`,
    size: lineCount * 20,
    language: "typescript",
    lineCount,
    hash: `h${index}`,
    role: "source",
    category: "core",
  };
}

function zone(index: number, fileCount: number) {
  return {
    id: `zone-${index}`,
    name: `Zone ${index}`,
    description: `Zone ${index} description.`,
    files: Array.from({ length: fileCount }, (_, f) => `src/z${index}-${f}.ts`),
    entryPoints: [],
    cohesion: 0.5,
    coupling: 0.5,
  };
}

describe("assembleAskContext", () => {
  let tmpDir: string;
  let svDir: string;
  let ctx: ServerContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ask-ctx-"));
    svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    ctx = { projectDir: tmpDir, svDir, rexDir: join(tmpDir, ".rex"), dev: false };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports no context when nothing has been analyzed", () => {
    const context = assembleAskContext(ctx);
    expect(context.available).toBe(false);
    expect(context.sources).toEqual([]);
    expect(context.text).toBe("");
  });

  it("caps the file list and says how much it left out", async () => {
    const files = Array.from({ length: 60 }, (_, i) => fileEntry(i, 1_000 - i));
    await writeFile(
      join(svDir, "inventory.json"),
      JSON.stringify({ files, summary: { totalFiles: 60, totalLines: 1, byLanguage: {}, byRole: {}, byCategory: {} } }),
    );

    const { text } = assembleAskContext(ctx);
    expect(text).toContain("top 30 of 60");
    // Largest first, so the cap keeps the files a question is most likely about.
    expect(text).toContain("src/mod-0.ts");
    expect(text).not.toContain("src/mod-59.ts");
  });

  it("caps the zone list and marks the remainder as omitted", async () => {
    // Descending file counts so the ranking is unambiguous.
    const zones = Array.from({ length: 40 }, (_, i) => zone(i, 40 - i));
    await writeFile(join(svDir, "zones.json"), JSON.stringify({ zones, crossings: [], unzoned: [] }));

    const { text } = assembleAskContext(ctx);
    expect(text).toContain("Zone 0");
    expect(text).toContain("15 further zones omitted");
    expect(text).not.toContain("`zone-39`");
  });

  it("keeps critical findings when the finding list is capped", async () => {
    const findings = [
      ...Array.from({ length: 35 }, (_, i) => ({
        type: "observation",
        pass: 1,
        scope: "global",
        text: `Noise finding ${i}.`,
        severity: "info",
      })),
      {
        type: "anti-pattern",
        pass: 2,
        scope: "global",
        text: "Critical: the last one in the file.",
        severity: "critical",
      },
    ];
    await writeFile(
      join(svDir, "zones.json"),
      JSON.stringify({ zones: [zone(0, 1)], crossings: [], unzoned: [], findings }),
    );

    const { text } = assembleAskContext(ctx);
    expect(text).toContain("Critical: the last one in the file.");
    expect(text).toContain("6 further findings omitted");
  });

  it("degrades one section rather than failing when an artifact is malformed", async () => {
    await writeFile(join(svDir, "manifest.json"), JSON.stringify({ targetPath: "/repo/ok", modules: {} }));
    await writeFile(join(svDir, "zones.json"), "{ this is not json");

    const context = assembleAskContext(ctx);
    expect(context.available).toBe(true);
    expect(context.sources).toEqual(["manifest.json"]);
    expect(context.text).toContain("/repo/ok");
    expect(context.text).not.toContain("Architectural zones");
  });

  it("truncates a long CONTEXT.md and says that it did", async () => {
    await writeFile(join(svDir, "CONTEXT.md"), "A".repeat(7_000));

    const { text } = assembleAskContext(ctx);
    expect(text).toContain("excerpt truncated");
    expect(text.length).toBeLessThan(7_000);
  });
});
