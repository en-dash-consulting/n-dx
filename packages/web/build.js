import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watchMode = process.argv.includes("--watch");
const viewerOnly = process.argv.includes("--viewer-only");
const landingOnly = process.argv.includes("--landing-only");

const jsEntryPoint = resolve(__dirname, "src/viewer/main.ts");
const cssEntryPoint = resolve(__dirname, "src/viewer/styles/index.css");
const htmlTemplatePath = resolve(__dirname, "src/viewer/index.html");
const outDir = resolve(__dirname, "dist/viewer");

// ── Hub session drawer entry points ───────────────────────────────────────────
// The drawer-only page the hub home frames (src/viewer/hub-session.ts). Part of
// the viewer — same components, same tokens — but its own page, so the hub home
// stays server-rendered with no Preact. Built beside dist/viewer/index.html.
const hubSessionJsEntryPoint = resolve(__dirname, "src/viewer/hub-session.ts");
const hubSessionCssEntryPoint = resolve(__dirname, "src/viewer/hub-session.css");
const hubSessionHtmlTemplatePath = resolve(__dirname, "src/viewer/hub-session.html");

// ── Landing page entry points ─────────────────────────────────────────────────
// The landing page is a self-contained vanilla-JS feature with no Preact
// dependency.  All source files (landing.ts, landing.css, index.html) are
// co-located in src/landing/ so a single zone owns the full feature boundary.
// Build-time coupling is limited to this build script — there are no runtime
// imports between the landing page and the dashboard viewer.
const landingJsEntryPoint = resolve(__dirname, "src/landing/landing.ts");
const landingCssEntryPoint = resolve(__dirname, "src/landing/landing.css");
const landingHtmlTemplatePath = resolve(__dirname, "src/landing/index.html");
const landingOutDir = resolve(__dirname, "dist/landing");

const commonJsOptions = {
  entryPoints: [jsEntryPoint],
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  define: {
    "process.env.NODE_ENV": watchMode ? '"development"' : '"production"',
  },
};

/**
 * A page template with its stylesheet link and module script replaced by the
 * bundled CSS and JS, inline. Function replacements, so a `$` in either bundle
 * is copied as it is rather than read as a replacement pattern.
 */
function inlineTemplate(templatePath, { cssLink, scriptTag, cssCode, jsCode }) {
  return readFileSync(templatePath, "utf-8")
    .replace(cssLink, () => `<style>${cssCode}</style>`)
    .replace(scriptTag, () => `<script type="module">${jsCode}</script>`);
}

/** Bundle one CSS entry point to a string, minified outside watch mode. */
async function bundleCssEntry(entryPoint) {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    minify: !watchMode,
  });
  return result.outputFiles[0].text;
}

/**
 * An esbuild plugin that rewrites a page after every successful rebuild of its
 * JS, for watch mode. `rebuild` receives the new JS; `done` and `failed` are
 * the log lines for each outcome.
 */
function rebuildPagePlugin(name, rebuild, done, failed) {
  return {
    name,
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) return;
        try {
          await rebuild(result.outputFiles?.[0]?.text ?? "");
          console.log(done);
        } catch (err) {
          console.error(failed, err.message);
        }
      });
    },
  };
}

function buildHtml(jsCode, cssCode) {
  const inlinedHtml = inlineTemplate(htmlTemplatePath, {
    cssLink: '<link rel="stylesheet" href="./styles.css">',
    scriptTag: '<script type="module" src="./main.ts"></script>',
    cssCode,
    jsCode,
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "index.html"), inlinedHtml);
  copyFileSync(resolve(__dirname, "SourceVision.png"), resolve(outDir, "SourceVision.png"));
  if (existsSync(resolve(__dirname, "SourceVision-F.png"))) {
    copyFileSync(resolve(__dirname, "SourceVision-F.png"), resolve(outDir, "SourceVision-F.png"));
  }
  // Copy logos from sibling packages and project root
  const monorepoRoot = resolve(__dirname, "../..");
  const logoPaths = [
    [resolve(__dirname, "../rex/Rex-F.png"), "Rex-F.png"],
    [resolve(__dirname, "../hench/Hench-F.png"), "Hench-F.png"],
    [resolve(monorepoRoot, "n-dx.png"), "n-dx.png"],
  ];
  for (const [src, dest] of logoPaths) {
    if (existsSync(src)) {
      copyFileSync(src, resolve(outDir, dest));
    }
  }
}

const bundleCss = () => bundleCssEntry(cssEntryPoint);

// ── Hub session drawer build helpers ──

export const hubSessionJsOptions = { ...commonJsOptions, entryPoints: [hubSessionJsEntryPoint] };

function buildHubSessionHtml(jsCode, cssCode) {
  const inlinedHtml = inlineTemplate(hubSessionHtmlTemplatePath, {
    cssLink: '<link rel="stylesheet" href="./hub-session.css">',
    scriptTag: '<script type="module" src="./hub-session.ts"></script>',
    cssCode,
    jsCode,
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "hub-session.html"), inlinedHtml);
}

const bundleHubSessionCss = () => bundleCssEntry(hubSessionCssEntryPoint);

async function buildHubSession() {
  const jsResult = await esbuild.build({ ...hubSessionJsOptions, write: false, minify: true });
  buildHubSessionHtml(jsResult.outputFiles[0].text, await bundleHubSessionCss());
  console.log("Built hub session drawer: dist/viewer/hub-session.html");
}

