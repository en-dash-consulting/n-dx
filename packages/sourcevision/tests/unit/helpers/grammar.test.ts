import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { grammarsRequired, skipUnlessGrammar } from "../../helpers/grammar.js";

const dir = mkdtempSync(join(tmpdir(), "sv-grammar-gate-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("skipUnlessGrammar", () => {
  const missing = join(dir, "missing.wasm");
  const built = join(dir, "built.wasm");
  writeFileSync(built, "");

  it("does nothing when the grammar is built", () => {
    const skip = vi.fn();
    skipUnlessGrammar({ skip }, built, { SV_REQUIRE_GRAMMARS: "1" });
    expect(skip).not.toHaveBeenCalled();
  });

  it("skips a missing grammar by default", () => {
    const skip = vi.fn();
    skipUnlessGrammar({ skip }, missing, {});
    expect(skip).toHaveBeenCalledWith(expect.stringContaining("build-grammars.mjs"));
  });

  it("fails a missing grammar when SV_REQUIRE_GRAMMARS=1", () => {
    const skip = vi.fn();
    expect(() => skipUnlessGrammar({ skip }, missing, { SV_REQUIRE_GRAMMARS: "1" })).toThrow(/forbids skipping/);
    expect(skip).not.toHaveBeenCalled();
  });

  it("requires grammars only for the value 1", () => {
    expect(grammarsRequired({ SV_REQUIRE_GRAMMARS: "1" })).toBe(true);
    expect(grammarsRequired({ SV_REQUIRE_GRAMMARS: "0" })).toBe(false);
    expect(grammarsRequired({})).toBe(false);
  });
});
