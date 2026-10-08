import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { staleChangedPackages, staleDistMessage } from "../../scripts/lib/stale-dist.mjs";

const MANIFESTS = [
  { dir: "core", name: "@n-dx/core" },
  { dir: "llm-client", name: "@n-dx/llm-client" },
  { dir: "rex", name: "@n-dx/rex" },
];

let root;

/** Write `rel` under the temp root with mtime `secondsAgo` seconds in the past. */
function touch(rel, secondsAgo) {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "x");
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(full, t, t);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "stale-dist-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("staleChangedPackages", () => {
  it("reports an edited package whose src is newer than its dist", () => {
    touch("packages/llm-client/dist/config.js", 100);
    touch("packages/llm-client/src/config.ts", 10);
    const stale = staleChangedPackages(root, ["packages/llm-client/src/config.ts"], MANIFESTS);
    expect(stale).toEqual([{ dir: "llm-client", name: "@n-dx/llm-client", ageSeconds: 90 }]);
  });

  it("passes when the build is newer than the source", () => {
    touch("packages/llm-client/src/config.ts", 100);
    touch("packages/llm-client/dist/config.js", 10);
    expect(staleChangedPackages(root, ["packages/llm-client/src/config.ts"], MANIFESTS)).toEqual([]);
  });

  it("ignores a stale package the change did not touch", () => {
    touch("packages/rex/dist/a.js", 100);
    touch("packages/rex/src/a.ts", 10);
    touch("packages/llm-client/src/config.ts", 100);
    touch("packages/llm-client/dist/config.js", 10);
    expect(staleChangedPackages(root, ["packages/llm-client/src/config.ts"], MANIFESTS)).toEqual([]);
  });

  it("ignores a tests-only change and packages without src/ or dist/", () => {
    touch("packages/rex/dist/a.js", 100);
    touch("packages/rex/src/a.ts", 10);
    touch("packages/core/cli.js", 10);
    expect(
      staleChangedPackages(root, ["packages/rex/tests/a.test.ts", "packages/core/cli.js"], MANIFESTS),
    ).toEqual([]);
  });
});

describe("staleDistMessage", () => {
  it("names each package and its build command", () => {
    const msg = staleDistMessage([{ dir: "llm-client", name: "@n-dx/llm-client", ageSeconds: 90 }]);
    expect(msg).toContain("@n-dx/llm-client");
    expect(msg).toContain("pnpm --filter @n-dx/llm-client build");
  });
});
