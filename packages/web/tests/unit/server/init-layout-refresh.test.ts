/**
 * Regression: initializing a blank folder from the dashboard must move the
 * running server onto the layout `ndx init` actually wrote.
 *
 * A server started in an empty folder resolves its layout before anything
 * exists, which gives it the legacy root paths (`.rex`, `.sourcevision`,
 * `.hench`). `ndx init` gives a *new* project the `.ndx/` container instead —
 * so without a refresh the server went on pointing at directories that were
 * never created: `isProjectInitialized` stayed false and the setup page was
 * served forever, which is the one outcome initializing from the dashboard is
 * supposed to prevent.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveLayout } from "@n-dx/llm-client";
import { refreshProjectLayout } from "../../../src/server/start.js";
import { isProjectInitialized } from "../../../src/server/routes-static.js";
import type { ServerContext } from "../../../src/server/types.js";
import type { WatcherHandles } from "../../../src/server/workspaces.js";

describe("init layout refresh", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let handles: WatcherHandles;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "init-layout-"));
    // Exactly what startServer does for the directory it is given.
    const layout = resolveLayout(tmpDir);
    ctx = {
      projectDir: tmpDir,
      svDir: layout.sourcevisionDir,
      rexDir: layout.rexDir,
      dev: false,
    };
    handles = {
      watchers: [],
      henchRunsDir: join(layout.henchDir, "runs"),
      monitorIntervals: [],
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** What `ndx init` writes for a project that has no prior state. */
  async function initUnderNdxContainer(): Promise<void> {
    await mkdir(join(tmpDir, ".ndx", "rex", "prd_tree"), { recursive: true });
    await mkdir(join(tmpDir, ".ndx", "hench", "runs"), { recursive: true });
    await mkdir(join(tmpDir, ".ndx", "sourcevision"), { recursive: true });
    await writeFile(join(tmpDir, ".ndx", "sourcevision", "manifest.json"), "{}");
  }

  it("starts out on the legacy paths, because a blank folder has no layout to detect", () => {
    expect(ctx.rexDir).toBe(join(tmpDir, ".rex"));
    expect(ctx.svDir).toBe(join(tmpDir, ".sourcevision"));
    expect(isProjectInitialized(ctx)).toBe(false);
  });

  it("moves the context onto .ndx/ after init writes the container", async () => {
    await initUnderNdxContainer();
    // Still stale until told to look again — this is the bug, stated.
    expect(isProjectInitialized(ctx)).toBe(false);

    refreshProjectLayout(ctx, handles);

    expect(ctx.rexDir).toBe(join(tmpDir, ".ndx", "rex"));
    expect(ctx.svDir).toBe(join(tmpDir, ".ndx", "sourcevision"));
    expect(handles.henchRunsDir).toBe(join(tmpDir, ".ndx", "hench", "runs"));
    // The dashboard, not the setup page, is served from here on.
    expect(isProjectInitialized(ctx)).toBe(true);
  });

  it("leaves a legacy-layout project where it is", async () => {
    await mkdir(join(tmpDir, ".rex", "prd_tree"), { recursive: true });
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await mkdir(join(tmpDir, ".hench", "runs"), { recursive: true });

    refreshProjectLayout(ctx, handles);

    expect(ctx.rexDir).toBe(join(tmpDir, ".rex"));
    expect(ctx.svDir).toBe(join(tmpDir, ".sourcevision"));
    expect(handles.henchRunsDir).toBe(join(tmpDir, ".hench", "runs"));
    expect(isProjectInitialized(ctx)).toBe(true);
  });
});
