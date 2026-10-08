import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BUILTIN_PACKS,
  loadLanguagePacks,
  type LanguagePack,
} from "../../../src/language/pack.js";
import { grammarBuildDir } from "../../../src/language/package-paths.js";
import { goConfig } from "../../../src/language/go.js";
import { GRAMMAR_BUILD_DIR } from "../../../scripts/build-grammars.mjs";

const pack: LanguagePack = {
  id: "go",
  config: goConfig,
  grammar: { name: "tree-sitter-fake", version: "1.2.3" },
  queries: [{ name: "structure", path: "/packs/fake/structure.scm" }],
  provenance: {
    structure: {
      verifiedAgainst: ["tree-sitter-fake@1.2.3"],
      verifiedOn: "2026-10-07",
      source: "https://example.com/fake",
    },
  },
};

describe("loadLanguagePacks", () => {
  let grammarDir: string;
  let messages: string[];
  const warn = (m: string) => messages.push(m);

  beforeEach(() => {
    grammarDir = mkdtempSync(join(tmpdir(), "sv-pack-"));
    messages = [];
  });
  afterEach(() => rmSync(grammarDir, { recursive: true, force: true }));

  it("reports structure mode when the grammar is built", () => {
    writeFileSync(join(grammarDir, "tree-sitter-fake.wasm"), "");
    const [status] = loadLanguagePacks({ packs: [pack], grammarDir, warn });

    expect(status.grammarAvailable).toBe(true);
    expect(status.mode).toBe("structure");
    expect(status.grammarPath).toBe(join(grammarDir, "tree-sitter-fake.wasm"));
    expect(status.notice).toBeUndefined();
    expect(messages).toEqual([]);
  });

  it("degrades to inventory-only with one message when the grammar is missing", () => {
    const statuses = loadLanguagePacks({ packs: [pack], grammarDir, warn });

    expect(statuses).toHaveLength(1);
    expect(statuses[0].grammarAvailable).toBe(false);
    expect(statuses[0].mode).toBe("inventory-only");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(statuses[0].notice);
    expect(messages[0]).toContain("tree-sitter-fake@1.2.3");
    expect(messages[0]).toContain("inventory only");
  });

  it("reports each pack independently", () => {
    writeFileSync(join(grammarDir, "tree-sitter-fake.wasm"), "");
    const other = { ...pack, grammar: { name: "tree-sitter-absent", version: "0.1.0" } };
    const modes = loadLanguagePacks({ packs: [pack, other], grammarDir, warn }).map((s) => s.mode);

    expect(modes).toEqual(["structure", "inventory-only"]);
    expect(messages).toHaveLength(1);
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
