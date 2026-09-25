import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFileHeader, collectFileHeaders } from "../../../src/analyzers/file-headers.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sv-headers-"));
  writeFileSync(join(dir, "documented.ts"), "/**\n * Parses things.\n * Two lines of doc.\n */\nexport const x = 1;\n");
  writeFileSync(join(dir, "bare.ts"), "export const y = 2;\n");
  writeFileSync(join(dir, "one-line.ts"), "// MIT\nexport const z = 3;\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("extractFileHeader", () => {
  it("returns the leading comment block and stops at code", () => {
    expect(extractFileHeader(join(dir, "documented.ts"))).toBe("/**\n * Parses things.\n * Two lines of doc.\n */");
  });
  it("returns null for no header, a one-line header, or a missing file", () => {
    expect(extractFileHeader(join(dir, "bare.ts"))).toBeNull();
    expect(extractFileHeader(join(dir, "one-line.ts"))).toBeNull();
    expect(extractFileHeader(join(dir, "missing.ts"))).toBeNull();
  });
});

describe("collectFileHeaders", () => {
  it("keys headers by relative path, omits files without one, and is empty without a project dir", () => {
    expect(collectFileHeaders(["documented.ts", "bare.ts"], dir)).toEqual({
      "documented.ts": "/**\n * Parses things.\n * Two lines of doc.\n */",
    });
    expect(collectFileHeaders(["documented.ts"], undefined)).toEqual({});
  });
  it("stops adding once the budget is spent", () => {
    expect(Object.keys(collectFileHeaders(["documented.ts", "documented.ts"], dir, 10))).toHaveLength(1);
  });
});
