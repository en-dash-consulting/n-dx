/**
 * Every suite that can reach @n-dx/llm-client's credential resolver runs
 * against a temp ndx home with Jev's key cleared.
 *
 * The resolver reads the developer's real credential store and an exported
 * TYPESAFE_API_KEY. A suite without `tests/setup-ndx-home.js` reads the real
 * store; one without `tests/setup-judgment-env.js` sends live, billed Jev
 * requests whenever the key is exported. Neither failure shows up as a red
 * test, so the guard is on the configs.
 *
 * A suite can reach the resolver when its package depends on
 * @n-dx/llm-client, is llm-client itself, or is the root suite (which spawns
 * the built CLIs). sourcevision keeps a package-local `setup-ndx-home.ts`, so
 * the home check matches the basename.
 *
 * @see tests/setup-ndx-home.js
 * @see tests/setup-judgment-env.js
 */

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const LLM_CLIENT = "@n-dx/llm-client";

const REQUIRED = [
  { label: "setup-ndx-home", matches: (f) => /^setup-ndx-home\.(js|ts)$/.test(basename(f)) },
  { label: "setup-judgment-env", matches: (f) => basename(f) === "setup-judgment-env.js" },
];

/** Whether a package.json names llm-client in any dependency field, or is it. */
function reachesLlmClient(pkgJson) {
  if (pkgJson.name === LLM_CLIENT) return true;
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
    (field) => pkgJson[field]?.[LLM_CLIENT] !== undefined,
  );
}

/** Suites to check: `{ name, config }`, config path relative to ROOT. */
function suitesInScope() {
  const suites = [{ name: "root", config: "vitest.config.js" }];
  for (const dir of readdirSync(join(ROOT, "packages"))) {
    const pkgPath = join(ROOT, "packages", dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (!reachesLlmClient(pkgJson)) continue;
    const config = readdirSync(join(ROOT, "packages", dir)).find((f) => /^vitest\.config\.[cm]?[jt]s$/.test(f));
    if (config) suites.push({ name: pkgJson.name, config: `packages/${dir}/${config}` });
  }
  return suites;
}

async function setupFilesOf(rel) {
  const mod = await import(pathToFileURL(join(ROOT, rel)).href);
  const files = mod.default?.test?.setupFiles ?? [];
  return Array.isArray(files) ? files : [files];
}

describe("suites that reach the credential resolver isolate credentials", () => {
  const suites = suitesInScope();

  it("finds the suites it is meant to check", () => {
    // Otherwise the assertion below passes by checking nothing.
    const names = suites.map((s) => s.name);
    for (const name of ["root", LLM_CLIENT, "@n-dx/rex", "@n-dx/hench", "@n-dx/web", "@n-dx/sourcevision"]) {
      expect(names).toContain(name);
    }
  });

  it("every such suite has both setup files in test.setupFiles", async () => {
    const missing = [];
    for (const { name, config } of suites) {
      const files = await setupFilesOf(config);
      for (const { label, matches } of REQUIRED) {
        if (!files.some(matches)) missing.push(`${name} (${config}) lacks ${label}`);
      }
    }
    expect(
      missing,
      "These suites can reach @n-dx/llm-client's credential resolver but do not " +
        "isolate it: add ../../tests/setup-ndx-home.js and ../../tests/setup-judgment-env.js " +
        "to test.setupFiles.",
    ).toEqual([]);
  });
});
