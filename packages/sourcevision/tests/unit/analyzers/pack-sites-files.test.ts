import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DynamicCodeFact } from "@n-dx/lang-kit";
import type { PackFrameworkFacts } from "../../../src/analyzers/pack-framework-facts.js";
import { MAX_SITE_CANDIDATES, packSitesData, writeSitesData } from "../../../src/analyzers/pack-sites-files.js";
import { DATA_FILES } from "../../../src/schema/data-files.js";
import { SCHEMA_VERSION, type Inventory } from "../../../src/schema/index.js";
import { validateModule } from "../../../src/schema/validate.js";

type File = { language?: string; thirdParty?: string; mirrorOf?: string };

function inventory(files: Record<string, File>): Inventory {
  return {
    files: Object.entries(files).map(([path, f]) => ({
      path,
      language: f.language ?? "PHP",
      size: 1,
      lineCount: 1,
      hash: "h",
      role: "source",
      category: "",
      ...(f.thirdParty === undefined ? {} : { thirdParty: f.thirdParty }),
      ...(f.mirrorOf === undefined ? {} : { mirrorOf: f.mirrorOf }),
    })),
  } as unknown as Inventory;
}

const at = (line: number, column = 0) => ({ line, column });

const EVAL: DynamicCodeFact = { kind: "exec", construct: "eval", expression: "eval($code)", notice: "php-dynamic-exec", scope: "render", position: at(4, 2) };
const DB_DISPATCH: DynamicCodeFact = {
  kind: "dispatch",
  construct: "call_user_func",
  expression: "call_user_func($row['handler'])",
  notice: "php-db-dispatch",
  database: { tables: ["routes", "pages"], columns: ["routes.handler", "pages.handler"], sources: [{ path: "a.php", position: at(2) }] },
  position: at(3),
};
const include = (construct: string, notice: string, line: number, candidates?: DynamicCodeFact["candidates"]): DynamicCodeFact => ({
  kind: "include",
  construct,
  expression: "'config/' . $x . '.php'",
  notice,
  position: at(line),
  ...(candidates === undefined ? {} : { candidates }),
});

describe("packSitesData", () => {
  it("lists each site by file and position with its notice code, sorted", () => {
    const facts: PackFrameworkFacts = [
      { path: "b.php", dynamicCode: [EVAL, DB_DISPATCH] },
      { path: "a.php", dynamicCode: [include("host-include", "php-host-include", 2, { files: ["config/b.php", "config/a.php"], total: 2 })] },
      { path: "c.php", dynamicCode: [] },
    ];
    const data = packSitesData(facts, inventory({ "a.php": {}, "b.php": {}, "c.php": {} }))!;
    expect(data).toEqual({
      languages: {
        php: {
          files: [
            {
              path: "a.php",
              sites: [{ code: "php-host-include", kind: "include", construct: "host-include", line: 2, column: 0, candidates: { files: ["config/a.php", "config/b.php"], total: 2 } }],
            },
            {
              path: "b.php",
              sites: [
                {
                  code: "php-db-dispatch",
                  kind: "dispatch",
                  construct: "call_user_func",
                  line: 3,
                  column: 0,
                  database: { tables: ["pages", "routes"], columns: ["pages.handler", "routes.handler"] },
                },
                { code: "php-dynamic-exec", kind: "exec", construct: "eval", line: 4, column: 2, scope: "render" },
              ],
            },
          ],
        },
      },
    });
    expect(validateModule("sites", { schemaVersion: SCHEMA_VERSION, ...data }).ok).toBe(true);
  });

  it("never copies the expression, a query's source or row data", () => {
    const data = packSitesData([{ path: "b.php", dynamicCode: [EVAL, DB_DISPATCH] }], inventory({ "b.php": {} }));
    const text = JSON.stringify(data);
    expect(text).not.toContain("$row");
    expect(text).not.toContain("$code");
    expect(text).not.toContain("sources");
  });

  it(`caps candidates at ${MAX_SITE_CANDIDATES}, marks the list truncated and keeps the total`, () => {
    const files = Array.from({ length: 70 }, (_, i) => `gen/p${String(i).padStart(2, "0")}.php`);
    const capped = packSitesData([{ path: "a.php", dynamicCode: [include("dynamic-include", "php-dynamic-include", 1, { files, total: 120 })] }], inventory({ "a.php": {} }));
    const listed = capped!.languages.php!.files[0]!.sites[0]!.candidates!;
    expect(listed).toEqual({ files: files.slice(0, MAX_SITE_CANDIDATES), total: 120, truncated: true });
    // A pack that capped its own list at 50 reports the total past it.
    const packCapped = packSitesData(
      [{ path: "a.php", dynamicCode: [include("dynamic-include", "php-dynamic-include", 1, { files: files.slice(0, 50), total: 60 })] }],
      inventory({ "a.php": {} }),
    );
    expect(packCapped!.languages.php!.files[0]!.sites[0]!.candidates).toEqual({ files: files.slice(0, 50), total: 60, truncated: true });
  });

  it("falls back to the site's kind for a pack that names no notice", () => {
    const { notice: _, ...bare } = EVAL;
    const data = packSitesData([{ path: "a.php", dynamicCode: [bare] }], inventory({ "a.php": {} }));
    expect(data!.languages.php!.files[0]!.sites[0]!.code).toBe("exec");
  });

  it("splits third-party files apart, leaves mirror copies and uninventoried files out", () => {
    const facts: PackFrameworkFacts = [
      { path: "app.php", dynamicCode: [EVAL] },
      { path: "vendor/lib.php", dynamicCode: [EVAL] },
      { path: "copy/app.php", dynamicCode: [EVAL] },
      { path: "gone.php", dynamicCode: [EVAL] },
    ];
    const data = packSitesData(facts, inventory({ "app.php": {}, "vendor/lib.php": { thirdParty: "composer" }, "copy/app.php": { mirrorOf: "app.php" } }))!;
    expect(data.languages.php!.files.map((f) => f.path)).toEqual(["app.php"]);
    expect(data.languages.php!.thirdParty?.map((f) => f.path)).toEqual(["vendor/lib.php"]);
  });

  it("is undefined when no file has a site", () => {
    expect(packSitesData(undefined, inventory({}))).toBeUndefined();
    expect(packSitesData([{ path: "a.php", dynamicCode: [] }], inventory({ "a.php": {} }))).toBeUndefined();
  });
});

describe("writeSitesData", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes canonically with schemaVersion, the same bytes twice, and removes a stale file when there is nothing", () => {
    dir = mkdtempSync(join(tmpdir(), "sv-sites-"));
    const path = join(dir, DATA_FILES.sites);
    const data = packSitesData([{ path: "b.php", dynamicCode: [DB_DISPATCH, EVAL] }], inventory({ "b.php": {} }));
    writeSitesData(dir, data);
    const first = readFileSync(path, "utf-8");
    expect(JSON.parse(first).schemaVersion).toBe(SCHEMA_VERSION);
    writeSitesData(dir, packSitesData([{ path: "b.php", dynamicCode: [EVAL, DB_DISPATCH] }], inventory({ "b.php": {} })));
    expect(readFileSync(path, "utf-8")).toBe(first);

    writeFileSync(path, "{}");
    writeSitesData(dir, undefined);
    expect(existsSync(path)).toBe(false);
  });
});
