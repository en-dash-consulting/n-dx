/**
 * Warm-parent session cache — the state behind cold-start elimination.
 *
 * ## The problem
 *
 * Every hench task spawns a fresh `claude -p`, and each spawn re-pays the
 * same cold start: the harness system prompt, the project's CLAUDE.md, skill
 * metadata, and the several turns the model spends re-discovering a repo it
 * explored ten minutes ago on the previous task. In a `--loop` that cost is
 * paid once per task, and again per retry.
 *
 * ## The mechanic
 *
 * Run orientation *once* — a read-only session that maps the layout and
 * confirms the build/test commands — then spawn each task as a fork of it
 * (`--resume <parentId> --fork-session`). A fork inherits the transcript
 * under a new session id without mutating the parent, so one orientation
 * serves many tasks, every fork starts with a byte-identical prefix (which
 * is what earns cache-read pricing), and no task re-explores.
 *
 * This module owns only the *state*: which parent exists, and whether it is
 * still safe to fork. The orientation spawn and fork wiring live in the loop.
 *
 * ## Why invalidation is the load-bearing part
 *
 * A cache miss costs one orientation spawn — cheap, and self-correcting. A
 * stale *hit* is the expensive failure: every task in the loop would inherit
 * an orientation describing a repo that has since changed, and act on it
 * confidently. So this module is permissive about failing to find a parent
 * (a corrupt file is simply a miss) and strict about using one: the analysis
 * fingerprint must match, the entry must be within its TTL, and the vendor
 * and model must be the ones it was created under.
 *
 * @module hench/agent/lifecycle/session-cache
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** File under `.hench/` holding the cached parent session. */
export const SESSION_CACHE_FILE = "session-cache.json";

/** Default TTL for a cached orientation session. */
export const DEFAULT_PARENT_MAX_AGE_HOURS = 24;

/** Default number of tasks a single session executes under the batch strategy. */
export const DEFAULT_TASKS_PER_SESSION = 4;

/** How task spawns relate to sessions. */
export const SESSION_STRATEGIES = ["fork", "batch", "cold"] as const;
export type SessionStrategy = (typeof SESSION_STRATEGIES)[number];

/** A cached orientation session. */
export interface SessionCacheEntry {
  /** Vendor session id to fork from. */
  parentId: string;
  /** ISO timestamp the orientation session was created. */
  createdAt: string;
  /** Fingerprint of the sourcevision analysis the orientation was built on. */
  svFingerprint: string;
  /** Vendor the parent was created under. */
  vendor: string;
  /** Model the parent was created under. */
  model: string;
}

/** Why a cached parent cannot be used. */
export type ParentRejection =
  | "no-entry"
  | "fresh-requested"
  | "sourcevision-changed"
  | "vendor-changed"
  | "model-changed"
  | "expired"
  | "malformed";

export type ParentVerdict = { usable: true } | { usable: false; reason: ParentRejection };

function cachePath(henchDir: string): string {
  return join(henchDir, SESSION_CACHE_FILE);
}

/**
 * Read the cached parent session, or undefined when there is nothing usable
 * to read. Absent, unreadable, unparseable, and structurally invalid files
 * are all the same answer — a miss costs one orientation spawn, and failing
 * a run over a scratch file would be a worse trade.
 */
