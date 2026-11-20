/**
 * What dynamic code (`src/php-dynamic-code.ts`) costs in memory. Its query
 * captures most expressions, so every file's captures held at once ran out
 * of heap on tens of MB of PHP; each file's are now digested as it is parsed
 * and released (`FrameworkPack.digest`), and a file with more than
 * `MAX_DYNAMIC_CAPTURES` is skipped with a notice. Skips when the grammar is
 * not built.
 *
 * The heap bound is measured in a child Node with a capped heap, running the
 * built pack (`dist/`, which the test gate rebuilds when its source changed):
 * 10 MB of generated classes needed about 1.1 GB of heap before the digest,
 * and fit in about 450 MB after it.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPackEntry, skipUnlessGrammar, type FrameworkPack } from "@n-dx/lang-runtime";
import {
  MAX_DYNAMIC_CAPTURES,
  PHP_DYNAMIC_EXEC,
  PHP_DYNAMIC_SKIPPED,
  PHP_PACKAGE,
  PHP_SYMBOL_RULES,
  pack,
  phpDynamicCode,
  phpGrammarPath,
  phpPack,
  type DynamicCodeDigest,
} from "../../src/index.js";

const PACKAGE_ROOT = join(import.meta.dirname, "..", "..");
const PROBE = join(import.meta.dirname, "..", "helpers", "memory-probe.mjs");

/** Generated PHP analyzed for dynamic code in the child, and the heap it is given. */
const PROBE_MEGABYTES = 10;
const HEAP_BOUND_MB = 640;

describe("php dynamic code memory", () => {
  it(`reads ${PROBE_MEGABYTES} MB of generated PHP for dynamic code within a ${HEAP_BOUND_MB} MB heap`, (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const dist = join(PACKAGE_ROOT, "dist", "index.js");
    expect(existsSync(dist), `build @n-dx/lang-php first: ${dist} is missing`).toBe(true);
    const run = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_BOUND_MB}`, PROBE, dist, String(PROBE_MEGABYTES), "dynamicCode"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(run.stderr).not.toContain("heap out of memory");
    expect(run.status, run.stderr).toBe(0);
    const read = JSON.parse(run.stdout) as { files: number; degraded: unknown; sites: number; databaseSites: number; notices: string[] };
    expect(read.degraded).toBeNull();
    // One call_user_func on a fetched row per generated method: every one is read, and fed by the query.
    expect(read.sites).toBeGreaterThan(1000 * read.files);
    expect(read.databaseSites).toBe(read.sites);
    expect(read.notices.some((n) => n.includes(PHP_DYNAMIC_SKIPPED))).toBe(false);
  }, 300_000);

  describe("in process", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "php-dynamic-memory-"));
      writeFileSync(join(dir, "run.php"), "<?php\neval($code);\n");
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("skips the dynamic code of a file over the capture cap with a notice, and still reads the others", async (ctx) => {
      skipUnlessGrammar(ctx, phpGrammarPath());
      // Generated data under the runner's 1 MiB limit: one array element per two bytes.
      const elements = MAX_DYNAMIC_CAPTURES + 10_000;
      writeFileSync(join(dir, "table.php"), `<?php\n$t = [${"1,".repeat(elements)}];\neval($t[0]);\n`);
      const result = await pack.analyzeProject({ projectDir: dir, files: ["run.php", "table.php"], kinds: ["dynamicCode"] });
      expect(result.degraded).toBeUndefined();
      expect(result.unparsed).toEqual([]);
      const by = new Map(result.facts.map((f) => [f.path, f.dynamicCode]));
      expect(by.get("run.php")?.map((s) => s.construct)).toEqual(["eval"]);
      expect(by.get("table.php")).toBeUndefined();
      const skipped = result.notices?.filter((n) => n.includes(`[${PHP_DYNAMIC_SKIPPED}]`)) ?? [];
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toMatch(/^PHP: \[php-dynamic-skipped\] 1 file has more than 500000 syntax nodes to read for dynamic code, so its dynamic code was not read: table\.php \(\d+\)\.$/);
      expect(result.notices?.some((n) => n.includes(`[${PHP_DYNAMIC_EXEC}] 1 site runs`))).toBe(true);
    }, 120_000);

    /** The PHP pack entry with its dynamic-code framework replaced. */
    const entryWith = (dynamic: FrameworkPack<DynamicCodeDigest>) =>
      createPackEntry({
        package: PHP_PACKAGE,
        pack: { ...phpPack, frameworks: phpPack.frameworks!.map((f) => (f === phpDynamicCode ? dynamic : f)) },
        symbolRules: PHP_SYMBOL_RULES,
      });

    it("reads digests: files reach the framework without its own captures, the language's kept", async (ctx) => {
      skipUnlessGrammar(ctx, phpGrammarPath());
      const seen: { captures: string[]; digests: string[] }[] = [];
      const spy: FrameworkPack<DynamicCodeDigest> = {
        ...phpDynamicCode,
        read: (files, kinds, context, digests) => {
          seen.push({ captures: files.flatMap((f) => Object.keys(f.captures)), digests: [...(digests?.keys() ?? [])] });
          return phpDynamicCode.read(files, kinds, context, digests);
        },
      };
      const result = await entryWith(spy).analyzeProject({ projectDir: dir, files: ["run.php"], kinds: ["dynamicCode"] });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.captures).not.toContain("dynamic");
      expect(seen[0]!.captures).toContain("imports");
      expect(seen[0]!.digests).toEqual(["run.php"]);
      expect(result.facts.find((f) => f.path === "run.php")?.dynamicCode?.map((s) => s.construct)).toEqual(["eval"]);
    });

    it("fails only the dynamic-code framework when a digest throws, naming the file", async (ctx) => {
      skipUnlessGrammar(ctx, phpGrammarPath());
      const throwing: FrameworkPack<DynamicCodeDigest> = {
        ...phpDynamicCode,
        digest: () => {
          throw new Error("boom");
        },
      };
      const result = await entryWith(throwing).analyzeProject({ projectDir: dir, files: ["run.php"], kinds: ["imports", "dynamicCode"] });
      expect(result.degraded).toBeUndefined();
      expect(result.facts.find((f) => f.path === "run.php")?.dynamicCode).toBeUndefined();
      expect(result.facts.find((f) => f.path === "run.php")?.imports).toBeDefined();
      expect(result.notices).toContain("framework php-dynamic failed (run.php: boom); its dynamicCode were not recorded.");
    });
  });
});
