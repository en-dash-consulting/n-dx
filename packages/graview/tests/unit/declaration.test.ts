/**
 * The declaration compiles under the Graview release the adapter pins. The
 * other tests hold the document to rex's shape; this one hands it to
 * `compileDocument`, the same check `graview check` runs, so a declaration
 * that Graview would refuse fails here rather than at `ndx graview serve`.
 *
 * `@graview/core` is a devDependency only: the published adapter still has
 * no `@graview/*` dependency, and the pin this test reads is what the `npx`
 * fallback and `@n-dx/graview-face` both name.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { compileDocument } from "@graview/core/check";
import { documentFor, GRAVIEW_VERSION } from "../../src/document.js";

const OWN_PACKAGE = new URL("../../package.json", import.meta.url);

describe("n-dx.graview.json under Graview", () => {
  it("compiles with no findings", () => {
    const compiled = compileDocument(documentFor("n-dx"));
    expect(compiled.ok, compiled.ok ? "" : JSON.stringify(compiled.findings, null, 2)).toBe(true);
  });

  it("was checked against the release the npx fallback pins", () => {
    const pkg = JSON.parse(readFileSync(OWN_PACKAGE, "utf-8")) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies["@graview/core"]).toBe(GRAVIEW_VERSION);
  });
});
