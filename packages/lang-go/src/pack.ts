/**
 * The Go pack entry: what sourcevision loads from this package.
 *
 * @module lang-go/pack
 */

import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { createPackEntry } from "@n-dx/lang-runtime";
import { GO_SYMBOL_RULES, goPack } from "./go-pack.js";
import { GO_PACKAGE } from "./package-paths.js";

export const pack: LanguagePackEntry = createPackEntry({ package: GO_PACKAGE, pack: goPack, symbolRules: GO_SYMBOL_RULES, oversizedImportSource: importSource });

/** Scan only the Go declaration header; comments and quoted text never become import tokens. */
function importSource(source: string): string | undefined {
  let i = 0;
  const token = (): { text: string; end: number } | undefined => {
    for (;;) {
      while (i < source.length && /\s/.test(source[i]!)) i++;
      if (source.startsWith("//", i)) { const end = source.indexOf("\n", i + 2); i = end < 0 ? source.length : end + 1; continue; }
      if (source.startsWith("/*", i)) { const end = source.indexOf("*/", i + 2); if (end < 0) return undefined; i = end + 2; continue; }
      break;
    }
    if (i >= source.length) return undefined;
    const start = i;
    const quote = source[i]!;
    if (quote === '"' || quote === "`") {
      i++;
      while (i < source.length) {
        if (source[i] === quote) { i++; return { text: source.slice(start, i), end: i }; }
        if (quote === '"' && source[i] === "\\") i++;
        i++;
      }
      return undefined;
    }
    if ("();".includes(quote)) i++;
    else while (i < source.length && !/[\s();"`]/.test(source[i]!) && !source.startsWith("//", i) && !source.startsWith("/*", i)) i++;
    return { text: source.slice(start, i), end: i };
  };
  if (token()?.text !== "package") return undefined;
  const name = token();
  if (!name || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name.text)) return undefined;
  let end = name.end;
  let next = token();
  while (next) {
    if (next.text === ";") { next = token(); continue; }
    if (next.text !== "import") break;
    let item = token();
    if (item?.text === "(") {
      do { item = token(); } while (item && item.text !== ")");
      if (!item) return undefined;
    } else {
      if (item && !item.text.startsWith('"') && !item.text.startsWith("`")) item = token();
      if (!item || (!item.text.startsWith('"') && !item.text.startsWith("`"))) return undefined;
    }
    end = item.end;
    next = token();
  }
  return source.slice(0, end) + "\n";
}
