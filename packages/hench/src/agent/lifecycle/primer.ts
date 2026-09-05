/**
 * The distilled repo primer, as the orientation session consumes it.
 *
 * ## Why orientation reads a file sourcevision wrote
 *
 * Orientation exists to answer four questions once — layout, build, test,
 * conventions — so no task has to rediscover them. `sourcevision analyze`
 * already distils exactly those four into `.sourcevision/PRIMER.md`, paid for
 * with one LLM call at analysis time. Without this module the orientation
 * session re-derives them from scratch with a full exploration pass, buying
 * nothing the primer did not already have.
 *
 * Seeded with the primer, orientation's job changes from *discover* to
 * *confirm and fill gaps*, which is both cheaper and more accurate — the
 * session can check a stated build command instead of inferring one.
 *
 * ## Why the freshness check is not optional
 *
 * A primer is stamped with the analysis fingerprint it was distilled from. An
 * unchecked read would serve a primer describing the repo as it stood at some
 * earlier commit, and — because the orientation transcript is inherited by
 * every task fork — every task in the loop would act on it confidently. A
 * stale primer is worse than no primer, so a fingerprint mismatch is treated
 * exactly like an absent file: orientation explores as it did before.
 *
 * ## Why hench does not import sourcevision
 *
 * hench's only gateways are rex and llm-client; sourcevision is a sibling
 * domain package it must not import. `.sourcevision/` is read as plain files,
 * the same way {@link sourcevisionFingerprint} already reads `manifest.json`.
 * The cost is a duplicated marker format, held in line by
 * `tests/integration/primer-fingerprint-contract.test.js`.
 *
 * @module hench/agent/lifecycle/primer
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Primer artifact, written by `sourcevision analyze` beside CONTEXT.md. */
export const PRIMER_FILE = "PRIMER.md";

/**
 * Marker line carrying the analysis fingerprint a primer was built from.
 *
 * Duplicated from sourcevision's `stampPrimer` rather than imported — see the
 * module note on why hench cannot import sourcevision.
 */
const FINGERPRINT_PREFIX = "<!-- sourcevision-primer fingerprint:";

/**
 * Read the fingerprint stamped on a primer, or undefined when it carries none.
 *
 * An unstamped primer is not treated as fresh: without a fingerprint there is
 * no way to tell a current primer from one left over from an older analysis,
 * and guessing in the optimistic direction is the failure this check exists to
 * prevent.
 */
export function readPrimerFingerprint(primer: string): string | undefined {
  const firstLine = primer.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith(FINGERPRINT_PREFIX)) return undefined;
  return firstLine.match(/fingerprint:\s*([0-9a-z]+)/i)?.[1];
}

/** Strip the fingerprint marker, leaving the primer prose alone. */
export function stripPrimerMarker(primer: string): string {
  const lines = primer.split("\n");
  if (lines[0]?.startsWith(FINGERPRINT_PREFIX)) lines.shift();
  return lines.join("\n").trim();
}

/**
 * Read `.sourcevision/PRIMER.md` when it was built from the current analysis.
 *
 * Returns the prose body without its marker line, or undefined when the primer
 * is absent, unreadable, empty, unstamped, or stamped against a different
 * analysis. Every one of those is an ordinary state — a primer is written
 * best-effort — so this never throws and never reports; the caller simply
 * orients without a head start.
 *
 * @param projectDir   Project root containing `.sourcevision/`.
 * @param fingerprint  Current analysis fingerprint, from
 *                     {@link sourcevisionFingerprint}.
 */
export async function readFreshPrimer(
  projectDir: string,
  fingerprint: string,
): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(projectDir, ".sourcevision", PRIMER_FILE), "utf-8");
  } catch {
    return undefined;
  }

  if (readPrimerFingerprint(raw) !== fingerprint) return undefined;

  const body = stripPrimerMarker(raw);
  return body.length > 0 ? body : undefined;
}
