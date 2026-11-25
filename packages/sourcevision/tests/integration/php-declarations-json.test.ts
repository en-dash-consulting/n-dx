/**
 * declarations.json through the analyze command, over a small PHP project
 * written here: a namespaced file declaring two classes, an interface and a
 * trait; a global file with a class declared in an `if` beside an anonymous
 * class; a file of functions alone. Each type is listed fully qualified at
 * its line; the anonymous class is not; the global file reports no
 * namespace; the functions-only file is not listed. Two runs write the same
 * bytes. A repository without PHP gets no declarations.json, and a stale one
 * is removed.
 *
 * The PHP cases skip when the PHP pack cannot run (grammar not built).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cmdAnalyze } from "../../src/cli/commands/analyze.js";
import { DATA_FILES } from "../../src/schema/data-files.js";
import { SCHEMA_VERSION, type DeclarationsData } from "../../src/schema/index.js";
import { validateModule } from "../../src/schema/validate.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const BILLING = [
  "<?php",
  "namespace Acme\\Billing;",
  "",
  "interface Payable {}",
  "trait Discounts {}",
  "class Invoice implements Payable { use Discounts; }",
  "",
  "final class CreditNote extends Invoice {}",
  "",
].join("\n");

const COMPAT = [
  "<?php",
  "if (!class_exists('Json_Encoder')) {",
  "    class Json_Encoder {}",
  "}",
  "$logger = new class { public function log($m) {} };",
  "",
].join("\n");

const HELPERS = "<?php\nfunction format_price($cents) { return $cents / 100; }\n";

describe("declarations.json over a PHP project", { timeout: 180_000 }, () => {
  let skipped: string | undefined;
  let dir: string;
  let first: string;
  const declarationsPath = () => join(dir, ".sourcevision", DATA_FILES.declarations);

  beforeAll(async () => {
    await skipUnlessPackRuns({ skip: (note) => (skipped = note ?? "PHP pack cannot run") }, "php");
    if (skipped) return;
    dir = mkdtempSync(join(tmpdir(), "sv-declarations-json-"));
    writeFileSync(join(dir, "composer.json"), JSON.stringify({ name: "acme/billing" }));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/Billing.php"), BILLING);
    writeFileSync(join(dir, "src/compat.php"), COMPAT);
    writeFileSync(join(dir, "src/helpers.php"), HELPERS);
    await cmdAnalyze(dir, ["--fast"]);
    first = readFileSync(declarationsPath(), "utf-8");
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const files = () => (JSON.parse(first) as DeclarationsData).languages.php!.files;

  it("is valid and carries schemaVersion", (ctx) => {
    if (skipped) ctx.skip(skipped);
    const data = JSON.parse(first) as DeclarationsData;
    expect(validateModule("declarations", data).ok).toBe(true);
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(files().map((f) => f.path)).toEqual(["src/Billing.php", "src/compat.php"]);
  });

  it("lists a namespaced file's two classes, interface and trait, fully qualified, at their lines", (ctx) => {
    if (skipped) ctx.skip(skipped);
    expect(files()[0]).toEqual({
      path: "src/Billing.php",
      namespaces: ["Acme\\Billing"],
      types: [
        { kind: "interface", name: "Payable", qualifiedName: "Acme\\Billing\\Payable", line: 4 },
        { kind: "trait", name: "Discounts", qualifiedName: "Acme\\Billing\\Discounts", line: 5 },
        { kind: "class", name: "Invoice", qualifiedName: "Acme\\Billing\\Invoice", line: 6 },
        { kind: "class", name: "CreditNote", qualifiedName: "Acme\\Billing\\CreditNote", line: 8 },
      ],
    });
  });

  it("lists a class declared in an if block, not an anonymous class, with no namespace", (ctx) => {
    if (skipped) ctx.skip(skipped);
    expect(files()[1]).toEqual({
      path: "src/compat.php",
      namespaces: [],
      types: [{ kind: "class", name: "Json_Encoder", qualifiedName: "Json_Encoder", line: 3 }],
    });
  });

  it("is written byte for byte the same by a second run", async (ctx) => {
    if (skipped) ctx.skip(skipped);
    await cmdAnalyze(dir, ["--fast"]);
    expect(readFileSync(declarationsPath(), "utf-8")).toBe(first);
  });
});

describe("declarations.json without PHP", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("is not written, and a stale one is removed", async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-declarations-json-none-"));
    writeFileSync(join(dir, "package.json"), "{}");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/app.ts"), "export class App {}\n");
    const svDir = join(dir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, DATA_FILES.declarations), "{}");

    await cmdAnalyze(dir, ["--fast"]);

    expect(existsSync(join(svDir, DATA_FILES.sdlcProfile))).toBe(true);
    expect(existsSync(join(svDir, DATA_FILES.declarations))).toBe(false);
  }, 60_000);
});
