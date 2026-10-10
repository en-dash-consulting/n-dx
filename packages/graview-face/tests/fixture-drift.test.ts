/**
 * The fixture document is a copy of what `@n-dx/graview` emits, and a copy
 * drifts. In the monorepo the declaration is two directories away, so hold
 * the copy to it; installed from npm it is not there, and the check is moot.
 * `pnpm sync && pnpm fixture` refreshes the copy.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DECLARATION = new URL("../../graview/n-dx.graview.json", import.meta.url);
const read = (url: URL) => JSON.parse(readFileSync(url, "utf-8")) as Record<string, unknown>;

describe.skipIf(!existsSync(DECLARATION))("tests/fixtures/document.json", () => {
  it("is the declaration beside this package, with only the project's name set", () => {
    const { name: _fixtureName, ...fixture } = read(new URL("./fixtures/document.json", import.meta.url));
    const { name: _declaredName, ...declared } = read(DECLARATION);
    expect(fixture).toEqual(declared);
  });
});
