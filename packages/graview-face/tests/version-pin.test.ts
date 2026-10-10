/**
 * One Graview release, named twice: the adapter pins it for its `npx`
 * fallback (`GRAVIEW_VERSION`) and this package pins every `@graview/*`
 * dependency to it. In the monorepo the adapter is two directories away, so
 * hold the two together; installed from npm it is not there, and the check
 * is moot.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ADAPTER_DOCUMENT = new URL("../../graview/src/document.ts", import.meta.url);
const isGraview = (name: string) => name === "graview" || name.startsWith("@graview/");

describe.skipIf(!existsSync(ADAPTER_DOCUMENT))("the Graview pin", () => {
  it("is the one @n-dx/graview names for its npx fallback", () => {
    const pinned = /export const GRAVIEW_VERSION = "([^"]+)"/.exec(readFileSync(ADAPTER_DOCUMENT, "utf-8"))?.[1];
    expect(pinned).toBeTruthy();
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const pins = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([name]) => isGraview(name));
    expect(pins.length).toBeGreaterThan(0);
    for (const [name, range] of pins) expect(range, name).toBe(pinned);
  });
});
