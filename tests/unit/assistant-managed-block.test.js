/**
 * The managed block `ndx init` owns in CLAUDE.md and AGENTS.md: the splice
 * keeps every byte outside the markers.
 *
 * @see packages/core/assistant-assets.js — `spliceManagedBlock`
 * @see tests/e2e/instruction-alignment.test.js — the same rules through init
 */

import { describe, it, expect } from "vitest";
import {
  MANAGED_BLOCK_BEGIN,
  MANAGED_BLOCK_END,
  extractManagedBlock,
  spliceManagedBlock,
} from "../../packages/core/assistant-assets.js";

const block = (body) => `${MANAGED_BLOCK_BEGIN}\n${body}\n${MANAGED_BLOCK_END}`;

describe("spliceManagedBlock", () => {
  it("writes the block alone when there is no file", () => {
    expect(spliceManagedBlock(null, block("new"))).toBe(block("new") + "\n");
  });

  it("keeps a file without markers and adds the block after it", () => {
    expect(spliceManagedBlock("# Mine\n", block("new"))).toBe(`# Mine\n\n${block("new")}\n`);
    expect(spliceManagedBlock("# Mine", block("new"))).toBe(`# Mine\n\n${block("new")}\n`);
  });

  it("replaces only the text between the markers", () => {
    const before = "# Mine\r\n\r\nkept  \n";
    const after = "\n\n## Also mine\nno trailing newline";
    const result = spliceManagedBlock(before + block("old") + after, block("new"));
    expect(result).toBe(before + block("new") + after);
  });

  it("recognises a begin marker whose wording changed", () => {
    const old = "<!-- ndx:begin older wording -->\nold\n" + MANAGED_BLOCK_END;
    expect(spliceManagedBlock(`a\n${old}\nb\n`, block("new"))).toBe(`a\n${block("new")}\nb\n`);
  });

  it("is a fixed point: splicing the same block again changes nothing", () => {
    const once = spliceManagedBlock("# Mine\n", block("new"));
    expect(spliceManagedBlock(once, block("new"))).toBe(once);
  });

  it("treats a begin marker with no end marker as no block, and drops nothing", () => {
    const text = `${MANAGED_BLOCK_BEGIN}\nhalf a block\n`;
    const once = spliceManagedBlock(text, block("new"));
    expect(once).toBe(`${text}\n${block("new")}\n`);
    // The next run pairs the end marker with the nearest begin, so the stray
    // begin and its text stay outside the block.
    expect(spliceManagedBlock(once, block("newer"))).toBe(`${text}\n${block("newer")}\n`);
  });
});

describe("extractManagedBlock", () => {
  it("returns the block with its markers, LF-normalised", () => {
    expect(extractManagedBlock(`x\r\n${block("a\r\nb")}\r\ny`)).toBe(block("a\nb"));
  });

  it("returns null when the file has no block", () => {
    expect(extractManagedBlock("# Mine\n")).toBeNull();
  });
});
