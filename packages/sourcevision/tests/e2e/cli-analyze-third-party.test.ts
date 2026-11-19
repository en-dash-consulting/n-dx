/**
 * Copied-in third-party code is marked once and left out of the map. An
 * invented PHP application carries a hand-copied JS framework (its files carry
 * the framework's public version banner), a library under a configured glob
 * and one passed on the command line; `sv analyze --fast` marks all three in
 * inventory.json and keeps them out of zones, classifications, the call graph,
 * the primary language and readiness evidence, while the application's import
 * of the framework still resolves. Needs no language pack.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");

const BANNER = "/*\nCopyright (c) 2010, Yahoo! Inc. All rights reserved.\nCode licensed under the BSD License.\nversion: 3.3.0\nbuild: 3167\n*/\n";

const FILES: Record<string, string> = {
  ".n-dx.json": JSON.stringify({ sourcevision: { thirdParty: ["js/widgets/**"] } }),
  "app/index.php": "<?php\nrequire 'app/lib.php';\necho page();\n",
  "app/lib.php": "<?php\nfunction page() { return 'ok'; }\n",
  "app/report.php": "<?php\nfunction report() { return 1; }\n",
  "app/admin.php": "<?php\nfunction admin() { return 2; }\n",
  "app/main.js": "import { node } from '../js/build/node/node.js';\nexport function start() { return node(); }\n",
  "app/view.js": "import { start } from './main.js';\nexport function view() { return start(); }\n",
  "js/build/node/node.js": `${BANNER}export function node() { return dom(); }\nfunction dom() { return 1; }\n`,
  "js/build/dom/dom.js": `${BANNER}export function dom() { return 2; }\n`,
  "js/build/event/event.js": `${BANNER}export function on() { return 3; }\n`,
  "js/build/tests/node.test.js": `${BANNER}import { node } from '../node/node.js';\ndescribe('node', () => { it('works', () => node()); });\n`,
  "js/widgets/grid.js": "export function grid() { return 4; }\n",
  "js/widgets/tree.js": "export function tree() { return 5; }\n",
  "js/charts/line.js": "export function line() { return 6; }\n",
  // The application's own integration code in a folder named like a library: no banner, no entry file.
  "app/ckeditor/plugin.js": "// requires jQuery v1.7 or later\nexport function plugin() { return 7; }\n",
};

describe("sv analyze --fast leaves copied-in third-party code out of the map", { timeout: 120_000 }, () => {
  let dir: string;
  let output: string;
  let status: number | null;
  const json = (file: string) => JSON.parse(readFileSync(join(dir, ".sourcevision", file), "utf-8"));

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-third-party-"));
    for (const [path, content] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    const run = spawnSync(process.execPath, [CLI_PATH, "analyze", dir, "--fast", "--third-party=js/charts/**"], { encoding: "utf-8", timeout: 90_000 });
    status = run.status;
    output = `${run.stdout}${run.stderr}`;
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("marks each file with its reason and logs the count", () => {
    expect(status, output).toBe(0);
    const inventory = json("inventory.json");
    const marks = Object.fromEntries(inventory.files.filter((f: { thirdParty?: string }) => f.thirdParty).map((f: { path: string; thirdParty: string }) => [f.path, f.thirdParty]));
    expect(marks).toEqual({
      "js/build/dom/dom.js": "library YUI",
      "js/build/event/event.js": "library YUI",
      "js/build/node/node.js": "library YUI",
      "js/build/tests/node.test.js": "library YUI",
      "js/charts/line.js": "cli js/charts/**",
      "js/widgets/grid.js": "config js/widgets/**",
      "js/widgets/tree.js": "config js/widgets/**",
    });
    expect(inventory.summary.thirdParty).toEqual({ files: 7, byReason: { "cli js/charts/**": 1, "config js/widgets/**": 2, "library YUI": 4 } });
    expect(output).toContain("7 files marked third-party (library YUI 4, config js/widgets/** 2, cli js/charts/** 1)");
    expect(output).toContain('[third-party] js/build/node/: YUI (header), 1 file; undo with "!js/build/node/**" in sourcevision.thirdParty or --third-party');
    expect(output).toContain("[third-party] js/widgets/** (config): 2 files");
    expect(output).toContain("[third-party] js/charts/** (flag): 1 file");
    expect(output).not.toContain("[third-party] app/");
  });

  it("keeps the application's import of the framework but leaves the framework out of zones", () => {
    const imports = json("imports.json");
    expect(imports.edges.some((e: { from: string; to: string }) => e.from === "app/main.js" && e.to === "js/build/node/node.js")).toBe(true);
    const zoned = json("zones.json").zones.flatMap((z: { files: string[]; entryPoints: string[] }) => [...z.files, ...z.entryPoints]);
    expect(zoned.filter((p: string) => p.startsWith("js/"))).toEqual([]);
  });

  it("leaves it out of classifications, the call graph, the primary language and readiness evidence", () => {
    expect(json("classifications.json").files.map((f: { path: string }) => f.path).filter((p: string) => p.startsWith("js/"))).toEqual([]);
    const callgraph = json("callgraph.json");
    expect(callgraph.functions.map((f: { file: string }) => f.file).filter((p: string) => p.startsWith("js/"))).toEqual([]);
    expect(output).toContain("third-party files left out of the call graph");
    expect(json("project-profile.json").primaryLanguage).toBe("php");
    expect(JSON.stringify(json("sdlc-profile.json"))).not.toContain("js/build/tests");
  });
});

describe("sv analyze --fast counts a mirrored folder once", { timeout: 120_000 }, () => {
  let dir: string;
  let output: string;
  const json = (file: string) => JSON.parse(readFileSync(join(dir, ".sourcevision", file), "utf-8"));

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-mirror-"));
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    };
    // app/ is a small JS app; edit/ is its copy with two modules edited.
    for (let i = 0; i < 12; i++) {
      const body = `import { m${(i + 1) % 12} } from './m${(i + 1) % 12}.js';\nexport function m${i}() { return ${i}; }\n`;
      write(`app/src/m${i}.js`, body);
      write(`edit/src/m${i}.js`, i < 2 ? body.replace(`return ${i}`, `return ${i} + 100`) : body);
    }
    const run = spawnSync(process.execPath, [CLI_PATH, "analyze", dir, "--fast"], { encoding: "utf-8", timeout: 90_000 });
    output = `${run.stdout}${run.stderr}`;
    expect(run.status, output).toBe(0);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("marks the identical copies, logs the pair and keeps them out of zones and classifications", () => {
    const inventory = json("inventory.json");
    expect(inventory.summary.mirrored).toEqual({ files: 10, byReason: { "edit/ mirrors app/": 10 } });
    expect(output).toContain("[mirror] edit/ mirrors app/: 10 of 12 files identical (83%); counted once");
    const zoned = json("zones.json").zones.flatMap((z: { files: string[] }) => z.files);
    expect(zoned.filter((p: string) => p.startsWith("edit/")).sort()).toEqual(["edit/src/m0.js", "edit/src/m1.js"]);
    const classified = json("classifications.json").files.map((f: { path: string }) => f.path);
    expect(classified.filter((p: string) => p.startsWith("edit/")).sort()).toEqual(["edit/src/m0.js", "edit/src/m1.js"]);
  });
});
