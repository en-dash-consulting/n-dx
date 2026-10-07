/**
 * Pure helpers for `hench.testGate.command` and `hench.testGate.rerunCommand`:
 * filling the `{base}` and `{suites}` placeholders, and reading back which
 * suites the gate command says it selected and which failed.
 *
 * No I/O here — the resolver and the gate own the side effects.
 */

/** Placeholder replaced by the commit the run's diff is measured from. */
export const GATE_BASE_PLACEHOLDER = "{base}";

/**
 * A value that may be substituted into a shell command. Hex only: the base
 * lands in a command line, so anything else (a ref name, a stray newline,
 * `;`) is refused rather than quoted.
 */
const GATE_BASE_PATTERN = /^[0-9a-f]{7,40}$/;

export function isGateBase(value: unknown): value is string {
  return typeof value === "string" && GATE_BASE_PATTERN.test(value);
}

export type GateTemplateResult =
  /** `base` is set only when the template used `{base}`. */
  | { ok: true; command: string; base?: string }
  /** The template needs a base and none valid is known. */
  | { ok: false; reason: string };

/**
 * Fill `template` with `base`.
 *
 * A template without `{base}` is returned as written. One with it and no valid
 * base is refused — a half-substituted command must never reach a shell.
 */
export function applyGateTemplate(template: string, base: string | undefined): GateTemplateResult {
  if (!template.includes(GATE_BASE_PLACEHOLDER)) {
    return { ok: true, command: template };
  }
  if (!isGateBase(base)) {
    return {
      ok: false,
      reason: base
        ? `the run's start commit "${base}" is not a hex SHA`
        : "the run's start commit is unknown",
    };
  }
  return { ok: true, command: template.split(GATE_BASE_PLACEHOLDER).join(base), base };
}

const SELECTED_SUITES_LINE = /^test-gate: selected-suites=(.*)$/;
const FAILED_SUITES_LINE = /^test-gate: failed-suites=(.*)$/;

/** The last `test-gate: <key>=<comma list>` line's labels, or undefined if none. */
function parseSuitesLine(output: string, pattern: RegExp): string[] | undefined {
  let suites: string[] | undefined;
  for (const line of output.split(/\r?\n/)) {
    const match = pattern.exec(line.trim());
    if (match) {
      suites = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return suites;
}

/**
 * Suites named by a `test-gate: selected-suites=<comma list>` line, or
 * undefined when the output has no such line. The last such line wins; an
 * empty list is a real answer (nothing selected) and is returned as `[]`.
 */
export function parseSelectedSuites(output: string): string[] | undefined {
  return parseSuitesLine(output, SELECTED_SUITES_LINE);
}

/** Suites named by the last `test-gate: failed-suites=<comma list>` line. */
export function parseFailedSuites(output: string): string[] | undefined {
  return parseSuitesLine(output, FAILED_SUITES_LINE);
}

/** Placeholder in `hench.testGate.rerunCommand` replaced by the failed suites. */
export const RERUN_SUITES_PLACEHOLDER = "{suites}";

/** A suite label safe to put on a command line unquoted. */
const SUITE_LABEL_PATTERN = /^[A-Za-z0-9@/._-]+$/;

export type RerunPlan =
  | { ok: true; command: string; suites: string[] }
  | { ok: false; reason: string };

/**
 * The re-run command for a failed gate: `template` with `{suites}` replaced by
 * the labels on its `test-gate: failed-suites=` line, comma-joined.
 *
 * Refused when the line is missing or empty, when any label is not plainly
 * safe for a shell, or when the template has no `{suites}` — re-running the
 * whole gate is not a re-run of what failed.
 */
export function planRerun(template: string, gateOutput: string): RerunPlan {
  if (!template.includes(RERUN_SUITES_PLACEHOLDER)) {
    return { ok: false, reason: `the template has no ${RERUN_SUITES_PLACEHOLDER}` };
  }
  const suites = parseFailedSuites(gateOutput);
  if (!suites || suites.length === 0) {
    return { ok: false, reason: "the gate output named no failed suites (no test-gate: failed-suites= line)" };
  }
  const unsafe = suites.find((s) => !SUITE_LABEL_PATTERN.test(s));
  if (unsafe !== undefined) {
    return { ok: false, reason: `failed-suite label "${unsafe}" is not safe for a command line` };
  }
  return { ok: true, command: template.split(RERUN_SUITES_PLACEHOLDER).join(suites.join(",")), suites };
}
