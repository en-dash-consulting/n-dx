/**
 * The literal keyword arguments of the `setup(...)` call in a `setup.py`,
 * read as text. The file is never executed: a value that is not a literal
 * (a variable, a call other than `find_packages`, an f-string, an expression)
 * yields a notice, never a guess.
 *
 * @module lang-kit/python-setup-py
 */

/** A Python literal this reader understands. */
export type PyLiteral = string | readonly PyLiteral[] | PyDict | FindPackagesCall;
export interface PyDict {
  readonly kind: "dict";
  readonly entries: readonly { readonly key: PyLiteral; readonly value: PyLiteral; readonly line: number }[];
}
/** `find_packages(...)` or `find_namespace_packages(...)`; `where` is undefined when not given, NON_LITERAL when not a literal string. */
export interface FindPackagesCall {
  readonly kind: "find_packages";
  readonly where?: string | typeof NON_LITERAL;
}

export const NON_LITERAL: unique symbol = Symbol("non-literal");

export interface SetupArgument {
  readonly value: PyLiteral | typeof NON_LITERAL;
  /** 1-based line of the keyword. */
  readonly line: number;
  /** For list values: each item's line, in order. */
  readonly itemLines: readonly number[];
}

export interface SetupCall {
  /** Keyword arguments by name. */
  readonly keywords: ReadonlyMap<string, SetupArgument>;
  /** The call passes `**kwargs`, so keys not listed may still be set. */
  readonly spreads: boolean;
  readonly line: number;
}

/** The first top-level-looking `setup(` call, or a notice explaining why there is none. */
export function readSetupCall(src: string): SetupCall | { notice: string } {
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch (err) {
    if (err instanceof PySyntaxError) return { notice: err.message };
    throw err;
  }
  const at = findSetupCall(tokens);
  if (at < 0) return { notice: "has no setup(...) call" };
  return new ArgReader(tokens, at + 2).call(tokens[at].line);
}

// ── Tokens ───────────────────────────────────────────────────────────────

type Token =
  | { kind: "name"; text: string; line: number }
  | { kind: "string"; value: string; fstring: boolean; line: number }
  | { kind: "op"; text: string; line: number }
  | { kind: "other"; text: string; line: number };

class PySyntaxError extends Error {}

const OPS = new Set(["(", ")", "[", "]", "{", "}", ",", "=", ":", ".", "*"]);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (c === " " || c === "\t" || c === "\r" || c === "\\" || c === "\f") {
      i++;
    } else if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (/[A-Za-z_]/.test(c) || c.charCodeAt(0) > 127) {
      let j = i;
      while (j < src.length && (/[A-Za-z0-9_]/.test(src[j]) || src.charCodeAt(j) > 127)) j++;
      const word = src.slice(i, j);
      if ((src[j] === '"' || src[j] === "'") && /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/.test(word)) {
        const s = readString(src, j, line, /[rR]/.test(word));
        out.push({ kind: "string", value: s.value, fstring: /[fF]/.test(word), line });
        line = s.line;
        i = s.end;
      } else {
        out.push({ kind: "name", text: word, line });
        i = j;
      }
    } else if (c === '"' || c === "'") {
      const s = readString(src, i, line, false);
      out.push({ kind: "string", value: s.value, fstring: false, line });
      line = s.line;
      i = s.end;
    } else if (c === "*" && src[i + 1] === "*") {
      out.push({ kind: "op", text: "**", line });
      i += 2;
    } else if (OPS.has(c)) {
      // `==`, `:=` and friends are not literal syntax; keep `=` only when it stands alone.
      if (c === "=" && src[i + 1] === "=") {
        out.push({ kind: "other", text: "==", line });
        i += 2;
      } else {
        out.push({ kind: "op", text: c, line });
        i++;
      }
    } else {
      out.push({ kind: "other", text: c, line });
      i++;
    }
  }
  return out;
}

const ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "\n": "" };

