/**
 * CLI and cron entry points over the PHP pack: scripts run from the command
 * line or by cron rather than requested through the web server.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/php-entry/entry.scm`) runs in the PHP parse only when entry
 * points are wanted. Crontab text comes from the resolver's `configFiles`
 * (`php-cron.ts`, read by `phpResolver.forProject`). Rules (keys of
 * {@link PROVENANCE}):
 *
 * - `shebang`: a file whose text before `<?php` starts with a `#!` line
 *   running `php` (`#!/usr/bin/env php`, `#!/usr/bin/php`) is a `cli` entry
 *   point, `source` `shebang`.
 * - `cli-check`: a file under a `bin/`, `cli/`, `cron/`, `scripts/` or
 *   `jobs/` directory (at any depth) that compares `PHP_SAPI` or
 *   `php_sapi_name()` with `'cli'` (`==`, `===`, `!=`, `!==`, `<>`), or reads
 *   `$argv` or `$_SERVER['argv']`, is a `cli` entry point, `source`
 *   `PHP_SAPI check` or `$argv`, at the first such place.
 * - `crontab`: a PHP file a crontab-like file's job runs (`php path/x.php`)
 *   is a `cron` entry point, `source` `<crontab path>:<line>`, with the
 *   schedule as written. A script that is not a PHP file of the repository
 *   is a notice.
 *
 * A file is `cli` once (shebang first) and `cron` once per job line.
 *
 * @module lang-php/php-entry-points
 */

import { join } from "node:path";
import type { EntryPointFact, FactKind, FileFacts, SourcePosition } from "@n-dx/lang-kit";
import type { Capture, FrameworkContext, FrameworkFacts, FrameworkPack, PackSourceFile, RuleProvenance } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";
import { cronScriptFile, isCrontabFile, parseCrontab } from "./php-cron.js";

export const ENTRY_QUERY = "entry";

const rule = (verifiedAgainst: readonly string[], source: string): RuleProvenance => ({ verifiedAgainst, verifiedOn: "2026-11-16", source });

const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [ENTRY_QUERY]: rule(["tree-sitter-php@0.25.1"], "https://github.com/tree-sitter/tree-sitter-php/blob/v0.25.1/php/src/node-types.json"),
  // The CLI SAPI skips a first line starting with `#!`, so a script can run directly.
  shebang: rule(["PHP manual"], "https://www.php.net/manual/en/features.commandline.usage.php"),
  // PHP_SAPI / php_sapi_name() are "cli" under the CLI SAPI; $argv and $_SERVER['argv'] hold its arguments.
  "cli-check": rule(["PHP manual"], "https://www.php.net/manual/en/function.php-sapi-name.php"),
  // A crontab line: five time fields or an @nickname, a user in system crontabs, then the command.
  crontab: rule(["cronie crontab(5)"], "https://man7.org/linux/man-pages/man5/crontab.5.html"),
};

/** Directories whose scripts are run from the command line by convention. */
export const PHP_CLI_DIRECTORIES: readonly string[] = ["bin", "cli", "cron", "scripts", "jobs"];

const SHEBANG = /^#![ \t]*\S*\/(?:env[ \t]+(?:-\S+[ \t]+)*)?php[\d.]*(?:[ \t]|\r?\n|$)/;

const SAPI = /^\\?(?:PHP_SAPI|php_sapi_name\s*\(\s*\))$/i;
const CLI_STRING = /^(['"])cli\1$/;
const COMPARISON = /^([\s\S]*?)\s*(?:===|!==|==|!=|<>)\s*([\s\S]*)$/;

/** A `PHP_SAPI`/`php_sapi_name()` comparison whose other operand is `'cli'`. */
export function isCliCheck(text: string): boolean {
  const m = COMPARISON.exec(text.trim());
  if (!m) return false;
  const [left, right] = [m[1]!.trim(), m[2]!.trim()];
  return (SAPI.test(left) && CLI_STRING.test(right)) || (SAPI.test(right) && CLI_STRING.test(left));
}

const START: SourcePosition = { line: 1, column: 0 };

const underCliDirectory = (path: string): boolean => path.split("/").slice(0, -1).some((dir) => PHP_CLI_DIRECTORIES.includes(dir));

/** One file's `cli` entry point, if any. */
function cliEntry(file: PackSourceFile): EntryPointFact | undefined {
  const captures = file.captures[ENTRY_QUERY] ?? [];
  const lead = captures.find((c) => c.name === "entry.lead");
  if (lead && SHEBANG.test(lead.text)) return { kind: "cli", source: "shebang", position: lead.start };
  if (!underCliDirectory(file.path)) return undefined;
  const first = captures
    .filter((c) => c.name === "entry.argv" || (c.name === "entry.sapi" && isCliCheck(c.text)))
    .sort(byStart)[0];
  return first && { kind: "cli", source: first.name === "entry.sapi" ? "PHP_SAPI check" : "$argv", position: first.start };
}

const byStart = (a: Capture, b: Capture): number => a.start.line - b.start.line || a.start.column - b.start.column;

/** Every CLI and cron entry point of a project, and the cron jobs whose script is not one of its files. */
export function readEntryPoints(files: readonly PackSourceFile[], configFiles: ReadonlyMap<string, string>): FrameworkFacts {
  const entries = new Map<string, EntryPointFact[]>();
  const add = (path: string, fact: EntryPointFact): void => {
    entries.set(path, [...(entries.get(path) ?? []), fact]);
  };
  for (const file of files) {
    const cli = cliEntry(file);
    if (cli) add(file.path, cli);
  }
  const paths = new Set(files.map((f) => f.path));
  const notices: string[] = [];
  for (const [crontab, text] of [...configFiles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!isCrontabFile(crontab)) continue;
    for (const job of parseCrontab(crontab, text)) {
      const at = `${job.file}:${job.line}`;
      const target = cronScriptFile(job.script, paths);
      if (target === undefined) {
        notices.push(`PHP: ${at} runs ${job.script}, which is not a PHP file of the repository; no entry point recorded.`);
        continue;
      }
      add(target, { kind: "cron", source: at, schedule: job.schedule, position: START });
    }
  }
  const facts = new Map<string, Omit<FileFacts, "path">>([...entries].map(([path, list]) => [path, { entryPoints: list }]));
  return { facts, notices };
}

export const phpEntryPoints: FrameworkPack = {
  id: "php-entry",
  produces: ["entryPoints"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: ENTRY_QUERY, path: join(PHP_PACKAGE.queryDir("php-entry"), `${ENTRY_QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[], context?: FrameworkContext): FrameworkFacts {
    return kinds.includes("entryPoints") ? readEntryPoints(files, context?.configFiles?.() ?? new Map()) : { facts: new Map(), notices: [] };
  },
};
