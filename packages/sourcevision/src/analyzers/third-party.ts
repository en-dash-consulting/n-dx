/**
 * Third-party code copied into a repository by hand: a spreadsheet library
 * dropped into `lib/`, a JS framework unpacked under `js/`. A package manager
 * installed none of it, so no `vendor/` rule skips it, and analysis used to
 * treat it as the application: one zone swallowed most of the files, library
 * files became zone entry points, classification escalated them to a model,
 * and the primary language followed the library.
 *
 * {@link markThirdParty} marks such files on the inventory, once per analysis,
 * with the reason. Every later phase reads the mark through
 * {@link isOutsideStructure}. A file is third-party when, in this order:
 *
 * 1. no deny glob (`!lib/Mine/**`) matches it, and
 * 2. a configured glob (`sourcevision.thirdParty`) or a glob passed on the
 *    command line (`--third-party=<glob>`, `--third-party-file=<path>`)
 *    matches it, or
 * 3. a built-in fingerprint recognises it: a library's own header
 *    ({@link LIBRARY_BANNERS}: a `@package` docblock, a version banner) in
 *    the file's first {@link HEADER_BYTES} bytes, a directory named as a
 *    well-known library ({@link LIBRARY_DIRECTORIES}), or a directory most of
 *    whose files carry the same library's banner.
 *
 * Fingerprints are public facts about public libraries. A wrong match is
 * undone with a deny glob.
 *
 * Globs: `**` any depth, `*` within a segment, `?` one character; a trailing
 * `/` means everything under the directory; a pattern with no `/` matches that
 * name at any depth, as a file or a directory.
 *
 * @module sourcevision/analyzers/third-party
 */

import { open } from "node:fs/promises";
import { join, posix } from "node:path";
import type { FileEntry } from "../schema/index.js";

/** How many bytes of each file the banner rules read. */
export const HEADER_BYTES = 2048;

