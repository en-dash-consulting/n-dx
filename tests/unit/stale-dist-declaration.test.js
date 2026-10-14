/**
 * `scripts/lib/stale-dist.d.mts` must keep describing `stale-dist.mjs`.
 *
 * The implementation is plain JavaScript, so the declaration beside it is
 * hand-written and nothing makes the two move together. A TypeScript consumer
 * — today `packages/web/tests/helpers/built-server-guard.ts` — type-checks
 * against the declaration alone: add an export, rename one, or change a
 * signature, and `tsc --noEmit` keeps passing against a file that no longer
 * describes the module. The first symptom is a runtime failure inside a test
 * helper, which is the worst place to learn about it.
 *
 * This pins the export *names* in both directions. It deliberately does not
 * try to compare signatures: parsing types out of a .d.mts by regex invites a
 * guard that fails on formatting rather than on drift. Names catch the two
 * realistic mistakes — a new export nobody declared, and a declaration left
 * behind by a rename.
 *
 * @see tests/e2e/windows-quoting-parity.test.js — the same shape, for a src/dist twin
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const LIB = join(import.meta.dirname, "../../scripts/lib");

/** Export names in the implementation: `export const|function|class <name>`. */
function implementationExports() {
  const src = readFileSync(join(LIB, "stale-dist.mjs"), "utf-8");
  return [...src.matchAll(/^export\s+(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1])
    .sort();
}

/** Export names in the declaration, including `interface` and `type`. */
function declaredExports() {
  const dts = readFileSync(join(LIB, "stale-dist.d.mts"), "utf-8");
  return [...dts.matchAll(
    /^export\s+(?:declare\s+)?(?:const|let|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm,
  )]
    .map((m) => m[1])
    .sort();
}

describe("stale-dist.d.mts matches stale-dist.mjs", () => {
  it("reads a plausible set of exports from each, so the comparison is not vacuous", () => {
    expect(implementationExports().length).toBeGreaterThanOrEqual(5);
    expect(declaredExports().length).toBeGreaterThanOrEqual(5);
    expect(implementationExports()).toContain("isBuildCurrent");
  });

  it("declares every value the implementation exports", () => {
    const declared = new Set(declaredExports());
    const missing = implementationExports().filter((name) => !declared.has(name));
    expect(
      missing,
      "These are exported by scripts/lib/stale-dist.mjs but absent from its " +
        "hand-written .d.mts, so a TypeScript consumer cannot see them.",
    ).toEqual([]);
  });

  it("declares nothing the implementation does not export", () => {
    // A type-only export (`interface`) is legitimately declaration-only; a
    // value that no longer exists is a rename nobody finished.
    const dts = readFileSync(join(LIB, "stale-dist.d.mts"), "utf-8");
    const typeOnly = new Set(
      [...dts.matchAll(/^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    );
    const implemented = new Set(implementationExports());
    const stale = declaredExports().filter((n) => !typeOnly.has(n) && !implemented.has(n));
    expect(
      stale,
      "These are declared in scripts/lib/stale-dist.d.mts but no longer " +
        "exported by stale-dist.mjs — a rename that stopped halfway. A " +
        "consumer importing one type-checks and then fails at runtime.",
    ).toEqual([]);
  });
});
