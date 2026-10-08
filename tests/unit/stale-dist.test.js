import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILD_STAMP_FILE,
  staleChangedPackages,
  staleDistMessage,
  writeBuildStamp,
} from "../../scripts/lib/stale-dist.mjs";

const MANIFESTS = [
  { dir: "core", name: "@n-dx/core" },
  { dir: "llm-client", name: "@n-dx/llm-client" },
  { dir: "rex", name: "@n-dx/rex" },
  { dir: "web", name: "@n-dx/web" },
];

let root;

function write(rel, content = "x") {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  return full;
}

/** A full build of `dir`: compiled output plus the stamp, written last. */
function fullBuild(dir) {
  write(`packages/${dir}/dist/index.js`);
  writeBuildStamp(join(root, "packages", dir, "src"), join(root, "packages", dir, "dist"));
}

const stale = (...changed) => staleChangedPackages(root, changed, MANIFESTS).map((s) => s.dir);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "stale-dist-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("staleChangedPackages", () => {
  it("passes after a full build of the current source", () => {
    write("packages/llm-client/src/config.ts", "a");
    fullBuild("llm-client");
    expect(stale("packages/llm-client/src/config.ts")).toEqual([]);
  });

  it("reports an edit made after the build", () => {
    write("packages/llm-client/src/config.ts", "a");
    fullBuild("llm-client");
    write("packages/llm-client/src/config.ts", "b");
    expect(stale("packages/llm-client/src/config.ts")).toEqual(["llm-client"]);
  });

  it("reports a dist with no stamp, however fresh its files", () => {
    write("packages/llm-client/src/config.ts");
    write("packages/llm-client/dist/config.js");
    expect(stale("packages/llm-client/src/config.ts")).toEqual(["llm-client"]);
  });

  it("stays stale after a partial build refreshes only some of dist/ (web build:landing)", () => {
    write("packages/web/src/server/start.ts", "a");
    fullBuild("web");
    write("packages/web/src/server/start.ts", "b");
    // build:landing: newer output in dist/, no stamp rewrite.
    write("packages/web/dist/landing/index.html", "<html>");
    expect(stale("packages/web/src/server/start.ts")).toEqual(["web"]);
  });

  it("passes when a built source is rewritten with identical content and tsc emits nothing", () => {
    const src = write("packages/rex/src/a.ts", "same");
    fullBuild("rex");
    // checkout/restore: same bytes, newer mtime; incremental tsc exits 0 and
    // touches nothing in dist/, so no stamp rewrite is needed.
    write("packages/rex/src/a.ts", "same");
    const later = new Date(Date.now() + 60_000);
    utimesSync(src, later, later);
    expect(stale("packages/rex/src/a.ts")).toEqual([]);
  });

  it("passes after a rebuild that follows an edit", () => {
    write("packages/rex/src/a.ts", "a");
    fullBuild("rex");
    write("packages/rex/src/a.ts", "b");
    fullBuild("rex");
    expect(stale("packages/rex/src/a.ts")).toEqual([]);
  });

  it("notices an added or removed source file", () => {
    write("packages/rex/src/a.ts", "a");
    fullBuild("rex");
    write("packages/rex/src/b.ts", "b");
    expect(stale("packages/rex/src/b.ts")).toEqual(["rex"]);
  });

  it("ignores a stale package the change did not touch", () => {
    write("packages/rex/src/a.ts");
    write("packages/rex/dist/a.js");
    write("packages/llm-client/src/config.ts");
    fullBuild("llm-client");
    expect(stale("packages/llm-client/src/config.ts")).toEqual([]);
  });

  it("ignores a tests-only change and packages without src/ or dist/", () => {
    write("packages/rex/src/a.ts");
    write("packages/rex/dist/a.js");
    write("packages/core/cli.js");
    expect(stale("packages/rex/tests/a.test.ts", "packages/core/cli.js")).toEqual([]);
  });

  it("treats a corrupt stamp as stale", () => {
    write("packages/rex/src/a.ts");
    write("packages/rex/dist/a.js");
    write(`packages/rex/dist/${BUILD_STAMP_FILE}`, "not json");
    expect(stale("packages/rex/src/a.ts")).toEqual(["rex"]);
  });
});

describe("staleDistMessage", () => {
  it("names each package and its build command", () => {
    const msg = staleDistMessage([{ dir: "llm-client", name: "@n-dx/llm-client" }]);
    expect(msg).toContain("@n-dx/llm-client");
    expect(msg).toContain("pnpm --filter @n-dx/llm-client build");
  });
});
