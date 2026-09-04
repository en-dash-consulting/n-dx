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

  // ── Seeded focus section ──────────────────────────────────────────────────
  //
  // The Explain action on a finding row is only worth having if the finding's
  // own zone and files survive into the bundle. An answer that could have been
  // written without them is the failure this feature exists to avoid, so these
  // assert the specific values rather than that a section exists.

  describe("seed", () => {
    beforeEach(async () => {
      await writeFile(join(svDir, "manifest.json"), JSON.stringify({ targetPath: "/repo/seeded" }));
    });

    it("carries the finding's zone, files, and labels through verbatim", () => {
      const { text, seeded } = assembleAskContext(ctx, {
        kind: "finding",
        id: "anti-pattern:web-viewer:God file",
        text: "God file: src/viewer/main.ts owns routing, loading, and layout.",
        zone: "web-viewer",
        files: ["src/viewer/main.ts", "src/viewer/route-state.ts"],
        labels: { type: "anti-pattern", severity: "critical" },
      });

      expect(seeded).toBe(true);
      expect(text).toContain("What the user is looking at");
      expect(text).toContain("Surface: finding");
      expect(text).toContain("Zone: `web-viewer`");
      expect(text).toContain("`src/viewer/main.ts`");
      expect(text).toContain("`src/viewer/route-state.ts`");
      expect(text).toContain("type: anti-pattern");
      expect(text).toContain("severity: critical");
    });

    it("omits the fields a finding did not set rather than inventing them", () => {
      // A finding with no severity and no related files is the shape the
      // acceptance criteria call out; blank labels must not reach the model as
      // "severity: " with nothing after it.
      const { text } = assembleAskContext(ctx, {
        kind: "finding",
        text: "Zones are evenly sized.",
        labels: { type: "pattern", severity: "" },
      });

      expect(text).toContain("Classified as: type: pattern");
      expect(text).not.toContain("severity");
      expect(text).not.toContain("Zone:");
      expect(text).not.toContain("Files involved");
    });

    it("reports no focus section for a seed with nothing in it", () => {
      const { text, seeded } = assembleAskContext(ctx, { labels: {}, files: [] });
      expect(seeded).toBe(false);
      expect(text).not.toContain("What the user is looking at");
    });

    it("caps the file list and says how many it dropped", () => {
      const files = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`);
      const { text } = assembleAskContext(ctx, { kind: "finding", files });

      expect(text).toContain("`src/f24.ts`");
      expect(text).not.toContain("`src/f25.ts`");
      expect(text).toContain("5 further files omitted");
    });
  });
});
