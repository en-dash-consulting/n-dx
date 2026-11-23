/**
 * Crontab-like files in a repository, read as text (LS16: nothing is run),
 * and the PHP scripts they schedule.
 *
 * A crontab-like file is named `crontab`, ends in `.cron`, or sits in a
 * `cron.d/` directory. Each job line is a schedule (five fields, or one
 * `@reboot`/`@daily`… nickname), then, in system crontabs (`cron.d/`), a
 * user, then the command; the command's `php` invocations (`php`, `php7.4`,
 * `/usr/bin/php`, options skipped) name the script run. Comments, blank lines
 * and `NAME=value` environment lines are not jobs.
 *
 * @module lang-php/php-cron
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** One PHP script a crontab line runs. */
export interface CronJob {
  /** Project-relative path of the crontab-like file. */
  readonly file: string;
  /** One-based line. */
  readonly line: number;
  /** The schedule as written: five fields with their spacing, or a nickname. */
  readonly schedule: string;
  /** The script argument as written, quotes removed. */
  readonly script: string;
}

const baseOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const parentOf = (path: string): string => {
  const dir = path.slice(0, Math.max(0, path.lastIndexOf("/")));
  return baseOf(dir);
};

/** A file cron reads jobs from: `crontab`, `*.cron`, or anything in a `cron.d/` directory. */
export function isCrontabFile(path: string): boolean {
  const name = baseOf(path);
  return name === "crontab" || (name.endsWith(".cron") && name !== ".cron") || parentOf(path) === "cron.d";
}

/** Directories never searched for crontabs: dependencies, not the repository's own jobs. */
const SKIPPED = new Set(["vendor", "node_modules"]);

/** How deep below the root a directory is searched for crontab-like files (`deploy/crontab`, `etc/cron.d/app`). */
const MAX_DEPTH = 2;

/**
 * Crontab-like files of a repository, sorted: those among `listed` (the
 * files beside the PHP sources), and those in directories at most
 * {@link MAX_DEPTH} below the root or in a `cron.d/` directly inside one.
 * Hidden directories, `vendor/` and `node_modules/` are not searched. A
 * crontab deeper than that, with no PHP file beside it, is not found.
 */
export async function findCrontabFiles(projectDir: string, listed: readonly string[]): Promise<string[]> {
  const found = new Set(listed.filter(isCrontabFile));
  const visit = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(projectDir, dir), { withFileTypes: true });
    } catch {
      return; // an unreadable directory holds no crontab we could read
    }
    for (const entry of entries) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isFile() && isCrontabFile(path)) found.add(path);
      else if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED.has(entry.name)) {
        if (depth < MAX_DEPTH || (depth === MAX_DEPTH && entry.name === "cron.d")) await visit(path, depth + 1);
      }
    }
  };
  await visit("", 0);
  return [...found].sort();
}

/** Each crontab-like file's text by path; an unreadable file is a notice. */
export async function readCrontabFiles(
  projectDir: string,
  files: readonly string[],
): Promise<{ crontabs: Map<string, string>; notices: string[] }> {
  const crontabs = new Map<string, string>();
  const notices: string[] = [];
  for (const file of files) {
    try {
      crontabs.set(file, await readFile(join(projectDir, file), "utf8"));
    } catch (error) {
      notices.push(`could not read ${file} (${(error as NodeJS.ErrnoException).code ?? "error"}); its cron jobs are not marked.`);
    }
  }
  return { crontabs, notices };
}

/** A schedule: a nickname, or five fields; group 1 is the schedule, group 2 the rest. */
const SCHEDULE = /^\s*(@[a-z]+|\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(\S.*)$/i;

/** `NAME=value`: a crontab environment setting, not a job. */
const ENV_LINE = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/;

/** The PHP CLI: `php`, `php8.2`, `php-cli`, `/usr/local/bin/php`. */
const PHP_BINARY = /^(?:\S*\/)?php(?:[\d.]*|-cli)$/;

/** Options of the PHP CLI that take a value as the next word (php.net/manual/en/features.commandline.options.php). */
const OPTIONS_WITH_VALUE = new Set(["-c", "-d", "-z"]);

/** Shell words of a command, quotes removed; operators (`&&`, `;`, `|`, `>`) are words of their own. */
function words(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/"([^"]*)"|'([^']*)'|(&&|\|\||[;|&()<>]|[^\s;|&()<>"']+)/g)) {
    out.push(m[1] ?? m[2] ?? m[3]!);
  }
  return out;
}

const OPERATORS = new Set(["&&", "||", ";", "|", "&", "(", ")", "<", ">"]);

/** The scripts the `php` invocations of one command run, as written. */
function phpScripts(command: string): string[] {
  const ws = words(command);
  const scripts: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    if (!PHP_BINARY.test(ws[i]!)) continue;
    for (let j = i + 1; j < ws.length && !OPERATORS.has(ws[j]!); j++) {
      const w = ws[j]!;
      if (w === "-f") {
        if (j + 1 < ws.length) scripts.push(ws[j + 1]!);
        break;
      }
      if (OPTIONS_WITH_VALUE.has(w)) {
        j++;
        continue;
      }
      if (w.startsWith("-")) continue;
      scripts.push(w);
      break;
    }
  }
  return scripts;
}

/** The PHP scripts a crontab-like file's job lines run, in order. */
export function parseCrontab(file: string, text: string): CronJob[] {
  const jobs: CronJob[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trimEnd();
    if (/^\s*(#|$)/.test(line) || ENV_LINE.test(line)) return;
    const m = SCHEDULE.exec(line);
    if (!m) return;
    for (const script of phpScripts(m[2]!)) jobs.push({ file, line: index + 1, schedule: m[1]!, script });
  });
  return jobs;
}

/**
 * The repository file a crontab's script path names: the longest trailing
 * part of the path that is one of `files`. A crontab names scripts where
 * they are deployed (`/var/www/app/cron/x.php`), or relative to a directory
 * it `cd`s to, so the repository-relative path is a suffix of it.
 */
export function cronScriptFile(script: string, files: ReadonlySet<string>): string | undefined {
  const segments = script.split("/").filter((s) => s !== "" && s !== ".");
  for (let i = 0; i < segments.length; i++) {
    const candidate = segments.slice(i).join("/");
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}
