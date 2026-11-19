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
 *    well-known library ({@link LIBRARY_DIRECTORIES}) that also holds that
 *    library's banner or entry file ({@link LIBRARY_ENTRY_FILES}), or a
 *    directory most of whose files carry the same library's banner.
 *
 * Fingerprints are public facts about public libraries. Analyze logs each
 * marked folder with its library and reason ({@link describeThirdPartyMark});
 * a wrong match is undone with a deny glob.
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
 * application code does not. Version banners are anchored where the library
 * puts them, at the start of a comment or comment line with the full release
 * number, so an application comment naming a version (`// requires jQuery
 * v1.7 or later`) matches nothing.
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
  // `/*! jQuery v3.6.0 |`, `/*! jQuery v1.7.2 jquery.com |`, `/*! jQuery UI - v1.12.1 -`, ` * jQuery JavaScript Library v1.4.2`.
  { name: "jQuery", pattern: /\/\*!?[ \t]*jQuery(?: UI -)? v\d+\.\d+\.\d+\b|^[ \t]*\*[ \t]*jQuery JavaScript Library v\d+\.\d+\.\d+\b/m },
  // `/*\n Highcharts JS v4.2.5 (2016-05-06)`, ` * @license Highstock JS v9.3.2 (2021-11-29)`.
  { name: "Highcharts", pattern: /^[ \t]*(?:\/\*+!?|\*)?[ \t]*(?:@license[ \t]+)?High(?:charts|stock) JS v\d+\.\d+\.\d+\b/m },
  // `/*  Prototype JavaScript framework, version 1.7.1`.
  { name: "Prototype", pattern: /^[ \t]*(?:\/\*+|\*)?[ \t]*Prototype JavaScript framework, version \d+\.\d+\.\d+/m },
  // `// script.aculo.us effects.js v1.9.0, Thu Dec 23 2010`.
  { name: "script.aculo.us", pattern: /^\/\/ script\.aculo\.us [\w.-]+\.js v\d+\.\d+\.\d+/m },
  // `Copyright (c) 2004-2011, The Dojo Foundation All Rights Reserved.`
  { name: "Dojo", pattern: /Copyright \(c\) \d{4}(?:-\d{4})?, The Dojo Foundation\s+All Rights Reserved/ },
  { name: "Bootstrap", pattern: /Bootstrap v\d+\.\d+\.\d+ \(https?:\/\/getbootstrap\.com/ },
];

/** Directory names (any depth, any case) that name a well-known library; see {@link LIBRARY_ENTRY_FILES}. */
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

/**
 * A folder named in {@link LIBRARY_DIRECTORIES} is that library only with the
 * library's own evidence: a file under it carrying the library's banner
 * ({@link LIBRARY_BANNERS}), or the library's entry file (any case) under it
 * or beside it (`Classes/PHPExcel.php` next to `Classes/PHPExcel/`). An
 * application's own `src/ckeditor/plugins/` has neither. Every library here
 * has an entry file, so no name marks a folder on its own. Each comment names
 * where the library's public distribution ships the file.
 */
export const LIBRARY_ENTRY_FILES: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ["PHPExcel", ["PHPExcel.php"]], // PHPOffice/PHPExcel: Classes/PHPExcel.php
  ["PHPMailer", ["class.phpmailer.php"]], // PHPMailer 5.x release root; 6.x files carry `@package PHPMailer`
  ["EditArea", ["edit_area_full.js"]], // EditArea release: edit_area/edit_area_full.js
  ["TinyMCE", ["tinymce.min.js", "tiny_mce.js"]], // TinyMCE 4+: js/tinymce/tinymce.min.js; 3.x: tiny_mce/tiny_mce.js
  ["CKEditor", ["ckeditor.js"]], // CKEditor 4 release root: ckeditor/ckeditor.js
  ["FCKeditor", ["fckeditor.js"]], // FCKeditor 2.x release root: fckeditor/fckeditor.js
  ["ADOdb", ["adodb.inc.php"]], // ADOdb release root: adodb.inc.php
  ["TCPDF", ["tcpdf.php"]], // tecnickcom/TCPDF release root: tcpdf.php
  ["FPDF", ["fpdf.php"]], // fpdf.org download: fpdf.php
  ["HTML Purifier", ["HTMLPurifier.php"]], // ezyang/htmlpurifier: library/HTMLPurifier.php
  ["SimplePie", ["SimplePie.php", "simplepie.inc"]], // SimplePie 1.3+: library/SimplePie.php; 1.2: simplepie.inc
  ["NuSOAP", ["nusoap.php"]], // NuSOAP release: lib/nusoap.php
  ["YUI", ["yui-min.js", "yahoo-dom-event.js"]], // YUI 3: build/yui/yui-min.js; YUI 2: build/yahoo-dom-event/yahoo-dom-event.js
  ["Highcharts", ["highcharts.src.js"]], // Highcharts release: code/highcharts.src.js
]);

