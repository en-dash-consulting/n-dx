/**
 * The running-task page's Log tab: what the terminal shows for the run,
 * streamed from the log tail route and held on the page in full so filters,
 * search and Download cover the whole log. Only the rows in view are in the
 * DOM (fixed-height rows, windowed by scroll offset), so a log of tens of
 * thousands of lines scrolls like a short one. Reading is `live-log-model.ts`.
 *
 * @module web/viewer/views/live-log
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useEffect, useRef, useMemo, useCallback } from "preact/hooks";
import type { LiveTaskRun } from "../hooks/index.js";
import { useCliName } from "../hooks/use-project-metadata.js";
import {
  LOG_FILTERS,
  LOG_LEGEND,
  LogBuffer,
  ROW_HEIGHT,
  filterIndices,
  positionOfTurn,
  reviewLogStart,
  scrollTopFor,
  searchMatches,
  splitMatches,
  startedLine,
  windowRange,
  type LogFilter,
  type LogLine,
} from "./live-log-model.js";

/** New lines show within a second of being written. */
const LOG_POLL_MS = 500;
/** Rows assumed in view before the viewport has been measured. */
const FALLBACK_VIEWPORT_PX = 600;
/** Closer to the bottom than this counts as "at the bottom". */
const BOTTOM_SLACK_PX = 4;

interface LogChunkBody {
  content: string;
  next: number;
  reset: boolean;
  more: boolean;
}

/** Follows a run's log into `buffer`; returns a change counter and whether the log is missing. */
function useRunLog(run: LiveTaskRun, buffer: LogBuffer): { version: number; missing: boolean } {
  const [version, setVersion] = useState(0);
  const [missing, setMissing] = useState(false);
  const cursorRef = useRef(0);
  const running = run.status === "running";

  // A different run is a different log.
  useEffect(() => {
    buffer.reset();
    cursorRef.current = 0;
    setMissing(false);
    setVersion(buffer.version);
  }, [run.runId, buffer]);

  // Read to the end now, then keep reading while the run runs. When it stops,
  // this runs once more and picks up whatever was written last.
  useEffect(() => {
    let cancelled = false;
    // One read at a time: two reads from the same cursor would append the same
    // chunk twice. A tick that lands mid-read asks for one follow-up instead.
    let inFlight = false;
    let again = false;
    const read = async () => {
      if (inFlight) { again = true; return; }
      inFlight = true;
      try {
        for (;;) {
          const from = cursorRef.current;
          const res = await fetch(`/api/hench/runs/${encodeURIComponent(run.runId)}/log?from=${from}`);
          if (cancelled) return;
          if (!res.ok) { setMissing(true); return; }
          const body = await res.json() as LogChunkBody;
          if (cancelled) return;
          cursorRef.current = body.next;
          if (body.reset) buffer.reset();
          buffer.append(body.content);
          if (body.content || body.reset) setVersion(buffer.version);
          // The server reports `more` while bytes remain, but a log that ends
          // inside a multi-byte character yields nothing until the rest is written.
          if (!body.more || (!body.reset && body.next === from)) return;
        }
      } catch {
        // The next tick reads from the same cursor.
      } finally {
        inFlight = false;
        if (again && !cancelled) { again = false; void read(); }
      }
    };
    void read();
    const id = running ? setInterval(() => { void read(); }, LOG_POLL_MS) : null;
    return () => { cancelled = true; if (id) clearInterval(id); };
  }, [run.runId, running, buffer]);

  return { version, missing };
}

