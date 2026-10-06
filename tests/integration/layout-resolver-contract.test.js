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
/** @type {Record<string, any>} */
let isoBundle;
/** @type {Record<string, any>} */
let isoDeclared;
/** @type {Record<string, any>} */
let viewerStatePaths;

/** A project on the legacy layout — three dot-dirs, no container. */
let legacyRoot;
/** A project on the new layout — a `.ndx/` container. */
let ndxRoot;
/** Stand-in user home directories for the per-user lookup. */
let homes;

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
  isoBundle = await import("../../packages/sourcevision/dist/export/iso-sources.js");
  isoDeclared = await import("../../packages/sourcevision/dist/export/iso-declared.js");
  viewerStatePaths = await import("../../packages/web/dist/viewer/state-paths.js");

  legacyRoot = mkdtempSync(join(tmpdir(), "ndx-layout-legacy-"));
  mkdirSync(join(legacyRoot, ".rex"), { recursive: true });
  mkdirSync(join(legacyRoot, ".hench"), { recursive: true });
  mkdirSync(join(legacyRoot, ".sourcevision"), { recursive: true });

  ndxRoot = mkdtempSync(join(tmpdir(), "ndx-layout-ndx-"));
  mkdirSync(join(ndxRoot, ".ndx", "rex"), { recursive: true });

  // Four machines: one that has already moved, one still on 0.7.x, one with
  // both, and a fresh install with neither.
  homes = {
    current: mkdtempSync(join(tmpdir(), "ndx-home-current-")),
    legacy: mkdtempSync(join(tmpdir(), "ndx-home-legacy-")),
    both: mkdtempSync(join(tmpdir(), "ndx-home-both-")),
    fresh: mkdtempSync(join(tmpdir(), "ndx-home-fresh-")),
  };
  mkdirSync(join(homes.current, ".ndx"));
  mkdirSync(join(homes.legacy, ".n-dx"));
  mkdirSync(join(homes.both, ".ndx"));
  mkdirSync(join(homes.both, ".n-dx"));
});

