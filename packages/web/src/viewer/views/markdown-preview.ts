/**
 * Minimal Markdown block renderer for viewer panels.
 *
 * Extracted from `pr-markdown.ts` when the Ask panel needed the same
 * rendering: two panels each shipping their own parser is how the two
 * quietly drift apart. It is deliberately a *block* renderer — headings,
 * fenced code, lists, paragraphs — with no inline emphasis or link
 * handling, because every value it renders is LLM- or tool-generated text
 * that is inserted as text nodes, never as HTML.
 *
 * The emitted class names are prefixed `md-preview-` and styled globally in
 * `styles/markdown-preview.css`, so a consumer only needs to supply its own
 * container class.
 *
 * @module web/viewer/views/markdown-preview
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";

/**
 * Render `markdown` as a flat list of block-level VNodes.
 *
 * Unrecognized syntax degrades to paragraph text rather than being dropped,
 * so no part of an answer can silently disappear from the panel.
 */
export function renderMarkdownPreview(markdown: string): ComponentChildren[] {
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
      const text = headingMatch[2].trim();
      const tag = `h${level}` as keyof HTMLElementTagNameMap;
      blocks.push(h(tag, { class: "md-preview-heading", key: `h-${key += 1}` }, text));
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
        h("pre", { class: "md-preview-code", key: `c-${key += 1}` },
          h("code", { class: language ? `language-${language}` : undefined }, codeLines.join("\n")),
        ),
      );
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      const items: ComponentChildren[] = [];
      while (i < lines.length) {
        const candidate = lines[i] ?? "";
        const match = candidate.match(/^[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(h("li", { key: `ul-item-${key += 1}` }, match[1].trim()));
        i += 1;
      }
      blocks.push(h("ul", { class: "md-preview-list", key: `ul-${key += 1}` }, items));
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      const items: ComponentChildren[] = [];
      while (i < lines.length) {
        const candidate = lines[i] ?? "";
        const match = candidate.match(/^\d+\.\s+(.+)$/);
        if (!match) break;
        items.push(h("li", { key: `ol-item-${key += 1}` }, match[1].trim()));
        i += 1;
      }
      blocks.push(h("ol", { class: "md-preview-list", key: `ol-${key += 1}` }, items));
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const candidate = lines[i] ?? "";
      const candidateTrimmed = candidate.trim();
      if (!candidateTrimmed || /^(#{1,6})\s+/.test(candidate) || /^```/.test(candidateTrimmed) || /^[-*+]\s+/.test(candidate) || /^\d+\.\s+/.test(candidate)) {
        break;
      }
      paragraphLines.push(candidateTrimmed);
      i += 1;
    }
    blocks.push(h("p", { class: "md-preview-paragraph", key: `p-${key += 1}` }, paragraphLines.join(" ")));
  }

  return blocks;
}
