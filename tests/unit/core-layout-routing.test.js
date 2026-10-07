/**
 * The orchestration tier reads and writes its project state through the
 * resolver, under both layouts.
 *
 * Core is the last tier to be swept. Every function below used to spell
 * `.rex`, `.hench`, `.sourcevision` or one of the loose `.n-dx*` files out at
 * the call site, which is a decision taken a second time by a function that
 * has no idea which layout it is running under — and taken *silently*. On a
 * `.ndx/` project it does not throw; it reads a file nothing writes, finds
 * nothing, and returns the answer for an empty project. A stale PRD excerpt,
 * a dropped test command, a dashboard `stop` that cannot find the server it
 * started.
 *
 * So each case runs the same call against two fixtures that differ only in
 * which layout they are on, and asserts the result tracks the fixture. The
 * `.ndx/` half is the one that was broken; the legacy half is there because a
 * sweep that quietly moved every project to the new paths would be worse than
 * the bug.
 *
 * `tests/integration/layout-resolver-contract.test.js` covers the resolver
 * itself and the agreement between its copies. This file covers core's use of
 * it, and only the paths this sweep rerouted.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDeployManifest } from "../../packages/core/export.js";
import {
  readContextMd,
  readRexTestCommand,
  resolveVendorCliPath,
  sourcevisionAnalysisFingerprint,
} from "../../packages/core/pair-programming.js";
import { refreshSourcevisionDashboardArtifacts } from "../../packages/core/refresh-artifacts.js";
import { snapshotRefreshState, validateRefreshStep } from "../../packages/core/refresh-validate.js";
import { readSelfHealAutoConfirm } from "../../packages/core/self-heal-confirm.js";
import { renderAgentsMd } from "../../packages/core/assistant-assets.js";
import { readPidFile, removePortFile } from "../../packages/core/web.js";

/**
 * Where each fixture keeps the four things these tests touch.
 *
 * Deliberately spelled out rather than taken from `resolveLayout`: a fixture
 * built by the resolver would pass even if the resolver were wrong about
 * where the new layout puts things, which is most of what is being checked.
 */
const LAYOUTS = {
  legacy: {
    sourcevision: [".sourcevision"],
    rex: [".rex"],
    hench: [".hench"],
    config: [".n-dx.json"],
    webPid: [".n-dx-web.pid"],
    webPort: [".n-dx-web.port"],
  },
  ndx: {
    sourcevision: [".ndx", "sourcevision"],
    rex: [".ndx", "rex"],
    hench: [".ndx", "hench"],
    config: [".ndx", "config.json"],
    webPid: [".ndx", "web.pid"],
    webPort: [".ndx", "web.port"],
  },
};

/** One fully-populated project per layout, built without the resolver. */
const roots = {};

function write(root, segments, contents) {
  const path = join(root, ...segments);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents, "utf-8");
  return path;
}

beforeAll(() => {
  for (const [name, at] of Object.entries(LAYOUTS)) {
    const root = mkdtempSync(join(tmpdir(), `ndx-core-routing-${name}-`));
    roots[name] = root;

    // A `.ndx/` directory is what selects the new layout, so the container
    // has to exist before anything resolves against this root.
    if (name === "ndx") mkdirSync(join(root, ".ndx"), { recursive: true });

    write(root, [...at.sourcevision, "manifest.json"],
      JSON.stringify({ analysisFingerprint: `fp-${name}` }));
    write(root, [...at.sourcevision, "CONTEXT.md"], `context for ${name}\n`);
    write(root, [...at.rex, "config.json"], JSON.stringify({ test: `test-${name}` }));
    mkdirSync(join(root, ...at.rex, "prd_tree", "epic-one"), { recursive: true });
    write(root, [...at.rex, "prd_tree", "epic-one", "index.md"], "# Epic\n");
    write(root, [...at.hench, "runs", "run-1", "record.json"], "{}");
    write(root, at.config, JSON.stringify({
      selfHeal: { autoConfirm: true },
      llm: { claude: { cli_path: `/bin/claude-${name}` } },
    }));
    write(root, at.webPid, JSON.stringify({ pid: 4242, port: 3117 }));
    write(root, at.webPort, "3117\n");
  }
});

