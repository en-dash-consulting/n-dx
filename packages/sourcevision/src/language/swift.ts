/**
 * Swift language configuration.
 *
 * Drives source-file discovery (phase 1 inventory) and the import-parser
 * gate (phase 2). Without this config, `.swift` files are filtered out of
 * `parseableExtensions` and never reach the Swift import resolver, leaving
 * the import graph empty and zone detection falling back to file-tree
 * proximity.
 *
 * @module sourcevision/language/swift
 */

import type { LanguageConfig } from "./registry.js";

export const swiftConfig: LanguageConfig = {
  id: "swift",
  displayName: "Swift",

  extensions: new Set([".swift"]),

  parseableExtensions: new Set([".swift"]),

  testFilePatterns: [
    // XCTest convention: `*Tests.swift` in a `Tests/` directory.
    /(?:^|\/)Tests\//,
    /Tests\.swift$/,
    // Swift Testing convention: `@Test` annotations live in any file but
    // file naming typically still follows the *Tests pattern above.
    /Spec\.swift$/,
  ],

  configFilenames: new Set([
    "Package.swift",
    "Package.resolved",
    ".swiftpm",
    "Podfile",
    "Podfile.lock",
    "Cartfile",
    "Cartfile.resolved",
    "Makefile",
    "project.yml",       // XcodeGen
    "project.pbxproj",   // Xcode project
  ]),

  skipDirectories: new Set([
    ".build",            // SPM build output
    "DerivedData",       // Xcode build cache
    "Pods",              // CocoaPods dependencies
    "Carthage",          // Carthage dependencies
    ".swiftpm",          // SPM metadata
    "build",
    "dist",
  ]),

  generatedFilePatterns: [
    /\.generated\.swift$/,
    /Generated\/.+\.swift$/,
  ],

  entryPointPatterns: [
    // App entry — `@main` lives in the file but we surface the conventional
    // names that hold it.
    /(?:^|\/)App\.swift$/,
    /(?:^|\/)main\.swift$/,
  ],

  moduleFile: "Package.swift",
};
