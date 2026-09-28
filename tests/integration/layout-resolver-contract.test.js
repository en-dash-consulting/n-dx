/**
 * Layout resolver: behaviour, and the contract between its two copies.
 *
 * The rule for where n-dx keeps its files exists twice on purpose. The
 * canonical implementation is `@n-dx/llm-client`'s `layout.ts`; the
 * orchestration tier cannot import it (`domain-isolation.test.js` fails
 * `cli.js`, `ci.js`, `web.js`, `config.js` and friends for importing any
 * package tier) so `packages/core/layout.js` restates it by hand.
 *
 * Two copies of a rule drift silently — which is the whole reason this file
 * exists. It asserts the resolver's own behaviour against the acceptance
 * criteria, and then asserts that both copies answer identically for the same
 * root, field by field, in both layouts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** @type {typeof import("../../packages/core/layout.js")} */
let core;
/** @type {Record<string, any>} */
let foundation;

/** A project on the legacy layout — three dot-dirs, no container. */
let legacyRoot;
/** A project on the new layout — a `.ndx/` container. */
let ndxRoot;

/** The fields both implementations must agree on, for every root. */
const LAYOUT_FIELDS = [
  "mode",
  "root",
  "container",
  "rexDir",
  "henchDir",
  "sourcevisionDir",
  "configFile",
  "localConfigFile",
  "webPidFile",
  "webPortFile",
  "webUsageFile",
];

beforeAll(async () => {
  core = await import("../../packages/core/layout.js");
  foundation = await import("../../packages/llm-client/dist/public.js");

  legacyRoot = mkdtempSync(join(tmpdir(), "ndx-layout-legacy-"));
  mkdirSync(join(legacyRoot, ".rex"), { recursive: true });
  mkdirSync(join(legacyRoot, ".hench"), { recursive: true });
  mkdirSync(join(legacyRoot, ".sourcevision"), { recursive: true });

  ndxRoot = mkdtempSync(join(tmpdir(), "ndx-layout-ndx-"));
  mkdirSync(join(ndxRoot, ".ndx", "rex"), { recursive: true });
});

