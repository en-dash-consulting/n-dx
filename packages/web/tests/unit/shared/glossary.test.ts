import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GLOSSARY_TERMS, getGlossaryDefinition } from "../../../src/shared/glossary.js";

const REQUIRED_TERMS = [
  "zone",
  "zone pin",
  "enrichment pass",
  "archetype",
  "weight",
  "guard rail",
  "epic / feature / task",
  "worktree anchor",
];

describe("GLOSSARY_TERMS", () => {
  it("holds exactly the required terms, each with a non-empty definition", () => {
    const terms = GLOSSARY_TERMS.map((t) => t.term);
    expect(new Set(terms)).toEqual(new Set(REQUIRED_TERMS));
    // No duplicates.
    expect(terms.length).toBe(new Set(terms).size);
    for (const t of GLOSSARY_TERMS) {
      expect(t.definition.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("getGlossaryDefinition", () => {
  it("returns the definition for a known term", () => {
    expect(getGlossaryDefinition("zone")).toBe(
      GLOSSARY_TERMS.find((t) => t.term === "zone")!.definition,
    );
  });

  it("returns undefined for an unknown term", () => {
    expect(getGlossaryDefinition("not-a-real-term")).toBeUndefined();
  });
});

/**
 * Every glossary term must be rendered by at least one view or component —
 * otherwise the glossary is dead copy nobody sees. `GlossaryLine` is always
 * invoked as `h(GlossaryLine, { term: "<term>" })`, so a term "is rendered"
 * when that literal string appears as a `term` prop somewhere under
 * `src/viewer/`. This is a textual scan (same technique as
 * `boundary-check.test.ts`) rather than a render pass, so it also catches a
 * term that was added to the glossary but never wired into any view.
 */
describe("glossary term coverage", () => {
  const VIEWER_SRC = join(import.meta.dirname!, "..", "..", "..", "src", "viewer");

  function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectTsFiles(full));
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        files.push(full);
      }
    }
    return files;
  }

  function findGlossaryLineTerms(): Set<string> {
    const used = new Set<string>();
    const re = /GlossaryLine,\s*\{\s*term:\s*"([^"]+)"/g;
    for (const file of collectTsFiles(VIEWER_SRC)) {
      const content = readFileSync(file, "utf-8");
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        used.add(m[1]!);
      }
    }
    return used;
  }

  it("every glossary term is referenced by at least one view", () => {
    const used = findGlossaryLineTerms();
    const missing = REQUIRED_TERMS.filter((t) => !used.has(t));
    expect(missing).toEqual([]);
  });

  it("has no GlossaryLine call for a term the glossary does not define", () => {
    const used = findGlossaryLineTerms();
    const known = new Set(GLOSSARY_TERMS.map((t) => t.term));
    const unknown = [...used].filter((t) => !known.has(t));
    expect(unknown).toEqual([]);
  });
});
