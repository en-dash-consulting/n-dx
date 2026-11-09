/**
 * The Sidecar drawer narrows .app-body, not the viewport. Below a body width the
 * stage links hide and their gutters go, so the right link cannot cover content.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "../../../src/viewer/styles/shell.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(selector: string, source = css): string {
  const out: string[] = [];
  for (const m of source.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out.join("\n");
}

// The file has other container queries (the top nav's); pick the one that holds the links.
const container = [...css.matchAll(/@container\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?\})\s*\}/g)]
  .find((m) => m[2]!.includes(".stage-links")) ?? null;

describe("stage links on a narrowed body", () => {
  it(".app-body is an inline-size container", () => {
    expect(declarations(".app-body")).toMatch(/container-type:\s*inline-size/);
  });

  it("a container query hides the links and drops the gutters", () => {
    expect(container).not.toBeNull();
    const body = container![2]!;
    expect(declarations(".stage-links", body)).toMatch(/display:\s*none/);
    expect(declarations(".main--staged", body)).toMatch(/padding-right:\s*var\(--space-3\)/);
    expect(declarations(".main--staged", body)).toMatch(/padding-left:\s*var\(--space-3\)/);
  });

  it("the container threshold is above the 584 px drawer-narrowed body", () => {
    expect(Number(container![1])).toBeGreaterThanOrEqual(584);
  });

  it("full-width behaviour is kept", () => {
    expect(declarations(".stage-link-next")).toMatch(/right:\s*0/);
    expect(declarations(".stage-link")).toMatch(/z-index:\s*15/);
    expect(declarations(".main--staged")).toMatch(/padding-right:\s*calc\(var\(--space-6\) \+ var\(--stage-link-w\)\)/);
  });
});
