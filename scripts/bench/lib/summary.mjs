/**
 * Summary arithmetic for the benchmark: one row per case and fixture, built
 * from the run records, the batch records and the 2-second samples. Pure.
 *
 * - median wall-clock: per run, from the moment it was started (slot cases: from
 *   asking for the slot) to its exit.
 * - total batch time: summed over repeats, each batch from its first start to
 *   its last exit.
 * - peaks and page-outs: over the samples taken during the group's batches;
 *   page-outs are the counter's rise within each batch, summed.
 * - median queue and exec: over the runs whose record says `slotTaken`.
 */

/** Median of the finite numbers in `values`; null when there are none. */
export function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function maxOf(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length === 0 ? null : Math.max(...nums);
}

function minOf(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length === 0 ? null : Math.min(...nums);
}

/** Rise of a monotonic counter across `samples`; null when fewer than one reading. */
export function counterRise(samples, key) {
  const readings = samples.map((s) => s[key]).filter((v) => Number.isFinite(v));
  if (readings.length === 0) return null;
  return Math.max(0, readings[readings.length - 1] - readings[0]);
}

/**
 * @param {{ runs: object[], batches: object[], samples: object[] }} data
 * @returns {object[]} rows ordered by fixture, then case
 */
export function summarize({ runs, batches, samples }) {
  const groups = new Map();
  for (const batch of batches) {
    const key = `${batch.fixture}\u0000${batch.caseId}`;
    if (!groups.has(key)) groups.set(key, { caseId: batch.caseId, fixture: batch.fixture, batches: [] });
    groups.get(key).batches.push(batch);
  }

  const rows = [];
  for (const group of groups.values()) {
    const ids = new Set(group.batches.map((b) => b.batchId));
    const groupRuns = runs.filter((r) => ids.has(r.batchId));
    const slotRuns = groupRuns.filter((r) => r.slotTaken === true);
    const groupSamples = samples.filter((s) => ids.has(s.batchId));
    const pageoutRises = group.batches
      .map((b) => counterRise(groupSamples.filter((s) => s.batchId === b.batchId), "pageouts"))
      .filter((v) => v !== null);
    rows.push({
      caseId: group.caseId,
      fixture: group.fixture,
      runs: groupRuns.length,
      medianWallMs: median(groupRuns.map((r) => r.wallMs)),
      totalBatchMs: group.batches.reduce((sum, b) => sum + (b.endMs - b.startMs), 0),
      peakRssBytes: maxOf(groupSamples.map((s) => s.rssBytes)),
      peakSwapBytes: maxOf(groupSamples.map((s) => s.swapUsedBytes)),
      minFreeBytes: minOf(groupSamples.map((s) => s.freeBytes)),
      peakLoad: maxOf(groupSamples.map((s) => s.load1)),
      pageouts: pageoutRises.length === 0 ? null : pageoutRises.reduce((a, b) => a + b, 0),
      failures: groupRuns.filter((r) => r.exitCode !== 0).length,
      timeouts: groupRuns.filter((r) => r.timedOut).length,
      testTimeouts: groupRuns.reduce((sum, r) => sum + (r.testTimeouts ?? 0), 0),
      // Only a run that took the slot has a queue; any other queue figure is an artefact.
      medianQueueMs: median(slotRuns.map((r) => r.queueMs)),
      medianExecMs: median(slotRuns.map((r) => r.execMs)),
    });
  }
  return rows.sort((a, b) => a.fixture.localeCompare(b.fixture) || a.caseId.localeCompare(b.caseId));
}

const fmtMs = (ms) => (ms === null ? "–" : `${(ms / 60_000).toFixed(1)} min`);
const fmtSec = (ms) => (ms === null ? "–" : `${(ms / 1000).toFixed(0)} s`);
const fmtGiB = (bytes) => (bytes === null ? "–" : `${(bytes / 1024 ** 3).toFixed(2)} GiB`);
const fmtNum = (n) => (n === null ? "–" : String(n));

/** The Markdown summary written beside the JSON lines. */
export function renderSummaryMarkdown(rows, meta) {
  const lines = [
    "# Validation benchmark",
    "",
    `- Commit: \`${meta.commit}\``,
    `- Machine: ${meta.machine}`,
    `- Started: ${meta.startedAt}; finished: ${meta.finishedAt}`,
    `- Cases: ${meta.cases.join(", ")}; fixtures: ${meta.fixtures.join(", ")}; repeat: ${meta.repeat}; concurrency: ${meta.concurrency}`,
    "",
    "| Fixture | Case | Runs | Median wall | Total batch | Peak RSS | Peak swap | Min free | Page-outs | Peak load | Failures | Timeouts (run/test) | Median queue | Median exec |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.fixture} | ${r.caseId} | ${r.runs} | ${fmtMs(r.medianWallMs)} | ${fmtMs(r.totalBatchMs)} | ${fmtGiB(r.peakRssBytes)} | ${fmtGiB(r.peakSwapBytes)} | ${fmtGiB(r.minFreeBytes)} | ${fmtNum(r.pageouts)} | ${r.peakLoad === null ? "–" : r.peakLoad.toFixed(1)} | ${r.failures} | ${r.timeouts}/${r.testTimeouts} | ${fmtSec(r.medianQueueMs)} | ${fmtSec(r.medianExecMs)} |`,
    );
  }
  lines.push(
    "",
    "Peak RSS sums every process under the batch's runs. Page-outs are pages written out during the batch. Queue and exec count only runs that took the host slot (`slotTaken` in `runs.jsonl`: cases D, E, G and H); other rows show –. Raw data: `runs.jsonl`, `batches.jsonl`, `samples.jsonl`.",
    "",
  );
  return lines.join("\n");
}