/** A library recognised by its own header text. */
interface LibraryBanner {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * Headers that public libraries put at the top of their files. Each names the
 * library (a `@package` docblock) or carries its version banner, which
 * application code does not.
 */
export const LIBRARY_BANNERS: readonly LibraryBanner[] = [
  { name: "PHPExcel", pattern: /@(?:package|category)\s+PHPExcel\b/ },
  { name: "PHPMailer", pattern: /@package\s+PHPMailer\b/ },
  { name: "AuthorizeNet SDK", pattern: /@package\s+AuthorizeNet\b/ },
  { name: "Smarty", pattern: /@package\s+Smarty\b/ },
  { name: "TCPDF", pattern: /@package\s+com\.tecnick\.tcpdf\b/ },
  { name: "Zend Framework", pattern: /@package\s+Zend_/ },
  { name: "NuSOAP", pattern: /@package\s+nusoap\b|NuSOAP - Web Services Toolkit/i },
  { name: "YUI", pattern: /Yahoo! Inc\.[\s\S]{0,400}?\bversion:\s*\d+\.\d+\.\d+/ },
  { name: "jQuery", pattern: /jQuery JavaScript Library v\d|\bjQuery v\d+\.\d+|jQuery UI - v\d/ },
  { name: "Highcharts", pattern: /\bHigh(?:charts|stock) JS v\d/ },
  { name: "Prototype", pattern: /Prototype JavaScript framework, version \d/ },
  { name: "script.aculo.us", pattern: /script\.aculo\.us/ },
  { name: "Dojo", pattern: /The Dojo Foundation/ },
  { name: "Bootstrap", pattern: /Bootstrap v\d+\.\d+\.\d+ \(https?:\/\/getbootstrap\.com/ },
];

/** Directory names (any depth, any case) that are a copied-in library in their own right. */
export const LIBRARY_DIRECTORIES: ReadonlyMap<string, string> = new Map([
  ["phpexcel", "PHPExcel"],
  ["phpmailer", "PHPMailer"],
  ["edit_area", "EditArea"],
  ["tinymce", "TinyMCE"],
  ["tiny_mce", "TinyMCE"],
  ["ckeditor", "CKEditor"],
  ["fckeditor", "FCKeditor"],
  ["adodb", "ADOdb"],
  ["adodb5", "ADOdb"],
  ["tcpdf", "TCPDF"],
  ["fpdf", "FPDF"],
  ["htmlpurifier", "HTML Purifier"],
  ["simplepie", "SimplePie"],
  ["nusoap", "NuSOAP"],
  ["yui", "YUI"],
  ["yui2", "YUI"],
  ["yui3", "YUI"],
  ["highcharts", "Highcharts"],
]);

/** A directory whose files at least this share carry one library's banner is that library's. */
const DIRECTORY_SHARE = 0.8;
/** ...counting directories with at least this many files only. */
const DIRECTORY_MIN_FILES = 3;

/** One glob and where it came from. */
export interface ThirdPartyGlob {
  readonly glob: string;
  readonly source: "config" | "cli";
}

export interface ThirdPartyOptions {
  readonly globs?: readonly ThirdPartyGlob[];
  /** Read a file's first bytes; injectable for tests. Defaults to the file under `projectDir`. */
  readonly readHeader?: (path: string) => Promise<string>;
}

/** Path glob → anchored RegExp: see the module note for the syntax. */
export function thirdPartyGlobToRegExp(glob: string): RegExp {
  let pattern = glob.replace(/^\.\//, "");
  if (pattern.endsWith("/")) pattern += "**";
  if (!pattern.includes("/")) pattern = `**/${pattern}{,/**}`;
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (pattern.startsWith("{,/**}", i)) {
      re += "(?:/.*)?";
      i += 5;
    } else if ("\\^$.|+()[]{}".includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

/** True for a file the structural phases leave out: third-party or a mirror copy. */
export function isOutsideStructure(entry: Pick<FileEntry, "thirdParty" | "mirrorOf">): boolean {
  return entry.thirdParty !== undefined || entry.mirrorOf !== undefined;
}

/**
 * The inventory's files with `thirdParty` set on each third-party file and
 * cleared on every other (a cached entry may carry an old mark), in the same
 * order.
 */
export async function markThirdParty(projectDir: string, files: readonly FileEntry[], options: ThirdPartyOptions = {}): Promise<FileEntry[]> {
  const deny: RegExp[] = [];
  const allow: { re: RegExp; reason: string }[] = [];
  for (const { glob, source } of options.globs ?? []) {
    if (glob.startsWith("!")) deny.push(thirdPartyGlobToRegExp(glob.slice(1)));
    else allow.push({ re: thirdPartyGlobToRegExp(glob), reason: `${source} ${glob}` });
  }
  const readHeader = options.readHeader ?? ((path: string) => readFileHeader(join(projectDir, path)));

  const reasons = new Map<string, string>();
  const bannerOf = new Map<string, string>();
  for (const file of files) {
    const glob = allow.find((g) => g.re.test(file.path));
    if (glob !== undefined) {
      reasons.set(file.path, glob.reason);
      continue;
    }
    const dir = libraryDirectory(file.path);
    if (dir !== undefined) {
      reasons.set(file.path, `library ${dir}`);
      continue;
    }
    const header = await readHeader(file.path).catch(() => "");
    const banner = LIBRARY_BANNERS.find((b) => b.pattern.test(header));
    if (banner !== undefined) {
      bannerOf.set(file.path, banner.name);
      reasons.set(file.path, `library ${banner.name}`);
    }
  }

  // A directory most of whose files carry one library's banner is that library's, files without the banner included.
  const byDirectory = new Map<string, FileEntry[]>();
  for (const file of files) {
    const dir = posix.dirname(file.path);
    let list = byDirectory.get(dir);
    if (list === undefined) byDirectory.set(dir, (list = []));
    list.push(file);
  }
  for (const members of byDirectory.values()) {
    if (members.length < DIRECTORY_MIN_FILES) continue;
    const counts = new Map<string, number>();
    for (const m of members) {
      const name = bannerOf.get(m.path);
      if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (top === undefined || top[1] / members.length < DIRECTORY_SHARE) continue;
    for (const m of members) if (!reasons.has(m.path)) reasons.set(m.path, `library ${top[0]}`);
  }

  return files.map((file) => {
    const { thirdParty: _old, ...rest } = file;
    const reason = deny.some((re) => re.test(file.path)) ? undefined : reasons.get(file.path);
    return reason === undefined ? (rest as FileEntry) : { ...rest, thirdParty: reason };
  });
}

/** The library a path's directories name, if any. */
function libraryDirectory(path: string): string | undefined {
  const segments = path.split("/");
  for (let i = 0; i < segments.length - 1; i++) {
    const name = LIBRARY_DIRECTORIES.get(segments[i].toLowerCase());
    if (name !== undefined) return name;
  }
  return undefined;
}

async function readFileHeader(absPath: string): Promise<string> {
  const handle = await open(absPath, "r");
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
    return buf.subarray(0, bytesRead).toString("latin1");
  } finally {
    await handle.close();
  }
}

/**
 * Globs from a `--third-party-file`: one per line, `#` comments and blank
 * lines skipped, or a JSON array of strings.
 */
export function parseThirdPartyGlobFile(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((g): g is string => typeof g === "string" && g.trim() !== "").map((g) => g.trim());
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * A predicate for paths that are not the application's own, built from the
 * inventory: each third-party or mirror-copy file, and anything (a
 * `package.json`, a test config) under a directory whose inventoried files are
 * all third-party or mirror copies. For readers that walk the project
 * themselves, such as the readiness profile.
 */
export function outsideStructurePredicate(files: readonly Pick<FileEntry, "path" | "thirdParty" | "mirrorOf">[]): ((path: string) => boolean) | undefined {
  const outside = new Set<string>();
  /** Per directory: does it (with its subtree) hold any first-party file? */
  const firstParty = new Map<string, boolean>();
  for (const f of files) {
    const out = isOutsideStructure(f);
    if (out) outside.add(f.path);
    for (let dir = posix.dirname(f.path); dir !== "." && dir !== "/"; dir = posix.dirname(dir)) {
      firstParty.set(dir, (firstParty.get(dir) ?? false) || !out);
    }
  }
  if (outside.size === 0) return undefined;
  const allOutside = new Set([...firstParty.entries()].filter(([, any]) => !any).map(([dir]) => dir));
  // Only the topmost such directories: a path under a nested one is under its ancestor too.
  const outsideDirs = [...allOutside].filter((dir) => !allOutside.has(posix.dirname(dir))).map((dir) => `${dir}/`);
  return (path: string) => outside.has(path) || outsideDirs.some((dir) => path.startsWith(dir));
}

/**
 * Outbound dependencies as the application's: a call in a mirror copy is
 * dropped (its source file's identical call is already listed), and a call in
 * third-party code is kept, marked with the file's reason, since a copied-in
 * SDK's calls are still this repository's integrations. `deps` itself when no
 * file is marked.
 */
export function markOutboundThirdParty<T extends { file: string; thirdParty?: string }>(
  deps: T[],
  files: readonly Pick<FileEntry, "path" | "thirdParty" | "mirrorOf">[],
): T[] {
  const marked = new Map(files.filter(isOutsideStructure).map((f) => [f.path, f]));
  if (marked.size === 0) return deps;
  const out: T[] = [];
  for (const dep of deps) {
    const file = marked.get(dep.file);
    if (file === undefined) out.push(dep);
    else if (file.mirrorOf === undefined && file.thirdParty !== undefined) out.push({ ...dep, thirdParty: file.thirdParty });
  }
  return out;
}
