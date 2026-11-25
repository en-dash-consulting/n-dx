/**
 * Pack config reads and flag checks as config.json: per-file rows, the flag
 * and key indexes, checks on loaded-code facts, schema validity, and no
 * file without facts.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ConfigReadFact, FlagCheckFact } from "@n-dx/lang-kit";
import { packConfigData, writeConfigData } from "../../../src/analyzers/pack-config-facts.js";
import type { PackFrameworkFacts } from "../../../src/analyzers/pack-framework-facts.js";
import { DATA_FILES } from "../../../src/schema/data-files.js";
import { SCHEMA_VERSION, type ConfigData, type Inventory } from "../../../src/schema/v1.js";
import { ConfigSchema, validateModule } from "../../../src/schema/validate.js";

const inventory = (...paths: string[]): Inventory =>
  ({ files: paths.map((path) => ({ path, size: 1, language: "PHP", lineCount: 1, hash: "x", role: "source", category: "code" })) }) as unknown as Inventory;

const at = (line: number, column = 0) => ({ line, column });
const read = (key: string, line: number, extra: Partial<ConfigReadFact> = {}): ConfigReadFact => ({ key, source: "file", position: at(line), ...extra });
const check = (name: string, line: number, extra: Partial<FlagCheckFact> = {}): FlagCheckFact => ({
  name,
  normalized: name.toLowerCase(),
  mechanism: "constant",
  position: at(line),
  ...extra,
});

describe("packConfigData", () => {
  it("is undefined without facts, with empty facts, or with facts only for files the inventory does not list", () => {
    expect(packConfigData(undefined, inventory("a.php"))).toBeUndefined();
    expect(packConfigData([], inventory("a.php"))).toBeUndefined();
    expect(packConfigData([{ path: "a.php", routes: [] }, { path: "b.php", configReads: [], flagChecks: [] }], inventory("a.php", "b.php"))).toBeUndefined();
    expect(packConfigData([{ path: "vendor/x.php", configReads: [read("db.host", 1)] }], inventory("a.php"))).toBeUndefined();
  });

  it("lists each file's reads and checks by position, with flag and key indexes", () => {
    const facts: PackFrameworkFacts = [
      {
        path: "lib/db.php",
        configReads: [read("db.host", 4, { sourceFile: "config.php" }), read("DB_PASS", 2, { source: "env" })],
      },
      {
        path: "cart.php",
        flagChecks: [
          check("features.new_checkout", 9, { normalized: "new_checkout", mechanism: "config", gated: { start: 10, end: 14 } }),
          check("FEATURE_NEW_CHECKOUT", 3, { normalized: "new_checkout", gated: { start: 4, end: 6 } }),
        ],
        configReads: [read("db.host", 1, { sourceFile: "config.php" })],
      },
      {
        path: "admin.php",
        flagChecks: [check("ff-new-checkout", 5, { normalized: "new_checkout", mechanism: "sdk", client: "LaunchDarkly" })],
      },
    ];
    const data = packConfigData(facts, inventory("lib/db.php", "cart.php", "admin.php"));
    expect(data).toEqual<ConfigData>({
      files: [
        {
          file: "admin.php",
          configReads: [],
          flagChecks: [{ name: "ff-new-checkout", normalized: "new_checkout", mechanism: "sdk", client: "LaunchDarkly", line: 5, column: 0 }],
        },
        {
          file: "cart.php",
          configReads: [{ key: "db.host", source: "file", sourceFile: "config.php", line: 1, column: 0 }],
          flagChecks: [
            { name: "FEATURE_NEW_CHECKOUT", normalized: "new_checkout", mechanism: "constant", line: 3, column: 0, gated: { start: 4, end: 6 } },
            { name: "features.new_checkout", normalized: "new_checkout", mechanism: "config", line: 9, column: 0, gated: { start: 10, end: 14 } },
          ],
        },
        {
          file: "lib/db.php",
          configReads: [
            { key: "DB_PASS", source: "env", line: 2, column: 0 },
            { key: "db.host", source: "file", sourceFile: "config.php", line: 4, column: 0 },
          ],
          flagChecks: [],
        },
      ],
      flags: [
        {
          normalized: "new_checkout",
          names: ["FEATURE_NEW_CHECKOUT", "features.new_checkout", "ff-new-checkout"],
          mechanisms: ["config", "constant", "sdk"],
          files: ["admin.php", "cart.php"],
          checks: 3,
          gatedLines: 8,
        },
      ],
      keys: [
        { key: "DB_PASS", sources: ["env"], sourceFiles: [], files: ["lib/db.php"] },
        { key: "db.host", sources: ["file"], sourceFiles: ["config.php"], files: ["cart.php", "lib/db.php"] },
      ],
    });
    expect(ConfigSchema.safeParse(data).success).toBe(true);
    expect(validateModule("config", data).ok).toBe(true);
  });

  it("counts a line gated by nested or repeated checks of one flag once per file", () => {
    const data = packConfigData(
      [{ path: "a.php", flagChecks: [check("X", 1, { gated: { start: 2, end: 20 } }), check("X", 5, { gated: { start: 6, end: 8 } }), check("X", 30, { gated: { start: 15, end: 25 } })] }],
      inventory("a.php"),
    );
    expect(data?.flags[0]).toMatchObject({ checks: 3, gatedLines: 24 });
  });

  it("drops facts a schema would reject, computes a missing normalized name, leaves off an inverted gate and keeps exact repeats once", () => {
    const facts = [
      {
        path: "a.php",
        configReads: [
          read("", 1),
          { key: "k", source: "toml", position: at(1) },
          read("k", 0),
          read("k", 2, { sourceFile: "" }),
          read("k", 2, { sourceFile: "" }),
        ],
        flagChecks: [
          check("", 1),
          { ...check("X", 1), mechanism: "cookie" },
          { name: "FF_Beta", mechanism: "env", position: at(3) },
          check("Y", 4, { gated: { start: 9, end: 5 }, client: "" }),
        ],
      },
    ] as unknown as PackFrameworkFacts;
    const data = packConfigData(facts, inventory("a.php"));
    expect(data?.files).toEqual([
      {
        file: "a.php",
        configReads: [{ key: "k", source: "file", line: 2, column: 0 }],
        flagChecks: [
          { name: "FF_Beta", normalized: "beta", mechanism: "env", line: 3, column: 0 },
          { name: "Y", normalized: "y", mechanism: "constant", line: 4, column: 0 },
        ],
      },
    ]);
    expect(validateModule("config", data).ok).toBe(true);
  });
});

describe("ConfigSchema", () => {
  const valid: ConfigData = {
    files: [{ file: "a.php", configReads: [{ key: "k", source: "ini", line: 1, column: 0 }], flagChecks: [] }],
    flags: [],
    keys: [{ key: "k", sources: ["ini"], sourceFiles: [], files: ["a.php"] }],
  };

  it("accepts a valid file and rejects bad sources, mechanisms, positions and gates", () => {
    expect(ConfigSchema.safeParse(valid).success).toBe(true);
    const bad = (patch: (d: ConfigData) => void): boolean => {
      const copy = structuredClone(valid);
      patch(copy);
      return ConfigSchema.safeParse(copy).success;
    };
    expect(bad((d) => { (d.files[0].configReads[0] as { source: string }).source = "toml"; })).toBe(false);
    expect(bad((d) => { d.files[0].configReads[0].line = 0; })).toBe(false);
    expect(bad((d) => { d.files[0].flagChecks.push({ name: "x", normalized: "x", mechanism: "cookie" as "env", line: 1, column: 0 }); })).toBe(false);
    expect(bad((d) => { d.files[0].flagChecks.push({ name: "x", normalized: "x", mechanism: "env", line: 1, column: 0, gated: { start: 5, end: 4 } }); })).toBe(false);
    expect(bad((d) => { d.keys[0].files = []; })).toBe(false);
  });
});

describe("writeConfigData", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes canonical JSON when there is data, and nothing when there is none", () => {
    dir = mkdtempSync(join(tmpdir(), "sv-config-json-"));
    writeConfigData(dir, undefined);
    expect(existsSync(join(dir, DATA_FILES.config))).toBe(false);

    const data = packConfigData([{ path: "a.php", flagChecks: [check("X", 1)] }], inventory("a.php"));
    writeConfigData(dir, data);
    const written = JSON.parse(readFileSync(join(dir, DATA_FILES.config), "utf-8"));
    expect(validateModule("config", written).ok).toBe(true);
    expect(written.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("removes a config.json an earlier run left when this one has no data", () => {
    dir = mkdtempSync(join(tmpdir(), "sv-config-json-"));
    writeFileSync(join(dir, DATA_FILES.config), "{}");
    writeConfigData(dir, undefined);
    expect(existsSync(join(dir, DATA_FILES.config))).toBe(false);
  });
});
