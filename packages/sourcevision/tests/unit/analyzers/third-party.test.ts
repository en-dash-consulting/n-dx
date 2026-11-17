/**
 * Copied-in third-party libraries: globs, deny globs, built-in fingerprints and
 * the helpers later phases read the mark through. Invented paths and headers;
 * the banners are the public shape of each library's own file header.
 */

import { describe, expect, it } from "vitest";
import {
  markOutboundThirdParty,
  markThirdParty,
  outsideStructurePredicate,
  parseThirdPartyGlobFile,
  thirdPartyGlobToRegExp,
} from "../../../src/analyzers/third-party.js";
import type { FileEntry } from "../../../src/schema/v1.js";

const entry = (path: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  path,
  size: 1,
  language: path.endsWith(".js") ? "JavaScript" : "PHP",
  lineCount: 1,
  hash: path,
  role: "source",
  category: "general",
  ...extra,
});

const headers = (map: Record<string, string>) => async (path: string) => map[path] ?? "";

const reasons = (files: FileEntry[]) => Object.fromEntries(files.filter((f) => f.thirdParty).map((f) => [f.path, f.thirdParty]));

describe("thirdPartyGlobToRegExp", () => {
  it("reads **, *, ?, a trailing slash and a bare name", () => {
    expect(thirdPartyGlobToRegExp("lib/Sheet/**").test("lib/Sheet/a/b.php")).toBe(true);
    expect(thirdPartyGlobToRegExp("lib/**/x.php").test("lib/x.php")).toBe(true);
    expect(thirdPartyGlobToRegExp("lib/**/x.php").test("lib/ax.php")).toBe(false);
    expect(thirdPartyGlobToRegExp("js/*.js").test("js/a/b.js")).toBe(false);
    expect(thirdPartyGlobToRegExp("js/").test("js/a/b.js")).toBe(true);
    expect(thirdPartyGlobToRegExp("widgets").test("app/widgets/a.js")).toBe(true);
    expect(thirdPartyGlobToRegExp("widgets").test("app/widgets")).toBe(true);
    expect(thirdPartyGlobToRegExp("widgets").test("app/mywidgets/a.js")).toBe(false);
  });
});

describe("markThirdParty", () => {
  it("marks configured and command-line globs with their source, deny globs winning", async () => {
    const files = [entry("app/index.php"), entry("lib/Sheet/Cell.php"), entry("lib/Sheet/Mine.php"), entry("js/fw/core.js")];
    const marked = await markThirdParty("/x", files, {
      globs: [
        { glob: "lib/Sheet/**", source: "config" },
        { glob: "!lib/Sheet/Mine.php", source: "config" },
        { glob: "js/fw/", source: "cli" },
      ],
      readHeader: headers({}),
    });
    expect(reasons(marked)).toEqual({ "lib/Sheet/Cell.php": "config lib/Sheet/**", "js/fw/core.js": "cli js/fw/" });
    expect(marked.map((f) => f.path)).toEqual(files.map((f) => f.path));
  });

  it("recognises library banners and library directory names", async () => {
    const files = [
      entry("app/report.php"),
      entry("inc/Spreadsheet.php"),
      entry("js/build/node/node.js"),
      entry("js/edit_area/edit_area_loader.js"),
    ];
    const marked = await markThirdParty("/x", files, {
      readHeader: headers({
        "app/report.php": "<?php\n/** @package Billing */\n",
        "inc/Spreadsheet.php": "<?php\n/**\n * @category   PHPExcel\n * @package    PHPExcel\n */\n",
        "js/build/node/node.js": "/*\nCopyright (c) 2010, Yahoo! Inc. All rights reserved.\nversion: 3.3.0\nbuild: 3167\n*/\n",
      }),
    });
    expect(reasons(marked)).toEqual({
      "inc/Spreadsheet.php": "library PHPExcel",
      "js/build/node/node.js": "library YUI",
      "js/edit_area/edit_area_loader.js": "library EditArea",
    });
  });

  it("extends a library's banner to the rest of a directory it dominates, and no further", async () => {
    const files = ["a", "b", "c", "d", "e"].map((n) => entry(`lib/sdk/${n}.php`)).concat(entry("lib/own.php"));
    const banner = "<?php\n/** @package AuthorizeNet */\n";
    const marked = await markThirdParty("/x", files, {
      readHeader: headers({ "lib/sdk/a.php": banner, "lib/sdk/b.php": banner, "lib/sdk/c.php": banner, "lib/sdk/d.php": banner }),
    });
    expect(Object.keys(reasons(marked)).sort()).toEqual(["lib/sdk/a.php", "lib/sdk/b.php", "lib/sdk/c.php", "lib/sdk/d.php", "lib/sdk/e.php"]);
    expect(marked.find((f) => f.path === "lib/own.php")?.thirdParty).toBeUndefined();
  });

  it("clears a stale mark from a cached entry", async () => {
    const marked = await markThirdParty("/x", [entry("app/a.php", { thirdParty: "config old/**" })], { readHeader: headers({}) });
    expect(marked[0]).not.toHaveProperty("thirdParty");
  });
});

describe("outsideStructurePredicate", () => {
  it("covers marked files and everything under a directory with no first-party file", () => {
    const exclude = outsideStructurePredicate([
      entry("app/a.php"),
      entry("lib/Sheet/Cell.php", { thirdParty: "library PHPExcel" }),
      entry("lib/Sheet/tests/CellTest.php", { thirdParty: "library PHPExcel" }),
      entry("lib/own.php"),
    ]);
    expect(exclude?.("lib/Sheet/tests/CellTest.php")).toBe(true);
    expect(exclude?.("lib/Sheet/phpunit.xml")).toBe(true);
    expect(exclude?.("lib/phpunit.xml")).toBe(false);
    expect(exclude?.("app/a.php")).toBe(false);
  });

  it("is undefined when nothing is marked", () => {
    expect(outsideStructurePredicate([entry("app/a.php")])).toBeUndefined();
  });
});

describe("markOutboundThirdParty", () => {
  it("marks third-party calls, drops mirror-copy calls and keeps the rest as they were", () => {
    const deps = [{ file: "app/a.php" }, { file: "lib/sdk/a.php" }, { file: "copy/a.php" }];
    const files = [entry("app/a.php"), entry("lib/sdk/a.php", { thirdParty: "library AuthorizeNet SDK" }), entry("copy/a.php", { mirrorOf: "app" })];
    expect(markOutboundThirdParty(deps, files)).toEqual([{ file: "app/a.php" }, { file: "lib/sdk/a.php", thirdParty: "library AuthorizeNet SDK" }]);
    expect(markOutboundThirdParty(deps, [entry("app/a.php")])).toBe(deps);
  });
});

describe("parseThirdPartyGlobFile", () => {
  it("reads one glob per line, skipping comments and blanks, or a JSON array", () => {
    expect(parseThirdPartyGlobFile("# catalogue\nlib/Sheet/**\n\n  js/fw/  \n")).toEqual(["lib/Sheet/**", "js/fw/"]);
    expect(parseThirdPartyGlobFile('["lib/Sheet/**", 3, ""]')).toEqual(["lib/Sheet/**"]);
  });
});
