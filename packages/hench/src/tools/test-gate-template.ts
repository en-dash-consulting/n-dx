/**
 * Pure helpers for `hench.testGate.command`: filling the `{base}` placeholder
 * and reading back which suites the gate command says it selected.
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

/**
 * Suites named by a `test-gate: selected-suites=<comma list>` line, or
 * undefined when the output has no such line. The last such line wins; an
 * empty list is a real answer (nothing selected) and is returned as `[]`.
 */
export function parseSelectedSuites(output: string): string[] | undefined {
  let suites: string[] | undefined;
  for (const line of output.split(/\r?\n/)) {
    const match = SELECTED_SUITES_LINE.exec(line.trim());
    if (match) {
      suites = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return suites;
}
