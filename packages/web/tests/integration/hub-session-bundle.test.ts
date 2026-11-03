/**
 * The hub session drawer page stays drawer-sized.
 *
 * `src/viewer/hub-session.ts` is a separate esbuild entry the hub home frames.
 * Imported through the full `hooks/` and `components/` barrels it carried the
 * whole dashboard (~545 KB: zod, the loader, the top nav, the guide). esbuild
 * cannot drop barrel members because the package is not declared side-effect
 * free, so the entry imports through the narrow `sidecar/` barrel instead.
 *
 * This builds the entry with `build.js`'s own options, so a change to the
 * build cannot drift from what is checked. If it fails, find the import that
 * reached the full barrel and route it through `hooks/sidecar.ts`.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as esbuild from "esbuild";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// By URL: the suite's `.js` → `.ts` import rewrite would otherwise miss build.js.
const buildScript = pathToFileURL(resolve(import.meta.dirname!, "../../build.js")).href;
const { hubSessionJsOptions } = await import(/* @vite-ignore */ buildScript) as {
  hubSessionJsOptions: esbuild.BuildOptions;
};

/** The page's budget; the inlined HTML adds ~15 KB of CSS and markup. */
const MAX_JS_BYTES = 130 * 1024;

let inputs: string[];
let jsBytes: number;

beforeAll(async () => {
  const result = await esbuild.build({
    ...hubSessionJsOptions,
    write: false,
    minify: true,
    metafile: true,
  });
  inputs = Object.keys(result.metafile.inputs);
  jsBytes = result.outputFiles[0].contents.byteLength;
});

describe("hub session drawer bundle", () => {
  it("does not include zod", () => {
    expect(inputs.filter((p) => /[\\/]zod[\\/]/.test(p))).toEqual([]);
  });

  it("does not include the viewer loader", () => {
    expect(inputs.filter((p) => p.includes("src/viewer/loader/"))).toEqual([]);
  });

  it("stays under the size budget", () => {
    expect(jsBytes).toBeLessThan(MAX_JS_BYTES);
  });
});
