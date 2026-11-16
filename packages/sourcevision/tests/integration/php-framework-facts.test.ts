/**
 * PHP docroot routes (the PHP pack's php-docroot rules) through the analyze
 * pipeline: the imports phase's single pack call collects them and the
 * components phase adds one serverRoutes group per handler file, each route
 * carrying its `source`. Without the PHP pack, components.json is what the
 * detectors alone produce.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { phpConfig, type FileFacts, type PackProjectRequest } from "@n-dx/lang-kit";
import { analyzeComponents } from "../../src/analyzers/components.js";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { KNOWN_PACKS, loadPack, type KnownPack } from "../../src/language/pack-loader.js";
import type { Inventory } from "../../src/schema/v1.js";
import { toCanonicalJSON } from "../../src/util/sort.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const PHP = KNOWN_PACKS.find((p) => p.id === phpConfig.id)!;

const FILES: Record<string, string> = {
  "index.php": "<?php include 'inc/functions.php'; ?>\n<h1>Shop</h1>\n",
  "cart.php": "<?php\nrequire 'inc/functions.php';\necho cart_total();\n",
  "inc/functions.php": "<?php\nfunction cart_total() { return 0; }\n",
  "admin/.htaccess": "Deny from all\n",
  "admin/index.php": "<?php\necho 'admin';\n",
  ".htaccess": "RewriteEngine On\nRewriteRule ^shop/(.*)$ index.php?path=$1 [L,QSA]\n",
};

/** The workspace PHP pack, recording each request it is sent. */
function countingPhp(requests: PackProjectRequest[]): KnownPack {
  return {
    ...PHP,
    importByResolution: async () => {
      const load = await loadPack(PHP, { packDir: join(tmpdir(), "sv-no-packs-here") });
      if (load.status !== "loaded") throw new Error(load.notice.reason);
      const entry = load.entry;
      return { pack: { ...entry, analyzeProject: (request: PackProjectRequest) => (requests.push(request), entry.analyzeProject(request)) } };
    },
  };
}

const NOT_INSTALLED_PHP: KnownPack = {
  ...PHP,
  importByResolution: () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-php' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
};

describe("PHP docroot routes in serverRoutes", () => {
  let dir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-php-routes-"));
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    inventory = await analyzeInventory(dir, { languageConfig: phpConfig });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** imports → components, as the analyze command chains them. */
  async function pipeline(php: KnownPack) {
    const facts: FileFacts[] = [];
    const imports = await analyzeImports(dir, inventory, {
      language: "php",
      packs: { packs: [php], warn: () => {}, framework: (f) => facts.push(...f) },
    });
    return { components: await analyzeComponents(dir, inventory, imports, { packFacts: facts }), imports };
  }

  it("asks the pack for routes in its one call and adds a group per handler file", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const requests: PackProjectRequest[] = [];
    const { components, imports } = await pipeline(countingPhp(requests));

    expect(requests).toHaveLength(1);
    expect(requests[0].kinds).toEqual(["imports", "routes"]);
    const route = (file: string, method: "GET" | "POST", path: string, source: string) => ({ file, method, path, source });
    expect(components.serverRoutes).toEqual([
      { file: "cart.php", prefix: "/", routes: [route("cart.php", "GET", "/cart.php", "docroot ."), route("cart.php", "POST", "/cart.php", "docroot .")] },
      {
        file: "index.php",
        prefix: "/",
        routes: [
          route("index.php", "GET", "/index.php", "docroot ."),
          route("index.php", "GET", "^shop/(.*)$", ".htaccess:2"),
          route("index.php", "POST", "/index.php", "docroot ."),
          route("index.php", "POST", "^shop/(.*)$", ".htaccess:2"),
        ],
      },
    ]);
    expect(components.summary.totalServerRoutes).toBe(6);

    // Only serverRoutes and its count differ from the detectors alone.
    const alone = await analyzeComponents(dir, inventory, imports);
    expect({ ...components, serverRoutes: alone.serverRoutes, summary: { ...components.summary, totalServerRoutes: alone.summary.totalServerRoutes } }).toEqual(
      alone,
    );
  });

  it("leaves components.json byte-identical without the PHP pack", async () => {
    const { components, imports } = await pipeline(NOT_INSTALLED_PHP);
    expect(toCanonicalJSON(components)).toBe(toCanonicalJSON(await analyzeComponents(dir, inventory, imports)));
    expect(components.serverRoutes).toEqual([]);
  });
});