// ── Landing page build helpers ──

function buildLandingHtml(jsCode, cssCode) {
  const inlinedHtml = inlineTemplate(landingHtmlTemplatePath, {
    cssLink: '<link rel="stylesheet" href="./landing.css">',
    scriptTag: '<script type="module" src="./landing.ts"></script>',
    cssCode,
    jsCode,
  });

  mkdirSync(landingOutDir, { recursive: true });
  writeFileSync(resolve(landingOutDir, "index.html"), inlinedHtml);
}

const bundleLandingCss = () => bundleCssEntry(landingCssEntryPoint);

const landingJsOptions = {
  entryPoints: [landingJsEntryPoint],
  bundle: true,
  format: "esm",
  target: "es2022",
};

async function buildViewer() {
  const jsResult = await esbuild.build({
    ...commonJsOptions,
    write: false,
    minify: true,
  });

  const jsCode = jsResult.outputFiles[0].text;
  const cssCode = await bundleCss();

  buildHtml(jsCode, cssCode);
  console.log("Built viewer: dist/viewer/index.html");
}

async function buildLanding() {
  const landingJsResult = await esbuild.build({
    ...landingJsOptions,
    write: false,
    minify: true,
  });

  const landingJsCode = landingJsResult.outputFiles[0].text;
  const landingCssCode = await bundleLandingCss();

  buildLandingHtml(landingJsCode, landingCssCode);
  console.log("Built landing: dist/landing/index.html");
}

async function buildProduction() {
  if (landingOnly) {
    await buildLanding();
  } else if (viewerOnly) {
    await buildViewer();
    await buildHubSession();
  } else {
    await buildViewer();
    await buildHubSession();
    await buildLanding();
  }
}

async function buildWatch() {
  // CSS context for watching
  const cssCtx = await esbuild.context({
    entryPoints: [cssEntryPoint],
    bundle: true,
    outfile: resolve(outDir, "styles.css"),
    logLevel: "info",
  });

  // JS context for watching
  const jsCtx = await esbuild.context({
    ...commonJsOptions,
    write: false,
    plugins: [rebuildPagePlugin(
      "rebuild-html",
      async (jsCode) => buildHtml(jsCode, await bundleCss()),
      "[esbuild] Rebuilt viewer: dist/viewer/index.html",
      "[esbuild] HTML rebuild failed:",
    )],
  });

  // Landing page JS context for watching
  const landingJsCtx = await esbuild.context({
    ...landingJsOptions,
    write: false,
    plugins: [rebuildPagePlugin(
      "rebuild-landing-html",
      async (jsCode) => buildLandingHtml(jsCode, await bundleLandingCss()),
      "[esbuild] Rebuilt landing: dist/landing/index.html",
      "[esbuild] Landing rebuild failed:",
    )],
  });

  // Hub session drawer JS context for watching
  const hubSessionJsCtx = await esbuild.context({
    ...hubSessionJsOptions,
    write: false,
    plugins: [rebuildPagePlugin(
      "rebuild-hub-session-html",
      async (jsCode) => buildHubSessionHtml(jsCode, await bundleHubSessionCss()),
      "[esbuild] Rebuilt hub session drawer: dist/viewer/hub-session.html",
      "[esbuild] Hub session drawer rebuild failed:",
    )],
  });

  // Initial build — viewer
  const jsResult = await jsCtx.rebuild();
  const jsCode = jsResult.outputFiles?.[0]?.text ?? "";
  const cssCode = await bundleCss();
  buildHtml(jsCode, cssCode);
  console.log("[esbuild] Initial build complete: dist/viewer/index.html");

  // Initial build — hub session drawer (onEnd writes the page)
  await hubSessionJsCtx.rebuild();

  // Initial build — landing
  const landingJsResult = await landingJsCtx.rebuild();
  const landingJsCode = landingJsResult.outputFiles?.[0]?.text ?? "";
  const landingCssCode = await bundleLandingCss();
  buildLandingHtml(landingJsCode, landingCssCode);
  console.log("[esbuild] Initial build complete: dist/landing/index.html");

  // Start watching all
  await cssCtx.watch();
  await jsCtx.watch();
  await hubSessionJsCtx.watch();
  await landingJsCtx.watch();
  console.log("[esbuild] Watching for changes...");
}

/**
 * Whether `argv1` names this script. Compared by real path: Node runs the main
 * module from its real path, so a script reached through a symlink (macOS
 * `/tmp`, a linked checkout) would otherwise read as imported and skip the
 * build while exiting 0.
 */
export function isEntryScript(argv1, scriptPath = fileURLToPath(import.meta.url)) {
  if (!argv1) return false;
  try {
    return realpathSync(resolve(argv1)) === realpathSync(scriptPath);
  } catch {
    return false; // argv1 names no file, so it is not this script
  }
}

// Importing this file (tests/integration/hub-session-bundle.test.ts reads
// `hubSessionJsOptions`) must not start a build.
if (isEntryScript(process.argv[1])) {
  if (watchMode) {
    buildWatch().catch((err) => {
      console.error("Watch failed:", err);
      process.exit(1);
    });
  } else {
    buildProduction().catch((err) => {
      console.error("Build failed:", err);
      process.exit(1);
    });
  }
}