afterAll(() => {
  for (const dir of [legacyRoot, ndxRoot, ...Object.values(homes ?? {})]) {
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
// Acceptance criteria: the per-user directory
// ---------------------------------------------------------------------------

describe("per-user home: lookup order", () => {
  it("uses ~/.ndx on a machine that has it", () => {
    expect(foundation.resolveNdxHome({ env: {}, home: homes.current })).toBe(
      join(homes.current, ".ndx"),
    );
  });

  it("keeps using ~/.n-dx when that is the only one present", () => {
    // The acceptance criterion: a 0.7.x machine's hub carries on unchanged.
    expect(foundation.resolveNdxHome({ env: {}, home: homes.legacy })).toBe(
      join(homes.legacy, ".n-dx"),
    );
  });

  it("prefers ~/.ndx when both exist", () => {
    expect(foundation.resolveNdxHome({ env: {}, home: homes.both })).toBe(
      join(homes.both, ".ndx"),
    );
  });

  it("starts a machine with neither on ~/.ndx", () => {
    expect(foundation.resolveNdxHome({ env: {}, home: homes.fresh })).toBe(
      join(homes.fresh, ".ndx"),
    );
  });

  it("lets $NDX_HOME override the location", () => {
    expect(
      foundation.resolveNdxHome({
        env: { NDX_HOME: "/override" },
        home: homes.legacy,
      }),
    ).toBe("/override");
  });

  it("honours $N_DX_HOME when $NDX_HOME is unset", () => {
    expect(
      foundation.resolveNdxHome({
        env: { N_DX_HOME: "/legacy-override" },
        home: homes.current,
      }),
    ).toBe("/legacy-override");
  });

  it("takes $NDX_HOME ahead of $N_DX_HOME when both are set", () => {
    expect(
      foundation.resolveNdxHome({
        env: { NDX_HOME: "/new", N_DX_HOME: "/old" },
        home: homes.current,
      }),
    ).toBe("/new");
  });

  it("treats an empty override as unset, not as the working directory", () => {
    expect(
      foundation.resolveNdxHome({
        env: { NDX_HOME: "", N_DX_HOME: "" },
        home: homes.legacy,
      }),
    ).toBe(join(homes.legacy, ".n-dx"));
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

  for (const layout of ["legacy", "ndx"]) {
    it(`names every field the same way relative to a ${layout} root`, () => {
      const root = layout === "ndx" ? ndxRoot : legacyRoot;
      const fromCore = core.resolveLayout(root);
      const fromFoundation = foundation.resolveLayout(root);

      // `container` is null on legacy, and relativeToRoot takes a path.
      const pathFields = LAYOUT_FIELDS.filter(
        (f) => f !== "mode" && f !== "root" && fromCore[f] !== null,
      );
      for (const field of pathFields) {
        expect(
          core.relativeToRoot(fromCore, fromCore[field]),
          `relativeToRoot disagrees on "${field}"`,
        ).toBe(foundation.relativeToRoot(fromFoundation, fromFoundation[field]));
      }
    });
  }

  it("gives gitignore-shaped names — root-relative, forward slashes", () => {
    // These strings go into .gitignore and .gitattributes, where a Windows
    // backslash matches nothing at all, so the separator is load-bearing.
    const ndxLayout = core.resolveLayout(ndxRoot);
    expect(core.relativeToRoot(ndxLayout, ndxLayout.rexDir)).toBe(".ndx/rex");
    expect(core.relativeToRoot(ndxLayout, ndxLayout.configFile)).toBe(".ndx/config.json");

    const legacyLayout = core.resolveLayout(legacyRoot);
    expect(core.relativeToRoot(legacyLayout, legacyLayout.rexDir)).toBe(".rex");
    expect(core.relativeToRoot(legacyLayout, legacyLayout.configFile)).toBe(".n-dx.json");
  });

  it("returns exactly the documented field set from both copies", () => {
    const fromCore = Object.keys(core.resolveLayout(legacyRoot)).sort();
    const fromFoundation = Object.keys(foundation.resolveLayout(legacyRoot)).sort();

    expect(fromCore).toEqual([...LAYOUT_FIELDS].sort());
    expect(fromFoundation).toEqual([...LAYOUT_FIELDS].sort());
  });

  it("lists the same both-layout state names from both copies", () => {
    // `layoutStateNames` is what the classifiers use — the scans and filters
    // that are handed a path and have to say whether n-dx owns it, which means
    // recognising both spellings rather than resolving one. Two copies of that
    // list drift exactly like two copies of the resolver.
    expect(core.layoutStateNames()).toEqual(foundation.layoutStateNames());
  });

  it("gives classifiers the container, and path-matchers its children", () => {
    const { dirNames, statePaths } = core.layoutStateNames();

    // A walk tests one directory entry at a time, so `.ndx` alone has to stand
    // in for all three of its children — listing `.ndx/rex` there would never
    // match an entry name and the walk would descend into n-dx's own state.
    expect(dirNames).toEqual([".rex", ".hench", ".sourcevision", ".ndx"]);

    // A path matcher compares whole root-relative paths, so it needs both
    // layouts spelled out and the bare container is no use to it.
    expect(statePaths).toEqual([
      ".rex",
      ".hench",
      ".sourcevision",
      ".ndx/rex",
      ".ndx/hench",
      ".ndx/sourcevision",
    ]);

    // Forward slashes, for the same reason relativeToRoot uses them.
    for (const name of [...dirNames, ...statePaths]) {
      expect(name).not.toContain("\\");
    }
  });

  it("answers without reading the disk, so a scan's verdict is not location-dependent", () => {
    // The names come from an explicit mode, never from detection. If they were
    // detected, the same source file would be n-dx state or not depending on
    // which checkout the scan ran in.
    const cwd = process.cwd();
    try {
      process.chdir(ndxRoot);
      const fromNdx = core.layoutStateNames();
      process.chdir(legacyRoot);
      expect(core.layoutStateNames()).toEqual(fromNdx);
    } finally {
      process.chdir(cwd);
    }
  });

  it("names the per-user directory and its overrides identically", () => {
    expect(core.NDX_HOME_DIRNAME).toBe(foundation.NDX_HOME_DIRNAME);
    expect(core.LEGACY_NDX_HOME_DIRNAME).toBe(foundation.LEGACY_NDX_HOME_DIRNAME);
    expect(core.NDX_HOME_ENV).toBe(foundation.NDX_HOME_ENV);
    expect(core.LEGACY_NDX_HOME_ENV).toBe(foundation.LEGACY_NDX_HOME_ENV);
  });

  for (const [label, envVars] of [
    ["no override", {}],
    ["$NDX_HOME", { NDX_HOME: "/override" }],
    ["$N_DX_HOME", { N_DX_HOME: "/legacy-override" }],
    ["both overrides", { NDX_HOME: "/new", N_DX_HOME: "/old" }],
    ["empty overrides", { NDX_HOME: "", N_DX_HOME: "" }],
  ]) {
    it(`resolves the per-user directory identically with ${label}`, () => {
      for (const home of Object.values(homes)) {
        expect(
          core.resolveNdxHome({ env: envVars, home }),
          `packages/core/layout.js and packages/llm-client/src/layout.ts disagree for ${home}`,
        ).toBe(foundation.resolveNdxHome({ env: envVars, home }));
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The iso bundle carries a third copy, for the same reason core carries a second
// ---------------------------------------------------------------------------

describe("layout resolver: iso bundle twin matches the foundation implementation", () => {
  // `packages/sourcevision/src/export/` bundles into the dependency-free
  // standalone skill script, so it may import nothing but `node:` builtins and
  // cannot reach the resolver. It resolves the two paths the map reads: the
  // analysis directory, and the project config that declares seams and
  // infrastructure the import graph structurally cannot show.
  for (const layout of ["legacy", "ndx"]) {
    it(`resolves the analysis directory identically for a ${layout} project`, () => {
      const root = layout === "ndx" ? ndxRoot : legacyRoot;

      expect(
        isoBundle.analysisDirFor(root),
        "packages/sourcevision/src/export/iso-sources.ts and packages/llm-client/src/layout.ts disagree",
      ).toBe(foundation.resolveLayout(root).sourcevisionDir);
    });
  }

  it("agrees for a root that does not exist at all", () => {
    const missing = join(legacyRoot, "no-such-project");

    expect(isoBundle.analysisDirFor(missing)).toBe(
      foundation.resolveLayout(missing).sourcevisionDir,
    );
  });

  it("agrees that a .ndx file is not a container", () => {
    const root = mkdtempSync(join(tmpdir(), "ndx-layout-iso-file-"));
    try {
      writeFileSync(join(root, ".ndx"), "not a container\n");
      expect(isoBundle.analysisDirFor(root)).toBe(
        foundation.resolveLayout(root).sourcevisionDir,
      );
      expect(isoDeclared.projectConfigFor(root)).toBe(
        foundation.resolveLayout(root).configFile,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The map reads declared seams and infrastructure out of the project config.
  // Guessing `.n-dx.json` on a `.ndx/` project finds nothing and drops them
  // with no error, so the map silently loses every declaration a human made.
  for (const layout of ["legacy", "ndx"]) {
    it(`resolves the project config identically for a ${layout} project`, () => {
      const root = layout === "ndx" ? ndxRoot : legacyRoot;

      expect(
        isoDeclared.projectConfigFor(root),
        "packages/sourcevision/src/export/iso-declared.ts and packages/llm-client/src/layout.ts disagree",
      ).toBe(foundation.resolveLayout(root).configFile);
    });
  }

  it("agrees on the project config for a root that does not exist at all", () => {
    const missing = join(legacyRoot, "no-such-project");

    expect(isoDeclared.projectConfigFor(missing)).toBe(
      foundation.resolveLayout(missing).configFile,
    );
  });
});

// ---------------------------------------------------------------------------
// The viewer carries a fourth copy, because a browser bundle cannot read a disk
// ---------------------------------------------------------------------------

describe("layout resolver: viewer twin matches the foundation implementation", () => {
  // `packages/web/src/viewer/state-paths.ts` is the browser-safe restatement of
  // `layoutStateNames().statePaths`. The viewer cannot import the resolver —
  // `layout.ts` reaches for `node:fs` at module scope — but it classifies the
  // same paths: the Files view hides n-dx's own directories, and the Hench Runs
  // view calls a PRD write bookkeeping rather than work. Both have to recognise
  // *both* layouts, which is exactly what the canonical list answers.
  it("lists the same state directories as layoutStateNames", () => {
    expect(
      [...viewerStatePaths.ALL_STATE_DIRS].sort(),
      "packages/web/src/viewer/state-paths.ts and packages/llm-client/src/layout.ts disagree",
    ).toEqual([...foundation.layoutStateNames().statePaths].sort());
  });

  it("groups them by tool the way the resolver resolves them", () => {
    for (const [dirs, field] of [
      [viewerStatePaths.REX_STATE_DIRS, "rexDir"],
      [viewerStatePaths.HENCH_STATE_DIRS, "henchDir"],
      [viewerStatePaths.SOURCEVISION_STATE_DIRS, "sourcevisionDir"],
    ]) {
      const expected = ["legacy", "ndx"].map((mode) => {
        const layout = foundation.resolveLayout(".", { mode });
        return foundation.relativeToRoot(layout, layout[field]);
      });
      expect([...dirs], `${field} twin disagrees`).toEqual(expected);
    }
  });

  it("gives prefixes that match a path's leading segment, not a bare name", () => {
    // The consumers match `${dir}/`, so a run that touched `.rexy/thing` must
    // not be classified as PRD bookkeeping.
    const prefixes = viewerStatePaths.stateDirPrefixes(viewerStatePaths.REX_STATE_DIRS);

    expect(prefixes).toEqual([".rex/", ".ndx/rex/"]);
    expect(prefixes.some((p) => ".rexy/thing".startsWith(p))).toBe(false);
    expect(prefixes.some((p) => ".ndx/rex/prd_tree/x".startsWith(p))).toBe(true);
  });
});
