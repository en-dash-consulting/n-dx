import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeclarationsFact } from "@n-dx/lang-kit";
import { packDeclarationsData, writeDeclarationsData } from "../../../src/analyzers/pack-declarations-files.js";
import type { PackFrameworkFacts } from "../../../src/analyzers/pack-framework-facts.js";
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

const BILLING: DeclarationsFact = {
  namespaces: ["Acme\\Billing"],
  types: [
    { name: "Invoice", qualifiedName: "Acme\\Billing\\Invoice", kind: "class", position: { line: 9, column: 6 } },
    { name: "Payable", qualifiedName: "Acme\\Billing\\Payable", kind: "interface", position: { line: 4, column: 10 } },
  ],
};
const GLOBAL: DeclarationsFact = {
  namespaces: [],
  types: [{ name: "Json_Encoder", qualifiedName: "Json_Encoder", kind: "class", position: { line: 3, column: 10 } }],
};

describe("packDeclarationsData", () => {
  it("lists each file's namespaces and types by line, files by path, keyed by pack id", () => {
    const facts: PackFrameworkFacts = [
      { path: "src/b.php", declarations: BILLING },
      { path: "src/a.php", declarations: GLOBAL },
      { path: "src/c.php" },
    ];
    const data = packDeclarationsData(facts, inventory({ "src/a.php": {}, "src/b.php": {}, "src/c.php": {} }))!;
    expect(data).toEqual({
      languages: {
        php: {
          files: [
            { path: "src/a.php", namespaces: [], types: [{ kind: "class", name: "Json_Encoder", qualifiedName: "Json_Encoder", line: 3 }] },
            {
              path: "src/b.php",
              namespaces: ["Acme\\Billing"],
              types: [
                { kind: "interface", name: "Payable", qualifiedName: "Acme\\Billing\\Payable", line: 4 },
                { kind: "class", name: "Invoice", qualifiedName: "Acme\\Billing\\Invoice", line: 9 },
              ],
            },
          ],
        },
      },
    });
    expect(validateModule("declarations", { schemaVersion: SCHEMA_VERSION, ...data }).ok).toBe(true);
  });

  it("puts third-party files apart, leaves mirror copies and files outside the inventory out", () => {
    const facts: PackFrameworkFacts = [
      { path: "vendor/lib/X.php", declarations: GLOBAL },
      { path: "copy/a.php", declarations: GLOBAL },
      { path: "gone.php", declarations: GLOBAL },
    ];
    const data = packDeclarationsData(
      facts,
      inventory({ "vendor/lib/X.php": { thirdParty: "vendor" }, "copy/a.php": { mirrorOf: "a.php" } }),
    )!;
    expect(data.languages.php!.files).toEqual([]);
    expect(data.languages.php!.thirdParty!.map((f) => f.path)).toEqual(["vendor/lib/X.php"]);
  });

  it("is undefined when no file declares anything", () => {
    expect(packDeclarationsData(undefined, inventory({}))).toBeUndefined();
    expect(packDeclarationsData([{ path: "a.php", declarations: { namespaces: [], types: [] } }], inventory({ "a.php": {} }))).toBeUndefined();
  });
});

describe("writeDeclarationsData", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes canonical JSON with schemaVersion, the same bytes twice, and removes a stale file without data", () => {
    dir = mkdtempSync(join(tmpdir(), "sv-declarations-"));
    const path = join(dir, DATA_FILES.declarations);
    const data = packDeclarationsData([{ path: "a.php", declarations: BILLING }], inventory({ "a.php": {} }));
    writeDeclarationsData(dir, data);
    const first = readFileSync(path, "utf-8");
    expect(JSON.parse(first).schemaVersion).toBe(SCHEMA_VERSION);
    writeDeclarationsData(dir, data);
    expect(readFileSync(path, "utf-8")).toBe(first);

    writeFileSync(path, "{}");
    writeDeclarationsData(dir, undefined);
    expect(existsSync(path)).toBe(false);
  });
});