afterAll(() => {
  for (const dir of [legacyRoot, ndxRoot]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Acceptance criterion: .ndx/ when present, legacy otherwise, with no warning
// ---------------------------------------------------------------------------

describe("layout resolver: lookup order", () => {
  it("returns .ndx/ paths when the container is present", () => {
    const layout = foundation.resolveLayout(ndxRoot);

    expect(layout.mode).toBe("ndx");
    expect(layout.container).toBe(join(ndxRoot, ".ndx"));
    expect(layout.rexDir).toBe(join(ndxRoot, ".ndx", "rex"));
    expect(layout.henchDir).toBe(join(ndxRoot, ".ndx", "hench"));
    expect(layout.sourcevisionDir).toBe(join(ndxRoot, ".ndx", "sourcevision"));
    expect(layout.configFile).toBe(join(ndxRoot, ".ndx", "config.json"));
    expect(layout.localConfigFile).toBe(join(ndxRoot, ".ndx", "config.local.json"));
    expect(layout.webPidFile).toBe(join(ndxRoot, ".ndx", "web.pid"));
    expect(layout.webPortFile).toBe(join(ndxRoot, ".ndx", "web.port"));
    expect(layout.webUsageFile).toBe(join(ndxRoot, ".ndx", "web-usage.jsonl"));
  });

  it("falls back to the legacy layout when the container is absent", () => {
    const layout = foundation.resolveLayout(legacyRoot);

    expect(layout.mode).toBe("legacy");
    expect(layout.rexDir).toBe(join(legacyRoot, ".rex"));
    expect(layout.henchDir).toBe(join(legacyRoot, ".hench"));
    expect(layout.sourcevisionDir).toBe(join(legacyRoot, ".sourcevision"));
    expect(layout.configFile).toBe(join(legacyRoot, ".n-dx.json"));
    expect(layout.localConfigFile).toBe(join(legacyRoot, ".n-dx.local.json"));
    expect(layout.webPidFile).toBe(join(legacyRoot, ".n-dx-web.pid"));
    expect(layout.webPortFile).toBe(join(legacyRoot, ".n-dx-web.port"));
    expect(layout.webUsageFile).toBe(join(legacyRoot, ".n-dx-web-usage.jsonl"));
  });

  it("falls back to legacy for a root that does not exist at all", () => {
    const missing = join(legacyRoot, "no-such-project");

    expect(foundation.detectLayoutMode(missing)).toBe("legacy");
    expect(foundation.resolveLayout(missing).rexDir).toBe(join(missing, ".rex"));
  });

  it("ignores a .ndx that is a file rather than a directory", () => {
    const root = mkdtempSync(join(tmpdir(), "ndx-layout-file-"));
    try {
      writeFileSync(join(root, ".ndx"), "not a container\n");
      expect(foundation.detectLayoutMode(root)).toBe("legacy");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports no container on the legacy layout, so nobody can mkdir it by accident", () => {
    expect(foundation.resolveLayout(legacyRoot).container).toBeNull();
  });

  it("resolves a layout by name when asked, without consulting the disk", () => {
    // What `ndx init` and `ndx migrate-layout` need: the target paths before
    // the container they are about to create exists.
    const target = foundation.resolveLayout(legacyRoot, { mode: "ndx" });

    expect(target.mode).toBe("ndx");
    expect(target.rexDir).toBe(join(legacyRoot, ".ndx", "rex"));
    expect(foundation.detectLayoutMode(legacyRoot)).toBe("legacy");
  });

  it("falls back silently — no warning on either stream", () => {
    const written = [];
    const patched = [];

    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream);
      patched.push([stream, original]);
      stream.write = (chunk, ...rest) => {
        written.push(String(chunk));
        return original(chunk, ...rest);
      };
    }

    try {
      foundation.resolveLayout(legacyRoot);
      foundation.detectLayoutMode(legacyRoot);
      core.resolveLayout(legacyRoot);
      core.detectLayoutMode(legacyRoot);
    } finally {
      for (const [stream, original] of patched) stream.write = original;
    }

    expect(
      written,
      "a legacy project is not misconfigured — it has simply not run `ndx migrate-layout` yet",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The two copies must not drift
// ---------------------------------------------------------------------------

describe("layout resolver: core twin matches the foundation implementation", () => {
  it("exposes the same container name", () => {
    expect(core.NDX_CONTAINER_DIRNAME).toBe(foundation.NDX_CONTAINER_DIRNAME);
  });

  for (const layout of ["legacy", "ndx"]) {
    it(`detects the same mode for a ${layout} project`, () => {
      const root = layout === "ndx" ? ndxRoot : legacyRoot;
      expect(core.detectLayoutMode(root)).toBe(foundation.detectLayoutMode(root));
    });

    it(`resolves every field identically for a ${layout} project`, () => {
      const root = layout === "ndx" ? ndxRoot : legacyRoot;
      const fromCore = core.resolveLayout(root);
      const fromFoundation = foundation.resolveLayout(root);

      for (const field of LAYOUT_FIELDS) {
        expect(
          fromCore[field],
          `packages/core/layout.js and packages/llm-client/src/layout.ts disagree on "${field}"`,
        ).toBe(fromFoundation[field]);
      }
    });

    it(`resolves every field identically under an explicit "${layout}" mode override`, () => {
      const fromCore = core.resolveLayout(legacyRoot, { mode: layout });
      const fromFoundation = foundation.resolveLayout(legacyRoot, { mode: layout });

      for (const field of LAYOUT_FIELDS) {
        expect(fromCore[field], `mode override disagrees on "${field}"`).toBe(
          fromFoundation[field],
        );
      }
    });
  }

  it("returns exactly the documented field set from both copies", () => {
    const fromCore = Object.keys(core.resolveLayout(legacyRoot)).sort();
    const fromFoundation = Object.keys(foundation.resolveLayout(legacyRoot)).sort();

    expect(fromCore).toEqual([...LAYOUT_FIELDS].sort());
    expect(fromFoundation).toEqual([...LAYOUT_FIELDS].sort());
  });
});
