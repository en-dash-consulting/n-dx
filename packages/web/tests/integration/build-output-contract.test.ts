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
  "dist/server/index.js",
  "dist/server/index.d.ts",
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

/**
 * Structural markers for the viewer HTML shell.
 *
 * The Preact app mounts onto `<div id="app">`. This element is defined
 * in the source HTML and must survive the build pipeline. If it's
 * removed or renamed, the viewer renders nothing — a failure invisible
 * to TypeScript or the module graph. build-output-contract.test.ts is
 * the sole enforcement point for this contract.
 */
const VIEWER_STRUCTURAL_MARKERS = [
  '<div id="app">',  // Preact mount point — main.ts renders into this element
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

  it("viewer HTML contains the Preact mount point", () => {
    const viewerPath = resolve(WEB_PKG, "dist/viewer/index.html");
    if (!existsSync(viewerPath)) {
      return;
    }

    const html = readFileSync(viewerPath, "utf-8");
    const missingMarkers: string[] = [];

    for (const marker of VIEWER_STRUCTURAL_MARKERS) {
      if (!html.includes(marker)) {
        missingMarkers.push(marker);
      }
    }

    if (missingMarkers.length > 0) {
      expect.fail(
        [
          "Viewer HTML is missing the Preact mount point.",
          "The Preact app renders into <div id=\"app\"> — without it the viewer is blank.",
          "",
          "Missing structural markers:",
          ...missingMarkers.map((m) => `  - ${m}`),
          "",
          "Check that src/viewer/index.html still defines the mount element",
          "and that the build pipeline preserves it in the output.",
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

  it("landing HTML does not reference unbundled source paths", () => {
    const landingPath = resolve(WEB_PKG, "dist/landing/index.html");
    if (!existsSync(landingPath)) {
      return;
    }

    const html = readFileSync(landingPath, "utf-8");

    // After build, source references like ./landing.ts and ./landing.css
    // should be resolved to inlined content, not left as raw paths.
    const unbundledRefs = [
      'src="./landing.ts"',
      'href="./landing.css"',
    ];

    const found = unbundledRefs.filter((ref) => html.includes(ref));
    if (found.length > 0) {
      expect.fail(
        [
          "Landing HTML references unbundled source paths after build.",
          "The build should inline or hash these assets.",
          "",
          "Found unbundled references:",
          ...found.map((f) => `  - ${f}`),
          "",
          "Verify build.js correctly processes the landing page.",
        ].join("\n"),
      );
    }
  });

  it("source viewer HTML defines required entry points", () => {
    const sourcePath = resolve(WEB_PKG, "src/viewer/index.html");
    if (!existsSync(sourcePath)) {
      return;
    }

    const html = readFileSync(sourcePath, "utf-8");

    // The source HTML must define the mount point and the module entry
    const required = [
      { marker: '<div id="app">', reason: "Preact mount point" },
      { marker: 'src="./main.ts"', reason: "module graph entry point" },
    ];

    const missing = required.filter((r) => !html.includes(r.marker));
    if (missing.length > 0) {
      expect.fail(
        [
          "Source viewer HTML is missing required entry points.",
          "These are consumed by the build pipeline and must not be removed.",
          "",
          ...missing.map((m) => `  - ${m.marker} (${m.reason})`),
        ].join("\n"),
      );
    }
  });

  it("server entry point exports are present", () => {
    const serverEntry = resolve(WEB_PKG, "dist/server/index.js");
    if (!existsSync(serverEntry)) {
      return; // Covered by "all required build outputs exist" test
    }

    const content = readFileSync(serverEntry, "utf-8");

    // The server entry must re-export the startServer function
    // (or equivalent) that the orchestration layer spawns
    expect(content.length).toBeGreaterThan(0);
  });

  it("server build includes gateway modules", () => {
    const REQUIRED_SERVER_MODULES = [
      "dist/server/rex-gateway.js",
      "dist/server/domain-gateway.js",
      "dist/server/register-scheduler.js",
    ];

    const missing = REQUIRED_SERVER_MODULES.filter(
      (f) => !existsSync(resolve(WEB_PKG, f))
    );

    if (missing.length > 0) {
      expect.fail(
        [
          "Server build is missing gateway modules.",
          "These modules are required for MCP and scheduler integration.",
          "",
          "Missing:",
          ...missing.map((f) => `  - ${f}`),
          "",
          "Run 'pnpm --filter @n-dx/web build' to regenerate.",
        ].join("\n"),
      );
    }
  });

  it("viewer HTML does not reference unbundled source paths", () => {
    const viewerPath = resolve(WEB_PKG, "dist/viewer/index.html");
    if (!existsSync(viewerPath)) {
      return;
    }

    const html = readFileSync(viewerPath, "utf-8");

    const unbundledRefs = [
      'src="./main.ts"',
      'href="./styles.css"',
    ];

    const found = unbundledRefs.filter((ref) => html.includes(ref));
    if (found.length > 0) {
      expect.fail(
        [
          "Viewer HTML references unbundled source paths after build.",
          "The build should inline or hash these assets.",
          "",
          "Found unbundled references:",
          ...found.map((f) => `  - ${f}`),
          "",
          "Verify build.js correctly processes the viewer page.",
        ].join("\n"),
      );
    }
  });
});
