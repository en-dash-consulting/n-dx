/**
 * A minimal XML reader for build files (pom.xml). Builds an element tree from
 * a character scan: tags, text, CDATA, character and the five named entity
 * references. Comments, processing instructions and DOCTYPE are skipped;
 * attributes are skipped (a pom's data is in elements). Not a validating
 * parser: it throws {@link XmlSyntaxError} on mismatched or unterminated
 * markup and accepts everything else.
 *
 * @module sourcevision/language/xml-lite
 */

export interface XmlElement {
  readonly name: string;
  readonly children: readonly XmlElement[];
  /** Concatenated character data of this element, excluding descendants. */
  readonly text: string;
}

export class XmlSyntaxError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} (at offset ${offset})`);
    this.name = "XmlSyntaxError";
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

export function parseXml(source: string): XmlElement {
  const root: Mutable = { name: "", children: [], text: "" };
  const stack: Mutable[] = [root];
  let i = 0;

  const skipPast = (terminator: string, what: string): void => {
    const end = source.indexOf(terminator, i);
    if (end < 0) throw new XmlSyntaxError(`Unterminated ${what}`, i);
    i = end + terminator.length;
  };

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    const top = stack[stack.length - 1]!;
    if (lt < 0) {
      top.text += decodeEntities(source.slice(i), i);
      break;
    }
    top.text += decodeEntities(source.slice(i, lt), i);
    i = lt;

    if (source.startsWith("<!--", i)) skipPast("-->", "comment");
    else if (source.startsWith("<![CDATA[", i)) {
      const end = source.indexOf("]]>", i);
      if (end < 0) throw new XmlSyntaxError("Unterminated CDATA", i);
      top.text += source.slice(i + 9, end);
      i = end + 3;
    } else if (source.startsWith("<?", i)) skipPast("?>", "processing instruction");
    else if (source.startsWith("<!", i)) skipDoctype();
    else if (source.startsWith("</", i)) {
      const end = source.indexOf(">", i);
      if (end < 0) throw new XmlSyntaxError("Unterminated end tag", i);
      const name = source.slice(i + 2, end).trim();
      if (stack.length < 2 || top.name !== name) {
        throw new XmlSyntaxError(`Unexpected </${name}>`, i);
      }
      stack.pop();
      i = end + 1;
    } else openTag();
  }

  if (stack.length > 1) throw new XmlSyntaxError(`Unclosed <${stack[stack.length - 1]!.name}>`, i);
  const only = root.children[0];
  if (!only || root.children.length > 1) throw new XmlSyntaxError("Expected exactly one root element", 0);
  return only;

  /** `<!DOCTYPE …>` including a bracketed internal subset. */
  function skipDoctype(): void {
    let depth = 0;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "[") depth++;
      else if (c === "]") depth--;
      else if (c === ">" && depth <= 0) {
        i++;
        return;
      }
    }
    throw new XmlSyntaxError("Unterminated declaration", i);
  }

  function openTag(): void {
    const start = i;
    i++; // "<"
    const nameStart = i;
    while (i < source.length && !isSpace(source[i]!) && source[i] !== ">" && source[i] !== "/") i++;
    const name = source.slice(nameStart, i);
    if (!name) throw new XmlSyntaxError("Empty tag name", start);

    // Skip attributes; a quoted value may contain ">" or "/".
    let quote = "";
    for (; i < source.length; i++) {
      const c = source[i]!;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">" || (c === "/" && source[i + 1] === ">")) break;
    }
    if (i >= source.length) throw new XmlSyntaxError(`Unterminated <${name}>`, start);

    const selfClosing = source[i] === "/";
    i += selfClosing ? 2 : 1;
    const element: Mutable = { name, children: [], text: "" };
    stack[stack.length - 1]!.children.push(element);
    if (!selfClosing) stack.push(element);
  }
}

interface Mutable {
  name: string;
  children: Mutable[];
  text: string;
}

function isSpace(c: string): boolean {
  return c === " " || c === "\n" || c === "\t" || c === "\r";
}

function decodeEntities(text: string, offset: number): string {
  if (!text.includes("&")) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const amp = text.indexOf("&", i);
    if (amp < 0) return out + text.slice(i);
    out += text.slice(i, amp);
    const semi = text.indexOf(";", amp);
    if (semi < 0) throw new XmlSyntaxError("Unterminated entity reference", offset + amp);
    const ref = text.slice(amp + 1, semi);
    out += decodeReference(ref, offset + amp);
    i = semi + 1;
  }
  return out;
}

function decodeReference(ref: string, offset: number): string {
  if (ref in NAMED_ENTITIES) return NAMED_ENTITIES[ref]!;
  if (ref.startsWith("#")) {
    const hex = ref[1] === "x" || ref[1] === "X";
    const code = Number.parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) return String.fromCodePoint(code);
  }
  throw new XmlSyntaxError(`Unknown entity &${ref};`, offset);
}

/** First direct child named `name`. */
export function child(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c) => c.name === name);
}

/** Trimmed text of the first direct child named `name`; undefined when absent or empty. */
export function childText(el: XmlElement, name: string): string | undefined {
  const text = child(el, name)?.text.trim();
  return text ? text : undefined;
}

export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c) => c.name === name);
}
