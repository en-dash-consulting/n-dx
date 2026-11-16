/**
 * Config reads and flag checks (`src/php-config.ts`) through the pack entry,
 * over `php-config`: PHP 5 `define()` flags and settings, a CodeIgniter-style
 * `$config` array, a returned settings array, ini/yaml/xml loaders,
 * host-selected tenant files, and LaunchDarkly, Unleash, helper and registry
 * checks. Skips when the grammar is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-config");

async function analyze(kinds: Parameters<typeof pack.analyzeProject>[0]["kinds"] = ["configReads", "flagChecks"]) {
  const result = await pack.analyzeProject({ projectDir: dir, files: listFixtureFiles(dir, [...phpPack.config.extensions]), kinds });
  expect(result.degraded).toBeUndefined();
  return result;
}

const sorted = <T extends { path: string }>(facts: readonly T[]): T[] => [...facts].sort((a, b) => (a.path < b.path ? -1 : 1));

/** `file:line name → normalized mechanism [client] gated a-b` for every flag check. */
async function flags(): Promise<string[]> {
  return sorted((await analyze()).facts).flatMap((f) =>
    (f.flagChecks ?? []).map(
      (c) => `${f.path}:${c.position.line} ${c.name} → ${c.normalized} ${c.mechanism}${c.client ? ` ${c.client}` : ""}${c.gated ? ` gated ${c.gated.start}-${c.gated.end}` : ""}`,
    ),
  );
}

/** `file:line key source [sourceFile]` for every config read. */
async function reads(): Promise<string[]> {
  return sorted((await analyze()).facts).flatMap((f) =>
    (f.configReads ?? []).map((r) => `${f.path}:${r.position.line} ${r.key} ${r.source}${r.sourceFile ? ` ${r.sourceFile}` : ""}`),
  );
}

