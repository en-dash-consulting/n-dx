/**
 * Docroot routes (`src/php-docroot.ts`) through the pack entry, over three
 * fixture sites: a flat PHP 5 site whose `admin/` is denied by `.htaccess`
 * (`php-docroot-flat`), a Drupal 7-style front controller
 * (`php-docroot-drupal7`) and a `public/index.php` app (`php-docroot-public`).
 * Skips when the grammar is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack } from "../../src/index.js";

const fixture = (name: string): string => join(import.meta.dirname, "..", "fixtures", name);

/** `METHOD path file (source)` for every route, sorted, and the notices. */
async function routes(name: string, kinds: Parameters<typeof pack.analyzeProject>[0]["kinds"] = ["routes"]) {
  const dir = fixture(name);
  const result = await pack.analyzeProject({ projectDir: dir, files: listFixtureFiles(dir, [...phpPack.config.extensions]), kinds });
  expect(result.degraded).toBeUndefined();
  const lines = result.facts.flatMap((f) => (f.routes ?? []).map((r) => `${r.method} ${r.path} ${f.path} (${r.source})`)).sort();
  return { lines, notices: result.notices ?? [] };
}

describe("php docroot routes", () => {
  it("routes every page of a flat site, leaving out fragments and what .htaccess denies", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const { lines, notices } = await routes("php-docroot-flat");
    expect(lines).toEqual([
      // admin/ is denied (`Deny from all`), its assets/ granted again (`Require all granted`).
      "GET /about.php about.php (docroot .)",
      "GET /admin/assets/logo.php admin/assets/logo.php (docroot .)",
      "GET /contact.phtml contact.phtml (docroot .)",
      "GET /index.php index.php (docroot .)",
      "POST /about.php about.php (docroot .)",
      "POST /admin/assets/logo.php admin/assets/logo.php (docroot .)",
      "POST /contact.phtml contact.phtml (docroot .)",
      "POST /index.php index.php (docroot .)",
    ]);
    // Left out: config.php (<Files> denial), private/ (RedirectMatch 403), inc/header.inc.php (name), inc/functions.php (declarations only).
    expect(notices).toEqual([]);
  });

  it("routes a Drupal 7 front controller as a catch-all, templates denied by <FilesMatch>", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const { lines, notices } = await routes("php-docroot-drupal7");
    // The pattern as written (`RewriteRule ^ index.php [L]`); the R=301 rule is a redirect, not a route.
    expect(lines).toEqual([
      "GET /cron.php cron.php (docroot .)",
      "GET /index.php index.php (docroot .)",
      "GET ^ index.php (.htaccess:29)",
      "POST /cron.php cron.php (docroot .)",
      "POST /index.php index.php (docroot .)",
      "POST ^ index.php (.htaccess:29)",
    ]);
    expect(notices).toEqual([]);
  });

  it("routes a public/ app's files and its FallbackResource, nothing outside public/", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const { lines } = await routes("php-docroot-public");
    expect(lines).toEqual([
      "GET /* public/index.php (public/.htaccess:2)",
      "GET /health.php public/health.php (docroot public)",
      "GET /index.php public/index.php (docroot public)",
      "POST /* public/index.php (public/.htaccess:2)",
      "POST /health.php public/health.php (docroot public)",
      "POST /index.php public/index.php (docroot public)",
    ]);
  });

  it("leaves guarded declaration files out, keeps guarded pages, and keeps Require ip pages with a notice", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const { lines, notices } = await routes("php-docroot-guarded");
    const files = [...new Set(lines.map((l) => l.split(" ")[2]))];
    // Left out, each guard followed only by declarations, use and require lines:
    // system/Model.php (`defined('BASEPATH') OR exit(...)`), components/com_shop/ShopController.php
    // (`\defined('_JEXEC') or die`), plugins/acme/acme.php and notice.php (`if (!defined('ABSPATH')) exit`),
    // and com_shop/CartView.php and router.php, whose guard follows a `use` line or a function.
    expect(files).toEqual([
      "admin/index.php",
      "admin/status/ping.php",
      "admin/users.php",
      "components/com_shop/checkout.php", // declarations, guard, then output
      "index.php",
      "lib/not-a-guard.php", // `or define(...)` is no guard
      "plugins/acme/settings.php", // guarded, then output
      "views/welcome.php", // guarded, then inline HTML
    ]);
    expect(lines).toContain("GET /admin/users.php admin/users.php (docroot .)");
    // admin/status/ grants everyone again, so only admin/'s two pages are restricted.
    expect(notices).toEqual([
      "PHP: admin/.htaccess:3 Require ip 127.0.0.1 10.0.0.0/8 serves admin/ only to the clients it names; its 2 files stay routes.",
    ]);
  });

  it("gives no routes when routes are not wanted", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect((await routes("php-docroot-public", ["imports"])).lines).toEqual([]);
  });
});
