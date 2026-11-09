/**
 * Live's container keeps a 1200 px cap. Without centring, a main column wider
 * than the cap (1440 px and up, or the Sidecar drawer closed) leaves the spare
 * width on the right as a one-sided gutter. Home centres its column the same way.
 * Every Live wrapper (overview, task, analyze) carries `.live-container`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const styles = join(import.meta.dirname, "../../../src/viewer");
const css = readFileSync(join(styles, "styles/live.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of every rule whose selector list contains `selector` exactly. */
function declarations(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out.join("\n");
}

describe(".live-container", () => {
  it("is centred in the free width and keeps its cap", () => {
    const d = declarations(".live-container");
    expect(d).toMatch(/max-width:\s*1200px/);
    expect(d).toMatch(/margin-inline:\s*auto|margin:\s*0 auto/);
  });

  it.each(["live.ts", "live-task.ts", "live-analyze.ts"])("%s renders inside .live-container", (file) => {
    expect(readFileSync(join(styles, "views", file), "utf8")).toMatch(/class: "live-container/);
  });
});