function readString(src: string, start: number, line: number, raw: boolean): { value: string; end: number; line: number } {
  const quote = src[start];
  const triple = src.startsWith(quote.repeat(3), start);
  const fence = triple ? quote.repeat(3) : quote;
  let i = start + fence.length;
  let value = "";
  for (;;) {
    if (i >= src.length) throw new PySyntaxError(`line ${line}: unterminated string`);
    if (src.startsWith(fence, i)) return { value, end: i + fence.length, line };
    const c = src[i];
    if (c === "\n") {
      if (!triple) throw new PySyntaxError(`line ${line}: unterminated string`);
      line++;
    }
    if (c === "\\" && i + 1 < src.length) {
      const e = src[i + 1];
      if (e === "\n") line++;
      value += raw ? c + e : (ESCAPES[e] ?? c + e);
      i += 2;
      continue;
    }
    value += c;
    i++;
  }
}

/** Index of the `setup` name token of `setup(`, `setuptools.setup(` or `core.setup(`; not a `def setup(`. */
function findSetupCall(tokens: Token[]): number {
  for (let k = 0; k + 1 < tokens.length; k++) {
    const t = tokens[k];
    const next = tokens[k + 1];
    if (t.kind !== "name" || t.text !== "setup" || next.kind !== "op" || next.text !== "(") continue;
    const prev = tokens[k - 1];
    if (prev?.kind === "name" && prev.text === "def") continue;
    if (prev?.kind === "op" && prev.text === ".") {
      const owner = tokens[k - 2];
      if (owner?.kind !== "name" || (owner.text !== "setuptools" && owner.text !== "core")) continue;
    }
    return k;
  }
  return -1;
}

// ── Arguments ────────────────────────────────────────────────────────────

const FIND_PACKAGES = new Set(["find_packages", "find_namespace_packages"]);

class ArgReader {
  constructor(
    private readonly tokens: Token[],
    private k: number,
  ) {}

  call(line: number): SetupCall {
    const keywords = new Map<string, SetupArgument>();
    let spreads = false;
    for (;;) {
      const t = this.tokens[this.k];
      if (t === undefined || this.isOp(")")) break;
      if (this.isOp("**") || this.isOp("*")) {
        spreads ||= this.isOp("**");
        this.k++;
        this.skipExpression();
      } else if (t.kind === "name" && this.isOp("=", 1)) {
        this.k += 2;
        keywords.set(t.text, { line: t.line, ...this.argument() });
      } else {
        this.skipExpression();
      }
      if (this.isOp(",")) this.k++;
    }
    return { keywords, spreads, line };
  }

  private argument(): { value: PyLiteral | typeof NON_LITERAL; itemLines: number[] } {
    const start = this.k;
    const itemLines: number[] = [];
    const value = this.literal(itemLines);
    if (value !== NON_LITERAL && (this.isOp(",") || this.isOp(")"))) return { value, itemLines };
    this.k = start;
    this.skipExpression();
    return { value: NON_LITERAL, itemLines: [] };
  }

