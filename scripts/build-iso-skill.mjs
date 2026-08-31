#!/usr/bin/env node
/**
 * Generate `.claude/skills/iso-map/scripts/iso-map.mjs` from the TypeScript
 * sources in `packages/sourcevision/src/export/`.
 *
 * The skill has to be a single dependency-free file so it can be published and
 * run in any repository, but maintaining a second copy of the layout, routing
 * and rendering logic guarantees the two drift. So the skill script is a build
 * artifact: one source of truth in TypeScript, bundled here, committed, and
 * kept honest by `tests/e2e/iso-skill-drift.test.js`.
 *
 *   node scripts/build-iso-skill.mjs           # write the bundle
 *   node scripts/build-iso-skill.mjs --check   # fail if the committed file is stale
 *
 * esbuild resolves from the web package, which is the only workspace member
 * that depends on it directly.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "packages/sourcevision/src/export/iso-standalone.ts");
const OUT = join(ROOT, ".claude/skills/iso-map/scripts/iso-map.mjs");

const BANNER = `#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
//
// Built from packages/sourcevision/src/export/ by scripts/build-iso-skill.mjs.
// Edit the TypeScript sources and re-run:
//
//     node scripts/build-iso-skill.mjs
//
// tests/e2e/iso-skill-drift.test.js fails if this file is out of date.
// ─────────────────────────────────────────────────────────────────────────────
`;

const FOOTER = `
// ── entry ───────────────────────────────────────────────────────────────────
process.exitCode = runStandalone(process.argv.slice(2), {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
});
`;

function loadEsbuild() {
  // esbuild is a devDependency of @n-dx/web; resolve from there rather than
  // adding a second copy to the tree.
  const require = createRequire(join(ROOT, "packages/web/package.json"));
  try {
    return require("esbuild");
  } catch {
    throw new Error(
      "esbuild not found. Run `pnpm install` at the repo root — it is a devDependency of @n-dx/web.",
    );
  }
}

export async function buildIsoSkill() {
  const esbuild = loadEsbuild();
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    write: false,
    // Nothing may be external: the whole point is a file with no dependencies.
    // A `node:` builtin import is fine and stays as an import.
    external: [],
    legalComments: "none",
    charset: "utf8",
  });

  const [file] = result.outputFiles;
  return `${BANNER}${file.text}${FOOTER}`;
}

async function main() {
  const check = process.argv.includes("--check");
  const generated = await buildIsoSkill();

  if (check) {
    if (!existsSync(OUT)) {
      process.stderr.write(`iso-skill: ${OUT} is missing. Run: node scripts/build-iso-skill.mjs\n`);
      process.exit(1);
    }
    const committed = readFileSync(OUT, "utf-8");
    if (committed !== generated) {
      process.stderr.write(
        "iso-skill: the committed skill script is out of date.\n" +
          "Run: node scripts/build-iso-skill.mjs\n",
      );
      process.exit(1);
    }
    process.stdout.write("iso-skill: up to date.\n");
    return;
  }

  writeFileSync(OUT, generated, "utf-8");
  process.stdout.write(`iso-skill: wrote ${OUT} (${generated.length} bytes)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`iso-skill: ${err.message}\n`);
    process.exit(1);
  });
}
