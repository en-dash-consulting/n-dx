/**
 * PHP docroot routes (the PHP pack's php-docroot rules) and outbound calls
 * (its php-outbound rules) through the analyze pipeline: the imports phase's
 * single pack call collects them, the components phase adds one serverRoutes
 * group per handler file, each route carrying its `source`, and outbound.json
 * gains one dependency per call. Without the PHP pack, components.json and
 * outbound.json are what the detectors alone produce.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { phpConfig, type FileFacts, type PackProjectRequest } from "@n-dx/lang-kit";
import { analyzeComponents } from "../../src/analyzers/components.js";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { detectOutbound } from "../../src/analyzers/outbound-detection.js";
import { withPackOutbound } from "../../src/analyzers/pack-framework-facts.js";
import { KNOWN_PACKS, loadPack, type KnownPack } from "../../src/language/pack-loader.js";
import type { Inventory } from "../../src/schema/v1.js";
import { toCanonicalJSON } from "../../src/util/sort.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const PHP = KNOWN_PACKS.find((p) => p.id === phpConfig.id)!;

const FILES: Record<string, string> = {
  "index.php": "<?php include 'inc/functions.php'; ?>\n<h1>Shop</h1>\n",
  "cart.php": "<?php\nrequire 'inc/functions.php';\necho cart_total();\n",
  "inc/functions.php": "<?php\nfunction cart_total() { return 0; }\n",
  // `.inc.php`: a fragment, not a route.
  "inc/rates.inc.php":
    "<?php\n$ch = curl_init('https://rates.example.com/latest');\n$host = getenv('DB_HOST');\n$self = $_SERVER['PHP_SELF'];\n" +
    "$db = new PDO('mysql:host=db.internal;dbname=shop');\n$cache = new Redis();\n$cache->connect('cache.internal', 6379);\n",
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

  /** imports → components → outbound, as the analyze command chains them. */
  async function pipeline(php: KnownPack) {
    const facts: FileFacts[] = [];
    const imports = await analyzeImports(dir, inventory, {
      language: "php",
      packs: { packs: [php], warn: () => {}, framework: (f) => facts.push(...f) },
    });
    const components = await analyzeComponents(dir, inventory, imports, { packFacts: facts });
    const outbound = withPackOutbound(await detectOutbound(dir, inventory), inventory, facts);
    return { components, outbound, imports };
  }

  it("asks the pack for routes in its one call and adds a group per handler file", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const requests: PackProjectRequest[] = [];
    const { components, imports } = await pipeline(countingPhp(requests));

    expect(requests).toHaveLength(1);
    expect(requests[0].kinds).toEqual(["imports", "routes", "outboundCalls", "entryPoints"]);
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

  it("adds one outbound dependency per PHP call (HTTP, env, database, cache), request keys of $_SERVER left out", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const { outbound } = await pipeline(countingPhp([]));
    const detected = await detectOutbound(dir, inventory);
    expect(detected.dependencies).toEqual([]);
    expect(outbound.contracts).toEqual(detected.contracts);
    expect(outbound.dependencies).toEqual([
      {
        file: "inc/rates.inc.php",
        line: 2,
        kind: "http",
        target: "https://rates.example.com/latest",
        targetSource: "literal",
        client: "curl",
        confidence: "certain",
      },
      { file: "inc/rates.inc.php", line: 3, kind: "env", target: "DB_HOST", targetSource: "env", client: "getenv", confidence: "certain" },
      { file: "inc/rates.inc.php", line: 5, kind: "database", target: "db.internal", targetSource: "literal", client: "pdo_mysql", confidence: "certain" },
      { file: "inc/rates.inc.php", line: 7, kind: "cache", target: "cache.internal:6379", targetSource: "literal", client: "redis", confidence: "certain" },
    ]);
  });

  it("leaves components.json and outbound.json byte-identical without the PHP pack", async () => {
    const { components, outbound, imports } = await pipeline(NOT_INSTALLED_PHP);
    expect(toCanonicalJSON(components)).toBe(toCanonicalJSON(await analyzeComponents(dir, inventory, imports)));
    expect(toCanonicalJSON(outbound)).toBe(toCanonicalJSON(await detectOutbound(dir, inventory)));
    expect(components.serverRoutes).toEqual([]);
  });
});