/** A directory whose files at least this share carry one library's banner is that library's. */
const DIRECTORY_SHARE = 0.8;
/** ...counting directories with at least this many files only. */
const DIRECTORY_MIN_FILES = 3;
/** A library whose header marks fall in more folders than this is logged as one line. */
const MAX_LOGGED_FOLDERS = 5;

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

/**
 * Why files were marked, for the analyze log: `directory+banner` and
 * `directory+entry` (a library-named folder with that evidence), `header` (a
 * file's own banner, or a folder its banner dominates), `config`
 * (`sourcevision.thirdParty`), `flag` (`--third-party`, `--third-party-file`).
 * `vendor/` and other package-manager folders are skipped by inventory before
 * marking, so they never get a mark.
 */
export type ThirdPartyMarkReason = "directory+banner" | "directory+entry" | "header" | "config" | "flag";

/** The files one rule marked in one place, after deny globs. */
export interface ThirdPartyMark {
  /** The folder (`js/ckeditor`, `.` for the root), the glob for `config` and `flag`, or `""` when `folders` is set. */
  readonly where: string;
  /** The library, for the built-in rules. */
  readonly library?: string;
  readonly reason: ThirdPartyMarkReason;
  readonly files: number;
  /** Set when one library's header marks spread over more than {@link MAX_LOGGED_FOLDERS} folders: how many. */
  readonly folders?: number;
}

