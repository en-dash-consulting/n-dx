/**
 * The SQL pack states which tree-sitter-sql release it was verified against.
 * `scripts/build-grammars.mjs` pins the release that is actually built; these
 * tests fail when the two disagree, so provenance cannot misstate the grammar.
 */
import { describe, expect, it } from "vitest";
import { GRAMMARS } from "../../../lang-runtime/scripts/build-grammars.mjs";
import { sqlPack } from "../../src/sql-pack.js";

const pinned = GRAMMARS["tree-sitter-sql"].version;

describe("sql pack grammar pin", () => {
  it("declares the version scripts/build-grammars.mjs builds", () => {
    expect(sqlPack.grammar.version).toBe(pinned);
  });

  it("names only the pinned version in provenance", () => {
    const named: string[] = [];
    for (const [rule, provenance] of Object.entries(sqlPack.provenance)) {
      for (const entry of provenance.verifiedAgainst) {
        const match = /^tree-sitter-sql@(.+)$/.exec(entry);
        if (match) named.push(rule + ":" + match[1]);
      }
      const url = /tree-sitter-sql\/blob\/v([^/]+)\//.exec(provenance.source ?? "");
      if (url) named.push(rule + ":" + url[1]);
    }
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((n) => n.split(":")[1] !== pinned)).toEqual([]);
  });
});
