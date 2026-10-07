/**
 * @n-dx/hench is `"type": "module"`: a bare `require(` in its sources compiles
 * to a call that throws in Node ESM, yet works under vitest, which supplies
 * `require` — so unit tests cannot catch it. This guard reads the sources.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/** path (relative to src) → why a `require(` there is intentional. */
const EXEMPT: Record<string, string> = {};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

/** Blank out comments and string/template literals, keeping line structure. */
function stripNonCode(src: string): string {
  return src.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g,
    (m) => m.replace(/[^\n]/g, " "),
  );
}

describe("hench sources", () => {
  it("contain no bare require() call", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = file.slice(SRC.length).replace(/^[\\/]/, "").split("\\").join("/");
      if (rel in EXEMPT) continue;
      stripNonCode(readFileSync(file, "utf-8")).split("\n").forEach((line, i) => {
        if (/(^|[^.\w$])require\s*\(/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("strips comments and strings but not code", () => {
    const code = stripNonCode('// require("x")\nconst s = "require(y)";\nconst r = require("z");');
    expect(code.match(/require\s*\(/g)).toHaveLength(1);
  });
});