export async function readSessionCache(henchDir: string): Promise<SessionCacheEntry | undefined> {
  try {
    const raw = await readFile(cachePath(henchDir), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const entry = parsed as Partial<SessionCacheEntry>;
    if (typeof entry.parentId !== "string" || !entry.parentId) return undefined;
    if (typeof entry.createdAt !== "string" || !entry.createdAt) return undefined;
    return {
      parentId: entry.parentId,
      createdAt: entry.createdAt,
      svFingerprint: typeof entry.svFingerprint === "string" ? entry.svFingerprint : "",
      vendor: typeof entry.vendor === "string" ? entry.vendor : "",
      model: typeof entry.model === "string" ? entry.model : "",
    };
  } catch {
    return undefined;
  }
}

/** Persist a parent session, stamping `createdAt` at write time. */
export async function writeSessionCache(
  henchDir: string,
  entry: Omit<SessionCacheEntry, "createdAt"> & { createdAt?: string },
): Promise<void> {
  await mkdir(henchDir, { recursive: true });
  const record: SessionCacheEntry = {
    parentId: entry.parentId,
    createdAt: entry.createdAt ?? new Date().toISOString(),
    svFingerprint: entry.svFingerprint,
    vendor: entry.vendor,
    model: entry.model,
  };
  await writeFile(cachePath(henchDir), `${JSON.stringify(record, null, 2)}\n`, "utf-8");
}

/** Drop the cached parent. Silent when there is nothing to drop. */
export async function clearSessionCache(henchDir: string): Promise<void> {
  await rm(cachePath(henchDir), { force: true }).catch(() => { /* best effort */ });
}

export interface ParentUsabilityInput {
  /** Current sourcevision fingerprint, from {@link sourcevisionFingerprint}. */
  svFingerprint: string;
  /** Vendor this run will use. */
  vendor: string;
  /** Model this run will use. */
  model: string;
  /** TTL override; defaults to {@link DEFAULT_PARENT_MAX_AGE_HOURS}. */
  maxAgeHours?: number;
  /** `--fresh` — force a new orientation regardless of what is cached. */
  fresh?: boolean;
}

/**
 * Decide whether a cached parent may be forked for this run.
 *
 * Every rejection is named rather than folded into a boolean so the caller
 * can tell the operator *why* it is re-orienting — "the analysis changed" and
 * "the parent aged out" are different stories, and a fork strategy that
 * silently never hits would otherwise look like it was working.
 */
export function isParentUsable(
  entry: SessionCacheEntry | undefined,
  input: ParentUsabilityInput,
): ParentVerdict {
  if (!entry) return { usable: false, reason: "no-entry" };
  if (input.fresh) return { usable: false, reason: "fresh-requested" };

  const createdAtMs = Date.parse(entry.createdAt);
  if (Number.isNaN(createdAtMs)) return { usable: false, reason: "malformed" };

  if (entry.svFingerprint !== input.svFingerprint) {
    return { usable: false, reason: "sourcevision-changed" };
  }
  if (entry.vendor !== input.vendor) return { usable: false, reason: "vendor-changed" };
  if (entry.model !== input.model) return { usable: false, reason: "model-changed" };

  const maxAgeHours = input.maxAgeHours ?? DEFAULT_PARENT_MAX_AGE_HOURS;
  if (Date.now() - createdAtMs > maxAgeHours * 3_600_000) {
    return { usable: false, reason: "expired" };
  }
  return { usable: true };
}

/**
 * Fingerprint the sourcevision analysis the orientation session was built on.
 *
 * Derived from `manifest.json`'s `analyzedAt` and `gitSha` rather than by
 * hashing `.sourcevision/` wholesale: those two fields change on exactly the
 * event that invalidates an orientation (a re-analysis, or an analysis of a
 * different commit), and reading one small file keeps this cheap enough to
 * run before every task.
 *
 * A missing or unreadable manifest returns a stable sentinel rather than
 * throwing: projects without sourcevision output still get forking, they just
 * do not get analysis-driven invalidation.
 */
export async function sourcevisionFingerprint(projectDir: string): Promise<string> {
  try {
    const raw = await readFile(join(projectDir, ".sourcevision", "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw) as { analyzedAt?: unknown; gitSha?: unknown };
    const analyzedAt = typeof manifest.analyzedAt === "string" ? manifest.analyzedAt : "";
    const gitSha = typeof manifest.gitSha === "string" ? manifest.gitSha : "";
    if (!analyzedAt && !gitSha) return "sv-unknown";
    return createHash("sha256").update(`${analyzedAt} ${gitSha}`).digest("hex").slice(0, 16);
  } catch {
    return "sv-absent";
  }
}

export interface SessionStrategyInput {
  vendor: string;
  provider: "cli" | "api" | string;
  /** `hench.sessionStrategy`, when configured. */
  configured?: string;
}

/**
 * Resolve the session strategy actually available for this run.
 *
 * Forking needs a vendor CLI that can resume a session by id — today that is
 * the Claude CLI alone — and it needs hench to own the spawn, which the API
 * provider does not (it manages its own conversation in-process). Both cases
 * degrade to cold rather than erroring: the strategy is an optimization, and
 * a config value that a vendor cannot honor should cost nothing but the
 * optimization. Batching has no such requirement, so it is honored anywhere.
 */
export function resolveSessionStrategy(input: SessionStrategyInput): SessionStrategy {
  const configured = SESSION_STRATEGIES.includes(input.configured as SessionStrategy)
    ? (input.configured as SessionStrategy)
    : undefined;

  if (configured === "cold") return "cold";
  if (configured === "batch") return "batch";

  // Default (or an explicit "fork"): only the Claude CLI can honor it.
  const canFork = input.vendor === "claude" && input.provider === "cli";
  return canFork ? "fork" : "cold";
}
