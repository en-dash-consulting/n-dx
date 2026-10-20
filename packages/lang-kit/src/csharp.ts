/**
 * C# language configuration.
 *
 * `.cs` files are resolved by `analyzers/csharp-imports.ts` through declared
 * types and `using` directives. ASP.NET WebForms markup (`.aspx`, `.ascx`,
 * `.ashx`, `.asmx`, `.master`) is parsed by the same resolver for its
 * `<%@ … %>` directives, which link a page to its code-behind, its master
 * page and the user controls it registers.
 *
 * @module lang-kit/csharp
 */

import type { LanguageConfig } from "./registry.js";

/** ASP.NET WebForms markup that carries `<%@ … %>` directives. */
export const WEBFORMS_EXTENSIONS: ReadonlySet<string> = new Set([".aspx", ".ascx", ".ashx", ".asmx", ".master"]);

export const csharpConfig: LanguageConfig = {
  id: "csharp",
  displayName: "C#",

  extensions: new Set([".cs", ...WEBFORMS_EXTENSIONS]),

  parseableExtensions: new Set([".cs", ...WEBFORMS_EXTENSIONS]),

  testFilePatterns: [
    /(?:^|\/)[^/]*\.Tests?\//,
    /(?:^|\/)Tests?\//,
    /Tests?\.cs$/,
  ],

  configFilenames: new Set([
    "Web.config",
    "web.config",
    "App.config",
    "app.config",
    "packages.config",
    "global.json",
    "nuget.config",
    "NuGet.config",
    "Directory.Build.props",
    "Directory.Build.targets",
    "Directory.Packages.props",
    "appsettings.json",
  ]),

  skipDirectories: new Set([
    "bin",
    "obj",
    "packages",       // NuGet packages folder (packages.config projects)
    ".vs",
    "TestResults",
  ]),

  generatedFilePatterns: [
    /\.Designer\.cs$/,
    /\.designer\.cs$/,
    /\.g\.cs$/,
    /\.g\.i\.cs$/,
    /(?:^|\/)AssemblyInfo\.cs$/,
    /(?:^|\/)Reference\.cs$/,  // WCF / web service proxies
  ],

  entryPointPatterns: [
    /(?:^|\/)Program\.cs$/,
    /(?:^|\/)Startup\.cs$/,
    /(?:^|\/)Global\.asax\.cs$/,
  ],
};
