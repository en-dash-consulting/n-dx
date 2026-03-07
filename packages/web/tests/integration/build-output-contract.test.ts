/**
 * Build output contract test.
 *
 * The web server (routes-static.ts) depends on specific file paths
 * produced by the build system (build.js). This coupling is invisible
 * to TypeScript — if build output names change, the server silently
 * fails to serve assets.
 *
 * This test codifies the contract: after `pnpm build`, the expected
 * output files must exist at their expected paths.
 *
 * @see packages/web/build.js — produces the build output
 * @see packages/web/src/server/routes-static.ts — consumes it
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_PKG = resolve(import.meta.dirname!, "../..");

/**
 * Build output files that the server depends on.
 *
 * These paths are relative to the web package root and mirror the
 * resolution logic in routes-static.ts (resolveStaticAssets).
 *
 * If build.js changes any of these paths, this test will fail,
 * forcing a coordinated update to both build.js and routes-static.ts.
 */
const REQUIRED_BUILD_OUTPUTS = [
  "dist/viewer/index.html",
  "dist/landing/index.html",
];

/**
 * Content markers that must appear in built HTML files.
 *
 * The build inlines JS and CSS into the HTML. The server serves
 * this HTML directly. If the build stops inlining, the server
 * would serve a broken page with unresolved <script>/<link> tags.
 */
const VIEWER_CONTENT_MARKERS = [
  "<script type=\"module\">",  // inlined JS
  "<style>",                   // inlined CSS
];

describe("build output contract", () => {
  it("all required build outputs exist", () => {
    const missing: string[] = [];

    for (const relPath of REQUIRED_BUILD_OUTPUTS) {
      const absPath = resolve(WEB_PKG, relPath);
      if (!existsSync(absPath)) {
        missing.push(relPath);
      }
    }

    if (missing.length > 0) {
      expect.fail(
        [
          "Required build outputs are missing. The web server depends on these files.",
          "Run 'pnpm --filter @n-dx/web build' to generate them.",
          "",
          "Missing files:",
          ...missing.map((f) => `  - ${f}`),
          "",
          "If build output paths have changed, update both:",
          "  - packages/web/build.js (output generation)",
          "  - packages/web/src/server/routes-static.ts (asset resolution)",
        ].join("\n"),
      );
    }
  });

  it("viewer HTML contains inlined JS and CSS", () => {
    const viewerPath = resolve(WEB_PKG, "dist/viewer/index.html");
    if (!existsSync(viewerPath)) {
      // Skip if build output doesn't exist — covered by previous test
      return;
    }

    const html = readFileSync(viewerPath, "utf-8");
    const missingMarkers: string[] = [];

    for (const marker of VIEWER_CONTENT_MARKERS) {
      if (!html.includes(marker)) {
        missingMarkers.push(marker);
      }
    }

    if (missingMarkers.length > 0) {
      expect.fail(
        [
          "Viewer HTML is missing expected inlined content.",
          "The build should inline JS and CSS into the HTML file.",
          "",
          "Missing markers:",
          ...missingMarkers.map((m) => `  - ${m}`),
          "",
          "If the build strategy has changed, update this contract test.",
        ].join("\n"),
      );
    }
  });

  it("landing HTML contains inlined JS and CSS", () => {
    const landingPath = resolve(WEB_PKG, "dist/landing/index.html");
    if (!existsSync(landingPath)) {
      return;
    }

    const html = readFileSync(landingPath, "utf-8");
    expect(html).toContain("<script type=\"module\">");
    expect(html).toContain("<style>");
  });
});