describe("php config reads and flag checks", () => {
  it("reports constant, config, helper, SDK and env flag checks with the lines they gate", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect(await flags()).toEqual([
      // CodeIgniter's registry read in an `if`.
      "application/controllers/Shop.php:6 enable_hooks → enable_hooks config gated 6-8",
      // Inside isset() still counts; both reads of the key are checks.
      "application/libraries/Cart.php:4 features.wishlist → wishlist config gated 4-6",
      "application/libraries/Cart.php:4 features.wishlist → wishlist config gated 4-6",
      // A flag-like constant: the `if` gates its body through `else`.
      "checkout.php:4 FEATURE_NEW_CHECKOUT → new_checkout constant gated 4-10",
      // Defined with a boolean, negated, in an `elseif`: to the end of its `if`.
      "checkout.php:6 LEGACY_REPORTS → legacy_reports constant gated 6-10",
      // defined() of a flag-like name, as a ternary's condition.
      "checkout.php:13 FF_HOLIDAY_BANNER → holiday_banner constant gated 13-13",
      "checkout.php:14 FEATURE_DARK_MODE → dark_mode env getenv gated 14-16",
      // A single-statement `if`.
      "checkout.php:17 ENABLE_AUDIT → enable_audit env $_ENV gated 17-17",
      // A returned settings array read through the include's variable.
      "search.php:4 features.new_search → new_search config gated 4-4",
      // LaunchDarkly, imported; Unleash, built: a check whose result is stored gates nothing.
      "src/Flags.php:11 new-pricing → new_pricing sdk LaunchDarkly gated 11-13",
      "src/Flags.php:15 beta_dashboard → beta_dashboard sdk Unleash",
      "src/Flags.php:16 features.export → export config gated 16-18",
      "src/Flags.php:19 legacy-import → legacy_import function isFeatureEnabled",
      "src/Flags.php:19 quick_view → quick_view function ->isActive",
    ]);
    // Not flags: `defined('IN_SHOP')`, an include guard, and FEATURE_NEW_CHECKOUT passed to in_array() (checkout.php).
  });

  it("reports settings files, loaders and config constants with their consumers", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect(await reads()).toEqual([
      // A `$config[…]` settings file holds its leaf keys, nested arrays dotted.
      "application/config/config.php:3 base_url file application/config/config.php",
      "application/config/config.php:4 enable_hooks file application/config/config.php",
      "application/config/config.php:6 features.wishlist file application/config/config.php",
      "application/config/config.php:7 features.reviews.moderated file application/config/config.php",
      // A registry key held by one settings file.
      "application/controllers/Shop.php:6 enable_hooks file application/config/config.php",
      "application/controllers/Shop.php:9 base_url file application/config/config.php",
      // A consumer that includes the settings file; a key no included file holds is unknown.
      "application/libraries/Cart.php:4 features.wishlist file application/config/config.php",
      "application/libraries/Cart.php:4 features.wishlist file application/config/config.php",
      "application/libraries/Cart.php:7 base_url file application/config/config.php",
      "application/libraries/Cart.php:8 smtp_host unknown",
      // Reads of constants a settings file defines, wherever they are read.
      "checkout.php:4 FEATURE_NEW_CHECKOUT define includes/configure.php",
      "checkout.php:6 LEGACY_REPORTS define includes/configure.php",
      "checkout.php:12 DB_SERVER define includes/configure.php",
      "checkout.php:20 FEATURE_NEW_CHECKOUT define includes/configure.php",
      // Host-selected tenant files are settings files.
      "config/tenant-a.example.com.php:2 dsn file config/tenant-a.example.com.php",
      "config/tenant-a.example.com.php:3 TENANT_NAME define config/tenant-a.example.com.php",
      "config/tenant-b.example.com.php:2 dsn file config/tenant-b.example.com.php",
      // define() in a file named as configuration.
      "includes/configure.php:3 FEATURE_NEW_CHECKOUT define includes/configure.php",
      "includes/configure.php:4 LEGACY_REPORTS define includes/configure.php",
      "includes/configure.php:5 DB_SERVER define includes/configure.php",
      "includes/configure.php:6 DIR_WS_IMAGES define includes/configure.php",
      // A returned array's keys, read through `$cfg = require …`.
      "search.php:3 app.name file settings.php",
      "search.php:4 features.new_search file settings.php",
      // Loaders with a computable path; the ini load's variable gives keys. A path held in a variable is not followed.
      "search.php:6 * ini conf/app.ini",
      "search.php:7 timeout ini conf/app.ini",
      "search.php:8 * yaml conf/app.yml",
      "settings.php:3 app.name file settings.php",
      "settings.php:3 app.debug file settings.php",
      "settings.php:4 features.new_search file settings.php",
      // No settings file holds features.export (nor features.php holds export).
      "src/Flags.php:16 features.export unknown",
      // The host-selected include reads each candidate whole, and the keys come from them.
      "tenant.php:3 * file config/tenant-a.example.com.php",
      "tenant.php:3 * file config/tenant-b.example.com.php",
      "tenant.php:4 dsn file config/tenant-a.example.com.php",
      "tenant.php:4 dsn file config/tenant-b.example.com.php",
    ]);
  });

  it("counts the tenant config sources in a php-host-include notice", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect((await analyze()).notices).toContain(
      "PHP: [php-host-include] 2 files chosen by the request's host name are tenant config sources: config/tenant-a.example.com.php, config/tenant-b.example.com.php.",
    );
  });

  it("records no value", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const json = JSON.stringify((await analyze()).facts.map(({ path, configReads, flagChecks }) => ({ path, configReads, flagChecks })));
    for (const value of ["db.internal", "images/", "https://shop.example.com/", "a.db", "mysql:host", "Shop'", "30", "true", "TRUE", "false", "FALSE"]) {
      expect(json).not.toContain(value);
    }
  });

  it("returns only the kinds asked for", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const onlyFlags = await analyze(["flagChecks"]);
    expect(onlyFlags.facts.some((f) => f.configReads !== undefined)).toBe(false);
    expect(onlyFlags.facts.some((f) => f.flagChecks !== undefined)).toBe(true);
    const neither = await analyze(["imports"]);
    expect(neither.facts.some((f) => f.configReads !== undefined || f.flagChecks !== undefined)).toBe(false);
  });
});
