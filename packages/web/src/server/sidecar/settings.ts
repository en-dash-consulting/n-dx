/**
 * The Sidecar's saved settings, under `web` in the project config:
 *
 *     "web": {
 *       "sidecarContextCeiling": { "worktree": 100000, "hub": 40000 },
 *       "sidecarIdleMs": 7200000,
 *       "sidecarMode": "ask",
 *       "sidecarGithubReads": false
 *     }
 *
 * Context ceilings are read by `context-refresh.ts` and the idle window by the
 * session registry, each on every use. `sidecarGithubReads` decides whether
 * `GET /api/branch-health` may run gh (routes-branch-health.ts), and is
 * stored for the GitHub lens (batch L2). Mode has one value, `ask`:
 * `auto` is refused until it exists.
 */

import { relativeToRoot, resolveLayout } from "@n-dx/llm-client";
import { DEFAULT_CONTEXT_CEILINGS, type SidecarScope } from "./context-refresh.js";
import { DEFAULT_SIDECAR_TTL_MS } from "./session-registry.js";
import { positiveInteger, readWebValue, writeWebValues, type WebChange } from "./web-config.js";

export const SIDECAR_MODES = ["ask"] as const;
export type SidecarMode = (typeof SIDECAR_MODES)[number];

/** What GET answers: the values in force, the defaults, and where saves land. */
export interface SidecarSettings {
  mode: SidecarMode;
  contextCeiling: Record<SidecarScope, number>;
  idleMs: number;
  githubReads: boolean;
  defaults: {
    contextCeiling: Record<SidecarScope, number>;
    idleMs: number;
  };
  /** The shared config file, relative to the project root, for display. */
  configFile: string;
}

/** A PUT body; `null` resets a value to its default. Every field is optional. */
export interface SidecarSettingsPatch {
  mode?: unknown;
  contextCeiling?: { worktree?: unknown; hub?: unknown };
  idleMs?: unknown;
  githubReads?: unknown;
}

/** The idle window after which a session forgets its resume id: saved value, else 2 h. */
export function resolveSidecarIdleMs(projectDir: string): number {
  return readWebValue(projectDir, (web) => positiveInteger(web.sidecarIdleMs)) ?? DEFAULT_SIDECAR_TTL_MS;
}

export function readSidecarSettings(projectDir: string): SidecarSettings {
  const layout = resolveLayout(projectDir);
  return {
    mode: "ask",
    contextCeiling: {
      worktree: readWebValue(projectDir, (web) => ceiling(web, "worktree")) ?? DEFAULT_CONTEXT_CEILINGS.worktree,
      hub: readWebValue(projectDir, (web) => ceiling(web, "hub")) ?? DEFAULT_CONTEXT_CEILINGS.hub,
    },
    idleMs: resolveSidecarIdleMs(projectDir),
    githubReads: readWebValue(projectDir, (web) => (typeof web.sidecarGithubReads === "boolean" ? web.sidecarGithubReads : undefined)) ?? false,
    defaults: { contextCeiling: { ...DEFAULT_CONTEXT_CEILINGS }, idleMs: DEFAULT_SIDECAR_TTL_MS },
    configFile: relativeToRoot(layout, layout.configFile),
  };
}

function ceiling(web: Record<string, unknown>, scope: SidecarScope): number | undefined {
  const ceilings = web.sidecarContextCeiling;
  return ceilings && typeof ceilings === "object"
    ? positiveInteger((ceilings as Record<string, unknown>)[scope])
    : undefined;
}

/** The config changes a patch asks for, or the first reason it cannot be saved. */
export function planSidecarSettings(patch: SidecarSettingsPatch): { changes: WebChange[] } | { error: string } {
  const changes: WebChange[] = [];

  if (patch.mode !== undefined && patch.mode !== null) {
    if (patch.mode === "auto") return { error: "Auto mode is not available yet; the Sidecar asks before it acts" };
    if (!(SIDECAR_MODES as readonly unknown[]).includes(patch.mode)) {
      return { error: `mode must be one of: ${SIDECAR_MODES.join(", ")}` };
    }
  }
  if (patch.mode !== undefined) changes.push({ path: ["sidecarMode"], value: patch.mode === null ? undefined : patch.mode });

  if (patch.contextCeiling !== undefined) {
    if (!patch.contextCeiling || typeof patch.contextCeiling !== "object") return { error: "contextCeiling must be an object" };
    for (const scope of ["worktree", "hub"] as const) {
      const value = patch.contextCeiling[scope];
      if (value === undefined) continue;
      if (value !== null && positiveInteger(value) === undefined) {
        return { error: `The ${scope} context ceiling must be a whole number of tokens above 0` };
      }
      changes.push({ path: ["sidecarContextCeiling", scope], value: value === null ? undefined : value });
    }
  }

  if (patch.idleMs !== undefined) {
    if (patch.idleMs !== null && positiveInteger(patch.idleMs) === undefined) {
      return { error: "The idle window must be a whole number of milliseconds above 0" };
    }
    changes.push({ path: ["sidecarIdleMs"], value: patch.idleMs === null ? undefined : patch.idleMs });
  }

  if (patch.githubReads !== undefined) {
    if (patch.githubReads !== null && typeof patch.githubReads !== "boolean") return { error: "githubReads must be true or false" };
    changes.push({ path: ["sidecarGithubReads"], value: patch.githubReads === null ? undefined : patch.githubReads });
  }
  return { changes };
}

/** Validate `patch` and write it; nothing is written when any field is invalid. Returns the files written. */
export function saveSidecarSettings(projectDir: string, patch: SidecarSettingsPatch): { files: string[] } | { error: string } {
  const plan = planSidecarSettings(patch);
  if ("error" in plan) return plan;
  return { files: writeWebValues(projectDir, plan.changes) };
}
