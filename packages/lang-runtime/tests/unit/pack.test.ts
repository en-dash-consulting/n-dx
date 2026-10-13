import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { goConfig } from "@n-dx/lang-kit";
import { loadLanguagePacks, type LanguagePack } from "../../src/pack.js";

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

const missingGrammarStep = "Build it with the grammar script.";

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
    const [status] = loadLanguagePacks({ packs: [pack], grammarDir, missingGrammarStep, warn });

    expect(status.grammarAvailable).toBe(true);
    expect(status.mode).toBe("structure");
    expect(status.grammarPath).toBe(join(grammarDir, "tree-sitter-fake.wasm"));
    expect(status.notice).toBeUndefined();
    expect(messages).toEqual([]);
  });

  it("degrades to inventory-only with one message when the grammar is missing", () => {
    const statuses = loadLanguagePacks({ packs: [pack], grammarDir, missingGrammarStep, warn });

    expect(statuses).toHaveLength(1);
    expect(statuses[0].grammarAvailable).toBe(false);
    expect(statuses[0].mode).toBe("inventory-only");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(statuses[0].notice);
    expect(messages[0]).toContain("tree-sitter-fake@1.2.3");
    expect(messages[0]).toContain("inventory only");
  });

  it("ends the notice with the caller's step, word for word", () => {
    const [status] = loadLanguagePacks({ packs: [pack], grammarDir, missingGrammarStep, warn });

    expect(status.notice).toBe(
      `Go: grammar tree-sitter-fake@1.2.3 is not built (expected ${join(grammarDir, "tree-sitter-fake.wasm")}); ` +
        `Go files get inventory only. ${missingGrammarStep}`,
    );
  });

  it("reports each pack independently", () => {
    writeFileSync(join(grammarDir, "tree-sitter-fake.wasm"), "");
    const other = { ...pack, grammar: { name: "tree-sitter-absent", version: "0.1.0" } };
    const modes = loadLanguagePacks({ packs: [pack, other], grammarDir, missingGrammarStep, warn }).map((s) => s.mode);

    expect(modes).toEqual(["structure", "inventory-only"]);
    expect(messages).toHaveLength(1);
  });
});
