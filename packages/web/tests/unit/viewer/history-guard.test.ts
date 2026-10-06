/**
 * Viewer history writes must keep the `/p/<id>` and `/w/<key>` prefix. Behind
 * the hub a root-relative `history.pushState(…, "/prd/x")` makes the next
 * reload land on the hub's 409. Use `pushAppHistory` / `replaceAppHistory`
 * (base-path.ts), or pass `appUrl(...)` or a URL derived from `location`.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VIEWER_DIR = join(import.meta.dirname!, "..", "..", "..", "src", "viewer");

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? collectTsFiles(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

const CALL = /history\.(?:push|replace)State\(/g;
/** Argument text up to the statement end. */
const argsAt = (src: string, from: number) => src.slice(from, src.indexOf(";", from));

describe("viewer history writes", () => {
  it("never pass a root-relative path that bypasses appUrl()", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(VIEWER_DIR)) {
      if (file.endsWith("base-path.ts")) continue;
      const src = readFileSync(file, "utf-8");
      for (const m of src.matchAll(CALL)) {
        const args = argsAt(src, m.index! + m[0].length);
        if (!/appUrl\(|location|url\.toString\(\)/.test(args)) {
          offenders.push(`${file.slice(VIEWER_DIR.length + 1)}: ${m[0]}${args.slice(0, 60).replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the validation view navigates through pushAppHistory", () => {
    const src = readFileSync(join(VIEWER_DIR, "views", "validation.ts"), "utf-8");
    expect(src).toMatch(/pushAppHistory\([^;]*`\/prd\/\$\{id\}`\)/);
  });
});
