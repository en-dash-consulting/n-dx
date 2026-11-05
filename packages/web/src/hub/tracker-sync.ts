/**
 * The hub keeps time for tracker sync; the project server does the work.
 *
 * Each registered project whose untracked `.n-dx.local.json` sets a
 * `trackerSync` rule to anything but `off` is ticked every five minutes, and
 * once as soon as its server is healthy after a start (or after being down).
 * A tick is `POST /p/<id>/api/tracker/sync/tick` through the hub's own proxy
 * with the per-user token, the same gate every other caller passes; the
 * project server collects the ndx events since its last tick, runs its rules
 * and calls the tracker through its own connection. A server that is not
 * healthy is skipped until it is.
 *
 * Reading the rules here only decides whether to send a tick. The project
 * server decides what a tick does — a block the repository committed, or one
 * that does not parse, does nothing there — so the hub never parses more than
 * the rule modes, never spawns git, and imports nothing from `src/server/`.
 *
 * See docs/architecture/sidecar-connections.md.
 *
 * @module web/hub/tracker-sync
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveLayout } from "@n-dx/llm-client";
import type { ProjectView } from "./hub.js";

/** How often a project with a rule on is ticked. */
export const TRACKER_TICK_INTERVAL_MS = 5 * 60_000;
/** The project server's tick route (`server/routes-tracker.ts`). */
export const TRACKER_TICK_PATH = "/api/tracker/sync/tick";
/** A tick waits on the tracker's replies; long enough for a full queue, short of a hang. */
const TICK_TIMEOUT_MS = 120_000;
/** The rule modes that make a call or log a would-be one; anything else is off. */
const ACTIVE_MODES: ReadonlySet<unknown> = new Set(["dry-run", "on"]);

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Whether `repoRoot`'s local config sets any `trackerSync` rule to `dry-run` or `on`. */
export function hasActiveTrackerRule(repoRoot: string): boolean {
  const { localConfigFile } = resolveLayout(repoRoot);
  if (!existsSync(localConfigFile)) return false;
  let local: unknown;
  try {
    local = JSON.parse(readFileSync(localConfigFile, "utf-8"));
  } catch {
    // Unreadable is not a rule that is on; the project server reports the file when it is read there.
    return false;
  }
  const sync = isRecord(local) ? local.trackerSync : undefined;
  const rules = isRecord(sync) ? sync.rules : undefined;
  return isRecord(rules) && Object.values(rules).some((mode) => ACTIVE_MODES.has(mode));
}

/** What became of one tick: the HTTP status, or why there was none. */
export type TrackerTickOutcome = { status: number } | { error: string };

/** Sends one project's tick. */
export type TrackerTickPost = (projectId: string) => Promise<TrackerTickOutcome>;

/** A tick through the hub's own proxy at `port()`, carrying the per-user token when the hub has one. */
export function proxiedTickPost(port: () => number, token: string | null): TrackerTickPost {
  return async (projectId) => {
    try {
      const res = await fetch(`http://127.0.0.1:${port()}/p/${encodeURIComponent(projectId)}${TRACKER_TICK_PATH}`, {
        method: "POST",
        headers: token ? { "X-Ndx-Token": token } : {},
        signal: AbortSignal.timeout(TICK_TIMEOUT_MS),
      });
      await res.arrayBuffer();
      return { status: res.status };
    } catch (err) {
      return { error: (err as Error).message };
    }
  };
}

export interface TrackerSyncClockOptions {
  /** The registered projects with their servers' state. */
  projects: () => ProjectView[];
  post: TrackerTickPost;
  /** Whether a project wants ticks. Defaults to {@link hasActiveTrackerRule} on its repository root. */
  wants?: (project: ProjectView) => boolean;
  intervalMs?: number;
  /** ms since the epoch (tests). */
  now?: () => number;
  log?: (message: string) => void;
}

/** Decides, at each sweep, which projects are due a tick, and sends them. */
export class TrackerSyncClock {
  private readonly opts: Required<Omit<TrackerSyncClockOptions, "log">> & Pick<TrackerSyncClockOptions, "log">;
  /** When each project was last ticked. */
  private readonly lastTick = new Map<string, number>();
  /** Projects whose server was healthy at the last sweep; one missing here that is healthy now has just started. */
  private readonly healthy = new Set<string>();
  private readonly inFlight = new Set<string>();

  constructor(options: TrackerSyncClockOptions) {
    this.opts = {
      wants: (project) => hasActiveTrackerRule(project.repoRoot),
      intervalMs: TRACKER_TICK_INTERVAL_MS,
      now: Date.now,
      ...options,
    };
  }

  /** The ids due a tick now: healthy, wanting ticks, not mid-tick, and just started or a full interval since the last. */
  due(): string[] {
    const now = this.opts.now();
    const registered = new Set<string>();
    const due: string[] = [];
    for (const project of this.opts.projects()) {
      registered.add(project.id);
      if (project.status.state !== "healthy") {
        this.healthy.delete(project.id);
        continue;
      }
      const started = !this.healthy.has(project.id);
      this.healthy.add(project.id);
      if (this.inFlight.has(project.id) || !this.opts.wants(project)) continue;
      const last = this.lastTick.get(project.id);
      if (started || last === undefined || now - last >= this.opts.intervalMs) due.push(project.id);
    }
    for (const id of [...this.healthy]) if (!registered.has(id)) this.healthy.delete(id);
    for (const id of [...this.lastTick.keys()]) if (!registered.has(id)) this.lastTick.delete(id);
    return due;
  }

  /** Tick every project that is due; resolves when their ticks have answered. */
  async sweep(): Promise<void> {
    await Promise.all(this.due().map((id) => this.tick(id)));
  }

  private async tick(projectId: string): Promise<void> {
    this.inFlight.add(projectId);
    // Counted from the attempt, so a server that fails its tick waits a full interval, not one sweep.
    this.lastTick.set(projectId, this.opts.now());
    try {
      const outcome = await this.opts.post(projectId);
      if ("error" in outcome) this.opts.log?.(`[hub] ${projectId}: tracker sync tick failed — ${outcome.error}`);
      else if (outcome.status !== 200) this.opts.log?.(`[hub] ${projectId}: tracker sync tick answered HTTP ${outcome.status}`);
    } finally {
      this.inFlight.delete(projectId);
    }
  }
}
