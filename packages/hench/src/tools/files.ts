import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { simpleGlobMatch, GuardError } from "../guard/paths.js";
import { DEFAULT_WRITE_SHRINK_MIN_BYTES, DEFAULT_WRITE_SHRINK_RATIO } from "../guard/contracts.js";
import type { ToolGuard } from "./contracts.js";

export async function toolReadFile(
  guard: ToolGuard,
  params: { path: string },
): Promise<string> {
  const resolved = guard.checkPath(params.path);
  const s = await stat(resolved);
  if (s.size > guard.maxFileSize) {
    throw new Error(
      `File exceeds max size (${s.size} > ${guard.maxFileSize}): ${params.path}`,
    );
  }
  guard.recordFileRead(params.path);
  return await readFile(resolved, "utf-8");
}

/** Size of the existing file at `resolved`, or null when there is none. */
async function existingFileSize(resolved: string): Promise<number | null> {
  try {
    const s = await stat(resolved);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

export async function toolWriteFile(
  guard: ToolGuard,
  params: { path: string; content: string; rewrite?: boolean },
): Promise<string> {
  const resolved = guard.checkPath(params.path);
  if (typeof params.content !== "string") {
    throw new Error("write_file needs a string `content`");
  }
  const contentSize = Buffer.byteLength(params.content, "utf-8");
  if (contentSize > guard.maxFileSize) {
    throw new Error(
      `Content exceeds max size (${contentSize} > ${guard.maxFileSize})`,
    );
  }
  // A whole-file write that drops most of an existing file is far more often a
  // model sending back a placeholder ("/* updated */", "") than an intended
  // rewrite, so it needs saying out loud with `rewrite: true`.
  const ratio = guard.writeShrinkRatio ?? DEFAULT_WRITE_SHRINK_RATIO;
  const minBytes = guard.writeShrinkMinBytes ?? DEFAULT_WRITE_SHRINK_MIN_BYTES;
  if (ratio > 0 && params.rewrite !== true) {
    const existing = await existingFileSize(resolved);
    if (existing !== null && existing > minBytes && contentSize < existing * ratio) {
      throw new GuardError(
        `write_file refused: ${params.path} is ${existing} bytes and the new content is ` +
        `${contentSize} bytes, which would drop most of the file. To change part of an ` +
        `existing file, use edit_file (old_string → new_string). For an intentional full ` +
        `rewrite, call write_file again with rewrite: true and the complete new content.`,
      );
    }
  }
  guard.recordFileWrite(params.path, contentSize);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, params.content, "utf-8");
  return `Wrote ${contentSize} bytes to ${params.path}`;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

/** Rewrite every line break in `text` as `eol`. */
function withLineEndings(text: string, eol: "\n" | "\r\n"): string {
  return text.replace(/\r?\n/g, eol);
}

/**
 * Replace an exact string in an existing file.
 *
 * The file goes through the same guard checks as `read_file` and `write_file`.
 * `old_string` must occur exactly once unless `replace_all` is set; zero or
 * several matches is an error naming the count, so the model widens its
 * context rather than editing the wrong place. A file with CRLF line endings
 * is matched against an LF `old_string` (and the reverse), and the
 * replacement takes the file's own line endings.
 */
export async function toolEditFile(
  guard: ToolGuard,
  params: { path: string; old_string: string; new_string: string; replace_all?: boolean },
): Promise<string> {
  const resolved = guard.checkPath(params.path);
  const { old_string: rawOld, new_string: rawNew } = params;
  if (typeof rawOld !== "string" || typeof rawNew !== "string") {
    throw new Error("edit_file needs string `old_string` and `new_string`");
  }
  if (rawOld.length === 0) {
    throw new Error(
      "edit_file needs a non-empty old_string. To create a file, use write_file.",
    );
  }
  if (rawOld === rawNew) {
    throw new Error("edit_file refused: old_string and new_string are identical, so nothing would change.");
  }

  let s;
  try {
    s = await stat(resolved);
  } catch {
    throw new Error(`File not found: ${params.path}. To create a file, use write_file.`);
  }
  if (s.size > guard.maxFileSize) {
    throw new Error(
      `File exceeds max size (${s.size} > ${guard.maxFileSize}): ${params.path}`,
    );
  }
  guard.recordFileRead(params.path);
  const content = await readFile(resolved, "utf-8");

  // The file's line endings: CRLF only when every break is CRLF, LF only when
  // none is, and null for a mixed file, which is written back as given.
  const crlfBreaks = content.split("\r\n").length - 1;
  const allBreaks = content.split("\n").length - 1;
  const fileEol: "\n" | "\r\n" | null =
    crlfBreaks === 0 ? "\n" : crlfBreaks === allBreaks ? "\r\n" : null;

  // Try the strings as given, then in the file's own line endings, so a model
  // that writes LF against a CRLF file (or the reverse) still lands its edit.
  let oldString = rawOld;
  let newString = rawNew;
  let count = countOccurrences(content, oldString);
  if (count === 0 && fileEol !== null && rawOld.includes("\n")) {
    const converted = withLineEndings(rawOld, fileEol);
    if (converted !== rawOld) {
      oldString = converted;
      count = countOccurrences(content, oldString);
    }
  }
  if (fileEol !== null) newString = withLineEndings(newString, fileEol);

  if (count === 0) {
    throw new Error(
      `edit_file found 0 matches for old_string in ${params.path}. ` +
      "old_string must match the file exactly, including whitespace and indentation; " +
      "read_file the file and copy the text to replace.",
    );
  }
  if (count > 1 && params.replace_all !== true) {
    throw new Error(
      `edit_file found ${count} matches for old_string in ${params.path}. ` +
      "Include more surrounding lines so it matches exactly once, or pass replace_all: true to replace every match.",
    );
  }

  const firstAt = content.indexOf(oldString);
  const updated = params.replace_all === true
    ? content.split(oldString).join(newString)
    : content.slice(0, firstAt) + newString + content.slice(firstAt + oldString.length);

  const size = Buffer.byteLength(updated, "utf-8");
  if (size > guard.maxFileSize) {
    throw new Error(`Content exceeds max size (${size} > ${guard.maxFileSize})`);
  }
  guard.recordFileWrite(params.path, size);
  await writeFile(resolved, updated, "utf-8");

  const line = content.slice(0, firstAt).split("\n").length;
  const replaced = params.replace_all === true ? `${count} occurrence${count === 1 ? "" : "s"}` : "1 occurrence";
  return `Edited ${params.path}: replaced ${replaced} (first at line ${line})`;
}

export async function toolListDirectory(
  guard: ToolGuard,
  params: { path: string; recursive?: boolean },
): Promise<string> {
  const resolved = guard.checkPath(params.path);
  const entries: string[] = [];

  async function listDir(dir: string, prefix: string): Promise<void> {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        entries.push(name + "/");
        if (params.recursive) {
          await listDir(join(dir, item.name), name);
        }
      } else {
        entries.push(name);
      }
    }
  }

  await listDir(resolved, "");
  return entries.join("\n");
}