/** How one file was marked: the reason stored on the entry and where the log groups it. */
interface FileMark {
  readonly stored: string;
  readonly reason: ThirdPartyMarkReason;
  readonly where: string;
  readonly library?: string;
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
 * order, and the marks grouped per folder and reason for the analyze log.
 */
export async function markThirdParty(
  projectDir: string,
  files: readonly FileEntry[],
  options: ThirdPartyOptions = {},
): Promise<{ files: FileEntry[]; marks: ThirdPartyMark[] }> {
  const deny: RegExp[] = [];
  const allow: { re: RegExp; glob: string; source: ThirdPartyGlob["source"] }[] = [];
  for (const { glob, source } of options.globs ?? []) {
    if (glob.startsWith("!")) deny.push(thirdPartyGlobToRegExp(glob.slice(1)));
    else allow.push({ re: thirdPartyGlobToRegExp(glob), glob, source });
  }
  const readHeader = options.readHeader ?? ((path: string) => readFileHeader(join(projectDir, path)));

  const marks = new Map<string, FileMark>();
  const bannerOf = new Map<string, string>();
  for (const file of files) {
    const glob = allow.find((g) => g.re.test(file.path));
    if (glob !== undefined) {
      marks.set(file.path, { stored: `${glob.source} ${glob.glob}`, reason: glob.source === "cli" ? "flag" : "config", where: glob.glob });
      continue;
    }
    const header = await readHeader(file.path).catch(() => "");
    const banner = LIBRARY_BANNERS.find((b) => b.pattern.test(header));
    if (banner !== undefined) bannerOf.set(file.path, banner.name);
  }

  // A library-named folder is the library's only with its banner or entry file under (or beside) it.
  const evidence = libraryFolderEvidence(files, bannerOf);
  for (const file of files) {
    const dir = marks.has(file.path) ? undefined : libraryDirectory(file.path);
    const reason = dir === undefined ? undefined : evidence.get(dir.root);
    if (dir !== undefined && reason !== undefined) {
      marks.set(file.path, { stored: `library ${dir.library}`, reason, where: dir.root, library: dir.library });
    }
  }
  for (const [path, name] of bannerOf) {
    if (!marks.has(path)) marks.set(path, { stored: `library ${name}`, reason: "header", where: posix.dirname(path), library: name });
  }

  // A directory most of whose files carry one library's banner is that library's, files without the banner included.
  const byDirectory = new Map<string, FileEntry[]>();
  for (const file of files) {
    const dir = posix.dirname(file.path);
    let list = byDirectory.get(dir);
    if (list === undefined) byDirectory.set(dir, (list = []));
    list.push(file);
  }
  for (const [dir, members] of byDirectory) {
    if (members.length < DIRECTORY_MIN_FILES) continue;
    const counts = new Map<string, number>();
    for (const m of members) {
      const name = bannerOf.get(m.path);
      if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (top === undefined || top[1] / members.length < DIRECTORY_SHARE) continue;
    for (const m of members) {
      if (!marks.has(m.path)) marks.set(m.path, { stored: `library ${top[0]}`, reason: "header", where: dir, library: top[0] });
    }
  }

  const kept: FileMark[] = [];
  const marked = files.map((file) => {
    const { thirdParty: _old, ...rest } = file;
    const mark = deny.some((re) => re.test(file.path)) ? undefined : marks.get(file.path);
    if (mark === undefined) return rest as FileEntry;
    kept.push(mark);
    return { ...rest, thirdParty: mark.stored };
  });
  return { files: marked, marks: groupMarks(kept) };
}

/** The outermost folder of a path named as a library, if any. */
function libraryDirectory(path: string): { root: string; library: string } | undefined {
  const segments = path.split("/");
  for (let i = 0; i < segments.length - 1; i++) {
    const library = LIBRARY_DIRECTORIES.get(segments[i].toLowerCase());
    if (library !== undefined) return { root: segments.slice(0, i + 1).join("/"), library };
  }
  return undefined;
}

/**
 * Each library-named folder with its library's evidence: a file under it with
 * the library's banner (`directory+banner`, preferred), or its entry file under
 * or beside it (`directory+entry`). Folders without either are absent.
 */
function libraryFolderEvidence(
  files: readonly FileEntry[],
  bannerOf: ReadonlyMap<string, string>,
): Map<string, ThirdPartyMarkReason> {
  const lowerPaths = new Set(files.map((f) => f.path.toLowerCase()));
  const found = new Map<string, ThirdPartyMarkReason>();
  const seen = new Set<string>();
  for (const file of files) {
    const dir = libraryDirectory(file.path);
    if (dir === undefined || found.get(dir.root) === "directory+banner") continue;
    const entries = LIBRARY_ENTRY_FILES.get(dir.library) ?? [];
    if (!seen.has(dir.root)) {
      seen.add(dir.root);
      const parent = posix.dirname(dir.root);
      const beside = entries.some((name) => lowerPaths.has((parent === "." ? name : `${parent}/${name}`).toLowerCase()));
      if (beside) found.set(dir.root, "directory+entry");
    }
    if (bannerOf.get(file.path) === dir.library) found.set(dir.root, "directory+banner");
    else if (entries.some((name) => name.toLowerCase() === posix.basename(file.path).toLowerCase())) found.set(dir.root, "directory+entry");
  }
  return found;
}

/** Marks counted per place, reason and library; one library's header marks over many folders collapse into one. */
function groupMarks(marks: readonly FileMark[]): ThirdPartyMark[] {
  const groups = new Map<string, { where: string; library?: string; reason: ThirdPartyMarkReason; files: number }>();
  for (const m of marks) {
    const key = `${m.reason}|${m.library ?? ""}|${m.where}`;
    const group = groups.get(key);
    if (group) group.files++;
    else groups.set(key, { where: m.where, ...(m.library !== undefined ? { library: m.library } : {}), reason: m.reason, files: 1 });
  }
  const out: ThirdPartyMark[] = [];
  const headerByLibrary = new Map<string, ThirdPartyMark[]>();
  for (const g of groups.values()) {
    if (g.reason !== "header" || g.library === undefined) {
      out.push(g);
      continue;
    }
    let list = headerByLibrary.get(g.library);
    if (list === undefined) headerByLibrary.set(g.library, (list = []));
    list.push(g);
  }
  for (const [library, list] of headerByLibrary) {
    if (list.length <= MAX_LOGGED_FOLDERS) out.push(...list);
    else out.push({ where: "", library, reason: "header", files: list.reduce((n, g) => n + g.files, 0), folders: list.length });
  }
  // Folders in path order, then the collapsed lines.
  const order = (m: ThirdPartyMark) => [m.folders === undefined ? 0 : 1, m.where, m.reason, m.library ?? ""].join("\n");
  return out.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
}

/**
 * The analyze log line for one mark: where, the library, the reason, the
 * file count and, for a built-in rule, the deny glob that undoes it.
 */
export function describeThirdPartyMark(mark: ThirdPartyMark): string {
  const files = `${mark.files} ${mark.files === 1 ? "file" : "files"}`;
  if (mark.reason === "config" || mark.reason === "flag") return `[third-party] ${mark.where} (${mark.reason}): ${files}`;
  const undo = "in sourcevision.thirdParty or --third-party";
  if (mark.folders !== undefined) {
    return `[third-party] ${files} in ${mark.folders} folders: ${mark.library} (${mark.reason}); undo one with "!<folder>/**" ${undo}`;
  }
  const deny = mark.where === "." ? "!<file>" : `!${mark.where}/**`;
  return `[third-party] ${mark.where}/: ${mark.library} (${mark.reason}), ${files}; undo with "${deny}" ${undo}`;
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
