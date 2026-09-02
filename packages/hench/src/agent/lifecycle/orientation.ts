/**
 * Orientation pass — the one read-only session every task fork inherits.
 *
 * ## What it buys
 *
 * A cold task spawn spends its first several turns rediscovering the repo:
 * where things live, how to build, how to test, what the conventions are.
 * That work is identical for every task in a loop, and it is paid again on
 * every retry. Orientation does it once, in a session that touches nothing,
 * and each task then spawns as a fork of that transcript — arriving already
 * oriented, with no re-exploration turns to pay for.
 *
 * ## Why the prompt is deliberately task-free
 *
 * The forked prefix is only worth caching if it is byte-identical across
 * forks, so nothing task-specific may enter the orientation prompt: mention
 * one task in it and every fork gets a different prefix (no cache reads) and
 * the first task's framing leaks into the rest of the loop. Orientation
 * describes the *repo*, never the work.
 *
 * ## Failure posture
 *
 * Orientation is an optimization, so it never fails a run. A spawn that
 * errors, reports no session id, or throws simply yields no parent, and the
 * caller falls back to cold spawns — costing one wasted spawn rather than a
 * dead loop.
 *
 * @module hench/agent/lifecycle/orientation
 */

import { createPromptEnvelope } from "../../prd/llm-gateway.js";
import type {
  PromptSection,
  PromptSectionName,
  ExecutionPolicy,
} from "../../prd/llm-gateway.js";
import type { SpawnConfig, VendorAdapter } from "./vendor-adapter.js";
import {
  readSessionCache,
  writeSessionCache,
  clearSessionCache,
  isParentUsable,
  sourcevisionFingerprint,
  type ParentRejection,
} from "./session-cache.js";
import { detail } from "../../types/output.js";

/** Minimal shape of a spawn result this module needs. */
export interface OrientationSpawnResult {
  sessionId?: string;
  error?: string;
}

export interface EnsureWarmParentOptions {
  adapter: VendorAdapter;
  vendor: string;
  cliBinary: string;
  cliEnv?: NodeJS.ProcessEnv;
  policy: ExecutionPolicy;
  henchDir: string;
  projectDir: string;
  /** Model the run will use. A different model invalidates the parent. */
  model: string;
  /** `--fresh` — discard any cached parent and orient again. */
  fresh?: boolean;
  /** TTL override (`hench.parentMaxAgeHours`). */
  maxAgeHours?: number;
  /** Spawn executor, injected so this module stays process-free and testable. */
  spawn: (config: SpawnConfig) => Promise<OrientationSpawnResult>;
}

/**
 * System prompt for the orientation session.
 *
 * Read-only is stated here *and* in the task prompt, and the caller also
 * spawns with `permissionMode: "plan"`. The redundancy is deliberate: this
 * transcript is inherited by every subsequent task, so a stray edit made
 * during orientation would be both invisible (it happens before any task
 * starts) and inherited as context by everything that follows.
 */
export function buildOrientationSystemPrompt(): string {
  return [
    "You are orienting yourself in a codebase so that later sessions can start work immediately.",
    "",
    "Do not modify anything. Make no edits, no writes, no commits, and run no command that",
    "changes state. Read and inspect only.",
    "",
    "Be brief and concrete. You are building a durable summary that later sessions inherit,",
    "not performing an analysis for a human to read. Prefer facts you verified over",
    "impressions, and say plainly when something could not be determined.",
  ].join("\n");
}

/**
 * Task prompt for the orientation session.
 *
 * Must stay free of task-specific content — see the module note on why the
 * prefix has to be byte-identical across forks.
 */
export function buildOrientationPrompt(): string {
  return [
    "Orient yourself in this repository. Do not modify anything.",
    "",
    "Establish and summarize:",
    "1. Layout — the top-level structure, which directories hold production code versus",
    "   tests, and where the main entry points are.",
    "2. Build and test commands — the actual commands this project uses, verified from",
    "   its manifest or config rather than assumed from ecosystem defaults.",
    "3. Conventions — language and module style, test framework and file naming, and any",
    "   contributor rules the repository documents for itself.",
    "4. Anything a newcomer would otherwise waste time rediscovering.",
    "",
    "Keep the exploration proportionate: skim broadly, read deeply only where it is needed",
    "to answer the four points above. Do not attempt an exhaustive audit, and do not",
    "propose changes.",
  ].join("\n");
}

/** Human-readable explanation for each rejection, used in the console line. */
const REJECTION_DETAIL: Record<ParentRejection, string> = {
  "no-entry": "no cached session",
  "fresh-requested": "--fresh requested",
  "sourcevision-changed": "analysis changed since it was built",
  "vendor-changed": "vendor changed",
  "model-changed": "model changed",
  expired: "older than the max age",
  malformed: "cache entry unreadable",
};

/**
 * Return a session id to fork task spawns from, orienting first if needed.
 *
 * Returns undefined when no parent could be established, which the caller
 * must treat as "spawn cold" rather than as an error.
 */
export async function ensureWarmParent(
  opts: EnsureWarmParentOptions,
): Promise<string | undefined> {
  const svFingerprint = await sourcevisionFingerprint(opts.projectDir);
  const cached = await readSessionCache(opts.henchDir);
  const verdict = isParentUsable(cached, {
    svFingerprint,
    vendor: opts.vendor,
    model: opts.model,
    maxAgeHours: opts.maxAgeHours,
    fresh: opts.fresh,
  });

  if (verdict.usable && cached) {
    detail(`Warm session: forking cached orientation ${cached.parentId.slice(0, 8)}`);
    return cached.parentId;
  }

  // Drop the unusable entry before orienting so a failed orientation cannot
  // leave a parent behind that the next run would happily fork.
  if (cached) await clearSessionCache(opts.henchDir);
  detail(`Warm session: orienting (${REJECTION_DETAIL[verdict.usable ? "no-entry" : verdict.reason]})`);

  const envelope = createPromptEnvelope([
    { name: "system" as PromptSectionName, content: buildOrientationSystemPrompt() } as PromptSection,
    { name: "brief" as PromptSectionName, content: buildOrientationPrompt() } as PromptSection,
  ]);

  const spawnConfig = opts.adapter.buildSpawnConfig(envelope, opts.policy, {
    model: opts.model || undefined,
    // Plan mode cannot edit. Orientation is the one spawn where that is
    // exactly right — and it is a third guard behind the two prompts.
    permissionMode: "plan",
  });

  let result: OrientationSpawnResult;
  try {
    result = await opts.spawn(spawnConfig);
  } catch (err) {
    detail(`Warm session unavailable (${(err as Error).message}); continuing with cold spawns`);
    return undefined;
  }

  if (result.error || !result.sessionId) {
    detail(
      `Warm session unavailable (${result.error ?? "no session id reported"}); ` +
        "continuing with cold spawns",
    );
    return undefined;
  }

  await writeSessionCache(opts.henchDir, {
    parentId: result.sessionId,
    svFingerprint,
    vendor: opts.vendor,
    model: opts.model,
  }).catch(() => {
    // A parent we cannot persist is still usable for this run; the next run
    // just re-orients.
  });

  detail(`Warm session ready: ${result.sessionId.slice(0, 8)}`);
  return result.sessionId;
}
