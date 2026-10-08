/**
 * Java language configuration.
 *
 * Covers Maven and Gradle projects (including multi-module layouts and
 * Spring Boot config). Inventory roles only; structure extraction arrives
 * with the Java pack's queries.
 *
 * @module sourcevision/language/java
 */

import type { LanguageConfig } from "./registry.js";

/**
 * Language config for Java projects.
 *
 * Notes:
 * - `target/` (Maven), `build/`, `out/` and `.gradle/` hold build output.
 * - `generated-sources/` and `generated/` hold Lombok, MapStruct and
 *   OpenAPI Generator output; they are skipped, and any that are reached
 *   are inventoried as `generated`.
 * - `entryPointPatterns` are path-only. A class is an entry point when it
 *   declares `public static void main`, which needs file content; until the
 *   structure queries land, the conventional file names stand in.
 */
export const javaConfig: LanguageConfig = {
  id: "java",
  displayName: "Java",

  extensions: new Set([".java"]),

  parseableExtensions: new Set([".java"]),

  testFilePatterns: [
    /(?:^|\/)src\/test\/java\//,
    /(?:Test|Tests|IT)\.java$/,
  ],

  configFilenames: new Set([
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradle.properties",
    "application.properties",
    "application.yml",
  ]),

  configFilePatterns: [
    /(?:^|\/)gradle\/libs\.versions\.toml$/,
    /(?:^|\/)application-[^/]+\.ya?ml$/,
  ],

  skipDirectories: new Set([
    "target",
    "build",
    "out",
    ".gradle",
    "generated-sources",
    "generated",
  ]),

  generatedFilePatterns: [
    /(?:^|\/)generated-sources\//,
    /(?:^|\/)generated\//,
  ],

  entryPointPatterns: [
    /(?:^|\/)[^/]*Application\.java$/,
    /(?:^|\/)Main\.java$/,
  ],

  moduleFile: "pom.xml",
};

/**
 * Java config for a repo whose primary language is another one (a Spring Boot
 * service bundling a TS frontend, say). Merging the full config would let
 * `out/`, `build/`, `generated/` and `generated-sources/` hide the primary
 * language's files (an OpenAPI-generated TS client under `generated/`), so
 * only the unambiguous build output stays skipped and no generated-file
 * patterns apply. A Java-primary repo keeps `javaConfig` unchanged.
 */
export const javaSecondaryConfig: LanguageConfig = {
  ...javaConfig,
  skipDirectories: new Set(["target", ".gradle"]),
  generatedFilePatterns: [],
};
