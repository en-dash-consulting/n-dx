/**
 * The trust strip is capped at about a third of the viewport and its expanded
 * details scroll inside it, so a long strip cannot squash `.app-body`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "../../../src/viewer/styles/repo-trust.css"), "utf8");

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ruleIn(source: string, selector: string): string {
  const m = source.match(new RegExp(`(?:^|\\n)${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

const rule = (selector: string): string => ruleIn(css, selector);

describe("ruleIn", () => {
  it("matches a selector's metacharacters literally", () => {
    expect(ruleIn(".a\\:b[x] { color: red; }", ".a\\:b[x]")).toContain("red");
    expect(() => ruleIn(".aab { color: blue; }", ".a.b")).toThrow();
    expect(() => ruleIn("xab { color: blue; }", ".*")).toThrow();
  });
});

describe("repo-trust.css", () => {
  it("caps the strip at a third of the viewport and keeps it from shrinking", () => {
    const strip = rule(".repo-trust-strip");
    // A floor, so a viewport where the third minus the chrome reaches zero
    // still leaves a scroll box tall enough to reach the buttons.
    expect(strip).toMatch(/max-height:\s*max\(5rem, calc\(100vh \/ 3 - var\(--topnav-h\) - var\(--bottombar-h\)\)\)/);
    expect(strip).toMatch(/max-height:\s*max\(5rem, calc\(100dvh \/ 3 - var\(--topnav-h\) - var\(--bottombar-h\)\)\)/);
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
