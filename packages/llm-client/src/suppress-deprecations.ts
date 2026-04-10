/**
 * Process-level filter for known Node.js built-in deprecation warnings.
 *
 * ## Purpose
 *
 * Certain Node.js built-in modules emit `DeprecationWarning` when loaded as a
 * transitive dependency. The root causes should be eliminated where possible,
 * but future dependency upgrades can silently reintroduce them. This module
 * provides a narrow, explicit allowlist-based filter as a belt-and-suspenders
 * guard for all n-dx CLI entry points.
 *
 * ## Design
 *
 * Overrides `process.emitWarning` to intercept warnings _before_ emission.
 * `process.on('warning', ...)` is intentionally NOT used: Node.js prints
 * warnings through its own built-in listener regardless of any user-registered
 * handlers, so listening would duplicate output rather than suppress it.
 * Overriding `process.emitWarning` prevents the event from being created at all
 * for silenced codes, so neither the default handler nor any user handler sees it.
 *
 * Only `DeprecationWarning` codes in the explicit allowlist are silenced.
 * All other warnings — including application-level and user-generated warnings —
 * pass through completely unchanged.
 *
 * ## Allowlist policy
 *
 * Add a code only when ALL of the following are true:
 *   1. The root cause has been traced (which dep introduces it).
 *   2. The root cause either cannot be eliminated (transitive dep we don't own)
 *      or has already been fixed but the guard remains for safety.
 *   3. The warning is a Node.js built-in DeprecationWarning (DEP prefix).
 *
 * @module llm-client/suppress-deprecations
 */

/**
 * Node.js built-in deprecation codes that are safe to suppress.
 *
 * Each entry requires an inline justification comment.
 * Keep the set small — if in doubt, leave it out.
 */
const SILENCED_DEPRECATION_CODES = new Set<string>([
  // punycode — deprecated built-in Node.js module. Root cause traced and fixed
  // (transitive dep replaced). Guard retained against future dependency upgrades
  // silently reintroducing it.
  "DEP0040",
]);

const FILTER_INSTALLED = Symbol.for("n-dx.suppressKnownDeprecations.installed");

/**
 * Install a process-level filter that suppresses known Node.js built-in
 * deprecation warnings without affecting application or user-generated warnings.
 *
 * Must be called from CLI entry points as early as possible (after imports,
 * before any lazy requires that might trigger the targeted deprecations).
 * Calling it more than once is harmless but redundant — subsequent calls
 * re-wrap the already-filtered function.
 */
export function suppressKnownDeprecations(): void {
  if ((process as typeof process & { [FILTER_INSTALLED]?: boolean })[FILTER_INSTALLED]) {
    return;
  }

  const original = process.emitWarning;

  process.emitWarning = (function filteredEmitWarning(
    warning: string | Error,
    typeOrOptions?: string | { type?: string; code?: string; detail?: string },
    code?: string,
    ctor?: Function,
  ): void {
    // Resolve the effective type and code across both calling conventions:
    //   (message, type, code, ctor) — positional
    //   (message, { type, code })   — options object
    let effectiveCode: string | undefined;
    let effectiveType: string | undefined;

    if (
      typeOrOptions !== null &&
      typeOrOptions !== undefined &&
      typeof typeOrOptions === "object"
    ) {
      effectiveCode = typeOrOptions.code;
      effectiveType = typeOrOptions.type;
    } else {
      effectiveType =
        typeof typeOrOptions === "string" ? typeOrOptions : undefined;
      effectiveCode = code;
    }

    if (
      effectiveType === "DeprecationWarning" &&
      effectiveCode !== undefined &&
      SILENCED_DEPRECATION_CODES.has(effectiveCode)
    ) {
      return; // Known built-in deprecation noise — suppress
    }

    // All other warnings pass through without modification
    Reflect.apply(original, process, [warning, typeOrOptions, code, ctor]);
  }) as typeof process.emitWarning;

  (process as typeof process & { [FILTER_INSTALLED]?: boolean })[FILTER_INSTALLED] = true;
}
