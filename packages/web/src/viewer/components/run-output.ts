/**
 * Output panel for the run-command control: renders a process's ANSI colours
 * and shows the last few lines until the user asks for the whole log.
 *
 * The output is a dev server's or build tool's terminal stream, so it carries
 * SGR colour codes, cursor moves and `\r` progress rewrites. Colours become
 * styled spans mapped to the theme's tokens; every other escape is dropped
 * rather than shown as `[0m`-style text. Text reaches the DOM only as Preact
 * text nodes, never as markup, so the output cannot inject HTML.
 */
import { h } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

/** Lines shown while the panel is collapsed. */
export const COLLAPSED_LINES = 3;

export interface AnsiSegment {
  text: string;
  /** Space-separated `ansi-*` classes; empty for unstyled text. */
  className: string;
}

export interface AnsiLine {
  segments: AnsiSegment[];
  /** The line's text without styling. */
  text: string;
}

interface SgrState {
  fg: number | null;
  bg: number | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

const plainState = (): SgrState =>
  ({ fg: null, bg: null, bold: false, dim: false, italic: false, underline: false });

// CSI (captures its parameters and final byte), OSC up to BEL or ST, any other
// two-byte escape or a lone trailing ESC, then the line breaks.
const TOKEN =
  /\u001b\[([0-?]*)[ -/]*([@-~])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[0-~]?|\r\n|\n|\r/g;
// Remaining C0 controls (backspace, bell, …) have no visible form.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function classesFor(s: SgrState): string {
  const out: string[] = [];
  if (s.fg !== null) out.push(`ansi-fg-${s.fg}`);
  if (s.bg !== null) out.push(`ansi-bg-${s.bg}`);
  if (s.bold) out.push("ansi-bold");
  if (s.dim) out.push("ansi-dim");
  if (s.italic) out.push("ansi-italic");
  if (s.underline) out.push("ansi-underline");
  return out.join(" ");
}

/**
 * Apply one SGR sequence's parameters. Extended colours (`38;5;n`,
 * `38;2;r;g;b`) are consumed so their numbers are not misread as other
 * codes; a 256-colour index inside the basic 16 is kept, anything else is
 * dropped and the text keeps its previous colour.
 */
function applySgr(state: SgrState, params: string): void {
  const codes = params === "" ? [0] : params.split(/[;:]/).map((p) => (p === "" ? 0 : Number(p)));
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) Object.assign(state, plainState());
    else if (code === 1) state.bold = true;
    else if (code === 2) state.dim = true;
    else if (code === 3) state.italic = true;
    else if (code === 4) state.underline = true;
    else if (code === 22) { state.bold = false; state.dim = false; }
    else if (code === 23) state.italic = false;
    else if (code === 24) state.underline = false;
    else if (code >= 30 && code <= 37) state.fg = code - 30;
    else if (code === 39) state.fg = null;
    else if (code >= 40 && code <= 47) state.bg = code - 40;
    else if (code === 49) state.bg = null;
    else if (code >= 90 && code <= 97) state.fg = code - 90 + 8;
    else if (code >= 100 && code <= 107) state.bg = code - 100 + 8;
    else if (code === 38 || code === 48) {
      const mode = codes[i + 1];
      if (mode === 5) {
        const index = codes[i + 2];
        if (index !== undefined && index < 16) {
          if (code === 38) state.fg = index;
          else state.bg = index;
        }
        i += 2;
      } else if (mode === 2) {
        i += 4;
      } else {
        i += 1;
      }
    }
  }
}

/** Split terminal output into lines of styled segments. */
export function parseAnsiLines(output: string): AnsiLine[] {
  const lines: AnsiLine[] = [];
  const state = plainState();
  let segments: AnsiSegment[] = [];

  const push = (raw: string): void => {
    const text = raw.replace(CONTROL, "");
    if (!text) return;
    const className = classesFor(state);
    const last = segments[segments.length - 1];
    if (last && last.className === className) last.text += text;
    else segments.push({ text, className });
  };
  const endLine = (): void => {
    lines.push({ segments, text: segments.map((s) => s.text).join("") });
    segments = [];
  };

  TOKEN.lastIndex = 0;
  let at = 0;
  for (let m = TOKEN.exec(output); m; m = TOKEN.exec(output)) {
    push(output.slice(at, m.index));
    at = m.index + m[0].length;
    const token = m[0];
    if (token === "\n" || token === "\r\n") endLine();
    // A bare carriage return redraws the line (progress bars, spinners):
    // keep only what was written after it.
    else if (token === "\r") segments = [];
    else if (m[2] === "m") applySgr(state, m[1]);
  }
  push(output.slice(at));
  if (segments.length > 0) endLine();
  return lines;
}

function renderLine(line: AnsiLine, key: number) {
  return h("span", { key, class: "runcmd-line" },
    line.segments.map((s, i) =>
      s.className ? h("span", { key: i, class: s.className }, s.text) : s.text),
    "\n",
  );
}

export function RunOutput({ output }: { output: string }) {
  const lines = useMemo(() => parseAnsiLines(output), [output]);
  const [expanded, setExpanded] = useState(false);
  // Set when the collapsed lines wrap past the box's three-line cap: a single
  // logical line can be most of the log (a minified stack trace, or frames a
  // tool redrew with cursor moves that `parseAnsiLines` drops).
  const [overflowing, setOverflowing] = useState(false);
  const pre = useRef<HTMLPreElement>(null);

  const nonBlank = lines.filter((l) => l.text.trim() !== "");
  // Collapsed shows non-blank lines only, so blank runs cannot grow the box.
  const tail = nonBlank.slice(-COLLAPSED_LINES);
  const collapsible = nonBlank.length > COLLAPSED_LINES || overflowing;
  const shown = expanded ? lines : tail;

  // Both states follow new output, like a terminal. Measure overflow only while
  // collapsed, so the toggle stays to collapse an expanded log again.
  useLayoutEffect(() => {
    const el = pre.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    if (!expanded) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [expanded, output]);

  return h("div", { class: "runcmd-output-panel" },
    h("div", { class: "runcmd-output-head" },
      h("div", { class: "runcmd-menu-title" }, "Output"),
      collapsible
        ? h("button", {
            type: "button",
            class: "runcmd-output-toggle",
            "aria-expanded": String(expanded),
            onClick: () => setExpanded(!expanded),
          }, expanded
            ? `Show last ${COLLAPSED_LINES} lines`
            : `Show full log · ${nonBlank.length} line${nonBlank.length === 1 ? "" : "s"}`)
        : null,
    ),
    h("pre", {
      ref: pre,
      class: `runcmd-output${expanded ? " runcmd-output--expanded" : ""}`,
    }, shown.map(renderLine)),
  );
}
