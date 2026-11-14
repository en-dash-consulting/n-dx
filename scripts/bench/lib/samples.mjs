/**
 * Parsers for the host readings the benchmark samples, plus the process-table
 * checks. Pure: each takes command or file text and returns numbers; a reading
 * that cannot be found is null, never a guess.
 *
 * Sources: macOS `vm_stat` and `sysctl vm.swapusage`; Linux `/proc/meminfo`
 * and `/proc/vmstat`; `ps -A -o pid=,ppid=,rss=,args=` on both.
 */

/** `vm_stat`: page size, free bytes (free + speculative pages) and the Pageouts counter. */
export function parseVmStat(text) {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? NaN);
  const pages = (label) => {
    const m = new RegExp(`^${label}:\\s+(\\d+)\\.?\\s*$`, "m").exec(text);
    return m ? Number(m[1]) : null;
  };
  const free = pages("Pages free");
  const speculative = pages("Pages speculative") ?? 0;
  return {
    pageSize: Number.isFinite(pageSize) ? pageSize : null,
    freeBytes: free !== null && Number.isFinite(pageSize) ? (free + speculative) * pageSize : null,
    pageouts: pages("Pageouts"),
  };
}

const UNIT_BYTES = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };

/** `sysctl vm.swapusage`: bytes of swap in use. */
export function parseSwapUsage(text) {
  const m = /used\s*=\s*([\d.]+)([KMGT])/i.exec(text);
  return m ? Math.round(Number(m[1]) * UNIT_BYTES[m[2].toUpperCase()]) : null;
}

/** `/proc/meminfo`: available memory and swap in use, bytes. */
export function parseProcMeminfo(text) {
  const kb = (key) => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m").exec(text);
    return m ? Number(m[1]) * 1024 : null;
  };
  const available = kb("MemAvailable") ?? kb("MemFree");
  const swapTotal = kb("SwapTotal");
  const swapFree = kb("SwapFree");
  return {
    freeBytes: available,
    swapUsedBytes: swapTotal !== null && swapFree !== null ? swapTotal - swapFree : null,
  };
}

/** `/proc/vmstat`: pages swapped out since boot (`pswpout`). */
export function parseProcVmstat(text) {
  const m = /^pswpout\s+(\d+)\s*$/m.exec(text);
  return m ? Number(m[1]) : null;
}

/** `ps -A -o pid=,ppid=,rss=,args=` rows. Lines that do not parse are skipped. */
export function parsePs(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s?(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), command: m[4].trim() });
  }
  return rows;
}

/** Summed RSS in bytes of `rootPids` and every process descended from them. */
export function treeRssBytes(rows, rootPids) {
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row);
  }
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const seen = new Set();
  const queue = rootPids.filter((pid) => byPid.has(pid));
  let kb = 0;
  while (queue.length > 0) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    kb += byPid.get(pid).rssKb;
    for (const child of children.get(pid) ?? []) queue.push(child.pid);
  }
  return kb * 1024;
}

/** Processes that would load the machine under the benchmark, each with the reason it matched. */
const BUSY_PATTERNS = [
  { reason: "hench run", pattern: /\bhench\b.*\srun\b/ },
  { reason: "run-all-tests", pattern: /run-all-tests/ },
  { reason: "vitest", pattern: /\bvitest\b/ },
  { reason: "ndx work", pattern: /(?:\b(?:ndx|n-dx)|core\/cli\.js)\s+work\b/ },
];

/**
 * The processes the benchmark refuses to start beside.
 * @param {ReturnType<typeof parsePs>} rows
 * @param {number[]} ignorePids this process and its ancestors
 */
export function findBusyProcesses(rows, ignorePids) {
  const ignore = new Set(ignorePids);
  const busy = [];
  for (const row of rows) {
    if (ignore.has(row.pid)) continue;
    const hit = BUSY_PATTERNS.find((p) => p.pattern.test(row.command));
    if (hit) busy.push({ pid: row.pid, reason: hit.reason, command: row.command });
  }
  return busy;
}

/** `pid` and each ancestor found in `rows`. */
export function ancestorPids(rows, pid) {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const out = [];
  let current = pid;
  while (current > 0 && !out.includes(current)) {
    out.push(current);
    current = byPid.get(current)?.ppid ?? 0;
  }
  return out;
}
