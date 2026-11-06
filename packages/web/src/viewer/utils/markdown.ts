/**
 * Shared Markdown renderer: text in, Preact vnodes out. No innerHTML and no
 * raw HTML — every character of the source reaches the DOM as a text node, so
 * `<script>` in a reply shows as text.
 *
 * Blocks: headings, fenced code, bullet and numbered lists, paragraphs.
 * Inline: `code`, **bold**, *italic*, and [links](http…) that open in a new tab.
 * Only what is complete renders as markup: an unclosed `**`, backtick or
 * `[text](` stays literal until its closer arrives, so streaming text never
 * flickers into broken markup. An unclosed fence renders as a code block of
 * what has arrived so far.
 */
import { h, type ComponentChildren } from "preact";

export interface MarkdownOptions {
  /** Class prefix for block elements: `<prefix>-heading|paragraph|list|code`. */
  classPrefix?: string;
  /**
   * Keep single line breaks inside a paragraph as `<br>` (chat replies).
   * Off by default: wrapped source lines join into one paragraph.
   */
  breaks?: boolean;
}

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/** Inline tokens, tried in order at each position. */
const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\*([^*\s][^*\n]*?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/;

const BULLET_ITEM = /^\s*[-*+]\s+(.+)$/;
const NUMBERED_ITEM = /^\s*(\d+)\.\s+(.+)$/;
/** Both accept leading whitespace: an indented sub-bullet stays a list item (nesting is flattened). */
const LIST_KINDS = [["ul", BULLET_ITEM], ["ol", NUMBERED_ITEM]] as const;

export function renderInlineMarkdown(text: string, keyBase = "i"): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let rest = text;
  let n = 0;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const key = `${keyBase}-${n += 1}`;
    if (m[1] !== undefined) {
      out.push(h("code", { key }, m[1]));
    } else if (m[2] !== undefined) {
      out.push(h("strong", { key }, renderInlineMarkdown(m[2], key)));
    } else if (m[3] !== undefined) {
      out.push(h("em", { key }, renderInlineMarkdown(m[3], key)));
    } else if (SAFE_LINK.test(m[5])) {
      out.push(h("a", { key, href: m[5], target: "_blank", rel: "noopener noreferrer" }, m[4]));
    } else {
      // Unsafe scheme (javascript:, data:, …): keep the source as plain text.
      out.push(m[0]);
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function renderMarkdown(markdown: string, options: MarkdownOptions = {}): ComponentChildren[] {
  const prefix = options.classPrefix ?? "md";
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ComponentChildren[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const k = `h-${key += 1}`;
      blocks.push(h(`h${level}`, { class: `${prefix}-heading`, key: k }, renderInlineMarkdown(headingMatch[2].trim(), k)));
      i += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const langMatch = trimmed.match(/^```([\w-]+)?\s*$/);
      const language = langMatch?.[1] ?? "";
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test((lines[i] ?? "").trim())) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        h("pre", { class: `${prefix}-code`, key: `c-${key += 1}` },
          h("code", { class: language ? `language-${language}` : undefined }, codeLines.join("\n")),
        ),
      );
      continue;
    }

    const listKind = LIST_KINDS.find(([, pattern]) => pattern.test(line));
    if (listKind) {
      const [tag, pattern] = listKind;
      const listKey = `${tag}-${key += 1}`;
      const items: ComponentChildren[] = [];
      let start: number | undefined;
      while (i < lines.length) {
        const match = (lines[i] ?? "").match(pattern);
        if (!match) break;
        // Numbered items capture their number first; bullets have only the text.
        const text = match[match.length - 1];
        if (tag === "ol" && items.length === 0) start = Number(match[1]);
        const k = `${listKey}-${items.length}`;
        items.push(h("li", { key: k }, renderInlineMarkdown(text.trim(), k)));
        i += 1;
      }
      // A list split by a code fence keeps its numbering: `2. Run` starts at 2.
      const listProps: { class: string; key: string; start?: number } = { class: `${prefix}-list`, key: listKey };
      blocks.push(h(tag, start !== undefined && start !== 1 ? { ...listProps, start } : listProps, items));
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const candidate = lines[i] ?? "";
      const candidateTrimmed = candidate.trim();
      if (!candidateTrimmed || /^(#{1,6})\s+/.test(candidate) || /^```/.test(candidateTrimmed) || BULLET_ITEM.test(candidate) || NUMBERED_ITEM.test(candidate)) {
        break;
      }
      paragraphLines.push(candidateTrimmed);
      i += 1;
    }
    const k = `p-${key += 1}`;
    const content: ComponentChildren[] = options.breaks
      ? paragraphLines.flatMap((text, n) => [
          ...(n > 0 ? [h("br", { key: `${k}-br-${n}` })] : []),
          ...renderInlineMarkdown(text, `${k}-${n}`),
        ])
      : renderInlineMarkdown(paragraphLines.join(" "), k);
    blocks.push(h("p", { class: `${prefix}-paragraph`, key: k }, content));
  }

  return blocks;
}
