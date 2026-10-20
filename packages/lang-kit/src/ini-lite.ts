/**
 * A small INI reader for `setup.cfg`, following Python's `configparser`
 * defaults as setuptools uses them: `[section]` headers, `key = value` or
 * `key: value`, values continued on indented lines, and whole-line `#` or `;`
 * comments (no inline comments). Keys are lowercased, as configparser does.
 * Never throws: a line it cannot place becomes a notice.
 *
 * @module lang-kit/ini-lite
 */

export interface IniValue {
  /** The value, continuation lines joined with `\n`, each trimmed; a value that starts on a continuation line starts with `\n`. */
  readonly value: string;
  /** 1-based line of the key. */
  readonly line: number;
  /** Each non-empty line of the value with its 1-based line number. */
  readonly lines: readonly { readonly text: string; readonly line: number }[];
}

export interface IniDocument {
  /** Section name → key → value. A repeated section merges; a repeated key keeps the last value. */
  readonly sections: ReadonlyMap<string, ReadonlyMap<string, IniValue>>;
  /** Lines that could not be read, as `line N: …`. */
  readonly notices: readonly string[];
}

export function parseIni(src: string): IniDocument {
  const sections = new Map<string, Map<string, IniValue>>();
  const notices: string[] = [];
  let section: Map<string, IniValue> | undefined;
  let open: { key: string; line: number; lines: { text: string; line: number }[] } | undefined;

  const close = (): void => {
    if (!open || !section) return;
    const value = open.lines.map((l) => l.text).join("\n");
    section.set(open.key, { value, line: open.line, lines: open.lines.filter((l) => l.text !== "") });
    open = undefined;
  };

  src.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith(";")) return;
    const indented = raw.length > 0 && (raw[0] === " " || raw[0] === "\t");
    if (trimmed === "") {
      if (open) open.lines.push({ text: "", line });
      return;
    }
    if (indented && open) {
      open.lines.push({ text: trimmed, line });
      return;
    }
    close();
    if (trimmed.startsWith("[")) {
      const end = trimmed.indexOf("]");
      if (end < 0) {
        notices.push(`line ${line}: section header is not closed`);
        section = undefined;
        return;
      }
      const name = trimmed.slice(1, end).trim();
      section = sections.get(name) ?? new Map();
      sections.set(name, section);
      return;
    }
    const sep = separatorAt(trimmed);
    if (sep < 0) {
      notices.push(`line ${line}: expected 'key = value'`);
      return;
    }
    if (!section) {
      notices.push(`line ${line}: key outside any section`);
      return;
    }
    const key = trimmed.slice(0, sep).trim().toLowerCase();
    const first = trimmed.slice(sep + 1).trim();
    open = { key, line, lines: [{ text: first, line }] };
  });
  close();

  // Trailing blank lines are not part of a value.
  for (const s of sections.values()) {
    for (const [key, v] of s) {
      const text = v.value.replace(/\n+$/, "");
      if (text !== v.value) s.set(key, { ...v, value: text });
    }
  }
  return { sections, notices };
}

/** The first `=` or `:`, whichever comes first. */
function separatorAt(line: string): number {
  const eq = line.indexOf("=");
  const colon = line.indexOf(":");
  if (eq < 0) return colon;
  if (colon < 0) return eq;
  return Math.min(eq, colon);
}
