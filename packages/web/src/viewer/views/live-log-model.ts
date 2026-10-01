/**
 * The Log tab's reading of a run's terminal output, kept pure so the whole
 * log — not only the part on screen — can be filtered and searched, and so
 * windowing is testable without a DOM. `live-log.ts` only lays it out.
 *
 * Hench writes `  [Label]    text` per stream line (see `stream()` in hench's
 * `types/output.ts`); a line without a label continues the one before it. The
 * label decides the colour class and which filters keep the line.
 *
 * @module web/viewer/views/live-log-model
 */

/** What a line is, for colour and for the filters. */
export type LogClass = "turn" | "tool" | "test" | "error" | "gate" | "plain";

export type LogFilter = "all" | "tools" | "tests" | "errors" | "turns";

export const LOG_FILTERS: ReadonlyArray<{ id: LogFilter; label: string }> = [
  { id: "all", label: "Everything" },
  { id: "tools", label: "Tool calls" },
  { id: "tests", label: "Tests" },
  { id: "errors", label: "Errors and retries" },
  { id: "turns", label: "Model turns" },
];

/** The legend: one entry per colour class. */
export const LOG_LEGEND: ReadonlyArray<{ cls: LogClass; label: string }> = [
  { cls: "turn", label: "Model turn" },
  { cls: "tool", label: "Tool call and result" },
  { cls: "test", label: "Tests" },
  { cls: "error", label: "Error" },
  { cls: "gate", label: "Retry or gate" },
];

const LABEL_CLASS: Readonly<Record<string, LogClass>> = {
  Agent: "turn",
  Tool: "tool",
  Result: "tool",
  Tests: "test",
  "Test Gate": "test",
  Error: "error",
  Warning: "error",
  Cancelled: "error",
  Retry: "gate",
  Failover: "gate",
  Budget: "gate",
  Verifier: "gate",
};

export interface LogLine {
  /** 1-based position in the log, ANSI codes and all. */
  n: number;
  /** Display text: ANSI colour codes removed, any timestamp prefix removed. */
  text: string;
  cls: LogClass;
  /** The `[Label]` this line carries or continues, or null before the first. */
  label: string | null;
  /** 1-based model turn this line belongs to; 0 before the first. */
  turn: number;
  /** True on the line that begins a model turn. */
  turnStart: boolean;
  /** Leading ISO timestamp the log recorded for the line, or null. */
  at: string | null;
}

// Terminal colour codes; built from a string so the control character is not
// a literal in the source.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");
const LABELLED = /^\s*\[([^\]]+)\]/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/**
 * The log held on the page: every line of it, appended to as chunks arrive.
 * Chunks may end mid-line; the unfinished tail waits for its newline.
 */
export class LogBuffer {
  lines: LogLine[] = [];
  /** True once any line carried a timestamp prefix. */
  timestamps = false;
  /** Bumps on every change, so memoised views know to recompute. */
  version = 0;
  private chunks: string[] = [];
  private pending = "";
  private turn = 0;
  private label: string | null = null;
  private cls: LogClass = "plain";

  /** Highest turn number so far. */
  get turns(): number {
    return this.turn;
  }

  append(chunk: string): void {
    if (!chunk) return;
    this.chunks.push(chunk);
    const parts = (this.pending + chunk).split("\n");
    this.pending = parts.pop() ?? "";
    for (const raw of parts) this.push(raw);
    this.version++;
  }

  /** Forget everything — the log was replaced (cursor past its end). */
  reset(): void {
    this.lines = [];
    this.chunks = [];
    this.pending = "";
    this.turn = 0;
    this.label = null;
    this.cls = "plain";
    this.timestamps = false;
    this.version++;
  }

  /** The complete log, byte for byte as received. */
  raw(): string {
    return this.chunks.join("");
  }

  /** The unfinished last line, if the log does not end in a newline. */
  get unfinished(): string {
    return stripAnsi(this.pending);
  }

  private push(raw: string): void {
    const clean = stripAnsi(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
    const stamp = TIMESTAMP.exec(clean);
    if (stamp) this.timestamps = true;
    const text = stamp ? clean.slice(stamp[0].length) : clean;
    const labelled = LABELLED.exec(text);
    let turnStart = false;
    if (labelled) {
      const previous = this.label;
      this.label = labelled[1]!;
      this.cls = LABEL_CLASS[this.label] ?? "plain";
      if (this.label === "Agent" && previous !== "Agent") {
        this.turn++;
        turnStart = true;
      }
    }
    this.lines.push({
      n: this.lines.length + 1,
      text,
      cls: this.cls,
      label: this.label,
      turn: this.turn,
      turnStart,
      at: stamp ? stamp[1]! : null,
    });
  }
}

/** Whether `line` survives `filter`. */
export function matchesFilter(line: LogLine, filter: LogFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "tools": return line.cls === "tool";
    case "tests": return line.cls === "test";
    case "errors": return line.cls === "error" || line.cls === "gate";
    case "turns": return line.cls === "turn";
  }
}

/** Indices (into `lines`) of every line the filter keeps — the whole log, not a window. */
export function filterIndices(lines: readonly LogLine[], filter: LogFilter): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) if (matchesFilter(lines[i]!, filter)) out.push(i);
  return out;
}

/** Positions (into `visible`) of every line containing `query`, case-insensitively. */
export function searchMatches(lines: readonly LogLine[], visible: readonly number[], query: string): number[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const out: number[] = [];
  for (let at = 0; at < visible.length; at++) {
    if (lines[visible[at]!]!.text.toLowerCase().includes(needle)) out.push(at);
  }
  return out;
}

/** Splits `text` around case-insensitive occurrences of `query`; odd entries are the matches. */
export function splitMatches(text: string, query: string): string[] {
  if (!query) return [text];
  const needle = query.toLowerCase();
  const hay = text.toLowerCase();
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    parts.push(text.slice(from, at), text.slice(at, at + needle.length));
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}

/** First position in `visible` at or after the start of `turn`, or -1 when no such line is kept. */
export function positionOfTurn(lines: readonly LogLine[], visible: readonly number[], turn: number): number {
  for (let at = 0; at < visible.length; at++) {
    if (lines[visible[at]!]!.turn >= turn && lines[visible[at]!]!.turn > 0) return at;
  }
  return -1;
}

// ── Windowing ────────────────────────────────────────────────────────

export const ROW_HEIGHT = 20;
const OVERSCAN = 20;

/** The rows to put in the DOM: `[start, end)` of the visible list. */
export function windowRange(scrollTop: number, viewportHeight: number, count: number): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(count, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  return { start, end: Math.max(start, end) };
}

/** Scroll offset that brings row `position` to the top third of a viewport. */
export function scrollTopFor(position: number, viewportHeight: number): number {
  return Math.max(0, position * ROW_HEIGHT - Math.floor(viewportHeight / 3));
}

// ── Header line ──────────────────────────────────────────────────────

/** What started the run, as far as the run record knows. */
export function startedLine(taskId: string, startedFrom: "dashboard" | "terminal" | null): string {
  if (startedFrom === "dashboard") return `Started from the dashboard: n-dx work --task=${taskId} --auto`;
  if (startedFrom === "terminal") return "Started from a terminal";
  return "How this run was started is no longer recorded";
}
