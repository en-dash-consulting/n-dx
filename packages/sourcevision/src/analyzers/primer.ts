/**
 * Repo primer — the distilled startup context every agent run inherits.
 *
 * ## Why this exists
 *
 * `ndx work` pipes CONTEXT.md plus a PRD excerpt into every task spawn. Even
 * capped, that is a document written for breadth: zone metrics, findings, route
 * tables, import summaries. A task starting work needs far less — where things
 * live, how to build and test, what the conventions are — and it needs it on
 * every task and every retry, which is what makes the difference worth paying
 * one LLM call for.
 *
 * ## Why it lives in sourcevision
 *
 * The distillation is an artifact-generation step, and sourcevision already
 * owns artifact generation, content-hash caching, and the single `callClaude`
 * choke point with task-class routing. The alternative — distilling in the
 * orchestration tier, where the pipe is assembled — would mean importing an
 * LLM client into a tier that is only allowed to spawn CLIs. So the primer is
 * written next to the other artifacts and the orchestrator merely *reads* it,
 * which also makes it available to anything else that wants a short repo
 * description.
 *
 * ## Failure posture
 *
 * A primer is an optimization. Any failure — no LLM configured, a refusal,
 * output that breaks its contract — leaves no primer, and consumers fall back
 * to CONTEXT.md exactly as before.
 *
 * @module sourcevision/analyzers/primer
 */

import { createHash } from "node:crypto";
import type { Manifest } from "../schema/index.js";

/** Artifact filename, written beside CONTEXT.md. */
export const PRIMER_FILE = "PRIMER.md";

/**
 * Upper bound for a primer, in characters.
 *
 * The design calls for 5–10 KB. This is the hard ceiling above which the
 * output is rejected rather than truncated: a primer cut mid-sentence would
 * be inherited by every task in the loop, and a missing primer (falling back
 * to CONTEXT.md) is strictly better than a corrupt one.
 */
export const PRIMER_MAX_CHARS = 12_000;

/** Lower bound — below this the model plainly did not answer. */
export const PRIMER_MIN_CHARS = 200;

/** Marker line carrying the fingerprint the primer was built from. */
const FINGERPRINT_PREFIX = "<!-- sourcevision-primer fingerprint:";

/**
 * Fingerprint the analysis a primer was built from.
 *
 * Uses the two manifest fields that change on exactly the events that
 * invalidate a primer — a re-analysis, or an analysis of a different commit —
 * so the check costs one small read rather than hashing the artifact tree.
 */
export function primerFingerprint(manifest: Manifest | null | undefined): string {
  const analyzedAt = typeof manifest?.analyzedAt === "string" ? manifest.analyzedAt : "";
  const gitSha = typeof (manifest as { gitSha?: unknown } | null)?.gitSha === "string"
    ? (manifest as { gitSha: string }).gitSha
    : "";
  if (!analyzedAt && !gitSha) return "unknown";
  return createHash("sha256").update(`${analyzedAt} ${gitSha}`).digest("hex").slice(0, 16);
}

/** Wrap a primer body with its fingerprint marker for caching. */
export function stampPrimer(body: string, fingerprint: string): string {
  return `${FINGERPRINT_PREFIX} ${fingerprint} -->\n\n${body.trim()}\n`;
}

/** Read the fingerprint out of a stamped primer, or undefined when absent. */
export function readPrimerFingerprint(primer: string): string | undefined {
  const firstLine = primer.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith(FINGERPRINT_PREFIX)) return undefined;
  const match = firstLine.match(/fingerprint:\s*([0-9a-z]+)/i);
  return match?.[1];
}

/** True when a cached primer was built from the current analysis. */
export function isPrimerFresh(
  primer: string | null | undefined,
  fingerprint: string,
): boolean {
  if (!primer) return false;
  return readPrimerFingerprint(primer) === fingerprint;
}

/**
 * Prompt for the distillation call.
 *
 * Asks for the four things a task actually needs, and forbids the things
 * CONTEXT.md already carries — metrics, findings, exhaustive listings — since
 * reproducing those would defeat the purpose of distilling.
 */
export function buildPrimerPrompt(contextMd: string): string {
  return [
    "Below is an automated analysis of a codebase. Distil it into a short primer for an",
    "engineer about to make a change in this repository. Target 300–600 words.",
    "",
    "Cover exactly these, in this order, as prose or short lists:",
    "1. Layout — the top-level structure, and which directories hold production code",
    "   versus tests.",
    "2. Build and test commands — state them verbatim as commands.",
    "3. Conventions — language and module style, test framework, and any repository",
    "   rules that constrain how code is written here.",
    "4. Anything that would waste a newcomer's first hour.",
    "",
    "Do not include: zone cohesion or coupling numbers, finding lists, route tables,",
    "import statistics, or file inventories. Those are available elsewhere and are the",
    "bulk this primer exists to replace. Do not speculate — if the analysis does not",
    "say something, leave it out. Output the primer only, with no preamble.",
    "",
    "## Analysis",
    contextMd,
  ].join("\n");
}

/**
 * Validate a distilled primer.
 *
 * Rejection rather than repair: consumers fall back to CONTEXT.md, so an
 * absent primer is a known-good state while a mangled one would be inherited
 * by every task in the loop.
 *
 * @throws when the response is not a usable primer.
 */
export function validatePrimer(text: string): string {
  const body = (text ?? "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("```"))
    .join("\n")
    .trim();

  if (body.length < PRIMER_MIN_CHARS) {
    throw new Error(
      `Primer too short (${body.length} chars, minimum ${PRIMER_MIN_CHARS}) — ` +
        "the model did not answer.",
    );
  }
  if (body.length > PRIMER_MAX_CHARS) {
    throw new Error(
      `Primer too long (${body.length} chars, maximum ${PRIMER_MAX_CHARS}) — ` +
        "the distillation did not distil.",
    );
  }
  return body;
}

export interface GeneratePrimerOptions {
  /** CONTEXT.md content to distil. */
  contextMd: string;
  /** Manifest, for the cache fingerprint. */
  manifest: Manifest | null | undefined;
  /** Existing primer, if any, used to skip regeneration. */
  cachedPrimer?: string | null;
  /**
   * LLM call, injected so this module stays testable without a live vendor.
   * Should route the `context.distill` task class.
   */
  call: (prompt: string) => Promise<{ text: string }>;
}

export type GeneratePrimerResult =
  | { status: "cached"; primer: string }
  | { status: "generated"; primer: string }
  | { status: "skipped"; reason: string };

/**
 * Produce a stamped primer, reusing a cached one whose fingerprint still
 * matches.
 *
 * Never throws: a failure returns `skipped` with the reason, and the caller
 * keeps whatever it had.
 */
export async function generatePrimer(
  opts: GeneratePrimerOptions,
): Promise<GeneratePrimerResult> {
  const fingerprint = primerFingerprint(opts.manifest);

  if (isPrimerFresh(opts.cachedPrimer, fingerprint)) {
    return { status: "cached", primer: opts.cachedPrimer as string };
  }
  if (!opts.contextMd?.trim()) {
    return { status: "skipped", reason: "no CONTEXT.md to distil" };
  }

  try {
    const { text } = await opts.call(buildPrimerPrompt(opts.contextMd));
    return { status: "generated", primer: stampPrimer(validatePrimer(text), fingerprint) };
  } catch (err) {
    return { status: "skipped", reason: (err as Error).message };
  }
}
