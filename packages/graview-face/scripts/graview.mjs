#!/usr/bin/env node
/**
 * Consume the framework from npm (the default) or from a sibling checkout by
 * path, the way bee-bot's scripts/graview.mjs does: `link` rewrites every
 * @graview/* dependency to `link:../graview/packages/<name>` and remembers
 * the pin in .graview-pin; `npm` restores it. Run `pnpm install` after either.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "package.json");
const pinPath = join(root, ".graview-pin");
const framework = resolve(root, process.env.GRAVIEW_CHECKOUT ?? "../../../graview");
const mode = process.argv[2];

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const sections = ["dependencies", "devDependencies"];
const isFramework = (name) => name === "graview" || name.startsWith("@graview/");
const packageDir = (name) => (name === "graview" ? "graview" : name.slice("@graview/".length));

if (mode === "link") {
  if (!existsSync(join(framework, "packages"))) {
    console.error(`graview link: no framework checkout at ${framework} (set GRAVIEW_CHECKOUT).`);
    process.exit(1);
  }
  const pinned = {};
  for (const section of sections) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (!isFramework(name) || range.startsWith("link:")) continue;
      pinned[name] = range;
      manifest[section][name] = `link:${join("..", "graview", "packages", packageDir(name))}`;
    }
  }
  if (Object.keys(pinned).length > 0) writeFileSync(pinPath, `${JSON.stringify(pinned, null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`graview link: ${Object.keys(pinned).length} packages → ${framework}. Now: pnpm install`);
} else if (mode === "npm") {
  if (!existsSync(pinPath)) {
    console.log("graview npm: nothing linked.");
    process.exit(0);
  }
  const pinned = JSON.parse(readFileSync(pinPath, "utf-8"));
  for (const section of sections) {
    for (const name of Object.keys(manifest[section] ?? {})) if (pinned[name]) manifest[section][name] = pinned[name];
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`graview npm: ${Object.keys(pinned).length} packages back on ${Object.values(pinned)[0]}. Now: pnpm install`);
} else {
  console.error("usage: node scripts/graview.mjs link|npm");
  process.exit(2);
}
