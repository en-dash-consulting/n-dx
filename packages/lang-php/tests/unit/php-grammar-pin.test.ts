/**
 * The PHP pack states which tree-sitter-php release it parses with.
 * `scripts/build-grammars.mjs` pins the release that is actually built, and
 * from which of its grammars; these tests fail when the two disagree.
 */
import { describe, expect, it } from "vitest";
import { GRAMMARS } from "../../../lang-runtime/scripts/build-grammars.mjs";
import { phpPack } from "../../src/php-pack.js";

describe("php pack grammar pin", () => {
  it("declares the version scripts/build-grammars.mjs builds", () => {
    expect(phpPack.grammar.version).toBe(GRAMMARS["tree-sitter-php"].version);
  });

  it("is built from the php/ grammar, which parses PHP mixed with HTML", () => {
    expect(GRAMMARS["tree-sitter-php"].subdir).toBe("php");
  });

  it("has a provenance record for every query", () => {
    for (const query of phpPack.queries) expect(phpPack.provenance[query.name], query.name).toBeDefined();
  });
});