afterAll(() => {
  for (const root of Object.values(roots)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Runs `assert` once per layout, with that layout's populated root. */
function forEachLayout(assert) {
  for (const name of Object.keys(LAYOUTS)) {
    assert(roots[name], name);
  }
}

describe("sourcevision reads", () => {
  it("find the analysis manifest under either layout", () => {
    forEachLayout((root, name) => {
      expect(sourcevisionAnalysisFingerprint(root), name).toBe(`fp-${name}`);
    });
  });

  it("find CONTEXT.md, and name it the way the project spells it", () => {
    forEachLayout((root, name) => {
      const { content, source } = readContextMd(root);
      expect(content, name).toBe(`context for ${name}\n`);
      expect(source, name).toBe("context");
    });
  });

  it("report a missing CONTEXT.md by its real path, not the legacy one", () => {
    // The warning used to be a fixed string naming `.sourcevision/`, so on a
    // migrated project it sent the operator to a directory they do not have.
    const empty = mkdtempSync(join(tmpdir(), "ndx-core-routing-empty-ndx-"));
    try {
      mkdirSync(join(empty, ".ndx", "sourcevision"), { recursive: true });
      expect(readContextMd(empty).warning).toContain(".ndx/sourcevision/CONTEXT.md");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("rex reads", () => {
  it("find the configured test command under either layout", () => {
    forEachLayout((root, name) => {
      expect(readRexTestCommand(root), name).toBe(`test-${name}`);
    });
  });
});

describe("project-config reads", () => {
  it("find selfHeal.autoConfirm under either layout", () => {
    forEachLayout((root, name) => {
      expect(readSelfHealAutoConfirm(root), name).toBe(true);
    });
  });

  it("find a configured vendor CLI path under either layout", () => {
    forEachLayout((root, name) => {
      expect(resolveVendorCliPath(root, "claude"), name).toBe(`/bin/claude-${name}`);
    });
  });
});

describe("the deploy manifest", () => {
  it("counts PRD items and run records under either layout", () => {
    forEachLayout((root, name) => {
      const manifest = buildDeployManifest(root);
      expect(manifest.itemCount, name).toBe(1);
      expect(manifest.runCount, name).toBe(1);
    });
  });
});

describe("refresh", () => {
  it("writes dashboard artifacts into the project's own analysis directory", () => {
    forEachLayout((root, name) => {
      refreshSourcevisionDashboardArtifacts(root);
      const at = join(root, ...LAYOUTS[name].sourcevision, "dashboard-artifacts.json");
      expect(JSON.parse(readFileSync(at, "utf-8")).refreshedAt, name).toBeTruthy();
    });
  });

  it("snapshots from the project's own analysis directory", async () => {
    for (const [name, at] of Object.entries(LAYOUTS)) {
      const snapshot = await snapshotRefreshState(roots[name], {
        steps: [{ kind: "sourcevision-analyze" }],
      });
      expect(snapshot.svDir, name).toBe(join(roots[name], ...at.sourcevision));
      expect(Object.keys(snapshot.files), name).toContain("manifest.json");
    }
  });

  it("names a missing output the way the project spells it", () => {
    const empty = mkdtempSync(join(tmpdir(), "ndx-core-routing-refresh-ndx-"));
    try {
      mkdirSync(join(empty, ".ndx"), { recursive: true });
      const { valid, issues } = validateRefreshStep("sourcevision-analyze", empty);
      expect(valid).toBe(false);
      expect(issues[0]).toBe("missing expected output: .ndx/sourcevision/manifest.json");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("the dashboard's own markers", () => {
  it("are read from wherever the project's layout puts them", async () => {
    for (const name of Object.keys(LAYOUTS)) {
      // `ndx start stop`, `ndx start status` and `ndx refresh --live-server`
      // all find a running server through this file. Reading the legacy name
      // on a `.ndx/` project reported no server and left the real one
      // running.
      expect((await readPidFile(roots[name]))?.pid, name).toBe(4242);
    }
  });

  it("are removed from there too, so stop does not leave one behind", async () => {
    // Read and write have to agree about the location or `stop` reports
    // success while the marker it was meant to clear stays on disk, and every
    // later `status` reports a server that is gone.
    for (const [name, at] of Object.entries(LAYOUTS)) {
      const root = mkdtempSync(join(tmpdir(), `ndx-core-routing-port-${name}-`));
      try {
        if (name === "ndx") mkdirSync(join(root, ".ndx"), { recursive: true });
        const portPath = write(root, at.webPort, "3117\n");

        await removePortFile(root);

        expect(existsSync(portPath), name).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});

describe("the generated AGENTS.md", () => {
  it("points at the workflow file in the project's own rex directory", () => {
    expect(renderAgentsMd(roots.legacy)).toContain("`.rex/workflow.md`");
    expect(renderAgentsMd(roots.ndx)).toContain("`.ndx/rex/workflow.md`");
  });

  it("defaults to the working directory, for callers with no project in hand", () => {
    // The drift and parity tests render without a project. This repository is
    // on the legacy layout, so the committed AGENTS.md is the legacy
    // spelling — and that is what those tests compare against.
    expect(renderAgentsMd()).toBe(renderAgentsMd(process.cwd()));
  });
});
