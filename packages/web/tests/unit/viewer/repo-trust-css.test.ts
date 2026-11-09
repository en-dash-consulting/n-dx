/**
 * The trust strip is capped at about a third of the viewport and its expanded
 * details scroll inside it, so a long strip cannot squash `.app-body`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "../../../src/viewer/styles/repo-trust.css"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/\./g, "\\.");
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe("repo-trust.css", () => {
  it("caps the strip at a third of the viewport and keeps it from shrinking", () => {
    const strip = rule(".repo-trust-strip");
    expect(strip).toMatch(/max-height:\s*calc\(100vh \/ 3 - var\(--topnav-h\) - var\(--bottombar-h\)\)/);
    expect(strip).toMatch(/max-height:\s*calc\(100dvh \/ 3 - var\(--topnav-h\) - var\(--bottombar-h\)\)/);
    expect(strip).toMatch(/flex:\s*0 0 auto/);
    // Not `overflow: hidden`: on a short viewport the headline row alone can
    // exceed the cap, and clipping it would put the buttons out of reach.
    expect(strip).toMatch(/overflow-y:\s*auto/);
    expect(strip).not.toMatch(/overflow:\s*hidden/);
  });

  it("keeps the headline row fixed and scrolls the details inside the strip", () => {
    expect(rule(".repo-trust-strip__row")).toMatch(/flex:\s*0 0 auto/);
    const details = rule(".repo-trust-strip__details");
    expect(details).toMatch(/overflow-y:\s*auto/);
    expect(details).toMatch(/min-height:\s*0/);
  });
});
