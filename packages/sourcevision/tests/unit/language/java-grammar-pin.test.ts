/**
 * The Java pack states which tree-sitter-java release it was verified against.
 * `scripts/build-grammars.mjs` pins the release that is actually built; these
 * tests fail when the two disagree, so provenance cannot misstate the grammar.
 */
import { describe, expect, it } from "vitest";
import { GRAMMARS } from "../../../scripts/build-grammars.mjs";
import { javaPack } from "../../../src/language/java-pack.js";

const pinned = GRAMMARS["tree-sitter-java"].version;

describe("java pack grammar pin", () => {
  it("declares the version scripts/build-grammars.mjs builds", () => {
    expect(javaPack.grammar.version).toBe(pinned);
  });

  it("names only the pinned version in provenance", () => {
    const named: string[] = [];
    for (const [rule, provenance] of Object.entries(javaPack.provenance)) {
      for (const entry of provenance.verifiedAgainst) {
        const match = /^tree-sitter-java@(.+)$/.exec(entry);
        if (match) named.push(rule + ":" + match[1]);
      }
      const url = /tree-sitter-java\/blob\/v([^/]+)\//.exec(provenance.source ?? "");
      if (url) named.push(rule + ":" + url[1]);
    }
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((n) => n.split(":")[1] !== pinned)).toEqual([]);
  });
});