export async function toolSearchFiles(
  guard: ToolGuard,
  params: { pattern: string; path: string; glob?: string },
): Promise<string> {
  const resolved = guard.checkPath(params.path);

  let regex: RegExp;
  try {
    regex = new RegExp(params.pattern);
  } catch {
    throw new Error(`Invalid regex pattern: ${params.pattern}`);
  }

  const results: string[] = [];
  const MAX_RESULTS = 50;

  async function searchDir(dir: string, prefix: string): Promise<void> {
    if (results.length >= MAX_RESULTS) return;

    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      if (results.length >= MAX_RESULTS) break;

      const name = prefix ? `${prefix}/${item.name}` : item.name;

      if (item.isDirectory()) {
        if (item.name === "node_modules" || item.name === ".git") continue;
        await searchDir(join(dir, item.name), name);
      } else {
        // Check glob filter if provided
        if (params.glob && !simpleGlobMatch(params.glob, name)) {
          continue;
        }

        try {
          const filePath = join(dir, item.name);
          const s = await stat(filePath);
          if (s.size > guard.maxFileSize) continue;

          const content = await readFile(filePath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${name}:${i + 1}: ${lines[i]}`);
              if (results.length >= MAX_RESULTS) break;
            }
          }
        } catch {
          // Skip files that can't be read (binary, permissions, etc)
        }
      }
    }
  }

  await searchDir(resolved, "");

  if (results.length === 0) {
    return "No matches found";
  }

  const output = results.join("\n");
  if (results.length >= MAX_RESULTS) {
    return output + `\n... (truncated at ${MAX_RESULTS} results)`;
  }
  return output;
}
