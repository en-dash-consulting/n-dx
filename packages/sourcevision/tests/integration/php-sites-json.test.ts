/**
 * sites.json through the analyze command, over a small PHP project written
 * here: one dynamic include, one host include, one dynamic exec, one
 * database-fed dispatch, and an include matching more candidate files than
 * the cap. Each site is listed with its notice code and position; the
 * include candidates stop at the cap with the total; the database-fed site
 * names its table and column and no value. Two runs write the same bytes. A
 * repository without sites gets no sites.json, and a stale one is removed.
 *
 * The PHP cases skip when the PHP pack cannot run (grammar not built).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { MAX_SITE_CANDIDATES } from "../../src/analyzers/pack-sites-files.js";
import { cmdAnalyze } from "../../src/cli/commands/analyze.js";
import { DATA_FILES } from "../../src/schema/data-files.js";
import { SCHEMA_VERSION, type CodeSite, type SitesData } from "../../src/schema/index.js";
import { validateModule } from "../../src/schema/validate.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const INDEX = [
  "<?php",
  "include $page . '.php';",
  "require 'config/' . $_SERVER['HTTP_HOST'] . '.php';",
  "eval($code);",
  "$row = mysql_fetch_assoc(mysql_query(\"SELECT handler FROM hooks WHERE name = 'boot-secret'\"));",
  "call_user_func($row['handler']);",
  "include __DIR__ . '/gen/page' . $n . '.php';",
  "",
].join("\n");

const PAGES = Array.from({ length: 60 }, (_, i) => `gen/page${String(i).padStart(2, "0")}.php`);

describe("sites.json over a PHP project", { timeout: 180_000 }, () => {
  let skipped: string | undefined;
  let dir: string;
  let first: string;
  const sitesPath = () => join(dir, ".sourcevision", DATA_FILES.sites);

  beforeAll(async () => {
    await skipUnlessPackRuns({ skip: (note) => (skipped = note ?? "PHP pack cannot run") }, "php");
    if (skipped) return;
    dir = mkdtempSync(join(tmpdir(), "sv-sites-json-"));
    writeFileSync(join(dir, "composer.json"), JSON.stringify({ name: "acme/sites" }));
    writeFileSync(join(dir, "index.php"), INDEX);
    mkdirSync(join(dir, "config"));
    writeFileSync(join(dir, "config/a.example.com.php"), "<?php\n");
    mkdirSync(join(dir, "gen"));
    for (const page of PAGES) writeFileSync(join(dir, page), "<?php\n");
    await cmdAnalyze(dir, ["--fast"]);
    first = readFileSync(sitesPath(), "utf-8");
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const sites = (): CodeSite[] => {
    const data = JSON.parse(first) as SitesData;
    return data.languages.php!.files.find((f) => f.path === "index.php")!.sites;
  };

  it("is valid, carries schemaVersion and lists every site at its source line", (ctx) => {
    if (skipped) ctx.skip(skipped);
    const data = JSON.parse(first) as SitesData;
    expect(validateModule("sites", data).ok).toBe(true);
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(sites().map((s) => [s.code, s.construct, s.line])).toEqual([
      ["php-dynamic-include", "dynamic-include", 2],
      ["php-host-include", "host-include", 3],
      ["php-dynamic-exec", "eval", 4],
      ["php-db-dispatch", "call_user_func", 6],
      ["php-dynamic-include", "dynamic-include", 7],
    ]);
  });

  it("gives includes their candidates, the cap marked truncated with the total", (ctx) => {
    if (skipped) ctx.skip(skipped);
    const [, host, , , many] = sites();
    expect(host!.candidates).toEqual({ files: ["config/a.example.com.php"], total: 1 });
    expect(many!.candidates).toEqual({ files: PAGES.slice(0, MAX_SITE_CANDIDATES), total: PAGES.length, truncated: true });
  });

  it("names the database-fed dispatch's table and column, and no value", (ctx) => {
    if (skipped) ctx.skip(skipped);
    expect(sites()[3]!.database).toEqual({ tables: ["hooks"], columns: ["hooks.handler"] });
    expect(first).not.toContain("boot-secret");
    expect(first).not.toContain("SELECT");
    expect(first).not.toContain("$row");
  });

  it("is written byte for byte the same by a second run", async (ctx) => {
    if (skipped) ctx.skip(skipped);
    await cmdAnalyze(dir, ["--fast"]);
    expect(readFileSync(sitesPath(), "utf-8")).toBe(first);
  });
});

describe("sites.json without dynamic-code sites", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("is not written, and a stale one is removed", async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-sites-json-none-"));
    writeFileSync(join(dir, "package.json"), "{}");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/app.ts"), "export const x = 1;\n");
    const svDir = join(dir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, DATA_FILES.sites), "{}");

    await cmdAnalyze(dir, ["--fast"]);

    expect(existsSync(join(svDir, DATA_FILES.sdlcProfile))).toBe(true);
    expect(existsSync(join(svDir, DATA_FILES.sites))).toBe(false);
  }, 60_000);
});
