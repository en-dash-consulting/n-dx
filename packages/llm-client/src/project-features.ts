/**
 * Project feature toggles, readable from every tier.
 *
 * Toggles live under `features` in the project config (`.n-dx.json`, or its
 * `.ndx/` equivalent on a v2 layout). The dashboard owns the *registry* — the
 * label, description and default shown on the settings page — but the stored
 * value has to be readable by code that never goes through the web server:
 * `ndx work` and the hench run loop are processes of their own.
 *
 * So the read lives here, in the foundation tier both sides already depend
 * on, rather than being implemented twice. A toggle whose two readers drift
 * is worse than no toggle: the dashboard would show one thing and the run
 * loop would do another.
 *
 * @module llm-client/project-features
 */

import { existsSync, readFileSync } from "node:fs";

import { resolveLayout } from "./layout.js";

/**
 * Key for fail-forward mode: commit automatically at the end of every run,
 * loop iteration and settings change rather than leaving work uncommitted.
 *
 * Exported so the dashboard registry and the run loop name the same string.
 */
export const FAIL_FORWARD_FEATURE = "git.failForward";

/**
 * Fail-forward is off until asked for.
 *
 * It is the canonical default: the dashboard's feature registry reads it from
 * here rather than repeating the literal, so there is one place to change if
 * that judgement ever does.
 */
export const FAIL_FORWARD_DEFAULT = false;

/** Read the project config, or an empty object if it is missing or unreadable. */
function readProjectConfig(projectDir: string): Record<string, unknown> {
  try {
    const path = resolveLayout(projectDir).configFile;
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    // A config we cannot read is not a reason to crash a run; every caller
    // here has a safe default to fall back to.
    return {};
  }
}

/** Walk a dot-separated path into a nested object. */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Whether a project feature toggle is on.
 *
 * Re-reads the config on every call rather than caching: a run loop can span
 * minutes, and an operator turning a toggle off part way through should be
 * obeyed at the next decision point, not after a restart.
 *
 * Anything that is not a stored boolean — absent, null, a string left by a
 * hand edit — falls back, so a malformed config cannot switch a feature on.
 *
 * @param projectDir Project root.
 * @param key Dotted key under `features`, e.g. {@link FAIL_FORWARD_FEATURE}.
 * @param fallback Value to use when nothing valid is stored.
 */
export function isProjectFeatureEnabled(
  projectDir: string,
  key: string,
  fallback: boolean,
): boolean {
  const features = readProjectConfig(projectDir).features;
  if (features == null || typeof features !== "object") return fallback;
  const stored = getByPath(features as Record<string, unknown>, key);
  return typeof stored === "boolean" ? stored : fallback;
}

/** Whether fail-forward mode is on for this project. */
export function isFailForwardEnabled(projectDir: string): boolean {
  return isProjectFeatureEnabled(projectDir, FAIL_FORWARD_FEATURE, FAIL_FORWARD_DEFAULT);
}
