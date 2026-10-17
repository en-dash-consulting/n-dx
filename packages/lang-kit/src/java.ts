/**
 * Java language configuration.
 *
 * Covers Maven and Gradle projects (including multi-module layouts and
 * Spring Boot config). Inventory roles only; structure extraction arrives
 * with the Java pack's queries.
 *
 * @module lang-kit/java
 */

import type { LanguageConfig } from "./registry.js";

/** The build files that make a directory a Java module root. */
const JAVA_MODULE_MARKERS: readonly string[] = ["pom.xml", "build.gradle", "build.gradle.kts"];

/**
 * Language config for Java projects.
 *
 * Notes:
 * - `target/` (Maven), `build/` (Gradle), `out/` (IDE) and `generated/` are
 *   build output only beside a build file or at the project root
 *   (`skipBesideMarker`); below `src/` they are packages
 *   (`org.springframework.aop.target`) and are inventoried.
 * - `.gradle/` and `generated-sources/` are always skipped. Lombok, MapStruct
 *   and OpenAPI Generator output under `generated-sources/` or a `generated/`
 *   that is reached is inventoried as `generated`.
 * - `entryPointPatterns` is empty. A class is an entry point when it
 *   declares `public static void main`, which a file name cannot show; the
 *   Java pack's `entry_point.main` rule (sourcevision's
 *   `queries/java/methods.scm`) reports those methods instead.
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

  skipDirectories: new Set([".gradle", "generated-sources"]),

  skipBesideMarker: new Map(
    ["target", "build", "out", "generated"].map((name) => [name, JAVA_MODULE_MARKERS]),
  ),

  generatedFilePatterns: [
    /(?:^|\/)generated-sources\//,
    /(?:^|\/)generated\//,
  ],

  entryPointPatterns: [],

  moduleFile: "pom.xml",
};

/**
 * Java config for a repo whose primary language is another one (a Spring Boot
 * service bundling a TS frontend, say). Merging the full config would let
 * `out/`, `build/`, `generated/` and `generated-sources/` hide the primary
 * language's files (an OpenAPI-generated TS client under `generated/`), so
 * only `target/` (beside a build file or at the root) and `.gradle/` stay
 * skipped and no generated-file patterns apply. A Java-primary repo keeps `javaConfig` unchanged.
 */
export const javaSecondaryConfig: LanguageConfig = {
  ...javaConfig,
  skipDirectories: new Set([".gradle"]),
  skipBesideMarker: new Map([["target", JAVA_MODULE_MARKERS]]),
  generatedFilePatterns: [],
};
