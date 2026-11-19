/**
 * Copied-in third-party libraries: globs, deny globs, built-in fingerprints and
 * the helpers later phases read the mark through. Invented paths and headers;
 * the banners are the public shape of each library's own file header.
 */

import { describe, expect, it } from "vitest";
import {
  describeThirdPartyMark,
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
    const { files: marked, marks } = await markThirdParty("/x", files, {
      globs: [
        { glob: "lib/Sheet/**", source: "config" },
        { glob: "!lib/Sheet/Mine.php", source: "config" },
        { glob: "js/fw/", source: "cli" },
      ],
      readHeader: headers({}),
    });
    expect(reasons(marked)).toEqual({ "lib/Sheet/Cell.php": "config lib/Sheet/**", "js/fw/core.js": "cli js/fw/" });
    expect(marked.map((f) => f.path)).toEqual(files.map((f) => f.path));
    expect(marks).toEqual([
      { where: "js/fw/", reason: "flag", files: 1 },
      { where: "lib/Sheet/**", reason: "config", files: 1 },
    ]);
  });

  it("recognises library banners and library folders holding their entry file", async () => {
    const files = [
      entry("app/report.php"),
      entry("inc/Spreadsheet.php"),
      entry("js/build/node/node.js"),
      entry("js/edit_area/edit_area_loader.js"),
      entry("js/edit_area/edit_area_full.js"),
    ];
    const { files: marked } = await markThirdParty("/x", files, {
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
      "js/edit_area/edit_area_full.js": "library EditArea",
    });
  });

  it("leaves a first-party folder named like a library alone without the library's banner or entry file", async () => {
    const files = [entry("src/ckeditor/plugins/MyPlugin.ts"), entry("src/ckeditor/index.ts"), entry("src/charts/highcharts/options.ts")];
    const { files: marked, marks } = await markThirdParty("/x", files, {
      readHeader: headers({ "src/charts/highcharts/options.ts": "// Options for Highcharts JS v4.2.5 and later\nexport const options = {};\n" }),
    });
    expect(reasons(marked)).toEqual({});
    expect(marks).toEqual([]);
  });

  it("marks a copied-in library folder by its entry file, beside it or under it, or by its banner", async () => {
    const ck = "/*\nCopyright (c) 2003-2014, CKSource - Frederico Knabben. All rights reserved.\n*/\n";
    const files = [
      entry("js/ckeditor/ckeditor.js"),
      entry("js/ckeditor/lang/en.js"),
      entry("Classes/PHPExcel.php"),
      entry("Classes/PHPExcel/Cell.php"),
      entry("web/highcharts/modules/exporting.js"),
      entry("web/highcharts/themes/dark.js"),
    ];
    const { files: marked, marks } = await markThirdParty("/x", files, {
      readHeader: headers({
        "js/ckeditor/ckeditor.js": ck,
        "web/highcharts/modules/exporting.js": "/*\n Highcharts JS v4.2.5 (2016-05-06)\n Exporting module\n*/\n",
      }),
    });
    expect(reasons(marked)).toEqual({
      "js/ckeditor/ckeditor.js": "library CKEditor",
      "js/ckeditor/lang/en.js": "library CKEditor",
      "Classes/PHPExcel/Cell.php": "library PHPExcel",
      "web/highcharts/modules/exporting.js": "library Highcharts",
      "web/highcharts/themes/dark.js": "library Highcharts",
    });
    expect(marks).toEqual([
      { where: "Classes/PHPExcel", library: "PHPExcel", reason: "directory+entry", files: 1 },
      { where: "js/ckeditor", library: "CKEditor", reason: "directory+entry", files: 2 },
      { where: "web/highcharts", library: "Highcharts", reason: "directory+banner", files: 2 },
    ]);
  });

  it("reads a jQuery banner only in the shapes jQuery ships, not an application comment naming a version", async () => {
    const files = ["app/form.js", "app/old.js", "lib/jquery.min.js", "lib/jquery.js", "lib/jquery-ui.js"].map((p) => entry(p));
    const { files: marked } = await markThirdParty("/x", files, {
      readHeader: headers({
        "app/form.js": "// requires jQuery v1.7 or later\n$(function () {});\n",
        "app/old.js": "/* Works with jQuery v1.7.2 and up */\n",
        "lib/jquery.min.js": "/*! jQuery v1.7.2 | jquery.org/license */\n",
        "lib/jquery.js": "/*!\n * jQuery JavaScript Library v1.4.2\n * http://jquery.com/\n */\n",
        "lib/jquery-ui.js": "/*! jQuery UI - v1.12.1 - 2016-09-14\n* http://jqueryui.com */\n",
      }),
    });
    expect(Object.keys(reasons(marked)).sort()).toEqual(["lib/jquery-ui.js", "lib/jquery.js", "lib/jquery.min.js"]);
  });

  it("anchors the other version banners too", async () => {
    const loose = [
      "// charts drawn with Highcharts JS v4.2.5\n",
      "// built on Prototype JavaScript framework, version 1.7.1\n",
      "// effects from script.aculo.us\n",
      "/* thanks to The Dojo Foundation */\n",
    ];
    const real = [
      " * @license Highstock JS v9.3.2 (2021-11-29)\n",
      "/*  Prototype JavaScript framework, version 1.7.1\n",
      "// script.aculo.us effects.js v1.9.0, Thu Dec 23 16:54:48 -0500 2010\n",
      "/*\n\tCopyright (c) 2004-2011, The Dojo Foundation All Rights Reserved.\n*/\n",
    ];
    const files = [...loose, ...real].map((_, i) => entry(`f${i}/a.js`));
    const { files: marked } = await markThirdParty("/x", files, {
      readHeader: headers(Object.fromEntries([...loose, ...real].map((h, i) => [`f${i}/a.js`, h]))),
    });
    expect(Object.keys(reasons(marked)).sort()).toEqual(["f4/a.js", "f5/a.js", "f6/a.js", "f7/a.js"]);
  });

  it("groups header marks per folder, collapsing one library spread over many folders", async () => {
    const banner = "/*! jQuery v3.6.0 | (c) OpenJS Foundation */\n";
    const paths = ["a", "b", "c", "d", "e", "f"].map((d) => `js/${d}/jquery.min.js`).concat("lib/sdk/x.php");
    const { marks } = await markThirdParty("/x", paths.map((p) => entry(p)), {
      readHeader: headers({ ...Object.fromEntries(paths.slice(0, 6).map((p) => [p, banner])), "lib/sdk/x.php": "<?php\n/** @package AuthorizeNet */\n" }),
    });
    expect(marks).toEqual([
      { where: "lib/sdk", library: "AuthorizeNet SDK", reason: "header", files: 1 },
      { where: "", library: "jQuery", reason: "header", files: 6, folders: 6 },
    ]);
  });

  it("extends a library's banner to the rest of a directory it dominates, and no further", async () => {
    const files = ["a", "b", "c", "d", "e"].map((n) => entry(`lib/sdk/${n}.php`)).concat(entry("lib/own.php"));
    const banner = "<?php\n/** @package AuthorizeNet */\n";
    const { files: marked } = await markThirdParty("/x", files, {
      readHeader: headers({ "lib/sdk/a.php": banner, "lib/sdk/b.php": banner, "lib/sdk/c.php": banner, "lib/sdk/d.php": banner }),
    });
    expect(Object.keys(reasons(marked)).sort()).toEqual(["lib/sdk/a.php", "lib/sdk/b.php", "lib/sdk/c.php", "lib/sdk/d.php", "lib/sdk/e.php"]);
    expect(marked.find((f) => f.path === "lib/own.php")?.thirdParty).toBeUndefined();
  });

  it("clears a stale mark from a cached entry", async () => {
    const { files: marked } = await markThirdParty("/x", [entry("app/a.php", { thirdParty: "config old/**" })], { readHeader: headers({}) });
    expect(marked[0]).not.toHaveProperty("thirdParty");
  });
});

describe("describeThirdPartyMark", () => {
  it("names the folder, library and reason, and the deny glob that undoes a built-in mark", () => {
    expect(describeThirdPartyMark({ where: "js/ckeditor", library: "CKEditor", reason: "directory+entry", files: 2 })).toBe(
      '[third-party] js/ckeditor/: CKEditor (directory+entry), 2 files; undo with "!js/ckeditor/**" in sourcevision.thirdParty or --third-party',
    );
    expect(describeThirdPartyMark({ where: "", library: "jQuery", reason: "header", files: 6, folders: 6 })).toBe(
      '[third-party] 6 files in 6 folders: jQuery (header); undo one with "!<folder>/**" in sourcevision.thirdParty or --third-party',
    );
    expect(describeThirdPartyMark({ where: "lib/Sheet/**", reason: "config", files: 1 })).toBe("[third-party] lib/Sheet/** (config): 1 file");
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
