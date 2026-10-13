/**
 * Each language pack's published tarball carries its grammar and queries, and
 * sourcevision loads it from the per-user pack directory.
 *
 * For every pack sourcevision knows, packs the pack with `pnpm pack`, checks
 * the file list, extracts it to `<pack dir>/node_modules/<name>` — the layout
 * `npm install --prefix <pack dir>` produces — and, in a plain Node process,
 * runs sourcevision's built `loadPack` against that pack directory and the
 * loaded entry over a one-file project. A `files` entry that drops the grammar
 * or a query fails here instead of degrading every install of the pack. A
 * second copy without its grammar must name the published-install remedy,
 * not a build script.
 *
 * Needs built dists (sourcevision and the packs) and built grammars. The
 * release job sets SV_REQUIRE_GRAMMARS=1, so a missing grammar fails this
 * test there.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { skipUnlessGrammar } from "@n-dx/lang-runtime";
import { KNOWN_PACKS } from "../../src/language/pack-loader.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES = dirname(PACKAGE_ROOT);

/** Grammar and a one-file project per pack. */
const SAMPLES: Record<string, { grammar: string; files: Record<string, string> }> = {
  java: { grammar: "tree-sitter-java", files: { "src/A.java": "package a;\n\nclass A {}\n" } },
  go: { grammar: "tree-sitter-go", files: { "go.mod": "module example.com/a\n", "a.go": "package a\n" } },
};

interface Report {
  status: string;
  source?: string;
  facts?: number;
  degraded?: { reason: string; remedy?: string };
  notice?: { reason: string; remedy?: string };
}

describe("packed language packs, loaded from a pack directory", () => {
  let work: string;

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sv-packed-"));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  /** Fail first, and plainly, when a dist the test runs is missing. */
  function requireDists(packDirName: string): void {
    if (!existsSync(join(PACKAGE_ROOT, "dist", "language", "pack-loader.js"))) {
      throw new Error("sourcevision's dist is not built — run `pnpm --filter @n-dx/sourcevision build`");
    }
    if (!existsSync(join(PACKAGES, packDirName, "dist", "pack.js"))) {
      throw new Error(`${packDirName}'s dist is not built — run \`pnpm --filter @n-dx/${packDirName} build\``);
    }
  }

  /** `pnpm pack` the pack, extract it into a fresh pack directory, and return the packed file list. */
  function packInto(packDirName: string, packDir: string): Set<string> {
    const source = join(PACKAGES, packDirName);
    // pnpm, not npm: npm runs `prepare` on pack and would rebuild dist mid-suite.
    const out = execFileSync("pnpm", ["pack", "--json", "--pack-destination", work], {
      cwd: source,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: true,
    });
    const report = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { filename: string; files: { path: string }[] };
    const extract = mkdtempSync(join(work, "extract-"));
    execFileSync("tar", ["-xzf", report.filename, "-C", extract], { cwd: work });
    const installed = join(packDir, "node_modules", "@n-dx", packDirName);
    mkdirSync(dirname(installed), { recursive: true });
    cpSync(join(extract, "package"), installed, { recursive: true });
    // Dependencies come from the workspace; the pack's own files come only from the tarball.
    symlinkSync(join(source, "node_modules"), join(installed, "node_modules"), "junction");
    return new Set(report.files.map((f) => f.path));
  }

  /** Load the pack with sourcevision's built loader from `packDir` and run it over its sample, in plain Node. */
  function loadAndRun(id: string, packDir: string): Report {
    const projectDir = mkdtempSync(join(work, `project-${id}-`));
    const files = SAMPLES[id]!.files;
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(projectDir, path)), { recursive: true });
      writeFileSync(join(projectDir, path), text);
    }
    const sources = Object.keys(files).filter((f) => !f.endsWith(".mod"));
    const script = `
      const { KNOWN_PACKS, loadPack } = await import(${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, "dist", "language", "pack-loader.js")).href)});
      const load = await loadPack(KNOWN_PACKS.find((p) => p.id === ${JSON.stringify(id)}), { packDir: ${JSON.stringify(packDir)} });
      if (load.status !== "loaded") {
        console.log(JSON.stringify(load));
      } else {
        const result = await load.entry.analyzeProject({ projectDir: ${JSON.stringify(projectDir)}, files: ${JSON.stringify(sources)} });
        console.log(JSON.stringify({ status: load.status, source: load.source, facts: result.facts.length, degraded: result.degraded }));
      }
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: work, encoding: "utf-8" });
    return JSON.parse(out) as Report;
  }

  for (const known of KNOWN_PACKS) {
    const packDirName = known.packageName.split("/")[1]!;
    const sample = SAMPLES[known.id];

    describe(known.packageName, () => {
      let packDir = "";
      let packed = new Set<string>();

      function prepare(ctx: Parameters<typeof skipUnlessGrammar>[0]): void {
        skipUnlessGrammar(ctx, join(PACKAGES, packDirName, "build", "grammars", `${sample!.grammar}.wasm`));
        if (packDir) return;
        requireDists(packDirName);
        packDir = mkdtempSync(join(work, `packs-${known.id}-`));
        packed = packInto(packDirName, packDir);
      }

      it("has a sample project here", () => {
        expect(sample, `add ${known.id} to SAMPLES`).toBeDefined();
      });

      it("packs its grammar WASM and query files, and no build scratch", (ctx) => {
        prepare(ctx);
        expect(packed).toContain(`build/grammars/${sample!.grammar}.wasm`);
        const queries = readdirSync(join(PACKAGES, packDirName, "queries", known.id)).map((q) => `queries/${known.id}/${q}`);
        expect(queries.length).toBeGreaterThan(0);
        for (const q of queries) expect(packed, q).toContain(q);
        expect([...packed].filter((f) => f.startsWith("build/") && !f.startsWith("build/grammars/"))).toEqual([]);
      });

      it("loads from the pack directory and reads the sample without degrading", (ctx) => {
        prepare(ctx);
        expect(loadAndRun(known.id, packDir)).toEqual({ status: "loaded", source: "pack-dir", facts: 1 });
      });

      it("names the published-install remedy, not a build script, when the installed pack lacks its grammar", (ctx) => {
        prepare(ctx);
        const stripped = mkdtempSync(join(work, `packs-${known.id}-stripped-`));
        packInto(packDirName, stripped);
        rmSync(join(stripped, "node_modules", "@n-dx", packDirName, "build"), { recursive: true, force: true });
        const report = loadAndRun(known.id, stripped);
        expect(report.status).toBe("loaded");
        expect(report.degraded?.remedy).toBe(
          `Published ${known.packageName} ships this grammar, so this install is incomplete: reinstall ${known.packageName}.`,
        );
      });
    });
  }
});
