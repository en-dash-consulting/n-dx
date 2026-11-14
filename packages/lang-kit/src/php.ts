/**
 * PHP language configuration.
 *
 * Defines extensions, skip directories, test file patterns, config filenames,
 * and entry points specific to PHP projects.
 *
 * @module lang-kit/php
 */

import type { LanguageConfig } from "./registry.js";

/**
 * PHP extensions that other ecosystems use too: `.inc` (Pascal, assembly,
 * C includes), `.module` and `.install` (Drupal's PHP, but also unrelated
 * tools). They are PHP only in a repository detected as PHP: they are in
 * `phpConfig.extensions`, so they reach an inventory only when `phpConfig` is
 * one of its configs, and detection never counts them.
 */
export const PHP_REPOSITORY_ONLY_EXTENSIONS: ReadonlySet<string> = new Set([".inc", ".module", ".install"]);

/**
 * Document-root directories a legacy PHP site keeps all its code under, with
 * nothing PHP at the repository root. An `index.php` directly inside one is
 * the same weak PHP marker a `.php` file at the root is.
 */
export const PHP_DOCROOT_DIRECTORIES: readonly string[] = ["public", "web", "htdocs", "www", "public_html"];

/**
 * Language config for PHP projects.
 *
 * Key PHP-specific behaviors:
 * - `.inc`, `.module` and `.install` count as PHP only in a repository
 *   detected as PHP (see {@link PHP_REPOSITORY_ONLY_EXTENSIONS}).
 * - `vendor/` is skipped only beside a `composer.json` (`skipOnlyBeside`):
 *   legacy repositories commit hand-copied libraries under `vendor/` without
 *   Composer, and those are source to inventory.
 * - `.phpunit.cache/`, `cache/` and `tmp/` are skipped only when they directly
 *   hold no `.php` file (`skipUnlessContains`), as Python's `env/` is skipped
 *   only when it is not a package.
 * - `*Test.php`, `*_test.php` and `tests/` / `test/` identify test files.
 * - `composer.json` is the module manifest.
 *
 * - `.php`, `.phtml`, `.php3`–`.php5` and `.inc` are parseable, but only by the
 *   opt-in `@n-dx/lang-php` pack: SourceVision has no other PHP parser, so
 *   without the pack PHP files are inventoried and classified only.
 */
export const phpConfig: LanguageConfig = {
  id: "php",
  displayName: "PHP",

  extensions: new Set([".php", ".phtml", ".php3", ".php4", ".php5", ...PHP_REPOSITORY_ONLY_EXTENSIONS]),

  parseableExtensions: new Set([".php", ".phtml", ".php3", ".php4", ".php5", ".inc"]),

  testFilePatterns: [
    /(?:^|\/)tests?\//,
    /Test\.php$/,
    /_test\.php$/,
    /(?:^|\/)phpunit\.xml(?:\.dist)?$/,
  ],

  configFilenames: new Set([
    "composer.json",
    "composer.lock",
    "php.ini",
    ".htaccess",
    "phpunit.xml",
    "phpunit.xml.dist",
  ]),

  skipDirectories: new Set(),

  skipUnlessContains: new Map([".phpunit.cache", "cache", "tmp"].map((name) => [name, ["*.php"]])),

  skipOnlyBeside: new Map([["vendor", ["composer.json"]]]),

  generatedFilePatterns: [],

  entryPointPatterns: [
    /^index\.php$/,
    /^public\/index\.php$/,
    /^web\/index\.php$/,
    /^htdocs\/index\.php$/,
  ],

  moduleFile: "composer.json",
};
