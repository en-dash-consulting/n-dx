import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LanguagePack } from "@n-dx/lang-runtime";
import {
  BUILTIN_PACKS,
  loadLanguagePacks,
} from "../../../src/language/pack.js";
import { grammarBuildDir } from "../../../src/language/package-paths.js";
import { goConfig } from "@n-dx/lang-kit";
import { GRAMMAR_BUILD_DIR } from "../../../../lang-runtime/scripts/build-grammars.mjs";

const pack: LanguagePack = {
  id: "go",
  config: goConfig,
  grammar: { name: "tree-sitter-fake", version: "1.2.3" },
  queries: [{ name: "structure", path: "/packs/fake/structure.scm" }],
  produces: [],
  provenance: {
    structure: {
      verifiedAgainst: ["tree-sitter-fake@1.2.3"],
      verifiedOn: "2026-10-07",
      source: "https://example.com/fake",
    },
  },
};

// The loader itself is tested in @n-dx/lang-runtime; this is what sourcevision binds to it.
describe("loadLanguagePacks", () => {
  let grammarDir: string;
  let messages: string[];
  const warn = (m: string) => messages.push(m);

  beforeEach(() => {
    grammarDir = mkdtempSync(join(tmpdir(), "sv-pack-"));
    messages = [];
  });
  afterEach(() => rmSync(grammarDir, { recursive: true, force: true }));

  it("names the build:grammars script in a source checkout", () => {
    const [status] = loadLanguagePacks({ packs: [pack], grammarDir, warn });

    expect(status.notice).toContain("pnpm --filter @n-dx/sourcevision build:grammars");
  });

  it("loads the built-in packs from the default grammar dir", () => {
    const statuses = loadLanguagePacks({ warn });

    expect(statuses.map((s) => s.pack)).toEqual(BUILTIN_PACKS);
    for (const s of statuses) expect(s.grammarPath).toBe(join(grammarBuildDir(), `${s.pack.grammar.name}.wasm`));
  });
});

describe("built-in packs", () => {
  it("default grammar dir is where build-grammars.mjs writes", () => {
    expect(grammarBuildDir()).toBe(GRAMMAR_BUILD_DIR);
  });

  it("every built-in pack has provenance for each query and a matching id", () => {
    for (const p of BUILTIN_PACKS) {
      expect(p.id).toBe(p.config.id);
      for (const q of p.queries) expect(p.provenance[q.name], `${p.id}:${q.name}`).toBeDefined();
    }
  });
});
