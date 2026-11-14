/**
 * Reads one `scripts/run-all-tests.mjs` run's output into per-suite results.
 *
 * The runner prints a `──────── <label> ────────` banner before each suite and
 * `──────── summary ────────` after the last, then one `PASS|FAIL  <label>`
 * line per suite and the `test-gate:` protocol lines. Each output line comes
 * in with the time it arrived, so a suite's duration is the gap from its
 * banner to the next one.
 */

const BANNER = /^──────── (.+) ────────$/;
const RESULT = /^\s+(PASS|FAIL)\s{2}(.+?)\s*(?:→\s.*)?$/;
const PROTOCOL = /^test-gate: (selected-suites|failed-suites|stale-dist)=(.*)$/;
/** vitest's message for a test or hook that ran out of time. */
const VITEST_TIMEOUT = /\b(?:Test|Hook) timed out in \d+ms/;

/**
 * Split streamed chunks into timestamped lines. Feed every chunk, then `flush()`.
 * @returns {{ push(chunk: string, t: number): void, flush(t: number): void, lines: { t: number, line: string }[] }}
 */
export function createLineCollector() {
  const lines = [];
  let partial = "";
  return {
    lines,
    push(chunk, t) {
      const parts = (partial + chunk).split(/\r?\n/);
      partial = parts.pop();
      for (const line of parts) lines.push({ t, line });
    },
    flush(t) {
      if (partial) lines.push({ t, line: partial });
      partial = "";
    },
  };
}

const list = (value) => value.split(",").map((s) => s.trim()).filter(Boolean);

/**
 * @param {{ t: number, line: string }[]} lines
 * @returns {{ selectedSuites: string[] | null, failedSuites: string[] | null, staleDist: string[] | null,
 *   suites: { label: string, ok: boolean | null, durationMs: number | null }[], testTimeouts: number }}
 */
export function parseGateOutput(lines) {
  const result = { selectedSuites: null, failedSuites: null, staleDist: null, suites: [], testTimeouts: 0 };
  const banners = [];
  const outcomes = new Map();
  let inSummary = false;

  for (const { t, line } of lines) {
    const protocol = PROTOCOL.exec(line);
    if (protocol) {
      const key = { "selected-suites": "selectedSuites", "failed-suites": "failedSuites", "stale-dist": "staleDist" }[protocol[1]];
      result[key] = list(protocol[2]);
      continue;
    }
    const banner = BANNER.exec(line);
    if (banner) {
      banners.push({ label: banner[1], t });
      inSummary = banner[1] === "summary";
      continue;
    }
    if (inSummary) {
      const outcome = RESULT.exec(line);
      if (outcome) outcomes.set(outcome[2], outcome[1] === "PASS");
      continue;
    }
    if (VITEST_TIMEOUT.test(line)) result.testTimeouts++;
  }

  for (let i = 0; i < banners.length; i++) {
    const { label, t } = banners[i];
    if (label === "summary") continue;
    const next = banners[i + 1];
    result.suites.push({
      label,
      ok: outcomes.has(label) ? outcomes.get(label) : null,
      durationMs: next ? next.t - t : null,
    });
  }
  return result;
}
