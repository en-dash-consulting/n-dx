import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watchMode = process.argv.includes("--watch");

const jsEntryPoint = resolve(__dirname, "src/viewer/main.ts");
const cssEntryPoint = resolve(__dirname, "src/viewer/styles/index.css");
const htmlTemplatePath = resolve(__dirname, "src/viewer/index.html");
const outDir = resolve(__dirname, "dist/viewer");

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

function buildHtml(jsCode, cssCode) {
  const htmlTemplate = readFileSync(htmlTemplatePath, "utf-8");

  let inlinedHtml = htmlTemplate.replace(
    '<link rel="stylesheet" href="./styles.css">',
    () => `<style>${cssCode}</style>`
  );

  inlinedHtml = inlinedHtml.replace(
    '<script type="module" src="./main.ts"></script>',
    () => `<script type="module">${jsCode}</script>`
  );

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

async function bundleCss() {
  const result = await esbuild.build({
    entryPoints: [cssEntryPoint],
    bundle: true,
    write: false,
    minify: !watchMode,
  });
  return result.outputFiles[0].text;
}

async function buildProduction() {
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
    plugins: [{
      name: "rebuild-html",
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length > 0) return;

          try {
            const jsCode = result.outputFiles?.[0]?.text ?? "";
            const cssCode = await bundleCss();
            buildHtml(jsCode, cssCode);
            console.log(`[esbuild] Rebuilt viewer: dist/viewer/index.html`);
          } catch (err) {
            console.error("[esbuild] HTML rebuild failed:", err.message);
          }
        });
      },
    }],
  });

  // Initial build
  const jsResult = await jsCtx.rebuild();
  const jsCode = jsResult.outputFiles?.[0]?.text ?? "";
  const cssCode = await bundleCss();
  buildHtml(jsCode, cssCode);
  console.log("[esbuild] Initial build complete: dist/viewer/index.html");

  // Start watching both
  await cssCtx.watch();
  await jsCtx.watch();
  console.log("[esbuild] Watching for changes...");
}

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
