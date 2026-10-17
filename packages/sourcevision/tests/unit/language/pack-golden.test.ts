/** The golden harness itself: it fails on any difference and writes only when told to. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkGolden,
  listFixtureFiles,
  serializeGolden,
  UPDATE_ENV,
  updateRequested,
  type PackGolden,
} from "../../helpers/pack-golden.js";

const golden: PackGolden = {
  pack: "demo",
  grammar: { name: "tree-sitter-demo", version: "1.0.0" },
  files: [{ status: "skipped", path: "src/A.demo", reason: "oversized", sizeBytes: 9 }],
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sv-golden-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("checkGolden", () => {
  it("matches an identical golden without writing", () => {
    const path = join(dir, "golden.json");
    writeFileSync(path, serializeGolden(golden));
    expect(checkGolden(golden, path, false)).toBe("matched");
  });

  it("fails on any difference and leaves the golden untouched", () => {
    const path = join(dir, "golden.json");
    writeFileSync(path, serializeGolden(golden));
    const changed = { ...golden, files: [{ ...golden.files[0]!, path: "src/B.demo" }] };
    expect(() => checkGolden(changed, path, false)).toThrow(/differs from .*test:update-goldens/);
    expect(readFileSync(path, "utf-8")).toBe(serializeGolden(golden));
  });

  it("fails, without creating it, when the golden is missing", () => {
    const path = join(dir, "golden.json");
    expect(() => checkGolden(golden, path, false)).toThrow(/No golden/);
    expect(() => readFileSync(path)).toThrow();
  });

  it("rewrites the golden only in update mode", () => {
    const path = join(dir, "golden.json");
    writeFileSync(path, "stale");
    expect(checkGolden(golden, path, true)).toBe("updated");
    expect(readFileSync(path, "utf-8")).toBe(serializeGolden(golden));
  });
});

describe("updateRequested", () => {
  it("is off unless the variable is exactly 1", () => {
    expect(updateRequested({})).toBe(false);
    expect(updateRequested({ [UPDATE_ENV]: "0" })).toBe(false);
    expect(updateRequested({ [UPDATE_ENV]: "1" })).toBe(true);
  });
});

describe("listFixtureFiles", () => {
  it("returns sorted forward-slash paths for the claimed extensions only", () => {
    mkdirSync(join(dir, "src", "b"), { recursive: true });
    writeFileSync(join(dir, "src", "b", "Z.demo"), "");
    writeFileSync(join(dir, "src", "A.demo"), "");
    writeFileSync(join(dir, "golden.json"), "");
    expect(listFixtureFiles(dir, [".demo"])).toEqual(["src/A.demo", "src/b/Z.demo"]);
  });
});
