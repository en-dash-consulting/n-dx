/**
 * Two worktrees, one server: each workspace has its own watchers and PRD
 * cache. Editing worktree B's PRD updates B's cache and broadcasts; A's cache
 * is untouched.
 *
 * Real git and real fs.watch, through the same hooks start.ts hands the
 * registry (`createWorkspaceHooks`), so this is the registration path the
 * server uses — only the WebSocket manager is a stub that records broadcasts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../src/server/types.js";
import { createWorkspaceHooks } from "../../src/server/start.js";
import { WorkspaceRegistry } from "../../src/server/workspaces.js";
import { PRD_CACHE_DIR, PRD_CACHE_JSON } from "../../src/server/prd-io.js";
import type { createWebSocketManager } from "../../src/server/websocket.js";
import { frameIsForWorkspace } from "../../src/viewer/messaging/ws-pipeline.js";

// Absolute wait budget for an fs.watch-delivered event: a hang guardrail, not
// a latency SLA, scaled with the rest of the suite's load-sensitive budgets.
// See TESTING.md "Flake Resistance" Family 2.
const BUDGET_MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20);
const WATCHER_EVENT_TIMEOUT_MS = 5_000 * BUDGET_MULTIPLIER;
// TESTING.md Family 3: testTimeout must stay above the internal wait budget(s)
// a test can accumulate, so a genuine hang surfaces as vi.waitFor's own
// timeout instead of vitest's opaque one.
const TEST_TIMEOUT_BUFFER = 5_000;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function prdMd(title: string): string {
  return `---\nschema: rex/v1\ntitle: ${title}\nitems:\n  - id: e1\n    title: "${title} epic"\n    level: epic\n    status: pending\n---\n\n# ${title}\n`;
}

function cachedTitle(dir: string): string | null {
  const path = join(dir, ".rex", PRD_CACHE_DIR, PRD_CACHE_JSON);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as { title: string }).title : null;
}

let root: string;
let repo: string;
let linked: string;
let registry: WorkspaceRegistry;
const broadcast = vi.fn();
const ws = {
  broadcast,
  handleUpgrade: () => {},
  clientCount: () => 0,
  shutdown: () => {},
} as unknown as ReturnType<typeof createWebSocketManager>;
const hooks = createWorkspaceHooks(ws);

beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-workspaces-")));
  repo = join(root, "app");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  mkdirSync(join(repo, ".rex"));
  writeFileSync(join(repo, ".rex", "prd.md"), prdMd("A"));
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "init");
  linked = join(root, "app-feature");
  git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);
  writeFileSync(join(linked, ".rex", "prd.md"), prdMd("B"));

  const anchorCtx: ServerContext = {
    projectDir: repo, svDir: join(repo, ".sourcevision"), rexDir: join(repo, ".rex"), dev: false, port: 0, startedAt: "t0",
  };
  const anchor = hooks.setup(anchorCtx);
  registry = new WorkspaceRegistry({ anchor: { ctx: anchorCtx, ...anchor }, hooks, refreshIntervalMs: 0 });
  await registry.refresh();
}, 30_000);

afterAll(() => {
  registry?.closeAll();
  if (registry) hooks.teardown(registry.anchor.handles);
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("workspace registry with two worktrees", () => {
  it("knows both worktrees, the anchor eager and the linked one lazy", async () => {
    expect(registry.list()).toEqual([
      { key: "app", path: repo, branch: "main", isAnchor: true, active: true },
      { key: "app-feature", path: linked, branch: "feature", isAnchor: false, active: false },
    ]);
    await vi.waitFor(() => expect(cachedTitle(repo)).toBe("A"));
    expect(cachedTitle(linked)).toBeNull();
  });

  it("creates B's context, watchers and cache on first use", async () => {
    const b = registry.get("app-feature")!;
    expect(b.ctx.rexDir).toBe(join(linked, ".rex"));
    expect(b.handles.watchers.length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(cachedTitle(linked)).toBe("B"));
    expect(registry.list()[1].active).toBe(true);
  });

  it(
    "editing B's PRD refreshes B's cache and broadcasts; A's cache is untouched",
    async () => {
      broadcast.mockClear();
      writeFileSync(join(linked, ".rex", "prd.md"), prdMd("B-edited"));

      await vi.waitFor(() => expect(cachedTitle(linked)).toBe("B-edited"), {
        timeout: WATCHER_EVENT_TIMEOUT_MS,
        interval: 50,
      });
      // …and the frame is tagged for B, so an anchor tab ignores it.
      await vi.waitFor(
        () => expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "rex:prd-changed", workspace: "app-feature" })),
        { timeout: WATCHER_EVENT_TIMEOUT_MS, interval: 50 },
      );
      expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ type: "rex:prd-changed", workspace: "app" }));
      expect(cachedTitle(repo)).toBe("A");
    },
    WATCHER_EVENT_TIMEOUT_MS * 2 + TEST_TIMEOUT_BUFFER,
  );

  /**
   * The anchor's viewer is served at `/`, with no `/w/<key>/` slot, so its own
   * workspace key is null — and `frameIsForWorkspace` accepts an untagged
   * frame only for that viewer. Tagging the anchor's frames with its directory
   * basename therefore silenced the plain single-worktree dashboard: every
   * live update it was sent, it dropped.
   */
  it(
    "the anchor's frames are untagged, and its viewer accepts them",
    async () => {
      broadcast.mockClear();
      writeFileSync(join(repo, ".rex", "prd.md"), prdMd("A-edited"));

      await vi.waitFor(() => expect(cachedTitle(repo)).toBe("A-edited"), {
        timeout: WATCHER_EVENT_TIMEOUT_MS,
        interval: 50,
      });
      const frame = await vi.waitFor(
        () => {
          const call = broadcast.mock.calls
            .map(([value]) => value as Record<string, unknown>)
            .find((value) => value?.type === "rex:prd-changed");
          expect(call, "no rex:prd-changed frame for the anchor").toBeDefined();
          return call!;
        },
        { timeout: WATCHER_EVENT_TIMEOUT_MS, interval: 50 },
      );

      expect(frame).not.toHaveProperty("workspace");
      expect(frameIsForWorkspace(frame, null), "the anchor viewer accepts it").toBe(true);
      expect(frameIsForWorkspace(frame, "app-feature"), "B's viewer does not").toBe(false);

      // Put the anchor's PRD back: the cache assertions in the test below are
      // about this same live registry.
      writeFileSync(join(repo, ".rex", "prd.md"), prdMd("A"));
      await vi.waitFor(() => expect(cachedTitle(repo)).toBe("A"), {
        timeout: WATCHER_EVENT_TIMEOUT_MS,
        interval: 50,
      });
    },
    WATCHER_EVENT_TIMEOUT_MS * 3 + TEST_TIMEOUT_BUFFER,
  );

  it("closeAll removes B's cache and watchers but keeps the anchor's", () => {
    const b = registry.get("app-feature")!;
    registry.closeAll();
    expect(existsSync(join(linked, ".rex", PRD_CACHE_DIR))).toBe(false);
    expect(b.handles.watchers).toHaveLength(0);
    expect(cachedTitle(repo)).toBe("A");
    expect(registry.anchor.handles.watchers.length).toBeGreaterThan(0);
  });
});