function download(runId: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${runId}.log`;
  a.click();
  URL.revokeObjectURL(url);
}

function Row({ line, query, current, showTime }: { line: LogLine; query: string; current: boolean; showTime: boolean }) {
  const parts = splitMatches(line.text, query);
  return h("div", {
    class: `live-logrow live-logrow-${line.cls}${line.turnStart ? " live-logrow-turnstart" : ""}${current ? " live-logrow-current" : ""}`,
  },
    h("span", { class: "live-logrow-n" }, line.n),
    showTime ? h("span", { class: "live-logrow-time" }, line.at ? line.at.slice(11, 19) : "") : null,
    line.turnStart ? h("span", { class: "live-logrow-tag" }, `Turn ${line.turn}`) : null,
    h("span", { class: "live-logrow-text" },
      parts.map((part, i) => (i % 2 === 1 ? h("mark", { key: i }, part) : part))),
  );
}

/**
 * @param part "review" shows only the review part of the log: from the line
 *   where the adversarial review began to the end.
 */
export function LogTab({ run, taskId, part }: { run: LiveTaskRun; taskId: string; part?: "review" }) {
  const cliName = useCliName();
  const buffer = useMemo(() => new LogBuffer(), []);
  const { version, missing } = useRunLog(run, buffer);

  const [filter, setFilter] = useState<LogFilter>("all");
  const [query, setQuery] = useState("");
  const [showTime, setShowTime] = useState(false);
  const [follow, setFollow] = useState(true);
  const [matchAt, setMatchAt] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);

  // A finished run writes no more, so its unterminated last line is complete;
  // a running one may still be mid-line.
  const finished = run.status !== "running";
  const lines = useMemo(() => {
    const tail = finished ? buffer.tail() : null;
    return tail ? [...buffer.lines, tail] : buffer.lines;
  }, [buffer, version, finished]);
  const from = part === "review" ? reviewLogStart(lines) : 0;
  const visible = useMemo(
    () => filterIndices(lines, filter).filter((i) => from >= 0 && i >= from),
    [lines, version, filter, from],
  );
  const matches = useMemo(() => searchMatches(lines, visible, query), [lines, version, visible, query]);
  const currentMatch = matches.length > 0 ? matches[Math.min(matchAt, matches.length - 1)]! : -1;

  const viewH = viewport.current?.clientHeight || FALLBACK_VIEWPORT_PX;
  const { start, end } = windowRange(scrollTop, viewH, visible.length);

  const scrollToPosition = useCallback((position: number) => {
    const el = viewport.current;
    if (el && position >= 0) el.scrollTop = scrollTopFor(position, el.clientHeight || FALLBACK_VIEWPORT_PX);
  }, []);

  // Following: stay on the newest line as the log grows.
  useEffect(() => {
    const el = viewport.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [follow, version, visible.length]);

  const onScroll = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX);
  }, []);

  const step = (by: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (Math.min(matchAt, matches.length - 1) + by + matches.length) % matches.length;
    setMatchAt(next);
    scrollToPosition(matches[next]!);
  };

  if (missing) return h("p", { class: "live-muted" }, "No log was recorded for this run.");
  if (part === "review" && from < 0) {
    return h("p", { class: "live-muted", role: "status" }, "The review has not written to the log yet.");
  }

  const turns = Array.from({ length: lines[lines.length - 1]?.turn ?? 0 }, (_, i) => i + 1);
  const rows: ComponentChildren[] = [];
  for (let at = start; at < end; at++) {
    const line = lines[visible[at]!]!;
    rows.push(h(Row, { key: line.n, line, query, current: at === currentMatch, showTime }));
  }
  const count = lines.length;

  return h("div", { class: "live-log" },
    h("p", { class: "live-log-source" },
      startedLine(taskId, run.startedFrom, cliName, run.resetDeferred),
      ` · ${count.toLocaleString()} ${count === 1 ? "line" : "lines"}`,
      filter !== "all" ? ` · ${visible.length.toLocaleString()} shown` : null,
    ),
    h("div", { class: "live-log-controls" },
      h("button", {
        type: "button",
        class: "live-log-btn",
        "aria-pressed": follow,
        onClick: () => { setFollow(true); const el = viewport.current; if (el) el.scrollTop = el.scrollHeight; },
      }, follow ? "Following" : "Resume following"),
      h("label", { class: "live-log-field" }, "Show ",
        h("select", {
          value: filter,
          onChange: (e: Event) => { setFilter((e.target as HTMLSelectElement).value as LogFilter); setMatchAt(0); },
        }, LOG_FILTERS.map((f) => h("option", { key: f.id, value: f.id }, f.label)))),
      h("label", { class: "live-log-field" }, "Search ",
        h("input", {
          type: "search",
          value: query,
          placeholder: "Search the log",
          onInput: (e: Event) => { setQuery((e.target as HTMLInputElement).value); setMatchAt(0); },
          onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } },
        })),
      query ? h("span", { class: "live-log-matches", "aria-live": "polite" },
        matches.length === 0 ? "No matches" : `${Math.min(matchAt, matches.length - 1) + 1} of ${matches.length.toLocaleString()}`) : null,
      query ? h("button", { type: "button", class: "live-log-btn", disabled: matches.length === 0, "aria-label": "Previous match", onClick: () => step(-1) }, "↑") : null,
      query ? h("button", { type: "button", class: "live-log-btn", disabled: matches.length === 0, "aria-label": "Next match", onClick: () => step(1) }, "↓") : null,
      h("label", { class: "live-log-field" }, "Turn ",
        h("select", {
          value: "",
          disabled: turns.length === 0,
          onChange: (e: Event) => {
            const select = e.target as HTMLSelectElement;
            const turn = Number(select.value);
            select.value = "";
            if (turn > 0) scrollToPosition(positionOfTurn(lines, visible, turn));
          },
        }, h("option", { value: "" }, "Jump to…"), turns.map((t) => h("option", { key: t, value: t }, `Turn ${t}`)))),
      h("label", { class: "live-log-field", title: buffer.timestamps ? undefined : "This log has no timestamps" },
        h("input", {
          type: "checkbox",
          checked: showTime && buffer.timestamps,
          disabled: !buffer.timestamps,
          onChange: (e: Event) => setShowTime((e.target as HTMLInputElement).checked),
        }), " Timestamps"),
      h("button", { type: "button", class: "live-log-btn", onClick: () => download(run.runId, buffer.raw()) }, "Download .log"),
    ),
    h("ul", { class: "live-log-legend", "aria-label": "Colour legend" },
      LOG_LEGEND.map((l) => h("li", { key: l.cls, class: `live-logrow-${l.cls}` }, h("span", { class: "live-log-swatch", "aria-hidden": "true" }), l.label))),
    h("div", { class: "live-log-viewport", ref: viewport, onScroll, role: "region", "aria-label": "Run log", tabIndex: 0 },
      visible.length === 0
        ? h("p", { class: "live-muted live-log-empty" }, count === 0 ? "No log output yet." : "No lines match this filter.")
        : h("div", { class: "live-log-space", style: { height: `${visible.length * ROW_HEIGHT}px` } },
          h("div", { class: "live-log-window", style: { top: `${start * ROW_HEIGHT}px` } }, rows)),
    ),
  );
}