  /** A literal at the cursor, consuming it; NON_LITERAL (cursor undefined) when it is not one. */
  private literal(itemLines?: number[]): PyLiteral | typeof NON_LITERAL {
    const t = this.tokens[this.k];
    if (t === undefined) return NON_LITERAL;
    if (t.kind === "string") {
      let value = "";
      while (this.tokens[this.k]?.kind === "string") {
        const s = this.tokens[this.k] as Extract<Token, { kind: "string" }>;
        if (s.fstring) return NON_LITERAL;
        value += s.value;
        this.k++;
      }
      return value;
    }
    if (this.isOp("[") || this.isOp("(")) {
      const close = this.isOp("[") ? "]" : ")";
      this.k++;
      const items: PyLiteral[] = [];
      while (!this.isOp(close)) {
        itemLines?.push(this.tokens[this.k]?.line ?? 0);
        const item = this.literal();
        if (item === NON_LITERAL) return NON_LITERAL;
        items.push(item);
        if (this.isOp(",")) this.k++;
        else if (!this.isOp(close)) return NON_LITERAL;
      }
      this.k++;
      return items;
    }
    if (this.isOp("{")) {
      this.k++;
      const entries: { key: PyLiteral; value: PyLiteral; line: number }[] = [];
      while (!this.isOp("}")) {
        const line = this.tokens[this.k]?.line ?? 0;
        const key = this.literal();
        if (key === NON_LITERAL || !this.isOp(":")) return NON_LITERAL;
        this.k++;
        const value = this.literal();
        if (value === NON_LITERAL) return NON_LITERAL;
        entries.push({ key, value, line });
        if (this.isOp(",")) this.k++;
        else if (!this.isOp("}")) return NON_LITERAL;
      }
      this.k++;
      return { kind: "dict", entries };
    }
    if (t.kind === "name" && t.text === "dict" && this.isOp("(", 1)) return this.dictCall();
    if (t.kind === "name") {
      // `find_packages(...)` or `setuptools.find_packages(...)`
      let name = t;
      if (t.text === "setuptools" && this.isOp(".", 1) && this.tokens[this.k + 2]?.kind === "name") {
        name = this.tokens[this.k + 2] as typeof t;
        this.k += 2;
      }
      if (name.kind === "name" && FIND_PACKAGES.has(name.text) && this.isOp("(", 1)) return this.findPackages();
    }
    return NON_LITERAL;
  }

  /** `dict(key="value", …)` with literal values. */
  private dictCall(): PyDict | typeof NON_LITERAL {
    this.k += 2;
    const entries: { key: PyLiteral; value: PyLiteral; line: number }[] = [];
    while (!this.isOp(")")) {
      const t = this.tokens[this.k];
      if (t?.kind !== "name" || !this.isOp("=", 1)) return NON_LITERAL;
      this.k += 2;
      const value = this.literal();
      if (value === NON_LITERAL) return NON_LITERAL;
      entries.push({ key: t.text, value, line: t.line });
      if (this.isOp(",")) this.k++;
      else if (!this.isOp(")")) return NON_LITERAL;
    }
    this.k++;
    return { kind: "dict", entries };
  }

  private findPackages(): FindPackagesCall | typeof NON_LITERAL {
    this.k += 2;
    let where: string | typeof NON_LITERAL | undefined;
    let first = true;
    while (!this.isOp(")")) {
      const t = this.tokens[this.k];
      if (t === undefined) return NON_LITERAL;
      const keyword = t.kind === "name" && this.isOp("=", 1) ? t.text : undefined;
      if (keyword !== undefined) this.k += 2;
      if (keyword === "where" || (keyword === undefined && first)) {
        const start = this.k;
        const v = this.literal();
        where = typeof v === "string" && (this.isOp(",") || this.isOp(")")) ? v : NON_LITERAL;
        if (where === NON_LITERAL) {
          this.k = start;
          this.skipExpression();
        }
      } else {
        this.skipExpression(); // exclude=, include=: they filter packages, not roots
      }
      first = false;
      if (this.isOp(",")) this.k++;
      else if (!this.isOp(")")) return NON_LITERAL;
    }
    this.k++;
    return { kind: "find_packages", ...(where !== undefined && { where }) };
  }

  /** Skip to the next top-level `,` or the closing `)`. */
  private skipExpression(): void {
    let depth = 0;
    for (; this.k < this.tokens.length; this.k++) {
      const t = this.tokens[this.k];
      if (t.kind !== "op") continue;
      if (t.text === "(" || t.text === "[" || t.text === "{") depth++;
      else if (t.text === ")" || t.text === "]" || t.text === "}") {
        if (depth === 0) return;
        depth--;
      } else if (t.text === "," && depth === 0) return;
    }
  }

  private isOp(text: string, ahead = 0): boolean {
    const t = this.tokens[this.k + ahead];
    return t?.kind === "op" && t.text === text;
  }
}
