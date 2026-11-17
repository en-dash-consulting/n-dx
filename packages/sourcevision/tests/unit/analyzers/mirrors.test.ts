/**
 * Mirrored folders found from inventory hashes. Invented paths: `app/x/**`
 * and a near-copy `edit/x/**` where two files differ and one is new.
 */

import { describe, expect, it } from "vitest";
import { markMirrors } from "../../../src/analyzers/mirrors.js";
import type { FileEntry } from "../../../src/schema/v1.js";
import { computeInventorySummary } from "../../../src/util/merge.js";

const entry = (path: string, hash: string): FileEntry => ({
  path,
  size: 1,
  language: "PHP",
  lineCount: 1,
  hash,
  role: "source",
  category: "general",
});

const NAMES = Array.from({ length: 12 }, (_, i) => `x/page${i}.php`);

/** `app/x/**`, and `edit/x/**` with page0 and page1 edited and a file only the copy has. */
function estate(): FileEntry[] {
  return [
    ...NAMES.map((n) => entry(`app/${n}`, `h-${n}`)),
    ...NAMES.map((n, i) => entry(`edit/${n}`, i < 2 ? `edited-${n}` : `h-${n}`)),
    entry("edit/x/only-here.php", "h-only"),
    entry("app/index.php", "h-index"),
  ];
}

const marks = (files: FileEntry[]) => Object.fromEntries(files.filter((f) => f.mirrorOf).map((f) => [f.path, f.mirrorOf]));

describe("markMirrors", () => {
  it("marks the copy's identical files against their counterpart, at the detected share", () => {
    const { files, pairs } = markMirrors(estate());
    expect(pairs).toEqual([{ mirror: "edit", source: "app", matched: 10, files: 13 }]);
    const marked = marks(files);
    expect(Object.keys(marked)).toHaveLength(10);
    expect(marked["edit/x/page5.php"]).toBe("app/x/page5.php");
    // Where the copy diverged stays first-party, and the source is never marked.
    for (const path of ["edit/x/page0.php", "edit/x/page1.php", "edit/x/only-here.php", "app/x/page5.php"]) expect(marked[path]).toBeUndefined();
    expect(computeInventorySummary(files).mirrored).toEqual({ files: 10, byReason: { "edit/ mirrors app/": 10 } });
  });

  it("needs enough identical files: a few shared files are not a mirror", () => {
    const files = [...NAMES.slice(0, 4).map((n) => entry(`a/${n}`, n)), ...NAMES.slice(0, 4).map((n) => entry(`b/${n}`, n))];
    expect(markMirrors(files).pairs).toEqual([]);
  });

  it("takes the smaller, then the later, side of an exact copy as the copy", () => {
    const exact = [...NAMES.map((n) => entry(`site/${n}`, n)), ...NAMES.map((n) => entry(`backup/${n}`, n))];
    expect(markMirrors(exact).pairs[0]).toMatchObject({ mirror: "site", source: "backup" });
    const bigger = [...exact, entry("backup/extra.php", "extra")];
    expect(markMirrors(bigger).pairs[0]).toMatchObject({ mirror: "site", source: "backup" });
    expect(markMirrors([...exact, entry("site/extra.php", "extra")]).pairs[0]).toMatchObject({ mirror: "backup", source: "site" });
  });

  it("never pairs a folder with its own subfolder", () => {
    const files = [...NAMES.map((n) => entry(`app/${n}`, n)), ...NAMES.map((n) => entry(`app/old/${n}`, n))];
    const { pairs } = markMirrors(files);
    expect(pairs.every((p) => !p.mirror.startsWith(`${p.source}/`) && !p.source.startsWith(`${p.mirror}/`))).toBe(true);
  });

  it("follows sourcevision.mirrors: a configured pair whatever the share, a denied copy never", () => {
    const configured = markMirrors(estate().slice(0, 30), { "edit/": "app/" });
    expect(configured.pairs[0]).toMatchObject({ mirror: "edit", source: "app", configured: true });
    expect(markMirrors(estate(), { "edit/": false }).pairs).toEqual([]);
  });

  it("clears a stale mark", () => {
    const { files } = markMirrors([{ ...entry("a.php", "h"), mirrorOf: "b.php" }]);
    expect(files[0]).not.toHaveProperty("mirrorOf");
  });
});
