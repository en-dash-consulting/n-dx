/**
 * A line-based unified diff, for the fixes the conflict classifier offers.
 *
 * Myers' O(ND) shortest edit script, rendered as `git apply`-able hunks with
 * three lines of context. Pure: text in, text out.
 *
 * @module web/server/branch-health/unified-diff
 */

const CONTEXT = 3;

interface Text {
  lines: string[];
  /** Whether the text ends with a newline; false adds git's "\ No newline" marker. */
  eol: boolean;
}

function splitText(text: string): Text {
  if (text === "") return { lines: [], eol: true };
  const eol = text.endsWith("\n");
  const lines = (eol ? text.slice(0, -1) : text).split("\n");
  return { lines, eol };
}

type Op = { kind: " " | "-" | "+"; line: string; a: number; b: number };

/** The edit script turning `a` into `b`, one op per line. */
function editScript(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  trace.push(v.slice());

  // Walk the trace back from (n, m) to (0, 0).
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ kind: " ", line: a[x], a: x, b: y });
    }
    if (d === 0) break;
    if (down) {
      y--;
      ops.push({ kind: "+", line: b[y], a: x, b: y });
    } else {
      x--;
      ops.push({ kind: "-", line: a[x], a: x, b: y });
    }
  }
  return ops.reverse();
}

/**
 * The unified diff from `before` to `after`, both named `path`, or "" when
 * they are equal.
 */
export function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return "";
  const a = splitText(before);
  const b = splitText(after);
  const ops = editScript(a.lines, b.lines);
  // A missing final newline changes the last line even when its text matches.
  if (a.eol !== b.eol) {
    const last = ops.length - 1;
    if (last >= 0 && ops[last].kind === " ") {
      const { line, a: ai, b: bi } = ops[last];
      ops.splice(last, 1, { kind: "-", line, a: ai, b: bi }, { kind: "+", line, a: ai + 1, b: bi });
    }
  }

  const out = [`--- a/${path}`, `+++ b/${path}`];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === " ") {
      i++;
      continue;
    }
    // A hunk: from CONTEXT lines before this change to CONTEXT lines after the
    // last change no more than 2 * CONTEXT unchanged lines away.
    const start = Math.max(0, i - CONTEXT);
    let lastChange = i;
    for (let j = i; j < ops.length && j - lastChange <= 2 * CONTEXT; j++) {
      if (ops[j].kind !== " ") lastChange = j;
    }
    const end = Math.min(ops.length, lastChange + CONTEXT + 1);
    const hunk = ops.slice(start, end);
    const aCount = hunk.filter((op) => op.kind !== "+").length;
    const bCount = hunk.filter((op) => op.kind !== "-").length;
    // An empty side names the line it sits after; a non-empty one its first line.
    const aStart = aCount === 0 ? hunk[0].a : hunk.find((op) => op.kind !== "+")!.a + 1;
    const bStart = bCount === 0 ? hunk[0].b : hunk.find((op) => op.kind !== "-")!.b + 1;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of hunk) {
      out.push(`${op.kind}${op.line}`);
      const lastOfA = op.kind !== "+" && op.a === a.lines.length - 1 && !a.eol;
      const lastOfB = op.kind !== "-" && op.b === b.lines.length - 1 && !b.eol;
      if (lastOfA || lastOfB) out.push("\\ No newline at end of file");
    }
    i = end;
  }
  return `${out.join("\n")}\n`;
}
